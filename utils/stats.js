// Sunucu geneli istatistik: üye başına toplam mesaj sayısı ve toplam ses süresi (bot açıkken sayılmaya başlar).
// Yazma sayısını azaltmak için bellekte biriktirilir, 30 saniyede bir toplu yazılır (Render/Mongo dostu).
const { getDb } = require('./db');

const col = () => getDb().collection('memberStats'); // { guildId, userId, messages, voiceSeconds }

const msgBuf = new Map(); // `${guildId}:${userId}` -> sayı
const voiceBuf = new Map(); // `${guildId}:${userId}` -> saniye
const voiceActive = new Map(); // `${guildId}:${userId}` -> son kredilendiği zaman (ms)

const key = (g, u) => `${g}:${u}`;

function onMessage(message) {
  if (!message.guild || message.author.bot) return;
  const k = key(message.guild.id, message.author.id);
  msgBuf.set(k, (msgBuf.get(k) || 0) + 1);
}

// Sayılan ses: herhangi bir ses kanalında bulunmak (AFK kanalı hariç).
function counts(state) {
  return Boolean(state.channelId) && state.channelId !== state.guild.afkChannelId && !state.member?.user?.bot;
}

function credit(k, now = Date.now()) {
  const start = voiceActive.get(k);
  if (start == null) return;
  const sec = Math.floor((now - start) / 1000);
  if (sec > 0) { voiceBuf.set(k, (voiceBuf.get(k) || 0) + sec); voiceActive.set(k, start + sec * 1000); }
}

function onVoice(oldState, newState) {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  const k = key(newState.guild.id, member.id);
  const was = voiceActive.has(k);
  const now = counts(newState);
  if (was && !now) { credit(k); voiceActive.delete(k); }
  else if (!was && now) voiceActive.set(k, Date.now());
}

// Bot açılırken zaten seste olanları saymaya başlar.
function seedVoice(client) {
  for (const guild of client.guilds.cache.values()) {
    for (const vs of guild.voiceStates.cache.values()) {
      if (vs.member && counts(vs)) voiceActive.set(key(guild.id, vs.member.id), Date.now());
    }
  }
}

let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    for (const k of voiceActive.keys()) credit(k);
    const ids = new Set([...msgBuf.keys(), ...voiceBuf.keys()]);
    if (!ids.size) return;
    const ops = [];
    const msgs = new Map(msgBuf), voice = new Map(voiceBuf);
    msgBuf.clear(); voiceBuf.clear();
    for (const k of ids) {
      const [guildId, userId] = k.split(':');
      ops.push({ updateOne: { filter: { guildId, userId }, update: { $inc: { messages: msgs.get(k) || 0, voiceSeconds: voice.get(k) || 0 } }, upsert: true } });
    }
    try { await col().bulkWrite(ops, { ordered: false }); }
    catch (err) { // yazılamazsa sayılar kaybolmasın
      for (const [k, v] of msgs) msgBuf.set(k, (msgBuf.get(k) || 0) + v);
      for (const [k, v] of voice) voiceBuf.set(k, (voiceBuf.get(k) || 0) + v);
      console.error('[STATS] yazılamadı:', err.message);
    }
  } finally { flushing = false; }
}

let started = false;
function startStats(client) {
  if (started) return;
  started = true;
  seedVoice(client);
  setInterval(() => flush().catch(() => {}), 30_000).unref?.();
  process.once('SIGTERM', () => { flush().finally(() => process.exit(0)); });
}

const FIELDS = { messages: 'messages', voice: 'voiceSeconds' };

// Veritabanındaki değer + henüz yazılmamış bellek değeri.
function pending(guildId, userId, field) {
  const k = key(guildId, userId);
  if (field === 'messages') return msgBuf.get(k) || 0;
  const start = voiceActive.get(k);
  return (voiceBuf.get(k) || 0) + (start != null ? Math.floor((Date.now() - start) / 1000) : 0);
}

async function getTop(guildId, which, limit = 10) {
  await flush();
  const f = FIELDS[which];
  const list = await col().find({ guildId, [f]: { $gt: 0 } }).sort({ [f]: -1 }).limit(limit).toArray();
  return list.map(r => ({ userId: r.userId, value: r[f] || 0 }));
}

async function getUserRank(guildId, userId, which) {
  await flush();
  const f = FIELDS[which];
  const rec = await col().findOne({ guildId, userId });
  const value = rec?.[f] || 0;
  if (!value) return { value: 0, rank: null };
  const higher = await col().countDocuments({ guildId, [f]: { $gt: value } });
  return { value, rank: higher + 1 };
}

function formatVoice(sec) {
  sec = Math.floor(sec);
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d} gün`);
  if (h) parts.push(`${h} sa`);
  if (m || !parts.length) parts.push(`${m} dk`);
  return parts.slice(0, 2).join(' ');
}

module.exports = { onMessage, onVoice, startStats, flush, getTop, getUserRank, formatVoice, pending };
