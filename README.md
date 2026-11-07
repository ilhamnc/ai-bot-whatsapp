# AiBot WhatsApp

Bot untuk satu grup WhatsApp. Bot menjawab pertanyaan melalui Gemini atau API yang kompatibel dengan format OpenAI, dan dapat mengirim reminder Senin–Jumat pukul 14.30 WIB.

## Struktur proyek

```text
server.js                       # Entry point, koneksi WhatsApp, dan jadwal cron
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
    encryptionService.js        # Enkripsi AES-256-GCM untuk data sensitif lokal
    reminderScheduler.js        # Cron job dinamis untuk setiap reminder
    whatsappConnectionService.js # Pemilihan dan penautan sesi WhatsApp
    baileysClient.js          # Adapter pesan, QR, dan koneksi Baileys
  models/
    memoryModel.js              # Penyimpanan konteks dan ringkasan percakapan
    chatHistoryModel.js          # Arsip pesan grup dan pencarian konteks lama (SQLite)
    reminderModel.js            # Data reminder dan pengiriman pesan
    botSettingsModel.js         # Riwayat akun dan grup target
  views/
    reminders.html              # UI tambah, edit, aktifkan, dan hapus reminder
reminder.txt                    # Teks lama untuk migrasi pengingat pertama
```

Aplikasi menyediakan dashboard di `http://127.0.0.1:3030` saat bot berjalan lokal. Pada hosting, Dockerfile membuka dashboard untuk koneksi luar dan mewajibkan `DASHBOARD_USER` serta `DASHBOARD_PASSWORD`. Menu **Pengaturan** berisi **Set WA Bot**, **ID Grup Bot**, dan **Zona Waktu**.

Saat pertama kali dijalankan, isi `reminder.txt` dan jadwal lama Senin–Jumat pukul 14.30 WIB otomatis menjadi reminder default. Perubahan dashboard disimpan di `.state/reminders.json`; file lama `reminder.txt` tidak dihapus.

Dashboard dapat menambah, mengedit, mengaktifkan/nonaktifkan, dan menghapus reminder. Setiap reminder mempunyai jadwal cron dan isi pesan sendiri. Zona waktu reminder mengikuti menu **Pengaturan → Zona Waktu**. Contoh cron: `30 14 * * 1-5` berarti Senin–Jumat pukul 14.30 di zona waktu terpilih.

Pengingat shalat memiliki sakelar terpisah di dashboard. Atur negara, kota, dan zona waktu lewat **Pengaturan → Zona Waktu**; zona Indonesia ditandai WIB, WITA, atau WIT. Zona waktu terpilih juga dipakai oleh jadwal reminder biasa. Waktu shalat diambil harian dari API AlAdhan dengan metode Kementerian Agama RI (metode 20). Tombol cek jadwal ada di detail jadwal shalat. Pengaturan lama otomatis mencakup semua waktu; pilih semua atau atur waktu tertentu dari detail. Setiap waktu memakai teks yang sudah tersimpan dan AI mencoba memparafrasekannya secara singkat. Jika AI gagal atau kuota habis, teks tersimpan yang dikirim. Koneksi internet diperlukan untuk mengambil jadwal harian.

## Menyiapkan bot

1. Pasang Node.js 22.13 atau lebih baru.
2. Jalankan `npm ci` di folder proyek.
3. Salin `.env.example` menjadi `.env`, buat `DATA_ENCRYPTION_KEY` dengan perintah di komentar `.env.example`, lalu atur `AI_PROVIDER`, `AI_API_KEY`, dan `AI_MODEL`.
4. Jalankan `npm start`, buka dashboard, lalu masuk ke **Pengaturan → Set WA Bot** untuk memindai QR melalui WhatsApp > Perangkat tertaut > Tautkan perangkat.
5. Di grup tujuan, kirim `!idgrup`. Grup itu langsung menjadi target jika pilihan belum dikunci. Riwayat, pilihan grup, dan kuncinya tersedia di **Pengaturan → ID Grup Bot**.
6. Kirim `!myid`. Masukkan ID dari terminal ke `BOT_ADMIN_IDS`, lalu mulai ulang bot.

