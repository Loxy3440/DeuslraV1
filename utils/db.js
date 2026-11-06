const { MongoClient } = require('mongodb');

let client;
let db;

async function connectDB() {
  if (db) return db;

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI tanimli degil. Render > Environment kismina MONGO_URI ekle (.env dosyasi Render\'a gitmez).');
  }
  if (/localhost|127\.0\.0\.1/.test(uri) && process.env.RENDER) {
    throw new Error('MONGO_URI localhost gosteriyor. Render uzerinde localhost MongoDB yok; MongoDB Atlas baglanti adresini kullan.');
  }

  client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  db = client.db(process.env.MONGO_DB_NAME || 'discordbot');
  await db.command({ ping: 1 });
  console.log('[MONGODB] Baglanti basarili.');
  return db;
}

function getDb() {
  if (!db) throw new Error('Veritabani henuz baglanmadi. Once connectDB() cagirilmali.');
  return db;
}

module.exports = { connectDB, getDb };