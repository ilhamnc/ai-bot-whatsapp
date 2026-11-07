// Arsip teks chat grup dan pencarian konteks lama disimpan di SQLite lokal.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { stateDir } from '../config.js';
import { createBlindIndex, createPrivateIdentifier, decryptText, encryptText, isEncrypted, tokenizeForSearch } from '../services/encryptionService.js';

fs.mkdirSync(stateDir, { recursive: true });
const database = new DatabaseSync(path.join(stateDir, 'chat-history.sqlite'));
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY,
    message_id TEXT NOT NULL UNIQUE,
    group_id TEXT NOT NULL,
    sender_key TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    content TEXT NOT NULL,
    message_type TEXT NOT NULL,
    from_bot INTEGER NOT NULL,
    sent_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_group_time
    ON chat_messages(group_id, sent_at DESC, id DESC);
  CREATE TABLE IF NOT EXISTS chat_message_terms (
    message_id TEXT NOT NULL,
    term_hash TEXT NOT NULL,
    PRIMARY KEY(message_id, term_hash)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_message_terms_hash
    ON chat_message_terms(term_hash, message_id);
`);

// Migrasikan arsip lama, lalu rapikan WAL agar halaman plaintext sebelum migrasi tidak tertinggal di sana.
const migrateChatArchive = database.prepare(`
  UPDATE chat_messages SET content = ?, sender_name = ? WHERE message_id = ?
`);
const addSearchTerm = database.prepare('INSERT OR IGNORE INTO chat_message_terms (message_id, term_hash) VALUES (?, ?)');
database.exec('BEGIN IMMEDIATE');
let archiveNeedsCompaction = false;
try {
  for (const row of database.prepare('SELECT message_id, content, sender_name FROM chat_messages').all()) {
    const plainContent = isEncrypted(row.content) ? decryptText(row.content) : row.content;
    const plainName = isEncrypted(row.sender_name) ? decryptText(row.sender_name) : row.sender_name;
    if (!isEncrypted(row.content) || !isEncrypted(row.sender_name)) {
      migrateChatArchive.run(encryptText(plainContent), encryptText(plainName), row.message_id);
      archiveNeedsCompaction = true;
    }
    for (const term of tokenizeForSearch(plainContent)) addSearchTerm.run(row.message_id, createBlindIndex(term));
  }
  database.exec('COMMIT');
} catch (error) {
  database.exec('ROLLBACK');
  throw error;
}
if (archiveNeedsCompaction) database.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');

const insertMessage = database.prepare(`
  INSERT OR IGNORE INTO chat_messages
    (message_id, group_id, sender_key, sender_name, content, message_type, from_bot, sent_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const deleteGroupMessages = database.prepare('DELETE FROM chat_messages WHERE group_id = ?');
const deleteGroupTerms = database.prepare(`
  DELETE FROM chat_message_terms WHERE message_id IN
    (SELECT message_id FROM chat_messages WHERE group_id = ?)
`);
const searchMessagesByTerms = database.prepare(`
  SELECT m.message_id, m.sender_key, m.sender_name, m.content, m.from_bot, m.sent_at,
    COUNT(DISTINCT t.term_hash) AS match_score
  FROM chat_messages AS m
  JOIN chat_message_terms AS t ON t.message_id = m.message_id
  WHERE m.group_id = ? AND m.message_id <> ? AND t.term_hash IN (${Array(8).fill('?').join(',')})
  GROUP BY m.message_id
  ORDER BY match_score DESC, m.sent_at DESC, m.id DESC
  LIMIT 300
`);

const STOP_WORDS = new Set([
  'yang', 'dan', 'atau', 'dari', 'untuk', 'dengan', 'dalam', 'pada', 'buat', 'kalau',
  'gimana', 'bagaimana', 'siapa', 'kapan', 'dimana', 'apakah', 'tolong', 'dong', 'sih',
  'tadi', 'sebelumnya', 'kemarin', 'barusan', 'lanjutkan', 'lanjutin', 'tentang', 'chat',
  'grup', 'bilang', 'katakan', 'mereka', 'kalian', 'kami', 'kamu', 'saya', 'aku', 'yang'
]);
const MAX_ARCHIVE_CONTEXT_CHARACTERS = 5000;

function getMessageId(message) {
  return message?.id?._serialized || message?.id?.id?._serialized || message?.id?.$1 || randomUUID();
}

function getSenderKey(author) {
  return createPrivateIdentifier(author);
}

// Simpan pesan teks/caption di grup target; nomor WhatsApp tidak disimpan mentah.
export function archiveWhatsAppMessage(message, targetGroup) {
  const groupId = String(message?.from || '');
  if (!groupId.endsWith('@g.us') || !targetGroup || groupId !== targetGroup) return false;

  const messageType = String(message.type || 'chat').slice(0, 40);
  const body = String(message.body || message.caption || '').trim();
  const content = body || `[Pesan ${messageType} tanpa teks]`;
  const fromBot = message.fromMe === true;
  if ((!fromBot && body.toLowerCase() === '!hapusriwayat')
    || (fromBot && body.startsWith('Arsip chat grup sudah dihapus'))) return false;
  const senderId = fromBot ? 'aibot' : String(message.author || groupId);
  const senderName = fromBot
    ? 'AiBot'
    : String(message?._data?.notifyName || message?._data?.pushname || 'Anggota')
      .replace(/[\r\n]+/g, ' ').slice(0, 60).trim() || 'Anggota';
  const timestamp = Number(message.timestamp);
  const sentAt = Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : Date.now();

  const messageId = getMessageId(message);
  insertMessage.run(
    messageId, groupId, getSenderKey(senderId), encryptText(senderName),
    encryptText(content), messageType, fromBot ? 1 : 0, sentAt
  );
  for (const term of tokenizeForSearch(content)) addSearchTerm.run(messageId, createBlindIndex(term));
  return true;
}

function toContextTurn(row) {
  const label = row.from_bot ? 'AiBot' : `[ANGGOTA:${row.sender_key}] ${row.sender_name}`;
  return {
    role: row.from_bot ? 'model' : 'user',
    text: `${label}: ${decryptText(row.content).slice(0, 1000)}`,
    sentAt: Number(row.sent_at)
  };
}

function questionKeywords(question) {
  return [...new Set(String(question || '').toLocaleLowerCase('id-ID')
    .match(/[\p{L}\p{N}]{3,}/gu) || [])]
    .filter(word => !STOP_WORDS.has(word))
    .slice(0, 8);
}

// Ambil obrolan terbaru dan beberapa pesan lama yang punya kata kunci sama.
// Hasil dibatasi agar arsip penuh tidak ikut dikirim ke AI setiap kali.
export function getRelevantGroupHistory(groupId, question, excludeMessageId = '') {
  const recentRows = database.prepare(`
    SELECT message_id, sender_key, sender_name, content, from_bot, sent_at
    FROM chat_messages
    WHERE group_id = ? AND message_id <> ?
    ORDER BY sent_at DESC, id DESC LIMIT 12
  `).all(groupId, excludeMessageId || '');
  const recentMessages = recentRows.map(row => ({
    ...row,
    content: decryptText(row.content),
    sender_name: decryptText(row.sender_name)
  }));

  const keywords = questionKeywords(question);
  let relevantRows = [];
  if (keywords.length) {
    const hashes = keywords.map(createBlindIndex);
    const matches = searchMessagesByTerms.all(
      groupId, excludeMessageId || '', ...hashes,
      ...Array(8 - hashes.length).fill('')
    );
    const recentIds = new Set(recentMessages.map(row => row.message_id));
    relevantRows = matches
      .filter(row => !recentIds.has(row.message_id))
      .map(row => ({
        row: { ...row, content: decryptText(row.content), sender_name: decryptText(row.sender_name) },
        score: Number(row.match_score)
      }))
      .filter(match => match.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.row.sent_at) - Number(a.row.sent_at))
      .slice(0, 6)
      .map(match => match.row);
  }

  const combined = [...new Map([...recentMessages, ...relevantRows]
    .map(row => [row.message_id, row])).values()]
    .sort((a, b) => Number(a.sent_at) - Number(b.sent_at));
  const selected = [];
  let characterCount = 0;
  for (const row of combined.reverse()) {
    const turn = toContextTurn(row);
    if (characterCount + turn.text.length > MAX_ARCHIVE_CONTEXT_CHARACTERS) continue;
    selected.push(turn);
    characterCount += turn.text.length;
  }
  return selected.reverse().map(({ role, text }) => ({ role, text }));
}

export function getChatHistoryStats(groupId) {
  const result = database.prepare(`
    SELECT COUNT(*) AS message_count, MIN(sent_at) AS first_message_at, MAX(sent_at) AS last_message_at
    FROM chat_messages WHERE group_id = ?
  `).get(groupId);
  return {
    messageCount: Number(result.message_count || 0),
    firstMessageAt: result.first_message_at ? Number(result.first_message_at) : null,
    lastMessageAt: result.last_message_at ? Number(result.last_message_at) : null
  };
}

export function clearGroupChatHistory(groupId) {
  database.exec('BEGIN IMMEDIATE');
  try {
    deleteGroupTerms.run(groupId);
    const deleted = Number(deleteGroupMessages.run(groupId).changes || 0);
    database.exec('COMMIT');
    database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    return deleted;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function closeChatHistoryDatabase() {
  database.close();
}
