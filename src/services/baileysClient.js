// Menyesuaikan event dan objek Baileys dengan antarmuka yang dipakai bot.
// Baileys memakai WebSocket sehingga tidak perlu menjalankan Chrome.
import { EventEmitter } from 'node:events';
import path from 'node:path';
import makeWASocket, { DisconnectReason, jidNormalizedUser, useMultiFileAuthState } from '@whiskeysockets/baileys';

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
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
    if (this.destroyed) return;
    this.authState = state;
    this.saveCreds = saveCreds;
    this.connect();
  }

  connect() {
    if (this.destroyed) return;
    const socket = makeWASocket({
      auth: this.authState,
      printQRInTerminal: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
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
