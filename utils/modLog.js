// Tüm log sistemi: log kanalına embed gönderir ve panelde görünsün diye son kayıtları veritabanında tutar.
// Kategoriler /setlog kategori veya panelin "Log" sekmesinden tek tek açılıp kapatılabilir (varsayılan: hepsi açık).
const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('./guildConfig');
const { getDb } = require('./db');

const CATEGORIES = {
  mod: 'Moderasyon (mute, ban, kick, promote, demote, addnick, partner)',
  mesaj: 'Silinen ve düzenlenen mesajlar',
  uye: 'Üye girişi/çıkışı, rol ve takma ad değişimi',
  kanal: 'Kanal ve rol oluşturma/silme',
  ses: 'Ses kanalı giriş/çıkış',
  ayar: 'Bot ve web paneli ayar değişiklikleri, komut kullanımı',
};

const ACTIONS = {
  mute: { title: '🔇 Mute', color: 0xe67e22, cat: 'mod' },
  unmute: { title: '🔊 Unmute', color: 0x57f287, cat: 'mod' },
  ban: { title: '🔨 Ban', color: 0xed4245, cat: 'mod' },
  unban: { title: '♻️ Unban', color: 0x57f287, cat: 'mod' },
  kick: { title: '👢 Kick', color: 0xe67e22, cat: 'mod' },
  promote: { title: '⬆️ Promote', color: 0x3ba55d, cat: 'mod' },
  demote: { title: '⬇️ Demote', color: 0xfaa61a, cat: 'mod' },
  addnick: { title: '🏷️ Toplu Takma Ad', color: 0x5865f2, cat: 'mod' },
  partner: { title: '🤝 Partner', color: 0x5865f2, cat: 'mod' },
  msgdelete: { title: '🗑️ Mesaj Silindi', color: 0xed4245, cat: 'mesaj' },
  msgedit: { title: '✏️ Mesaj Düzenlendi', color: 0xfaa61a, cat: 'mesaj' },
  join: { title: '📥 Üye Katıldı', color: 0x57f287, cat: 'uye' },
  leave: { title: '📤 Üye Ayrıldı', color: 0x99aab5, cat: 'uye' },
  roleadd: { title: '➕ Rol Verildi', color: 0x3ba55d, cat: 'uye' },
  roleremove: { title: '➖ Rol Alındı', color: 0xfaa61a, cat: 'uye' },
  nick: { title: '📝 Takma Ad Değişti', color: 0x5865f2, cat: 'uye' },
  chcreate: { title: '📁 Kanal Oluşturuldu', color: 0x57f287, cat: 'kanal' },
  chdelete: { title: '🗂️ Kanal Silindi', color: 0xed4245, cat: 'kanal' },
  rolecreate: { title: '🎭 Rol Oluşturuldu', color: 0x57f287, cat: 'kanal' },
  roledelete: { title: '🎭 Rol Silindi', color: 0xed4245, cat: 'kanal' },
  voicejoin: { title: '🎙️ Sese Girdi', color: 0x57f287, cat: 'ses' },
  voiceleave: { title: '🔈 Sesten Çıktı', color: 0x99aab5, cat: 'ses' },
  voicemove: { title: '🔀 Ses Kanalı Değiştirdi', color: 0x5865f2, cat: 'ses' },
  panel: { title: '🌐 Web Paneli', color: 0x9b59b6, cat: 'ayar' },
  command: { title: '⚙️ Komut Kullanıldı', color: 0x5865f2, cat: 'ayar' },
  status: { title: '🟢 Bot Durumu', color: 0x9b59b6, cat: 'ayar' },
};

const categoryOn = (config, cat) => cat === 'mod' || (config.logCategories || {})[cat] !== false;

// Aynı olayı hem komut hem Discord olayı iki kez loglamasın diye kısa süreli işaret.
const handled = new Map();
function markHandled(key) { handled.set(key, Date.now() + 20_000); }
function wasHandled(key) {
  const t = handled.get(key);
  if (!t) return false;
  if (t < Date.now()) { handled.delete(key); return false; }
  return true;
}

const actorOf = u => (u ? { id: u.id, tag: u.tag || u.username || u.name || u.id } : null);
const who = u => `${u.tag || u.username || u.id} (<@${u.id}>)`;
const clip = (s, n = 1000) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

let inserts = 0;
async function store(guildId, entry) {
  try {
    const col = getDb().collection('modLogs');
    await col.insertOne({ guildId, at: new Date(), ...entry });
    if (++inserts % 50 === 0) { // son 500 kaydı tut
      const old = await col.find({ guildId }).sort({ at: -1 }).skip(500).limit(1).toArray();
      if (old[0]) await col.deleteMany({ guildId, at: { $lte: old[0].at } });
    }
  } catch (err) { console.error('[MODLOG] kayıt:', err.message); }
}

