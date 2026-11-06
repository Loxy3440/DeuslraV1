const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { errorEmbed, warningEmbed } = require('../utils/embeds');

const EMOJI_PERM = PermissionFlagsBits.ManageGuildExpressions ?? PermissionFlagsBits.ManageEmojisAndStickers;
const MAX_RUNTIME_MS = 12 * 60 * 1000; // etkilesim 15 dk sonra kapanir, ondan once guvenle dur
const PROGRESS_EVERY = 5;

function cleanName(raw) {
  let name = String(raw || '').replace(/[^a-zA-Z0-9_]/g, '_');
  if (name.length < 2) name = 'emoji';
  return name.slice(0, 32);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('emojiall')
    .setDescription('Botun Developer Portal emojilerinin hepsini bu sunucuya emoji olarak aktarir')
    .setDefaultMemberPermissions(EMOJI_PERM),

  async execute(interaction) {
    const me = interaction.guild.members.me;
    if (!me.permissions.has(EMOJI_PERM)) {
      return interaction.reply({ embeds: [errorEmbed('Botun **Emoji ve Cikartmalari Yonet** yetkisi yok.')], ephemeral: true });
    }

    await interaction.deferReply();

    // Botun (uygulamanin) kendi emojileri: Developer Portal > Uygulama > Emojis
    let appEmojis;
    try {
      const appId = interaction.client.application.id;
      const data = await interaction.client.rest.get(`/applications/${appId}/emojis`);
      appEmojis = Array.isArray(data) ? data : data.items || [];
    } catch (err) {
      console.error('[EMOJIALL] liste alinamadi', err.message);
      return interaction.editReply({ embeds: [errorEmbed(`Botun emoji listesi alinamadi: ${err.message}`)] });
    }

    if (!appEmojis.length) {
      return interaction.editReply({
        embeds: [warningEmbed('Emoji Yok', 'Botun Developer Portal\'da hic emojisi yok. Discord Developer Portal > uygulaman > **Emojis** kismindan ekleyebilirsin.')],
      });
    }

    // Ayni isimde emoji zaten varsa tekrar ekleme.
    await interaction.guild.emojis.fetch().catch(() => {});
    const existing = new Set(interaction.guild.emojis.cache.map(e => e.name.toLowerCase()));

    const started = Date.now();
    const stats = { added: [], skipped: [], failed: [], noSlot: 0, timedOut: 0 };
    let staticFull = false;
    let animatedFull = false;

    for (let i = 0; i < appEmojis.length; i++) {
      const item = appEmojis[i];
      const name = cleanName(item.name);

      if (Date.now() - started > MAX_RUNTIME_MS) {
        stats.timedOut = appEmojis.length - i;
        break;
      }
      if (existing.has(name.toLowerCase())) {
        stats.skipped.push(name);
        continue;
      }
      if ((item.animated && animatedFull) || (!item.animated && staticFull)) {
        stats.noSlot++;
        continue;
      }

      try {
        const emoji = await interaction.guild.emojis.create({
          attachment: `https://cdn.discordapp.com/emojis/${item.id}.${item.animated ? 'gif' : 'png'}`,
          name,
          reason: `/emojiall: ${interaction.user.tag}`,
        });
        existing.add(name.toLowerCase());
        stats.added.push(emoji.toString());
      } catch (err) {
        if (err.code === 30008) {
          staticFull = true;
          stats.noSlot++;
        } else if (err.code === 30018) {
          animatedFull = true;
          stats.noSlot++;
        } else {
          console.error('[EMOJIALL]', name, err.code || '', err.message);
          stats.failed.push(`${name} (${err.message.split('\n')[0].slice(0, 60)})`);
        }
      }

      if ((i + 1) % PROGRESS_EVERY === 0) {
        await interaction.editReply({ content: `⏳ Aktariliyor... ${i + 1}/${appEmojis.length} (${stats.added.length} eklendi)` }).catch(() => {});
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('Emoji Aktarimi Bitti')
      .setColor(stats.added.length ? 0x57f287 : 0xfee75c)
      .addFields(
        { name: '✅ Eklenen', value: String(stats.added.length), inline: true },
        { name: '➖ Zaten Vardi', value: String(stats.skipped.length), inline: true },
        { name: '🚫 Slot Dolu', value: String(stats.noSlot), inline: true },
      );

    if (stats.added.length) embed.setDescription(stats.added.join(' ').slice(0, 4000));
    if (stats.failed.length) embed.addFields({ name: '❌ Hata Verenler', value: stats.failed.join('\n').slice(0, 1000) });
    if (stats.noSlot) {
      embed.addFields({ name: 'Slot Dolu', value: `${staticFull ? 'Normal' : ''}${staticFull && animatedFull ? ' ve ' : ''}${animatedFull ? 'hareketli' : ''} emoji slotlari doldu. Sunucu seviyesi arttikca slot artar.` });
    }
    if (stats.timedOut) {
      embed.addFields({ name: '⏱️ Zaman Doldu', value: `${stats.timedOut} emoji aktarilamadi (Discord emoji hiz siniri). Komutu tekrar calistirirsan kalanlar eklenir, mevcutlar atlanir.` });
    }

    await interaction.editReply({ content: '', embeds: [embed] });
  },
};