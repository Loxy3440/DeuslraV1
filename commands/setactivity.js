const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getActivityConfig } = require('../utils/activityConfig');

const TYPE_LABELS = {
  PLAYING: 'Oynuyor (Playing)',
  STREAMING: 'Yayinda (Streaming)',
  WATCHING: 'Izliyor (Watching)',
  LISTENING: 'Dinliyor (Listening)',
  COMPETING: 'Yarisiyor (Competing)',
  CUSTOM: 'Ozel durum (yazi)',
};

function buildStatusEmbed(config) {
  const list = config.list.length
    ? config.list.map((a, i) => `${i + 1}. **${TYPE_LABELS[a.type] || a.type}** - ${a.text}${a.url ? ` (<${a.url}>)` : ''}`).join('\n')
    : 'Tanımlı Aktivite yok, varsayilan olarak "/help" (Izliyor) gosterilir.';

  return new EmbedBuilder()
    .setTitle('Bot Aktivitesi (Setactivity)')
    .setColor(0x5865f2)
    .setDescription('Botun durum yazısı (Oynuyor/Yayında/Izliyor/Dinliyor/Yarışıyor) aşağıdaki listede sırayla döner.\n Bu ayar tum sunucular icin gecerlidir (global).')
    .addFields(
      { name: `Aktiviteler (${config.list.length})`, value: list },
      { name: 'Gecis Suresi', value: `${config.intervalSeconds} saniye`, inline: true },
    )
    .setFooter({ text: 'Asagidaki menuden ekle / sil / sureyi ayarla' });
}

function buildSelectRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('setactivity_menu')
    .setPlaceholder('Bir islem sec...')
    .addOptions(
      { label: 'Aktivite Ekle', value: 'add_activity', emoji: '➕' },
      { label: 'Aktivite Sil', value: 'remove_activity', emoji: '🗑️' },
      { label: 'Gecis Suresini Ayarla', value: 'set_interval', emoji: '⏰' },
    );

  return new ActionRowBuilder().addComponents(menu);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setactivity')
    .setDescription('Botun aktivite/durum yazısını ve geçiş süresini yönetir (global)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const config = await getActivityConfig();
    await interaction.reply({ embeds: [buildStatusEmbed(config)], components: [buildSelectRow()] });
  },

  buildStatusEmbed,
  buildSelectRow,
  TYPE_LABELS,
};