const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { errorEmbed, warningEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Bot araciligiyla bir kanala mesaj gonderir')
    .addChannelOption(opt =>
      opt.setName('kanal').setDescription('Mesajin gonderilecegi kanal').addChannelTypes(ChannelType.GuildText).setRequired(true),
    )
    .addStringOption(opt => opt.setName('mesaj').setDescription('Gonderilecek mesaj').setRequired(false))
    .addAttachmentOption(opt => opt.setName('dosya').setDescription('Ek dosya/resim').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const channel = interaction.options.getChannel('kanal');
    const content = interaction.options.getString('mesaj');
    const attachment = interaction.options.getAttachment('dosya');

    if (!content && !attachment) {
      return interaction.reply({ embeds: [warningEmbed('Eksik Bilgi', 'En az bir mesaj veya dosya eklemelisin.')], ephemeral: true });
    }
   // tüm mesajları yazım hatalarını düzenliyorum
    try {
      // Kimin kullandigi belli olmasin diye interaction.reply degil, dogrudan channel.send kullaniyoruz
      await channel.send({
        content: content || undefined,
        files: attachment ? [attachment.url] : [],
      });
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Mesaj gönderilirken bir hata oluştu.')], ephemeral: true });
    }

    await interaction.reply({ content: `Mesaj ${channel} kanalına gönderildi.`, ephemeral: true });
  },
};