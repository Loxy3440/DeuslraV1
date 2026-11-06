const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { errorEmbed, warningEmbed } = require('../utils/embeds');
const { getYtConfig, checkAndAnnounce } = require('../utils/youtube');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('yt')
    .setDescription('Ayarlanan YouTube kanallarinda yeni video var mi bakar, varsa @everyone ile paylasir')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const config = await getYtConfig(interaction.guild.id);

    if (!config || !config.channels?.length) {
      return interaction.reply({
        embeds: [warningEmbed('Ayar Yok', 'Once `/setyt` ile bir Discord kanali ve YouTube kanal linkleri ayarla.')],
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    let results;
    try {
      results = await checkAndAnnounce(interaction.guild, config);
    } catch (err) {
      return interaction.editReply({ embeds: [errorEmbed(err.message)] });
    }

    const total = results.reduce((sum, r) => sum + r.posted, 0);
    const lines = results.map(r => {
      if (r.status === 'error') return `❌ **${r.title}**: ${r.error}${r.posted ? ` (${r.posted} video atıldı)` : ''}`;
      if (r.status === 'baseline') return `🆕 **${r.title}**: ilk kez okundu, mevcut videolar kaydedildi (paylaşılmadı)`;
      if (r.posted) return `▶️ **${r.title}**: ${r.posted} yeni video paylaşıldı ${r.skipped ? ` (${r.skipped} eski video atlandi)` : ''}`;
      return `➖ **${r.title}**: yeni video yok`;
    });

    const embed = new EmbedBuilder()
      .setTitle(total ? `${total} yeni video paylasildi` : 'Yeni video yok')
      .setColor(total ? 0x57f287 : 0x5865f2)
      .setDescription(lines.join('\n').slice(0, 4000))
      .setFooter({ text: `Duyuru kanali: #${interaction.guild.channels.cache.get(config.announceChannelId)?.name || 'bulunamadi'}` });

    await interaction.editReply({ embeds: [embed] });
  },
};