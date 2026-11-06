const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');
const { logAction } = require('../utils/modLog');
const { clearActiveTimer } = require('../utils/activeTimers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription("Bir kullanıcının susturmasını kaldırır")
    .addUserOption(opt => opt.setName('kullanıcı').setDescription('Susturması kaldırılacak kullanıcı').setRequired(true))
    .addStringOption(opt => opt.setName('sebep').setDescription('Sebep').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const member = interaction.options.getMember('kullanıcı');
    const reason = interaction.options.getString('sebep') || 'Sebep belirtilmedi';

    if (!member) {
      return interaction.reply({ embeds: [errorEmbed('Bu kullanıcı sunucuda bulunamadı.')], ephemeral: true });
    }

    if (!member.communicationDisabledUntil || member.communicationDisabledUntil < new Date()) {
      return interaction.reply({ embeds: [warningEmbed('Susturulmamış', `**${member.user.tag}** su anda susturulmuş değil.`)], ephemeral: true });
    }

    await interaction.deferReply();

    try {
      await member.timeout(null, reason);
    } catch {
      return interaction.editReply({ embeds: [errorEmbed('Susturma kaldırma işlemi başarısız oldu.')] });
    }

    clearActiveTimer(`mute_${interaction.guild.id}_${member.id}`);

    await logAction(interaction.guild, { action: 'unmute', markKey: `mute:${interaction.guild.id}:${member.id}`, target: member, moderator: interaction.user, reason, fromPanel: interaction.fromPanel });

    const embed = successEmbed('Susturma Kaldırıldı', `**${member.user.tag}** artık tekrar konuşabilir.`)
      .addFields({ name: 'Sebep', value: reason })
      .setFooter({ text: `Yetkili: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};