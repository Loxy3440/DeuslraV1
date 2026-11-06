const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setnick')
    .setDescription('Bir kullanıcının takma adını değiştirir')
    .addUserOption(opt => opt.setName('uye').setDescription('Takma adi degistirilecek uye').setRequired(true))
    .addStringOption(opt => opt.setName('yeni_isim').setDescription('Yeni takma ad (max 32 karakter)').setRequired(true).setMaxLength(32))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),

  async execute(interaction) {
    const member = interaction.options.getMember('uye');
    const newNick = interaction.options.getString('yeni_isim');

    if (!member) {
      return interaction.reply({ embeds: [errorEmbed('Bu kullanıcı sunucuda bulunamadı.')], ephemeral: true });
    }

    if (member.roles.highest.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
      return interaction.reply({ embeds: [warningEmbed('Yetersiz Rol', 'Bu kullanıcının rolü seninkine eşit veya daha yüksek.')], ephemeral: true });
    }

    const oldNick = member.displayName;

    try {
      await member.setNickname(newNick, `Yetkili: ${interaction.user.tag}`);
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Takma ad değiştirilirken bir hata oluştu. (Rol hiyerarsisi buna izin vermiyor olabilir)')], ephemeral: true });
    }

    const embed = successEmbed('Takma Ad Degistirildi', `**${oldNick}** → **${newNick}**`)
      .setFooter({ text: `Yetkili: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
