const { getDb } = require('./db');

// Hesabi bu kadar gunden yeni olan uyeler "yan hesap" sayilir.
const FAKE_ACCOUNT_DAYS = 7;

// guildId -> Map(code -> { uses, maxUses, inviterId })
const inviteCache = new Map();

// Ayni anda birden fazla kisi katilirsa davetlerin karismamasi icin sunucu basina sira tutulur.
const locks = new Map();
function withLock(guildId, fn) {
  const prev = locks.get(guildId) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(guildId, next.catch(() => {}));
  return next;
}

function toMap(invites) {
  const map = new Map();
  invites.forEach(inv => {
    map.set(inv.code, { uses: inv.uses ?? 0, maxUses: inv.maxUses ?? 0, inviterId: inv.inviter?.id ?? null });
  });
  return map;
}

// Sunucunun mevcut davet kullanim sayilarini hafizaya alir (bot acilisinda ve sunucuya girince).
async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    inviteCache.set(guild.id, toMap(invites));
    return true;
  } catch (err) {
    console.warn(`[INVITES] ${guild.name} davetleri alinamadi (Sunucuyu Yonet yetkisi gerekli): ${err.message}`);
    return false;
  }
}

function onInviteCreate(invite) {
  const map = inviteCache.get(invite.guild?.id);
  if (!map) return;
  map.set(invite.code, { uses: invite.uses ?? 0, maxUses: invite.maxUses ?? 0, inviterId: invite.inviter?.id ?? null });
}

// Eski ve yeni davet listesini karsilastirip kullanilan daveti bulur. Bulamazsa null (vanity/bilinmeyen).
function diffInvites(before, afterMap) {
  if (!before) return null;

  for (const [code, after] of afterMap) {
    const prev = before.get(code);
    if (after.uses > (prev ? prev.uses : 0)) return { code, inviterId: after.inviterId };
  }

  // Tek kullanimlik davet kullanilinca silinir: listede yok ama son kullanimiyla bitmis olmali.
  for (const [code, prev] of before) {
    if (!afterMap.has(code) && prev.maxUses > 0 && prev.uses + 1 >= prev.maxUses) {
      return { code, inviterId: prev.inviterId };
    }
  }
  return null;
}

async function findUsedInvite(guild) {
  let fetched;
  try {
    fetched = await guild.invites.fetch();
  } catch {
    return null;
  }
  const afterMap = toMap(fetched);
  const used = diffInvites(inviteCache.get(guild.id), afterMap);
  inviteCache.set(guild.id, afterMap);
  return used;
}

// Yeni uye katildiginda hangi davetle geldigini kaydeder.
async function recordJoin(member) {
  if (member.user.bot) return null;

  const used = await withLock(member.guild.id, () => findUsedInvite(member.guild));
  const createdTs = member.user.createdTimestamp;

  const doc = {
    guildId: member.guild.id,
    inviteeId: member.id,
    inviteeTag: member.user.tag || member.user.username,
    inviterId: used && used.inviterId !== member.id ? used.inviterId : null,
    code: used ? used.code : null,
    joinedAt: new Date(),
    accountCreatedAt: new Date(createdTs),
    isFake: Date.now() - createdTs < FAKE_ACCOUNT_DAYS * 86_400_000,
    left: false,
    leftAt: null,
  };

  await getDb().collection('inviteJoins').insertOne(doc);
  return doc;
}

// Uye ayrilinca son katilim kaydini "ayrildi" olarak isaretler.
async function recordLeave(member) {
  await getDb().collection('inviteJoins').findOneAndUpdate(
    { guildId: member.guild.id, inviteeId: member.id, left: false },
    { $set: { left: true, leftAt: new Date() } },
    { sort: { joinedAt: -1 } },
  );
}

// Bir kisinin davet ettigi herkes, en yeniden eskiye.
async function getInvitedList(guildId, inviterId) {
  const list = await getDb().collection('inviteJoins').find({ guildId, inviterId }).toArray();
  return list.sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt));
}

function computeStats(list) {
  return {
    total: list.length,
    left: list.filter(r => r.left).length,
    fake: list.filter(r => r.isFake).length,
    real: list.filter(r => !r.left && !r.isFake).length,
  };
}

module.exports = {
  FAKE_ACCOUNT_DAYS,
  cacheGuildInvites,
  onInviteCreate,
  diffInvites,
  recordJoin,
  recordLeave,
  getInvitedList,
  computeStats,
};