Saat mengembangkan kode, jalankan `npm run dev`. Nodemon akan memulai ulang bot ketika file program atau `.env` disimpan. Pengaturan pemantauan berada di `package.json` dan mengabaikan data sesi serta `.state` agar perubahan data runtime tidak memicu restart.

AiBot menyimpan pesan teks dan caption di grup target ke `.state/chat-history.sqlite`, termasuk pesan anggota dan balasan bot. File media aslinya tidak disimpan. Arsip mulai terisi setelah bot berjalan dengan grup target terpilih; pesan lama sebelum itu tidak otomatis diimpor. Pertanyaan yang merujuk obrolan grup memakai beberapa pesan terbaru dan pesan lama yang cocok dengan kata kunci, dengan konteks arsip tambahan dibatasi sekitar 5.000 karakter. Penyimpanan tidak memanggil AI; konteks arsip hanya menambah token ketika dipakai dalam pertanyaan. Perintah admin `!hapusriwayat` menghapus arsip untuk grup aktif; `!resetai` hanya membersihkan memori percakapan AI.

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
| `!hapusriwayat` | Menghapus arsip teks grup aktif; operator saja |
| `!daftarbot @AiBot` | Mengaktifkan mention bot; operator saja |

Tuliskan `@all` atau `@semua` pada isi reminder untuk menyebut semua anggota. Perintah uji mengirim reminder aktif pertama sungguhan ke grup terpilih.

## Data dan deployment

`.env`, sesi WhatsApp, cache, dan `.state` bersifat lokal dan tidak boleh diunggah. Isi pesan arsip, memori AI, pengaturan JSON, dan file sesi Baileys dienkripsi dengan AES-256-GCM. Siapkan `DATA_ENCRYPTION_KEY` berupa 32 byte Base64 pada `.env`; gunakan nilai yang sama sebagai secret pada hosting dan simpan salinan cadangan di tempat aman. Kehilangan atau mengganti kunci membuat data lama tidak dapat dibaca. ID grup dan metadata waktu/jenis pesan di SQLite tetap terlihat agar pencarian dan pengurutan bekerja. Istilah pencarian disimpan sebagai HMAC, bukan kata aslinya.

Riwayat akun dan pilihan grup berada di `.state/bot-settings.json`; arsip chat di `.state/chat-history.sqlite`; sesi akun di `.wa_auth`. Data lama plaintext dimigrasikan otomatis saat bot mulai. Gunakan volume persisten untuk kedua direktori di server. Simpan `package-lock.json` agar deployment memakai versi dependency yang sama.

Bot memakai Baileys melalui WebSocket, tanpa Chrome. Jika sebelumnya memakai `whatsapp-web.js`, pindai ulang QR melalui menu **Set WA Bot**: format sesi lama tidak dapat dibaca Baileys.

### Railway

1. Buat service dari repository GitHub ini dan pilih Dockerfile sebagai builder.
2. Pasang volume persisten di `/data`, lalu isi `AI_API_KEY`, `DATA_ENCRYPTION_KEY`, `DASHBOARD_USER`, dan `DASHBOARD_PASSWORD` pada Variables. Salin `DATA_ENCRYPTION_KEY` yang sama dari `.env` lokal dengan aman. Isi variabel AI lain sesuai provider yang dipakai. Jangan unggah `.env`.
3. Buat domain publik untuk service, buka dashboard dengan login tadi, kemudian pindai QR di **Pengaturan → Set WA Bot**. Pilih grup dengan `!idgrup`.
4. Pastikan volume menyimpan `/data/state` dan `/data/auth` agar login WhatsApp, pengaturan, dan arsip SQLite tetap ada setelah deploy ulang.

Arsip chat otomatis menghapus pesan yang lebih lama dari 21 hari dan menjalankan pembersihan saat bot mulai serta setiap hari. `!hapusriwayat` tetap dapat menghapus seluruh arsip grup lebih awal. Memori AI menyimpan paling banyak 20 pasangan percakapan dan ringkasan hingga 1.200 karakter; memori yang tidak aktif dihapus setelah 30 hari. Ringkasan hanya merangkum percakapan AI, bukan semua chat biasa. Railway Free memiliki batas volume 0,5 GB; pantau pemakaian volumenya. Riwayat hanya merekam pesan baru di grup target saat bot berjalan.

