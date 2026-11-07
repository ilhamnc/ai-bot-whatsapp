// Menyesuaikan event dan objek Baileys dengan antarmuka yang dipakai bot.
// Baileys memakai WebSocket sehingga tidak perlu menjalankan Chrome.
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import makeWASocket, {
  BufferJSON, DisconnectReason, initAuthCreds, jidNormalizedUser, proto
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { decryptText, encryptText, isEncrypted } from './encryptionService.js';

// Log detail handshake Baileys berisi metadata teknis yang tidak perlu dicetak rutin.
const whatsappLogger = pino({ level: 'warn' });
const fileQueues = new Map();

function withFileLock(file, action) {
  const previous = fileQueues.get(file) || Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  fileQueues.set(file, current);
  return current.finally(() => {
    if (fileQueues.get(file) === current) fileQueues.delete(file);
  });
}

function safeAuthFilename(name) {
  return String(name || '').replace(/[\\/]/g, '__').replace(/:/g, '-');
}

async function writeAuthData(folder, name, value) {
  const file = path.join(folder, safeAuthFilename(name));
  const temporary = `${file}.tmp`;
  const serialized = JSON.stringify(value, BufferJSON.replacer);
  await fs.writeFile(temporary, encryptText(serialized), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, file);
  try { await fs.chmod(file, 0o600); } catch { /* Mode POSIX tidak tersedia di Windows. */ }
}

async function readAuthData(folder, name) {
  const file = path.join(folder, safeAuthFilename(name));
  return withFileLock(file, async () => {
    let raw;
    try { raw = await fs.readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (isEncrypted(raw)) return JSON.parse(decryptText(raw), BufferJSON.reviver);
    const value = JSON.parse(raw, BufferJSON.reviver);
    await writeAuthData(folder, name, value);
    return value;
  });
}

export async function migrateEncryptedAuthState(folder) {
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  for (const name of await fs.readdir(folder)) {
    if (name.endsWith('.tmp')) {
      await fs.rm(path.join(folder, name), { force: true });
    } else if (name.endsWith('.json')) {
      await readAuthData(folder, name);
    }
  }
}

async function useEncryptedAuthState(folder) {
  await migrateEncryptedAuthState(folder);
  const creds = await readAuthData(folder, 'creds.json') || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const values = {};
          await Promise.all(ids.map(async id => {
            let value = await readAuthData(folder, `${type}-${id}.json`);
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            values[id] = value;
          }));
          return values;
        },
        set: async data => {
          const tasks = [];
          for (const type of Object.keys(data)) {
            for (const id of Object.keys(data[type])) {
              const filename = `${type}-${id}.json`;
              const value = data[type][id];
              const file = path.join(folder, safeAuthFilename(filename));
              tasks.push(withFileLock(file, async () => {
                if (value) await writeAuthData(folder, filename, value);
                else await fs.rm(file, { force: true });
              }));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => withFileLock(path.join(folder, 'creds.json'), () => writeAuthData(folder, 'creds.json', creds))
  };
}

function unwrapMessage(message) {
  let content = message || {};
  for (let index = 0; index < 4; index++) {
    const wrapped = content.ephemeralMessage?.message
      || content.viewOnceMessage?.message
      || content.viewOnceMessageV2?.message
      || content.documentWithCaptionMessage?.message;
    if (!wrapped) break;
    content = wrapped;
  }
  return content;
}

function messageDetails(raw) {
  const content = unwrapMessage(raw?.message);
  const type = Object.keys(content).find(key => key.endsWith('Message')) || 'conversation';
  const item = content[type] || {};
  const body = content.conversation || item.text || item.caption || '';
  return { type, body, context: item.contextInfo || {} };
}

export class BaileysClient extends EventEmitter {
  constructor(accountId, authDir) {
    super();
    this.sessionPath = path.join(authDir, `baileys-${accountId}`);
    this.socket = null;
    this.info = null;
    this.destroyed = false;
    this.reconnectTimer = null;
    this.authState = null;
    this.saveCreds = null;
  }

  async initialize() {
    const { state, saveCreds } = await useEncryptedAuthState(this.sessionPath);
    if (this.destroyed) return;
    this.authState = state;
    this.saveCreds = saveCreds;
    this.connect();
  }

  connect() {
    if (this.destroyed) return;
    const socket = makeWASocket({
      auth: this.authState,
      logger: whatsappLogger,
      // Riwayat penuh tidak diperlukan; sinkronisasi awal tetap penting untuk peta ID @lid.
      syncFullHistory: false,
      markOnlineOnConnect: false
    });
    this.socket = socket;
    socket.ev.on('creds.update', this.saveCreds);
    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (this.destroyed || this.socket !== socket || type !== 'notify') return;
      for (const raw of messages || []) {
        if (!raw?.message || !raw.key?.remoteJid) continue;
        const message = this.normalizeMessage(raw);
        this.emit('message_create', message);
        if (!message.fromMe) this.emit('message', message);
      }
    });
    socket.ev.on('connection.update', update => {
      if (this.destroyed || this.socket !== socket) return;
      if (update.qr) this.emit('qr', update.qr);
      if (update.connection === 'open') {
        const jid = jidNormalizedUser(socket.user?.id || '');
        this.info = { wid: { _serialized: jid, user: jid.split('@')[0] } };
        this.emit('ready');
      }
      if (update.connection !== 'close') return;
      this.info = null;
      const reason = update.lastDisconnect?.error?.output?.statusCode;
      if (reason === DisconnectReason.loggedOut || reason === DisconnectReason.badSession) {
        this.emit('auth_failure');
        return;
      }
      this.emit('disconnected', reason || 'koneksi terputus');
      this.reconnectTimer = setTimeout(() => {
        if (!this.destroyed && this.socket === socket) this.connect();
      }, 3000);
    });
  }

  normalizeMessage(raw) {
    const { type, body, context } = messageDetails(raw);
    const from = raw.key.remoteJid;
    const quoted = context.quotedMessage
      ? messageDetails({ message: context.quotedMessage }) : null;
    const participant = context.participant || '';
    const selfIds = [this.info?.wid?._serialized, this.socket?.user?.lid]
      .filter(Boolean).map(jid => jid.split('@')[0].split(':')[0]);
    const quotedFromMe = Boolean(participant && selfIds.includes(participant.split('@')[0].split(':')[0]));
    const message = {
      id: { _serialized: raw.key.id || '' },
      from,
      author: raw.key.participant || raw.participant || (raw.key.fromMe ? this.info?.wid?._serialized || from : from),
      authorAlt: raw.key.participantAlt || '',
      fromMe: raw.key.fromMe === true,
      body: String(body),
      caption: String(body),
      type,
      timestamp: Number(raw.messageTimestamp) || Math.floor(Date.now() / 1000),
      mentionedIds: context.mentionedJid || [],
      hasQuotedMsg: Boolean(quoted),
      _data: {
        notifyName: raw.pushName || '',
        quotedMsg: quoted ? { body: quoted.body, fromMe: quotedFromMe, id: { fromMe: quotedFromMe } } : null
      },
      getQuotedMessage: async () => quoted ? { body: quoted.body, fromMe: quotedFromMe } : null,
      getChat: () => this.getChatById(from),
      reply: text => this.sendMessage(from, text, { quoted: raw })
    };
    return message;
  }

  async sendMessage(chatId, text, options = {}) {
    if (!this.socket) throw new Error('WhatsApp belum terhubung.');
    const mentionAll = options.extra?.nonJidMentions === 1;
    const sent = await this.socket.sendMessage(chatId, { text: String(text), ...(mentionAll ? { mentionAll: true } : {}) },
      options.quoted ? { quoted: options.quoted } : {});
    if (sent) this.emit('message_create', this.normalizeMessage(sent));
    return sent;
  }

  async getChatById(chatId) {
    const metadata = await this.socket.groupMetadata(chatId);
    return { name: metadata.subject || chatId, groupMetadata: metadata };
  }

  async destroy() {
    this.destroyed = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.end(new Error('Sesi dihentikan oleh AiBot.'));
    this.socket = null;
  }

  async logout() {
    this.destroyed = true;
    clearTimeout(this.reconnectTimer);
    try { await this.socket?.logout(); }
    finally { this.socket?.end(new Error('Akun dilepas dari AiBot.')); this.socket = null; }
  }
}
