import 'dotenv/config'; 
import { status } from 'minecraft-server-util';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import express from 'express';
import cors from 'cors';  // FOR PUNCH CLOCK
import admin from 'firebase-admin';  // FOR PUNCH CLOCK
import { GoogleGenAI } from "@google/genai";

// Initialize Firebase Admin  // FOR PUNCH CLOCK
let db = null; 
if (!admin.apps.length) {
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is missing in Render environment variables!");
    }
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore(); 
    console.log("✅ Firebase Admin initialized successfully.");
  } catch (error) {
    console.error("⚠️ FIREBASE INIT FAILED:", error.message);
    console.error("Make sure you pasted the ENTIRE JSON file correctly into Render.");
  }
}


// Constants
const SERVERS = [
  // { name: 'Amplified', host: 'amplified-minecraft.junner.org', port: 13901 },
  { name: 'Normal', host: 'normal-minecraft.junner.org', port: 43391 },
  // { name: 'My Server', host: 'chiwei.aternos.me', port: 25565 },
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

// 捕捉 Discord Client 內部的連線錯誤 (防止機器人崩潰)
client.on('error', (error) => {
    console.error('⚠️ Discord Client Error:', error.message);
    // 這裡捕捉後，機器人就不會因為連線問題而自殺
});

// 捕捉未處理的 Promise 錯誤 (例如 API 逾時) (防止機器人崩潰)
process.on('unhandledRejection', (error) => {
    console.error('⚠️ Unhandled Rejection:', error);
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

// Function to call Gemini  // These code are provided by Google AI Studio
// The client gets the API key from the environment variable `GEMINI_API_KEY`.
async function gemini(names) {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });
  const config = {
    temperature: 2,
    thinkingConfig: {
      thinkingBudget: 1000,
    },
    systemInstruction: [
        {
          text: `Based on the input, generate a quick, short message to motivate friends join playing minecraft. 
The message should begin with "(Player's names) just joined the Minecraft server, " and follow with a motivating call-to-action.
Language: Traditional Chinese (Taiwan).
Input: 'Joined player: {a_list_of_player_names}'
`,
        }
    ],
  };
  const model = 'gemini-2.5-flash';
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: `Joined player: ${names}`,  // <-- The input
        },
      ],
    },
  ];

  const response = await ai.models.generateContentStream({
    model,
    config,
    contents,
  });
  let fullText = "";
  for await (const chunk of response) {
    const text = chunk.text;
    console.log(text);
    fullText += text;
  }  return fullText;
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
    const playersString = joinedPlayers.join(', ');
    // Call gemini, with parameter 'joinedPlayers'
    try {
      // 1. 呼叫 Gemini 函式 (記得要 await)
      console.log(`New player ${playersString} joined. Calling Gemini...`);
      const aiMessage = await gemini(playersString);

      // 2. 發送 AI 生成的訊息
      // 檢查 aiMessage 是否有內容，避免空訊息報錯
      if (aiMessage) {
        await channel.send(aiMessage); 
      } else {
        // 如果 AI 回傳空的 (極少見)，就發送原本的預設訊息
        console.error("aiMessage:", aiMessage);
        await channel.send(`🟢 **${serverName}** 有人加入：${playersString}`);
      }
      
    } catch (error) {
      console.error("Gemini 生成訊息失敗:", error);
      // 3. 錯誤處理 (Fallback)
      // 如果 API 額度用完或連線失敗，至少要發送一般的通知，不要讓機器人當掉
      await channel.send(`🟢 **${serverName}** 有人加入：${playersString}`);
    }
    // await channel.send(`🟢 **${serverName}** 有人加入：${joinedPlayers.join(', ')}`);
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

// --- FOR PUNCH CLOCK ---
app.use(cors());
app.use(express.json()); 
// -----------------------------------

app.get('/', (req, res) => {
  res.json({
    status: 'Bot is running!',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/status', async (req, res) => {  
  // req.query 是 Express (網頁框架) 用來抓取網址 ? 後面參數的功能
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

// --- FOR PUNCH CLOCK ---
// Endpoint 1: Frontend sends text -> Render asks Gemini -> Render returns Tags
app.post('/api/classify', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });
    console.log(`Classifying task: "${text}"`);
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); 
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        config: {
            temperature: 0.1, 
            systemInstruction: "You are a noticeboard assistant. Read the task and assign 1 relevant time tags from this exact list: [上午班, 下午班, 晚班, 通用]. If time tag is not '通用', assign another 0 to 1 relevant tags from this exact list: [上班時, 下班前]. Respond ONLY with a comma-separated list of tags, no other text. Do not use hashtags. Example output 1: [下午班, 上班時] Example output 2: [通用] Example output 3: [上午班]"
        },
        contents: [{ role: 'user', parts: [{ text: text }] }]
    });
    
    // Clean up the AI response into a neat JavaScript array
    const tagsString = response.text || "";
    const tags = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag);

    res.json({ tags });
  } catch (error) {
    console.error('Classification Error:', error);
    res.status(500).json({ error: 'Failed to classify task' });
  }
});

// Endpoint 2: Frontend sends approved text + tags -> Render saves to Firebase
app.post('/api/tasks', async (req, res) => {
  try {
    // Prevent crash if DB isn't connected
    if (!db) {
      return res.status(500).json({ error: 'Database is not configured correctly on the server.' });
    }
    const { text, tags } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required to save a task.' });
    const newTask = {
        originalText: text,
        tags: tags || [],
        // serverTimestamp ensures the time is perfectly accurate to the server
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'alive'
    };
    // Save directly to the 'tasks' collection in Firestore
    const docRef = await db.collection('tasks').add(newTask);
    console.log(`✅ Saved new task to Firebase: ${docRef.id}`);
    res.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('Firebase Save Error:', error);
    res.status(500).json({ error: 'Failed to save task to database' });
  }
});
// -----------------------------------


// Start services
app.listen(PORT, () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);