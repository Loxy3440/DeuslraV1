const { getDb } = require('./db');

async function nextCaseNumber(guildId) {
  const db = getDb();
  const last = await db.collection('warns').find({ guildId }).sort({ caseNumber: -1 }).limit(1).toArray();
  return last.length ? last[0].caseNumber + 1 : 1;
}

async function addWarn(guildId, userId, moderatorId, reason) {
  const db = getDb();
  const caseNumber = await nextCaseNumber(guildId);

  const warn = {
    guildId,
    userId,
    moderatorId,
    reason,
    caseNumber,
    timestamp: new Date(),
  };

  await db.collection('warns').insertOne(warn);
  return warn;
}

async function getWarns(guildId, userId) {
  const db = getDb();
  return db.collection('warns').find({ guildId, userId }).sort({ timestamp: -1 }).toArray();
}

// 2 gunden eski uyarilari siler (ready.js her 1 dakikada bir cagirir).
const WARN_EXPIRY_MS = 2 * 24 * 60 * 60 * 1000;

async function deleteExpiredWarns() {
  const db = getDb();
  const cutoff = new Date(Date.now() - WARN_EXPIRY_MS);
  const result = await db.collection('warns').deleteMany({ timestamp: { $lt: cutoff } });
  return result.deletedCount;
}

module.exports = { addWarn, getWarns, deleteExpiredWarns };