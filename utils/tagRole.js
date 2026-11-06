const { PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('./guildConfig');
const { getDb } = require('./db');
const { registerCommandGrant } = require('./askPerm');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Üye bu sunucunun etiketini (Server Tag) takıyor mu?
function wearsTag(member) {
  const pg = member.user?.primaryGuild;
  return Boolean(pg && pg.identityEnabled && pg.identityGuildId === member.guild.id);
}

// Tek üyeyi kontrol eder: etiket varsa rolü verir (+ kanalda etiketleyip siler), etiketi çıkardıysa rolü alır.
async function syncMember(member) {
  if (!member || member.user.bot) return;

  const config = await getConfig(member.guild.id);
  if (!config.tagRoleId) return;

  const role = member.guild.roles.cache.get(config.tagRoleId);
  if (!role) return;

  const me = member.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position) return;

  const grants = getDb().collection('tagGrants');
  const key = { guildId: member.guild.id, userId: member.id };
  const hasTag = wearsTag(member);
  const hasRole = member.roles.cache.has(role.id);

  if (hasTag && !hasRole) {
    // Sistem işlemi: askperm izin istemesin.
    registerCommandGrant(member.guild.id, member.id, role.id, member.client.user.id);
    const ok = await member.roles.add(role, 'Sunucu etiketi takıldı').then(() => true).catch(err => {
      console.error('[TAG] Rol verilemedi:', err.message);
      return false;
    });
    if (!ok) return;

    await grants.updateOne(key, { $set: { ...key, roleId: role.id, at: Date.now() } }, { upsert: true });
    await announce(member, config);
  } else if (!hasTag && hasRole) {
    // Sadece etiket yüzünden verdiğimiz rolü geri al (elle verilmiş rolü bozma).
    const granted = await grants.findOne(key);
    if (!granted) return;
    registerCommandGrant(member.guild.id, member.id, role.id, member.client.user.id);
    await member.roles.remove(role, 'Sunucu etiketi çıkarıldı').catch(err => console.error('[TAG] Rol alınamadı:', err.message));
    await grants.deleteOne(key);
  } else if (hasTag && hasRole) {
    await grants.updateOne(key, { $setOnInsert: { ...key, roleId: role.id, at: Date.now() } }, { upsert: true });
  }
}

// Kanalda üyeyi etiketler, kısa süre sonra mesajı siler.
async function announce(member, config) {
  if (!config.tagChannelId) return;
  const channel =
    member.guild.channels.cache.get(config.tagChannelId) ||
    (await member.guild.channels.fetch(config.tagChannelId).catch(() => null));
  if (!channel || !channel.isTextBased()) return;

  try {
    const msg = await channel.send({
      content: `<@${member.id}>`,
      allowedMentions: { users: [member.id] },
    });
    await sleep(1500);
    await msg.delete().catch(() => {});
  } catch (err) {
    console.error('[TAG] Kanala mesaj atılamadı:', err.message);
  }
}

// Bot açılışında ve belirli aralıkla tüm üyeleri tarar (tag değişikliği kaçmasın diye).
async function sweepGuild(guild) {
  const config = await getConfig(guild.id);
  if (!config.tagRoleId) return;
  const members = await guild.members.fetch().catch(() => null);
  if (!members) return;
  for (const member of members.values()) {
    try {
      await syncMember(member);
    } catch (err) {
      console.error('[TAG SWEEP]', err.message);
    }
    await sleep(300);
  }
}

function startTagSweep(client) {
  const run = async () => {
    for (const guild of client.guilds.cache.values()) {
      await sweepGuild(guild).catch(err => console.error('[TAG SWEEP]', guild.id, err.message));
    }
  };
  run();
  setInterval(run, 10 * 60 * 1000).unref?.();
}

module.exports = { wearsTag, syncMember, startTagSweep };
