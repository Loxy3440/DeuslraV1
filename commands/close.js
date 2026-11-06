const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Botu kapatir (onay ister, sadece bot sahibi)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ embeds: [errorEmbed('Bu komutu sadece botun sahibi kullanabilir.')], ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('Botu Kapat')
      .setDescription('Botu kapatmak istediginden emin misin?')
      .setColor(0x5865f2);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('closebot_confirm').setLabel('Kapat').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('closebot_cancel').setLabel('Iptal').setStyle(ButtonStyle.Primary),
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};