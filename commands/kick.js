const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { logAction } = require('../utils/modLog');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Bir uyeyi sunucudan atar (kanit gerekli)')
    .addUserOption(opt => opt.setName('uye').setDescription('Atilacak uye').setRequired(true))
    .addAttachmentOption(opt => opt.setName('kanit').setDescription('Kanit resmi').setRequired(true))
    .addStringOption(opt => opt.setName('sebep').setDescription('Atma sebebi').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    const member = interaction.options.getMember('uye');
    const attachment = interaction.options.getAttachment('kanit');
    const reason = interaction.options.getString('sebep') || 'Sebep belirtilmedi';

    if (!(attachment.contentType || '').startsWith('image/')) {
      return interaction.reply({ embeds: [warningEmbed('Kanit Gecersiz', 'Ekledigin dosya bir resim olmalı.')], ephemeral: true });
    }

    if (!member) {
      return interaction.reply({ embeds: [errorEmbed('Bu uye sunucuda bulunamadı.')], ephemeral: true });
    }

    if (member.id === interaction.user.id) {
      return interaction.reply({ embeds: [warningEmbed('Geçersiz', 'Kendini atamazsın.')], ephemeral: true });
    }

    if (member.roles.highest.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
      return interaction.reply({ embeds: [warningEmbed('Yetersiz Rol', 'Bu üyenin rolü seninkine eşit veya daha yüksek.')], ephemeral: true });
    }

    if (!member.kickable) {
      return interaction.reply({ embeds: [errorEmbed('Bu üyeyi atamıyorum rol hiyerarşisi buna izin vermiyor.')], ephemeral: true });
    }

    await interaction.deferReply();

    const dmEmbed = new EmbedBuilder()
      .setTitle('Sunucudan Atildin')
      .setDescription(`**${interaction.guild.name}** sunucusundan atildin.`)
      .addFields({ name: 'Sebep', value: reason })
      .setImage(attachment.url)
      .setColor(0xe67e22)
      .setTimestamp();

    let dmSent = true;
    try {
      await member.send({ embeds: [dmEmbed] });
    } catch {
      dmSent = false;
    }

    try {
      await member.kick(reason);
    } catch {
      return interaction.editReply({ embeds: [errorEmbed('Atma işlemi başarısız oldu.')] });
    }

    await logAction(interaction.guild, { action: 'kick', markKey: `kick:${interaction.guild.id}:${member.id}`, target: member, moderator: interaction.user, reason, imageUrl: attachment.url, fromPanel: interaction.fromPanel });

    const resultEmbed = successEmbed('Üye Atıldı', `**${member.user.tag}** sunucudan atıldı.`)
      .addFields(
        { name: 'Sebep', value: reason },
        { name: 'DM', value: dmSent ? 'Gönderildi' : 'Gönderilemedi', inline: true },
      )
      .setImage(attachment.url)
      .setFooter({ text: `Yetkili: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [resultEmbed] });
  },
};
