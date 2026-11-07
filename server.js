// Entry point: server dashboard, koneksi WhatsApp, dan jadwal pengingat.
import cron from 'node-cron';
import { REMINDER_CRON, AI_MODELS, AI_PROVIDER, validateConfig } from './src/config.js';

try {
  validateConfig();
} catch (error) {
  console.error('[KONFIGURASI] Startup dihentikan. Perbaiki pengaturan berikut:');
  for (const message of error.message.split('\n')) console.error(`[KONFIGURASI] ${message.replace(/^-\s*/, '')}`);
  process.exit(1);
}

if (!cron.validate(REMINDER_CRON)) {
  console.error('[KONFIGURASI] Startup dihentikan: ekspresi cron bawaan tidak valid.');
  process.exit(1);
}

// Periksa konfigurasi sebelum memuat model yang membaca file terenkripsi saat import.
const [
  { getTargetGroup },
  { closeChatHistoryDatabase },
  { getPrayerReminderSettings, getReminders },
  { AI_PROVIDER_NAME },
  { syncReminderSchedules },
  { createWhatsAppConnectionManager },
  { createDashboardServer }
] = await Promise.all([
  import('./src/models/botSettingsModel.js'),
  import('./src/models/chatHistoryModel.js'),
  import('./src/models/reminderModel.js'),
  import('./src/services/aiService.js'),
  import('./src/services/reminderScheduler.js'),
  import('./src/services/whatsappConnectionService.js'),
  import('./src/routes/dashboardRoutes.js')
]);

const connectionManager = createWhatsAppConnectionManager(() => {
  console.log(`Pengingat terjadwal: ${getReminders().filter(reminder => reminder.enabled).length}. Grup: ${getTargetGroup() ? 'sudah dipilih' : 'belum dipilih'}.`);
  console.log(`Provider AI: ${AI_PROVIDER_NAME} (${AI_PROVIDER})`);
  console.log('Urutan model: ' + AI_MODELS.join(' -> '));
  if (!getTargetGroup()) console.log('Kirim !idgrup di grup WhatsApp untuk memilih grup target.');
});

function syncSchedules() {
  const client = connectionManager.getClient();
  if (client) syncReminderSchedules(client, () => connectionManager.isReady());
}

// Dashboard lokal secara default; hosting container bisa mengatur host dan login.
const dashboardPort = Number(process.env.PORT || process.env.DASHBOARD_PORT || 3030);
const dashboardHost = process.env.DASHBOARD_HOST?.trim() || '127.0.0.1';
const dashboardUser = process.env.DASHBOARD_USER?.trim() || '';
const dashboardPassword = process.env.DASHBOARD_PASSWORD || '';
if (!process.env.BOT_ADMIN_IDS?.trim()) {
  console.warn('[KONFIGURASI] BOT_ADMIN_IDS kosong; perintah khusus admin WhatsApp tidak akan tersedia.');
}
if (!process.env.BOT_MENTION_IDS?.trim()) {
  console.info('[KONFIGURASI] BOT_MENTION_IDS kosong; mention akun akan dicocokkan otomatis dari ID WhatsApp/LID.');
}
const dashboardServer = createDashboardServer(
  syncSchedules,
  () => connectionManager.getInfo(),
  connectionManager,
  { user: dashboardUser, password: dashboardPassword, requireHttps: !isLocalDashboard }
);
dashboardServer.listen(dashboardPort, dashboardHost, () => {
  console.log(`Dashboard reminder: http://${dashboardHost}:${dashboardPort}`);
});

let isStopping = false;
async function shutdown(signal) {
  if (isStopping) return;
  isStopping = true;
  console.log(`Menghentikan bot (${signal})...`);
  try { await connectionManager.stop(); } catch (error) { console.warn('Gagal menutup WhatsApp:', error.message); }
  try { closeChatHistoryDatabase(); } catch (error) { console.warn('Gagal menutup arsip chat:', error.message); }
  dashboardServer.close(() => process.exit(0));
}
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

console.log(`Menyalakan bot... Zona waktu jadwal: ${getPrayerReminderSettings().timezone}.`);
void connectionManager.start().catch(error => console.error('Gagal memulai WhatsApp:', error));
