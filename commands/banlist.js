const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { warningEmbed, errorEmbed } = require('../utils/embeds');
const { getAllBanRecords } = require('../utils/bans');

const PAGE_SIZE = 10;

async function buildBanListEmbed(guild) {
  const discordBans = await guild.bans.fetch();

  if (!discordBans.size) {
    return { embed: warningEmbed('Boş Liste', 'Bu sunucuda yasaklı kullanıcı yok.'), empty: true };
  }

  const records = await getAllBanRecords(guild.id).catch(() => []);
  const recordMap = new Map(records.map(r => [r.userId, r]));

  const entries = [...discordBans.values()].map(banEntry => {
    const record = recordMap.get(banEntry.user.id);
    const reason = record?.reason || banEntry.reason || 'Sebep belirtilmedi';
    return `**${banEntry.user.tag}** (${banEntry.user.id})\n↳ ${reason}`;
  });

  const shown = entries.slice(0, PAGE_SIZE);
  const remaining = entries.length - shown.length;

  const embed = new EmbedBuilder()
    .setTitle(`Yasakli Kullanicilar (${entries.length})`)
    .setColor(0xed4245)
    .setDescription(shown.join('\n\n'))
    .setFooter({ text: remaining > 0 ? `+${remaining} daha detaylı bilgi için ' /ban info ' komutunu kullanın` : 'Detay için /ban info komutunu kullanın' })
    .setTimestamp();

  return { embed, empty: false };
}

function buildRefreshRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('banlist_refresh').setEmoji('✅').setLabel('Yenile').setStyle(ButtonStyle.Secondary),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('banlist')
    .setDescription('Sunucudaki Yasaklı Kullanıcıları Listeler')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    await interaction.deferReply();

    let result;
    try {
      result = await buildBanListEmbed(interaction.guild);
    } catch {
      return interaction.editReply({ embeds: [errorEmbed('Yasaklı Kullanıcılar Listesi alınırken bir hata oluştu.')] });
    }

    if (result.empty) {
      return interaction.editReply({ embeds: [result.embed] });
    }

    await interaction.editReply({ embeds: [result.embed], components: [buildRefreshRow()] });
  },

  buildBanListEmbed,
  buildRefreshRow,
};