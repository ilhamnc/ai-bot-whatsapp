import test from 'node:test';
import assert from 'node:assert/strict';
import { BaileysClient } from '../src/services/baileysClient.js';

test('pesan grup dan balasan ke bot dinormalisasi untuk controller', async () => {
  const client = new BaileysClient('test', '.wa_auth');
  client.info = { wid: { _serialized: '628123@s.whatsapp.net', user: '628123' } };
  client.socket = { user: { lid: '12345@lid' }, groupMetadata: async () => ({ subject: 'Tim' }) };
  const raw = {
    key: { id: 'ABC', remoteJid: '120363@g.us', participant: '98765@lid', participantAlt: '628987@s.whatsapp.net', fromMe: false },
    pushName: 'Rani', messageTimestamp: 123,
    message: { extendedTextMessage: {
      text: 'Tes', contextInfo: {
        participant: '12345@lid', mentionedJid: ['12345@lid'],
        quotedMessage: { conversation: 'Jawaban bot' }
      }
    } }
  };
  const message = client.normalizeMessage(raw);
  assert.equal(message.from, '120363@g.us');
  assert.equal(message.author, '98765@lid');
  assert.equal(message.authorAlt, '628987@s.whatsapp.net');
  assert.equal(message.body, 'Tes');
  assert.deepEqual(message.mentionedIds, ['12345@lid']);
  assert.equal(message.hasQuotedMsg, true);
  assert.deepEqual(await message.getQuotedMessage(), { body: 'Jawaban bot', fromMe: true });
  assert.equal((await message.getChat()).name, 'Tim');
});

test('pengiriman @all dan reply diteruskan ke Baileys', async () => {
  const client = new BaileysClient('test', '.wa_auth');
  let sentContent;
  let sentOptions;
  client.socket = {
    sendMessage: async (_jid, content, options) => {
      sentContent = content;
      sentOptions = options;
      return { key: { id: 'SENT', remoteJid: '120363@g.us', fromMe: true }, message: { conversation: content.text } };
    }
  };
  let archived = 0;
  client.on('message_create', () => archived++);
  const quoted = { key: { id: 'OLD' }, message: { conversation: 'halo' } };
  await client.sendMessage('120363@g.us', 'Halo @all', { extra: { nonJidMentions: 1 }, quoted });
  assert.deepEqual(sentContent, { text: 'Halo @all', mentionAll: true });
  assert.deepEqual(sentOptions, { quoted });
  assert.equal(archived, 1);
});
