const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

function mainEmbed() {
  return new EmbedBuilder()
    .setTitle('Yardim Menusu')
    .setDescription('Asagidaki menuden bir kategori sec.')
    .setColor(0x5865f2);
}

function categoryEmbed(category) {
  const categories = {
    helper: {
      title: 'Helper Komutlari',
      color: 0x3498db,
      commands: ['help - Yardim menusunu gosterir', 'ping - Botun gecikmesini gosterir', 'invite - Davet linki olusturur'],
    },
    moderation: {
      title: 'Moderation Komutlari',
      color: 0xe67e22,
      commands: [
        'kick - Uyeyi atar (kanit gerekli)',
        'ban - Uyeyi yasaklar (kanit gerekli)',
        'unban - Yasagi kaldirir',
        'mute - Uyeyi susturur (kanit gerekli)',
        'unmute - Susturmayi kaldirir',
        'lock - Kanali kilitler',
        'delete - Mesajlari siler',
      ],
    },
    developer: {
      title: 'Developer Komutlari',
      color: 0x9b59b6,
      commands: ['say - Bot uzerinden mesaj gonderir', 'dm - Bir kullaniciya ozel mesaj gonderir', 'dmall - Tum uyelere ozel mesaj gonderir'],
    },
    troll: {
      title: 'Troll Komutlari',
      color: 0xe91e63,
      commands: ['Su an aktif troll komutu yok.'],
    },
  };

  const data = categories[category];
  return new EmbedBuilder()
    .setTitle(data.title)
    .setDescription(data.commands.map(c => `**${c.split(' - ')[0]}** - ${c.split(' - ').slice(1).join(' - ')}`).join('\n'))
    .setColor(data.color);
}

function buildSelectRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('help_category')
    .setPlaceholder('Bir kategori sec...')
    .addOptions(
      { label: 'Helper Komutlari', value: 'helper', emoji: '🛠️' },
      { label: 'Moderation Komutlari', value: 'moderation', emoji: '🛡️' },
      { label: 'Developer Komutlari', value: 'developer', emoji: '💻' },
      { label: 'Troll Komutlari', value: 'troll', emoji: '🎭' },
      { label: 'Ana Menuye Don', value: 'return', emoji: '🏠' },
    );

  return new ActionRowBuilder().addComponents(menu);
}

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Komut listesini gosterir'),

  async execute(interaction) {
    await interaction.reply({ embeds: [mainEmbed()], components: [buildSelectRow()] });
  },

  // Diger dosyalarin (events/interactionCreate.js) erisebilmesi icin disari aciyoruz
  categoryEmbed,
  mainEmbed,
};