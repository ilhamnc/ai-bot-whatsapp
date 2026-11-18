// Controller khusus untuk menangani perintah teks berawalan tanda seru (!).
import { state, saveState, reminderText, getReminders, getPrayerReminderSettings, sendReminderWithAllTag, createReminderVariant } from '../models/reminderModel.js';
import { getGroupMemoryInfo, resetGroupMemory, MAX_MEMORY_PAIRS, MAX_MEMORY_CHARACTERS } from '../models/memoryModel.js';
import { clearGroupChatHistory, getChatHistoryStats } from '../models/chatHistoryModel.js';
import { getTargetGroup, registerGroupFromCommand } from '../models/botSettingsModel.js';
import { getModelStatus, getLastSuccessfulModel, formatTimeWib, getNextModelCandidate, AI_PROVIDER_NAME } from '../services/aiService.js';
import { AI_MODEL, MAX_MODEL_PER_REQUEST } from '../config.js';
import { normalizeMentionId, saveBotMentionId } from '../services/mentionService.js';

export const HELP_MESSAGE = [
  '🤖 *AiBot WhatsApp*',
  '',
  '!ai pertanyaan / @AiBot pertanyaan — Tanya AI di grup',
  'Panggilan santai: aibot, ibot, atau bot (contoh: "ibot, ini apa?" / "enak ga bot?")',
  'Balas pesan AiBot — Lanjutkan obrolan tanpa mention',
  '!schedule — Lihat jadwal reminder',
  '!status — Status bot',
  '!model — Status model AI',
  '!memori — Memori obrolan grup',
  '!help — Bantuan ini',
  '!idgrup — Pilih grup ini sebagai target (jika belum dikunci)',
  '!myid — Tampilkan ID pengirim di terminal',
  '!daftarbot @AiBot — Aktifkan mention (admin)',
  '!reminder on / off — Aktif/nonaktif pengingat (admin)',
  '!testreminder / !testkirim — Kirim pengingat uji (admin)',
  '!resetai — Reset memori grup (admin)',
  '',
  'Pengaturan reminder dan jadwal shalat tersedia di dashboard lokal.',
  'Admin: !hapusriwayat menghapus arsip chat grup.'
].join('\n');

/**
 * Memeriksa apakah pengirim memiliki hak admin bot berdasarkan BOT_ADMIN_IDS.
 * @param {string[]} adminCandidates
 * @returns {boolean}
 */
export function checkIsAdmin(adminCandidates = []) {
  const allowedAdminIds = new Set((process.env.BOT_ADMIN_IDS || '')
    .split(',').map(value => value.trim()).filter(Boolean));
  return adminCandidates.filter(Boolean).some(id => allowedAdminIds.has(id)
    || (/^\d+@(c\.us|s\.whatsapp\.net)$/.test(id)
      && [...allowedAdminIds].some(allowed => /^\d+@(c\.us|s\.whatsapp\.net)$/.test(allowed)
        && allowed.split('@')[0] === id.split('@')[0])));
}

/**
 * Menangani eksekusi perintah bot teks.
 * @param {object} params
 * @returns {Promise<boolean>} true jika perintah ditangani
 */
