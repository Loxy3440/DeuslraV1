const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getTop, getUserRank, formatVoice } = require('../utils/stats');

const WHICH = 'voice';
const fmt = v => formatVoice(v);
const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sestop')
    .setDescription('Ses sıralaması (tüm sunucu, ilk 10)')
    .addUserOption(opt => opt.setName('uye').setDescription('Sırasını görmek istediğin üye (boşsa sen)').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();
    const guild = interaction.guild;
    const top = await getTop(guild.id, WHICH, 10);
    const target = interaction.options.getUser('uye') || interaction.user;
    const mine = await getUserRank(guild.id, target.id, WHICH);

    const lines = top.map((r, i) => `${MEDALS[i] || `**${i + 1}.**`} <@${r.userId}> — **${fmt(r.value)}**`);
    const embed = new EmbedBuilder()
      .setTitle('🎙️ Ses sıralaması (tüm sunucu, ilk 10)')
      .setDescription(lines.length ? lines.join('\n') : 'Henüz veri yok. Bot açıldığından beri sayılır.')
      .setColor(0x5865f2)
      .addFields({ name: `${target.username}`, value: mine.rank ? `**${mine.rank}.** sırada — ${fmt(mine.value)}` : 'Henüz kaydı yok', inline: false })
      .setFooter({ text: `${guild.name} · tüm sunucu` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
