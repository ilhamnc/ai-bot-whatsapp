# Deploy ke Oracle Cloud Always Free

Panduan ini untuk VM **Ubuntu ARM64** pada shape `VM.Standard.A1.Flex` berlabel *Always Free*. Buat VM di **home region** OCI dan pastikan alokasi tetap dalam kuota gratis. Bot hanya membuka koneksi keluar ke WhatsApp dan provider AI, jadi tidak perlu membuka port dashboard ke internet.

## 0. Buat VM di OCI Console

1. Buka **Compute → Instances → Create instance**.
2. Beri nama, misalnya `aibot-whatsapp`; pilih **Ubuntu ARM64**.
3. Pada *Placement*, gunakan home region akun. Pilih shape `VM.Standard.A1.Flex` dan alokasikan paling banyak total **2 OCPU dan 12 GB RAM** untuk tetap dalam jatah Always Free. Untuk mulai, 1 OCPU dan 6 GB RAM biasanya cukup.
4. Pada *Networking*, buat/pilih VCN dengan subnet publik dan tetapkan IPv4 publik. Biarkan port aplikasi tertutup; akses dashboard akan lewat SSH. Pastikan TCP port 22 di security list/NSG hanya mengizinkan IP publik kamu.
5. Tambahkan public SSH key milikmu atau buat pasangan kunci dari OCI. Simpan private key dengan aman; private key tidak bisa diambil ulang dari OCI.
6. Buat VM, lalu catat IPv4 publiknya. Hubungkan dari PowerShell:

```powershell
ssh -i C:\path\ke\oci-key.key ubuntu@IP_PUBLIK_VM
```

Dokumentasi OCI: [membuat instance](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm) dan [menghubungkan ke Linux](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/connect-to-linux-instance.htm).

## 1. Siapkan VM

Masuk ke VM lewat SSH sebagai pengguna biasa, lalu pasang **Node.js 22.13 atau lebih baru** dan Git. Versi ini menyediakan modul SQLite bawaan yang dipakai arsip chat. Ikuti petunjuk instalasi Node.js untuk Ubuntu pada [nodejs.org](https://nodejs.org/en/download). Verifikasi dengan `node --version`, `npm --version`, dan `command -v node`.

Pada Ubuntu, Chromium tersedia sebagai Snap:

```bash
sudo snap install chromium
command -v chromium
```

Catat path yang dihasilkan (umumnya `/snap/bin/chromium`). Jangan menjalankan proses bot sebagai `root`.

## 2. Ambil kode dan siapkan data

```bash
git clone https://github.com/ilhamnc/ai-bot-whatsapp.git
cd ai-bot-whatsapp
mkdir -p "$HOME/bot-data/state" "$HOME/bot-data/auth"
PUPPETEER_SKIP_DOWNLOAD=1 npm ci
cp .env.example .env
chmod 600 .env
```

`PUPPETEER_SKIP_DOWNLOAD=1` menghindari unduhan browser bawaan saat instalasi pada ARM64; bot memakai Chromium yang telah dipasang di VM.

Isi `.env` dengan `AI_PROVIDER`, `AI_API_KEY`, dan `AI_MODEL`. Pilih `AI_PROVIDER=gemini` atau `AI_PROVIDER=openai` serta atur `AI_BASE_URL` untuk endpoint OpenAI-compatible. Jangan masukkan `.env` atau kunci API ke Git. `WA_GROUP_ID` opsional; kamu bisa memilih grup dari dashboard setelah bot ditautkan. `BOT_ADMIN_IDS` dapat diisi setelah ID terlihat di terminal bot. Atur juga:

```dotenv
BOT_STATE_DIR=/home/ubuntu/bot-data/state
WA_AUTH_DIR=/home/ubuntu/bot-data/auth
PUPPETEER_EXECUTABLE_PATH=/snap/bin/chromium
```

Ganti `/home/ubuntu` bila nama pengguna atau home VM berbeda. **Kedua direktori data harus tetap ada saat kode diperbarui**: `state` menyimpan status, memori, dan database arsip `chat-history.sqlite`; `auth` menyimpan sesi WhatsApp. Jangan menaruhnya dalam Git. Cadangkan direktori `state` secara berkala.

Jalankan `npm start` sementara untuk melihat apakah bot bisa dibuka. Di komputer pribadi, buka SSH tunnel di terminal kedua:

```powershell
ssh -i C:\path\ke\oci-key.key -L 3030:127.0.0.1:3030 ubuntu@IP_PUBLIK_VM
```

Buka `http://127.0.0.1:3030`. Di **Pengaturan → Set WA Bot**, tautkan WhatsApp dengan memindai QR. Kirim `!idgrup` di grup; grup otomatis menjadi target dan dapat dikunci lewat **Pengaturan → ID Grup Bot**. Kirim `!myid` untuk mengetahui ID WhatsApp admin, masukkan ID itu ke `BOT_ADMIN_IDS` pada `.env`, lalu hentikan proses sementara dengan `Ctrl+C`. Jika Chromium menolak sandbox pada VM, tambahkan `PUPPETEER_NO_SANDBOX=1` ke `.env`. Setelah konfigurasi selesai, jalankan bot sebagai service systemd pada langkah berikutnya.

## 3. Jalankan otomatis lewat systemd

Pastikan `command -v node` memberi path Node yang dapat dipakai oleh systemd. Buka file service dengan `sudo nano /etc/systemd/system/bot-ai-whatsapp.service`, lalu isi dengan konfigurasi di bawah. Contoh ini memakai folder repo `/home/ubuntu/ai-bot-whatsapp` dan mengasumsikan `command -v node` menghasilkan `/usr/bin/node`:

```ini
[Unit]
Description=AiBot WhatsApp
After=network-online.target snapd.socket
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/ai-bot-whatsapp
ExecStart=/usr/bin/node /home/ubuntu/ai-bot-whatsapp/server.js
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

Jika `node` berasal dari lokasi selain `/usr/bin/node`, ganti `ExecStart`. Untuk memperbarui kode, jalankan `git pull`, `PUPPETEER_SKIP_DOWNLOAD=1 npm ci`, lalu `sudo systemctl restart bot-ai-whatsapp`. Jangan hapus direktori `bot-data` saat memperbarui kode. Dashboard tetap privat di `127.0.0.1`; buka tunnel SSH lagi dari komputer untuk mengaksesnya.

## Hal yang perlu dipantau

- Periksa log dan status sesudah restart. Sesi WhatsApp dapat meminta scan QR ulang.
- Jangan jalankan bot lokal dan bot VM bersamaan dengan sesi yang sama; hentikan bot lokal sebelum memindahkan pemakaian ke VM.
- OCI dapat kehabisan kapasitas shape gratis di region tertentu dan memiliki aturan reklamasi VM yang terlalu lama idle. Periksa status VM dan batas Always Free akun secara berkala.

