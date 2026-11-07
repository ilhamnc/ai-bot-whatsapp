# Bot AI WhatsApp

Bot untuk satu grup WhatsApp. Bot menjawab pertanyaan melalui Gemini atau API yang kompatibel dengan format OpenAI, dan dapat mengirim reminder Seninâ€“Jumat pukul 14.30 WIB.

## Struktur proyek

```text
server.js                       # Entry point, koneksi WhatsApp, dan jadwal cron
bot.js                          # Alias kompatibilitas untuk server.js
src/
  config.js                     # Environment, validasi, dan lokasi penyimpanan
  routes/
    messageRoutes.js            # Mendaftarkan route event pesan WhatsApp
  controllers/
    messageController.js        # Perintah grup dan alur respons pesan
  services/
    aiService.js                # Provider AI, fallback model, antrean, dan kuota
  models/
    memoryModel.js              # Penyimpanan konteks dan ringkasan percakapan
    reminderModel.js            # Status serta pengiriman reminder
  views/
    README.md                   # Titik awal untuk template dashboard mendatang
reminder.txt                    # Isi reminder yang dibaca saat akan dikirim
```

Aplikasi saat ini adalah bot WhatsApp berbasis terminal, jadi folder `views` disiapkan untuk antarmuka edit konfigurasi di masa mendatang dan belum menyajikan halaman web.
## Menyiapkan bot

1. Pasang Node.js 22 atau lebih baru dan Chrome/Chromium.
2. Jalankan `npm ci` di folder proyek.
3. Salin `.env.example` menjadi `.env` dan atur `AI_PROVIDER`, `AI_API_KEY`, serta `AI_MODEL`.
4. Jalankan `npm start`, lalu pindai QR melalui WhatsApp â†’ Perangkat tertaut.
5. Di grup tujuan, kirim `!idgrup`. Salin ID dari terminal ke `WA_GROUP_ID`, lalu mulai ulang bot.
6. Kirim `!myid`. Masukkan ID dari terminal ke `BOT_ADMIN_IDS`, lalu mulai ulang bot.

Contoh Gemini:

```env
AI_PROVIDER=gemini
AI_API_KEY=...
AI_MODEL=gemini-3.5-flash-lite
AI_FALLBACK_MODELS=gemini-3.1-flash-lite,gemini-2.5-flash
```

Contoh API OpenAI-compatible:

```env
AI_PROVIDER=openai
AI_API_KEY=...
AI_MODEL=gpt-4o-mini
AI_BASE_URL=https://api.openai.com/v1
AI_FALLBACK_MODELS=gpt-4o-mini
```

`AI_BASE_URL` harus menunjuk ke base URL yang menyediakan endpoint `/chat/completions`. Setiap provider dapat memiliki nama model, format error, dan dukungan fitur yang berbeda. Untuk instalasi lama, `GEMINI_API_KEY`, `GEMINI_MODEL`, dan `GEMINI_FALLBACK_MODELS` tetap dibaca sebagai nilai pengganti.

## Perintah grup

| Perintah | Kegunaan |
|---|---|
| `!ai pertanyaan` atau `@Bot Saya pertanyaan` | Bertanya ke AI |
| `!jadwal`, `!status`, `!model`, `!memori` | Melihat status bot dan konteks |
| `!help` | Daftar perintah |
| `!idgrup`, `!myid` | Menampilkan ID di terminal bot |
| `!reminder on` / `!reminder off` | Mengubah status reminder; operator saja |
| `!testreminder` / `!testkirim` | Mengirim reminder uji dengan @all; operator saja |
| `!resetai` | Mengosongkan memori AI; operator saja |
| `!daftarbot @Bot Saya` | Mengaktifkan mention bot; operator saja |

Tuliskan `@all` atau `@semua` di `reminder.txt` untuk menyebut semua anggota. Perintah uji mengirim pesan sungguhan ke grup terpilih.

## Data dan deployment

`.env`, sesi WhatsApp, cache, dan `.state` bersifat lokal dan tidak boleh diunggah. Simpan `package-lock.json` agar deployment memakai versi dependency yang sama. Untuk deployment OCI, lihat [panduan deploy](docs/deploy-oci.md).

Bot menggunakan `whatsapp-web.js` yang bergantung pada WhatsApp Web. Pastikan proses bot selalu berjalan agar reminder terjadwal dapat dikirim.

