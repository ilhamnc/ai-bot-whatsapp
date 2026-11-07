// Entry point: menyiapkan koneksi WhatsApp dan jadwal reminder.
import cron from "node-cron";
import qrcode from "qrcode-terminal";
import whatsapp from "whatsapp-web.js";
import { TZ, REMINDER_CRON, TARGET_GROUP, AI_MODELS, AI_PROVIDER, authDir, puppeteerOptions, validateConfig } from "./src/config.js";
import { bersihkanMemoriKadaluarsa } from "./src/models/memoryModel.js";
import { sendScheduledReminder } from "./src/models/reminderModel.js";
import { AI_PROVIDER_NAME } from "./src/services/aiService.js";
import { attachMessageRoutes } from "./src/routes/messageRoutes.js";

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
  bersihkanMemoriKadaluarsa();
  console.log("Bot WhatsApp sudah terhubung.");
  console.log(`Pengingat: Senin–Jumat 14:30 WIB. Grup: ${TARGET_GROUP || "BELUM DIISI"}`);
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
cron.schedule(REMINDER_CRON, () => sendScheduledReminder(client, isReady), { timezone: TZ, noOverlap: true });
console.log("Menyalakan bot... Jadwal: Senin–Jumat pukul 14:30 WIB (Asia/Jakarta).");
client.initialize().catch(err => console.error("Gagal menginisialisasi WhatsApp:", err));

