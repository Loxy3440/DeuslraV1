const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const { setConfig } = require('../utils/guildConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setklan')
    .setDescription('/klan komutuyla verilecek klan rolunu secer')
    .addRoleOption(opt => opt.setName('rol').setDescription('Klan rolu').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const role = interaction.options.getRole('rol');
    const me = interaction.guild.members.me;

    if (role.id === interaction.guild.id) {
      return interaction.reply({ embeds: [errorEmbed('@everyone rolu klan rolu olarak secilemez.')], ephemeral: true });
    }
    if (role.managed) {
      return interaction.reply({ embeds: [errorEmbed('Bu rol bir bot/entegrasyona ait, elle verilemez. Baska bir rol sec.')], ephemeral: true });
    }
    if (role.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [errorEmbed('Yonetici yetkisi olan bir rol klan rolu olarak secilemez (guvenlik).')], ephemeral: true });
    }
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ embeds: [errorEmbed('Botun **Rolleri Yonet** yetkisi yok.')], ephemeral: true });
    }
    if (role.position >= me.roles.highest.position) {
      return interaction.reply({
        embeds: [errorEmbed(`${role} rolu botun en yuksek rolunden yukarida veya ayni seviyede. Sunucu Ayarlari > Roller'de bot rolunu ${role} rolunun ustune tasi.`)],
        ephemeral: true,
      });
    }

    await setConfig(interaction.guild.id, { clanRoleId: role.id });

    await interaction.reply({
      embeds: [successEmbed('Klan Rolu Ayarlandi', `Klan rolu ${role} olarak ayarlandi. Artik \`/klan uye:@kisi\` ile bu rol verilebilir.`)],
      ephemeral: true,
    });
  },
};