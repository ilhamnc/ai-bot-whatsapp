// Arsip teks chat grup dan pencarian konteks lama disimpan di SQLite lokal.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { stateDir } from '../config.js';

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
`);

const insertMessage = database.prepare(`
  INSERT OR IGNORE INTO chat_messages
    (message_id, group_id, sender_key, sender_name, content, message_type, from_bot, sent_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const deleteGroupMessages = database.prepare('DELETE FROM chat_messages WHERE group_id = ?');

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
  return createHash('sha256').update(String(author || 'unknown')).digest('hex').slice(0, 10);
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

  insertMessage.run(
    getMessageId(message), groupId, getSenderKey(senderId), senderName,
    content, messageType, fromBot ? 1 : 0, sentAt
  );
  return true;
}

function toContextTurn(row) {
  const label = row.from_bot ? 'AiBot' : `[ANGGOTA:${row.sender_key}] ${row.sender_name}`;
  return {
    role: row.from_bot ? 'model' : 'user',
    text: `${label}: ${String(row.content).slice(0, 1000)}`,
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

  const keywords = questionKeywords(question);
  let relevantRows = [];
  if (keywords.length) {
    const clauses = keywords.map(() => 'lower(content) LIKE ?').join(' OR ');
    const matches = database.prepare(`
      SELECT message_id, sender_key, sender_name, content, from_bot, sent_at
      FROM chat_messages
      WHERE group_id = ? AND message_id <> ? AND (${clauses})
      ORDER BY sent_at DESC, id DESC LIMIT 300
    `).all(groupId, excludeMessageId || '', ...keywords.map(word => `%${word}%`));
    const recentIds = new Set(recentRows.map(row => row.message_id));
    relevantRows = matches
      .filter(row => !recentIds.has(row.message_id))
      .map(row => ({
        row,
        score: keywords.reduce((score, word) => score + (String(row.content).toLocaleLowerCase('id-ID').includes(word) ? 1 : 0), 0)
      }))
      .filter(match => match.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.row.sent_at) - Number(a.row.sent_at))
      .slice(0, 6)
      .map(match => match.row);
  }

  const combined = [...new Map([...recentRows, ...relevantRows]
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
  return Number(deleteGroupMessages.run(groupId).changes || 0);
}

export function closeChatHistoryDatabase() {
  database.close();
}
