# VPS Monitor Bot

Bot Discord untuk memantau VPS secara real-time. Dashboard berupa **satu pesan embed** yang diperbarui setiap 5 detik, plus alert merah saat CPU atau RAM melewati ambang batas.

## Fitur

- Dashboard live di `ROUTINE_CHANNEL_ID` (edit pesan yang sama, bukan spam)
- OS, uptime, CPU, RAM, disk, statistik proses, dan top 5 proses
- Progress bar visual untuk CPU, RAM, dan disk
- Alert merah ke `ALERT_CHANNEL_ID` jika CPU > 85% atau RAM > 90%
- Cooldown alert 5 menit agar channel tidak dibanjiri
- Hanya `ALLOWED_USER_ID` yang boleh memakai slash command `/status`
- Error metrik ditangkap agar bot tidak crash

## Struktur

```
.
├── .env.example
├── .gitignore
├── index.js
├── package.json
└── README.md
```

## Persiapan Discord

1. Buka [Discord Developer Portal](https://discord.com/developers/applications) lalu buat aplikasi.
2. Di tab **Bot**, reset/copy token, lalu aktifkan **Message Content Intent** tidak wajib (bot ini hanya edit pesan sendiri).
3. Undang bot ke server dengan permission:
   - View Channel
   - Send Messages
   - Embed Links
   - Read Message History
4. Aktifkan Developer Mode, lalu salin User ID, Routine Channel ID, dan Alert Channel ID.

## Menjalankan

```bash
npm install
copy .env.example .env
```

Isi `.env`, kemudian:

```bash
npm start
```

Mode pengembangan (restart otomatis saat file berubah, Node 18+):

```bash
npm run dev
```

## Catatan

- Bot harus punya akses baca/tulis di kedua channel.
- Penggunaan disk dijumlahkan dari semua volume yang dilaporkan `systeminformation`.
- Top proses diurutkan dari kombinasi CPU% + RAM%.
- Slash command `/status` bersifat opsional. Dashboard tetap jalan otomatis tanpa command.
