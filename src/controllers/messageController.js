// Controller utama: menerima pesan WhatsApp, mengoordinasikan perintah, dan memproses tanya jawab AI.
import { AI_MODEL, AI_MODELS } from '../config.js';
import { getTargetGroup } from '../models/botSettingsModel.js';
import { archiveWhatsAppMessage, getRelevantGroupHistory } from '../models/chatHistoryModel.js';
import { getPrayerReminderSettings } from '../models/reminderModel.js';
import {
  runAiJob, DAILY_LIMIT_MESSAGE, isDailyLimitReached, describeAiError, generateWithFallback
} from '../services/aiService.js';
import {
  getGroupMemory, saveMemoryInteraction, getSenderName, getSenderKey,
  selectMemberContext, formatHistoryForAi
} from '../models/memoryModel.js';
import { getProjectKnowledgeContext } from '../services/projectKnowledgeService.js';
import { getAiStyleInstruction } from '../models/aiStyleModel.js';
import { previewPrayerTimes } from '../services/prayerReminderService.js';
import { optimizeImageForAi, MAX_INCOMING_IMAGE_BYTES, MAX_AI_IMAGE_BYTES } from '../services/imageService.js';
import {
  isCalledWithMention, hasBotNameMention, hasOwnPhoneNumberMention,
  extractQuestionText, getQuotedMessageDetails, registeredMentionIds
} from '../services/mentionService.js';
import {
  buildChatSystemPrompt, formatUserMessage, getPrayerTimeRequest,
  PRAYER_NAMES, prayerTimezoneLabel
} from '../services/promptService.js';
import { handleBotCommand } from './commandController.js';

async function handlePrayerTimeQuestion(msg, question, prayerTimeRequest, senderKey, senderLabel) {
  if (prayerTimeRequest.unsupportedDate) {
    return msg.reply('Aku bisa cek jadwal shalat hari ini dari dashboard. Untuk tanggal lain, jadwalnya belum tersedia lewat chat.');
  }
  try {
    const prayerSettings = getPrayerReminderSettings();
    const schedule = await previewPrayerTimes(prayerSettings);
    if (!schedule) {
      return msg.reply('Jadwal shalat hari ini belum bisa diambil dari layanan jadwal. Coba cek lagi lewat tombol “Cek jadwal hari ini” di dashboard ya.');
    }
    const timezoneLabel = prayerTimezoneLabel(schedule.timezone);
    const formalStyle = /\b(formal|resmi|baku|profesional)\b/i.test(getAiStyleInstruction());
    const answer = prayerTimeRequest.prayer
      ? formalStyle
        ? `Waktu ${PRAYER_NAMES[prayerTimeRequest.prayer]} di ${prayerSettings.city} hari ini pukul ${schedule.timings[prayerTimeRequest.prayer]} ${timezoneLabel}.`
        : `${PRAYER_NAMES[prayerTimeRequest.prayer]} di ${prayerSettings.city} hari ini jam ${schedule.timings[prayerTimeRequest.prayer]} ${timezoneLabel} ya.`
      : `Jadwal shalat ${prayerSettings.city} hari ini${formalStyle ? ':' : ' nih:'} ` +
        Object.entries(PRAYER_NAMES).map(([key, name]) => `${name} ${schedule.timings[key]}`).join(' · ') +
        ` (${timezoneLabel}).`;
    await msg.reply(answer);
    saveMemoryInteraction(msg.from, senderKey, senderLabel, question, answer);
  } catch (error) {
    console.warn('[SHALAT] Jawaban jadwal gagal dibuat:', error?.name || 'Error');
    await msg.reply('Maaf, jadwal shalat hari ini belum bisa ditampilkan sekarang.');
  }
}

