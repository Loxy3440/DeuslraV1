const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed, infoEmbed } = require('../utils/embeds');
const { parseDuration } = require('../utils/parseDuration');
const { formatRemaining, pickTickInterval } = require('../utils/formatDuration');
const { addTempRole, removeTempRole } = require('../utils/tempRoles');
const { setActiveTimer, clearActiveTimer } = require('../utils/activeTimers');
const { registerCommandGrant, needsApproval } = require('../utils/askPerm');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolver')
    .setDescription('Bir uyeye rol verir (sure opsiyonel, bos = suresiz)')
    .addUserOption(opt => opt.setName('uye').setDescription('Rol verilecek uye').setRequired(true))
    .addRoleOption(opt => opt.setName('rol').setDescription('Verilecek rol').setRequired(true))
    .addStringOption(opt => opt.setName('sure').setDescription('Ornek: 10s, 10m, 2h, 1d (bos birakilirsa suresiz)').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const member = interaction.options.getMember('uye');
    const role = interaction.options.getRole('rol');
    const durationInput = interaction.options.getString('sure');

    if (!member) {
      return interaction.reply({ embeds: [errorEmbed('Bu uye sunucuda bulunamadi.')], ephemeral: true });
    }

    if (role.managed || role.id === interaction.guild.id) {
      return interaction.reply({ embeds: [warningEmbed('Geçersiz Rol', 'Bu rol verilemez.')], ephemeral: true });
    }

    if (role.position >= interaction.guild.members.me.roles.highest.position) {
      return interaction.reply({ embeds: [errorEmbed('Bu rolü veremiyorum', 'Bu üyenin rolü seninkine eşit veya daha yüksek')], ephemeral: true });
    }

    let durationMs = null;
    if (durationInput) {
      durationMs = parseDuration(durationInput);
      if (!durationMs) {
        return interaction.reply({ embeds: [warningEmbed('Geçersiz Süre', 'üreyi `10s`, `10m`, `2h`, `1d` seklinde yaz. (s/m/h/d)')], ephemeral: true });
      }
    }

    const expiresAt = durationMs ? Date.now() + durationMs : null;
    const pending = await needsApproval(interaction.guild); // onay gerekecek mi?

    try {
      // Süre bilgisi de bırakılır: onay süreden sonra gelirse rol verilmez.
      registerCommandGrant(interaction.guild.id, member.id, role.id, interaction.user.id, { expiresAt });
      await member.roles.add(role, `Yetkili: ${interaction.user.tag}`);
    } catch {
      return interaction.reply({ embeds: [errorEmbed('Rol verilirken bir hata oluştu.')], ephemeral: true });
    }

    if (durationMs) {
      await addTempRole(interaction.guild.id, member.id, role.id, new Date(expiresAt), interaction.channel.id);
    }

    // İzin sistemi açıksa rol, onay gelene kadar üyeden geri alınır: "verildi" demeyelim.
    if (pending) {
      return interaction.reply({
        embeds: [
          warningEmbed(
            'Onay Bekleniyor',
            `**${member.user.tag}** kullanıcısına **${role.name}** rolü verme isteği izin kanalına gönderildi. ` +
              'Kurucu veya bir yönetici onaylayana kadar rol **verilmeyecek**.' +
              (durationMs ? ` Süre (${formatRemaining(durationMs)}) şimdiden işliyor, onay süreden sonra gelirse rol verilmez.` : ''),
          ),
        ],
      });
    }

    const embed = successEmbed('Rol Verildi', `**${member.user.tag}** Kullanıcısına **${role.name}** rolü verildi.`)
      .addFields({ name: 'Sure', value: durationMs ? formatRemaining(durationMs) + ' kaldi' : 'Suresiz', inline: true })
      .setFooter({ text: `Yetkili: ${interaction.user.tag}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`roltakeback_${member.id}_${role.id}`).setLabel('Geri Al').setStyle(ButtonStyle.Danger),
    );

    const message = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

    if (!durationMs) return;

    const timerKey = `role_${interaction.guild.id}_${member.id}_${role.id}`;

    const tick = async () => {
      const remaining = expiresAt - Date.now();

      if (remaining <= 0) {
        clearActiveTimer(timerKey);

        const guildMember = await interaction.guild.members.fetch(member.id).catch(() => null);
        if (guildMember) {
          await guildMember.roles.remove(role.id, 'Geçici rol süresi doldu').catch(() => {});
        }
        await removeTempRole(interaction.guild.id, member.id, role.id).catch(() => {});

        const expiredEmbed = infoEmbed('Süresi Doldu', `**${member.user.tag}** kullanıcısından **${role.name}** rolü, süresi doldugu icin geri alındı.`)
          .setTimestamp();

        const disabledRow = new ActionRowBuilder().addComponents(
          ButtonBuilder.from(row.components[0]).setDisabled(true).setLabel('Süresi Doldu'),
        );

        await message.edit({ embeds: [expiredEmbed], components: [disabledRow] }).catch(() => {});
        return;
      }

      const updatedEmbed = EmbedBuilder.from(embed).setFields({ name: 'Sure', value: `${formatRemaining(remaining)} kaldi`, inline: true });
      await message.edit({ embeds: [updatedEmbed], components: [row] }).catch(() => {});

      const nextTick = pickTickInterval(remaining);
      setActiveTimer(timerKey, setTimeout(tick, Math.min(nextTick, remaining)));
    };

    setActiveTimer(timerKey, setTimeout(tick, Math.min(pickTickInterval(durationMs), durationMs)));
  },
};