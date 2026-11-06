const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed, infoEmbed } = require('../utils/embeds');
const { parseDuration } = require('../utils/parseDuration');
const { formatRemaining, pickTickInterval } = require('../utils/formatDuration');
const { logAction } = require('../utils/modLog');
const { setActiveTimer, clearActiveTimer } = require('../utils/activeTimers');

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord siniri: 28 gun

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Bir uyeyi susturur (sesli + yazili), kanit gerekli')
    .addUserOption(opt => opt.setName('uye').setDescription('Susturulacak uye').setRequired(true))
    .addStringOption(opt => opt.setName('sure').setDescription('Ornek: 10m, 2h, 1d').setRequired(true))
    .addAttachmentOption(opt => opt.setName('kanit').setDescription('Kanit resmi').setRequired(true))
    .addStringOption(opt => opt.setName('sebep').setDescription('Susturma sebebi').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const member = interaction.options.getMember('uye');
    const durationInput = interaction.options.getString('sure');
    const attachment = interaction.options.getAttachment('kanit');
    const reason = interaction.options.getString('sebep') || 'Sebep belirtilmedi';

    if (!(attachment.contentType || '').startsWith('image/')) {
      return interaction.reply({ embeds: [warningEmbed('Kanit Geçersiz', 'Eklediğin dosya bir resim olmali.')], ephemeral: true });
    }

    if (!member) {
      return interaction.reply({ embeds: [errorEmbed('Bu uye sunucuda bulunamadi.')], ephemeral: true });
    }

    const durationMs = parseDuration(durationInput);
    if (!durationMs) {
      return interaction.reply({ embeds: [warningEmbed('Geçersiz Süre', 'Sureyi `10m`, `2h`, `1d` şeklinde yaz. (s/m/h/d)')], ephemeral: true });
    }

    if (durationMs > MAX_TIMEOUT_MS) {
      return interaction.reply({ embeds: [warningEmbed('Süre Çok Uzun', 'En fazla 28 gün susturabilirsin.')], ephemeral: true });
    }

    if (member.id === interaction.user.id) {
      return interaction.reply({ embeds: [warningEmbed('Geçersiz', 'Kendini susturamazsın.')], ephemeral: true });
    }

    if (member.roles.highest.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
      return interaction.reply({ embeds: [warningEmbed('Yetersiz Rol', 'Seçtiğin üye seninkinden daha yüksek bir role sahip.')], ephemeral: true });
    }

    if (!member.moderatable) {
      return interaction.reply({ embeds: [errorEmbed('Bu üyeyi susturamıyorum rol olarak üstümden.')], ephemeral: true });
    }

    await interaction.deferReply();

    try {
      await member.timeout(durationMs, reason);
    } catch {
      return interaction.editReply({ embeds: [errorEmbed('Susturma İşlemi başarısız oldu.')] });
    }

    const expiresAt = Date.now() + durationMs;

    const embed = successEmbed('Üye Susturuldu', `**${member.user.tag}** hem sesli hemde yazılı olarak susturuldu.`)
      .setColor(0xe67e22)
      .addFields(
        { name: 'Kalan Sure', value: `${formatRemaining(durationMs)} kaldı`, inline: true },
        { name: 'Sebep', value: reason },
      )
      .setImage(attachment.url)
      .setFooter({ text: `Yetkili: ${interaction.user.tag}` })
      .setTimestamp();

    await logAction(interaction.guild, {
      action: 'mute', markKey: `mute:${interaction.guild.id}:${member.id}`, target: member, moderator: interaction.user, reason,
      fields: [{ name: 'Süre', value: durationInput, inline: true }], imageUrl: attachment.url, fromPanel: interaction.fromPanel,
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`unmute_${member.id}`).setLabel('Unmute').setStyle(ButtonStyle.Primary),
    );

    const message = await interaction.editReply({ embeds: [embed], components: [row] });

    const timerKey = `mute_${interaction.guild.id}_${member.id}`;

    const tick = async () => {
      const remaining = expiresAt - Date.now();

      if (remaining <= 0) {
        clearActiveTimer(timerKey);

        const expiredEmbed = infoEmbed('Mute Kalktı - Otomatik', `**${member.user.tag}**`)
          .setTimestamp();

        const disabledRow = new ActionRowBuilder().addComponents(
          ButtonBuilder.from(row.components[0]).setDisabled(true).setLabel('Süresi Doldu'),
        );

        await message.edit({ embeds: [expiredEmbed], components: [disabledRow] }).catch(() => {});
        return;
      }

      const updatedEmbed = EmbedBuilder.from(embed).setFields(
        { name: 'Kalan Sure', value: `${formatRemaining(remaining)} kaldı`, inline: true },
        { name: 'Sebep', value: reason },
      );
      await message.edit({ embeds: [updatedEmbed], components: [row] }).catch(() => {});

      const nextTick = pickTickInterval(remaining);
      setActiveTimer(timerKey, setTimeout(tick, Math.min(nextTick, remaining)));
    };

    setActiveTimer(timerKey, setTimeout(tick, Math.min(pickTickInterval(durationMs), durationMs)));
  },
};