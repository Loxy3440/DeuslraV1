const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { warningEmbed } = require('../utils/embeds');
const { getYtConfig } = require('../utils/youtube');
const { buildPicker } = require('../utils/ytSendUI');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ytsend')
    .setDescription('Listedeki bir YouTube kanalinin son videosunu secip duyuru kanalina gonderir')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const config = await getYtConfig(interaction.guild.id);

    if (!config || !config.channels?.length) {
      return interaction.reply({
        embeds: [warningEmbed('Ayar Yok', 'Once `/setyt` ile bir Discord kanali ve YouTube kanal linkleri ayarla.')],
        ephemeral: true,
      });
    }

    await interaction.reply({ ...buildPicker(config), ephemeral: true });
  },
};