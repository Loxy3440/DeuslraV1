const {
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { permissionDeniedEmbed, errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');
const {
  getConfig,
  setConfig,
  upsertAutoResponse,
  removeAutoResponse,
  upsertMentionTrigger,
  removeMentionTrigger,
  upsertActivityTrigger,
  upsertChannelBip,
  removeChannelBip,
} = require('../utils/guildConfig');
const { getWarns } = require('../utils/warns');
const { getActivityConfig, setActivityConfig, addActivity, removeActivity, isStreamUrl } = require('../utils/activityConfig');
const { startActivityRotation } = require('../utils/activityRotator');
const { removeTempRole } = require('../utils/tempRoles');
const { clearActiveTimer } = require('../utils/activeTimers');
const { handleEventInteraction } = require('../utils/eventListUI');
const { handleInviteInteraction } = require('../utils/inviteUI');
const { handleYtSendInteraction } = require('../utils/ytSendUI');
const { logAction, logCommand, describeOptions } = require('../utils/modLog');
const { handlePartnerInteraction } = require('../utils/partner');
const { handleAskPermInteraction } = require('../utils/askPerm');
const { handleRoleGroupsInteraction } = require('../utils/roleGroups');
const { handleTriggerRolesInteraction } = require('../utils/triggerRoles');
// Sadece web panelinde sekmesi olan ayarlar Discord'da kapalı; diğer ayar komutları (autorole, askperm,
// setnick, setklan, setyt, settag, channelbip, vcc, setlog...) Discord'da normal çalışır.
const WEB_ONLY_SETTINGS = new Set([
  'auto', 'mention', 'setmention', 'setactivity', 'setdurum', 'setroles',
]);

module.exports = {
  name: 'interactionCreate',
  once: false,
  async execute(interaction) {
    // ---------- SLASH KOMUTLARI ----------
    if (interaction.isChatInputCommand()) {
      if (WEB_ONLY_SETTINGS.has(interaction.commandName)) {
        await interaction.reply({
          content: 'Bu ayar yalnızca Deuslra Gardiyan web panelinden yönetilebilir.',
          ephemeral: true,
        }).catch(() => {});
        return;
      }

      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
        logCommand(interaction.guild, { name: interaction.commandName, user: interaction.user, optionsText: describeOptions(interaction.options?.data) });
      } catch (err) {
        console.error(err);
        const payload = { embeds: [errorEmbed('Komut calistirilirken bir hata olustu.')], ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    // ---------- /eventlist (liste / duzenle / sil) ----------
    if (await handleEventInteraction(interaction)) return;

    // ---------- /invites (detay sayfalari) ----------
    if (await handleInviteInteraction(interaction)) return;

    // ---------- /ytsend (kanal sec, onayla, gonder) ----------
    if (await handleYtSendInteraction(interaction)) return;

    // ---------- /askperm (bot ekleme / rol verme izni) ----------
    if (await handlePartnerInteraction(interaction)) return;

    if (await handleAskPermInteraction(interaction)) return;

    // ---------- /setroles (rol grupları) ve /auto /setmention rol sınırı ----------
    if (await handleRoleGroupsInteraction(interaction)) return;
    if (await handleTriggerRolesInteraction(interaction)) return;

    // ---------- HELP DROPDOWN MENUSU ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'help_category') {
      const helpCommand = interaction.client.commands.get('help');
      const selected = interaction.values[0];
      const embed = selected === 'return' ? helpCommand.mainEmbed() : helpCommand.categoryEmbed(selected);
      return interaction.update({ embeds: [embed] });
    }

    // ---------- AUTO MENUSU (dropdown) ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'auto_menu') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true });
      }

      const selected = interaction.values[0];

      // Otomatik cevap ekle/guncelle -> tetikleyici + cevap metni icin modal
      if (selected === 'add_autoresponse') {
        const modal = new ModalBuilder()
          .setCustomId('auto_modal_addresponse')
          .setTitle('Otomatik Cevap Ekle');

        const triggerInput = new TextInputBuilder()
          .setCustomId('trigger_text')
          .setLabel('Tetikleyici (biri tam olarak bunu yazinca)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder('ornek: hi');

        const responseInput = new TextInputBuilder()
          .setCustomId('response_text')
          .setLabel('Bot cevabi (bos birakilabilir)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setPlaceholder('ornek: Hello');

        const cooldownInput = new TextInputBuilder()
          .setCustomId('cooldown_text')
          .setLabel('Bekleme suresi - saniye (bos=3)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(3)
          .setPlaceholder('ornek: 3');

        modal.addComponents(
          new ActionRowBuilder().addComponents(triggerInput),
          new ActionRowBuilder().addComponents(responseInput),
          new ActionRowBuilder().addComponents(cooldownInput),
        );
        return interaction.showModal(modal);
      }

      // Otomatik cevap sil -> mevcut tetikleyicilerden secilecek bir menu goster
      if (selected === 'remove_autoresponse') {
        const config = await getConfig(interaction.guild.id);
        if (!config.autoResponses.length) {
          return interaction.reply({ embeds: [errorEmbed('Silinecek herhangi bir otomatik cevap yok.')], ephemeral: true });
        }

        const removeMenu = new StringSelectMenuBuilder()
          .setCustomId('auto_remove_select')
          .setPlaceholder('Silinecek tetikleyiciyi sec...')
          .addOptions(
            config.autoResponses.slice(0, 25).map(r => ({
              label: r.trigger.slice(0, 100),
              description: (r.response || '(sadece medya)').slice(0, 100),
              value: r.trigger.slice(0, 100),
            })),
          );

        return interaction.reply({ components: [new ActionRowBuilder().addComponents(removeMenu)], ephemeral: true });
      }

      // Tum otomatik cevaplari temizle -> once onay iste
      if (selected === 'clear_autoresponses') {
        const config = await getConfig(interaction.guild.id);
        const count = config.autoResponses.length;
        if (!count) {
          return interaction.reply({ embeds: [errorEmbed('Temizlenecek otomatik cevap yok.')], ephemeral: true });
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('auto_clear_yes').setLabel(`Evet, ${count} mesaji sil`).setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('auto_clear_no').setLabel('Vazgec').setStyle(ButtonStyle.Secondary),
        );
        return interaction.reply({
          content: `⚠️ **${count}** otomatik mesajin hepsi silinecek. Emin misin?`,
          components: [row],
          ephemeral: true,
        });
      }

      return;
    }

    // ---------- AUTO - MODAL (otomatik cevap ekle/guncelle) ----------
    if (interaction.isModalSubmit() && interaction.customId === 'auto_modal_addresponse') {
      const trigger = interaction.fields.getTextInputValue('trigger_text');
      const responseText = interaction.fields.getTextInputValue('response_text') || '';
      const cooldownRaw = interaction.fields.getTextInputValue('cooldown_text');
      const cooldownSeconds = Math.max(1, parseInt(cooldownRaw, 10) || 3);

      await interaction.reply({
        content: `Tetikleyici alindi: \`${trigger}\`.\nIstersen **60 saniye icinde bu kanala** bir gorsel veya video gonder, otomatik cevaba eklenecek. Eklemek istemiyorsan **"yok"** yaz.`,
        ephemeral: true,
      });

      const collected = await interaction.channel
        .awaitMessages({ filter: m => m.author.id === interaction.user.id, max: 1, time: 60_000, errors: [] })
        .catch(() => null);

      let mediaUrl = null;
      if (collected && collected.size) {
        const collectedMsg = collected.first();
        const attachment = collectedMsg.attachments.find(a => (a.contentType || '').startsWith('image/') || (a.contentType || '').startsWith('video/'));
        if (attachment) mediaUrl = attachment.url;
        await collectedMsg.delete().catch(() => {});
      }

      if (!responseText && !mediaUrl) {
        return interaction.followUp({ embeds: [errorEmbed('Ne metin ne de gecerli bir gorsel/video aldigim icin otomatik cevap kaydedilmedi.')], ephemeral: true });
      }

      await upsertAutoResponse(interaction.guild.id, trigger, responseText, mediaUrl, cooldownSeconds);

      await interaction.followUp({
        embeds: [successEmbed('Otomatik Cevap Kaydedildi', `\`${trigger}\` tetikleyicisi kaydedildi (bekleme: ${cooldownSeconds}sn).${mediaUrl ? ' (medya eklendi)' : ''}`)],
        ephemeral: true,
      });

      const autoCmd = interaction.client.commands.get('auto');
      const updated = await getConfig(interaction.guild.id);
      if (interaction.isFromMessage() && interaction.message) {
        await interaction.message.edit({ embeds: [autoCmd.buildStatusEmbed(updated)], components: [autoCmd.buildSelectRow()] }).catch(() => {});
      }
      return;
    }

    // ---------- AUTO - OTOMATIK CEVAP SILME MENUSU ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'auto_remove_select') {
      const trigger = interaction.values[0];
      await removeAutoResponse(interaction.guild.id, trigger);

      return interaction.update({
        content: `Otomatik cevap silindi: \`${trigger}\``,
        components: [],
      });
    }

    // ---------- AUTO - HEPSINI TEMIZLE (onay butonlari) ----------
    if (interaction.isButton() && (interaction.customId === 'auto_clear_yes' || interaction.customId === 'auto_clear_no')) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true });
      }

      if (interaction.customId === 'auto_clear_no') {
        return interaction.update({ content: 'Vazgecildi, hiçbir şey silinmedi.', components: [] });
      }

      await setConfig(interaction.guild.id, { autoResponses: [] });
      return interaction.update({ content: '🧹 Tüm otomatik mesajlar silindi. `/auto` ile tekrar bakabilirsin.', components: [] });
    }

    // ---------- MENTION MENUSU (dropdown) ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'mention_menu') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true });
      }

      const selected = interaction.values[0];

      // Cevap metnini degistir -> modal
      if (selected === 'set_message') {
        const modal = new ModalBuilder()
          .setCustomId('mention_modal_setmessage')
          .setTitle('Etiketlenme Cevabi');

        const textInput = new TextInputBuilder()
          .setCustomId('mention_text')
          .setLabel('Bot cevabi (bos birakilabilir)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setPlaceholder('örnek: Merhaba {user}, nasıl yardımcı olabilirim?');

        modal.addComponents(new ActionRowBuilder().addComponents(textInput));
        return interaction.showModal(modal);
      }

      // Ac/Kapat
      if (selected === 'toggle') {
        const config = await getConfig(interaction.guild.id);
        await setConfig(interaction.guild.id, { mentionEnabled: !config.mentionEnabled });

        const updated = await getConfig(interaction.guild.id);
        const mentionCmd = interaction.client.commands.get('mention');
        return interaction.update({ embeds: [mentionCmd.buildStatusEmbed(updated)], components: [mentionCmd.buildSelectRow()] });
      }

      return;
    }

    // ---------- MENTION - MODAL (cevap metnini degistir) ----------
    if (interaction.isModalSubmit() && interaction.customId === 'mention_modal_setmessage') {
      const text = interaction.fields.getTextInputValue('mention_text') || '';

      await interaction.reply({
        content: 'Metin alindi.\nIstersen **60 saniye icinde bu kanala** bir gorsel veya video gonder, cevaba eklenecek. Eklemek istemiyorsan **"yok"** yaz.',
        ephemeral: true,
      });

      const collected = await interaction.channel
        .awaitMessages({ filter: m => m.author.id === interaction.user.id, max: 1, time: 60_000, errors: [] })
        .catch(() => null);

      let mediaUrl = null;
      if (collected && collected.size) {
        const collectedMsg = collected.first();
        const attachment = collectedMsg.attachments.find(a => (a.contentType || '').startsWith('image/') || (a.contentType || '').startsWith('video/'));
        if (attachment) mediaUrl = attachment.url;
        await collectedMsg.delete().catch(() => {});
      }

      await setConfig(interaction.guild.id, { mentionMessage: text, mentionMediaUrl: mediaUrl });

      await interaction.followUp({
        embeds: [successEmbed('Cevap Kaydedildi', `Etiketlenme cevabi guncellendi.${mediaUrl ? ' (medya eklendi)' : ''}`)],
        ephemeral: true,
      });

      const mentionCmd = interaction.client.commands.get('mention');
      const updated = await getConfig(interaction.guild.id);
      if (interaction.isFromMessage() && interaction.message) {
        await interaction.message.edit({ embeds: [mentionCmd.buildStatusEmbed(updated)], components: [mentionCmd.buildSelectRow()] }).catch(() => {});
      }
      return;
    }

    // ---------- SETMENTION MENUSU (dropdown) ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'setmention_menu') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true });
      }

      const selected = interaction.values[0];

      // Ozel cevap ekle/guncelle -> tetikleyici + cevap metni icin modal
      if (selected === 'add_mentiontrigger') {
        const modal = new ModalBuilder()
          .setCustomId('setmention_modal_addresponse')
          .setTitle('Ozel Etiketlenme Cevabi Ekle');

        const triggerInput = new TextInputBuilder()
          .setCustomId('trigger_text')
          .setLabel('Tetikleyici (etiketleyip bunu yazinca)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder('ornek: naber');

        const responseInput = new TextInputBuilder()
          .setCustomId('response_text')
          .setLabel('Bot cevabi (bos birakilabilir)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setPlaceholder('ornek: iyi');

        modal.addComponents(
          new ActionRowBuilder().addComponents(triggerInput),
          new ActionRowBuilder().addComponents(responseInput),
        );
        return interaction.showModal(modal);
      }

      // Ozel cevap sil -> mevcut tetikleyicilerden secilecek bir menu goster
      if (selected === 'remove_mentiontrigger') {
        const config = await getConfig(interaction.guild.id);
        if (!config.mentionTriggers.length) {
          return interaction.reply({ embeds: [errorEmbed('Silinecek herhangi bir özel etiketlenme cevabı yok.')], ephemeral: true });
        }

        const removeMenu = new StringSelectMenuBuilder()
          .setCustomId('setmention_remove_select')
          .setPlaceholder('Silinecek tetikleyiciyi sec...')
          .addOptions(
            config.mentionTriggers.slice(0, 25).map(r => ({
              label: r.trigger.slice(0, 100),
              description: r.response.slice(0, 100),
              value: r.trigger.slice(0, 100),
            })),
          );

        return interaction.reply({ components: [new ActionRowBuilder().addComponents(removeMenu)], ephemeral: true });
      }

      return;
    }

    // ---------- SETMENTION - MODAL (ozel cevap ekle/guncelle) ----------
    if (interaction.isModalSubmit() && interaction.customId === 'setmention_modal_addresponse') {
      const trigger = interaction.fields.getTextInputValue('trigger_text');
      const responseText = interaction.fields.getTextInputValue('response_text') || '';

      await interaction.reply({
        content: `Tetikleyici alindi: \`${trigger}\`.\nIstersen **60 saniye icinde bu kanala** bir gorsel veya video gonder, ozel cevaba eklenecek. Eklemek istemiyorsan **"yok"** yaz.`,
        ephemeral: true,
      });

      const collected = await interaction.channel
        .awaitMessages({ filter: m => m.author.id === interaction.user.id, max: 1, time: 60_000, errors: [] })
        .catch(() => null);

      let mediaUrl = null;
      if (collected && collected.size) {
        const collectedMsg = collected.first();
        const attachment = collectedMsg.attachments.find(a => (a.contentType || '').startsWith('image/') || (a.contentType || '').startsWith('video/'));
        if (attachment) mediaUrl = attachment.url;
        await collectedMsg.delete().catch(() => {});
      }

      if (!responseText && !mediaUrl) {
        return interaction.followUp({ embeds: [errorEmbed('Ne metin ne de gecerli bir gorsel/video aldigim icin ozel cevap kaydedilmedi.')], ephemeral: true });
      }

      await upsertMentionTrigger(interaction.guild.id, trigger, responseText, mediaUrl);

      await interaction.followUp({
        embeds: [successEmbed('Ozel Cevap Kaydedildi', `\`${trigger}\` tetikleyicisi kaydedildi.${mediaUrl ? ' (medya eklendi)' : ''}`)],
        ephemeral: true,
      });

      const setmentionCmd = interaction.client.commands.get('setmention');
      const updated = await getConfig(interaction.guild.id);
      if (interaction.isFromMessage() && interaction.message) {
        await interaction.message.edit({ embeds: [setmentionCmd.buildStatusEmbed(updated)], components: [setmentionCmd.buildSelectRow()] }).catch(() => {});
      }
      return;
    }

    // ---------- SETMENTION - OZEL CEVAP SILME MENUSU ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'setmention_remove_select') {
      const trigger = interaction.values[0];
      await removeMentionTrigger(interaction.guild.id, trigger);

      return interaction.update({
        content: `Özel etikletlenme cevabı silindi: \`${trigger}\``,
        components: [],
      });
    }

    // ---------- SETACTIVITY MENUSU (dropdown) ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'setactivity_menu') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true });
      }

      const selected = interaction.values[0];

      // Aktivite ekle -> once turunu sectir, sonra metin icin modal
      if (selected === 'add_activity') {
        const typeMenu = new StringSelectMenuBuilder()
          .setCustomId('setactivity_type_select')
          .setPlaceholder('Aktivite turunu sec...')
          .addOptions(
            { label: 'Oynuyor (Playing)', value: 'PLAYING', emoji: '🎮' },
            { label: 'Yayinda (Streaming)', value: 'STREAMING', emoji: '🔴' },
            { label: 'Izliyor (Watching)', value: 'WATCHING', emoji: '👀' },
            { label: 'Dinliyor (Listening)', value: 'LISTENING', emoji: '🎧' },
            { label: 'Yarisiyor (Competing)', value: 'COMPETING', emoji: '🏆' },
            { label: 'Ozel durum (yazi)', value: 'CUSTOM', emoji: '💬' },
          );

        return interaction.reply({
          content: 'Once aktivite turunu sec:',
          components: [new ActionRowBuilder().addComponents(typeMenu)],
          ephemeral: true,
        });
      }

      // Aktivite sil -> mevcut aktivitelerden secilecek bir menu goster
      if (selected === 'remove_activity') {
        const config = await getActivityConfig();
        if (!config.list.length) {
          return interaction.reply({ embeds: [errorEmbed('Silinecek herhangi bir aktivite yok.')], ephemeral: true });
        }

        const setactivityCmd = interaction.client.commands.get('setactivity');
        const removeMenu = new StringSelectMenuBuilder()
          .setCustomId('setactivity_remove_select')
          .setPlaceholder('Silinecek aktiviteyi sec...')
          .addOptions(
            config.list.slice(0, 25).map((a, i) => ({
              label: `${setactivityCmd.TYPE_LABELS[a.type] || a.type} - ${a.text}`.slice(0, 100),
              value: String(i),
            })),
          );

        return interaction.reply({ components: [new ActionRowBuilder().addComponents(removeMenu)], ephemeral: true });
      }

      // Gecis suresini ayarla -> modal
      if (selected === 'set_interval') {
        const modal = new ModalBuilder()
          .setCustomId('setactivity_modal_interval')
          .setTitle('Gecis Suresi');

        const input = new TextInputBuilder()
          .setCustomId('interval_seconds')
          .setLabel('Kac saniyede bir degissin?')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(6)
          .setPlaceholder('ornek: 15');

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      return;
    }

    // ---------- SETACTIVITY - TUR SECIMI (ekleme akisinin 2. adimi) ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'setactivity_type_select') {
      const type = interaction.values[0];

      const modal = new ModalBuilder()
        .setCustomId(`setactivity_modal_addtext_${type}`)
        .setTitle('Aktivite Metni');

      const textInput = new TextInputBuilder()
        .setCustomId('activity_text')
        .setLabel('Aktivite metni')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setPlaceholder('ornek: /help   veya   {uye} uye (anlik uye sayisi)');

      modal.addComponents(new ActionRowBuilder().addComponents(textInput));

      // Yayinda (Streaming) icin Twitch/YouTube adresi de gerekir; yoksa Discord yayin gostergesini vermez.
      if (type === 'STREAMING') {
        const urlInput = new TextInputBuilder()
          .setCustomId('activity_url')
          .setLabel('Twitch veya YouTube adresi')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(200)
          .setPlaceholder('https://www.twitch.tv/kullanici');
        modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
      }
      return interaction.showModal(modal);
    }

    // ---------- SETACTIVITY - MODAL (aktivite metnini kaydet) ----------
    if (interaction.isModalSubmit() && interaction.customId.startsWith('setactivity_modal_addtext_')) {
      const type = interaction.customId.replace('setactivity_modal_addtext_', '');
      const text = interaction.fields.getTextInputValue('activity_text');
      let url = null;
      if (type === 'STREAMING') {
        url = interaction.fields.getTextInputValue('activity_url').trim();
        if (!isStreamUrl(url)) {
          return interaction.reply({ embeds: [errorEmbed('Yayın adresi `https://twitch.tv/...` veya `https://youtube.com/...` şeklinde olmalı.')], ephemeral: true });
        }
      }

      await addActivity(type, text, url);
      await startActivityRotation(interaction.client);

      const setactivityCmd = interaction.client.commands.get('setactivity');
      return interaction.reply({
        embeds: [successEmbed('Aktivite Eklendi', `**${setactivityCmd.TYPE_LABELS[type] || type}** - ${text} eklendi.\nGüncel listeyi gormek icin /setactivity komutunu tekrar calistir.`)],
        ephemeral: true,
      });
    }

    // ---------- SETACTIVITY - AKTIVITE SILME MENUSU ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'setactivity_remove_select') {
      const index = parseInt(interaction.values[0], 10);
      await removeActivity(index);
      await startActivityRotation(interaction.client);

      return interaction.update({ content: 'Aktivite silindi.', components: [] });
    }

    // ---------- SETACTIVITY - MODAL (gecis suresi) ----------
    if (interaction.isModalSubmit() && interaction.customId === 'setactivity_modal_interval') {
      const raw = interaction.fields.getTextInputValue('interval_seconds');
      const seconds = parseInt(raw, 10);

      if (!seconds || seconds < 5) {
        return interaction.reply({ embeds: [errorEmbed('Geçerli bir süre gir (en az 5 saniye).')], ephemeral: true });
      }

      await setActivityConfig({ intervalSeconds: seconds });
      await startActivityRotation(interaction.client);

      return interaction.reply({
        embeds: [successEmbed('Sure Güncellendi', `Geçiş süresi ${seconds} saniye olarak ayarlandı.`)],
        ephemeral: true,
      });
    }

    // ---------- AUTOROLE MENUSU (dropdown) ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'autorole_menu') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true });
      }

      const selected = interaction.values[0];

      if (selected === 'set_role_player') {
        const roleSelect = new RoleSelectMenuBuilder()
          .setCustomId('autorole_role_select_player')
          .setPlaceholder('Oyunculara verilecek rolü seç...');

        return interaction.update({ components: [new ActionRowBuilder().addComponents(roleSelect)] });
      }

      if (selected === 'set_role_bot') {
        const roleSelect = new RoleSelectMenuBuilder()
          .setCustomId('autorole_role_select_bot')
          .setPlaceholder('Botlara verilecek rolü seç...');

        return interaction.update({ components: [new ActionRowBuilder().addComponents(roleSelect)] });
      }

      if (selected === 'toggle') {
        const config = await getConfig(interaction.guild.id);
        await setConfig(interaction.guild.id, { autoRoleEnabled: !config.autoRoleEnabled });

        const updated = await getConfig(interaction.guild.id);
        const autoroleCmd = interaction.client.commands.get('autorole');
        return interaction.update({ embeds: [autoroleCmd.buildStatusEmbed(updated)], components: [autoroleCmd.buildSelectRow()] });
      }

      return;
    }

    // ---------- AUTOROLE ROL SECICI (oyuncu) ----------
    if (interaction.isRoleSelectMenu() && interaction.customId === 'autorole_role_select_player') {
      const roleId = interaction.values[0];
      await setConfig(interaction.guild.id, { autoRoleId: roleId });

      const updated = await getConfig(interaction.guild.id);
      const autoroleCmd = interaction.client.commands.get('autorole');
      return interaction.update({ embeds: [autoroleCmd.buildStatusEmbed(updated)], components: [autoroleCmd.buildSelectRow()] });
    }

    // ---------- AUTOROLE ROL SECICI (bot) ----------
    if (interaction.isRoleSelectMenu() && interaction.customId === 'autorole_role_select_bot') {
      const roleId = interaction.values[0];
      await setConfig(interaction.guild.id, { autoRoleBotId: roleId });

      const updated = await getConfig(interaction.guild.id);
      const autoroleCmd = interaction.client.commands.get('autorole');
      return interaction.update({ embeds: [autoroleCmd.buildStatusEmbed(updated)], components: [autoroleCmd.buildSelectRow()] });
    }

    // ---------- CHANNELBIP MENUSU (dropdown) ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'channelbip_menu') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true });
      }

      const selected = interaction.values[0];

      // Kanal ekle -> ID + mesaj icin modal
      if (selected === 'add') {
        const modal = new ModalBuilder().setCustomId('channelbip_modal_add').setTitle('Kanal Ekle');

        const idInput = new TextInputBuilder()
          .setCustomId('channelbip_id')
          .setLabel('Kanal ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32)
          .setPlaceholder('örnek: 123456789012345678');

        const messageInput = new TextInputBuilder()
          .setCustomId('channelbip_message')
          .setLabel('Mesaj (bos birakirsan sadece @user)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setPlaceholder('örnek: {user} sunucuya hoş geldin!');

        modal.addComponents(
          new ActionRowBuilder().addComponents(idInput),
          new ActionRowBuilder().addComponents(messageInput),
        );
        return interaction.showModal(modal);
      }

      // Kanal duzenle -> mevcut kanallardan secilecek bir menu goster
      if (selected === 'edit') {
        const config = await getConfig(interaction.guild.id);
        if (!config.channelBips.length) {
          return interaction.reply({ embeds: [errorEmbed('Düzenlenecek herhangi bir kanal yok.')], ephemeral: true });
        }

        const editMenu = new StringSelectMenuBuilder()
          .setCustomId('channelbip_edit_select')
          .setPlaceholder('Düzenlenecek kanali sec...')
          .addOptions(
            config.channelBips.slice(0, 25).map(c => ({
              label: `#${c.channelId}`.slice(0, 100),
              description: c.message.slice(0, 100),
              value: c.channelId,
            })),
          );

        return interaction.reply({ components: [new ActionRowBuilder().addComponents(editMenu)], ephemeral: true });
      }

      // Kanal sil -> mevcut kanallardan secilecek bir menu goster
      if (selected === 'remove') {
        const config = await getConfig(interaction.guild.id);
        if (!config.channelBips.length) {
          return interaction.reply({ embeds: [errorEmbed('Silinecek herhangi bir kanal yok.')], ephemeral: true });
        }

        const removeMenu = new StringSelectMenuBuilder()
          .setCustomId('channelbip_remove_select')
          .setPlaceholder('Silinecek kanali sec...')
          .addOptions(
            config.channelBips.slice(0, 25).map(c => ({
              label: `#${c.channelId}`.slice(0, 100),
              description: c.message.slice(0, 100),
              value: c.channelId,
            })),
          );

        return interaction.reply({ components: [new ActionRowBuilder().addComponents(removeMenu)], ephemeral: true });
      }

      return;
    }

    // ---------- CHANNELBIP - MODAL (kanal ekle) ----------
    if (interaction.isModalSubmit() && interaction.customId === 'channelbip_modal_add') {
      const channelId = interaction.fields.getTextInputValue('channelbip_id').trim();
      const message = interaction.fields.getTextInputValue('channelbip_message') || '{user}';

      const channel = interaction.guild.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) {
        return interaction.reply({ embeds: [errorEmbed('Bu ID ile bir metin kanalı bulunamadı. ID yi kontrol et.')], ephemeral: true });
      }

      await upsertChannelBip(interaction.guild.id, channelId, message);

      await interaction.reply({
        embeds: [successEmbed('Kanal Eklendi', `${channel} kanalı eklendi. Yeni üye katılınca buraya mesaj gidecek.`)],
        ephemeral: true,
      });

      const channelbipCmd = interaction.client.commands.get('channelbip');
      const updated = await getConfig(interaction.guild.id);
      if (interaction.isFromMessage() && interaction.message) {
        await interaction.message.edit({ embeds: [channelbipCmd.buildStatusEmbed(updated)], components: [channelbipCmd.buildSelectRow()] }).catch(() => {});
      }
      return;
    }

    // ---------- CHANNELBIP - DUZENLEME MENUSU (hangi kanal) ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'channelbip_edit_select') {
      const channelId = interaction.values[0];
      const config = await getConfig(interaction.guild.id);
      const entry = config.channelBips.find(c => c.channelId === channelId);

      const modal = new ModalBuilder().setCustomId(`channelbip_modal_edit_${channelId}`).setTitle('Kanal Mesajını Düzenle');

      const messageInput = new TextInputBuilder()
        .setCustomId('channelbip_message')
        .setLabel('Yeni mesaj')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
        .setValue(entry?.message || '{user}');

      modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
      return interaction.showModal(modal);
    }

    // ---------- CHANNELBIP - MODAL (kanal duzenle) ----------
    if (interaction.isModalSubmit() && interaction.customId.startsWith('channelbip_modal_edit_')) {
      const channelId = interaction.customId.replace('channelbip_modal_edit_', '');
      const message = interaction.fields.getTextInputValue('channelbip_message') || '{user}';

      await upsertChannelBip(interaction.guild.id, channelId, message);

      return interaction.reply({
        embeds: [successEmbed('Güncellendi', `<#${channelId}> için mesaj güncellendi.`)],
        ephemeral: true,
      });
    }

    // ---------- CHANNELBIP - SILME MENUSU ----------
    if (interaction.isStringSelectMenu() && interaction.customId === 'channelbip_remove_select') {
      const channelId = interaction.values[0];
      await removeChannelBip(interaction.guild.id, channelId);

      return interaction.update({ content: `Kanal kaldırıldı: <#${channelId}>`, components: [] });
    }

    // ---------- BANLIST YENILEME BUTONU ----------
    if (interaction.isButton() && interaction.customId === 'banlist_refresh') {
      await interaction.deferUpdate();

      const banlistCmd = interaction.client.commands.get('banlist');
      let result;
      try {
        result = await banlistCmd.buildBanListEmbed(interaction.guild);
      } catch {
        return interaction.followUp({ embeds: [errorEmbed('Yasaklı kullanıcılar alınırken bir hata oluştu.')], ephemeral: true });
      }

      if (result.empty) {
        return interaction.editReply({ embeds: [result.embed], components: [] });
      }

      return interaction.editReply({ embeds: [result.embed], components: [banlistCmd.buildRefreshRow()] });
    }

    // ---------- WARNLIST YENILEME BUTONU ----------
    if (interaction.isButton() && interaction.customId.startsWith('warnlist_refresh_')) {
      const userId = interaction.customId.replace('warnlist_refresh_', '');
      await interaction.deferUpdate();

      const user = await interaction.client.users.fetch(userId).catch(() => null);
      if (!user) return;

      const warns = await getWarns(interaction.guild.id, userId);
      const warnlistCmd = interaction.client.commands.get('warnlist');

      return interaction.editReply({ embeds: [warnlistCmd.buildEmbed(warns, user)] });
    }

    // ---------- ROL GERI AL / GERI VER BUTONLARI ----------
    if (interaction.isButton() && interaction.customId.startsWith('roltakeback_')) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true });
      }

      const [, userId, roleId] = interaction.customId.split('_');
      await interaction.deferUpdate();

      clearActiveTimer(`role_${interaction.guild.id}_${userId}_${roleId}`);

      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (member) {
        await member.roles.remove(roleId, `geri Al butonu - Yetkili: ${interaction.user.tag}`).catch(() => {});
      }
      await removeTempRole(interaction.guild.id, userId, roleId).catch(() => {});

      const disabledRow = disableButtons(interaction, 'Geri Alindi');
      const embed = successEmbed('Rol Geri Alındı', 'Rol başarıyla geri alındı.')
        .setFooter({ text: `İşlemi yapan: ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed], components: [disabledRow] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('rolgiveback_')) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true });
      }

      const [, userId, roleId] = interaction.customId.split('_');
      await interaction.deferUpdate();

      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (member) {
        await member.roles.add(roleId, `geri Ver butonu - Yetkili: ${interaction.user.tag}`).catch(() => {});
      }

      const disabledRow = disableButtons(interaction, 'Geri Verildi');
      const embed = successEmbed('Rol Geri Verildi', 'Rol başarıyla geri verildi.')
        .setFooter({ text: `İşlemi yapan: ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed], components: [disabledRow] });
    }

    // ---------- BOTU KAPATMA BUTONLARI ----------
    if (interaction.isButton() && (interaction.customId === 'closebot_confirm' || interaction.customId === 'closebot_cancel')) {
      if (interaction.user.id !== process.env.OWNER_ID) {
        return interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true });
      }

      const isConfirm = interaction.customId === 'closebot_confirm';

      const embed = successEmbed(
        isConfirm ? 'Bot kapatılıyor' : 'İşlem İptal Edildi',
        isConfirm ? 'Bot birazdan kapanacak.' : 'Bot çalışmaya devam ediyor.',
      ).setColor(isConfirm ? 0xed4245 : 0x5865f2);

      const disabledRow = disableButtons(interaction);
      await interaction.update({ embeds: [embed], components: [disabledRow] });

      if (isConfirm) {
        setTimeout(() => {
          interaction.client.destroy();
          process.exit(0);
        }, 1500);
      }
      return;
    }

    // ---------- BUTONLAR: UNBAN / UNMUTE / UNLOCK ----------
    if (!interaction.isButton()) return;

    const [action, targetId] = interaction.customId.split('_');

    if (action === 'unban') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true });
      }

      await interaction.deferUpdate();

      let banEntry;
      try {
        banEntry = await interaction.guild.bans.fetch(targetId);
      } catch {
        const disabledRow = disableButtons(interaction, 'Already Unbanned');
        return interaction.editReply({ embeds: [errorEmbed('Bu kullanıcı zaten yasaklı değil.')], components: [disabledRow] });
      }

      try {
        await interaction.guild.bans.remove(targetId, `unban butonu - Yetkili: ${interaction.user.tag}`);
      } catch {
        return interaction.followUp({ embeds: [errorEmbed('Yasak kaldırilirken bir hata oluştu.')], ephemeral: true });
      }

      logAction(interaction.guild, { action: 'unban', markKey: `ban:${interaction.guild.id}:${banEntry.user.id}`, target: banEntry.user, moderator: interaction.user, reason: 'Buton' });
      const disabledRow = disableButtons(interaction, 'Unbanned');
      const embed = successEmbed('Yasak kaldırıldı', `**${banEntry.user.tag}** artık sunucuya tekrar katılabilir.`)
        .setFooter({ text: `İşlemi yapan: ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed], components: [disabledRow] });
    }

    if (action === 'unmute') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true });
      }

      await interaction.deferUpdate();

      const member = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!member) {
        return interaction.followUp({ embeds: [errorEmbed('Bu üye artık sunucuda değil.')], ephemeral: true });
      }

      try {
        await member.timeout(null, `unmute butonu - Yetkili: ${interaction.user.tag}`);
      } catch {
        return interaction.followUp({ embeds: [errorEmbed('Susturma kaldırılırken bir hata oluştu.')], ephemeral: true });
      }

      clearActiveTimer(`mute_${interaction.guild.id}_${targetId}`);

      logAction(interaction.guild, { action: 'unmute', markKey: `mute:${interaction.guild.id}:${member.id}`, target: member, moderator: interaction.user, reason: 'Buton' });
      const disabledRow = disableButtons(interaction, 'Unmuted');
      const embed = successEmbed('Susturma Kaldırıldı', `**${member.user.tag}** artık tekrar konusabilir.`)
        .setFooter({ text: `İşlemi yapan: ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed], components: [disabledRow] });
    }

    if (action === 'unlock') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({ embeds: [permissionDeniedEmbed()], ephemeral: true });
      }

      await interaction.deferUpdate();

      const channel = interaction.guild.channels.cache.get(targetId);
      if (!channel) {
        return interaction.followUp({ embeds: [errorEmbed('Kanal bulunamadı.')], ephemeral: true });
      }

      try {
        await channel.permissionOverwrites.edit(
          interaction.guild.roles.everyone,
          { SendMessages: null },
          { reason: `unlock butonu - Yetkili: ${interaction.user.tag}` },
        );
      } catch {
        return interaction.followUp({ embeds: [errorEmbed('Kanal kilidi açılırken bir hata oluştu.')], ephemeral: true });
      }

      const disabledRow = disableButtons(interaction, 'Unlocked');
      const embed = successEmbed('Kanal Kilidi Açıldı', `${channel} artık herkes tarafından kullanilabilir.`)
        .setFooter({ text: `İşlemi yapan: ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed], components: [disabledRow] });
    }
  },
};

function disableButtons(interaction, newLabel) {
  const row = interaction.message.components[0];
  return {
    type: 1,
    components: row.components.map(btn => ({
      type: 2,
      style: btn.style,
      label: newLabel || btn.label,
      custom_id: btn.customId,
      disabled: true,
    })),
  };
}