const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getConfig } = require('../utils/guildConfig');
const { lockText } = require('../utils/triggerRoles');

function buildStatusEmbed(config) {
  const list = config.mentionTriggers.length
    ? config.mentionTriggers.map(r => `\`${r.trigger}\` -> ${r.response || '*(sadece medya)*'}${r.mediaUrl ? ' 📎' : ''}${lockText(r)}`).join('\n')
    : 'Tanimli ozel etiketlenme cevabi yok.';

  return new EmbedBuilder()
    .setTitle('Ozel Etiketlenme Cevaplari (Setmention)')
    .setColor(0x5865f2)
    .setDescription('Bot etiketlenip/yanitlanip asagidaki tetikleyicilerden biri tam olarak yazilirsa, bot /mention yerine bu ozel cevabi gonderir.')
    .addFields({ name: `Tanimli Cevaplar (${config.mentionTriggers.length})`, value: list })
    .setFooter({ text: 'Aşağıdaki Menüden ekle / sil' });
}

function buildSelectRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('setmention_menu')
    .setPlaceholder('Yönet')
    .addOptions(
      { label: 'Ekle / Güncelle', value: 'add_mentiontrigger', emoji: '➕' },
      { label: 'Rol Sınırı (kim kullanabilir)', value: 'roles_mention', emoji: '🔒' },
      { label: 'Sil', value: 'remove_mentiontrigger', emoji: '🗑️' },
    );

  return new ActionRowBuilder().addComponents(menu);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setmention')
    .setDescription('Bot etiketlenip belirli bir sey yazilinca verecegi ozel cevaplari yonetir')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const config = await getConfig(interaction.guild.id);
    await interaction.reply({ embeds: [buildStatusEmbed(config)], components: [buildSelectRow()] });
  },

  buildStatusEmbed,
  buildSelectRow,
};