require('dotenv').config();
const { status } = require('minecraft-server-util');
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// Constants
const SERVERS = [
  { name: 'Amplified', host: 'amplified-minecraft.junner.org', port: 13901 },
  { name: 'Normal', host: 'normal-minecraft.junner.org', port: 43391 },
  // { name: 'FanhuaTown', host: 'sg.FanhuaTown.cc', port: 25565 },
];

const CHECK_INTERVAL = 30000; // 30 seconds
const PORT = process.env.PORT || 3000;

// State management
const lastPlayers = new Map(); // Map<server.name, playerName[]>
const unreachableFlags = new Map(); // Map<server.name, boolean>

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Bot event handlers
client.once('ready', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  setInterval(checkAllServers, CHECK_INTERVAL);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  if (interaction.commandName === 'now') {
    await handleNowCommand(interaction);
  }
});

// Server monitoring functions
async function checkAllServers() {
  const promises = SERVERS.map(server => checkServer(server));
  await Promise.allSettled(promises);
}

async function checkServer({ name, host, port }) {
  try {
    const result = await status(host, port);
    const channel = await getNotificationChannel();
    
    // Handle server recovery
    await handleServerRecovery(name, channel);
    
    // Handle player changes
    await handlePlayerChanges(name, result, channel);
    
  } catch (error) {
    console.error(`❌ ${name} connection failed:`, error.message);
    await handleServerDown(name, host, port);
  }
}

async function handleServerRecovery(serverName, channel) {
  if (unreachableFlags.get(serverName)) {
    unreachableFlags.set(serverName, false);
    await channel.send(`✅ 伺服器 **${serverName}** 又可連線了`);
  }
}

async function handlePlayerChanges(serverName, result, channel) {
  const currentPlayers = result.players.sample?.map(player => player.name) || [];
  const previousPlayers = lastPlayers.get(serverName) || [];
  
  const joinedPlayers = currentPlayers.filter(player => !previousPlayers.includes(player));
  const leftPlayers = previousPlayers.filter(player => !currentPlayers.includes(player));
  
  if (joinedPlayers.length > 0) {
    await channel.send(`🟢 **${serverName}** 有人加入：${joinedPlayers.join(', ')}`);
  }
  
  if (leftPlayers.length > 0) {
    await channel.send(`🔴 **${serverName}** 有人離開：${leftPlayers.join(', ')}`);
  }
  
  lastPlayers.set(serverName, currentPlayers);
}

async function handleServerDown(serverName, host, port) {
  const alreadyNotified = unreachableFlags.get(serverName);
  
  if (!alreadyNotified) {
    const channel = await getNotificationChannel();
    await channel.send(`⚠️ 無法連線到 **${serverName}** 伺服器（${host}:${port}）`);
    unreachableFlags.set(serverName, true);
  }
}

async function getNotificationChannel() {
  return await client.channels.fetch(process.env.CHANNEL_ID);
}

// Slash command handlers
async function handleNowCommand(interaction) {
  await interaction.deferReply();
  
  const serverStatuses = await Promise.allSettled(
    SERVERS.map(server => getServerStatus(server))
  );
  
  const statusLines = serverStatuses.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return `⚠️ **${SERVERS[index].name}**: Unreachable`;
    }
  });
  
  await interaction.editReply(statusLines.join('\n\n'));
}

async function getServerStatus({ name, host, port }) {
  const result = await status(host, port);
  const players = result.players.sample?.map(player => player.name) || [];
  const playerCount = players.length;
  
  if (playerCount > 0) {
    return `👥 **${name}**: ${playerCount} online\n> ${players.join(', ')}`;
  } else {
    return `💤 **${name}**: No one online`;
  }
}

// Express server setup (for hosting platforms like Render)
const app = express();

app.get('/', (req, res) => {
  res.json({
    status: 'Bot is running!',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/status', async (req, res) => {
  const { domain, port = '25565' } = req.query;
  
  if (!domain) {
    return res.status(400).json({ 
      error: 'Missing domain parameter.' 
    });
  }
  
  try {
    const result = await status(domain, parseInt(port));
    const onlinePlayers = result.players.sample?.map(player => player.name) || [];
    
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

// Start services
app.listen(PORT, () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);