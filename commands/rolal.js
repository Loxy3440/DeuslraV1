const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolal')
    .setDescription('Bir uyeden rol alir')
    .addUserOption(opt => opt.setName('uye').setDescription('Rolu alinacak uye').setRequired(true))
    .addRoleOption(opt => opt.setName('rol').setDescription('Alinacak rol').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const member = interaction.options.getMember('uye');
    const role = interaction.options.getRole('rol');

    if (!member) {
      return interaction.reply({ embeds: [errorEmbed('Bu uye sunucuda bulunamadı.')], ephemeral: true });
    }

    if (!member.roles.cache.has(role.id)) {
      return interaction.reply({ embeds: [warningEmbed('Rol Yok', `**${member.user.tag}** zaten bu role sahip değil.`)], ephemeral: true });
    }

    if (role.position >= interaction.guild.members.me.roles.highest.position) {
      return interaction.reply({ embeds: [errorEmbed('Bu rolü alamıyorum, botun rolü yeterince yüksek değil.')], ephemeral: true });
    }

    try {
      await member.roles.remove(role, `Yetkili: ${interaction.user.tag}`);
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Rol alınırken bir hata oluştu.')], ephemeral: true });
    }

    const embed = successEmbed('Rol alındı', `**${member.user.tag}** Kullanıcısından **${role.name}** Rolü alındı.`)
      .setFooter({ text: `Yetkili: ${interaction.user.tag}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rolgiveback_${member.id}_${role.id}`).setLabel('geri ver').setStyle(ButtonStyle.Success),
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};
