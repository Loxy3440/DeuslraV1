const { ObjectId } = require('mongodb');
const { getDb } = require('./db');

// Aktif (kazanani beklenen) eventler bellekte tutulur: channelId -> event.
// Boylece her mesajda veritabanina gitmeden hizlica kontrol edilir.
const activeByChannel = new Map();

function normalize(text) {
  return String(text || '').trim().toLowerCase();
}

// "30s", "1m", "2h", "1d", "1h30m", "1 saat 30 dakika" gibi sureleri milisaniyeye cevirir. Gecersizse null.
// Birimler: saniye = s/sn/saniye, dakika = m/dk/dakika, saat = h/sa/saat, gun = d/g/gun
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const UNIT_MAP = {
  saniye: 's', sn: 's', s: 's',
  dakika: 'm', dk: 'm', m: 'm',
  saat: 'h', sa: 'h', h: 'h',
  gun: 'd', g: 'd', d: 'd',
};

function parseEventDuration(input) {
  const text = String(input || '').toLocaleLowerCase('tr').replace(/ü/g, 'u').replace(/ı/g, 'i').trim();
  if (!text) return null;

  const re = /(\d+)\s*(saniye|dakika|saat|gun|sn|dk|sa|s|m|h|d|g)/g;
  let total = 0;
  let matched = '';
  let m;
  while ((m = re.exec(text)) !== null) {
    total += parseInt(m[1], 10) * UNIT_MS[UNIT_MAP[m[2]]];
    matched += m[0];
  }

  // Tum metin birimlerle aciklanmali (aksi halde "abc 5m" gibi seyler kabul edilmesin).
  if (!total || matched.replace(/\s+/g, '') !== text.replace(/\s+/g, '')) return null;
  return total;
}

const MIN_DURATION_MS = 1000; // 1 saniye
const MAX_DURATION_MS = 30 * UNIT_MS.d; // 30 gun

function applyPlaceholders(text, { user, server, channel }) {
  return String(text || '')
    .replace(/{user}/g, user)
    .replace(/{server}/g, server)
    .replace(/{kanal}/g, channel);
}

async function createEvent({ guildId, channelIds, announcement, word, winMessage, sendAt, createdBy }) {
  const db = getDb();
  const doc = {
    guildId,
    channelIds,
    announcement,
    word,
    winMessage,
    sendAt,
    createdBy,
    status: 'scheduled', // scheduled -> sending -> active -> finished | failed
    createdAt: new Date(),
  };
  const result = await db.collection('events').insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

// Zamani gelen eventleri tek tek "sending" durumuna alir (ayni event iki kez gonderilmesin diye atomik).
async function claimDueEvents() {
  const db = getDb();
  const claimed = [];
  while (true) {
    const ev = await db.collection('events').findOneAndUpdate(
      { status: 'scheduled', sendAt: { $lte: new Date() } },
      { $set: { status: 'sending' } },
      { returnDocument: 'after' },
    );
    if (!ev) break;
    claimed.push(ev);
  }
  return claimed;
}

async function setEventStatus(id, fields) {
  const db = getDb();
  await db.collection('events').updateOne({ _id: id }, { $set: fields });
}

// Bot acilisinda: aktif eventleri belleğe yukle, yarida kalan "sending" eventleri tekrar siraya al.
async function loadActiveEvents() {
  const db = getDb();
  await db.collection('events').updateMany({ status: 'sending' }, { $set: { status: 'scheduled' } });
  const active = await db.collection('events').find({ status: 'active' }).toArray();
  activeByChannel.clear();
  for (const ev of active) activeByChannel.set(ev.activeChannelId, ev);
  return active.length;
}

function getActiveEvent(channelId) {
  return activeByChannel.get(channelId) || null;
}

function isWinningMessage(event, content) {
  return normalize(content) === normalize(event.word);
}

// Ilk yazani belirler: sadece durumu hala "active" olan event kazanan alabilir (yaris durumuna karsi atomik).
async function claimWinner(event, userId) {
  const db = getDb();
  const won = await db.collection('events').findOneAndUpdate(
    { _id: event._id, status: 'active' },
    { $set: { status: 'finished', winnerId: userId, finishedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (activeByChannel.get(event.activeChannelId)?._id?.equals?.(event._id)) {
    activeByChannel.delete(event.activeChannelId);
  }
  return won;
}

// Zamani gelen eventleri gonderir: kanallar arasindan rastgele birini secer.
async function runDueEvents(client) {
  const due = await claimDueEvents();

  for (const ev of due) {
    const guild = client.guilds.cache.get(ev.guildId);
    if (!guild) {
      await setEventStatus(ev._id, { status: 'failed', failReason: 'Sunucu bulunamadi' });
      continue;
    }

    // Rastgele siralama: ilk secilen kanala gonderilemezse siradakini dene.
    const shuffled = [...ev.channelIds].sort(() => Math.random() - 0.5);
    let sentChannel = null;
    let sentMessage = null;

    for (const channelId of shuffled) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) continue;
      try {
        sentMessage = await channel.send({ content: `${ev.announcement}\n**${ev.word}**` });
        sentChannel = channel;
        break;
      } catch (err) {
        console.error('[EVENT] Kanala gonderilemedi:', channelId, err.message);
      }
    }

    if (!sentChannel) {
      await setEventStatus(ev._id, { status: 'failed', failReason: 'Hicbir kanala mesaj gonderilemedi' });
      continue;
    }

    const activeEvent = { ...ev, status: 'active', activeChannelId: sentChannel.id, messageId: sentMessage.id };
    activeByChannel.set(sentChannel.id, activeEvent); // once bellege, sonra DB'ye (hizli yazan kacirilmasin)
    await setEventStatus(ev._id, {
      status: 'active',
      activeChannelId: sentChannel.id,
      messageId: sentMessage.id,
      startedAt: new Date(),
    });
    console.log(`[EVENT] Basladi: ${guild.name} #${sentChannel.name} (kelime: ${ev.word})`);
  }
}

// ---------- /eventlist yardimcilari ----------
const LIVE_STATUSES = ['scheduled', 'sending', 'active'];

async function listEvents(guildId) {
  const db = getDb();
  return db.collection('events').find({ guildId, status: { $in: LIVE_STATUSES } }).sort({ sendAt: 1 }).toArray();
}

async function getEvent(idString) {
  let oid;
  try {
    oid = new ObjectId(idString);
  } catch {
    return null;
  }
  const db = getDb();
  return db.collection('events').findOne({ _id: oid });
}

// Event hala bekliyor/aktif ise gunceller. Arada durumu degistiyse (ornegin gonderildi) false doner.
async function updateEvent(event, fields) {
  const db = getDb();
  const result = await db.collection('events').updateOne({ _id: event._id, status: event.status }, { $set: fields });
  if (!result.matchedCount) return false;

  if (event.status === 'active') {
    activeByChannel.set(event.activeChannelId, { ...event, ...fields });
  }
  return true;
}

async function deleteEvent(event) {
  const db = getDb();
  const result = await db.collection('events').deleteOne({ _id: event._id, status: event.status });
  if (!result.deletedCount) return false;

  if (event.status === 'active') activeByChannel.delete(event.activeChannelId);
  return true;
}

module.exports = {
  parseEventDuration,
  MIN_DURATION_MS,
  MAX_DURATION_MS,
  listEvents,
  getEvent,
  updateEvent,
  deleteEvent,
  createEvent,
  loadActiveEvents,
  runDueEvents,
  getActiveEvent,
  isWinningMessage,
  claimWinner,
  applyPlaceholders,
};