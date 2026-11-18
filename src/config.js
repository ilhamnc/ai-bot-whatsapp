import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEncryptionKey } from './services/encryptionService.js';

export const APP_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const TZ = 'Asia/Jakarta';
export const REMINDER_CRON = '30 14 * * 1-5';
export const TARGET_GROUP = process.env.WA_GROUP_ID?.trim() || '';
export const AI_PROVIDER = (process.env.AI_PROVIDER?.trim() || 'groq').toLowerCase();
const legacyGeminiConfig = AI_PROVIDER === 'gemini';
const legacyAiKey = process.env.AI_API_KEY?.trim() || '';
export const GROQ_API_KEY = process.env.GROQ_API_KEY?.trim() || '';
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() || (legacyGeminiConfig ? legacyAiKey : '');
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() || (AI_PROVIDER === 'openai' ? legacyAiKey : '');
export const AI_API_KEY = AI_PROVIDER === 'groq' ? GROQ_API_KEY
  : AI_PROVIDER === 'gemini' ? GEMINI_API_KEY : OPENAI_API_KEY;
export const AI_BASE_URL = process.env.AI_BASE_URL?.trim() ||
  (AI_PROVIDER === 'gemini' ? '' : AI_PROVIDER === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1');
const legacyGroqBaseUrl = process.env.AI_BASE_URL?.trim() || '';
export const GROQ_BASE_URL = process.env.GROQ_BASE_URL?.trim() ||
  (AI_PROVIDER === 'groq' && /^https:\/\/api\.groq\.com(?:\/|$)/i.test(legacyGroqBaseUrl)
    ? legacyGroqBaseUrl : 'https://api.groq.com/openai/v1');
export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL?.trim() ||
  (AI_PROVIDER === 'openai' && process.env.AI_BASE_URL?.trim() ? process.env.AI_BASE_URL.trim() : 'https://api.openai.com/v1');

// Urutan default mengutamakan model chat yang paling mampu. Model klasifikasi,
// speech-to-text, dan TTS tidak dimasukkan karena bukan model percakapan teks.
const groqModelDefaults = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
const groqLowPriorityDefaults = ['allam-2-7b'];
const geminiModelDefaults = [
  'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'
];
const deprecatedGroqModels = new Set(['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'qwen/qwen3.6-27b']);
const configuredLegacyPrimary = process.env.AI_MODEL?.trim() || '';
const configuredGeminiModel = process.env.GEMINI_MODEL?.trim() || (legacyGeminiConfig ? process.env.AI_MODEL?.trim() : '');
const configuredPrimaryModel = (AI_PROVIDER === 'groq' && deprecatedGroqModels.has(configuredLegacyPrimary.toLowerCase())
  ? '' : configuredLegacyPrimary) ||
  (legacyGeminiConfig ? process.env.GEMINI_MODEL?.trim() : '') ||
  (AI_PROVIDER === 'groq' ? groqModelDefaults[0] : AI_PROVIDER === 'openai' ? 'gpt-4o-mini' : geminiModelDefaults[0]);
const configuredFallbacks = (process.env.AI_FALLBACK_MODELS || (legacyGeminiConfig ? process.env.GEMINI_FALLBACK_MODELS : '') || '')
  .split(',').map(value => value.trim()).filter(value => value && !deprecatedGroqModels.has(value.toLowerCase()));

function inferModelProvider(model, preferredProvider = AI_PROVIDER) {
  const value = String(model || '').trim();
  if (/^gemini-/i.test(value)) return 'gemini';
  if (/^(?:gpt-|o[134](?:-|$))/i.test(value)) return 'openai';
  if (/^openai\/gpt-oss-/i.test(value) || /^qwen\//i.test(value) || /^allam-/i.test(value)) return 'groq';
  return preferredProvider;
}

function uniqueModels(models) {
  return [...new Set(models.filter(Boolean))];
}

function getDefaultModelOrder() {
  const custom = { groq: [], gemini: [], openai: [] };
  for (const model of configuredFallbacks) custom[inferModelProvider(model)].push(model);
  const configuredModelProvider = inferModelProvider(configuredPrimaryModel);
  const modelForProvider = {
    groq: uniqueModels([AI_PROVIDER === 'groq' && configuredModelProvider === 'groq' ? configuredPrimaryModel : '', ...groqModelDefaults, ...custom.groq, ...groqLowPriorityDefaults]),
    gemini: uniqueModels([
      AI_PROVIDER === 'gemini' && configuredModelProvider === 'gemini' ? configuredPrimaryModel : '',
      configuredGeminiModel, ...geminiModelDefaults, ...custom.gemini
    ]),
    openai: uniqueModels([AI_PROVIDER === 'openai' && configuredModelProvider === 'openai' ? configuredPrimaryModel : '', ...custom.openai])
  };
  const providers = AI_PROVIDER === 'gemini' ? ['gemini', 'groq', 'openai']
    : AI_PROVIDER === 'openai' ? ['openai', 'groq', 'gemini']
      : ['groq', 'gemini', 'openai'];
  const ordered = providers.flatMap(provider => modelForProvider[provider].map(model => ({ provider, model })));
  if (AI_PROVIDER === 'groq') {
    const lowPriorityGroq = ordered.filter(candidate => candidate.provider === 'groq' && groqLowPriorityDefaults.includes(candidate.model));
    return [...ordered.filter(candidate => !lowPriorityGroq.includes(candidate)), ...lowPriorityGroq];
  }
  return ordered;
}

function parseModelOrder() {
  const configuredOrder = process.env.AI_MODEL_ORDER?.trim();
  if (!configuredOrder) return getDefaultModelOrder();
  return configuredOrder.split(',').map(item => {
    const separator = item.indexOf(':');
    if (separator < 1) return null;
    const provider = item.slice(0, separator).trim().toLowerCase();
    const model = item.slice(separator + 1).trim();
    return ['groq', 'gemini', 'openai'].includes(provider) && model ? { provider, model } : null;
  }).filter(Boolean);
}

const visionGroqModels = new Set(['qwen/qwen3.8-27b']);
export const AI_MODEL_CANDIDATES = parseModelOrder().filter((candidate, index, all) =>
  all.findIndex(item => item.provider === candidate.provider && item.model === candidate.model) === index)
  .map(candidate => ({
    ...candidate,
    id: `${candidate.provider}:${candidate.model}`,
    supportsImage: candidate.provider === 'gemini' || visionGroqModels.has(candidate.model)
  }));
export const AI_MODELS = AI_MODEL_CANDIDATES.map(candidate => candidate.id);
export const AI_MODEL = AI_MODEL_CANDIDATES[0]?.model || configuredPrimaryModel;
export const AI_FALLBACK_MODELS = AI_MODEL_CANDIDATES.slice(1).map(candidate => candidate.model);
// Fallback berurutan memang mencoba seluruh model; jangan biarkan nilai lama
// MAX_MODEL_PER_REQUEST=3 menghentikan rantai sebelum sampai ke kandidat Gemini.
export const MAX_MODEL_PER_REQUEST = Math.max(1, Math.min(12, AI_MODEL_CANDIDATES.length || 1));

export function getProviderApiKey(provider) {
  if (provider === 'groq') return GROQ_API_KEY;
  if (provider === 'gemini') return GEMINI_API_KEY;
  if (provider === 'openai') return OPENAI_API_KEY;
  return '';
}

export function getProviderBaseUrl(provider) {
  if (provider === 'groq') return GROQ_BASE_URL;
  if (provider === 'openai') return OPENAI_BASE_URL;
  return '';
}

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
  if (!['gemini', 'openai', 'groq'].includes(AI_PROVIDER)) {
    errors.push('AI_PROVIDER harus bernilai "gemini", "openai", atau "groq".');
  }
  if (!AI_MODEL_CANDIDATES.length) {
    errors.push('AI_MODEL_ORDER tidak berisi kandidat valid. Gunakan format provider:model, misalnya groq:openai/gpt-oss-120b.');
  }
  const hasUsableAiKey = AI_MODEL_CANDIDATES.some(candidate => {
    const key = getProviderApiKey(candidate.provider);
    return key && !key.startsWith('isi_api_key_');
  });
  if (!hasUsableAiKey) {
    errors.push('Isi minimal satu API key provider dalam urutan model: GROQ_API_KEY untuk Groq atau GEMINI_API_KEY untuk Gemini.');
  }
  try {
    validateEncryptionKey();
  } catch (error) {
    errors.push(error.message);
  }
  if (TARGET_GROUP && !TARGET_GROUP.endsWith('@g.us')) {
    errors.push('WA_GROUP_ID harus berakhiran @g.us. Kosongkan jika grup dipilih lewat dashboard atau !idgrup.');
  }
  for (const provider of new Set(AI_MODEL_CANDIDATES.map(candidate => candidate.provider))) {
    if (provider === 'gemini') continue;
    const baseUrl = getProviderBaseUrl(provider);
    let parsedUrl;
    try { parsedUrl = new URL(baseUrl); }
    catch { errors.push(`${provider.toUpperCase()}_BASE_URL harus berupa URL yang valid.`); }
    if (parsedUrl && parsedUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsedUrl.hostname)) {
      errors.push(`${provider.toUpperCase()}_BASE_URL untuk host eksternal wajib memakai HTTPS agar kunci API tidak terkirim tanpa enkripsi.`);
    }
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