export async function handleBotCommand({ msg, body, client, getIsReady }) {
  const lower = body.toLowerCase().trim();

  // Bantuan bisa dibuka dari chat pribadi dan grup mana pun
  if (lower === '!help') {
    await msg.reply(HELP_MESSAGE);
    return true;
  }

  // Perintah !idgrup untuk mencatat grup sebagai target
  if (lower === '!idgrup') {
    let groupName = msg.from;
    try {
      const chat = await msg.getChat();
      groupName = chat?.name && chat.name !== msg.from ? chat.name : chat?.groupMetadata?.subject || msg.from;
    } catch { /* Nama grup boleh belum tersedia */ }
    if (groupName === msg.from) {
      try {
        const chat = await client.getChatById(msg.from);
        groupName = chat?.name && chat.name !== msg.from ? chat.name : chat?.groupMetadata?.subject || msg.from;
      } catch { /* Nama dapat dilengkapi saat dashboard dibuka */ }
    }
    const group = registerGroupFromCommand(msg.from, groupName);
    console.log(`Grup terdaftar: ${groupName} (${msg.from}); target: ${group.targetId || 'belum dipilih'}.`);
    await msg.reply(group.locked
      ? `ID grup ini dicatat: ${msg.from}. Grup target tetap terkunci pada ${group.targetId}.`
      : `Sip, grup ini sekarang jadi target AiBot: ${msg.from}.`);
    return true;
  }

  // Perintah di bawah hanya berjalan di grup yang sudah dipilih
  const targetGroup = getTargetGroup();
  if (!targetGroup || msg.from !== targetGroup) return false;

  const senderId = (msg.author || '').trim();
  const senderAlt = (msg.authorAlt || '').trim();
  const admin = checkIsAdmin([senderId, senderAlt]);

  // Perintah pendaftaran mention bot oleh admin
  if (/^!daftarbot(?:\s|$)/i.test(body)) {
    if (!admin) {
      await msg.reply('Cuma admin yang bisa daftarin mention bot. Cek BOT_ADMIN_IDS ya.');
      return true;
    }
    const ids = (Array.isArray(msg.mentionedIds) ? msg.mentionedIds : [])
      .map(normalizeMentionId).filter(Boolean);
    if (ids.length !== 1 || !/^\d+@(lid|c\.us)$/.test(ids[0])) {
      await msg.reply('Ketik !daftarbot lalu pilih @AiBot dari daftar anggota. Harus tepat satu mention.');
      return true;
    }
    saveBotMentionId(ids[0]);
    console.log('[MENTION] ID bot berhasil didaftarkan oleh admin.');
    await msg.reply('✅ Sip, mention AiBot udah aktif! Coba @AiBot halo.');
    return true;
  }

  if (lower === '!myid') {
    console.log('ID PENGIRIM: ' + (senderId || '(tidak terdeteksi)'));
    if (senderAlt) console.log('ID alternatif: ' + senderAlt);
    if (senderId) console.log('Untuk .env -> BOT_ADMIN_IDS=' + senderId);
    await msg.reply(senderId
      ? 'ID pengirim sudah ditampilkan di CMD tempat bot berjalan. Tambahkan ke BOT_ADMIN_IDS di file .env.'
      : 'ID pengirim belum terdeteksi. Periksa terminal.');
    return true;
  }

  if (lower === '!schedule') {
    const reminders = getReminders();
    const schedule = reminders.length
      ? reminders.map(reminder => `- ${reminder.enabled ? '✅' : '⏸️'} *${reminder.name}*: \`${(reminder.cronExpressions || [reminder.cron]).join(' | ')}\``).join('\n')
      : 'Belum ada reminder yang dibuat.';
    await msg.reply(`⏰ *Jadwal reminder* (${getPrayerReminderSettings().timezone})\nStatus global: *${state.enabled ? "Aktif" : "Nonaktif"}*\n\n${schedule}`);
    return true;
  }

  if (lower === '!model') {
    await msg.reply(`🤖 *Status model AI*\n\n${getModelStatus()}\n\nMaks. ${MAX_MODEL_PER_REQUEST} model per pesan. Bot memprioritaskan model pertama lagi setelah masa jeda selesai.`);
    return true;
  }

  if (lower === '!status') {
    const memoryInfo = getGroupMemoryInfo(msg.from);
    const successfulModels = getLastSuccessfulModel();
    const lastChatModel = successfulModels.chat;
    const lastSummaryModel = successfulModels.ringkasan;
    const nextCandidate = getNextModelCandidate();
    await msg.reply(
      `✅ *Status AiBot*\n` +
      `- WhatsApp: ${getIsReady() ? "terhubung" : "belum siap"}\n` +
      `- Provider: ${AI_PROVIDER_NAME}\n` +
      `- Model utama: ${AI_MODEL}\n` +
      `- Terakhir menjawab: ${lastChatModel ? `${lastChatModel.provider ? lastChatModel.provider + ':' : ''}${lastChatModel.model}` : "belum ada sejak bot dinyalakan"}\n` +
      (lastChatModel ? `- Waktu answer: ${formatTimeWib(lastChatModel.at)}\n` : "") +
      `- Kandidat question berikutnya: ${nextCandidate || "semua model sedang jeda/limit"}\n` +
      `- Ringkasan terakhir: ${lastSummaryModel ? `${lastSummaryModel.provider ? lastSummaryModel.provider + ':' : ''}${lastSummaryModel.model}` : "belum ada sejak bot dinyalakan"}\n` +
      `- Reminder: ${state.enabled ? "aktif" : "nonaktif"} (${getReminders().filter(reminder => reminder.enabled).length}/${getReminders().length} schedule aktif)\n` +
      ` - Memori bersama: ${memoryInfo.pairCount}/${MAX_MEMORY_PAIRS} pasang;\n` +
      ` - Ringkasan: ${memoryInfo.hasSummary ? "ada" : "belum"}; \n` +
      ` - Antre: ${memoryInfo.pendingPairCount} pasang.\n\n` +
      ` - _Status diperbarui saat perintah dikirim. Kandidat bergantung pada ketersediaan layanan AI._`
    );
    return true;
  }

  if (lower === '!memori') {
    const memoryInfo = getGroupMemoryInfo(msg.from);
    const archiveInfo = getChatHistoryStats(msg.from);
    await msg.reply(
      `🧠 *Memori bersama grup (dengan identitas anggota)*\n` +
      `Percakapan terbaru: *${memoryInfo.pairCount}/${MAX_MEMORY_PAIRS} pasang* (${memoryInfo.characterCount}/${MAX_MEMORY_CHARACTERS} karakter)\n` +
      `Ringkasan otomatis: *${memoryInfo.hasSummary ? 'aktif / tersedia' : 'aktif / belum terbentuk'}* (${memoryInfo.summaryCharacterCount} karakter)\n` +
      `Menunggu diringkas: *${memoryInfo.pendingPairCount} pasang*\n` +
      `Kedaluwarsa setelah *${memoryInfo.expirationDays} hari* tanpa interaksi.\n` +
      `Arsip chat lokal: *${archiveInfo.messageCount} pesan teks/caption*.\n` +
      `Pertanyaan yang merujuk obrolan grup memakai konteks arsip yang relevan.`
    );
    return true;
  }

  if (lower === '!resetai') {
    if (!admin) {
      await msg.reply('Perintah ini cuma buat admin bot ya bro.');
      return true;
    }
    resetGroupMemory(msg.from);
    await msg.reply('🧠 Sip, memori obrolan grup udah dikosongkan. Mulai sekarang konteksnya fresh lagi.');
    return true;
  }

  if (lower === '!hapusriwayat') {
    if (!admin) {
      await msg.reply('Hanya admin terdaftar yang boleh menghapus arsip chat.');
      return true;
    }
    const deletedCount = clearGroupChatHistory(msg.from);
    await msg.reply(`Arsip chat grup sudah dihapus (${deletedCount} pesan). Pesan baru akan tersimpan lagi.`);
    return true;
  }

  if (lower === '!reminder on' || lower === '!reminder off') {
    if (!admin) {
      await msg.reply('Perintah ini hanya untuk admin grup.');
      return true;
    }
    state.enabled = lower.endsWith('on');
    saveState();
    await msg.reply(`Pengingat sekarang *${state.enabled ? "AKTIF" : "NONAKTIF"}*.`);
    return true;
  }

  if (lower === '!testkirim' || lower === '!testreminder') {
    if (!admin) {
      await msg.reply('Hanya admin terdaftar yang boleh menguji pengiriman.');
      return true;
    }
    try {
      const testReminderText = await createReminderVariant(reminderText(), 'Uji kirim reminder');
      await sendReminderWithAllTag(client, targetGroup, '🧪 *UJI KIRIM OTOMATIS*\n\n' + testReminderText);
      console.log('Perintah pengiriman langsung ke grup sudah dijalankan.');
    } catch (error) {
      console.error('Uji kirim otomatis gagal. Jenis error:', error?.name || 'Error');
      await msg.reply('⚠️ Pengiriman langsung gagal. Lihat error di CMD.');
    }
    return true;
  }

  return false;
}
