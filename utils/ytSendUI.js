const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { permissionDeniedEmbed, errorEmbed, warningEmbed } = require('./embeds');
const { getYtConfig, fetchFeed, announceVideo } = require('./youtube');

const trunc = (text, max) => (String(text).length > max ? `${String(text).slice(0, max - 3)}...` : String(text));

// Izlenen YouTube kanallarindan birini sectiren menu.
function buildPicker(config) {
  const embed = new EmbedBuilder()
    .setTitle('Son Videoyu Gonder')
    .setColor(0xff0000)
    .setDescription('Son yuklenen videosunu duyuru kanalina gondermek istedigin YouTube kanalini sec.');

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ytsend_select')
    .setPlaceholder('Bir YouTube kanali sec...')
    .addOptions(
      config.channels.map(c => ({
        label: trunc(c.title || c.channelId, 100),
        description: trunc(c.input && c.input !== c.title ? c.input : c.channelId, 100),
        value: c.channelId,
      })),
    );

  return { content: '', embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

function buildPreview(config, channelTitle, video) {
  const embed = new EmbedBuilder()
    .setTitle('Bu video gonderilsin mi?')
    .setColor(0xfee75c)
    .setDescription(`**${video.title}**\nhttps://www.youtube.com/watch?v=${video.id}`)
    .setImage(`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`)
    .addFields(
      { name: 'YouTube Kanali', value: channelTitle, inline: true },
      { name: 'Gonderilecek Kanal', value: `<#${config.announceChannelId}>`, inline: true },
    )
    .setFooter({ text: 'Onaylarsan duyuru kanalina @here ile atilir.' });

  if (video.published) {
    embed.addFields({ name: 'Yuklenme', value: `<t:${Math.floor(new Date(video.published).getTime() / 1000)}:R>`, inline: true });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ytsend_ok_${video.channelId}_${video.id}`).setLabel('Gonder').setEmoji('📣').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ytsend_cancel').setLabel('Iptal').setStyle(ButtonStyle.Secondary),
  );
  return { content: '', embeds: [embed], components: [row] };
}

const done = (embed) => ({ content: '', embeds: [embed], components: [] });

// interactionCreate.js bunu cagirir; ilgili bir etkilesimse true doner.
async function handleYtSendInteraction(interaction) {
  const customId = interaction.customId;
  if (typeof customId !== 'string' || !customId.startsWith('ytsend_')) return false;

  if (!interaction.inGuild() || !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true }).catch(() => {});
    return true;
  }

  try {
    if (interaction.isButton() && customId === 'ytsend_cancel') {
      await interaction.update(done(warningEmbed('Iptal Edildi', 'Hicbir sey gonderilmedi.')));
      return true;
    }

    const config = await getYtConfig(interaction.guild.id);
    const needConfig = () => interaction.update(done(errorEmbed('YouTube ayari bulunamadi. Once `/setyt` ile ayarla.')));
    if (!config?.channels?.length) {
      await needConfig();
      return true;
    }

    // 1) Kanal secildi: son videoyu bul, onizleme goster
    if (interaction.isStringSelectMenu() && customId === 'ytsend_select') {
      const entry = config.channels.find(c => c.channelId === interaction.values[0]);
      if (!entry) {
        await interaction.update(done(errorEmbed('Bu kanal artik listede yok. `/ytsend` komutunu tekrar calistir.')));
        return true;
      }

      await interaction.deferUpdate();
      let feed;
      try {
        feed = await fetchFeed(entry.channelId);
      } catch (err) {
        await interaction.editReply(done(errorEmbed(`**${entry.title}** videolari alinamadi: ${err.message}`)));
        return true;
      }
      if (!feed.videos.length) {
        await interaction.editReply(done(warningEmbed('Video Yok', `**${feed.title || entry.title}** kanalinda video bulunamadi.`)));
        return true;
      }

      const video = { ...feed.videos[0], channelId: entry.channelId };
      await interaction.editReply(buildPreview(config, feed.title || entry.title, video));
      return true;
    }

    // 2) Onaylandi: gonder
    const match = /^ytsend_ok_(UC[\w-]{22})_(.+)$/.exec(customId);
    if (interaction.isButton() && match) {
      const [, channelId, videoId] = match;
      const entry = config.channels.find(c => c.channelId === channelId);
      if (!entry) {
        await interaction.update(done(errorEmbed('Bu kanal artik listede yok.')));
        return true;
      }

      await interaction.deferUpdate();
      let feed;
      try {
        feed = await fetchFeed(channelId);
      } catch (err) {
        await interaction.editReply(done(errorEmbed(`Video bilgisi alinamadi: ${err.message}`)));
        return true;
      }
      const video = feed.videos.find(v => v.id === videoId) || feed.videos[0];
      if (!video) {
        await interaction.editReply(done(errorEmbed('Video bulunamadi.')));
        return true;
      }

      try {
        await announceVideo(interaction.guild, config, entry, feed.title || entry.title, video);
        await interaction.editReply(done(new EmbedBuilder().setTitle('Gonderildi').setColor(0x57f287).setDescription(`**${video.title}** videosu <#${config.announceChannelId}> kanalina gonderildi.`)));
      } catch (err) {
        await interaction.editReply(done(errorEmbed(`Gonderilemedi: ${err.message}`)));
      }
      return true;
    }
  } catch (err) {
    console.error('[YTSEND]', err);
    await interaction.reply({ embeds: [errorEmbed('Bir hata olustu.')], ephemeral: true }).catch(() => {});
  }
  return true;
}

module.exports = { buildPicker, handleYtSendInteraction };