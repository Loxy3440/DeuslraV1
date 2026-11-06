const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getConfig } = require('../utils/guildConfig');

function buildStatusEmbed(config) {
  const list = config.channelBips.length
    ? config.channelBips.map(c => `<#${c.channelId}> -> ${c.message}`).join('\n')
    : 'Tanimli kanal yok.';

  return new EmbedBuilder()
    .setTitle('Yeni Uye Bildirimi (Channelbip)')
    .setColor(0x5865f2)
    .setDescription('Sunucuya yeni biri katildiginda, asagidaki kanallarin her birine otomatik mesaj gonderilir.')
    .addFields({ name: `Kanallar (${config.channelBips.length})`, value: list })
    .setFooter({ text: 'Mesajda {user} yazarsan katilan kisiyle degistirilir | Asagidaki menuden yonet' });
}

function buildSelectRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('channelbip_menu')
    .setPlaceholder('Bir islem sec...')
    .addOptions(
      { label: 'Kanal Ekle', value: 'add', emoji: '➕' },
      { label: 'Kanal Duzenle', value: 'edit', emoji: '✏️' },
      { label: 'Kanal Sil', value: 'remove', emoji: '🗑️' },
    );

  return new ActionRowBuilder().addComponents(menu);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('channelbip')
    .setDescription('Yeni uye katilinca mesaj gonderilecek kanallari yonetir')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const config = await getConfig(interaction.guild.id);
    await interaction.reply({ embeds: [buildStatusEmbed(config)], components: [buildSelectRow()] });
  },

  buildStatusEmbed,
  buildSelectRow,
};