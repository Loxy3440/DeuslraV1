const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { errorEmbed } = require('./embeds');
const { FAKE_ACCOUNT_DAYS, getInvitedList, computeStats } = require('./inviteTracker');

const PAGE_SIZE = 8;
const ts = date => Math.floor(new Date(date).getTime() / 1000);

// /invites ana ekran: ozet istatistikler.
async function buildOverview(guild, user) {
  const list = await getInvitedList(guild.id, user.id);
  const stats = computeStats(list);

  // Eski (takip oncesi) davetler icin mevcut davet linklerinin kullanim sayisi.
  let linkLine = 'Alinamadi (botun Sunucuyu Yonet yetkisi gerekli)';
  try {
    const all = await guild.invites.fetch();
    const mine = all.filter(inv => inv.inviter?.id === user.id);
    linkLine = `${mine.size} link • ${mine.reduce((sum, inv) => sum + (inv.uses ?? 0), 0)} kullanim`;
  } catch {
    // yetki yoksa varsayilan metin kalir
  }

  const embed = new EmbedBuilder()
    .setTitle(`${user.username} - Davet Bilgileri`)
    .setColor(0x5865f2)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: '📥 Toplam Davet', value: `**${stats.total}**`, inline: true },
      { name: '✅ Gercek (sunucuda)', value: `**${stats.real}**`, inline: true },
      { name: '🚪 Ayrilan (left)', value: `**${stats.left}**`, inline: true },
      { name: '👤 Yan Hesap', value: `**${stats.fake}** (hesabi ${FAKE_ACCOUNT_DAYS} gunden yeni)`, inline: true },
      { name: '🔗 Aktif Davet Linkleri', value: linkLine, inline: true },
    )
    .setFooter({ text: 'Kisi bazli kayit, takip sisteminin acildigi andan itibaren tutulur. Link kullanimi eski verileri de icerir.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`invu_pg_${user.id}_0`).setLabel('Detaylar').setEmoji('📋').setStyle(ButtonStyle.Secondary).setDisabled(stats.total === 0),
  );

  return { embeds: [embed], components: [row] };
}

function statusText(rec) {
  const parts = [rec.left ? `🚪 Ayrildi <t:${ts(rec.leftAt)}:R>` : '🟢 Sunucuda'];
  if (rec.isFake) parts.push('⚠️ Yan hesap');
  return parts.join(' • ');
}

// Davet edilen kisileri sayfa sayfa gosterir.
async function buildDetailPage(guild, inviterId, page) {
  const list = await getInvitedList(guild.id, inviterId);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const slice = list.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const description = slice.length
    ? slice
      .map((rec, i) => {
        const n = current * PAGE_SIZE + i + 1;
        return (
          `**${n}.** <@${rec.inviteeId}> (**${rec.inviteeTag}**)\n` +
          `┣ ID: \`${rec.inviteeId}\`\n` +
          `┣ Katildi: <t:${ts(rec.joinedAt)}:f> (<t:${ts(rec.joinedAt)}:R>)\n` +
          `┣ Hesap acilis: <t:${ts(rec.accountCreatedAt)}:D>\n` +
          `┣ Davet kodu: ${rec.code ? `\`${rec.code}\`` : 'bilinmiyor'}\n` +
          `┗ Durum: ${statusText(rec)}`
        );
      })
      .join('\n\n')
    : 'Bu kullanicinin takip edilen bir daveti yok.';

  const embed = new EmbedBuilder()
    .setTitle('Davet Ettigi Kisiler')
    .setColor(0x5865f2)
    .setDescription(description)
    .setFooter({ text: `Sayfa ${current + 1}/${pages} • Toplam ${list.length} kisi` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`invu_pg_${inviterId}_${current - 1}`).setLabel('Onceki').setEmoji('⬅️').setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
    new ButtonBuilder().setCustomId(`invu_pg_${inviterId}_${current + 1}`).setLabel('Sonraki').setEmoji('➡️').setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1),
  );

  return { embeds: [embed], components: [row] };
}

// interactionCreate.js bunu cagirir; ilgili bir etkilesimse true doner.
async function handleInviteInteraction(interaction) {
  const customId = interaction.customId;
  if (typeof customId !== 'string' || !customId.startsWith('invu_pg_') || !interaction.isButton()) return false;

  const match = /^invu_pg_(\d+)_(-?\d+)$/.exec(customId);
  if (!match || !interaction.guild) return true;

  try {
    const view = await buildDetailPage(interaction.guild, match[1], parseInt(match[2], 10));
    // "Detaylar" butonu ana mesajda: yeni gizli mesaj ac. Sayfa butonlari gizli mesajin kendisini gunceller.
    if (interaction.message.flags?.has('Ephemeral')) {
      await interaction.update(view);
    } else {
      await interaction.reply({ ...view, ephemeral: true });
    }
  } catch (err) {
    console.error('[INVITES]', err);
    await interaction.reply({ embeds: [errorEmbed('Detaylar alinirken bir hata olustu.')], ephemeral: true }).catch(() => {});
  }
  return true;
}

module.exports = { buildOverview, buildDetailPage, handleInviteInteraction };