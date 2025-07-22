require('dotenv').config();
const { status } = require('minecraft-server-util');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Collection } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Define your servers
const SERVERS = [
  { name: 'Amplified', host: 'amplified-minecraft.junner.org', port: 13901 },
  { name: 'Normal', host: 'normal-minecraft.junner.org', port: 43391 },
  // { name: 'FanhuaTown', host: 'sg.FanhuaTown.cc', port: 25565 },
];

const lastPlayers = new Map(); // Map<server.name, playerName[]>
const unreachableFlags = new Map(); // Map<server.name, boolean>

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  setInterval(checkAllServers, 30000);
});

async function checkAllServers() {
  for (const server of SERVERS) {
    await checkServer(server);
  }
}

async function checkServer({ name, host, port }) {
  try {
    const result = await status(host, port);
    const channel = await client.channels.fetch(process.env.CHANNEL_ID);

    // Mark reachable
    if (unreachableFlags.get(name)) {
      unreachableFlags.set(name, false);
      channel.send(`✅ 伺服器 **${name}** 又可連線了`);
    }

    const now = result.players.sample?.map(p => p.name) || [];
    const prev = lastPlayers.get(name) || [];

    const joined = now.filter(p => !prev.includes(p));
    const left = prev.filter(p => !now.includes(p));

    if (joined.length > 0)
      channel.send(`🟢 **${name}** 有人加入：${joined.join(', ')}`);
    if (left.length > 0)
      channel.send(`🔴 **${name}** 有人離開：${left.join(', ')}`);

    lastPlayers.set(name, now);
  } catch (err) {
    console.error(`❌ ${name} 無法連接:`, err.message);

    const alreadyNotified = unreachableFlags.get(name);
    if (!alreadyNotified) {
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      channel.send(`⚠️ 無法連線到 **${name}** 伺服器（${host}:${port}）`);
      unreachableFlags.set(name, true);
    }
  }
}

// --- Dummy server to satisfy Render ---
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is running!');
});

app.get('/status', async (req, res) => {
  const domain = req.query.domain;
  const port = parseInt(req.query.port) || 25565;

  if (!domain) {
    return res.status(400).json({ error: 'Missing domain parameter.' });
  }

  try {
    const result = await status(domain, port);
    const onlinePlayers = result.players.sample?.map(p => p.name) || [];
    res.json({
      online: true,
      playersOnline: result.players.online,
      players: onlinePlayers,
      motd: result.motd?.clean || '',
      version: result.version.name,
    });
  } catch (error) {
    res.status(503).json({
      online: false,
      error: error.message || 'Server not reachable',
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dummy HTTP server listening on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'now') {
    await interaction.deferReply();

    const lines = [];
    for (const { name, host, port } of SERVERS) {
      try {
        const res = await status(host, port);
        const players = res.players.sample?.map(p => p.name) || [];
        const count = players.length;
        const text = count > 0
          ? `👥 **${name}**: ${count} online\n> ${players.join(', ')}`
          : `💤 **${name}**: No one online`;
        lines.push(text);
      } catch (err) {
        lines.push(`⚠️ **${name}**: Unreachable`);
      }
    }

    await interaction.editReply(lines.join('\n\n'));
  }
});
