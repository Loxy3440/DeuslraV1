const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getConfig } = require('../utils/guildConfig');
const { lockText } = require('../utils/triggerRoles');

// Embed alanlari en fazla 1024 karakter olabilir; uzun cevaplar kisaltilir ki /auto asla hata vermesin.
const FIELD_LIMIT = 900;

function shorten(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function buildStatusEmbed(config) {
  const total = config.autoResponses.length;
  let list = 'Tanımlı otomatik mesaj yok.';

  if (total) {
    const lines = [];
    let used = 0;
    for (const r of config.autoResponses) {
      const trigger = shorten(r.trigger, 40).replace(/`/g, "'");
      const line = `\`${trigger}\` -> ${r.response ? shorten(r.response, 80) : '*(sadece medya)*'}${r.mediaUrl ? ' 📎' : ''} *(${r.cooldownSeconds || 3}sn)*${lockText(r)}`;
      if (used + line.length + 1 > FIELD_LIMIT) break;
      lines.push(line);
      used += line.length + 1;
    }
    list = lines.join('\n');
    if (lines.length < total) list += `\n*... ve ${total - lines.length} tane daha (silme menusunde hepsi gorunur)*`;
  }

  return new EmbedBuilder()
    .setTitle('Otomatik Mesajlar')
    .setColor(0x5865f2)
    .setDescription('Otomatik mesajlar, sunucuda belirli kelimeler veya ifadeler algilendiginde otomatik olarak cevap vermek icin kullanilir.')
    .addFields({ name: `Tanımlı Mesajlar (${total})`, value: list })
    .setFooter({ text: 'Ekle / Güncelle, Sil, Tümünü Temizle' });
}


function buildSelectRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('auto_menu')
    .setPlaceholder('Yönet')
    .addOptions(
      { label: 'Ekle / Güncelle', value: 'add_autoresponse', emoji: '➕' },
      { label: 'Rol Sınırı (kim kullanabilir)', value: 'roles_auto', emoji: '🔒' },
      { label: 'Sil', value: 'remove_autoresponse', emoji: '🗑️' },
      { label: 'Tümünü Temizle', value: 'clear_autoresponses', emoji: '🗑️' },
    );

  return new ActionRowBuilder().addComponents(menu);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('auto')
    .setDescription('Otomatik Mesajları Yönetir.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const config = await getConfig(interaction.guild.id);
    await interaction.reply({ embeds: [buildStatusEmbed(config)], components: [buildSelectRow()] });
  },

  buildStatusEmbed,
  buildSelectRow,
};