const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const { errorEmbed } = require('../utils/embeds');
const { createEvent, parseEventDuration, MIN_DURATION_MS, MAX_DURATION_MS } = require('../utils/events');

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const builder = new SlashCommandBuilder()
  .setName('setevent')
  .setDescription('Belirli saat sonra rastgele bir kanalda "ilk yazan kazanir" eventi baslatir')
  .addStringOption(opt =>
    opt.setName('sure').setDescription('Ne kadar sonra gonderilsin. Ornek: 30s, 1m, 2h, 1d, 1h30m (s=saniye m=dakika h=saat d=gun)').setRequired(true).setMaxLength(40))
  .addStringOption(opt =>
    opt.setName('mesaj').setDescription('Event mesaji (ornek: Bu mesaji ilk yazan kazanir:)').setRequired(true).setMaxLength(1500))
  .addStringOption(opt =>
    opt.setName('kelime').setDescription('Yazilmasi gereken kelime (ornek: Haze), mesajin altina eklenir').setRequired(true).setMaxLength(100))
  .addStringOption(opt =>
    opt.setName('kazanan_mesaj').setDescription('Kazanana atilacak mesaj. {user} {server} {kanal} kullanilabilir, kanal icin <#ID>').setRequired(true).setMaxLength(1500))
  .addChannelOption(opt =>
    opt.setName('kanal1').setDescription('Event kanali 1').addChannelTypes(...TEXT_TYPES).setRequired(true));

for (let i = 2; i <= 5; i++) {
  builder.addChannelOption(opt =>
    opt.setName(`kanal${i}`).setDescription(`Event kanali ${i} (istege bagli)`).addChannelTypes(...TEXT_TYPES).setRequired(false));
}

builder.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

// Slash komut kutusunda alt satir yazilamadigi icin "\n" yazilirsa gercek alt satira cevrilir.
const unescapeNewlines = text => text.replace(/\\n/g, '\n');

module.exports = {
  data: builder,

  async execute(interaction) {
    const durationMs = parseEventDuration(interaction.options.getString('sure'));
    const announcement = unescapeNewlines(interaction.options.getString('mesaj'));
    const word = interaction.options.getString('kelime').trim();
    const winMessage = unescapeNewlines(interaction.options.getString('kazanan_mesaj'));

    const channels = [];
    for (let i = 1; i <= 5; i++) {
      const ch = interaction.options.getChannel(`kanal${i}`);
      if (ch && !channels.some(c => c.id === ch.id)) channels.push(ch);
    }

    if (durationMs === null || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
      return interaction.reply({
        embeds: [errorEmbed('Gecersiz sure. Ornekler: `30s` (30 saniye), `1m` (1 dakika), `2h` (2 saat), `1d` (1 gun), `1h30m`. En az 1 saniye, en fazla 30 gun.')],
        ephemeral: true,
      });
    }

    if (!word) {
      return interaction.reply({ embeds: [errorEmbed('Kelime bos olamaz.')], ephemeral: true });
    }

    // Botun mesaj atamayacagi kanallari simdiden uyar.
    const me = interaction.guild.members.me;
    const noPerm = channels.filter(c => !c.permissionsFor(me)?.has(['ViewChannel', 'SendMessages']));
    if (noPerm.length) {
      return interaction.reply({
        embeds: [errorEmbed(`Botun su kanallarda mesaj yazma yetkisi yok: ${noPerm.map(c => `<#${c.id}>`).join(', ')}`)],
        ephemeral: true,
      });
    }

    const sendAt = new Date(Date.now() + durationMs);
    await createEvent({
      guildId: interaction.guild.id,
      channelIds: channels.map(c => c.id),
      announcement,
      word,
      winMessage,
      sendAt,
      createdBy: interaction.user.id,
    });

    const unix = Math.floor(sendAt.getTime() / 1000);
    const embed = new EmbedBuilder()
      .setTitle('Event Kuruldu')
      .setColor(0x57f287)
      .addFields(
        { name: 'Gonderilme Zamani', value: `<t:${unix}:F> (<t:${unix}:R>)` },
        { name: 'Kanallar (biri rastgele secilir)', value: channels.map(c => `<#${c.id}>`).join(', ') },
        { name: 'Event Mesaji', value: `${announcement}\n**${word}**` },
        { name: 'Kazanan Mesaji', value: winMessage },
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};