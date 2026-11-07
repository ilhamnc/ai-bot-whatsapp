# Deploy ke Oracle Cloud Always Free

Panduan ini untuk VM **Ubuntu ARM64** pada shape `VM.Standard.A1.Flex` berlabel *Always Free*. Pilih alokasi yang masih berada dalam batas gratis akun. Bot hanya membuka koneksi keluar ke WhatsApp dan provider AI yang dipilih, jadi tidak memerlukan port HTTP publik.

## 1. Siapkan VM

Masuk ke VM lewat SSH sebagai pengguna biasa, lalu pasang **Node.js 22.13 atau lebih baru** dan Git. Versi ini menyediakan modul SQLite bawaan yang dipakai arsip chat. Ikuti petunjuk instalasi Node.js untuk Ubuntu pada [nodejs.org](https://nodejs.org/en/download). Verifikasi dengan `node --version` dan `npm --version`.

Pada Ubuntu, Chromium tersedia sebagai Snap:

```bash
sudo snap install chromium
command -v chromium
```

Catat path yang dihasilkan (umumnya `/snap/bin/chromium`). Jangan menjalankan proses bot sebagai `root`.

## 2. Ambil kode dan siapkan data

```bash
git clone https://github.com/USERNAME/NAMA-REPO.git
cd NAMA-REPO
mkdir -p "$HOME/bot-data/state" "$HOME/bot-data/auth"
PUPPETEER_SKIP_DOWNLOAD=1 npm ci
cp .env.example .env
chmod 600 .env
```

`PUPPETEER_SKIP_DOWNLOAD=1` menghindari unduhan browser bawaan saat instalasi pada ARM64; bot memakai Chromium yang telah dipasang di VM.

Isi `.env` dengan `AI_PROVIDER`, `AI_API_KEY`, dan `AI_MODEL`. Pilih `AI_PROVIDER=gemini` atau `AI_PROVIDER=openai` serta atur `AI_BASE_URL` untuk endpoint OpenAI-compatible. `WA_GROUP_ID` bersifat opsional sebagai target awal instalasi lama. `BOT_ADMIN_IDS` dapat diisi setelah ID terlihat di terminal bot. Atur juga:

```dotenv
BOT_STATE_DIR=/home/ubuntu/bot-data/state
WA_AUTH_DIR=/home/ubuntu/bot-data/auth
PUPPETEER_EXECUTABLE_PATH=/snap/bin/chromium
```

Ganti `/home/ubuntu` bila nama pengguna atau home VM berbeda. **Kedua direktori data harus tetap ada saat kode diperbarui**: `state` menyimpan status, memori, dan database arsip `chat-history.sqlite`; `auth` menyimpan sesi WhatsApp. Jangan menaruhnya dalam Git. Cadangkan direktori `state` secara berkala.

Jalankan `npm start`. Di komputer pribadi, buka SSH tunnel dengan `ssh -L 3030:127.0.0.1:3030 ubuntu@IP_VM`, lalu buka `http://127.0.0.1:3030`. Masuk ke **Pengaturan → Set WA Bot** dan pindai QR. Kirim `!idgrup` di grup; grup otomatis menjadi target dan dapat dikunci lewat **Pengaturan → ID Grup Bot**. Setelah itu kirim `!myid`, isi `BOT_ADMIN_IDS`, dan restart bot. Jika Chromium menolak sandbox pada VM, tambahkan `PUPPETEER_NO_SANDBOX=1` ke `.env` dan jalankan ulang.

## 3. Jalankan otomatis lewat systemd

Pastikan `command -v node` memberi path Node yang dapat dipakai oleh systemd. Buat `/etc/systemd/system/bot-ai-whatsapp.service` dengan nilai pengguna dan path proyek yang sesuai:

```ini
[Unit]
Description=AiBot WhatsApp
After=network-online.target snapd.socket
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/NAMA-REPO
ExecStart=/usr/bin/node /home/ubuntu/NAMA-REPO/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Lalu jalankan:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bot-ai-whatsapp
sudo systemctl status bot-ai-whatsapp
journalctl -u bot-ai-whatsapp -f
```

Jika `node` berasal dari lokasi selain `/usr/bin/node`, ganti `ExecStart`. Untuk memperbarui kode, jalankan `git pull`, `PUPPETEER_SKIP_DOWNLOAD=1 npm ci`, lalu `sudo systemctl restart bot-ai-whatsapp`.

## Hal yang perlu dipantau

- Periksa log dan status sesudah restart. Sesi WhatsApp dapat meminta scan QR ulang.
- Jangan jalankan bot lokal dan bot VM bersamaan dengan sesi yang sama; hentikan bot lokal sebelum memindahkan pemakaian ke VM.
- OCI dapat kehabisan kapasitas shape gratis di region tertentu dan memiliki aturan reklamasi VM yang terlalu lama idle. Periksa status VM dan batas Always Free akun secara berkala.

