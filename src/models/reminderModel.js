// Model reminder: migrasi data lama, validasi, penyimpanan, dan pengiriman pesan.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import cron from 'node-cron';
import { TZ, REMINDER_CRON, TARGET_GROUP, stateDir, stateFile, remindersFile, messageFile } from '../config.js';

const MAX_NAME = 80;
const MAX_TEXT = 10000;

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

// Jika belum ada data baru, isi berkas lama dipakai sebagai reminder pertama.
function initialReminder() {
  let text = '';
  try { text = fs.readFileSync(messageFile, 'utf8').trim(); } catch { /* Berkas lama boleh belum tersedia. */ }
  return [{ id: 'default-reminder', name: 'Pengingat bawaan', cron: REMINDER_CRON, text: text, enabled: true, lastSentAt: null }];
}

function loadReminders() {
  try {
    const savedData = JSON.parse(fs.readFileSync(remindersFile, 'utf8'));
    return Array.isArray(savedData) ? savedData.map(reminder => ({
      id: String(reminder.id || randomUUID()),
      name: String(reminder.name || 'Pengingat baru').slice(0, MAX_NAME),
      cron: String(reminder.cron || REMINDER_CRON),
      text: String(reminder.text || '').slice(0, MAX_TEXT),
      enabled: reminder.enabled !== false,
      lastSentAt: reminder.lastSentAt || null
    })) : initialReminder();
  } catch {
    return initialReminder();
  }
}

let reminders = loadReminders();

function persistReminders() {
  fs.mkdirSync(stateDir, { recursive: true });
  const temporaryFile = `${remindersFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(reminders, null, 2), 'utf8');
  fs.renameSync(temporaryFile, remindersFile);
}

function validateReminder(input) {
  const name = String(input?.name || '').trim();
  const cronExpression = String(input?.cron || '').trim();
  const text = String(input?.text || '').trim();
  if (!name || name.length > MAX_NAME) throw new Error(`Nama harus 1–${MAX_NAME} karakter.`);
  if (!cronExpression || !cron.validate(cronExpression)) throw new Error('Ekspresi cron tidak valid.');
  if (!text || text.length > MAX_TEXT) throw new Error(`Isi reminder harus 1–${MAX_TEXT} karakter.`);
  return { name: name, cron: cronExpression, text: text, enabled: input.enabled !== false };
}

export function getReminders() {
  return reminders.map(reminder => ({ ...reminder }));
}

export function getReminderById(reminderId) {
  const reminder = reminders.find(reminder => reminder.id === reminderId);
  return reminder ? { ...reminder } : null;
}

export function createReminder(input) {
  const reminder = { id: randomUUID(), ...validateReminder(input), lastSentAt: null };
  reminders.push(reminder);
  persistReminders();
  return { ...reminder };
}

export function updateReminder(reminderId, input) {
  const index = reminders.findIndex(reminder => reminder.id === reminderId);
  if (index === -1) return null;
  reminders[index] = { ...reminders[index], ...validateReminder(input) };
  persistReminders();
  return { ...reminders[index] };
}

export function deleteReminder(reminderId) {
  const index = reminders.findIndex(reminder => reminder.id === reminderId);
  if (index === -1) return false;
  reminders.splice(index, 1);
  persistReminders();
  return true;
}

export function reminderText() {
  return reminders.find(reminder => reminder.enabled)?.text || reminders[0]?.text || '';
}

export function sendReminderWithAllTag(client, chatId, text) {
  if (!/@(?:semua|all)\b/i.test(text)) return client.sendMessage(chatId, text);
  // whatsapp-web.js memakai nonJidMentions=1 untuk menyebut seluruh anggota.
  const body = text.replace(/@(?:semua|all)\b/gi, '@all');
  return client.sendMessage(chatId, body, { extra: { nonJidMentions: 1 } });
}

// Setiap tugas cron mengirim pengingatnya sendiri selama status global dan item aktif.
export async function sendScheduledReminder(client, isReady, reminderId) {
  const reminder = getReminderById(reminderId);
  if (!reminder || !reminder.enabled) return;
  if (!state.enabled) return console.log('Semua reminder sedang dimatikan operator.');
  if (!isReady) return console.warn(`WhatsApp belum siap; reminder "${reminder.name}" dilewati.`);
  if (!TARGET_GROUP) return console.warn('WA_GROUP_ID belum diatur, reminder dilewati.');
  try {
    await sendReminderWithAllTag(client, TARGET_GROUP, reminder.text);
    const index = reminders.findIndex(storedReminder => storedReminder.id === reminder.id);
    if (index !== -1) {
      reminders[index].lastSentAt = new Date().toISOString();
      persistReminders();
    }
    console.log(`Pengingat "${reminder.name}" terkirim (${reminder.cron}, ${TZ}).`);
  } catch (error) {
    console.error(`Gagal mengirim reminder "${reminder.name}":`, error.message);
  }
}
