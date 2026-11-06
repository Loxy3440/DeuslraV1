const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { errorEmbed, warningEmbed } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('allmute')
    .setDescription('Bulunduğun ses kanalındaki diğer üyeleri susturur')
    .addBooleanOption(opt => opt
      .setName('botlar')
      .setDescription('Bot hesaplarını da sustur')
      .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers),

  async execute(interaction) {
    if (!interaction.guild || !interaction.member) {
      return interaction.reply({ embeds: [errorEmbed('Bu komut yalnızca sunucuda kullanılabilir.')], ephemeral: true });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.MuteMembers)) {
      return interaction.reply({ embeds: [errorEmbed('Bu komut için Üyeleri Sustur izni gerekli.')], ephemeral: true });
    }

    const channel = interaction.member.voice?.channel;
    if (!channel) {
      return interaction.reply({ embeds: [warningEmbed('Ses kanalında değilsin', 'Önce susturmak istediğin ses kanalına katıl.')], ephemeral: true });
    }

    const botMember = interaction.guild.members.me || await interaction.guild.members.fetch(interaction.client.user.id).catch(() => null);
    if (!botMember?.permissionsIn(channel).has(PermissionFlagsBits.MuteMembers)) {
      return interaction.reply({ embeds: [errorEmbed('Botun bu ses kanalında Üyeleri Sustur izni yok.')], ephemeral: true });
    }

    const includeBots = interaction.options.getBoolean('botlar') === true;
    const targets = [...channel.members.values()].filter(member =>
      member.id !== interaction.user.id && (includeBots || !member.user.bot),
    );
    if (!targets.length) {
      return interaction.reply({ embeds: [warningEmbed('İşlem yapılacak üye yok', 'Bu kanalda senden başka seçime uyan üye bulunmuyor.')], ephemeral: true });
    }

    await interaction.deferReply();
    let muted = 0;
    let alreadyMuted = 0;
    let failed = 0;
    let moved = 0;

    for (let i = 0; i < targets.length; i++) {
      const member = targets[i];
      if (member.voice.channelId !== channel.id) { moved++; continue; }
      if (member.voice.serverMute) { alreadyMuted++; continue; }
      try {
        await member.voice.setMute(true, '/allmute - ' + interaction.user.tag);
        muted++;
      } catch {
        failed++;
      }

      if ((i + 1) % 20 === 0 && i + 1 < targets.length) {
        await interaction.editReply({ content: 'Ses susturma sürüyor: ' + (i + 1) + '/' + targets.length, embeds: [] }).catch(() => {});
      }
    }

    const notMuted = failed + moved;
    const report = new EmbedBuilder()
      .setColor(notMuted ? 0xe67e22 : 0x57f287)
      .setTitle('/allmute tamamlandı')
      .setDescription('Komut anında aynı ses kanalındaki üyeler işlendi; komutu kullanan kişi hariç tutuldu.')
      .addFields(
        { name: 'Yeni susturulan', value: String(muted), inline: true },
        { name: 'Zaten susturulmuş', value: String(alreadyMuted), inline: true },
        { name: 'Susturulamayan / kanaldan ayrılan', value: String(notMuted), inline: true },
        { name: 'Bot hesapları dahil', value: includeBots ? 'Evet' : 'Hayır', inline: true },
      )
      .setFooter({ text: 'Yetkili: ' + interaction.user.tag })
      .setTimestamp();

    await interaction.editReply({ content: '', embeds: [report] });
  },
};
