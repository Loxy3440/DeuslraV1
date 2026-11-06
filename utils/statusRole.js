// Özel durum (custom status) metnine göre otomatik rol: üyenin Discord durum yazısında ayarlı yazı geçiyorsa rol verilir,
// kaldırınca geri alınır. Etiket sistemiyle aynı mantık. Presence (GuildPresences) intent'i gerekir: .env USE_PRESENCE=true.
const { PermissionFlagsBits, ActivityType, GatewayIntentBits } = require('discord.js');
const { getConfig } = require('./guildConfig');
const { getDb } = require('./db');
const { registerCommandGrant } = require('./askPerm');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const presenceEnabled = client => Boolean(client?.options?.intents?.has?.(GatewayIntentBits.GuildPresences));

// Üyenin özel durum yazısı (yoksa null).
function customStatusText(member) {
  const act = member.presence?.activities?.find(a => a.type === ActivityType.Custom);
  const text = [act?.state, act?.name !== 'Custom Status' ? act?.name : null].filter(Boolean).join(' ');
  return text || null;
}

// true: yazı var, false: yok, null: bilinmiyor (çevrimdışı/görünmez ya da presence gelmedi — rolü bozma)
function hasStatusText(member, needle) {
  const p = member.presence;
  if (!p || p.status === 'offline') return null;
  return (customStatusText(member) || '').toLowerCase().includes(String(needle).toLowerCase());
}

async function syncMember(member) {
  if (!member || member.user.bot || !presenceEnabled(member.client)) return;
  const config = await getConfig(member.guild.id);
  if (!config.statusRoleId || !config.statusText) return;

  const role = member.guild.roles.cache.get(config.statusRoleId);
  if (!role) return;
  const me = member.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position) return;

  const has = hasStatusText(member, config.statusText);
  if (has === null) return;

  const grants = getDb().collection('statusGrants');
  const key = { guildId: member.guild.id, userId: member.id };
  const hasRole = member.roles.cache.has(role.id);

  if (has && !hasRole) {
    registerCommandGrant(member.guild.id, member.id, role.id, member.client.user.id);
    const ok = await member.roles.add(role, 'Durum yazısı takıldı').then(() => true).catch(err => { console.error('[DURUM] Rol verilemedi:', err.message); return false; });
    if (!ok) return;
    await grants.updateOne(key, { $set: { ...key, roleId: role.id, at: Date.now() } }, { upsert: true });
    await announce(member, config);
  } else if (!has && hasRole) {
    const granted = await grants.findOne(key); // sadece durum yüzünden verdiğimiz rolü al
    if (!granted) return;
    registerCommandGrant(member.guild.id, member.id, role.id, member.client.user.id);
    await member.roles.remove(role, 'Durum yazısı kaldırıldı').catch(err => console.error('[DURUM] Rol alınamadı:', err.message));
    await grants.deleteOne(key);
  } else if (has && hasRole) {
    await grants.updateOne(key, { $setOnInsert: { ...key, roleId: role.id, at: Date.now() } }, { upsert: true });
  }
}

async function announce(member, config) {
  if (!config.statusChannelId) return;
  const channel = member.guild.channels.cache.get(config.statusChannelId) || (await member.guild.channels.fetch(config.statusChannelId).catch(() => null));
  if (!channel || !channel.isTextBased()) return;
  try {
    const msg = await channel.send({ content: `<@${member.id}>`, allowedMentions: { users: [member.id] } });
    await sleep(1500);
    await msg.delete().catch(() => {});
  } catch (err) {
    console.error('[DURUM] Kanala mesaj atılamadı:', err.message);
  }
}

async function sweepGuild(guild) {
  const config = await getConfig(guild.id);
  if (!config.statusRoleId || !config.statusText) return;
  const members = await guild.members.fetch().catch(() => null);
  if (!members) return;
  for (const member of members.values()) {
    try { await syncMember(member); } catch (err) { console.error('[DURUM SWEEP]', err.message); }
    if (member.presence) await sleep(200);
  }
}

function startStatusSweep(client) {
  if (!presenceEnabled(client)) {
    console.warn('[DURUM] Presence intent kapalı: /setdurum çalışmaz. .env içine USE_PRESENCE=true yaz ve Developer Portal > Bot > Presence Intent aç.');
    return;
  }
  const run = async () => {
    for (const guild of client.guilds.cache.values()) await sweepGuild(guild).catch(err => console.error('[DURUM SWEEP]', guild.id, err.message));
  };
  run();
  setInterval(run, 10 * 60 * 1000).unref?.();
}

module.exports = { syncMember, startStatusSweep, customStatusText, hasStatusText, presenceEnabled };
