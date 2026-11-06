// Partner referansı: /partner ile "bu kişi şu partneri sağladı" denir, log kanalına yetkili rolü etiketli
// Onayla / Reddet butonlu istek düşer. Onaylanırsa referans verilen kişinin partner sayacı +1 olur
// ve auto rank up (partner koşulu olan basamaklar) hemen kontrol edilir.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const crypto = require('crypto');
const { getDb } = require('./db');
const { getConfig } = require('./guildConfig');
const { checkMemberAll, CAT_LABEL } = require('./autoRankup');
const { logAction } = require('./modLog');

const DEFAULT_PARTNER_ROLE_ID = null; // /setlog partnerrol ile ayarlanır
const col = () => getDb().collection('partnerRecords'); // { guildId, id, userId, reporterId, partner, status, createdAt, decidedAt, decidedBy, messageId }

const partnerRoleId = config => config.partnerRoleId || DEFAULT_PARTNER_ROLE_ID;

function canDecide(member, config) {
  if (!member) return false;
  if (process.env.OWNER_ID && member.id === process.env.OWNER_ID) return true;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  const rid = partnerRoleId(config);
  return !!rid && member.roles.cache.has(rid);
}

function buttons(id, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`partner:ok:${id}`).setLabel('Onayla').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`partner:no:${id}`).setLabel('Reddet').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

// Log kanalına istek gönderir. { ok, error? }
async function createRequest(guild, { userId, userTag, reporter, partner, imageUrl }) {
  const config = await getConfig(guild.id);
  if (!config.logChannelId) return { ok: false, error: 'Log kanalı ayarlı değil. Önce `/setlog ayarla` ile bir kanal seç.' };
  const channel = guild.channels.cache.get(config.logChannelId) || (await guild.channels.fetch(config.logChannelId).catch(() => null));
  if (!channel?.isTextBased?.()) return { ok: false, error: 'Log kanalına erişemiyorum.' };

  const id = crypto.randomBytes(6).toString('hex');
  const roleId = partnerRoleId(config);
  const embed = new EmbedBuilder()
    .setTitle('🤝 Yeni Partner Bildirimi')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Partneri sağlayan', value: `${userTag} (<@${userId}>)`, inline: true },
      { name: 'Bildiren', value: `${reporter.tag} (<@${reporter.id}>)`, inline: true },
      { name: 'Partner', value: String(partner).slice(0, 1000) },
      { name: 'Durum', value: '⏳ Onay bekliyor' },
    )
    .setFooter({ text: `Talep: ${id}` })
    .setTimestamp();
  if (imageUrl) embed.setImage(imageUrl);

  const msg = await channel.send({
    content: roleId ? `<@&${roleId}> yeni partner onayı bekliyor.` : 'Yeni partner onayı bekliyor.',
    embeds: [embed],
    components: [buttons(id)],
    allowedMentions: { roles: roleId ? [roleId] : [], users: [] },
  }).catch(() => null);
  if (!msg) return { ok: false, error: 'Log kanalına mesaj gönderemedim. Botun yetkilerini kontrol et.' };

  await col().insertOne({ guildId: guild.id, id, userId, reporterId: reporter.id, partner: String(partner), status: 'pending', createdAt: new Date(), messageId: msg.id, channelId: channel.id });
  return { ok: true, id };
}

async function handlePartnerInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('partner:')) return false;
  const [, action, id] = interaction.customId.split(':');
  const guild = interaction.guild;
  if (!guild) return true;

  const config = await getConfig(guild.id);
  if (!canDecide(interaction.member, config)) {
    await interaction.reply({ content: 'Bu butonu sadece partner yetkilileri kullanabilir.', ephemeral: true });
    return true;
  }

  const rec = await col().findOne({ guildId: guild.id, id });
  if (!rec) { await interaction.reply({ content: 'Bu talep kaydı bulunamadı.', ephemeral: true }); return true; }
  if (rec.status !== 'pending') { await interaction.reply({ content: 'Bu talep zaten sonuçlanmış.', ephemeral: true }); return true; }

  const isOwner = process.env.OWNER_ID && interaction.user.id === process.env.OWNER_ID;
  if (action === 'ok' && rec.userId === interaction.user.id && !isOwner) {
    await interaction.reply({ content: 'Kendi partner talebini onaylayamazsın.', ephemeral: true });
    return true;
  }

  const status = action === 'ok' ? 'approved' : 'rejected';
  // Çift tıklamaya karşı: sadece hâlâ bekleyen kayıt güncellenir.
  const upd = await col().updateOne({ guildId: guild.id, id, status: 'pending' }, { $set: { status, decidedAt: new Date(), decidedBy: interaction.user.id } });
  if (!upd.modifiedCount) { await interaction.reply({ content: 'Bu talep zaten sonuçlanmış.', ephemeral: true }); return true; }

  await interaction.deferUpdate();

  const lines = [];
  if (status === 'approved') {
    const total = await col().countDocuments({ guildId: guild.id, userId: rec.userId, status: 'approved' });
    lines.push(`Toplam onaylı partner: **${total}**`);
    const member = guild.members.cache.get(rec.userId) || (await guild.members.fetch(rec.userId).catch(() => null));
    if (member) {
      const done = await checkMemberAll(guild, member).catch(() => []);
      for (const d of done) lines.push(`🎉 ${CAT_LABEL[d.cat]}: **${d.from ? d.from.name : '—'}** → **${d.to.name}** rankına yükseldi`);
    } else {
      lines.push('⚠️ Kişi sunucuda değil, rank kontrolü yapılamadı.');
    }
  }

  logAction(guild, {
    action: 'partner', noChannel: true, target: { id: rec.userId, tag: rec.userId }, moderator: interaction.user,
    description: `${status === 'approved' ? 'Onaylandı' : 'Reddedildi'}: ${rec.partner}`,
  });

  const base = interaction.message.embeds[0];
  const embed = EmbedBuilder.from(base).setColor(status === 'approved' ? 0x57f287 : 0xed4245);
  const fields = (base.fields || []).filter(f => f.name !== 'Durum').map(f => ({ name: f.name, value: f.value, inline: f.inline }));
  fields.push({ name: 'Durum', value: `${status === 'approved' ? '✅ Onaylandı' : '❌ Reddedildi'} — <@${interaction.user.id}>${lines.length ? '\n' + lines.join('\n') : ''}`.slice(0, 1000) });
  embed.setFields(fields);

  await interaction.editReply({ content: '', embeds: [embed], components: [buttons(id, true)], allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}

module.exports = { createRequest, handlePartnerInteraction, canDecide, DEFAULT_PARTNER_ROLE_ID, partnerRoleId };
