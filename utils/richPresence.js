// =====================================================================
//  RICH PRESENCE TASLAGI  —  SADECE BU DOSYADAKI "RICH_PRESENCE" KISMINI DOLDUR
//  Panelden yalnizca ACMA / KAPATMA yapilir; icerik buradan okunur.
//  Bu dosyayi degistirince botu yeniden baslatman (Render'da redeploy) yeterli.
// =====================================================================
const RICH_PRESENCE = {
  // Etkinlik turu: 0 = Oynuyor, 2 = Dinliyor, 3 = Izliyor, 5 = Yarisiyor
  type: 0,

  // Discord'da "Oynuyor ..." satirinda gorunen ad.
  name: 'Deuslra Gardiyan',

  // Ust satir (details) ve alt satir (state). Bos birakirsan gosterilmez. En az 2 karakter.
  // {uye} ve {sunucu} yazarsan canli sayiyla degisir.
  details: 'Sunucuyu koruyor',
  state: '{uye} uye izleniyor',

  // Resimler: Developer Portal > uygulaman > Rich Presence > Art Assets'e yukledigin gorselin ADI.
  // (https:// link calismaz, sadece asset adi yaz.) Bos = resim yok.
  largeImage: '',
  largeText: '',
  smallImage: '',
  smallText: '',

  // Hangi uygulamanin asset'leri kullanilsin? Bos birakirsan botun kendi CLIENT_ID'si kullanilir.
  applicationId: '',

  // Sure sayaci: 'none' = gosterme, 'now' = acildigi andan beri gecen sure,
  // ya da sabit bir baslangic icin ms cinsinden sayi (ornek: 1507665886000).
  timer: 'now',

  // Butonlar (en fazla 2): { label: 'Yazi', url: 'https://...' }
  // NOT: Discord botlarda butonlari genelde gostermez; yine de gonderilir.
  buttons: [
    // { label: 'Sunucuya Katil', url: 'https://discord.gg/xxxx' },
  ],

  // Rich Presence acikken botun durumu: 'online' | 'idle' | 'dnd' | 'invisible'
  status: 'online',
};
// =====================================================================

const startedAt = Date.now();

function render(client, text) {
  const { getMemberCount } = require('./activityRotator');
  return String(text || '')
    .replace(/\{(uye|members)\}/gi, getMemberCount(client).toLocaleString('tr-TR'))
    .replace(/\{(sunucu|guilds)\}/gi, String(client.guilds.cache.size));
}

// Taslagi Discord gateway'in bekledigi etkinlik nesnesine cevirir.
function buildActivity(client, openedAt) {
  const rp = RICH_PRESENCE;
  const a = {
    name: render(client, rp.name) || 'Deuslra Gardiyan',
    type: [0, 2, 3, 5].includes(rp.type) ? rp.type : 0,
    application_id: rp.applicationId || process.env.CLIENT_ID || client.user.id,
  };
  const details = render(client, rp.details).trim();
  const state = render(client, rp.state).trim();
  if (details.length >= 2) a.details = details.slice(0, 128);
  if (state.length >= 2) a.state = state.slice(0, 128);

  if (rp.timer === 'now') a.timestamps = { start: openedAt || startedAt };
  else if (Number(rp.timer) > 0) a.timestamps = { start: Number(rp.timer) };

  const assets = {};
  if (rp.largeImage) assets.large_image = rp.largeImage;
  if (rp.largeText) assets.large_text = rp.largeText;
  if (rp.smallImage) assets.small_image = rp.smallImage;
  if (rp.smallText) assets.small_text = rp.smallText;
  if (Object.keys(assets).length) a.assets = assets;

  const buttons = (rp.buttons || []).filter(b => b && b.label && /^https?:\/\//i.test(b.url || '')).slice(0, 2);
  if (buttons.length) {
    a.buttons = buttons.map(b => b.label);
    a.metadata = { button_urls: buttons.map(b => b.url) };
  }
  return a;
}

// discord.js'in setPresence'i details/assets/timestamps alanlarini gondermedigi icin
// presence paketini (op 3) dogrudan gateway'e yolluyoruz.
function sendRaw(client, activity, status) {
  const packet = { op: 3, d: { since: null, activities: activity ? [activity] : [], status, afk: false } };
  if (typeof client.ws.broadcast === 'function') return client.ws.broadcast(packet);
  for (const shard of client.ws.shards.values()) shard.send(packet);
}

function getStatus() {
  return ['online', 'idle', 'dnd', 'invisible'].includes(RICH_PRESENCE.status) ? RICH_PRESENCE.status : 'online';
}

// Panelde gosterilecek ozet (gizli bir sey icermez).
function getTemplateView() {
  const { details, state, name, type, largeImage, smallImage, timer, buttons } = RICH_PRESENCE;
  return { name, type, details, state, largeImage, smallImage, timer: timer === 'none' ? 'yok' : 'var', buttons: (buttons || []).length };
}

module.exports = { RICH_PRESENCE, buildActivity, sendRaw, getStatus, getTemplateView };
