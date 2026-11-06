const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ginvite')
    .setDescription('Botu kendi sunucuna davet etmek icin gerekli linki gosterir')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const clientId = process.env.CLIENT_ID;
    if (!clientId) {
      return interaction.reply({ embeds: [errorEmbed('CLIENT_ID .env dosyasinda tanimli degil.')], ephemeral: true });
    }

    const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`;

    const embed = new EmbedBuilder()
      .setTitle('Botu Davet Et')
      .setDescription(`**${interaction.client.user.username}** botunu kendi sunucuna eklemek icin asagidaki butona tikla.`)
      .setColor(0x5865f2)
      .setThumbnail(interaction.client.user.displayAvatarURL())
      .setFooter({ text: `Olusturan: ${interaction.user.tag}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Botu Ekle').setStyle(ButtonStyle.Link).setURL(inviteUrl),
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};