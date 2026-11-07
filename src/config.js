import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
export const authDir = path.resolve(process.env.WA_AUTH_DIR?.trim() || path.join(APP_DIR, '.wwebjs_auth'));
export const stateFile = path.join(stateDir, 'reminder.json');
export const remindersFile = path.join(stateDir, 'reminders.json');
export const messageFile = path.join(APP_DIR, 'reminder.txt');
export const aiMemoryFile = path.join(stateDir, 'ai-memory.json');
export const botMentionIdsFile = path.join(stateDir, 'bot-mention-ids.json');

const defaultWindowsChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() ||
  (process.platform === 'win32' && fs.existsSync(defaultWindowsChrome) ? defaultWindowsChrome : '');
export const puppeteerOptions = {
  headless: true,
  ...(chromePath ? { executablePath: chromePath } : {}),
  ...(process.env.PUPPETEER_NO_SANDBOX === '1' ? { args: ['--no-sandbox', '--disable-setuid-sandbox'] } : {})
};

export function validateConfig() {
  if (!['gemini', 'openai'].includes(AI_PROVIDER)) {
    throw new Error('AI_PROVIDER harus bernilai "gemini" atau "openai".');
  }
  if (!AI_API_KEY || AI_API_KEY.startsWith('isi_api_key_')) {
    throw new Error('AI_API_KEY belum diisi. Ubah file .env atau environment layanan.');
  }
  if (TARGET_GROUP && !TARGET_GROUP.endsWith('@g.us')) {
    throw new Error('WA_GROUP_ID harus berakhiran @g.us');
  }
}
