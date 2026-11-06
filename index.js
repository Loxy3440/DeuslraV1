const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
require('dotenv').config();
const { connectDB } = require('./utils/db');

// Presence (durum) intent'i ayrıcalıklıdır: Developer Portal'dan açmadan eklenirse bot giriş yapamaz. Bu yüzden .env USE_PRESENCE=true ile isteğe bağlı.
const usePresence = String(process.env.USE_PRESENCE || '').toLowerCase() === 'true';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    ...(usePresence ? [GatewayIntentBits.GuildPresences] : []),
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.commands = new Collection();

// ---------- commands/ klasorunu yukle ----------
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));

  if (command && command.data && typeof command.execute === 'function') {
    client.commands.set(command.data.name, command);
    console.log(`[KOMUT YUKLENDI] /${command.data.name}`);
  } else {
    console.warn(`[UYARI] ${file} gecerli bir komut degil (data/execute eksik).`);
  }
}

// ---------- events/ klasorunu yukle ----------
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));

  if (!event || !event.name || typeof event.execute !== 'function') {
    console.warn(`[UYARI] ${file} gecerli bir event degil (name/execute eksik).`);
    continue;
  }

  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client));
  } else {
    client.on(event.name, (...args) => event.execute(...args, client));
  }

  console.log(`[EVENT YUKLENDI] ${event.name}`);
}

// ---------- Web sunucusu: dashboard + /api/stats (Render'in port beklentisini de karsilar) ----------
require('./utils/webServer').startWebServer(client);

(async () => {
  try {
    await connectDB();
  } catch (err) {
    // DB olmadan bot calismasin: Render hatayi net gorsun ve yeniden denesin.
    console.error('[MONGODB] Baglanti hatasi:', err.message);
    console.error('Kontrol: 1) Render Environment\'ta MONGO_URI var mi  2) Atlas > Network Access\'te 0.0.0.0/0 izinli mi  3) sifre/kullanici dogru mu');
    process.exit(1);
  }

  client.login(process.env.TOKEN);
})();
