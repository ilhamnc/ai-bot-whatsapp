// Pengaturan akun WhatsApp dan grup target disimpan terpisah dari teks reminder.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TARGET_GROUP, authDir, stateDir } from '../config.js';

const settingsFile = path.join(stateDir, 'bot-settings.json');
const legacyAccountId = 'asisten-grup-ai';
const accountIdPattern = /^[a-zA-Z0-9_-]+$/;

function initialSettings() {
  const legacySession = path.join(authDir, `session-${legacyAccountId}`);
  return {
    activeAccountId: legacyAccountId,
    accounts: [{ id: legacyAccountId, phone: '', linked: fs.existsSync(legacySession), lastConnectedAt: null }],
    groupsByAccount: {
      [legacyAccountId]: {
        targetId: TARGET_GROUP,
        locked: false,
        history: TARGET_GROUP ? [{ id: TARGET_GROUP, name: 'Grup awal', lastSeenAt: null }] : []
      }
    }
  };
}

function loadSettings() {
  const fallback = initialSettings();
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (!Array.isArray(saved.accounts) || !saved.accounts.length) return fallback;
    const accounts = saved.accounts.filter(account => account && accountIdPattern.test(String(account.id)));
    if (!accounts.length) return fallback;
    const activeAccountId = accounts.some(account => account.id === saved.activeAccountId)
      ? saved.activeAccountId : accounts[0].id;
    return { activeAccountId, accounts, groupsByAccount: saved.groupsByAccount || {} };
  } catch {
    return fallback;
  }
}

const settings = loadSettings();

function saveSettings() {
  fs.mkdirSync(stateDir, { recursive: true });
  const temporaryFile = `${settingsFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(temporaryFile, settingsFile);
}

function groupSettingsFor(accountId = settings.activeAccountId) {
  if (!settings.groupsByAccount[accountId]) {
    settings.groupsByAccount[accountId] = { targetId: '', locked: false, history: [] };
  }
  return settings.groupsByAccount[accountId];
}

export function getActiveAccountId() { return settings.activeAccountId; }

export function getAccountProfiles() {
  return settings.accounts.map(account => ({ ...account }));
}

export function addAccountProfile() {
  const account = { id: `wa_${randomUUID().replace(/-/g, '')}`, phone: '', linked: false, lastConnectedAt: null };
  settings.accounts.push(account);
  groupSettingsFor(account.id);
  saveSettings();
  return { ...account };
}

export function activateAccountProfile(accountId) {
  if (!settings.accounts.some(account => account.id === accountId)) throw new Error('Akun WhatsApp tidak ditemukan.');
  settings.activeAccountId = accountId;
  groupSettingsFor(accountId);
  saveSettings();
}

export function rememberConnectedAccount(accountId, phone) {
  const account = settings.accounts.find(item => item.id === accountId);
  if (!account) return;
  account.phone = String(phone || account.phone || '').replace(/[^0-9]/g, '').slice(0, 20);
  account.linked = true;
  account.lastConnectedAt = new Date().toISOString();
  saveSettings();
}

export function markAccountUnlinked(accountId) {
  const account = settings.accounts.find(item => item.id === accountId);
  if (!account) return;
  account.linked = false;
  saveSettings();
}

export function getTargetGroup() {
  return groupSettingsFor().targetId || '';
}

export function getGroupSettings() {
  const group = groupSettingsFor();
  return { targetId: group.targetId || '', locked: group.locked === true, history: [...(group.history || [])].map(item => ({ ...item })) };
}

// !idgrup mencatat grup; grup baru otomatis menjadi target selama belum dikunci.
export function registerGroupFromCommand(groupId, groupName = '') {
  if (!String(groupId).endsWith('@g.us')) throw new Error('ID grup WhatsApp tidak valid.');
  const group = groupSettingsFor();
  const name = String(groupName || groupId).trim().slice(0, 100);
  const now = new Date().toISOString();
  group.history = (group.history || []).filter(item => item.id !== groupId);
  group.history.unshift({ id: groupId, name, lastSeenAt: now });
  if (!group.locked) group.targetId = groupId;
  // Pertahankan grup target dalam pilihan walau banyak grup lain mengirim !idgrup.
  const selected = group.history.find(item => item.id === group.targetId);
  group.history = group.history.slice(0, selected && !group.history.slice(0, 50).includes(selected) ? 49 : 50);
  if (selected && !group.history.includes(selected)) group.history.push(selected);
  saveSettings();
  return getGroupSettings();
}

export function updateGroupSettings(input) {
  const group = groupSettingsFor();
  const targetId = String(input?.targetId || '').trim();
  const locked = input?.locked === true;
  if (targetId && !(group.history || []).some(item => item.id === targetId)) {
    throw new Error('Pilih grup dari riwayat atau kirim !idgrup di grup tersebut.');
  }
  if (locked && !targetId) throw new Error('Pilih grup sebelum menguncinya.');
  group.targetId = targetId;
  group.locked = locked;
  saveSettings();
  return getGroupSettings();
}