async function prepareImagePart(msg) {
  if (typeof msg.downloadMedia !== 'function') throw new Error('Pengunduh media tidak tersedia');
  const imageBuffer = await msg.downloadMedia();
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error('Gambarnya kosong atau formatnya belum bisa dibaca.');
  }
  if (imageBuffer.length > MAX_INCOMING_IMAGE_BYTES) {
    throw new Error('Ukuran gambar terlalu besar (maksimal 20 MB).');
  }
  const mimeType = String(msg.mediaMimeType || 'image/jpeg').split(';')[0].trim().toLowerCase();
  if (!mimeType.startsWith('image/')) {
    throw new Error('Lampiran ini bukan file gambar yang didukung.');
  }
  let optimizedImage;
  try {
    optimizedImage = await optimizeImageForAi(imageBuffer, mimeType);
  } catch (error) {
    console.warn('[AI] Kompresi gambar gagal, memakai gambar asli jika memungkinkan:', error.message);
    if (imageBuffer.length > MAX_AI_IMAGE_BYTES) {
      throw new Error('Format gambar ini belum bisa dikompresi ke batas 6 MB.');
    }
    optimizedImage = { buffer: imageBuffer, mimeType };
  }
  return {
    inlineData: {
      mimeType: optimizedImage.mimeType,
      data: optimizedImage.buffer.toString('base64')
    }
  };
}

