const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const { permissionDeniedEmbed, errorEmbed } = require('./embeds');
const { formatRemaining } = require('./formatDuration');
const events = require('./events');

const LIVE = ['scheduled', 'sending', 'active'];
const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const trunc = (text, max = 900) => {
  const t = String(text || '');
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
};

function statusLabel(ev) {
  if (ev.status === 'scheduled') return '⏳ Bekliyor';
  if (ev.status === 'sending') return '📤 Gonderiliyor';
  return '🟢 Aktif (kazanan bekleniyor)';
}

function unix(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

// ---------- LISTE ----------
async function buildListView(guildId, note = '') {
  const list = (await events.listEvents(guildId)).slice(0, 25);

  const embed = new EmbedBuilder().setTitle('Eventler').setColor(0x5865f2);

  if (!list.length) {
    embed.setDescription('Bekleyen veya aktif event yok. `/setevent` ile yeni event kurabilirsin.');
    return { content: note, embeds: [embed], components: [] };
  }

  embed.setDescription('Duzenlemek veya silmek icin asagidaki menuden bir event sec.');
  list.forEach((ev, i) => {
    const when = ev.status === 'active'
      ? `Kanal: <#${ev.activeChannelId}>`
      : `Gonderilme: <t:${unix(ev.sendAt)}:R>`;
    embed.addFields({
      name: `#${i + 1} • ${trunc(ev.word, 60)} • ${statusLabel(ev)}`,
      value: `${when}\nKanallar: ${ev.channelIds.map(id => `<#${id}>`).join(', ')}`,
    });
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('evl_select')
    .setPlaceholder('Bir event sec...')
    .addOptions(
      list.map((ev, i) => ({
        label: trunc(`#${i + 1} • ${ev.word}`, 100),
        description: ev.status === 'active'
          ? 'Aktif - kazanan bekleniyor'
          : `${formatRemaining(new Date(ev.sendAt).getTime() - Date.now())} sonra • ${ev.channelIds.length} kanal`,
        value: ev._id.toString(),
      })),
    );

  return { content: note, embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

// ---------- DETAY ----------
function buildDetailView(ev, note = '') {
  const embed = new EmbedBuilder()
    .setTitle(`Event • ${trunc(ev.word, 80)}`)
    .setColor(ev.status === 'active' ? 0x57f287 : 0xe67e22)
    .addFields({ name: 'Durum', value: statusLabel(ev) });

  if (ev.status === 'active') {
    embed.addFields({ name: 'Atildigi Kanal', value: `<#${ev.activeChannelId}>` });
  } else {
    embed.addFields(
      { name: 'Gonderilme Zamani', value: `<t:${unix(ev.sendAt)}:F> (<t:${unix(ev.sendAt)}:R>)` },
      { name: 'Kanallar (biri rastgele secilir)', value: ev.channelIds.map(id => `<#${id}>`).join(', ') },
    );
  }

  embed.addFields(
    { name: 'Event Mesaji', value: trunc(`${ev.announcement}\n**${ev.word}**`) },
    { name: 'Kazanan Mesaji', value: trunc(ev.winMessage) },
  );

  const busy = ev.status === 'sending';
  const id = ev._id.toString();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`evl_edit_${id}`).setLabel('Duzenle').setEmoji('✏️').setStyle(ButtonStyle.Primary).setDisabled(busy),
    new ButtonBuilder().setCustomId(`evl_del_${id}`).setLabel('Sil').setEmoji('🗑️').setStyle(ButtonStyle.Danger).setDisabled(busy),
    new ButtonBuilder().setCustomId('evl_back').setLabel('Listeye Don').setStyle(ButtonStyle.Secondary),
  );

  return { content: note, embeds: [embed], components: [row] };
}

function buildDeleteConfirm(ev) {
  const embed = new EmbedBuilder()
    .setTitle('Event Silinsin mi?')
    .setColor(0xed4245)
    .setDescription(
      `**${trunc(ev.word, 80)}** eventi silinecek.` +
      (ev.status === 'active' ? '\nEvent aktif: kanala atilmis mesaj kalir ama artik kazanan secilmez.' : ''),
    );
  const id = ev._id.toString();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`evl_delok_${id}`).setLabel('Evet, Sil').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`evl_view_${id}`).setLabel('Vazgec').setStyle(ButtonStyle.Secondary),
  );
  return { content: '', embeds: [embed], components: [row] };
}

function buildEditModal(ev) {
  const modal = new ModalBuilder().setCustomId(`evl_modal_${ev._id.toString()}`).setTitle('Event Duzenle');
  const input = (id, label, style, value, required, max, placeholder) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
    if (value) t.setValue(value);
    if (placeholder) t.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(t);
  };

  if (ev.status === 'active') {
    // Mesaj zaten atildi: sadece kelime ve kazanan mesaji degistirilebilir.
    modal.addComponents(
      input('kelime', 'Kelime', TextInputStyle.Short, ev.word, true, 100),
      input('kazanan', 'Kazanan Mesaji', TextInputStyle.Paragraph, ev.winMessage, true, 1500),
    );
  } else {
    modal.addComponents(
      input('mesaj', 'Event Mesaji', TextInputStyle.Paragraph, ev.announcement, true, 1500),
      input('kelime', 'Kelime', TextInputStyle.Short, ev.word, true, 100),
      input('kazanan', 'Kazanan Mesaji', TextInputStyle.Paragraph, ev.winMessage, true, 1500),
      input('sure', 'Yeni sure (bos = degismez)', TextInputStyle.Short, '', false, 40, 'Ornek: 30s, 1m, 2h, 1d, 1h30m'),
      input('kanallar', 'Kanal ID veya etiketleri (max 5)', TextInputStyle.Paragraph, ev.channelIds.join(' '), true, 400),
    );
  }
  return modal;
}

