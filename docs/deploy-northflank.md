# Deploy AiBot di Northflank

Panduan ini memakai satu layanan Northflank untuk bot WhatsApp dan dashboard. Database SQLite, pengaturan, dan sesi WhatsApp disimpan di volume persisten. Supabase dan Vercel tidak diperlukan untuk konfigurasi awal ini.

## 1. Hubungkan GitHub

Di halaman izin GitHub App Northflank, pilih hanya repository `ilhamnc/ai-bot-whatsapp`, lalu klik **Save**. Kembali ke Northflank dan pastikan repository muncul pada daftar sumber.

Northflank menampilkan paket Sandbox gratis pada halaman harga, tetapi dokumentasi billing mereka masih menyebut metode pembayaran untuk membuat resource. Bila halaman akun meminta kartu dan kamu tidak ingin menambahkannya, hentikan pembuatan resource di sana.

## 2. Kirim kode terbaru ke GitHub

Northflank membangun kode yang sudah ada di GitHub. Pastikan `Dockerfile`, `.dockerignore`, dan perubahan dashboard sudah di-commit dan di-push. File `.env` dan direktori data tidak boleh di-push.

## 3. Buat proyek dan layanan

1. Buat proyek dengan paket **Developer Sandbox**.
2. Buat **Combined Service** bernama misalnya `aibot-whatsapp`.
3. Pilih repository `ilhamnc/ai-bot-whatsapp`, branch `main`, metode build **Dockerfile**, dan path `Dockerfile` di root repository. Isi runtime variables pada langkah 4 sebelum menekan **Create service**.
4. Gunakan **1 replica** saja. Dua proses bot dengan sesi yang sama dapat saling mengganggu.
5. Mulai dari resource **0,5 vCPU dan 1 GB RAM** jika tersedia dalam jatah Sandbox. Chromium mungkin memerlukan lebih banyak memori; pantau metrik dan log bila proses berhenti.
6. Tambahkan volume persisten dengan mount path **`/data`**. Simpan volume ini saat memperbarui layanan. `BOT_STATE_DIR` dan `WA_AUTH_DIR` sudah diarahkan ke `/data/state` dan `/data/auth` oleh Dockerfile.

## 4. Isi environment variables

Masukkan sebagai **runtime variables/secrets** di Northflank, bukan sebagai file `.env` di GitHub:

```dotenv
AI_PROVIDER=gemini
AI_API_KEY=isi_kunci_api_sendiri
AI_MODEL=gemini-3.5-flash-lite
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=isi_password_panjang_dan_unik
```

Dockerfile sudah mengatur Chromium, path penyimpanan, dan port dashboard. `WA_GROUP_ID` boleh kosong pada pemasangan baru. `BOT_ADMIN_IDS` bisa ditambahkan setelah menjalankan `!myid`.

## 5. Buka dashboard dan tautkan WhatsApp

1. Pada jaringan layanan, publikasikan port **3030 / HTTP** agar Northflank membuat alamat HTTPS.
2. Untuk health check, pakai **TCP port 3030**. Dashboard akan menolak permintaan HTTP tanpa login dengan status 401.
3. Buka URL HTTPS dari Northflank dan masukkan `DASHBOARD_USER` serta `DASHBOARD_PASSWORD`.
4. Buka **Pengaturan → Set WA Bot**, lalu pindai QR dengan akun WhatsApp yang akan dijadikan bot.
5. Di grup tujuan, kirim `!idgrup`. Bila perlu, kunci pilihan grup dari dashboard.
6. Kirim `!myid` untuk mengetahui ID admin. Tambahkan ID ke `BOT_ADMIN_IDS` pada runtime variables, lalu redeploy/restart layanan.

Dashboard memuat QR dan pengaturan bot. Jangan membagikan URL dan password dashboard kepada orang lain. Northflank juga menyediakan aturan Basic Auth pada port publik bila ingin lapisan login tambahan.

## 6. Pantau penggunaan dan data

- Cek log hingga muncul `AiBot WhatsApp terhubung` dan status bot siap.
- Pastikan volume `/data` tetap terpasang saat redeploy. Di sana ada database `chat-history.sqlite`, file pengaturan, dan sesi WhatsApp.
- Pantau pemakaian resource Sandbox. Jika Chromium kehabisan memori, layanan dapat restart dan membutuhkan resource lebih besar atau perubahan pustaka WhatsApp.
- Jangan jalankan bot lokal dan bot Northflank bersamaan dengan sesi WhatsApp yang sama.

Rujukan Northflank: [membuat combined service](https://northflank.com/docs/v1/application/getting-started/build-and-deploy-your-code), [menambah volume](https://northflank.com/docs/v1/application/databases-and-persistence/add-a-volume), dan [mengatur port](https://northflank.com/docs/v1/application/network/configure-ports).
