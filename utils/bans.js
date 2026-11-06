const { getDb } = require('./db');

async function addBan(guildId, userId, userTag, moderatorId, reason, evidenceUrl) {
  const db = getDb();
  const ban = {
    guildId,
    userId,
    userTag,
    moderatorId,
    reason,
    evidenceUrl: evidenceUrl || null,
    timestamp: new Date(),
  };
  // Ayni kullanici tekrar banlanirsa en guncel kaydi tutuyoruz (upsert).
  await db.collection('bans').updateOne(
    { guildId, userId },
    { $set: ban },
    { upsert: true },
  );
  return ban;
}

async function removeBanRecord(guildId, userId) {
  const db = getDb();
  await db.collection('bans').deleteOne({ guildId, userId });
}

async function getBanRecord(guildId, userId) {
  const db = getDb();
  return db.collection('bans').findOne({ guildId, userId });
}

// Kullanici adina (tag) veya ID'ye gore, o sunucudaki kayitli banlar icinde arama yapar.
async function searchBanRecord(guildId, query) {
  const db = getDb();

  if (/^\d{15,25}$/.test(query)) {
    const byId = await db.collection('bans').findOne({ guildId, userId: query });
    if (byId) return byId;
  }

  return db.collection('bans').findOne({
    guildId,
    userTag: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
  });
}

async function getAllBanRecords(guildId) {
  const db = getDb();
  return db.collection('bans').find({ guildId }).sort({ timestamp: -1 }).toArray();
}

module.exports = { addBan, removeBanRecord, getBanRecord, searchBanRecord, getAllBanRecords };