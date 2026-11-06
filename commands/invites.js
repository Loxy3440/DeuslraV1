const { SlashCommandBuilder } = require('discord.js');
const { errorEmbed } = require('../utils/embeds');
const { buildOverview } = require('../utils/inviteUI');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Bir kullanıcının davetlerini gösterir.')
    .addUserOption(opt => opt.setName('uye').setDescription('Davetleri gösterilecek kullanıcı').setRequired(false)),

  async execute(interaction) {
    const user = interaction.options.getUser('uye') || interaction.user;
    await interaction.deferReply();

    try {
      await interaction.editReply(await buildOverview(interaction.guild, user));
    } catch (err) {
      console.error('[INVITES]', err);
      await interaction.editReply({ embeds: [errorEmbed('Davet bilgileri alinirken bir hata olustu.')] });
    }
  },
};