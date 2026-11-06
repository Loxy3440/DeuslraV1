const { getDb } = require('./db');

async function addTempRole(guildId, userId, roleId, removeAt, channelId = null) {
  const db = getDb();
  await db.collection('tempRoles').insertOne({ guildId, userId, roleId, removeAt, channelId });
}

async function removeTempRole(guildId, userId, roleId) {
  const db = getDb();
  await db.collection('tempRoles').deleteMany({ guildId, userId, roleId });
}

async function getDueTempRoles() {
  const db = getDb();
  return db.collection('tempRoles').find({ removeAt: { $lte: new Date() } }).toArray();
}

module.exports = { addTempRole, removeTempRole, getDueTempRoles };