import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEncryptionKey } from './services/encryptionService.js';

export const APP_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const TZ = 'Asia/Jakarta';
export const REMINDER_CRON = '30 14 * * 1-5';
export const TARGET_GROUP = process.env.WA_GROUP_ID?.trim() || '';
export const AI_PROVIDER = (process.env.AI_PROVIDER?.trim() || 'gemini').toLowerCase();
const legacyGeminiConfig = AI_PROVIDER === 'gemini';
export const AI_API_KEY = process.env.AI_API_KEY?.trim() ||
  (legacyGeminiConfig ? process.env.GEMINI_API_KEY?.trim() : '') || '';
const defaultModel = AI_PROVIDER === 'openai' ? 'gpt-4o-mini' : 'gemini-3.5-flash-lite';
export const AI_MODEL = process.env.AI_MODEL?.trim() ||
  (legacyGeminiConfig ? process.env.GEMINI_MODEL?.trim() : '') || defaultModel;
export const AI_BASE_URL = process.env.AI_BASE_URL?.trim() || 'https://api.openai.com/v1';
const defaultFallbackModels = AI_PROVIDER === 'openai'
  ? 'gpt-4o-mini'
  : 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash,gemini-3-flash-preview,gemini-2.5-flash,gemini-2.5-flash-lite';
const legacyFallbackModels = legacyGeminiConfig ? process.env.GEMINI_FALLBACK_MODELS : '';
export const AI_FALLBACK_MODELS = (process.env.AI_FALLBACK_MODELS || legacyFallbackModels || defaultFallbackModels)
  .split(',').map(value => value.trim()).filter(Boolean);
export const AI_MODELS = [...new Set([AI_MODEL, ...AI_FALLBACK_MODELS])];
export const MAX_MODEL_PER_REQUEST = Math.max(1, Math.min(7, Number(process.env.MAX_MODEL_PER_REQUEST) || 3));

// Default ini mempertahankan lokasi data dari versi sebelumnya.
export const stateDir = path.resolve(process.env.BOT_STATE_DIR?.trim() || path.join(APP_DIR, '.state'));
export const authDir = path.resolve(process.env.WA_AUTH_DIR?.trim() || path.join(APP_DIR, '.wa_auth'));
export const stateFile = path.join(stateDir, 'reminder.json');
export const remindersFile = path.join(stateDir, 'reminders.json');
export const messageFile = path.join(APP_DIR, 'reminder.txt');
export const aiMemoryFile = path.join(stateDir, 'ai-memory.json');
export const botMentionIdsFile = path.join(stateDir, 'bot-mention-ids.json');

export function validateConfig() {
  const errors = [];
  if (!['gemini', 'openai'].includes(AI_PROVIDER)) {
    errors.push('AI_PROVIDER harus bernilai "gemini" atau "openai".');
  }
  if (!AI_API_KEY || AI_API_KEY.startsWith('isi_api_key_')) {
    errors.push('AI_API_KEY belum diisi. Tambahkan secret AI_API_KEY di .env atau environment layanan.');
  }
  try {
    validateEncryptionKey();
  } catch (error) {
    errors.push(error.message);
  }
  if (TARGET_GROUP && !TARGET_GROUP.endsWith('@g.us')) {
    errors.push('WA_GROUP_ID harus berakhiran @g.us. Kosongkan jika grup dipilih lewat dashboard atau !idgrup.');
  }
  let aiUrl;
  try { aiUrl = new URL(AI_BASE_URL); }
  catch { errors.push('AI_BASE_URL harus berupa URL yang valid.'); }
  if (aiUrl && aiUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(aiUrl.hostname)) {
    errors.push('AI_BASE_URL untuk host eksternal wajib memakai HTTPS agar kunci API tidak terkirim tanpa enkripsi.');
  }

  // Validasi dashboard publik digabung agar startup menampilkan semua kesalahan sekaligus.
  const dashboardHost = process.env.DASHBOARD_HOST?.trim() || '127.0.0.1';
  const dashboardUser = process.env.DASHBOARD_USER?.trim() || '';
  const dashboardPassword = process.env.DASHBOARD_PASSWORD || '';
  const dashboardIsLocal = ['127.0.0.1', '::1', 'localhost'].includes(dashboardHost);
  if ((dashboardUser && !dashboardPassword) || (!dashboardUser && dashboardPassword)) {
    errors.push('DASHBOARD_USER dan DASHBOARD_PASSWORD harus diisi bersama.');
  }
  if (!dashboardIsLocal && !dashboardUser) {
    errors.push('Dashboard menerima koneksi luar. Isi DASHBOARD_USER dan DASHBOARD_PASSWORD.');
  }
  if (!dashboardIsLocal && dashboardPassword.length < 16) {
    errors.push('DASHBOARD_PASSWORD untuk akses dari luar harus memiliki minimal 16 karakter.');
  }

  if (errors.length) {
    throw new Error(errors.map(message => `- ${message}`).join('\n'));
  }
}