// Yetkisiz/silinmis/artik bitmis eventler icin ortak kontrol.
async function loadLiveEvent(interaction, idString) {
  const ev = await events.getEvent(idString);
  if (!ev || ev.guildId !== interaction.guild.id || !LIVE.includes(ev.status)) return null;
  return ev;
}

// ---------- ETKILESIMLER ----------
// interactionCreate.js bunu cagirir; ilgili bir etkilesimse true doner.
async function handleEventInteraction(interaction) {
  const customId = interaction.customId;
  if (typeof customId !== 'string' || !customId.startsWith('evl_')) return false;

  if (!interaction.inGuild() || !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true }).catch(() => {});
    return true;
  }

  const guildId = interaction.guild.id;
  const gone = () => buildListView(guildId, '⚠️ Bu event artik yok veya tamamlandi.');

  // Listeden event secildi
  if (interaction.isStringSelectMenu() && customId === 'evl_select') {
    const ev = await loadLiveEvent(interaction, interaction.values[0]);
    await interaction.update(ev ? buildDetailView(ev) : await gone());
    return true;
  }

  // Listeye don
  if (interaction.isButton() && customId === 'evl_back') {
    await interaction.update(await buildListView(guildId));
    return true;
  }

  if (interaction.isButton()) {
    const match = /^evl_(edit|del|delok|view)_(.+)$/.exec(customId);
    if (!match) return true;
    const [, action, idString] = match;
    const ev = await loadLiveEvent(interaction, idString);

    if (!ev) {
      await interaction.update(await gone());
      return true;
    }
    if (ev.status === 'sending' && action !== 'view') {
      await interaction.update(buildDetailView(ev, '⚠️ Event su an gonderiliyor, birkac saniye sonra tekrar dene.'));
      return true;
    }

    if (action === 'view') {
      await interaction.update(buildDetailView(ev, ''));
      return true;
    }
    if (action === 'edit') {
      await interaction.showModal(buildEditModal(ev));
      return true;
    }
    if (action === 'del') {
      await interaction.update(buildDeleteConfirm(ev));
      return true;
    }

    if (action === 'delok') {
      const ok = await events.deleteEvent(ev);
      await interaction.update(await buildListView(guildId, ok ? '🗑️ Event silindi.' : '⚠️ Event silinemedi (durumu degismis olabilir).'));
      return true;
    }
    return true;
  }

  // Duzenleme formu gonderildi
  if (interaction.isModalSubmit() && customId.startsWith('evl_modal_')) {
    const ev = await loadLiveEvent(interaction, customId.replace('evl_modal_', ''));
    const fail = text => interaction.reply({ embeds: [errorEmbed(text)], ephemeral: true });

    if (!ev || ev.status === 'sending') {
      await fail('Bu event artik duzenlenemiyor (tamamlandi, silindi veya su an gonderiliyor).');
      return true;
    }

    const get = id => interaction.fields.getTextInputValue(id);
    const word = get('kelime').trim();
    const winMessage = get('kazanan').replace(/\\n/g, '\n');
    if (!word) {
      await fail('Kelime bos olamaz.');
      return true;
    }

    const fields = { word, winMessage };

    if (ev.status === 'scheduled') {
      fields.announcement = get('mesaj').replace(/\\n/g, '\n');

      const sure = get('sure').trim();
      if (sure) {
        const ms = events.parseEventDuration(sure);
        if (ms === null || ms < events.MIN_DURATION_MS || ms > events.MAX_DURATION_MS) {
          await fail('Gecersiz sure. Ornekler: `30s`, `1m`, `2h`, `1d`, `1h30m` (en az 1 saniye, en fazla 30 gun).');
          return true;
        }
        fields.sendAt = new Date(Date.now() + ms);
      }

      const ids = [...new Set(get('kanallar').match(/\d{17,20}/g) || [])].slice(0, 5);
      const me = interaction.guild.members.me;
      const channels = ids.map(id => interaction.guild.channels.cache.get(id));
      if (!ids.length || channels.some(c => !c || !TEXT_TYPES.includes(c.type))) {
        await fail('Kanallardan biri bulunamadi veya yazi kanali degil. Kanal ID\'lerini (veya #etiketlerini) bosluk birakarak yaz.');
        return true;
      }
      const noPerm = channels.filter(c => !c.permissionsFor(me)?.has(['ViewChannel', 'SendMessages']));
      if (noPerm.length) {
        await fail(`Botun su kanallarda mesaj yazma yetkisi yok: ${noPerm.map(c => `<#${c.id}>`).join(', ')}`);
        return true;
      }
      fields.channelIds = channels.map(c => c.id);
    }

    const ok = await events.updateEvent(ev, fields);
    if (!ok) {
      await fail('Event arada degismis (gonderilmis veya silinmis olabilir). Listeyi yenile.');
      return true;
    }

    // Aktif eventte kelime degistiyse kanaldaki mesaji da guncelle.
    if (ev.status === 'active' && word !== ev.word) {
      const channel = interaction.guild.channels.cache.get(ev.activeChannelId);
      const msg = channel ? await channel.messages.fetch(ev.messageId).catch(() => null) : null;
      if (msg) await msg.edit({ content: `${ev.announcement}\n**${word}**` }).catch(() => {});
    }

    const updated = await events.getEvent(ev._id.toString());
    const view = buildDetailView(updated, '✅ Event guncellendi.');
    await (interaction.isFromMessage() ? interaction.update(view) : interaction.reply({ ...view, ephemeral: true }));
    return true;
  }

  return true;
}

module.exports = { handleEventInteraction, buildListView };