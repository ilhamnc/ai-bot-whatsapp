// Controller dashboard: menyajikan halaman lokal dan API untuk mengelola reminder.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TZ } from '../config.js';
import {
  createReminder, deleteReminder, getReminders, saveState,
  state, updateReminder
} from '../models/reminderModel.js';

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

// Setiap perubahan daftar memanggil scheduler agar jadwal langsung berubah.
export async function handleDashboardRequest(request, response, syncSchedules, getConnectionInfo) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/') {
    return respond(response, 200, fs.readFileSync(viewPath, 'utf8'), 'text/html; charset=utf-8');
  }
  if (request.method === 'GET' && url.pathname === '/api/reminders') {
    return respond(response, 200, {
      timezone: TZ,
      globallyEnabled: state.enabled,
      reminders: getReminders()
    });
  }
  if (request.method === 'GET' && url.pathname === '/api/connection') {
    const connectionInfo = getConnectionInfo?.() || { status: 'connecting', qrDataUrl: null };
    return respond(response, 200, connectionInfo);
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
