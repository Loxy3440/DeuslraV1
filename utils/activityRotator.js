const { getActivityConfig, setActivityConfig } = require('./activityConfig');
const rich = require('./richPresence');

// Discord.js ActivityType degerleri: Playing=0, Streaming=1, Listening=2, Watching=3, Competing=5
const TYPE_MAP = {
  PLAYING: 0,
  STREAMING: 1,
  LISTENING: 2,
  WATCHING: 3,
  COMPETING: 5,
  CUSTOM: 4, // özel durum yazısı ("Oynuyor" gibi bir ön ek olmadan sadece metin)
};

let rotateTimer = null;
let refreshTimer = null;
let rotateIndex = 0;
let currentEntry = null;
let currentRendered = null;
let currentStatus = 'online';
let richOn = false;
let richOpenedAt = 0;
let richTimer = null;

// Rich Presence taslagini gateway'e yollar (acikken 30 sn'de bir tazelenir; baglanti yenilense de kaybolmaz).
function applyRich(client) {
  if (!client.user) return;
  try { rich.sendRaw(client, rich.buildActivity(client, richOpenedAt), rich.getStatus()); }
  catch (err) { console.error('[RICH PRESENCE]', err.message); }
}

function stopRichTimer() {
  if (richTimer) { clearInterval(richTimer); richTimer = null; }
}

// Üye sayısı hangi sunucudan okunacak (.env STATS_GUILD_ID ile değiştirilebilir).
const STATS_GUILD_ID = process.env.STATS_GUILD_ID || '1522670187810127912';

function getMemberCount(client) {
  const guild = client.guilds.cache.get(STATS_GUILD_ID);
  if (guild) return guild.memberCount;
  // Bot o sunucuda değilse tüm sunucuların toplamını göster.
  return client.guilds.cache.reduce((sum, g) => sum + g.memberCount, 0);
}

// Aktivite metnindeki {uye} / {members} / {sunucu} yer tutucularını anlık değerle değiştirir.
function renderText(client, text) {
  return String(text)
    .replace(/\{(uye|members)\}/gi, getMemberCount(client).toLocaleString('tr-TR'))
    .replace(/\{(sunucu|guilds)\}/gi, String(client.guilds.cache.size));
}

let customText = ''; // botun durum yazısı (balon), aktivite listesinden bağımsız

// Botun gerçek presence'ını kurar: önce (varsa) durum yazısı, sonra dönen aktivite.
function pushPresence(client, entry) {
  if (!client.user) return;
  if (richOn) return applyRich(client);
  const activities = [];
  if (customText) activities.push({ name: 'Custom Status', type: 4, state: renderText(client, customText) });
  if (entry && entry.type !== 'CUSTOM') {
    const a = { name: renderText(client, entry.text), type: TYPE_MAP[entry.type] ?? 3 };
    if (entry.type === 'STREAMING' && entry.url) a.url = entry.url; // url yoksa Discord normal "Oynuyor" gibi gosterir
    if (entry.state) a.state = renderText(client, entry.state); // Rich Presence ikinci satir
    activities.push(a);
  } else if (entry && entry.type === 'CUSTOM' && !customText) {
    activities.push({ name: 'Custom Status', type: 4, state: renderText(client, entry.text) }); // eski kayıtlar
  }
  client.user.setPresence({ activities, status: currentStatus });
}

function applyOne(client, entry) {
  if (!client.user) return;
  currentEntry = entry;
  currentRendered = { type: entry.type, text: renderText(client, entry.text), state: entry.state ? renderText(client, entry.state) : '' };
  pushPresence(client, entry);
}

// Üye katılıp/ayrılınca ve düzenli aralıkla çağrılır: şu an gösterilen aktiviteyi güncel sayıyla yeniler.
function refreshActivity(client) {
  const re = /\{(uye|members|sunucu|guilds)\}/i;
  if ((currentEntry && (re.test(currentEntry.text) || re.test(currentEntry.state || ''))) || re.test(customText)) {
    if (currentEntry) currentRendered = { type: currentEntry.type, text: renderText(client, currentEntry.text), state: currentEntry.state ? renderText(client, currentEntry.state) : '' };
    pushPresence(client, currentEntry);
  }
}

// Kaydedilen aktivite listesini/suresini okuyup uygular ve gerekirse donguyu (rotation) yeniden baslatir.
// /setactivity komutundan bir degisiklik yapildiginda veya bot acilirken cagrilir.
async function startActivityRotation(client) {
  if (rotateTimer) {
    clearInterval(rotateTimer);
    rotateTimer = null;
  }
  rotateIndex = 0;
  currentEntry = null;

  if (!refreshTimer) {
    refreshTimer = setInterval(() => refreshActivity(client), 60_000);
    refreshTimer.unref?.();
  }

  let config;
  try {
    config = await getActivityConfig();
    currentStatus = config.status || 'online';
    customText = String(config.customStatus || '').trim();
    richOn = !!config.richEnabled;
    if (richOn) {
      if (!richOpenedAt) richOpenedAt = Date.now();
      applyRich(client);
      stopRichTimer();
      richTimer = setInterval(() => applyRich(client), 30_000);
      richTimer.unref?.();
      return; // Rich Presence acikken normal aktivite dongusu calismaz
    }
    richOpenedAt = 0;
    stopRichTimer();
    client.user.setStatus(currentStatus);
  } catch (err) {
    console.error('[ACTIVITY] Config okunamadi, varsayilan kullaniliyor:', err.message);
    client.user.setActivity('/help', { type: 3 });
    return;
  }

  if (!config.list.length) {
    currentRendered = { type: 'WATCHING', text: '/help' };
    currentEntry = { type: 'WATCHING', text: '/help' };
    pushPresence(client, currentEntry); // varsayilan
    return;
  }

  applyOne(client, config.list[0]);

  if (config.list.length > 1) {
    const intervalMs = Math.max(5, config.intervalSeconds || 15) * 1000;
    rotateTimer = setInterval(async () => {
      try {
        const cfg = await getActivityConfig();
        if (!cfg.list.length) return;
        rotateIndex = (rotateIndex + 1) % cfg.list.length;
        applyOne(client, cfg.list[rotateIndex]);
      } catch (err) {
        console.error('[ACTIVITY] Dongu hatasi:', err.message);
      }
    }, intervalMs);
  }
}

// Panelden (veya komutla) botun durumunu değiştirir; ayar veritabanına yazılır, bot yeniden başlasa da korunur.
function setBotStatus(client, status) {
  currentStatus = status;
  if (richOn) return; // Rich Presence acikken durum taslaktaki status'ten gelir
  client.user?.setStatus(status);
}

// Panelden Rich Presence'i acar/kapatir (ayar veritabanina yazilir, bot yeniden baslasa da korunur).
async function setRichPresence(client, enabled) {
  await setActivityConfig({ richEnabled: !!enabled });
  richOpenedAt = 0; // her acista sure sayaci sifirdan baslar
  await startActivityRotation(client);
}

// Panelde gösterilecek anlık görünüm.
function getPresenceView(client) {
  return {
    status: currentStatus,
    richOn,
    activity: currentRendered,
    customRaw: customText,
    custom: customText ? renderText(client, customText) : '',
    bot: client.user ? { name: client.user.username, avatar: client.user.displayAvatarURL({ size: 128 }) } : null,
  };
}

module.exports = { setRichPresence, setBotStatus, getPresenceView, startActivityRotation, refreshActivity, getMemberCount, STATS_GUILD_ID, TYPE_MAP };