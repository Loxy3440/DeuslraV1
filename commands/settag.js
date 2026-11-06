const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const { setConfig } = require('../utils/guildConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settag')
    .setDescription('Sunucu etiketini takana otomatik verilecek rolü ve duyuru kanalını ayarlar')
    .addRoleOption(opt => opt.setName('rol').setDescription('Etiketi takana verilecek rol').setRequired(true))
    .addChannelOption(opt =>
      opt
        .setName('kanal')
        .setDescription('Rol verilince üyenin etiketlenip mesajın silineceği kanal')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const role = interaction.options.getRole('rol');
    const channel = interaction.options.getChannel('kanal');
    const me = interaction.guild.members.me;

    if (role.id === interaction.guild.id) {
      return interaction.reply({ embeds: [errorEmbed('@everyone rolü seçilemez.')], ephemeral: true });
    }
    if (role.managed) {
      return interaction.reply({ embeds: [errorEmbed('Bu rol bir bot/entegrasyona ait, verilemez. Başka bir rol seç.')], ephemeral: true });
    }
    if (role.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [errorEmbed('Yönetici yetkisi olan bir rol seçilemez (güvenlik).')], ephemeral: true });
    }
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ embeds: [errorEmbed('Botun **Rolleri Yönet** yetkisi yok.')], ephemeral: true });
    }
    if (role.position >= me.roles.highest.position) {
      return interaction.reply({
        embeds: [errorEmbed(`${role} rolü botun en yüksek rolünden yukarıda veya aynı seviyede. Sunucu Ayarları > Roller'de bot rolünü ${role} rolünün üstüne taşı.`)],
        ephemeral: true,
      });
    }

    const perms = channel.permissionsFor(me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages])) {
      return interaction.reply({
        embeds: [errorEmbed(`Botun ${channel} kanalında **Kanalı Gör**, **Mesaj Gönder** ve **Mesajları Yönet** yetkisi olmalı.`)],
        ephemeral: true,
      });
    }

    await setConfig(interaction.guild.id, { tagRoleId: role.id, tagChannelId: channel.id });

    await interaction.reply({
      embeds: [
        successEmbed(
          'Etiket Rolü Ayarlandı',
          `Sunucu etiketini takan üyeye ${role} verilecek, ${channel} kanalında etiketlenip mesaj silinecek. Etiketi çıkaran üyeden rol geri alınır.\n\n` +
            `Kanalı sadece ${role} rolünün görebileceği şekilde kanal izinlerinden ayarlamayı unutma.`,
        ),
      ],
      ephemeral: true,
    });
  },
};
