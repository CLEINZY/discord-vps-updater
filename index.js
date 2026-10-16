require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
} = require("discord.js");
const si = require("systeminformation");

const {
  DISCORD_TOKEN,
  ALLOWED_USER_ID,
  ROUTINE_CHANNEL_ID,
  ALERT_CHANNEL_ID,
} = process.env;

const UPDATE_INTERVAL_MS = 5_000;
const ALERT_COOLDOWN_MS = 5 * 60_000;
const CPU_ALERT_THRESHOLD = 85;
const RAM_ALERT_THRESHOLD = 90;
const DISK_ALERT_THRESHOLD = 85;
const LATENCY_ALERT_THRESHOLD = 150;
const TOP_PROCESS_COUNT = 5;
const PROCESS_LIST_LIMIT = 15;

const requiredEnv = [
  "DISCORD_TOKEN",
  "ALLOWED_USER_ID",
  "ROUTINE_CHANNEL_ID",
  "ALERT_CHANNEL_ID",
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`[config] Variabel lingkungan ${key} belum diisi. Salin .env.example ke .env lalu isi nilainya.`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

let routineMessage = null;
let lastAlertAt = 0;
let updateTimer = null;
let updating = false;

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / 1024 ** i;
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts = [];
  if (days) parts.push(`${days}h`);
  if (days || hours) parts.push(`${hours}j`);
  parts.push(`${minutes}m`);
  parts.push(`${secs}d`);
  return parts.join(" ");
}

function progressBar(percent, length = 16) {
  const pct = clampPercent(percent);
  const filled = Math.round((pct / 100) * length);
  const empty = length - filled;
  return `${"█".repeat(filled)}${"░".repeat(empty)} ${pct.toFixed(1)}%`;
}

function statusColor(cpu, ram, disk, latency) {
  if (
    cpu >= CPU_ALERT_THRESHOLD ||
    ram >= RAM_ALERT_THRESHOLD ||
    disk >= DISK_ALERT_THRESHOLD ||
    latency >= LATENCY_ALERT_THRESHOLD
  ) {
    return 0xed4245;
  }
  if (cpu >= 70 || ram >= 75 || disk >= 70 || latency >= 100) {
    return 0xfee75c;
  }
  return 0x57f287;
}

function statusLabel(cpu, ram, disk, latency) {
  if (
    cpu >= CPU_ALERT_THRESHOLD ||
    ram >= RAM_ALERT_THRESHOLD ||
    disk >= DISK_ALERT_THRESHOLD ||
    latency >= LATENCY_ALERT_THRESHOLD
  ) {
    return "KRITIS";
  }
  if (cpu >= 70 || ram >= 75 || disk >= 70 || latency >= 100) {
    return "WASPADA";
  }
  return "SEHAT";
}

function networkStatusIndicator(latency) {
  if (latency < 80) return "⚡ Cepat";
  if (latency <= 150) return "⚠️ Sedang";
  return "🐢 Lambat";
}

