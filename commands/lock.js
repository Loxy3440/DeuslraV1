const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Bulunduğun kanalı kilitler')
    .addStringOption(opt => opt.setName('sebep').setDescription('Kilitleme sebebi').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const reason = interaction.options.getString('sebep') || 'Sebep belirtilmedi';
    const channel = interaction.channel;
    const everyoneRole = interaction.guild.roles.everyone;

    await interaction.deferReply();

    try {
      await channel.permissionOverwrites.edit(everyoneRole, { SendMessages: false }, { reason });
    } catch {
      return interaction.editReply({ embeds: [errorEmbed('Kanal kilitlenirken bir hata oluştu.')] });
    }

    const embed = successEmbed('Kanal Kilitlendi', `${channel} artık sadece yetkililer tarafından kullanılabilir.`)
      .setColor(0xed4245)
      .addFields({ name: 'Sebep', value: reason })
      .setFooter({ text: `Yetkili: ${interaction.user.tag}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`unlock_${channel.id}`).setLabel('Unlock').setStyle(ButtonStyle.Success),
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  },
};