async function getRecentLogs(guildId, { limit = 100, cat } = {}) {
  const q = { guildId };
  if (cat && CATEGORIES[cat]) q.cat = cat;
  const list = await getDb().collection('modLogs').find(q).sort({ at: -1 }).limit(Math.min(limit, 300)).toArray();
  return list.map(e => ({ at: e.at, cat: e.cat, action: e.action, title: e.title, text: e.text }));
}

// opts: { action, target, moderator, reason, description, fields:[{name,value,inline}], imageUrl, fromPanel, skipKey }
async function logAction(guild, opts) {
  try {
    if (!guild) return false;
    const meta = ACTIONS[opts.action] || { title: opts.action, color: 0x99aab5, cat: 'ayar' };
    if (opts.dedupeKey) { if (wasHandled(opts.dedupeKey)) return false; }
    if (opts.markKey) markHandled(opts.markKey);

    const config = await getConfig(guild.id);
    if (!categoryOn(config, meta.cat)) return false;

    const embed = new EmbedBuilder().setTitle(meta.title).setColor(meta.color).setTimestamp();
    const lines = [];
    const t = opts.target?.user || opts.target;
    if (t) { embed.addFields({ name: 'Hedef', value: who(t), inline: true }); lines.push(`Hedef: ${t.tag || t.username || t.id}`); }
    const m = opts.moderator?.user || opts.moderator;
    if (m) { embed.addFields({ name: 'Yetkili', value: who(m), inline: true }); lines.push(`Yetkili: ${m.tag || m.username || m.name || m.id}`); }
    if (opts.fromPanel !== undefined && (m || opts.fromPanel)) embed.addFields({ name: 'Kaynak', value: opts.fromPanel ? '🌐 Web paneli' : '💬 Discord', inline: true });
    if (opts.description) { embed.setDescription(clip(opts.description, 3500)); lines.push(clip(opts.description, 300)); }
    if (opts.reason) { embed.addFields({ name: 'Sebep', value: clip(opts.reason) }); lines.push(`Sebep: ${clip(opts.reason, 200)}`); }
    for (const f of opts.fields || []) { embed.addFields({ name: f.name, value: clip(f.value) || '—', inline: !!f.inline }); lines.push(`${f.name}: ${clip(f.value, 150)}`); }
    if (opts.imageUrl) embed.setImage(opts.imageUrl);

    await store(guild.id, { cat: meta.cat, action: opts.action, title: meta.title, text: lines.join(' · ').slice(0, 1500) });

    if (!config.logChannelId || opts.noChannel) return !!opts.noChannel; // noChannel: sadece panel geçmişine yaz
    const channel = guild.channels.cache.get(config.logChannelId) || (await guild.channels.fetch(config.logChannelId).catch(() => null));
    if (!channel || !channel.isTextBased()) return false;
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
  } catch (err) {
    console.error('[MODLOG]', err.message);
    return false;
  }
}

// Panel ve komut kullanımı: komut seçeneklerini okunur bir satıra çevirir.
function describeOptions(data) {
  const parts = [];
  const walk = list => {
    for (const o of list || []) {
      if (o.options && (o.type === 1 || o.type === 2)) { parts.push(o.name); walk(o.options); continue; }
      let v = o.value;
      if (o.user) v = `<@${o.user.id}>`; else if (o.role) v = `<@&${o.role.id}>`; else if (o.channel) v = `<#${o.channel.id}>`; else if (o.attachment) v = '[dosya]';
      parts.push(`${o.name}: ${clip(v, 80)}`);
    }
  };
  walk(data);
  return parts.join(' · ');
}

// Kendi detaylı logunu yazan komutlar, genel "komut kullanıldı" kaydı atmaz.
const SELF_LOGGED = new Set(['mute', 'unmute', 'ban', 'unban', 'kick', 'promote', 'demote', 'addnick']);
const QUIET = new Set(['ping', 'help', 'banlist', 'warnlist', 'eventlist', 'invites', 'roles', 'emojiall', 'tagkontrol']);

async function logCommand(guild, { name, user, optionsText, fromPanel }) {
  if (SELF_LOGGED.has(name) || QUIET.has(name)) return false;
  return logAction(guild, {
    action: 'command', moderator: actorOf(user), fromPanel: !!fromPanel,
    description: `\`/${name}\`${optionsText ? ' ' + optionsText : ''}`,
  });
}

module.exports = { logAction, logCommand, describeOptions, actorOf, categoryOn, getRecentLogs, markHandled, wasHandled, CATEGORIES, ACTIONS, SELF_LOGGED };
