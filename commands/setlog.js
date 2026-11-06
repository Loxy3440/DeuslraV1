const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');
const { getConfig, setConfig } = require('../utils/guildConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setlog')
    .setDescription('Mute, ban, kick, promote, demote ve addnick işlemlerinin loglanacağı kanalı ayarlar')
    .addSubcommand(sub =>
      sub.setName('ayarla').setDescription('Log kanalını seçer')
        .addChannelOption(opt => opt.setName('kanal').setDescription('Logların gideceği yazı kanalı').setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand(sub =>
      sub.setName('partnerrol').setDescription('Partner isteklerini onaylayabilecek ve etiketlenecek rolü seçer')
        .addRoleOption(opt => opt.setName('rol').setDescription('Partner yetkili rolü').setRequired(true)))
    .addSubcommand(sub => sub.setName('kapat').setDescription('Loglamayı kapatır'))
    .addSubcommand(sub => sub.setName('goster').setDescription('Mevcut log kanalını gösterir'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'goster') {
      const c = await getConfig(guildId);
      return interaction.reply({
        embeds: [c.logChannelId ? successEmbed('Log Kanalı', `<#${c.logChannelId}>`) : warningEmbed('Log Kapalı', 'Log kanalı ayarlı değil. `/setlog ayarla` ile seç.')],
        ephemeral: true,
      });
    }

    if (sub === 'partnerrol') {
      const role = interaction.options.getRole('rol', true);
      await setConfig(guildId, { partnerRoleId: role.id });
      return interaction.reply({ embeds: [successEmbed('Partner Rolü', `Partner istekleri artık ${role} rolünü etiketleyecek ve bu rol onaylayabilecek.`)], ephemeral: true });
    }

    if (sub === 'kapat') {
      await setConfig(guildId, { logChannelId: null });
      return interaction.reply({ embeds: [successEmbed('Log Kapatıldı', 'Artık işlemler loglanmayacak.')], ephemeral: true });
    }

    const channel = interaction.options.getChannel('kanal', true);
    const perms = channel.permissionsFor(interaction.guild.members.me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return interaction.reply({ embeds: [errorEmbed(`Botun ${channel} kanalında **Kanalı Gör**, **Mesaj Gönder** ve **Bağlantı Yerleştir** yetkisi olmalı.`)], ephemeral: true });
    }
    await setConfig(guildId, { logChannelId: channel.id });
    await channel.send({ embeds: [successEmbed('Log Kanalı Ayarlandı', 'Mute, unmute, ban, unban, kick, promote, demote ve addnick işlemleri buraya yazılacak.')] }).catch(() => {});
    return interaction.reply({ embeds: [successEmbed('Log Kanalı Ayarlandı', `Loglar artık ${channel} kanalına gidecek.`)], ephemeral: true });
  },
};
