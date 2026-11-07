// Controller dashboard: menyajikan halaman lokal dan API untuk mengelola reminder.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getGroupSettings, registerGroupFromCommand, updateGroupName, updateGroupSettings } from '../models/botSettingsModel.js';
import {
  createReminder, deleteReminder, getPrayerReminderSettings, getReminders, savePrayerReminderSettings, saveState,
  state, updateReminder
} from '../models/reminderModel.js';
import { previewPrayerTimes } from '../services/prayerReminderService.js';

const viewPath = fileURLToPath(new URL('../views/reminders.html', import.meta.url));
const MAX_REQUEST_BYTES = 16 * 1024;

function respond(response, status, body, contentType = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) throw new Error('Ukuran data terlalu besar.');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('Format JSON tidak valid.'); }
}

async function readGroupName(connectionManager, groupId) {
  if (!connectionManager?.isReady()) return '';
  try {
    const chat = await connectionManager.getClient().getChatById(groupId);
    return chat?.name && chat.name !== groupId ? chat.name : chat?.groupMetadata?.subject || '';
  } catch { return ''; }
}

// Setiap perubahan daftar memanggil scheduler agar jadwal langsung berubah.
export async function handleDashboardRequest(request, response, syncSchedules, getConnectionInfo, connectionManager) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/') {
    return respond(response, 200, fs.readFileSync(viewPath, 'utf8'), 'text/html; charset=utf-8');
  }
  if (request.method === 'GET' && url.pathname === '/api/reminders') {
    return respond(response, 200, {
      timezone: getPrayerReminderSettings().timezone,
      globallyEnabled: state.enabled,
      reminders: getReminders()
    });
  }
  if (request.method === 'GET' && url.pathname === '/api/prayer-reminder') {
    return respond(response, 200, { settings: getPrayerReminderSettings() });
  }
  if (request.method === 'GET' && url.pathname === '/api/prayer-reminder/preview') {
    try {
      const settings = {
        ...getPrayerReminderSettings(),
        city: url.searchParams.get('city') || '',
        country: url.searchParams.get('country') || '',
        timezone: url.searchParams.get('timezone') || ''
      };
      const preview = await previewPrayerTimes(settings);
      if (!preview) return respond(response, 502, { error: 'Jadwal belum bisa diambil. Cek ejaan kota dan koneksi internet.' });
      return respond(response, 200, preview);
    } catch (error) {
      return respond(response, 400, { error: error.message });
    }
  }
  if (request.method === 'PUT' && url.pathname === '/api/prayer-reminder') {
    try {
      const settings = savePrayerReminderSettings(await readJson(request));
      syncSchedules();
      return respond(response, 200, { settings });
    } catch (error) {
      return respond(response, 400, { error: error.message });
    }
  }
  if (request.method === 'GET' && url.pathname === '/api/connection') {
    const connectionInfo = getConnectionInfo?.() || { status: 'connecting', qrDataUrl: null };
    return respond(response, 200, connectionInfo);
  }
  if (request.method === 'GET' && url.pathname === '/api/settings/groups') {
    const missingNames = getGroupSettings().history.filter(group => !group.name || group.name === group.id || group.name === 'Grup awal');
    await Promise.all(missingNames.map(async group => {
      const name = await readGroupName(connectionManager, group.id);
      if (name) updateGroupName(group.id, name);
    }));
    return respond(response, 200, getGroupSettings());
  }
  if (request.method === 'PUT' && url.pathname === '/api/settings/groups') {
    try { return respond(response, 200, updateGroupSettings(await readJson(request))); }
    catch (error) { return respond(response, 400, { error: error.message }); }
  }
  if (request.method === 'POST' && url.pathname === '/api/settings/groups/manual') {
    try {
      const data = await readJson(request);
      const groupId = String(data.groupId || '').trim();
      if (!/^[0-9-]+@g\.us$/.test(groupId)) throw new Error('ID grup harus berupa angka dan berakhiran @g.us.');
      const name = String(data.name || '').trim() || await readGroupName(connectionManager, groupId);
      const current = getGroupSettings();
      registerGroupFromCommand(groupId, name);
      return respond(response, 200, updateGroupSettings({ targetId: groupId, locked: current.locked }));
    } catch (error) { return respond(response, 400, { error: error.message }); }
  }
  if (request.method === 'POST' && url.pathname === '/api/settings/whatsapp/add') {
    try { return respond(response, 200, await connectionManager.addAccount()); }
    catch (error) { return respond(response, 500, { error: error.message }); }
  }
  if (request.method === 'POST' && url.pathname === '/api/settings/whatsapp/select') {
    try {
      const data = await readJson(request);
      return respond(response, 200, await connectionManager.switchAccount(String(data.accountId || '')));
    } catch (error) { return respond(response, 400, { error: error.message }); }
  }
  if (request.method === 'POST' && url.pathname === '/api/settings/whatsapp/unlink') {
    try { return respond(response, 200, await connectionManager.unlinkCurrent()); }
    catch (error) { return respond(response, 500, { error: error.message }); }
  }
  if (request.method === 'POST' && url.pathname === '/api/settings/whatsapp/remove') {
    try {
      const data = await readJson(request);
      return respond(response, 200, await connectionManager.removeAccount(String(data.accountId || '')));
    } catch (error) { return respond(response, 400, { error: error.message }); }
  }
  if (request.method === 'PATCH' && url.pathname === '/api/reminders/settings') {
    try {
      const data = await readJson(request);
      state.enabled = Boolean(data.enabled);
      saveState();
      return respond(response, 200, { globallyEnabled: state.enabled });
    } catch (error) {
      return respond(response, 400, { error: error.message });
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/reminders') {
    try {
      const reminder = createReminder(await readJson(request));
      syncSchedules();
      return respond(response, 201, reminder);
    } catch (error) {
      return respond(response, 400, { error: error.message });
    }
  }
  const match = url.pathname.match(/^\/api\/reminders\/([a-z0-9_-]+)$/i);
  if (match && request.method === 'PUT') {
    try {
      const reminder = updateReminder(match[1], await readJson(request));
      if (!reminder) return respond(response, 404, { error: 'Pengingat tidak ditemukan.' });
      syncSchedules();
      return respond(response, 200, reminder);
    } catch (error) {
      return respond(response, 400, { error: error.message });
    }
  }
  if (match && request.method === 'DELETE') {
    if (!deleteReminder(match[1])) return respond(response, 404, { error: 'Pengingat tidak ditemukan.' });
    syncSchedules();
    return respond(response, 200, { deleted: true });
  }
  return respond(response, 404, { error: 'Halaman atau API tidak ditemukan.' });
}
