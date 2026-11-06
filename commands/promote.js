const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { logAction } = require('../utils/modLog');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');
const { registerCommandGrant, needsApproval } = require('../utils/askPerm');
const { getConfig } = require('../utils/guildConfig');
const { getLadder, currentRank, blockedReason } = require('../utils/rankLadder');

// Üyeyi üye + yetkili rolleri basamaklarında bir üst role çıkarır (/setroles ile ayarlanır).
// Basamakta olmayan roller (ör. sadece görünüm için "Yetkili" rolü) atlanır.
module.exports = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Üyeyi üye ve yetkili rolleri arasında bir üst role yükseltir.')
    .addUserOption(opt => opt.setName('uye').setDescription('Yükseltilecek üye').setRequired(true))
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

    if (!info.ladder.length) {
      return interaction.reply({ embeds: [warningEmbed('Rol Yok', 'Terfi için rol bulunamadı. `/setroles` ile üye ve yetkili rollerini ayarla.')], ephemeral: true });
    }

    const { index, role: currentTop } = currentRank(member, info.ladder);
    const nextRole = info.ladder[index + 1];

    if (!nextRole) {
      return interaction.reply({ embeds: [warningEmbed('Zaten En Üst Seviyede', `**${member.user.tag}** basamakların en yükseğinde${currentTop ? ` (**${currentTop.name}**)` : ''}.`)], ephemeral: true });
    }

    if (nextRole.position >= interaction.guild.members.me.roles.highest.position) {
      return interaction.reply({ embeds: [errorEmbed('Bu rolu veremiyorum, botun rolu yeterince yuksek degil.')], ephemeral: true });
    }

    const pending = await needsApproval(interaction.guild);

    try {
      registerCommandGrant(interaction.guild.id, member.id, nextRole.id, interaction.user.id, { replaceRoleId: currentTop?.id });
      await member.roles.add(nextRole, `Promote - Yetkili: ${interaction.user.tag}`);
      if (currentTop && !pending) {
        await member.roles.remove(currentTop, `Promote - Yetkili: ${interaction.user.tag}`);
      }
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Rol Değiştirilirken bir Hata Oluştu.')], ephemeral: true });
    }

    await logAction(interaction.guild, {
      action: 'promote', target: member, moderator: interaction.user, fromPanel: interaction.fromPanel,
      fields: [
        { name: 'Önceki Rol', value: currentTop ? currentTop.name : 'Yoktu', inline: true },
        { name: 'Yeni Rol', value: nextRole.name, inline: true },
        ...(pending ? [{ name: 'Durum', value: '⏳ Onay bekliyor', inline: true }] : []),
      ],
    });

    if (pending) {
      return interaction.reply({
        embeds: [
          warningEmbed(
            'Onay Bekleniyor',
            `**${member.user.tag}** için **${nextRole.name}** terfi isteği izin kanalına gönderildi. ` +
              `Kurucu veya bir yönetici onaylarsa **${nextRole.name}** verilecek${currentTop ? ` ve **${currentTop.name}** alınacak` : ''}.`,
          ),
        ],
      });
    }

    const embed = successEmbed('Uye Yukseltildi', `**${member.user.tag}** artık **${nextRole.name}** rolune sahip.`)
      .addFields({ name: 'Önceki Rol', value: currentTop ? currentTop.name : 'Yoktu', inline: true })
      .setFooter({ text: `Yetkili: ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
