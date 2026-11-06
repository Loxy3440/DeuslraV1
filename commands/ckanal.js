const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');
const { getConfig, setConfig } = require('../utils/guildConfig');
const { updateNow, renderName, DEFAULT_FORMAT } = require('../utils/countChannel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ckanal')
    .setDescription('Toplam üye sayısını (botlar dahil) kanal adında gösteren sayaç kanalını ayarlar')
    .addSubcommand(sub =>
      sub
        .setName('ayarla')
        .setDescription('Sayaç kanalını seçer')
        .addChannelOption(opt =>
          opt.setName('kanal').setDescription('Adı değişecek kanal (ses kanalı önerilir)').setRequired(true)
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption(opt => opt.setName('yazi').setDescription('Kanal adı. {sayi} yerine üye sayısı gelir. Örn: 👥 Üye: {sayi}').setMaxLength(90)),
    )
    .addSubcommand(sub => sub.setName('kapat').setDescription('Sayaç kanalını kapatır (kanal silinmez)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'kapat') {
      const config = await getConfig(interaction.guild.id);
      if (!config.countChannelId) return interaction.reply({ embeds: [warningEmbed('Zaten Kapalı', 'Sayaç kanalı ayarlı değil.')], ephemeral: true });
      await setConfig(interaction.guild.id, { countChannelId: null });
      return interaction.reply({ embeds: [successEmbed('Sayaç Kapatıldı', 'Kanalın adı artık güncellenmeyecek.')], ephemeral: true });
    }

    const channel = interaction.options.getChannel('kanal', true);
    const format = (interaction.options.getString('yazi') || DEFAULT_FORMAT).trim();
    if (!/\{sayi\}/i.test(format)) {
      return interaction.reply({ embeds: [errorEmbed('Yazıda üye sayısının geleceği yeri `{sayi}` ile belirt. Örn: `👥 Üye: {sayi}`')], ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) {
      return interaction.reply({ embeds: [errorEmbed(`Botun ${channel} kanalında **Kanalı Gör** ve **Kanalları Yönet** yetkisi olmalı.`)], ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    await setConfig(interaction.guild.id, { countChannelId: channel.id, countFormat: format });

    let note = '';
    try {
      await updateNow(interaction.guild);
    } catch (err) {
      note = `\nKanal adı şu an güncellenemedi (${err.message}); bot birazdan tekrar dener.`;
    }

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Sayaç Kanalı Ayarlandı',
          `${channel} kanalının adı artık **${renderName(format, interaction.guild.memberCount)}** şeklinde toplam üye sayısını (botlar dahil) gösterecek.\n` +
            'Discord kanal adı değişikliğini sınırladığı için sayı en geç birkaç dakikada bir güncellenir.' +
            '\nSes kanalı kullanıyorsan, kimse girmesin diye kanalın **Bağlan** iznini herkes için kapatabilirsin.' + note,
        ),
      ],
    });
  },
};
