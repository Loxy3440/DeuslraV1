const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getConfig } = require('../utils/guildConfig');

function buildStatusEmbed(config) {
  return new EmbedBuilder()
    .setTitle('Otomatik Rol (Otorol)')
    .setColor(0x5865f2)
    .setDescription('Sunucuya yeni katılan üyeler, oyuncu ya da bot olmalarına göre farklı rol otomatik verilir.')
    .addFields(
      { name: 'Durum', value: config.autoRoleEnabled ? ' Açık' : ' Kapalı', inline: true },
      { name: 'Oyuncu Rolu', value: config.autoRoleId ? `<@&${config.autoRoleId}>` : 'Ayarlanmadı', inline: true },
      { name: 'Bot Rolu', value: config.autoRoleBotId ? `<@&${config.autoRoleBotId}>` : 'Ayarlanmadı', inline: true },
    )
    .setFooter({ text: 'Aşağıdaki menüden ayarla' });
}

function buildSelectRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('autorole_menu')
    .setPlaceholder('Bir işlem seç...')
    .addOptions(
      { label: 'Oyuncu Rolu Ayarla', value: 'set_role_player', emoji: '👤' },
      { label: 'Bot Rolu Ayarla', value: 'set_role_bot', emoji: '🤖' },
      { label: 'Ac/Kapat', value: 'toggle', emoji: '🔄' },
    );

  return new ActionRowBuilder().addComponents(menu);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('Yeni katılan uyelere ve botlara otomatik rol verir.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const config = await getConfig(interaction.guild.id);
    await interaction.reply({ embeds: [buildStatusEmbed(config)], components: [buildSelectRow()] });
  },

  buildStatusEmbed,
  buildSelectRow,
};