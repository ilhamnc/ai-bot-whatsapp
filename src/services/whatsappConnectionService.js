// Mengelola beberapa sesi WhatsApp tanpa menghapus sesi saat pengguna berpindah akun.
import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import whatsapp from 'whatsapp-web.js';
import { authDir, puppeteerOptions } from '../config.js';
import {
  activateAccountProfile, addAccountProfile, getAccountProfiles, getActiveAccountId,
  markAccountUnlinked, rememberConnectedAccount, removeAccountProfile
} from '../models/botSettingsModel.js';
import { clearExpiredMemories } from '../models/memoryModel.js';
import { attachMessageRoutes } from '../routes/messageRoutes.js';
import { stopReminderSchedules, syncReminderSchedules } from './reminderScheduler.js';

const { Client, LocalAuth } = whatsapp;

export function createWhatsAppConnectionManager(onReady) {
  let client = null;
  let ready = false;
  let status = 'connecting';
  let qrDataUrl = null;
  let operation = Promise.resolve();

  function runSequentially(task) {
    const next = operation.catch(() => {}).then(task);
    operation = next;
    return next;
  }

  function getInfo() {
    const activeAccountId = getActiveAccountId();
    const accounts = getAccountProfiles();
    return {
      status, qrDataUrl, activeAccountId,
      accounts,
      phone: accounts.find(account => account.id === activeAccountId)?.phone || ''
    };
  }

  async function stopCurrentClient() {
    stopReminderSchedules();
    const oldClient = client;
    client = null;
    ready = false;
    qrDataUrl = null;
    status = 'connecting';
    if (oldClient) {
      try { await oldClient.destroy(); }
      catch (error) { console.warn('Sesi WhatsApp lama belum dapat ditutup bersih:', error.message); }
    }
  }

  function startActiveClient() {
    const accountId = getActiveAccountId();
    const nextClient = new Client({
      authStrategy: new LocalAuth({ clientId: accountId, dataPath: authDir }),
      puppeteer: puppeteerOptions
    });
    client = nextClient;
    status = 'connecting';
    qrDataUrl = null;
    ready = false;

    nextClient.on('qr', async qr => {
      if (client !== nextClient) return;
      status = 'qr';
      try {
        const image = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
        if (client === nextClient) qrDataUrl = image;
      } catch (error) {
        if (client === nextClient) status = 'error';
        console.error('Gagal membuat QR WhatsApp:', error.message);
      }
    });
    nextClient.on('ready', () => {
      if (client !== nextClient) return;
      ready = true;
      status = 'ready';
      qrDataUrl = null;
      const phone = nextClient.info?.wid?.user || '';
      rememberConnectedAccount(accountId, phone);
      clearExpiredMemories();
      console.log(`AiBot WhatsApp terhubung: ${phone || accountId}.`);
      onReady?.();
    });
    nextClient.on('disconnected', reason => {
      if (client !== nextClient) return;
      ready = false;
      status = 'disconnected';
      qrDataUrl = null;
      console.warn('WhatsApp terputus:', reason);
    });
    nextClient.on('auth_failure', () => {
      if (client !== nextClient) return;
      ready = false;
      status = 'error';
      qrDataUrl = null;
      console.error('Autentikasi WhatsApp gagal.');
    });

    attachMessageRoutes(nextClient, () => ready && client === nextClient);
    syncReminderSchedules(nextClient, () => ready && client === nextClient);
    void nextClient.initialize().catch(error => {
      if (client !== nextClient) return;
      status = 'error';
      ready = false;
      console.error('Gagal memulai WhatsApp:', error);
    });
  }

  async function switchTo(accountId) {
    if (!getAccountProfiles().some(account => account.id === accountId)) throw new Error('Akun WhatsApp tidak ditemukan.');
    if (accountId === getActiveAccountId() && client && ['ready', 'qr', 'connecting'].includes(status)) return getInfo();
    await stopCurrentClient();
    activateAccountProfile(accountId);
    startActiveClient();
    return getInfo();
  }

  async function removeCurrentAuth(accountId, oldClient, wasReady) {
    if (oldClient) {
      try {
        if (wasReady) await oldClient.logout();
        else await oldClient.destroy();
      } catch (error) {
        console.warn('Logout WhatsApp perlu pembersihan sesi lokal:', error.message);
        try { await oldClient.destroy(); } catch { /* Browser mungkin sudah tertutup. */ }
      }
    }
    // ID profil tervalidasi oleh model; tetap cek batas direktori sebelum menghapus sesi.
    const root = path.resolve(authDir);
    const sessionPath = path.resolve(root, `session-${accountId}`);
    if (!sessionPath.startsWith(`${root}${path.sep}`)) throw new Error('Path sesi WhatsApp tidak valid.');
    await fs.rm(sessionPath, { recursive: true, force: true, maxRetries: 4 });
  }

  return {
    getInfo,
    getClient: () => client,
    isReady: () => ready,
    start: () => runSequentially(async () => { startActiveClient(); return getInfo(); }),
    switchAccount: accountId => runSequentially(() => switchTo(accountId)),
    addAccount: () => runSequentially(async () => {
      const account = addAccountProfile();
      return switchTo(account.id);
    }),
    unlinkCurrent: () => runSequentially(async () => {
      const accountId = getActiveAccountId();
      const oldClient = client;
      const wasReady = ready;
      stopReminderSchedules();
      client = null;
      ready = false;
      status = 'connecting';
      qrDataUrl = null;
      await removeCurrentAuth(accountId, oldClient, wasReady);
      markAccountUnlinked(accountId);
      startActiveClient();
      return getInfo();
    }),
    removeAccount: accountId => runSequentially(async () => {
      if (!getAccountProfiles().some(account => account.id === accountId)) throw new Error('Akun WhatsApp tidak ditemukan.');
      const isActive = accountId === getActiveAccountId();
      if (isActive) {
        stopReminderSchedules();
        const oldClient = client;
        const wasReady = ready;
        client = null;
        ready = false;
        status = 'connecting';
        qrDataUrl = null;
        await removeCurrentAuth(accountId, oldClient, wasReady);
      } else {
        // Sesi nonaktif hanya dapat dihapus secara lokal; logout jarak jauh perlu akun aktif.
        await removeCurrentAuth(accountId, null, false);
      }
      removeAccountProfile(accountId);
      if (isActive) startActiveClient();
      return getInfo();
    }),
    stop: () => runSequentially(() => stopCurrentClient())
  };
}
