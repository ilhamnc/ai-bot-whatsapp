// Mengambil jadwal shalat harian dari AlAdhan (metode Kemenag RI) dan mengirim pesan terpisah.
import cron from 'node-cron';
import { TARGET_GROUP } from '../config.js';
import {
  createReminderVariant, getPrayerReminderSettings, markPrayerReminderSent,
  prayerReminderAlreadySent, sendReminderWithAllTag, state
} from '../models/reminderModel.js';

const PRAYER_TIMES = [
  { key: 'Fajr', name: 'Subuh' },
  { key: 'Dhuhr', name: 'Dzuhur' },
  { key: 'Asr', name: 'Asar' },
  { key: 'Maghrib', name: 'Maghrib' },
  { key: 'Isha', name: 'Isya' }
];

let cachedSchedule = null;
let retryAfter = 0;
let retryKey = '';
let lastErrorMessage = '';

function getLocalParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

async function loadPrayerTimes(settings, localDate) {
  const cacheKey = `${settings.city}|${settings.country}|${settings.timezone}|${localDate}`;
  if (cachedSchedule?.cacheKey === cacheKey) {
    return cachedSchedule;
  }
  if (retryKey === cacheKey && Date.now() < retryAfter) return null;

  const [year, month, day] = localDate.split('-');
  const url = new URL(`https://api.aladhan.com/v1/timingsByCity/${day}-${month}-${year}`);
  url.searchParams.set('city', settings.city);
  url.searchParams.set('country', settings.country);
  url.searchParams.set('method', '20'); // Kementerian Agama Republik Indonesia
  url.searchParams.set('school', '0'); // Syafi'i
  url.searchParams.set('timezonestring', settings.timezone);

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`API jadwal shalat merespons HTTP ${response.status}.`);
    const payload = await response.json();
    const timings = payload?.data?.timings;
    if (payload?.code !== 200 || !timings) throw new Error(payload?.status || 'Data jadwal shalat tidak tersedia.');
    const cleanTimings = {};
    for (const prayer of PRAYER_TIMES) {
      const time = String(timings[prayer.key] || '').match(/\b([01]\d|2[0-3]):([0-5]\d)\b/)?.[0];
      if (!time) throw new Error(`Waktu ${prayer.name} tidak tersedia dari API.`);
      cleanTimings[prayer.key] = time;
    }
    cachedSchedule = {
      cacheKey: `${settings.city}|${settings.country}|${settings.timezone}|${localDate}`,
      date: localDate,
      timings: cleanTimings
    };
    retryAfter = 0;
    retryKey = '';
    lastErrorMessage = '';
    return cachedSchedule;
  } catch (error) {
    retryAfter = Date.now() + 15 * 60 * 1000;
    retryKey = cacheKey;
    if (lastErrorMessage !== error.message) {
      console.warn(`[SHALAT] Jadwal ${settings.city}, ${settings.country} belum tersedia: ${error.message}`);
      lastErrorMessage = error.message;
    }
    return null;
  }
}

async function checkPrayerReminders(client, getIsReady) {
  const settings = getPrayerReminderSettings();
  if (!settings.enabled || !state.enabled || !TARGET_GROUP || !getIsReady()) return;

  const now = new Date();
  const local = getLocalParts(now, settings.timezone);
  const localDate = `${local.year}-${local.month}-${local.day}`;
  const schedule = await loadPrayerTimes(settings, localDate);
  if (!schedule) return;
  const currentTime = `${local.hour}:${local.minute}`;

  for (const prayer of PRAYER_TIMES) {
    if (!settings.enabledPrayers.includes(prayer.key)) continue;
    if (schedule.timings[prayer.key] !== currentTime) continue;
    const sentKey = `${localDate}:${prayer.key}`;
    if (prayerReminderAlreadySent(sentKey)) continue;

    const originalText = settings.messages[prayer.key];
    if (!originalText.trim()) {
      console.warn(`[SHALAT] Pesan ${prayer.name} kosong; pengingat dilewati.`);
      continue;
    }
    const message = await createReminderVariant(originalText, `Pengingat shalat ${prayer.name}`);
    try {
      await sendReminderWithAllTag(client, TARGET_GROUP, message);
      markPrayerReminderSent(sentKey);
      console.log(`[SHALAT] Pengingat ${prayer.name} terkirim pukul ${currentTime} (${settings.city}, ${settings.timezone}).`);
    } catch (error) {
      console.error(`[SHALAT] Gagal mengirim pengingat ${prayer.name}:`, error.message);
    }
  }
}

export async function previewPrayerTimes(settings) {
  const local = getLocalParts(new Date(), settings.timezone);
  // Preview memakai lokasi yang sedang diisi, tanpa mengubah pengaturan tersimpan.
  const previousCache = cachedSchedule;
  const schedule = await loadPrayerTimes(settings, `${local.year}-${local.month}-${local.day}`);
  if (schedule) {
    cachedSchedule = previousCache?.cacheKey === schedule.cacheKey ? previousCache : schedule;
    return { date: schedule.date, timezone: settings.timezone, timings: schedule.timings };
  }
  return null;
}

export function createPrayerReminderTask(client, getIsReady) {
  return cron.schedule('* * * * *', () => checkPrayerReminders(client, getIsReady), { timezone: 'UTC', noOverlap: true });
}