function truncate(text, max = 32) {
  const value = String(text || "unknown").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

async function getPublicIP() {
  try {
    const checkResult = await si.inetChecksite("https://api.ipify.org?format=json");
    if (checkResult && checkResult.ok) {
      const response = await fetch("https://api.ipify.org?format=json");
      const data = await response.json();
      return data.ip || "N/A";
    }
  } catch (error) {
    console.warn("[network] Gagal mengambil Public IP:", error.message);
  }
  return "N/A";
}

async function getLocalIP() {
  try {
    const ifaces = await si.networkInterfaces();
    const publicIface = ifaces.find(
      (iface) =>
        iface.ip4 &&
        !iface.internal &&
        iface.operstate === "up" &&
        iface.ip4 !== "127.0.0.1"
    );
    return publicIface ? publicIface.ip4 : "N/A";
  } catch (error) {
    console.warn("[network] Gagal mengambil Local IP:", error.message);
    return "N/A";
  }
}

async function getNetworkLatency() {
  try {
    const latency = await si.inetLatency("8.8.8.8");
    return Number(latency) || 0;
  } catch (error) {
    console.warn("[network] Gagal mengukur latency:", error.message);
    return 0;
  }
}

async function collectMetrics() {
  const [osInfo, time, cpuLoad, mem, fsSize, processes] = await Promise.all([
    si.osInfo(),
    si.time(),
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.processes(),
  ]);

  let publicIP = "N/A";
  let localIP = "N/A";
  let latency = 0;

  try {
    [publicIP, localIP, latency] = await Promise.all([
      getPublicIP(),
      getLocalIP(),
      getNetworkLatency(),
    ]);
  } catch (error) {
    console.warn("[network] Error saat mengambil data jaringan:", error.message);
  }

  const cpu = clampPercent(cpuLoad.currentLoad);
  const ramUsed = mem.active || mem.used;
  const ramTotal = mem.total || 1;
  const ramPercent = clampPercent((ramUsed / ramTotal) * 100);

  const disks = Array.isArray(fsSize) ? fsSize : [];
  const diskUsed = disks.reduce((sum, disk) => sum + (Number(disk.used) || 0), 0);
  const diskTotal = disks.reduce((sum, disk) => sum + (Number(disk.size) || 0), 0);
  const diskPercent = diskTotal > 0 ? clampPercent((diskUsed / diskTotal) * 100) : 0;

  const list = Array.isArray(processes.list) ? processes.list : [];
  const top = [...list]
    .sort((a, b) => {
      const scoreA = (Number(a.cpu) || 0) + (Number(a.mem) || 0);
      const scoreB = (Number(b.cpu) || 0) + (Number(b.mem) || 0);
      return scoreB - scoreA;
    })
    .slice(0, TOP_PROCESS_COUNT);

  const processListSorted = [...list]
    .sort((a, b) => (Number(b.cpu) || 0) - (Number(a.cpu) || 0))
    .slice(0, PROCESS_LIST_LIMIT);

  return {
    os: `${osInfo.distro || osInfo.platform || "Unknown"} ${osInfo.release || ""}`.trim(),
    hostname: osInfo.hostname || "unknown",
    arch: osInfo.arch || "-",
    uptime: formatUptime(time.uptime),
    cpu,
    cpuCores: cpuLoad.cpus?.length || 0,
    ramUsed,
    ramTotal,
    ramPercent,
    diskUsed,
    diskTotal,
    diskPercent,
    diskCount: disks.length,
    processTotal: processes.all || list.length,
    processRunning: processes.running || 0,
    processSleeping: processes.sleeping || 0,
    processBlocked: processes.blocked || 0,
    top,
    processListSorted,
    publicIP,
    localIP,
    latency,
  };
}

function buildProcessListCodeblock(processList) {
  if (!processList || processList.length === 0) {
    return "```\nTidak ada data proses.\n```";
  }

  const header = "PID       %CPU   %RAM   NAME";
  const separator = "━".repeat(48);
  let lines = [header, separator];
  let currentLength = header.length + separator.length + 20;

  for (const proc of processList) {
    const pid = String(proc.pid || 0).padEnd(9);
    const cpu = (Number(proc.cpu) || 0).toFixed(1).padStart(6);
    const mem = (Number(proc.mem) || 0).toFixed(1).padStart(6);
    const name = truncate(proc.name, 22);
    const line = `${pid} ${cpu}  ${mem}   ${name}`;

    if (currentLength + line.length + 10 > 1024) break;

    lines.push(line);
    currentLength += line.length + 1;
  }

  return "```\n" + lines.join("\n") + "\n```";
}

function generateSystemSummary(metrics) {
  const issues = [];

  if (metrics.cpu >= CPU_ALERT_THRESHOLD) {
    issues.push(`🔥 CPU Overload (${metrics.cpu.toFixed(1)}%)`);
  }
  if (metrics.ramPercent >= RAM_ALERT_THRESHOLD) {
    issues.push(`💾 RAM Penuh (${metrics.ramPercent.toFixed(1)}%)`);
  }
  if (metrics.diskPercent >= DISK_ALERT_THRESHOLD) {
    issues.push(`💿 Disk Penuh (${metrics.diskPercent.toFixed(1)}%)`);
  }
  if (metrics.latency >= LATENCY_ALERT_THRESHOLD) {
    issues.push(`🌐 Latency Tinggi (${metrics.latency.toFixed(0)}ms)`);
  }

  if (issues.length === 0) {
    return "✅ **Sistem Berjalan Optimal**\nSemua komponen berfungsi dengan baik.";
  }

  return `🚨 **Peringatan Bahaya (Kritis)**\n${issues.map((i) => `• ${i}`).join("\n")}`;
}

function buildDashboardEmbed(metrics) {
  const color = statusColor(
    metrics.cpu,
    metrics.ramPercent,
    metrics.diskPercent,
    metrics.latency
  );
  const label = statusLabel(
    metrics.cpu,
    metrics.ramPercent,
    metrics.diskPercent,
    metrics.latency
  );

  const networkStatus = networkStatusIndicator(metrics.latency);
  const systemSummary = generateSystemSummary(metrics);

  // Overview info dengan emoji untuk visual menarik
  const overviewDescription = [
    `**${metrics.hostname}** · ${metrics.os} (${metrics.arch})`,
    `⏱️ Uptime: **${metrics.uptime}** · 🧠 Cores: **${metrics.cpuCores}**`,
    `🌐 Public: \`${metrics.publicIP}\` · Local: \`${metrics.localIP}\``,
  ].join("\n");

  return new EmbedBuilder()
    .setColor(color)
    .setTitle("🖥️ SYSTEM MONITORING DASHBOARD")
    .setDescription(overviewDescription)
    .addFields(
      // Grid Layout: 3 kolom inline untuk metrik utama
      {
        name: "💻 CPU Usage",
        value: [
          `\`${progressBar(metrics.cpu, 12)}\``,
          `**${metrics.cpu.toFixed(1)}%**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "🧠 Memory (RAM)",
        value: [
          `\`${progressBar(metrics.ramPercent, 12)}\``,
          `**${metrics.ramPercent.toFixed(1)}%**`,
          `${formatBytes(metrics.ramUsed)} / ${formatBytes(metrics.ramTotal)}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "💾 Storage (Disk)",
        value: [
          `\`${progressBar(metrics.diskPercent, 12)}\``,
          `**${metrics.diskPercent.toFixed(1)}%**`,
          `${formatBytes(metrics.diskUsed)} / ${formatBytes(metrics.diskTotal)}`,
        ].join("\n"),
        inline: true,
      },
      // Network & Latency Section
      {
        name: "🌐 Network & Latency",
        value: [
          `**Ping to 8.8.8.8:** ${metrics.latency.toFixed(0)}ms ${networkStatus}`,
          `**Status:** ${label} · Processes: ${metrics.processRunning} running / ${metrics.processTotal} total`,
        ].join("\n"),
        inline: false,
      },
      // Kesimpulan Status Sistem
      {
        name: "📊 System Health Summary",
        value: systemSummary,
        inline: false,
      },
      // Process Table dengan format monospaced yang rapi
      {
        name: "📋 Active Processes (Top by CPU)",
        value: buildProcessListCodeblock(metrics.processListSorted),
        inline: false,
      }
    )
    .setFooter({
      text: `Nexura VPS Monitor • Auto-refresh every 5s`,
    })
    .setTimestamp();
}

function buildAlertEmbed(metrics, reasons) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("🚨 Peringatan Resource VPS")
    .setDescription(`Host **${metrics.hostname}** melewati ambang batas aman.`)
    .addFields(
      {
        name: "Penyebab",
        value: reasons.map((reason) => `• ${reason}`).join("\n"),
      },
      {
        name: "CPU",
        value: `${metrics.cpu.toFixed(1)}% (batas ${CPU_ALERT_THRESHOLD}%)`,
        inline: true,
      },
      {
        name: "RAM",
        value: `${metrics.ramPercent.toFixed(1)}% (batas ${RAM_ALERT_THRESHOLD}%)`,
        inline: true,
      },
      {
        name: "Disk",
        value: `${metrics.diskPercent.toFixed(1)}% (batas ${DISK_ALERT_THRESHOLD}%)`,
        inline: true,
      },
      {
        name: "Latency",
        value: `${metrics.latency.toFixed(0)}ms (batas ${LATENCY_ALERT_THRESHOLD}ms)`,
        inline: true,
      },
      {
        name: "Uptime",
        value: metrics.uptime,
        inline: true,
      }
    )
    .setFooter({ text: "Alert berikutnya di-cooldown 5 menit selama kondisi masih kritis." })
    .setTimestamp();
}

