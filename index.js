require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { status } = require('minecraft-server-util');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Define your servers
const SERVERS = [
  { name: 'Amplified', host: 'amplified-minecraft.junner.org', port: 13901 },
  { name: 'Normal', host: 'normal-minecraft.junner.org', port: 43391 },
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

client.login(process.env.DISCORD_TOKEN);
