const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setConfig, getConfig } = require('../utils/guildConfig');
const { connectToVoice, disconnectFromVoice } = require('../utils/voiceConnection');
const { successEmbed, errorEmbed, warningEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vcc')
    .setDescription('Botun açılışta gireceği ses kanalını ayarlar veya kapatır')
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Botun gireceği ses kanalını ayarlar ve hemen bağlanır')
        .addChannelOption(opt =>
          opt.setName('kanal').setDescription('Ses kanalı').addChannelTypes(ChannelType.GuildVoice).setRequired(true),
        ),
    )
    .addSubcommand(sub => sub.setName('off').setDescription('Botu ses kanalından çıkarır ve ayarı kaldırır'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const channel = interaction.options.getChannel('kanal');

      await setConfig(interaction.guild.id, { vcChannelId: channel.id });

      try {
        connectToVoice(channel);
      } catch (err) {
        console.error('[VCC]', err);
        return interaction.reply({
          embeds: [errorEmbed('Kanala bağlanırken bir hata oluştu. `@discordjs/voice` ve `libsodium-wrappers` kurulu mu kontrol et (`npm install`).')],
          ephemeral: true,
        });
      }

      return interaction.reply({
        embeds: [
          successEmbed(
            'Ses kanalı ayarlandı',
            `Bot artık açılışta otomatik olarak ${channel} kanalına girecek (mikrofon ve kulaklık kapalı). şimdi de bağlandı.`,
          ),
        ],
      });
    }

    // off
    const config = await getConfig(interaction.guild.id);
    if (!config.vcChannelId) {
      return interaction.reply({ embeds: [warningEmbed('Zaten Kapalı', 'Ayarlanmış bir ses kanali yok.')], ephemeral: true });
    }

    disconnectFromVoice(interaction.guild.id);
    await setConfig(interaction.guild.id, { vcChannelId: null });

    return interaction.reply({ embeds: [successEmbed('Kapatıldı', 'Bot ses kanalindan çıktı ve otomatik bağlanma kapatıldı.')] });
  },
};