async function findOrCreateRoutineMessage(channel) {
  const recent = await channel.messages.fetch({ limit: 20 });
  const existing = recent.find(
    (message) =>
      message.author.id === client.user.id &&
      message.embeds[0]?.title?.startsWith("🖥️ VPS Monitor")
  );

  if (existing) return existing;

  return channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🖥️ VPS Monitor · MEMUAT")
        .setDescription("Mengambil metrik sistem pertama...")
        .setTimestamp(),
    ],
  });
}

async function sendAlert(metrics) {
  const reasons = [];
  if (metrics.cpu > CPU_ALERT_THRESHOLD) {
    reasons.push(`CPU ${metrics.cpu.toFixed(1)}% > ${CPU_ALERT_THRESHOLD}%`);
  }
  if (metrics.ramPercent > RAM_ALERT_THRESHOLD) {
    reasons.push(`RAM ${metrics.ramPercent.toFixed(1)}% > ${RAM_ALERT_THRESHOLD}%`);
  }
  if (metrics.diskPercent > DISK_ALERT_THRESHOLD) {
    reasons.push(`Disk ${metrics.diskPercent.toFixed(1)}% > ${DISK_ALERT_THRESHOLD}%`);
  }
  if (metrics.latency > LATENCY_ALERT_THRESHOLD) {
    reasons.push(`Latency ${metrics.latency.toFixed(0)}ms > ${LATENCY_ALERT_THRESHOLD}ms`);
  }

  if (!reasons.length) return;

  const now = Date.now();
  if (now - lastAlertAt < ALERT_COOLDOWN_MS) return;

  const channel = await client.channels.fetch(ALERT_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) {
    throw new Error("ALERT_CHANNEL_ID bukan channel teks yang valid.");
  }

  await channel.send({ embeds: [buildAlertEmbed(metrics, reasons)] });
  lastAlertAt = now;
  console.warn(`[alert] ${reasons.join(" | ")}`);
}

