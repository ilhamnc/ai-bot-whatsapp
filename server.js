// Entry point: menyiapkan koneksi WhatsApp dan jadwal reminder.
import cron from "node-cron";
import qrcode from "qrcode-terminal";
import whatsapp from "whatsapp-web.js";
import { TZ, REMINDER_CRON, TARGET_GROUP, AI_MODELS, AI_PROVIDER, authDir, puppeteerOptions, validateConfig } from "./src/config.js";
import { clearExpiredMemories } from "./src/models/memoryModel.js";
import { getReminders } from "./src/models/reminderModel.js";
import { AI_PROVIDER_NAME } from "./src/services/aiService.js";
import { syncReminderSchedules, stopReminderSchedules } from "./src/services/reminderScheduler.js";
import { attachMessageRoutes } from "./src/routes/messageRoutes.js";
import { createDashboardServer } from "./src/routes/dashboardRoutes.js";

const { Client, LocalAuth } = whatsapp;
if (!cron.validate(REMINDER_CRON)) throw new Error("Ekspresi cron tidak valid");
validateConfig();

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "asisten-grup-ai", dataPath: authDir }),
  puppeteer: puppeteerOptions
});
let isReady = false;

client.on("qr", qr => {
  console.log("\nPindai kode QR dengan WhatsApp Android > Perangkat tertaut > Tautkan perangkat:\n");
  qrcode.generate(qr, { small: true });
});
client.on("ready", () => {
  isReady = true;
  clearExpiredMemories();
  console.log("Bot WhatsApp sudah terhubung.");
  console.log(`Pengingat terjadwal: ${getReminders().filter(reminder => reminder.enabled).length}. Grup: ${TARGET_GROUP || "BELUM DIISI"}`);
  console.log(`Provider AI: ${AI_PROVIDER_NAME} (${AI_PROVIDER})`);
  console.log("Urutan model: " + AI_MODELS.join(" -> "));
  if (!TARGET_GROUP) console.log("Untuk mengatur grup, ketik !idgrup di grup sebagai admin, lalu salin ID-nya ke .env dan mulai ulang bot.");
});
client.on("disconnected", reason => {
  isReady = false;
  console.warn("WhatsApp terputus:", reason);
});
client.on("auth_failure", () => console.error("Autentikasi WhatsApp gagal."));

// Route meneruskan event pesan ke controller khusus pesan.
attachMessageRoutes(client, () => isReady);
syncReminderSchedules(client, () => isReady);

// Dashboard hanya dibuka di localhost; akses dari komputer lain bisa memakai SSH tunnel.
const dashboardPort = Number(process.env.DASHBOARD_PORT || 3030);
const dashboardServer = createDashboardServer(() => syncReminderSchedules(client, () => isReady));
dashboardServer.listen(dashboardPort, '127.0.0.1', () => {
  console.log(`Dashboard reminder: http://127.0.0.1:${dashboardPort}`);
});

// Matikan koneksi dan jadwal dengan rapi saat dihentikan atau di-restart oleh nodemon.
let isStopping = false;
async function shutdown(signal) {
  if (isStopping) return;
  isStopping = true;
  console.log(`Menghentikan bot (${signal})...`);
  stopReminderSchedules();
  try { await client.destroy(); } catch { /* Klien mungkin belum sempat tersambung. */ }
  dashboardServer.close(() => process.exit(0));
}
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

console.log(`Menyalakan bot... Zona waktu jadwal: ${TZ}.`);
client.initialize().catch(error => console.error("Gagal menginisialisasi WhatsApp:", error));

