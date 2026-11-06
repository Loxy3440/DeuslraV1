const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getConfig } = require('../utils/guildConfig');

function buildStatusEmbed(config) {
  // Sistem, izin kanalı seçilince çalışır. Kurucu rolü seçilmezse kararı yalnızca yöneticiler verir.
  const active = Boolean(config.askPermChannelId);

  return new EmbedBuilder()
    .setTitle('🔐 İzin Sistemi (Askperm)')
    .setColor(active ? 0x5865f2 : 0xe67e22)
    .setDescription(
      'Sunucuya bir bot eklendiğinde veya bir üyeye rol verildiğinde, seçtiğin kanala onay isteği gönderilir. ' +
        'Rol verme isteğinde **rol, onay gelene kadar üyeden geri alınır**; onaylanırsa tekrar verilir, reddedilirse verilmez.\n' +
        'Kararı **kurucu rolündekiler ve yöneticiler** verebilir. Sunucu sahibi ve kurucular dahil kimse muaf değildir ' +
        've kimse kendi isteğini onaylayamaz (tek istisna: başka onaylayıcı olmadığı için sunucu sahibi).',
    )
    .addFields(
      {
        name: 'Durum',
        value: active ? '✅ Aktif' : '⚠️ Pasif (izin kanalı ayarlanmalı)',
      },
      { name: 'İzin Kanalı', value: config.askPermChannelId ? `<#${config.askPermChannelId}>` : 'Ayarlanmadı', inline: true },
      {
        name: 'Kurucu Rolü',
        value: config.askPermRoleId ? `<@&${config.askPermRoleId}>` : 'Ayarlanmadı (yalnızca yöneticiler onaylar)',
        inline: true,
      },
      { name: 'Bot İzni', value: config.askPermBotEnabled ? '✅ Açık' : '❌ Kapalı', inline: true },
      { name: 'Rol İzni', value: config.askPermRoleEnabled ? '✅ Açık' : '❌ Kapalı', inline: true },
    )
    .setFooter({ text: 'Kurucu rolü listede görünmüyorsa "Kurucu Rolünü Yaz" seçeneğiyle ID veya adını yaz.' });
}

function buildSelectRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('askperm_menu')
    .setPlaceholder('Bir işlem seç...')
    .addOptions(
      { label: 'İzin Kanalını Ayarla', value: 'set_channel', emoji: '📢' },
      { label: 'Kurucu Rolünü Seç (liste)', value: 'set_role', emoji: '👑' },
      { label: 'Kurucu Rolünü Yaz (ID / ad)', value: 'set_role_text', emoji: '⌨️', description: 'Listede görünmeyen roller için' },
      { label: 'Kurucu Rolünü Kaldır', value: 'clear_role', emoji: '🧹', description: 'Kararı yalnızca yöneticiler verir' },
      { label: 'Bot İznini Aç/Kapat', value: 'toggle_bot', emoji: '🤖' },
      { label: 'Rol İznini Aç/Kapat', value: 'toggle_role', emoji: '🏷️' },
    );

  return new ActionRowBuilder().addComponents(menu);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('askperm')
    .setDescription('Bot ekleme ve rol verme için onay sistemini yönetir')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const config = await getConfig(interaction.guild.id);
    await interaction.reply({ embeds: [buildStatusEmbed(config)], components: [buildSelectRow()] });
  },

  buildStatusEmbed,
  buildSelectRow,
};
