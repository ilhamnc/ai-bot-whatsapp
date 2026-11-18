// Layanan deteksi sebutan (mention), pembersihan teks panggilan, dan ekstraksi pesan kutipan.
import fs from 'node:fs';
import { stateDir, botMentionIdsFile } from '../config.js';
import { readSecureJson, writeSecureJson } from './encryptionService.js';

// 1. Tag eksplisit @AiBot, @iBot, @bot, @~AiBot, @~iBot, @~AiBot 🤖
const ROBUST_BOT_NAME_MENTION = /@~?(?:AiBot|ibot|bot)(?=$|[\s\p{P}\p{S}\p{Cf}])/iu;

// 2. Awalan pesan dengan aibot / ibot / bot (contoh: "ibot, ini apa?", "bot: halo", "aibot tolong")
const NATURAL_BOT_PREFIX = /^(?:@~?(?:aibot|ibot|bot)|aibot|ibot|bot)\s*[,:\s]\s*/i;

// 3. Akhiran pesan atau kalimat yang memanggil aibot / ibot / bot (contoh: "Ini enak ga ibot?", "gimana bot?", "bisa bantu ga aibot?")
const NATURAL_BOT_SUFFIX = /[\s,.:;!?]+(?:aibot|ibot|bot)\s*[?!.,]*$/i;

// 4. Panggilan vokatif langsung di dalam kalimat (contoh: "menurut ibot gimana?", "tolong bot", "tanya aibot")
const NATURAL_BOT_VOCATIVE = /\b(?:halo|hai|pagi|siang|sore|malam|tolong|menurut|tanya|ke)\s+(?:aibot|ibot|bot)\b/i;

let botMentionIds = readSecureJson(botMentionIdsFile, []);
if (!Array.isArray(botMentionIds)) botMentionIds = [];

export function normalizeMentionId(id) {
  if (typeof id === 'string') return id.toLowerCase();
  return String(id?._serialized || id?.id?._serialized || id?.id || '').toLowerCase();
}

export function normalizeMentionText(text) {
  return String(text || '').normalize('NFKC')
    .replace(/[\u200B-\u200F\uFEFF\u2060\uFE0E\uFE0F]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

export function registeredMentionIds() {
  return botMentionIds.filter(id => typeof id === 'string');
}

export function saveBotMentionId(id) {
  const ids = [...new Set([...registeredMentionIds(), id])];
  fs.mkdirSync(stateDir, { recursive: true });
  writeSecureJson(botMentionIdsFile, ids);
  botMentionIds = ids;
}

export function hasBotNameMention(text) {
  const normalized = normalizeMentionText(text);
  if (!normalized) return false;
  return ROBUST_BOT_NAME_MENTION.test(normalized)
    || NATURAL_BOT_PREFIX.test(normalized)
    || NATURAL_BOT_SUFFIX.test(normalized)
    || NATURAL_BOT_VOCATIVE.test(normalized);
}

export function hasOwnPhoneNumberMention(text, client, extraIds = []) {
  const ownNumbers = new Set();
  const ownUser = String(client?.info?.wid?.user || '');
  if (/^\d{5,}$/.test(ownUser)) ownNumbers.add(ownUser);
  for (const id of [client?.info?.wid?._serialized, ...extraIds]) {
    const match = String(id || '').toLowerCase().match(/^(\d+)(?::\d+)?@(c\.us|s\.whatsapp\.net|lid)$/);
    if (match) ownNumbers.add(match[1]);
  }
  if (!ownNumbers.size) return false;
  const writtenNumbers = [...normalizeMentionText(text).matchAll(/(?:^|\s)@(\d{5,})(?=$|[\s.,!?;:])/g)]
    .map(match => match[1]);
  return writtenNumbers.some(number => ownNumbers.has(number));
}

export async function isCalledWithMention(msg, text, client) {
  if (hasBotNameMention(text)) return true;
  const mentions = (Array.isArray(msg.mentionedIds) ? msg.mentionedIds : [])
    .map(normalizeMentionId).filter(Boolean);
  if (mentions.length === 0) return false;
  const extraIds = (process.env.BOT_MENTION_IDS || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const savedIds = [...extraIds, ...registeredMentionIds()];
  if (typeof client?.isOwnMention === 'function' && await client.isOwnMention(msg.mentionedIds, savedIds)) {
    return true;
  }
  return hasOwnPhoneNumberMention(text, client, savedIds);
}

export function removeBotTag(text) {
  return String(text || '')
    .replace(NATURAL_BOT_PREFIX, ' ')
    .replace(/@~?(?:AiBot|ibot|bot)(?:\s*🤖)?/ig, ' ')
    .replace(/@\d{5,}(?=\s|$)/g, ' ')
    .replace(NATURAL_BOT_SUFFIX, '')
    .replace(/\s+([?!.,])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ekstrak teks pertanyaan dari body pesan, baik diawali !ai, mention @AiBot, maupun awalan/akhiran kata bot.
 * @param {string} body
 * @returns {string}
 */
export function extractQuestionText(body) {
  const raw = String(body || '').trim();
  if (/^!ai(?:\s|$)/i.test(raw)) {
    return raw.slice(3).trim();
  }
  let cleaned = removeBotTag(raw)
    .replace(/^@?\d+@(lid|c\.us)\s*/i, '')
    .replace(/^@\d+\s*/i, '')
    .trim();

  // Bersihkan sisa tanda tanya tunggal jika sebelumnya hanya berupa "@AiBot ?"
  if (cleaned === '?' || cleaned === '??' || cleaned === '???') {
    return '';
  }
  return cleaned;
}

/**
 * Membaca detail pesan kutipan WhatsApp (baik mengutip pesan AiBot maupun pesan anggota lain).
 * @param {object} msg
 * @returns {Promise<{ body: string, fromMe: boolean, participant?: string }|null>}
 */
export async function getQuotedMessageDetails(msg) {
  if (!msg?.hasQuotedMsg && !msg?._data?.quotedMsg) return null;
  let body = '';
  let fromMe = false;
  let participant = msg.quotedParticipant || msg?._data?.quotedMsg?.participant || '';

  try {
    if (msg.id?.$1 && !msg.id._serialized) msg.id._serialized = msg.id.$1;
    if (typeof msg.getQuotedMessage === 'function') {
      const quoted = await msg.getQuotedMessage();
      if (quoted) {
        body = String(quoted.body || quoted.caption || '').trim();
        fromMe = quoted.fromMe === true;
        if (quoted.participant) participant = quoted.participant;
      }
    }
  } catch (error) {
    console.warn('[BALASAN] Gagal membaca kutipan via getQuotedMessage:', error.message);
  }

  if (!body && msg?._data?.quotedMsg) {
    const quotedData = msg._data.quotedMsg;
    body = String(quotedData.body || quotedData.caption || '').trim();
    fromMe = quotedData.fromMe === true || quotedData.id?.fromMe === true;
    if (quotedData.participant) participant = quotedData.participant;
  }

  if (!body) return null;
  return { body, fromMe, participant };
}