export function registerMessageRoutes(client, getIsReady) {
  client.on('message_create', msg => {
    try { archiveWhatsAppMessage(msg, getTargetGroup()); }
    catch (error) { console.error('[ARSIP CHAT] Gagal menyimpan pesan:', error.message); }
  });

  client.on('message', async msg => {
    try {
      if (msg.fromMe || (!msg.body && !msg.hasImage)) return;
      const body = String(msg.body || '').trim();

      // Periksa apakah pesan merupakan perintah bot (!help, !idgrup, !schedule, dll)
      const commandHandled = await handleBotCommand({ msg, body, client, getIsReady });
      if (commandHandled) return;

      // Hanya proses percakapan AI jika pesan berada di grup tujuan yang aktif
      const targetGroup = getTargetGroup();
      if (!msg.from?.endsWith('@g.us') || !targetGroup || msg.from !== targetGroup) return;

      // Deteksi sebutan bot dan kutipan pesan
      const namedBotMention = hasBotNameMention(body);
      const hasMentionMetadata = Array.isArray(msg.mentionedIds) && msg.mentionedIds.length > 0;
      const extraMentionIds = [
        ...(process.env.BOT_MENTION_IDS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean),
        ...registeredMentionIds()
      ];
      const numericBotMention = hasMentionMetadata && hasOwnPhoneNumberMention(body, client, extraMentionIds);
      const isMentioned = namedBotMention || numericBotMention || await isCalledWithMention(msg, body, client);

      const quotedMessage = await getQuotedMessageDetails(msg);
      const isReplyToBot = Boolean(quotedMessage?.fromMe);
      const isReplyToMember = Boolean(quotedMessage && !quotedMessage.fromMe);

      const isAiTrigger = /^!ai(?:\s|$)/i.test(body) || isMentioned || isReplyToBot;
      if (!isAiTrigger) return;

      let question = extractQuestionText(body);
      if (!question && msg.hasImage) question = 'Tolong jelaskan gambar yang terlampir.';
      if (!question) {
        return msg.reply('Coba sebut @AiBot lalu ketik pertanyaan, atau gunakan format !ai pertanyaan.');
      }

      const senderLabel = getSenderName(msg);
      const senderKey = getSenderKey(msg);

      // Tangani permintaan jadwal shalat cepat
      const prayerTimeRequest = msg.hasImage ? null : getPrayerTimeRequest(question);
      if (prayerTimeRequest) {
        return handlePrayerTimeQuestion(msg, question, prayerTimeRequest, senderKey, senderLabel);
      }

      if (AI_MODELS.every(isDailyLimitReached)) {
        return msg.reply(DAILY_LIMIT_MESSAGE);
      }

      // Tampilkan indikator mengetik di WhatsApp agar pengguna tahu bot sedang memproses
      await client.sendTyping?.(msg.from);

      return runAiJob(async () => {
        const startedAt = Date.now();
        try {
          const history = getGroupMemory(msg.from);
          const hasQuoted = Boolean(quotedMessage);
          const context = isReplyToBot
            ? { mode: 'balasan AiBot', turns: [], summary: '' }
            : selectMemberContext(history, senderKey, question, hasQuoted);

          const archivedContext = context.mode === 'grup'
            ? getRelevantGroupHistory(msg.from, question, msg.id?._serialized || '')
            : [];

          const projectKnowledge = getProjectKnowledgeContext(question, context.turns);
          const userMessageText = formatUserMessage({
            senderKey,
            senderLabel,
            question,
            quotedMessage,
            projectKnowledge
          });

          const userParts = [{ text: userMessageText }];
          if (msg.hasImage) {
            try {
              const imagePart = await prepareImagePart(msg);
              userParts.push(imagePart);
            } catch (imageError) {
              return msg.reply(`⚠️ ${imageError.message}`);
            }
          }

          const contents = [
            ...formatHistoryForAi(context.turns),
            ...formatHistoryForAi(archivedContext),
            { role: 'user', parts: userParts }
          ];

          const systemPrompt = buildChatSystemPrompt({
            styleInstruction: getAiStyleInstruction(),
            contextMode: context.mode,
            isReplyToBot,
            isReplyToMember,
            summary: context.summary
          });

          const generated = await generateWithFallback({
            purpose: 'chat',
            contents,
            config: {
              systemInstruction: systemPrompt,
              thinkingConfig: { thinkingLevel: 'minimal' },
              maxOutputTokens: 4000,
              httpOptions: { timeout: 18000, retryOptions: { attempts: 1 } }
            }
          });

          const answer = (generated.result?.text || '').trim();
          const usedModel = generated.model;
          const usedProvider = generated.provider;
          const usage = generated.result?.usageMetadata || {};

          console.log(`Jawaban AI: ${usedProvider ? usedProvider + ':' : ''}${usedModel} | ${Date.now() - startedAt} ms | token=${usage.candidatesTokenCount ?? '?'}`);

          if (!answer) {
            return msg.reply('Waduh, AI belum menghasilkan teks. Coba tanyakan lagi ya.');
          }

          // Kirim jawaban secara terpotong jika pesan sangat panjang
          const chunkSize = 2800;
          await msg.reply('🤖 *AiBot*\n\n' + answer.slice(0, chunkSize));
          for (let pos = chunkSize; pos < answer.length; pos += chunkSize) {
            await client.sendMessage(msg.from, answer.slice(pos, pos + chunkSize));
          }

          const memoryQuestion = msg.hasImage ? `${question}\n[gambar terlampir]` : question;
          const recordedQuestion = quotedMessage?.body
            ? `${memoryQuestion}\n[mengutip: ${String(quotedMessage.body).slice(0, 400)}]`
            : memoryQuestion;

          saveMemoryInteraction(msg.from, senderKey, senderLabel, recordedQuestion, answer);
        } catch (error) {
          const errorInfo = describeAiError(error);
          console.error('Permintaan AI gagal. Kode:', errorInfo.code || 'tidak diketahui', '| jenis:', error?.name || 'Error');
          if (error?.allModelsDaily || AI_MODELS.every(isDailyLimitReached)) {
            return msg.reply(DAILY_LIMIT_MESSAGE);
          }
          if (error?.allModelsUnavailable) {
            if (msg.hasImage && error.noVisionModelAvailable) {
              return msg.reply('Belum ada model vision yang tersedia untuk menganalisis gambar. Cek API key di file .env.');
            }
            return msg.reply('😅 Semua model AI sedang jeda sementara. Coba lagi beberapa saat ya.');
          }
          if (errorInfo.code === 429) {
            return msg.reply('😅 Layanan AI sedang membatasi permintaan (rate limit). Coba lagi bentar ya.');
          }
          if (errorInfo.code === 503 || errorInfo.code === 504) {
            return msg.reply('🥲 Server AI sedang sibuk. Coba lagi beberapa saat ya.');
          }
          return msg.reply('⚠️ Layanan AI sedang mengalami kendala. Cek terminal bot untuk detailnya ya.');
        } finally {
          await client.clearTyping?.(msg.from);
        }
      });
    } catch (error) {
      console.error('Kesalahan saat memproses pesan:', error?.message || error);
    }
  });
}
