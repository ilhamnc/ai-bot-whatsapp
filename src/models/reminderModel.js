// Model reminder: status persisten, isi reminder, dan pengiriman terjadwal.
import fs from 'node:fs';
import { TZ, TARGET_GROUP, stateDir, stateFile, messageFile } from '../config.js';

function loadState() {
  try {
    return { enabled: true, lastDateSent: null, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
  } catch {
    return { enabled: true, lastDateSent: null };
  }
}

export const state = loadState();

export function saveState() {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

function jakartaDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const part = type => parts.find(value => value.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function reminderText() {
  return fs.readFileSync(messageFile, 'utf8').trim();
}

export function kirimReminderDenganTagSemua(client, chatId, text) {
  if (!/@(?:semua|all)\b/i.test(text)) return client.sendMessage(chatId, text);
  // WA-JS menggunakan nonJidMentions=1 untuk mention semua anggota.
  // whatsapp-web.js meneruskan opsi `extra` ke model pesan WhatsApp Web.
  const body = text.replace(/@(?:semua|all)\b/gi, '@all');
  return client.sendMessage(chatId, body, { extra: { nonJidMentions: 1 } });
}

export async function sendScheduledReminder(client, isReady) {
  if (!state.enabled) return console.log('Reminder sedang dimatikan oleh admin.');
  if (!isReady) return console.warn('WhatsApp belum siap, reminder dilewati.');
  if (!TARGET_GROUP) return console.warn('WA_GROUP_ID belum diatur, reminder dilewati.');
  const today = jakartaDate();
  if (state.lastDateSent === today) return console.log('Reminder hari ini sudah dikirim.');
  try {
    await kirimReminderDenganTagSemua(client, TARGET_GROUP, reminderText());
    state.lastDateSent = today;
    saveState();
    console.log(`Reminder berhasil dijalankan untuk ${today} 14:30 WIB`);
  } catch (error) {
    console.error('Gagal mengirim reminder:', error.message);
  }
}

