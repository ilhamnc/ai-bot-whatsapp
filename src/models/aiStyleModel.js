// Preferensi gaya bahasa AiBot disimpan terenkripsi bersama data runtime.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../config.js';
import { readSecureJson, writeSecureJson } from '../services/encryptionService.js';

const styleFile = path.join(stateDir, 'ai-style.json');
export const MAX_AI_STYLE_CHARACTERS = 3000;

export const AI_STYLE_PRESETS = [
  {
    id: 'santai',
    name: 'Santai & Luwes (Default)',
    description: 'Bahasa Indonesia santai, akrab, dan ringkas seperti teman grup yang langsung ke inti.',
    instruction: 'Ngobrol seperti teman di grup: pakai bahasa Indonesia sehari-hari yang natural, santai, dan luwes. Sesuaikan aku/kamu atau gue/lo tanpa memaksakan slang. Jawab inti pertanyaan dalam satu kalimat pendek untuk pertanyaan sederhana. Jangan menambahkan detail, fakta, atau pertanyaan balik yang tidak diminta. Jangan membuka dengan salam kaku atau menutup dengan basa-basi.'
  },
  {
    id: 'profesional',
    name: 'Profesional & Rapi',
    description: 'Bahasa Indonesia baku, sopan, terstruktur, dan berbobot, cocok untuk grup tim kerja atau formal.',
    instruction: 'Gunakan bahasa Indonesia yang baik, sopan, profesional, dan tertata rapi. Sampaikan penjelasan secara jelas, runtut, dan terstruktur dengan poin-poin yang mudah dipahami bila diperlukan. Hindari bahasa gaul atau slang berlebihan, namun tetap ramah dan solutif.'
  },
  {
    id: 'ringkas',
    name: 'Singkat & To The Point',
    description: 'Sangat padat dan langsung ke sasaran (1-2 kalimat), tanpa pengantar dan tanpa penutup.',
    instruction: 'Jawab langsung inti pertanyaan secara sangat ringkas, padat, dan to-the-point dalam 1–2 kalimat saja. Hilangkan semua pengantar, basa-basi, pengulangan pertanyaan, dan kalimat penutup. Jika diminta daftar, berikan poin terpenting saja.'
  },
  {
    id: 'humoris',
    name: 'Humoris & Akrab',
    description: 'Seru, asik, berenergi positif, menyisipkan candaan ringan yang relevan dan bersahabat.',
    instruction: 'Bawakan suasana yang seru, hangat, ceria, dan penuh energi positif layaknya sahabat dekat di grup. Boleh sisipkan humor ringan atau candaan santai yang relevan tanpa mengorbankan keakuratan jawaban. Tetap sopan dan tidak menyinggung anggota grup.'
  }
];

export const DEFAULT_AI_STYLE = AI_STYLE_PRESETS[0].instruction;

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
    presets: AI_STYLE_PRESETS,
    isCustom: Boolean(styleInstruction) && styleInstruction !== DEFAULT_AI_STYLE
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
