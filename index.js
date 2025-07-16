require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { status } = require('minecraft-server-util');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

let lastPlayers = [];

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  setInterval(checkServer, 30000); // every 30 sec
});

async function checkServer() {
  try {
    const result = await status('your.minecraft.server.ip', 25565);
    const playersNow = result.players.sample?.map(p => p.name) || [];

    const newPlayers = playersNow.filter(p => !lastPlayers.includes(p));
    if (newPlayers.length > 0) {
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      channel.send(`🟢 Players joined: ${newPlayers.join(', ')}`);
    }

    lastPlayers = playersNow;
  } catch (err) {
    console.error('Failed to ping server:', err);
  }
}

client.login(process.env.DISCORD_TOKEN);
