const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { logAction } = require('../utils/modLog');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');
const { registerCommandGrant, needsApproval } = require('../utils/askPerm');
const { getConfig } = require('../utils/guildConfig');
const { getLadder, currentRank, blockedReason } = require('../utils/rankLadder');

// /promote'un tersi: üyenin basamaklardaki (üye + yetkili) en yüksek rolünü alır, bir alttakini verir.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('demote')
    .setDescription('Üyenin rolünü alıp üye/yetkili basamaklarında bir alttaki rolü verir.')
    .addUserOption(opt => opt.setName('uye').setDescription('Rütbesi düşürülecek üye').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const member = interaction.options.getMember('uye');
    if (!member) {
      return interaction.reply({ embeds: [errorEmbed('Bu uye sunucuda bulunamadı.')], ephemeral: true });
    }

    const config = await getConfig(interaction.guild.id);
    const info = getLadder(interaction.guild, config);

    const blocked = blockedReason(member);
    if (blocked) return interaction.reply({ embeds: [warningEmbed('İşlem Yapılamaz', blocked)], ephemeral: true });

    const { index, role: currentTop } = currentRank(member, info.ladder);
    if (!currentTop) {
      return interaction.reply({ embeds: [warningEmbed('Rütbe Yok', `**${member.user.tag}** üye/yetkili basamaklarında bir role sahip değil.`)], ephemeral: true });
    }

    const prevRole = info.ladder[index - 1];
    if (!prevRole) {
      return interaction.reply({ embeds: [warningEmbed('Zaten En Alt Seviyede', `**${member.user.tag}** zaten en alt basamakta (**${currentTop.name}**).`)], ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (prevRole.position >= me.roles.highest.position || currentTop.position >= me.roles.highest.position) {
      return interaction.reply({ embeds: [errorEmbed('Rolleri değiştiremiyorum, botun rolu yeterince yuksek degil.')], ephemeral: true });
    }

    const pending = await needsApproval(interaction.guild);

    try {
      // Onay gerekiyorsa eski rol şimdi alınmaz, yeni rol onaylanınca eski rol otomatik alınır.
      registerCommandGrant(interaction.guild.id, member.id, prevRole.id, interaction.user.id, { replaceRoleId: currentTop.id });
      await member.roles.add(prevRole, `Demote - Yetkili: ${interaction.user.tag}`);
      if (!pending) {
        await member.roles.remove(currentTop, `Demote - Yetkili: ${interaction.user.tag}`);
      }
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Rol Değiştirilirken bir Hata Oluştu.')], ephemeral: true });
    }

    await logAction(interaction.guild, {
      action: 'demote', target: member, moderator: interaction.user, fromPanel: interaction.fromPanel,
      fields: [
        { name: 'Önceki Rol', value: currentTop.name, inline: true },
        { name: 'Yeni Rol', value: prevRole.name, inline: true },
        ...(pending ? [{ name: 'Durum', value: '⏳ Onay bekliyor', inline: true }] : []),
      ],
    });

    if (pending) {
      return interaction.reply({
        embeds: [
          warningEmbed(
            'Onay Bekleniyor',
            `**${member.user.tag}** için **${prevRole.name}** rolüne düşürme isteği izin kanalına gönderildi. ` +
              `Kurucu veya bir yönetici onaylarsa **${prevRole.name}** verilecek ve **${currentTop.name}** alınacak.`,
          ),
        ],
      });
    }

    const embed = successEmbed('Üye Düşürüldü', `**${member.user.tag}** artık **${prevRole.name}** rolüne sahip.`)
      .addFields({ name: 'Önceki Rol', value: currentTop.name, inline: true })
      .setFooter({ text: `Yetkili: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