async function updateLiveStatus() {
  if (updating) return;
  updating = true;

  try {
    const metrics = await collectMetrics();

    if (!routineMessage) {
      const channel = await client.channels.fetch(ROUTINE_CHANNEL_ID);
      if (!channel || !channel.isTextBased()) {
        throw new Error("ROUTINE_CHANNEL_ID bukan channel teks yang valid.");
      }
      routineMessage = await findOrCreateRoutineMessage(channel);
    }

    await routineMessage.edit({ embeds: [buildDashboardEmbed(metrics)] });

    client.user.setActivity(`CPU ${metrics.cpu.toFixed(0)}% · RAM ${metrics.ramPercent.toFixed(0)}%`, {
      type: ActivityType.Watching,
    });

    await sendAlert(metrics);
  } catch (error) {
    console.error("[monitor] Gagal memperbarui dashboard:", error.message);

    if (routineMessage) {
      try {
        await routineMessage.edit({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("🖥️ VPS Monitor · ERROR")
              .setDescription("Gagal mengambil metrik sistem. Bot tetap berjalan dan akan mencoba lagi.")
              .addFields({ name: "Detail", value: `\`\`\`${truncate(error.message, 900)}\`\`\`` })
              .setFooter({ text: `Percobaan gagal ${new Date().toLocaleString("id-ID", { hour12: false })}` })
              .setTimestamp(),
          ],
        });
      } catch (editError) {
        console.error("[monitor] Pesan dashboard tidak bisa diedit, akan dibuat ulang:", editError.message);
        routineMessage = null;
      }
    }
  } finally {
    updating = false;
  }
}

function startMonitorLoop() {
  if (updateTimer) clearInterval(updateTimer);
  updateLiveStatus();
  updateTimer = setInterval(updateLiveStatus, UPDATE_INTERVAL_MS);
}

client.once("clientReady", () => {
  console.log(`[ready] Login sebagai ${client.user.tag}`);
  console.log(`[ready] Akses dibatasi ke user ${ALLOWED_USER_ID}`);
  startMonitorLoop();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.user.id !== ALLOWED_USER_ID) {
    await interaction.reply({
      content: "Kamu tidak diizinkan menggunakan bot ini.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "status") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const metrics = await collectMetrics();
      await interaction.editReply({ embeds: [buildDashboardEmbed(metrics)] });
    } catch (error) {
      await interaction.editReply({
        content: `Gagal mengambil status: ${error.message}`,
      });
    }
  }
});

client.on("error", (error) => {
  console.error("[discord] Client error:", error.message);
});

process.on("unhandledRejection", (error) => {
  console.error("[process] Unhandled rejection:", error);
});

process.on("uncaughtException", (error) => {
  console.error("[process] Uncaught exception:", error);
});

function shutdown(signal) {
  console.log(`[shutdown] Menerima ${signal}, menutup bot...`);
  if (updateTimer) clearInterval(updateTimer);
  client.destroy();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

client.login(DISCORD_TOKEN).catch((error) => {
  console.error("[login] Gagal login ke Discord:", error.message);
  process.exit(1);
});
