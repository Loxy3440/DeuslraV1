const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { errorEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Bu kanal icin bir davet linki olusturur')
    .setDefaultMemberPermissions(PermissionFlagsBits.CreateInstantInvite),

  async execute(interaction) {
    let invite;
    try {
      invite = await interaction.channel.createInvite({ maxAge: 0, maxUses: 0, unique: true });
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Davet linki olusturulurken bir hata olustu.')], ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('Sunucu Daveti')
      .setDescription(`**${interaction.guild.name}** sunucusuna katilmak icin asagidaki butona tikla.`)
      .setColor(0x5865f2)
      .setThumbnail(interaction.guild.iconURL())
      .setFooter({ text: `Olusturan: ${interaction.user.tag}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Sunucuya Katil').setStyle(ButtonStyle.Link).setURL(`https://discord.gg/${invite.code}`),
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};