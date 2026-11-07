// Model reminder: migrasi data lama, validasi, penyimpanan, dan pengiriman pesan.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import cron from 'node-cron';
import { TZ, REMINDER_CRON, TARGET_GROUP, stateDir, stateFile, remindersFile, messageFile } from '../config.js';
import { generateWithFallback, runAiJob } from '../services/aiService.js';

const MAX_NAME = 80;
const MAX_TEXT = 10000;
const MAX_DAILY_TIMES = 10;

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
  return [{ id: 'default-reminder', name: 'Pengingat bawaan', cron: REMINDER_CRON, cronExpressions: [REMINDER_CRON], text: text, enabled: true, lastSentAt: null }];
}

function loadReminders() {
  try {
    const savedData = JSON.parse(fs.readFileSync(remindersFile, 'utf8'));
    return Array.isArray(savedData) ? savedData.map(reminder => {
      // Baca cron tunggal dari data lama dan migrasikan ke daftar jadwal.
      const savedSchedules = Array.isArray(reminder.cronExpressions)
        ? reminder.cronExpressions.map(expression => String(expression)).filter(Boolean)
        : [];
      const cronExpressions = savedSchedules.length
        ? savedSchedules
        : [String(reminder.cron || REMINDER_CRON)];
      return {
        id: String(reminder.id || randomUUID()),
        name: String(reminder.name || 'Pengingat baru').slice(0, MAX_NAME),
        cron: cronExpressions[0] || REMINDER_CRON,
        cronExpressions,
        text: String(reminder.text || '').slice(0, MAX_TEXT),
        enabled: reminder.enabled !== false,
        lastSentAt: reminder.lastSentAt || null
      };
    }) : initialReminder();
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
  const cronExpressions = (Array.isArray(input?.cronExpressions)
    ? input.cronExpressions
    : [input?.cron]).map(expression => String(expression || '').trim());
  const text = String(input?.text || '').trim();
  if (!name || name.length > MAX_NAME) throw new Error(`Nama harus 1–${MAX_NAME} karakter.`);
  if (!cronExpressions.length || cronExpressions.length > MAX_DAILY_TIMES) {
    throw new Error(`Tambahkan 1–${MAX_DAILY_TIMES} waktu pengingat.`);
  }
  if (cronExpressions.some(expression => !cron.validate(expression))) throw new Error('Jadwal pengingat tidak valid.');
  if (new Set(cronExpressions).size !== cronExpressions.length) throw new Error('Waktu pengingat tidak boleh duplikat.');
  if (!text || text.length > MAX_TEXT) throw new Error(`Isi reminder harus 1–${MAX_TEXT} karakter.`);
  return { name: name, cron: cronExpressions[0], cronExpressions, text: text, enabled: input.enabled !== false };
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

function getMentionTokens(text) {
  return (String(text).match(/@[A-Za-z0-9._-]+/g) || []).map(token => token.toLowerCase()).sort();
}

// Variasikan kalimat reminder tanpa mengubah isi penting atau token mention.
async function rewriteReminderWithAi(text) {
  const prompt = `Tulis ulang teks reminder berikut dalam bahasa Indonesia Gen Z yang akrab, natural, dan ringkas (1–3 kalimat). Buat susunan kalimat yang terasa bervariasi setiap kali diminta. Pertahankan makna, nama, angka, waktu, tautan, instruksi, dan semua token @mention secara persis. Jangan menambah fakta, janji, atau instruksi baru. Keluarkan hanya teks reminder hasil penulisan ulang, tanpa pengantar atau tanda kutip.\n\nTeks reminder:\n${text}`;
  const { result } = await runAiJob(() => generateWithFallback({
    purpose: 'reminder',
    contents: prompt,
    config: {
      systemInstruction: 'Kamu adalah editor pesan reminder. Ikuti batasan prompt, pertahankan konteks dan token @mention secara persis, lalu keluarkan hanya hasil akhir.',
      thinkingConfig: { thinkingLevel: 'minimal' },
      maxOutputTokens: 900,
      httpOptions: { timeout: 18000, retryOptions: { attempts: 1 } }
    }
  }));
  const rewrittenText = String(result?.text || '').trim();
  if (!rewrittenText) throw new Error('AI tidak menghasilkan teks reminder.');
  if (JSON.stringify(getMentionTokens(text)) !== JSON.stringify(getMentionTokens(rewrittenText))) {
    throw new Error('AI mengubah token mention pada teks reminder.');
  }
  return rewrittenText;
}

// Setiap tugas cron mengirim pengingatnya sendiri selama status global dan item aktif.
export async function sendScheduledReminder(client, isReady, reminderId) {
  const reminder = getReminderById(reminderId);
  if (!reminder || !reminder.enabled) return;
  if (!state.enabled) return console.log('Semua reminder sedang dimatikan operator.');
  if (!isReady) return console.warn(`WhatsApp belum siap; reminder "${reminder.name}" dilewati.`);
  if (!TARGET_GROUP) return console.warn('WA_GROUP_ID belum diatur, reminder dilewati.');
  try {
    let outgoingText = reminder.text;
    try {
      outgoingText = await rewriteReminderWithAi(reminder.text);
      console.log(`[AI] Reminder "${reminder.name}" berhasil divariasikan.`);
    } catch (error) {
      console.warn(`[AI] Reminder "${reminder.name}" memakai teks bawaan: ${error.message}`);
    }
    await sendReminderWithAllTag(client, TARGET_GROUP, outgoingText);
    const index = reminders.findIndex(storedReminder => storedReminder.id === reminder.id);
    if (index !== -1) {
      reminders[index].lastSentAt = new Date().toISOString();
      persistReminders();
    }
    console.log(`Pengingat "${reminder.name}" terkirim (${reminder.cronExpressions.join(' | ')}, ${TZ}).`);
  } catch (error) {
    console.error(`Gagal mengirim reminder "${reminder.name}":`, error.message);
  }
}
