const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { addWarn, getWarns } = require('../utils/warns');
const { errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Bir uyeyi uyarir ve kaydeder')
    .addUserOption(opt => opt.setName('uye').setDescription('Uyarilacak uye').setRequired(true))
    .addStringOption(opt => opt.setName('sebep').setDescription('Uyari sebebi').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser('uye');
    const reason = interaction.options.getString('sebep');

    await interaction.deferReply();

    let warn;
    try {
      warn = await addWarn(interaction.guild.id, user.id, interaction.user.id, reason);
    } catch (err) {
      console.error(err);
      return interaction.editReply({ embeds: [errorEmbed('Veritabanına yazılırken bir hata oluştu. MongoDB bağlantısini kontrol et.')] });
    }

    const allWarns = await getWarns(interaction.guild.id, user.id);

    const embed = new EmbedBuilder()
      .setTitle(`Uyari Verildi - Vaka #${warn.caseNumber}`)
      .setColor(0xe67e22)
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: 'Uye', value: `${user.tag} (${user.id})` },
        { name: 'Sebep', value: reason },
        { name: 'Yetkili', value: interaction.user.tag },
        { name: 'Toplam Uyari', value: String(allWarns.length), inline: true },
      )
      .setTimestamp();

    try {
      await user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('Bir uyarı aldınız')
            .setDescription(`**${interaction.guild.name}** sunucusunda uyarıldınız.`)
            .addFields({ name: 'Sebep', value: reason })
            .setColor(0xe67e22)
            .setTimestamp(),
        ],
      });
    } catch {
      // DM kapali olabilir, sessizce gec
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
