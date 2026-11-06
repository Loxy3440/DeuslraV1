const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { successEmbed, errorEmbed } = require('../utils/embeds');
const { registerCommandGrant } = require('../utils/askPerm');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolall')
    .setDescription('Sunucudaki herkese bir rol verir')
    .addRoleOption(opt => opt.setName('rol').setDescription('Verilecek rol').setRequired(true))
    .addBooleanOption(opt =>
      opt.setName('botlar-dahil').setDescription('Botlara da verilsin mi? (varsayılan: hayır)').setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const role = interaction.options.getRole('rol');
    const includeBots = interaction.options.getBoolean('botlar-dahil') ?? false;

    if (role.managed) {
      return interaction.reply({
        embeds: [errorEmbed('Bu rol bir entegrasyona (bot/boost rolü vb.) ait, elle verilemez.')],
        ephemeral: true,
      });
    }

    const botMember = interaction.guild.members.me;
    if (role.position >= botMember.roles.highest.position) {
      return interaction.reply({
        embeds: [errorEmbed('Bu rol benim en yüksek rolümden yüksek, veremem.')],
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const members = await interaction.guild.members.fetch();
    const targets = members.filter(m => (includeBots || !m.user.bot) && !m.roles.cache.has(role.id));

    if (!targets.size) {
      return interaction.editReply({ embeds: [successEmbed('Herkes bu rola sahip.')] });
    }

    let success = 0;
    let failed = 0;

    for (const member of targets.values()) {
      try {
        // Toplu rol dağıtımı: yüzlerce izin isteği oluşmasın diye sistem işlemi sayılır.
        registerCommandGrant(interaction.guild.id, member.id, role.id, interaction.client.user.id);
        await member.roles.add(role, `/rolall - ${interaction.user.tag}`);
        success++;
      } catch {
        failed++;
      }
    }

    return interaction.editReply({
      embeds: [
        successEmbed(
          'Rol Verildi',
          `**${role.name}** Rolü **${success}** uyeye verildi. ${failed ? ` **${failed}** uyeye verilemedi (yetki/hiyerarsi sorunu olabilir).` : ''}`,
        ),
      ],
    });
  },
};