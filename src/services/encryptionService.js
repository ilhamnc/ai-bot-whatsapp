// Enkripsi data lokal dengan AES-256-GCM dan indeks pencarian berbasis HMAC.
import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const ENCRYPTED_PREFIX = 'aibot:enc:v1:';
let cachedKey;

function getKey() {
  if (cachedKey) return cachedKey;
  const configured = process.env.DATA_ENCRYPTION_KEY?.trim() || '';
  if (!configured) throw new Error('DATA_ENCRYPTION_KEY wajib diatur. Buat kunci 32 byte acak dan simpan sebagai secret.');
  const key = /^[a-f\d]{64}$/i.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY harus berupa 32 byte dalam Base64 atau 64 karakter heksadesimal.');
  cachedKey = key;
  return key;
}

export function validateEncryptionKey() {
  getKey();
  return true;
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptText(value) {
  const text = String(value ?? '');
  if (isEncrypted(text)) return text;
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${ENCRYPTED_PREFIX}${nonce.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptText(value) {
  const text = String(value ?? '');
  if (!isEncrypted(text)) return text;
  const [nonceText, tagText, dataText] = text.slice(ENCRYPTED_PREFIX.length).split(':');
  if (!nonceText || !tagText || dataText === undefined) throw new Error('Format data terenkripsi tidak valid.');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(nonceText, 'base64'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64')), decipher.final()]).toString('utf8');
}

function secureWrite(file, contents) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryFile = `${file}.tmp`;
  fs.writeFileSync(temporaryFile, encryptText(contents), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryFile, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows tidak memakai mode POSIX. */ }
}

export function readSecureText(file, fallback = '') {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  if (isEncrypted(raw)) return decryptText(raw);
  // Migrasi plaintext lama secara atomik setelah berhasil dibaca.
  secureWrite(file, raw);
  return raw;
}

export function writeSecureText(file, text) {
  secureWrite(file, String(text ?? ''));
}

export function readSecureJson(file, fallback = null) {
  const raw = readSecureText(file, null);
  return raw === null ? fallback : JSON.parse(raw);
}

export function writeSecureJson(file, value) {
  writeSecureText(file, JSON.stringify(value, null, 2));
}

export function tokenizeForSearch(text) {
  return [...new Set(String(text || '').toLocaleLowerCase('id-ID').match(/[\p{L}\p{N}]{3,}/gu) || [])];
}

export function createBlindIndex(value) {
  return createHmac('sha256', getKey()).update(`chat-term-v1:${String(value).toLocaleLowerCase('id-ID')}`).digest('hex');
}

export function createPrivateIdentifier(value) {
  return createHmac('sha256', getKey()).update(`private-id-v1:${String(value || 'unknown')}`).digest('hex').slice(0, 20);
}
