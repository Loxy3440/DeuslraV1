const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setCopyChannel, removeCopyChannel, getConfig } = require('../utils/guildConfig');
const { successEmbed, errorEmbed, warningEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('copy')
    .setDescription('Bir kanala yazilanlari, aynen (buyuk/kucuk harf degismeden) baska bir kanala kopyalar')
    .addSubcommand(sub =>
      sub
        .setName('on')
        .setDescription('Kopyalama modunu acar')
        .addChannelOption(opt =>
          opt.setName('hedef').setDescription('Yazilarin kopyalanacagi kanal').addChannelTypes(ChannelType.GuildText).setRequired(true),
        )
        .addChannelOption(opt =>
          opt
            .setName('kaynak')
            .setDescription('Kopyalanacak kanal (belirtmezsen bu kanal kullanilir)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false),
        ),
    )
    .addSubcommand(sub =>
      sub
        .setName('off')
        .setDescription('Kopyalama modunu kapatir')
        .addChannelOption(opt =>
          opt
            .setName('kaynak')
            .setDescription('Kopyalamasi kapatilacak kanal (belirtmezsen bu kanal kullanilir)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false),
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const source = interaction.options.getChannel('kaynak') || interaction.channel;

    if (sub === 'on') {
      const target = interaction.options.getChannel('hedef');

      if (target.id === source.id) {
        return interaction.reply({ embeds: [errorEmbed('Kaynak ve hedef kanal ayni olamaz.')], ephemeral: true });
      }

      await setCopyChannel(interaction.guild.id, source.id, target.id);

      return interaction.reply({
        embeds: [successEmbed('Kopyalama Acildi', `${source} kanalina yazilan her sey, aynen (buyuk/kucuk harf degismeden) ${target} kanalina kopyalanacak.`)],
      });
    }

    // off
    const config = await getConfig(interaction.guild.id);
    const exists = config.copyChannels.some(c => c.sourceChannelId === source.id);

    if (!exists) {
      return interaction.reply({
        embeds: [warningEmbed('Zaten Kapali', `${source} kanali icin acik bir kopyalama modu yok.`)],
        ephemeral: true,
      });
    }

    await removeCopyChannel(interaction.guild.id, source.id);

    return interaction.reply({
      embeds: [successEmbed('Kopyalama Kapatildi', `${source} kanali icin kopyalama modu kapatildi.`)],
    });
  },
};