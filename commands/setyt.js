const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const { errorEmbed } = require('../utils/embeds');
const { MAX_CHANNELS, resolveChannelId, fetchFeed, getYtConfig, saveYtConfig } = require('../utils/youtube');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setyt')
    .setDescription('Izlenecek YouTube kanallarini ve videolarin atilacagi Discord kanalini ayarlar')
    .addChannelOption(opt =>
      opt.setName('kanal').setDescription('Yeni videolarin atilacagi Discord kanali')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
    .addStringOption(opt =>
      opt.setName('linkler').setDescription('YouTube kanal linkleri (birden fazla ise bosluk veya virgul ile ayir)').setRequired(true).setMaxLength(1500))
    .addStringOption(opt =>
      opt.setName('islem').setDescription('Listeyi nasil degistirsin? (varsayilan: ayarla)').setRequired(false)
        .addChoices(
          { name: 'ayarla - listeyi bu linklerle degistir', value: 'ayarla' },
          { name: 'ekle - mevcut listeye ekle', value: 'ekle' },
          { name: 'cikar - bu kanallari listeden cikar', value: 'cikar' },
        ))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const target = interaction.options.getChannel('kanal');
    const mode = interaction.options.getString('islem') || 'ayarla';
    const inputs = [...new Set(interaction.options.getString('linkler').split(/[\s,;]+/).filter(Boolean))];

    // Botun duyuru kanalinda yazma ve @everyone yetkisi var mi?
    const perms = target.permissionsFor(interaction.guild.members.me);
    if (!perms?.has(['ViewChannel', 'SendMessages'])) {
      return interaction.reply({ embeds: [errorEmbed(`Botun ${target} kanalinda mesaj yazma yetkisi yok.`)], ephemeral: true });
    }
    const warnings = [];
    if (!perms.has('MentionEveryone')) {
      warnings.push(`⚠️ Botun ${target} kanalinda **@here etiketleme** yetkisi yok, etiket calismaz. Bota "Herkesi Etiketle" yetkisi ver.`);
    }

    await interaction.deferReply({ ephemeral: true });

    // Linkleri kanal ID'sine cevir
    const failed = [];
    const results = await Promise.all(
      inputs.map(async input => {
        try {
          return [await resolveChannelId(input), input];
        } catch (err) {
          failed.push(`\`${input.slice(0, 60)}\` → ${err.message}`);
          return null;
        }
      }),
    );
    const resolved = new Map(results.filter(Boolean)); // channelId -> girilen link (girilen sirayi korur)

    if (!resolved.size) {
      return interaction.editReply({ embeds: [errorEmbed(`Hicbir link cozulemedi:\n${failed.join('\n')}`)] });
    }

    const existing = await getYtConfig(interaction.guild.id);
    const oldChannels = existing?.channels || [];
    let channels;

    if (mode === 'cikar') {
      channels = oldChannels.filter(c => !resolved.has(c.channelId));
    } else {
      // Yeni kanallar icin mevcut videolari "goruldu" say: sadece bundan sonra yuklenenler paylasilsin.
      const added = await Promise.all(
        [...resolved].map(async ([channelId, input]) => {
          const old = oldChannels.find(c => c.channelId === channelId);
          if (old) return old; // zaten izleniyor: gecmisini koru
          try {
            const feed = await fetchFeed(channelId);
            return { channelId, title: feed.title || input, input, seen: feed.videos.map(v => v.id), baselined: true };
          } catch (err) {
            // Feed simdi alinamadiysa kanal yine eklenir; ilk /yt'de mevcut videolar paylasilmadan kaydedilir.
            warnings.push(`⚠️ \`${input.slice(0, 60)}\` eklendi ama videolari simdi okunamadi (${err.message}). Ilk /yt'de mevcut videolar paylasilmadan kaydedilecek.`);
            return { channelId, title: input, input, seen: [], baselined: false };
          }
        }),
      );
      channels = mode === 'ayarla' ? added : [...oldChannels.filter(c => !resolved.has(c.channelId)), ...added];
    }

    if (channels.length > MAX_CHANNELS) {
      return interaction.editReply({ embeds: [errorEmbed(`En fazla ${MAX_CHANNELS} YouTube kanali izlenebilir (su an ${channels.length} olacakti).`)] });
    }

    await saveYtConfig(interaction.guild.id, { announceChannelId: target.id, channels });

    const embed = new EmbedBuilder()
      .setTitle('YouTube Ayarlandi')
      .setColor(0xff0000)
      .addFields(
        { name: 'Videolarin Atilacagi Kanal', value: `${target}` },
        {
          name: `Izlenen YouTube Kanallari (${channels.length})`,
          value: channels.length ? channels.map(c => `• **${c.title}** (\`${c.channelId}\`)`).join('\n').slice(0, 1000) : 'Liste bos.',
        },
      )
      .setFooter({ text: 'Yeni video kontrolu icin /yt yaz. Sadece bundan sonra yuklenen videolar paylasilir.' });

    if (failed.length) embed.addFields({ name: 'Cozulemeyen Linkler', value: failed.join('\n').slice(0, 1000) });
    if (warnings.length) embed.addFields({ name: 'Uyarilar', value: warnings.join('\n').slice(0, 1000) });

    await interaction.editReply({ embeds: [embed] });
  },
};