const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getWarns } = require('../utils/warns');

function buildEmbed(warns, user) {
  const embed = new EmbedBuilder()
    .setTitle(`${user.tag} - Uyari Listesi`)
    .setColor(0xe67e22)
    .setThumbnail(user.displayAvatarURL())
    .setTimestamp();

  if (!warns.length) {
    embed.setDescription('Bu uyenin hic uyarisi yok.');
    return embed;
  }

  const lines = warns.map(w => {
    const ts = Math.floor(new Date(w.timestamp).getTime() / 1000);
    return `**#${w.caseNumber}** - ${w.reason}\n<t:${ts}:R> - Yetkili: <@${w.moderatorId}>`;
  });

  embed.setDescription(lines.join('\n\n'));
  embed.setFooter({ text: `Toplam ${warns.length} uyari` });
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnlist')
    .setDescription('Bir uyenin uyari gecmisini gosterir')
    .addUserOption(opt => opt.setName('uye').setDescription('Uyarilari gosterilecek uye').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('uye');
    await interaction.deferReply();

    const warns = await getWarns(interaction.guild.id, user.id);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`warnlist_refresh_${user.id}`).setEmoji('✅').setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [buildEmbed(warns, user)], components: [row] });
  },

  buildEmbed,
};
