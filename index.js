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
    const result = await status('amplified-minecraft.junner.org', 43391);
    const playersNow = result.players.sample?.map(p => p.name) || [];
    console.log(`Online Players: ${playersNow}`);
    const newPlayers = playersNow.filter(p => !lastPlayers.includes(p));
    if (newPlayers.length > 0) {
      const channel = await client.channels.fetch(process.env.CHANNEL_ID);
      channel.send(`🟢 ${newPlayers.join(', ')} 剛剛加入`);
    }

    lastPlayers = playersNow;
  } catch (err) {
    console.error('無法連接到伺服器:', err);
  }
}

client.login(process.env.DISCORD_TOKEN);
