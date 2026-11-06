const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');
const { logAction } = require('../utils/modLog');
const { addBan, searchBanRecord } = require('../utils/bans');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Yasaklama islemleri')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addSubcommand(sub => sub
      .setName('uye')
      .setDescription('Bir uyeyi sunucudan yasaklar (kanit gerekli)')
      .addUserOption(opt => opt.setName('uye').setDescription('Yasaklanacak uye').setRequired(true))
      .addAttachmentOption(opt => opt.setName('kanit').setDescription('Kanit resmi').setRequired(true))
      .addStringOption(opt => opt.setName('sebep').setDescription('Yasaklama sebebi').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('Bir kullanicinin neden banlandigini gosterir')
      .addStringOption(opt => opt.setName('kullanici').setDescription('Kullanici adi veya ID').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'info') {
      return handleInfo(interaction);
    }

    return handleBan(interaction);
  },
};

async function handleBan(interaction) {
  const member = interaction.options.getMember('uye');
  const attachment = interaction.options.getAttachment('kanit');
  const reason = interaction.options.getString('sebep') || 'Sebep belirtilmedi';

  if (!(attachment.contentType || '').startsWith('image/')) {
    return interaction.reply({ embeds: [warningEmbed('Kanit Gecersiz', 'Ekledigin dosya bir resim olmali.')], ephemeral: true });
  }

  if (!member) {
    return interaction.reply({ embeds: [errorEmbed('Bu uye sunucuda bulunamadi.')], ephemeral: true });
  }

  if (member.id === interaction.user.id) {
    return interaction.reply({ embeds: [warningEmbed('Gecersiz', 'Kendini yasaklayamazsin.')], ephemeral: true });
  }

  if (member.roles.highest.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
    return interaction.reply({ embeds: [warningEmbed('Yetersiz Rol', 'Bu uyenin rolu seninkine esit veya yuksek.')], ephemeral: true });
  }

  if (!member.bannable) {
    return interaction.reply({ embeds: [errorEmbed('Bu uyeyi yasaklayamiyorum, rol hiyerarsisi buna izin vermiyor.')], ephemeral: true });
  }

  await interaction.deferReply();

  const dmEmbed = new EmbedBuilder()
    .setTitle('Sunucudan Yasaklandin')
    .setDescription(`**${interaction.guild.name}** sunucusundan yasaklandin.`)
    .addFields({ name: 'Sebep', value: reason })
    .setImage(attachment.url)
    .setColor(0xed4245)
    .setTimestamp();

  let dmSent = true;
  try {
    await member.send({ embeds: [dmEmbed] });
  } catch {
    dmSent = false;
  }

  try {
    await member.ban({ reason });
  } catch {
    return interaction.editReply({ embeds: [errorEmbed('Yasaklama islemi basarisiz oldu.')] });
  }

  await addBan(interaction.guild.id, member.id, member.user.tag, interaction.user.id, reason, attachment.url).catch(() => {});

  await logAction(interaction.guild, { action: 'ban', markKey: `ban:${interaction.guild.id}:${member.id}`, target: member, moderator: interaction.user, reason, imageUrl: attachment.url, fromPanel: interaction.fromPanel });

  const resultEmbed = successEmbed('Uye Yasaklandi', `**${member.user.tag}** sunucudan yasaklandi.`)
    .setColor(0xed4245)
    .addFields(
      { name: 'Sebep', value: reason },
      { name: 'DM', value: dmSent ? 'Gonderildi' : 'Gonderilemedi', inline: true },
    )
    .setImage(attachment.url)
    .setFooter({ text: `Yetkili: ${interaction.user.tag}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`unban_${member.id}`).setLabel('Unban').setStyle(ButtonStyle.Primary),
  );

  await interaction.editReply({ embeds: [resultEmbed], components: [row] });
}

async function handleInfo(interaction) {
  const query = interaction.options.getString('kullanici').trim();

  await interaction.deferReply();

  const record = await searchBanRecord(interaction.guild.id, query).catch(() => null);

  if (!record) {
    return interaction.editReply({ embeds: [warningEmbed('Kayit Bulunamadi', `**${query}** icin kayitli bir yasaklama bulunamadi.`)] });
  }

  let stillBanned = true;
  try {
    await interaction.guild.bans.fetch(record.userId);
  } catch {
    stillBanned = false;
  }

  const embed = new EmbedBuilder()
    .setTitle(`Ban Bilgisi - ${record.userTag}`)
    .setColor(stillBanned ? 0xed4245 : 0x99aab5)
    .addFields(
      { name: 'Kullanıcı', value: `${record.userTag} (${record.userId})` },
      { name: 'Durum', value: stillBanned ? 'Hala Yasaklı' : 'Yasak Kaldırılmış (Kayıt geçmişi)', inline: true },
      { name: 'Sebep', value: record.reason || 'Sebep belirtilmedi' },
      { name: 'Yetkili', value: `<@${record.moderatorId}>`, inline: true },
    )
    .setTimestamp(record.timestamp);

  if (record.evidenceUrl) {
    embed.setImage(record.evidenceUrl);
  } else {
    embed.addFields({ name: 'Kanit', value: 'Bu ban için kanıt yüklenmemiştir.' });
  }

  embed.setFooter({ text: 'Bu bilgi 5 dakika boyunca 10 saniyede bir otomatik güncellenir.' });

  const message = await interaction.editReply({ embeds: [embed] });

  const REFRESH_MS = 10_000;
  const MAX_TICKS = 30; // 30 x 10sn = 5 dakika
  let ticks = 0;

  const interval = setInterval(async () => {
    ticks++;
    if (ticks > MAX_TICKS) {
      clearInterval(interval);
      return;
    }

    let currentlyBanned = true;
    try {
      await interaction.guild.bans.fetch(record.userId);
    } catch {
      currentlyBanned = false;
    }

    const refreshedEmbed = EmbedBuilder.from(embed)
      .setColor(currentlyBanned ? 0xed4245 : 0x99aab5)
      .spliceFields(1, 1, { name: 'Durum', value: currentlyBanned ? 'Hala Yasaklı' : 'Yasak Kaldırılmış (Kayıt geçmişi)', inline: true });

    await message.edit({ embeds: [refreshedEmbed] }).catch(() => clearInterval(interval));

    if (!currentlyBanned) clearInterval(interval);
  }, REFRESH_MS);
}