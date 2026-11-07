// Entry point: server dashboard, koneksi WhatsApp, dan jadwal pengingat.
import cron from 'node-cron';
import { REMINDER_CRON, AI_MODELS, AI_PROVIDER, validateConfig } from './src/config.js';
import { getTargetGroup } from './src/models/botSettingsModel.js';
import { closeChatHistoryDatabase } from './src/models/chatHistoryModel.js';
import { getPrayerReminderSettings, getReminders } from './src/models/reminderModel.js';
import { AI_PROVIDER_NAME } from './src/services/aiService.js';
import { syncReminderSchedules } from './src/services/reminderScheduler.js';
import { createWhatsAppConnectionManager } from './src/services/whatsappConnectionService.js';
import { createDashboardServer } from './src/routes/dashboardRoutes.js';

if (!cron.validate(REMINDER_CRON)) throw new Error('Ekspresi cron tidak valid.');
validateConfig();

const connectionManager = createWhatsAppConnectionManager(() => {
  console.log(`Pengingat terjadwal: ${getReminders().filter(reminder => reminder.enabled).length}. Grup: ${getTargetGroup() || 'BELUM DIPILIH'}`);
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
if ((dashboardUser && !dashboardPassword) || (!dashboardUser && dashboardPassword)) {
  throw new Error('DASHBOARD_USER dan DASHBOARD_PASSWORD harus diisi bersama.');
}
if (!['127.0.0.1', '::1', 'localhost'].includes(dashboardHost) && !dashboardUser) {
  throw new Error('Dashboard yang menerima koneksi luar wajib memakai DASHBOARD_USER dan DASHBOARD_PASSWORD.');
}
const dashboardServer = createDashboardServer(
  syncSchedules,
  () => connectionManager.getInfo(),
  connectionManager,
  { user: dashboardUser, password: dashboardPassword }
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
