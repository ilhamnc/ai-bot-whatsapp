// Layanan AI: antrean, pembatasan sementara, adapter provider, dan pemilihan model cadangan.
import { GoogleGenAI } from '@google/genai';
import {
  AI_MODEL_CANDIDATES, AI_PROVIDER, TZ, MAX_MODEL_PER_REQUEST,
  getProviderApiKey, getProviderBaseUrl
} from '../config.js';

const cooldowns = new Map();
const dailyLimits = new Map();
const providerCooldowns = new Map();
const lastSuccessfulModel = { chat: null, ringkasan: null, reminder: null };
const aiJobs = [];
let runningJobs = 0;
const geminiClients = new Map();

const providerNames = [...new Set(AI_MODEL_CANDIDATES.map(candidate => candidate.provider))]
  .map(provider => provider === 'openai' ? 'OpenAI' : provider[0].toUpperCase() + provider.slice(1));
export const AI_PROVIDER_NAME = providerNames.join(' → ') || AI_PROVIDER;
export const DAILY_LIMIT_MESSAGE = 'Batas penggunaan AI hari ini sudah tercapai. Coba lagi setelah kuota layanan direset.';

// Membatasi satu permintaan AI aktif agar memori bersama tidak berubah bersamaan.
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
  const get = type => parts.find(bagian => bagian.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function isDailyLimitReached(model) {
  return dailyLimits.get(model) === todayInPacific();
}

function isCoolingDown(model) {
  return Date.now() < (cooldowns.get(model) || 0);
}

function isProviderCoolingDown(provider) {
  return Date.now() < (providerCooldowns.get(provider) || 0);
}

function errorInfo(error) {
  const raw = [error?.message, error?.status, error?.code, error?.details, error?.name]
    .filter(Boolean).join(' ');
  const symbolicCode = /RESOURCE_EXHAUSTED|RATE_LIMIT/i.test(raw) ? 429
    : /UNAUTHENTICATED|API_KEY_INVALID/i.test(raw) ? 401
      : /PERMISSION_DENIED/i.test(raw) ? 403
        : /NOT_FOUND/i.test(raw) ? 404
          : /INVALID_ARGUMENT/i.test(raw) ? 400
            : /UNAVAILABLE/i.test(raw) ? 503 : 0;
  const code = Number(error?.status || error?.code || 0)
    || Number(raw.match(/\b(400|401|402|403|404|408|413|429|500|502|503|504)\b/)?.[1] || 0)
    || symbolicCode;
  const daily = code === 429 && /(?:per[ _-]?day|requests? per day|tokens? per day|\brpd\b|daily|quota_exceeded)/i.test(raw)
    && !/(?:per[ _-]?minute|\brpm\b|\btpm\b)/i.test(raw);
  return { code: code, daily: daily, raw: raw };
}

function safeErrorSummary(raw) {
  return String(raw || '')
    .replace(/data:image\/[^;\s]+;base64,[A-Za-z0-9+/=]+/gi, '[gambar base64]')
    .replace(/\b(?:Bearer\s+|gsk_|AIza|sk-)[A-Za-z0-9._-]{12,}/gi, '[redacted credential]')
    .replace(/\s+/g, ' ')
    .slice(0, 320);
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
  const candidate = AI_MODEL_CANDIDATES.find(item => getProviderApiKey(item.provider)
    && !isDailyLimitReached(item.id) && !isCoolingDown(item.id) && !isProviderCoolingDown(item.provider));
  return candidate?.id || null;
}

export function getModelStatus() {
  return AI_MODEL_CANDIDATES.map(candidate => {
    const status = !getProviderApiKey(candidate.provider) ? 'API key belum diatur'
      : isDailyLimitReached(candidate.id) ? 'batas harian terdeteksi'
        : isProviderCoolingDown(candidate.provider) || isCoolingDown(candidate.id) ? 'jeda sementara'
          : isCoolingDown(`${candidate.id}:image`) ? 'jeda gambar' : 'siap dicoba';
    return `${candidate.id}: ${status}${candidate.supportsImage ? ' · gambar' : ''}`;
  }).join('\n');
}

function geminiOptions(model, config, attempt) {
  const thinkingConfig = model.startsWith('gemini-2.5-')
    ? { thinkingBudget: 0 }
    : { thinkingLevel: /^gemini-3\.[78]-flash$/.test(model) ? 'low' : 'minimal' };
  return {
    ...config,
    thinkingConfig: thinkingConfig,
    httpOptions: {
      ...config.httpOptions,
      timeout: attempt === 1 ? (config.httpOptions?.timeout ?? 18000) : 12000,
      retryOptions: { attempts: 1 }
    }
  };
}

function toOpenAiContent(parts = []) {
  const content = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      if (part) content.push({ type: 'text', text: part });
    } else if (part?.text) {
      content.push({ type: 'text', text: part.text });
    } else if (part?.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || 'image/jpeg';
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${part.inlineData.data}` }
      });
    }
  }
  if (!content.some(part => part.type === 'image_url')) {
    return content.map(part => part.text).join('');
  }
  return content;
}

function toOpenAiMessages(contents, systemInstruction) {
  const messages = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  if (typeof contents === 'string') {
    messages.push({ role: 'user', content: contents });
  } else {
    for (const item of contents || []) {
      const role = item.role === 'model' || item.role === 'assistant' ? 'assistant' : 'user';
      const content = Array.isArray(item.parts) ? toOpenAiContent(item.parts) : String(item.content || '');
      if (content) messages.push({ role: role, content: content });
    }
  }
  return messages;
}

function getGeminiClient(apiKey) {
  if (!geminiClients.has(apiKey)) geminiClients.set(apiKey, new GoogleGenAI({ apiKey }));
  return geminiClients.get(apiKey);
}

async function generateWithGemini(candidate, contents, config, attempt, apiKey) {
  return getGeminiClient(apiKey).models.generateContent({
    model: candidate.model,
    contents: contents,
    config: geminiOptions(candidate.model, config, attempt)
  });
}

async function generateWithOpenAiCompatible(candidate, contents, config, apiKey, attempt) {
  const baseUrl = getProviderBaseUrl(candidate.provider);
  const configuredTimeout = config.httpOptions?.timeout ?? 18000;
  const timeout = attempt === 1 ? configuredTimeout : Math.min(configuredTimeout, 12000);
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(timeout),
    body: JSON.stringify({
      model: candidate.model,
      messages: toOpenAiMessages(contents, config.systemInstruction),
      ...(candidate.provider === 'groq'
        ? { max_completion_tokens: config.maxOutputTokens ?? 4000 }
        : { max_tokens: config.maxOutputTokens ?? 4000 })
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || `Layanan AI mengembalikan HTTP ${response.status}`);
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

// Mencoba model sesuai urutan dan melewati model yang sedang jeda atau terkena batas harian.
export async function generateWithFallback({ contents: contents, config: config = {}, purpose: purpose = 'chat' }) {
  let lastError;
  let attempted = 0;
  const hasImage = typeof contents !== 'string' && (contents || []).some(item =>
    (item.parts || []).some(part => Boolean(part?.inlineData?.data)));
  const usableCandidates = AI_MODEL_CANDIDATES.filter(candidate =>
    getProviderApiKey(candidate.provider) && (!hasImage || candidate.supportsImage));
  for (const candidate of usableCandidates) {
    if (isDailyLimitReached(candidate.id) || isCoolingDown(candidate.id)
      || (hasImage && isCoolingDown(`${candidate.id}:image`)) || isProviderCoolingDown(candidate.provider)) continue;
    if (attempted >= MAX_MODEL_PER_REQUEST) break;
    attempted++;
    try {
      const apiKey = getProviderApiKey(candidate.provider);
      const result = candidate.provider === 'gemini'
        ? await generateWithGemini(candidate, contents, config, attempted, apiKey)
        : await generateWithOpenAiCompatible(candidate, contents, config, apiKey, attempted);
      if (!String(result?.text || '').trim()) {
        const error = new Error('Model tidak mengembalikan jawaban teks.');
        error.status = 503;
        throw error;
      }
      if (String(result?.text || '').trim() && purpose in lastSuccessfulModel) {
        lastSuccessfulModel[purpose] = { model: candidate.model, provider: candidate.provider, at: Date.now() };
      }
      console.log(`[AI] ${purpose}: berhasil dengan ${candidate.provider}:${candidate.model}`);
      return { result: result, model: candidate.model, provider: candidate.provider };
    } catch (error) {
      lastError = error;
      const { code, daily, raw } = errorInfo(error);
      if (daily) dailyLimits.set(candidate.id, todayInPacific());
      else if (code === 429) cooldowns.set(candidate.id, Date.now() + 60_000);
      else if ([408, 500, 502, 503, 504].includes(code)
        || /timeout|UNAVAILABLE|AbortError|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UND_ERR_/i.test(raw)) {
        cooldowns.set(candidate.id, Date.now() + 30_000);
      } else if (code === 401) providerCooldowns.set(candidate.provider, Date.now() + 12 * 60 * 60_000);
      else if (code === 402) providerCooldowns.set(candidate.provider, Date.now() + 12 * 60 * 60_000);
      else if (code === 400 || code === 403 || code === 404 || code === 413) {
        cooldowns.set(hasImage ? `${candidate.id}:image` : candidate.id, Date.now() + 12 * 60 * 60_000);
      }
      else throw error;
      console.warn(`[AI] ${purpose}: ${candidate.provider}:${candidate.model} gagal (${code || 'error'}): ${safeErrorSummary(raw) || 'detail tidak tersedia'}; mencoba kandidat berikutnya bila tersedia.`);
    }
  }

  const configuredCandidates = AI_MODEL_CANDIDATES.filter(candidate =>
    getProviderApiKey(candidate.provider) && (!hasImage || candidate.supportsImage));
  const allDaily = configuredCandidates.length > 0 && configuredCandidates.every(candidate => isDailyLimitReached(candidate.id));
  const allUnavailable = configuredCandidates.length === 0 || configuredCandidates.every(candidate =>
    isDailyLimitReached(candidate.id) || isCoolingDown(candidate.id)
      || (hasImage && isCoolingDown(`${candidate.id}:image`)) || isProviderCoolingDown(candidate.provider));
  if (!lastError) {
    const error = new Error(hasImage
      ? 'Tidak ada model vision berkey yang dapat dicoba.'
      : 'Semua model sedang jeda atau tidak dapat dicoba.');
    error.allModelsUnavailable = true;
    error.allModelsDaily = allDaily;
    error.noVisionModelAvailable = hasImage && usableCandidates.length === 0;
    throw error;
  }
  lastError.allModelsDaily = allDaily;
  lastError.allModelsUnavailable = allUnavailable;
  throw lastError;
}
