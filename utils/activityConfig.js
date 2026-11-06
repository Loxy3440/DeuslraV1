const { getDb } = require('./db');

// Bu ayar tum sunucular icin gecerlidir (Discord presence/activity bot bazlidir, sunucu bazli degil).
const DOC_ID = 'activity';

const DEFAULT_ACTIVITY_CONFIG = {
  list: [], // [{ type: 'PLAYING'|'WATCHING'|'LISTENING'|'COMPETING'|'STREAMING', text: '/help', url?: 'https://twitch.tv/...' }, ...]
  intervalSeconds: 15,
  status: 'online', // 'online' | 'idle' | 'dnd' | 'invisible'
  customStatus: '', // botun profilindeki durum yazısı (balon); aktivite listesinden bağımsızdır
  richEnabled: false, // panelden açılıp kapatılan Rich Presence (içerik utils/richPresence.js taslağında)
};

const STATUSES = ['online', 'idle', 'dnd', 'invisible'];

async function getActivityConfig() {
  const db = getDb();
  const config = await db.collection('botConfig').findOne({ _id: DOC_ID });
  return { ...DEFAULT_ACTIVITY_CONFIG, ...(config || {}) };
}

async function setActivityConfig(update) {
  const db = getDb();
  await db.collection('botConfig').updateOne({ _id: DOC_ID }, { $set: update }, { upsert: true });
}

// Streaming (Yayinda) durumu icin Discord sadece Twitch veya YouTube adresi kabul eder.
function isStreamUrl(url) {
  return /^https:\/\/(www\.|m\.)?(twitch\.tv|youtube\.com|youtu\.be)\/\S+$/i.test(String(url || '').trim());
}

function buildEntry(type, text, url = null, state = '') {
  const entry = { type, text };
  if (type === 'STREAMING') entry.url = String(url).trim();
  const st = String(state || '').trim();
  if (st) entry.state = st; // Rich Presence ikinci satir (bot icin Discord'un izin verdigi tek ek alan)
  return entry;
}

async function addActivity(type, text, url = null, state = '') {
  const config = await getActivityConfig();
  const list = [...config.list, buildEntry(type, text, url, state)];
  await setActivityConfig({ list });
  return list;
}

async function updateActivity(index, type, text, url = null, state = '') {
  const config = await getActivityConfig();
  const list = config.list.map((a, i) => (i === index ? buildEntry(type, text, url, state) : a));
  await setActivityConfig({ list });
  return list;
}

async function removeActivity(index) {
  const config = await getActivityConfig();
  const list = config.list.filter((_, i) => i !== index);
  await setActivityConfig({ list });
  return list;
}

module.exports = { STATUSES, getActivityConfig, setActivityConfig, addActivity, updateActivity, removeActivity, isStreamUrl };