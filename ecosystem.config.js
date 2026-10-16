module.exports = {
  apps: [
    {
      name: "vps-discord-monitor",
      script: "index.js",
      mode: "fork",
      // Restart jika penggunaan RAM melebihi 200MB
      max_memory_restart: "200M",
      // Menyimpan log di folder logs
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      // Pastikan bot tidak restart saat file log berubah
      watch: false,
      // Variabel lingkungan (opsional)
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
