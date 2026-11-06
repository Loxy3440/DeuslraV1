const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Bir kullanıcıya DM gönderir')
    .addUserOption(opt => opt.setName('kullanici').setDescription('Mesaj gonderilecek kullanici').setRequired(true))
    .addStringOption(opt => opt.setName('mesaj').setDescription('Gonderilecek mesaj').setRequired(false))
    .addAttachmentOption(opt => opt.setName('dosya').setDescription('Ek dosya/resim').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const user = interaction.options.getUser('kullanici');
    const content = interaction.options.getString('mesaj');
    const attachment = interaction.options.getAttachment('dosya');

    if (user.bot) {
      return interaction.reply({ embeds: [warningEmbed('Gecersiz', 'Bir bota DM gonderemezsin.')], ephemeral: true });
    }

    if (!content && !attachment) {
      return interaction.reply({ embeds: [warningEmbed('Eksik Bilgi', 'En az bir mesaj veya dosya eklemelisin.')], ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle('Yeni Mesaj')
      .setDescription(content || null)
      .setColor(0x5865f2)
      .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
      .setFooter({ text: `${interaction.guild.name} sunucusundan gonderildi` })
      .setTimestamp();

    const files = [];
    if (attachment) {
      if ((attachment.contentType || '').startsWith('image/')) {
        embed.setImage(attachment.url);
      } else {
        files.push(attachment.url);
      }
    }

    try {
      await user.send({ embeds: [embed], files });
    } catch {
      return interaction.editReply({ embeds: [warningEmbed('Gonderilemedi', `**${user.tag}** DM'lerini kapatmis veya botu engellemis.`)] });
    }

    await interaction.editReply({ embeds: [successEmbed('Mesaj Gonderildi', `Mesajin **${user.tag}** kullanicisina iletildi.`)] });
  },
};