const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { errorEmbed, successEmbed } = require('../utils/embeds');

// Eski discord.js surumlerinde yetki bayragi adi farkli olabilir.
const EMOJI_PERM = PermissionFlagsBits.ManageGuildExpressions ?? PermissionFlagsBits.ManageEmojisAndStickers;

const MAX_BYTES = 256 * 1024; // Discord emoji dosya siniri
const ALLOWED = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif' };
const EXT_TO_TYPE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };

// Discord emoji adlari sadece harf, rakam ve alt cizgi icerebilir (2-32 karakter).
function cleanName(raw) {
  let name = String(raw || '').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (name.length < 2) name = 'emoji';
  return name.slice(0, 32);
}

// Ek dosyasinin turunu bulur (Discord'un verdigi tur, yoksa uzantidan).
function detectType(attachment) {
  const declared = (attachment.contentType || '').split(';')[0].toLowerCase();
  if (ALLOWED[declared]) return declared;
  const ext = (attachment.name || '').split('.').pop().toLowerCase();
  return EXT_TO_TYPE[ext] || null;
}

function apiErrorText(err) {
  if (err.code === 30008) return 'Sunucunun **normal emoji** slotlari dolu.';
  if (err.code === 30018) return 'Sunucunun **hareketli emoji (GIF)** slotlari dolu.';
  if (err.code === 50013 || err.code === 50001) return 'Botun emoji ekleme yetkisi yok (**Emoji ve Cikartmalari Yonet**).';
  if (err.code === 50035) return `Discord gorseli kabul etmedi: ${err.message.split('\n')[0]}`;
  return err.message;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('emoji')
    .setDescription('Emoji islemleri')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Gonderdigin resmi sunucuya emoji olarak ekler')
        .addAttachmentOption(opt => opt.setName('gorsel').setDescription('PNG, JPG veya GIF (en fazla 256 KB)').setRequired(true))
        .addStringOption(opt =>
          opt.setName('isim').setDescription('Emoji adi (bos birakirsan dosya adindan alinir)').setRequired(false).setMinLength(2).setMaxLength(32)))
    .setDefaultMemberPermissions(EMOJI_PERM),

  async execute(interaction) {
    if (interaction.options.getSubcommand() !== 'add') return;

    const attachment = interaction.options.getAttachment('gorsel');
    const type = detectType(attachment);

    if (!type) {
      return interaction.reply({ embeds: [errorEmbed('Sadece **PNG, JPG veya GIF** gorseller emoji olabilir.')], ephemeral: true });
    }
    if (attachment.size > MAX_BYTES) {
      return interaction.reply({
        embeds: [errorEmbed(
          `Dosya cok buyuk: **${Math.ceil(attachment.size / 1024)} KB** (sinir 256 KB). ` +
          'Gorseli 128x128 piksele kucultup tekrar dene (ornek: squoosh.app veya Discord\'a yuklemeden once bir resim kucultucu).',
        )],
        ephemeral: true,
      });
    }

    const me = interaction.guild.members.me;
    if (!me.permissions.has(EMOJI_PERM)) {
      return interaction.reply({ embeds: [errorEmbed('Botun **Emoji ve Cikartmalari Yonet** yetkisi yok.')], ephemeral: true });
    }

    const name = cleanName(interaction.options.getString('isim') || attachment.name);
    await interaction.deferReply();

    try {
      const emoji = await interaction.guild.emojis.create({
        attachment: attachment.url,
        name,
        reason: `/emoji add: ${interaction.user.tag}`,
      });
      await interaction.editReply({
        embeds: [successEmbed('Emoji Eklendi', `${emoji} \`:${emoji.name}:\` sunucuya eklendi${emoji.animated ? ' (hareketli)' : ''}.`)],
      });
    } catch (err) {
      console.error('[EMOJI ADD]', err.code || '', err.message);
      await interaction.editReply({ embeds: [errorEmbed(`Emoji eklenemedi: ${apiErrorText(err)}`)] });
    }
  },

  cleanName,
  detectType,
  apiErrorText,
};