const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('../utils/guildConfig');
const { buildPanel } = require('../utils/roleGroups');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setroles')
    .setDescription('Bot, üye ve yetkili rol gruplarını ayarlar (promote/demote bunlara göre çalışır)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const config = await getConfig(interaction.guild.id);
    await interaction.reply(buildPanel(interaction.guild, config));
  },
};
