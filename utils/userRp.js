const { getDb } = require('./db');

// Kullanici hesabinin Rich Presence ayari (botun presence'indan bagimsiz).
// Bu ayari sunucu Discord'a GONDERMEZ; bilgisayarindaki rpc-client scripti /api/rp/config'ten okuyup Discord masaustu uygulamasina yerel RPC ile basar.
const DOC_ID = 'userRp';

const DEFAULT_USER_RP = {
  enabled: false,
  type: 5, // 0 Oynuyor, 2 Dinliyor, 3 Izliyor, 5 Yarisiyor
  appName: '', // sadece panel onizlemesi icin; Discord'da gorunen ad Developer Portal'daki uygulama adidir
  details: '',
  state: '',
  largeImage: '',
  largeText: '',
  smallImage: '',
  smallText: '',
  timer: 'now', // 'none' | 'now' (kaydedildigi andan itibaren gecen sure)
  buttons: [], // [{ label, url }] en fazla 2
  updatedAt: 0,
};

async function getUserRp() {
  const config = await getDb().collection('botConfig').findOne({ _id: DOC_ID });
  const { _id, ...rest } = config || {};
  return { ...DEFAULT_USER_RP, ...rest };
}

async function saveUserRp(data) {
  await getDb().collection('botConfig').updateOne({ _id: DOC_ID }, { $set: { ...data, updatedAt: Date.now() } }, { upsert: true });
}

module.exports = { DEFAULT_USER_RP, getUserRp, saveUserRp };
