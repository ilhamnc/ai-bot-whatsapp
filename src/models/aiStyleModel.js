// Preferensi gaya bahasa AiBot disimpan terenkripsi bersama data runtime.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../config.js';
import { readSecureJson, writeSecureJson } from '../services/encryptionService.js';

const styleFile = path.join(stateDir, 'ai-style.json');
export const MAX_AI_STYLE_CHARACTERS = 3000;
export const DEFAULT_AI_STYLE = 'Ngobrol seperti teman di grup: pakai bahasa Indonesia sehari-hari yang natural dan santai. Sesuaikan aku/kamu atau gue/lo dengan konteks; jangan memaksakan slang, candaan, atau emoji. Jawab inti pertanyaan dengan ringkas—untuk pertanyaan sederhana satu kalimat cukup. Jangan membuka jawaban dengan perkenalan, mengulang pertanyaan, atau menutup dengan tawaran bantuan yang tidak diminta.';

function loadStyle() {
  const saved = readSecureJson(styleFile, {});
  return typeof saved?.styleInstruction === 'string'
    ? saved.styleInstruction.slice(0, MAX_AI_STYLE_CHARACTERS)
    : '';
}

let styleInstruction = loadStyle();

export function getAiStyleInstruction() {
  return styleInstruction || DEFAULT_AI_STYLE;
}

export function getAiStyleSettings() {
  return {
    styleInstruction: getAiStyleInstruction(),
    defaultStyle: DEFAULT_AI_STYLE,
    isCustom: Boolean(styleInstruction)
  };
}

export function saveAiStyleSettings(input) {
  if (typeof input?.styleInstruction !== 'string') {
    throw new Error('Isi gaya bahasa harus berupa teks.');
  }
  const nextStyle = input.styleInstruction.trim();
  if (nextStyle.length > MAX_AI_STYLE_CHARACTERS) {
    throw new Error(`Gaya bahasa maksimal ${MAX_AI_STYLE_CHARACTERS} karakter.`);
  }
  styleInstruction = nextStyle;
  fs.mkdirSync(stateDir, { recursive: true });
  writeSecureJson(styleFile, { styleInstruction });
  return getAiStyleSettings();
}
