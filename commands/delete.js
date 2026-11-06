const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Belirtilen sayida mesaji siler')
    .addIntegerOption(opt =>
      opt.setName('miktar').setDescription('Silinecek mesaj sayisi (1-100)').setRequired(true).setMinValue(1).setMaxValue(100),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const amount = interaction.options.getInteger('miktar');

    await interaction.deferReply({ ephemeral: true });

    let deleted;
    try {
      deleted = await interaction.channel.bulkDelete(amount, true);
    } catch {
      return interaction.editReply({
        embeds: [errorEmbed('Mesaj silinirken hata oldu. 14 günden eski mesajlar silinemez.')],
      });
    }

    await interaction.editReply({ embeds: [successEmbed('Mesajlar Silindi', `**${deleted.size}** mesaj silindi.`)] });
  },
};
