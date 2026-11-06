const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');
const { getConfig } = require('../utils/guildConfig');
const { registerCommandGrant, needsApproval } = require('../utils/askPerm');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('klan')
    .setDescription('Secilen uyeye /setklan ile ayarlanan klan rolunu verir')
    .addUserOption(opt => opt.setName('uye').setDescription('Klan rolu verilecek uye').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const config = await getConfig(interaction.guild.id);

    if (!config.clanRoleId) {
      return interaction.reply({ embeds: [warningEmbed('Klan Rolü Yok', 'Once `/setklan` ile bir klan rolü seç.')], ephemeral: true });
    }

    const role = interaction.guild.roles.cache.get(config.clanRoleId);
    if (!role) {
      return interaction.reply({ embeds: [errorEmbed('Ayarlanan klan rolü silinmiş. `/setklan` ile yeniden seç.')], ephemeral: true });
    }

    const member = interaction.options.getMember('uye');
    if (!member) {
      return interaction.reply({ embeds: [errorEmbed('Bu kullanıcı sunucuda değil.')], ephemeral: true });
    }
    if (member.roles.cache.has(role.id)) {
      return interaction.reply({ embeds: [warningEmbed('Zaten Var', `${member} kisisinde ${role} rolü zaten var.`)], ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position) {
      return interaction.reply({
        embeds: [errorEmbed(`Bot ${role} rolunu veremiyor. Botun **Rolleri Yonet** yetkisi olmali ve bot rolu ${role} rolunun ustunde olmali.`)],
        ephemeral: true,
      });
    }

    const pending = await needsApproval(interaction.guild); // onay gerekecek mi?

    try {
      registerCommandGrant(interaction.guild.id, member.id, role.id, interaction.user.id);
      await member.roles.add(role, `Klan rolu: ${interaction.user.tag} verdi`);
    } catch (err) {
      return interaction.reply({ embeds: [errorEmbed(`Rol verilemedi: ${err.message}`)], ephemeral: true });
    }

    if (pending) {
      return interaction.reply({
        embeds: [warningEmbed('Onay Bekleniyor', `${member} kişisine ${role} rolü verme isteği izin kanalına gönderildi. Kurucu veya bir yönetici onaylayana kadar rol **verilmeyecek**.`)],
      });
    }

    await interaction.reply({ embeds: [successEmbed('Klan Rolü Verildi', `${member} kisisine ${role} rolu verildi.`)] });
  },
};