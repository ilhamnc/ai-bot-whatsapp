// Layanan AI: provider, fallback model, antrean permintaan, dan status kuota.
import { GoogleGenAI } from '@google/genai';
import {
  AI_API_KEY, AI_BASE_URL, AI_MODELS, AI_PROVIDER, TZ, MAX_MODEL_PER_REQUEST
} from '../config.js';

const cooldowns = new Map();
const dailyLimits = new Map();
const lastSuccessfulModel = { chat: null, ringkasan: null };
const aiJobs = [];
let runningJobs = 0;
let geminiClient;

export const AI_PROVIDER_NAME = AI_PROVIDER === 'gemini' ? 'Gemini' : 'OpenAI-compatible';
export const DAILY_LIMIT_MESSAGE = 'Batas penggunaan AI hari ini sudah tercapai. Coba lagi setelah kuota layanan direset.';

export function runAiJob(task) {
  return new Promise((resolve, reject) => {
    const start = () => {
      runningJobs++;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        runningJobs--;
        aiJobs.shift()?.();
      });
    };
    if (runningJobs < 1) start();
    else aiJobs.push(start);
  });
}

function todayInPacific() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function isDailyLimitReached(model) {
  return dailyLimits.get(model) === todayInPacific();
}

function isCoolingDown(model) {
  return Date.now() < (cooldowns.get(model) || 0);
}

function errorInfo(error) {
  const raw = [error?.message, error?.status, error?.code, error?.details]
    .filter(Boolean).join(' ');
  const code = Number(error?.status || error?.code || 0)
    || Number(raw.match(/\b(400|401|403|404|408|429|500|502|503|504)\b/)?.[1] || 0);
  const daily = code === 429 && /(?:per[ _-]?day|requests? per day|tokens? per day|\brpd\b|daily|quota_exceeded)/i.test(raw)
    && !/(?:per[ _-]?minute|\brpm\b|\btpm\b)/i.test(raw);
  return { code, daily, raw };
}

export function describeAiError(error) {
  return errorInfo(error);
}

export function formatTimeWib(timestamp) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TZ, dateStyle: 'short', timeStyle: 'medium'
  }).format(new Date(timestamp)) + ' WIB';
}

export function getLastSuccessfulModel() {
  return lastSuccessfulModel;
}

export function getNextModelCandidate() {
  return AI_MODELS.find(model => !isDailyLimitReached(model) && !isCoolingDown(model)) || null;
}

export function getModelStatus() {
  return AI_MODELS.map(model => {
    const status = isDailyLimitReached(model) ? 'batas harian terdeteksi'
      : isCoolingDown(model) ? 'jeda sementara' : 'siap dicoba';
    return `${model}: ${status}`;
  }).join('\n');
}

function geminiOptions(model, config, attempt) {
  const thinkingConfig = model.startsWith('gemini-2.5-')
    ? { thinkingBudget: 0 }
    : { thinkingLevel: model === 'gemini-3.8-flash' ? 'low' : 'minimal' };
  return {
    ...config,
    thinkingConfig,
    httpOptions: {
      ...config.httpOptions,
      timeout: attempt === 1 ? (config.httpOptions?.timeout ?? 18000) : 12000,
      retryOptions: { attempts: 1 }
    }
  };
}

function getTextParts(parts = []) {
  return parts.map(part => typeof part === 'string' ? part : part?.text || '').join('');
}

function toOpenAiMessages(contents, systemInstruction) {
  const messages = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  if (typeof contents === 'string') {
    messages.push({ role: 'user', content: contents });
  } else {
    for (const item of contents || []) {
      const role = item.role === 'model' || item.role === 'assistant' ? 'assistant' : 'user';
      const content = Array.isArray(item.parts) ? getTextParts(item.parts) : String(item.content || '');
      if (content) messages.push({ role, content });
    }
  }
  return messages;
}

async function generateWithGemini(model, contents, config, attempt) {
  geminiClient ||= new GoogleGenAI({ apiKey: AI_API_KEY });
  return geminiClient.models.generateContent({ model, contents, config: geminiOptions(model, config, attempt) });
}

async function generateWithOpenAiCompatible(model, contents, config) {
  const response = await fetch(`${AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${AI_API_KEY}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(config.httpOptions?.timeout ?? 18000),
    body: JSON.stringify({
      model,
      messages: toOpenAiMessages(contents, config.systemInstruction),
      max_tokens: config.maxOutputTokens ?? 4000
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || `AI service returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const choice = payload.choices?.[0] || {};
  return {
    text: typeof choice.message?.content === 'string' ? choice.message.content : '',
    usageMetadata: {
      promptTokenCount: payload.usage?.prompt_tokens,
      candidatesTokenCount: payload.usage?.completion_tokens,
      thoughtsTokenCount: undefined
    }
  };
}

export async function generateWithFallback({ contents, config = {}, purpose = 'chat' }) {
  let lastError;
  let attempted = 0;
  for (const model of AI_MODELS) {
    if (isDailyLimitReached(model) || isCoolingDown(model)) continue;
    if (attempted >= MAX_MODEL_PER_REQUEST) break;
    attempted++;
    try {
      const result = AI_PROVIDER === 'gemini'
        ? await generateWithGemini(model, contents, config, attempted)
        : await generateWithOpenAiCompatible(model, contents, config);
      if (String(result?.text || '').trim()) {
        if (purpose in lastSuccessfulModel) lastSuccessfulModel[purpose] = { model, at: Date.now() };
      }
      console.log(`[AI] ${purpose}: berhasil dengan ${model} (${AI_PROVIDER_NAME})`);
      return { result, model };
    } catch (error) {
      lastError = error;
      const { code, daily, raw } = errorInfo(error);
      if (daily) dailyLimits.set(model, todayInPacific());
      else if (code === 429) cooldowns.set(model, Date.now() + 60_000);
      else if ([408, 500, 502, 503, 504].includes(code) || /timeout|UNAVAILABLE|AbortError/i.test(raw)) {
        cooldowns.set(model, Date.now() + 30_000);
      } else if (code === 403 || code === 404) cooldowns.set(model, Date.now() + 12 * 60 * 60_000);
      else throw error;
      console.warn(`[AI] ${purpose}: ${model} gagal (${code || 'error'}); mencoba model berikutnya bila tersedia.`);
    }
  }

  const allDaily = AI_MODELS.every(isDailyLimitReached);
  const allUnavailable = AI_MODELS.every(model => isDailyLimitReached(model) || isCoolingDown(model));
  if (!lastError) {
    const error = new Error('Semua model sedang jeda atau tidak dapat dicoba.');
    error.allModelsUnavailable = true;
    error.allModelsDaily = allDaily;
    throw error;
  }
  lastError.allModelsDaily = allDaily;
  lastError.allModelsUnavailable = allUnavailable;
  throw lastError;
}

