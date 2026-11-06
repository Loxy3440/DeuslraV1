const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Bir kanala yavas mod uygular')
    .addIntegerOption(opt => opt.setName('saniye').setDescription('Yavas mod süresi (saniye), 0 = kapalı').setRequired(true).setMinValue(0).setMaxValue(21600))
    .addChannelOption(opt => opt.setName('kanal').setDescription('Hedef kanal (boş bırakılırsa bulunduğun kanal)').addChannelTypes(ChannelType.GuildText).setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const seconds = interaction.options.getInteger('saniye');
    const channel = interaction.options.getChannel('kanal') || interaction.channel;

    try {
      await channel.setRateLimitPerUser(seconds, `Yetkili: ${interaction.user.tag}`);
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Yavas mod ayarlanirken bir hata olustu.')], ephemeral: true });
    }

    const embed = seconds === 0
      ? successEmbed('Yavas Mod Kapatıldı', `${channel} için yavaş mod kapatıldı.`)
      : successEmbed('Yavas Mod Ayarlandı', `${channel} için yavaş mod **${seconds} saniye** olarak ayarlandı.`);

    embed.setFooter({ text: `Yetkili: ${interaction.user.tag}` }).setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};
