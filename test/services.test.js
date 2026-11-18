import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasBotNameMention, removeBotTag, extractQuestionText, getQuotedMessageDetails
} from '../src/services/mentionService.js';
import {
  buildChatSystemPrompt, formatUserMessage, isGreetingOnly,
  questionNeedsGroupContext, getPrayerTimeRequest
} from '../src/services/promptService.js';
import { getAiStyleSettings, AI_STYLE_PRESETS } from '../src/models/aiStyleModel.js';
import { checkIsAdmin } from '../src/controllers/commandController.js';

test('mentionService mendeteksi berbagai variasi panggilan bot', () => {
  assert.equal(hasBotNameMention('@AiBot halo'), true);
  assert.equal(hasBotNameMention('@aibot tolong bantu'), true);
  assert.equal(hasBotNameMention('@ibot tolong bantu'), true);
  assert.equal(hasBotNameMention('bot, apa kabar?'), true);
  assert.equal(hasBotNameMention('aibot: tolong rangkum'), true);
  assert.equal(hasBotNameMention('ibot, tolong rangkum'), true);
  assert.equal(hasBotNameMention('Ini enak ga bot?'), true);
  assert.equal(hasBotNameMention('Ini enak ga ibot?'), true);
  assert.equal(hasBotNameMention('Ini enak ga aibot?'), true);
  assert.equal(hasBotNameMention('Ini enak ga bot'), true);
  assert.equal(hasBotNameMention('Ini kira2 enak ga @~AiBot 🤖 ?'), true);
  assert.equal(hasBotNameMention('menurut bot gimana?'), true);
  assert.equal(hasBotNameMention('menurut ibot gimana?'), true);
  assert.equal(hasBotNameMention('cuaca hari ini cerah'), false);
  assert.equal(hasBotNameMention('sistem bot ini bagus'), false);
});

test('mentionService membersihkan tag dan mengekstrak pertanyaan', () => {
  assert.equal(extractQuestionText('!ai cara membuat kue'), 'cara membuat kue');
  assert.equal(extractQuestionText('@AiBot rekomendasi film'), 'rekomendasi film');
  assert.equal(extractQuestionText('@ibot rekomendasi film'), 'rekomendasi film');
  assert.equal(extractQuestionText('bot, rekomendasi buku'), 'rekomendasi buku');
  assert.equal(extractQuestionText('aibot: apa itu nodejs'), 'apa itu nodejs');
  assert.equal(extractQuestionText('ibot: apa itu nodejs'), 'apa itu nodejs');
  assert.equal(extractQuestionText('Ini enak ga bot?'), 'Ini enak ga');
  assert.equal(extractQuestionText('Ini enak ga ibot?'), 'Ini enak ga');
  assert.equal(extractQuestionText('Ini enak ga aibot?'), 'Ini enak ga');
  assert.equal(extractQuestionText('Ini kira2 enak ga @~AiBot 🤖 ?'), 'Ini kira2 enak ga?');
});

test('mentionService membaca detail pesan kutipan baik dari bot maupun anggota lain', async () => {
  const msgFromBot = {
    hasQuotedMsg: true,
    getQuotedMessage: async () => ({ body: 'Kutipan bot', fromMe: true })
  };
  const quotedBot = await getQuotedMessageDetails(msgFromBot);
  assert.equal(quotedBot.body, 'Kutipan bot');
  assert.equal(quotedBot.fromMe, true);

  const msgFromMember = {
    hasQuotedMsg: true,
    quotedParticipant: '628999@s.whatsapp.net',
    getQuotedMessage: async () => ({ body: 'Pesan anggota lain', fromMe: false })
  };
  const quotedMember = await getQuotedMessageDetails(msgFromMember);
  assert.equal(quotedMember.body, 'Pesan anggota lain');
  assert.equal(quotedMember.fromMe, false);
});

test('promptService mendeteksi kebutuhan konteks grup dan sapaan', () => {
  assert.equal(isGreetingOnly('halo'), true);
  assert.equal(isGreetingOnly('pagi AiBot!'), false);
  assert.equal(isGreetingOnly('assalamu\'alaikum'), true);

  assert.equal(questionNeedsGroupContext('terus gimana kelanjutannya?'), true);
  assert.equal(questionNeedsGroupContext('yang dibahas tadi apa ya?'), true);
  assert.equal(questionNeedsGroupContext('siapa yang bilang begitu?'), true);
  assert.equal(questionNeedsGroupContext('apa ibukota perancis?'), false);
});

test('promptService memformat pesan user dengan kutipan yang relevan', () => {
  const formatted = formatUserMessage({
    senderKey: 'user123',
    senderLabel: 'Budi',
    question: 'ini worth it gak?',
    quotedMessage: { body: 'Dijual laptop 10jt', fromMe: false }
  });
  assert.match(formatted, /WHATSAPP_QUOTED_MEMBER_MESSAGE/);
  assert.match(formatted, /Dijual laptop 10jt/);
  assert.match(formatted, /ini worth it gak\?/);
});

test('promptService menyusun prompt sistem yang luwes dan ramah grup', () => {
  const prompt = buildChatSystemPrompt({
    styleInstruction: 'Santai dan cerdas',
    contextMode: 'grup',
    isReplyToBot: false,
    isReplyToMember: true
  });
  assert.match(prompt, /AiBot/);
  assert.match(prompt, /luwes/i);
  assert.match(prompt, /KUTIPAN PESAN ANGGOTA LAIN/);
});

test('promptService mendeteksi pertanyaan jadwal shalat', () => {
  const reqSubuh = getPrayerTimeRequest('jadwal sholat subuh hari ini jam berapa');
  assert.notEqual(reqSubuh, null);
  assert.equal(reqSubuh.prayer, 'Fajr');

  const reqBukan = getPrayerTimeRequest('kenapa waktu sholat berbeda di tiap daerah?');
  assert.equal(reqBukan, null);
});

test('aiStyleModel menyediakan preset gaya bahasa yang lengkap', () => {
  const settings = getAiStyleSettings();
  assert.ok(Array.isArray(settings.presets));
  assert.equal(settings.presets.length >= 4, true);
  assert.equal(settings.presets.some(p => p.id === 'santai'), true);
  assert.equal(settings.presets.some(p => p.id === 'profesional'), true);
});

test('commandController checkIsAdmin mencocokkan ID pengirim dengan BOT_ADMIN_IDS', () => {
  process.env.BOT_ADMIN_IDS = '628111@s.whatsapp.net, 628222@c.us';
  assert.equal(checkIsAdmin(['628111@s.whatsapp.net']), true);
  assert.equal(checkIsAdmin(['628333@s.whatsapp.net']), false);
});
