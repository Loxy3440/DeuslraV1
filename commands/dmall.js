const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { warningEmbed, successEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dmall')
    .setDescription('Sunucudaki tum uyelere ozel mesaj gonderir')
    .addStringOption(opt => opt.setName('mesaj').setDescription('Gonderilecek mesaj').setRequired(false))
    .addAttachmentOption(opt => opt.setName('dosya').setDescription('Ek dosya/resim').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const content = interaction.options.getString('mesaj');
    const attachment = interaction.options.getAttachment('dosya');

    if (!content && !attachment) {
      return interaction.reply({ embeds: [warningEmbed('Eksik Bilgi', 'En az bir mesaj veya dosya eklemelisin.')], ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const allMembers = await interaction.guild.members.fetch();
    const members = allMembers.filter(m => !m.user.bot && m.id !== interaction.user.id);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Gonderiliyor...')
          .setDescription(`**${members.size}** Üyeye mesaj gönderiliyor biraz zaman alabilir..`)
          .setColor(0x5865f2),
      ],
    });

    let sent = 0;
    let failed = 0;

    for (const member of members.values()) {
      const embed = new EmbedBuilder()
        .setTitle('Duyuru')
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
        await member.send({ embeds: [embed], files });
        sent += 1;
      } catch {
        failed += 1;
      }

      await new Promise(resolve => setTimeout(resolve, 1000)); // Discord rate limit korumasi
    }

    await interaction.editReply({
      embeds: [
        successEmbed('DM Gonderimi Tamamlandi', null)
          .addFields(
            { name: 'Gonderilen', value: String(sent), inline: true },
            { name: 'Basarisiz', value: String(failed), inline: true },
            { name: 'Toplam Uye', value: String(members.size), inline: true },
          ),
      ],
    });
  },
};