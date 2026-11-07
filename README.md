# AiBot WhatsApp

Bot untuk satu grup WhatsApp. Bot menjawab pertanyaan melalui Gemini atau API yang kompatibel dengan format OpenAI, dan dapat mengirim reminder Senin–Jumat pukul 14.30 WIB.

## Struktur proyek

```text
server.js                       # Entry point, koneksi WhatsApp, dan jadwal cron
bot.js                          # Alias kompatibilitas untuk server.js
src/
  config.js                     # Environment, validasi, dan lokasi penyimpanan
  routes/
    messageRoutes.js            # Mendaftarkan route event pesan WhatsApp
    dashboardRoutes.js          # Server HTTP dashboard reminder lokal
  controllers/
    messageController.js        # Perintah grup dan alur respons pesan
    dashboardController.js      # API pengelolaan reminder
  services/
    aiService.js                # Provider AI, fallback model, antrean, dan kuota
    reminderScheduler.js        # Cron job dinamis untuk setiap reminder
    whatsappConnectionService.js # Pemilihan dan penautan sesi WhatsApp
  models/
    memoryModel.js              # Penyimpanan konteks dan ringkasan percakapan
    reminderModel.js            # Data reminder dan pengiriman pesan
    botSettingsModel.js         # Riwayat akun dan grup target
  views/
    reminders.html              # UI tambah, edit, aktifkan, dan hapus reminder
reminder.txt                    # Teks lama untuk migrasi pengingat pertama
```

Aplikasi menyediakan dashboard di `http://127.0.0.1:3030` saat bot berjalan. Dashboard hanya menerima koneksi lokal. Jika bot berjalan di server, gunakan SSH tunnel untuk membukanya dengan aman. Menu **Pengaturan** berisi **Set WA Bot**, **ID Grup Bot**, dan **Zona Waktu**.

Saat pertama kali dijalankan, isi `reminder.txt` dan jadwal lama Senin–Jumat pukul 14.30 WIB otomatis menjadi reminder default. Perubahan dashboard disimpan di `.state/reminders.json`; file lama `reminder.txt` tidak dihapus.

Dashboard dapat menambah, mengedit, mengaktifkan/nonaktifkan, dan menghapus reminder. Setiap reminder mempunyai jadwal cron dan isi pesan sendiri. Zona waktu reminder mengikuti menu **Pengaturan → Zona Waktu**. Contoh cron: `30 14 * * 1-5` berarti Senin–Jumat pukul 14.30 di zona waktu terpilih.

Pengingat shalat memiliki sakelar terpisah di dashboard. Atur negara, kota, dan zona waktu lewat **Pengaturan → Zona Waktu**; zona Indonesia ditandai WIB, WITA, atau WIT. Zona waktu terpilih juga dipakai oleh jadwal reminder biasa. Waktu shalat diambil harian dari API AlAdhan dengan metode Kementerian Agama RI (metode 20). Tombol cek jadwal ada di detail jadwal shalat. Pengaturan lama otomatis mencakup semua waktu; pilih semua atau atur waktu tertentu dari detail. Setiap waktu memakai teks yang sudah tersimpan dan AI mencoba memparafrasekannya secara singkat. Jika AI gagal atau kuota habis, teks tersimpan yang dikirim. Koneksi internet diperlukan untuk mengambil jadwal harian.

## Menyiapkan bot

1. Pasang Node.js 22 atau lebih baru dan Chrome/Chromium.
2. Jalankan `npm ci` di folder proyek.
3. Salin `.env.example` menjadi `.env` dan atur `AI_PROVIDER`, `AI_API_KEY`, serta `AI_MODEL`.
4. Jalankan `npm start`, buka dashboard, lalu masuk ke **Pengaturan → Set WA Bot** untuk memindai QR melalui WhatsApp > Perangkat tertaut > Tautkan perangkat.
5. Di grup tujuan, kirim `!idgrup`. Grup itu langsung menjadi target jika pilihan belum dikunci. Riwayat, pilihan grup, dan kuncinya tersedia di **Pengaturan → ID Grup Bot**.
6. Kirim `!myid`. Masukkan ID dari terminal ke `BOT_ADMIN_IDS`, lalu mulai ulang bot.

Saat mengembangkan kode, jalankan `npm run dev`. Nodemon akan memulai ulang bot ketika file program atau `.env` disimpan. Pengaturan pemantauan berada di `package.json` dan mengabaikan data sesi serta `.state` agar perubahan data runtime tidak memicu restart.

Menu **Set WA Bot** menampilkan riwayat nomor. Tombol × pada satu akun menghapus profil dan sesi lokalnya; untuk akun aktif bot juga mencoba keluar dari WhatsApp. Jika akun lama yang tidak aktif masih tercantum pada **Perangkat tertaut** di ponsel, lepaskan dari aplikasi WhatsApp. Menu **ID Grup Bot** menampilkan nama grup bila WhatsApp menyediakannya, serta menerima ID manual berbentuk `120363...@g.us`. ID tersebut berasal dari WhatsApp dan dapat dilihat lewat balasan `!idgrup`; bot harus menjadi anggota grup agar dapat mengirim pesan.

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
| `!ai pertanyaan` atau `@AiBot pertanyaan` | Bertanya ke AI |
| Balas pesan AiBot | Melanjutkan obrolan tanpa mention |
| `!schedule`, `!status`, `!model`, `!memori` | Melihat status bot dan semua jadwal reminder |
| `!help` | Daftar perintah |
| `!idgrup` | Mencatat grup dan menjadikannya target jika belum dikunci |
| `!myid` | Menampilkan ID pengirim di terminal bot |
| `!reminder on` / `!reminder off` | Mengubah status reminder; operator saja |
| `!testreminder` / `!testkirim` | Mengirim reminder uji dengan @all; operator saja |
| `!resetai` | Mengosongkan memori AI; operator saja |
| `!daftarbot @AiBot` | Mengaktifkan mention bot; operator saja |

Tuliskan `@all` atau `@semua` pada isi reminder untuk menyebut semua anggota. Perintah uji mengirim reminder aktif pertama sungguhan ke grup terpilih.

## Data dan deployment

`.env`, sesi WhatsApp, cache, dan `.state` bersifat lokal dan tidak boleh diunggah. Riwayat akun dan pilihan grup disimpan di `.state/bot-settings.json`; sesi akun yang masih tertaut disimpan di `.wwebjs_auth`. Simpan kedua direktori pada disk persisten jika bot dijalankan di server. Simpan `package-lock.json` agar deployment memakai versi dependency yang sama. Untuk deployment OCI, lihat [panduan deploy](docs/deploy-oci.md).

Bot menggunakan `whatsapp-web.js` yang bergantung pada WhatsApp Web. Pastikan proses bot selalu berjalan agar reminder terjadwal dapat dikirim.

