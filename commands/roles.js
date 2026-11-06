const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('roles').setDescription('Sunucudaki tum rolleri ve ID lerini listeler'),

  async execute(interaction) {
    await interaction.deferReply();

    const roles = interaction.guild.roles.cache
      .filter(r => r.id !== interaction.guild.id) // @everyone haric
      .sort((a, b) => b.position - a.position);

    if (!roles.size) {
      return interaction.editReply('Bu sunucuda tanımlı bir rol yok.');
    }

    const lines = roles.map(r => `<@&${r.id}> - \`${r.id}\``);

    // Embed field value limiti 1024 karakter, gerekirse birden fazla field'a bol.
    const chunks = [];
    let current = '';
    for (const line of lines) {
      if ((current + '\n' + line).length > 1000) {
        chunks.push(current);
        current = line;
      } else {
        current = current ? `${current}\n${line}` : line;
      }
    }
    if (current) chunks.push(current);

    const embed = new EmbedBuilder()
      .setTitle(`Roller (${roles.size})`)
      .setColor(0x5865f2)
      .setFooter({ text: `Sunucu ID: ${interaction.guild.id}` })
      .setTimestamp();

    const limitedChunks = chunks.slice(0, 25);
    limitedChunks.forEach((chunk, i) => {
      embed.addFields({ name: i === 0 ? 'Rol Listesi' : '\u200b', value: chunk });
    });

    if (chunks.length > limitedChunks.length) {
      embed.setDescription('Rol sayısı çok fazla olduğu için liste kısaltıldı.');
    }

    await interaction.editReply({ embeds: [embed] });
  },
};