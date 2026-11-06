const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');
const { getConfig } = require('../utils/guildConfig');
const {
  RankupError,
  MAX_INVITES,
  CATEGORIES,
  CAT_LABEL,
  getSettings,
  saveSettings,
  validateSteps,
  getStatus,
  sweepGuild,
  ladderText,
  roleLabel,
  bar,
} = require('../utils/autoRankup');

// Davete göre otomatik rank up, iki ayrı kategori: Üye ve Yetkili (her birinin kendi listesi, sayacı ve açma/kapama ayarı var).
// Örn: Ekip -> (5 davet) -> Has Ekip -> (10 davet) -> Usta. Her rank atlayışta davet sayacı sıfırlanır.
// Panelde "Auto rank up" sekmesinden de ayarlanır.
const catChoices = [{ name: 'Üye', value: 'uye' }, { name: 'Yetkili', value: 'yetkili' }];
const catOption = required => opt => opt.setName('kategori').setDescription('Kategori: üye mi yetkili mi').addChoices(...catChoices).setRequired(required);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autorankup')
    .setDescription('Davet sayısına göre otomatik rank atlatma sistemini ayarlar (üye ve yetkili kategorileri ayrı)')
    .addSubcommand(sub =>
      sub
        .setName('ekle')
        .setDescription('Bir kategorinin listesinin sonuna rol ekler (ilk eklenen rol başlangıç rolüdür)')
        .addStringOption(catOption(true))
        .addRoleOption(opt => opt.setName('rol').setDescription('Eklenecek rol').setRequired(true))
        .addIntegerOption(opt =>
          opt.setName('invite').setDescription('Bir önceki rolden sonra bu role geçmek için gereken davet (ilk rol için boş bırak)').setMinValue(1).setMaxValue(MAX_INVITES))
        .addIntegerOption(opt =>
          opt.setName('partner').setDescription('İsteğe bağlı: davet yerine bu kadar onaylı partner de terfi ettirir').setMinValue(1).setMaxValue(MAX_INVITES)),
    )
    .addSubcommand(sub =>
      sub
        .setName('partner')
        .setDescription('Bir basamak için gereken partner sayısını ayarlar (0 = partner ile terfi kapalı)')
        .addStringOption(catOption(true))
        .addRoleOption(opt => opt.setName('rol').setDescription('Basamaktaki rol (ilk rol hariç)').setRequired(true))
        .addIntegerOption(opt => opt.setName('sayi').setDescription('Gereken partner sayısı (0 = kapalı)').setMinValue(0).setMaxValue(MAX_INVITES).setRequired(true)),
    )
    .addSubcommand(sub =>
      sub
        .setName('cikar')
        .setDescription('Bir rolü kategori listesinden çıkarır')
        .addStringOption(catOption(true))
        .addRoleOption(opt => opt.setName('rol').setDescription('Çıkarılacak rol').setRequired(true)),
    )
    .addSubcommand(sub =>
      sub
        .setName('liste')
        .setDescription('Basamak listesini ve sistemin durumunu gösterir (kategori boşsa ikisini de)')
        .addStringOption(catOption(false)),
    )
    .addSubcommand(sub =>
      sub
        .setName('durum')
        .setDescription('Bir üyenin rankını ve sıradaki rank için davet ilerlemesini gösterir')
        .addUserOption(opt => opt.setName('uye').setDescription('Üye (boşsa sen)'))
        .addStringOption(catOption(false)),
    )
    .addSubcommand(sub => sub.setName('ac').setDescription('Bir kategorinin otomatik rank upını açar').addStringOption(catOption(true)))
    .addSubcommand(sub => sub.setName('kapat').setDescription('Bir kategorinin otomatik rank upını kapatır (liste silinmez)').addStringOption(catOption(true)))
    .addSubcommand(sub =>
      sub
        .setName('kanal')
        .setDescription('Rank atlayınca duyuru yapılacak kanalı seçer (kanalı boş bırakırsan duyuru kapanır)')
        .addStringOption(catOption(true))
        .addChannelOption(opt => opt.setName('kanal').setDescription('Duyuru kanalı').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    )
    .addSubcommand(sub =>
      sub
        .setName('kontrol')
        .setDescription('Listedeki rollere sahip herkesi şimdi kontrol eder, hak edenleri yükseltir (kategori boşsa ikisi de)')
        .addStringOption(catOption(false)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const config = await getConfig(guild.id);
    const fail = text => interaction.reply({ embeds: [errorEmbed(text)], ephemeral: true });
    const me = guild.members.me;
    const chosen = interaction.options.getString('kategori'); // boşsa null
    const cats = chosen ? [chosen] : CATEGORIES;
    const label = CAT_LABEL[chosen];

    try {
      if (sub === 'ekle') {
        const settings = getSettings(config, chosen);
        const role = interaction.options.getRole('rol', true);
        const invites = interaction.options.getInteger('invite');
        if (settings.steps.length && invites == null) {
          return fail(`${label} listesinde zaten rol var: bu role geçmek için kaç davet gerektiğini \`invite\` ile yaz.`);
        }
        const steps = validateSteps(guild, [...settings.steps, { roleId: role.id, invites: invites ?? 0, partners: interaction.options.getInteger('partner') ?? 0 }], chosen, config);
        await saveSettings(guild.id, chosen, { ...settings, steps });

        const tooHigh = me && role.position >= me.roles.highest.position;
        const embed = successEmbed(`${label}: Basamak Eklendi`, ladderText(guild, steps));
        if (tooHigh) embed.addFields({ name: '⚠️ Dikkat', value: `Botun rolü **${role.name}** rolünden düşük, bu rolü veremez. Botun rolünü yukarı taşı.` });
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (sub === 'partner') {
        const settings = getSettings(config, chosen);
        const role = interaction.options.getRole('rol', true);
        const count = interaction.options.getInteger('sayi', true);
        const idx = settings.steps.findIndex(s => s.roleId === role.id);
        if (idx < 0) return fail(`Bu rol ${label} listesinde yok.`);
        if (idx === 0) return fail('İlk rol başlangıç rolüdür, ona terfi şartı konmaz.');
        const steps = settings.steps.map((s, i) => (i === idx ? { ...s, partners: count } : s));
        await saveSettings(guild.id, chosen, { ...settings, steps: validateSteps(guild, steps, chosen, config) });
        return interaction.reply({ embeds: [successEmbed(`${label}: Partner Şartı`, ladderText(guild, validateSteps(guild, steps, chosen, config)))], ephemeral: true });
      }

      if (sub === 'cikar') {
        const settings = getSettings(config, chosen);
        const role = interaction.options.getRole('rol', true);
        if (!settings.steps.some(s => s.roleId === role.id)) return fail(`Bu rol ${label} listesinde yok.`);
        const steps = validateSteps(guild, settings.steps.filter(s => s.roleId !== role.id), chosen, config);
        const off = settings.enabled && steps.length < 2;
        await saveSettings(guild.id, chosen, { ...settings, steps, enabled: off ? false : settings.enabled });
        return interaction.reply({
          embeds: [successEmbed(`${label}: Basamak Çıkarıldı`, ladderText(guild, steps) + (off ? '\n\nEn az 2 rol kalmadığı için bu kategori kapatıldı.' : ''))],
          ephemeral: true,
        });
      }

      if (sub === 'liste') {
        const embed = new EmbedBuilder().setTitle('Auto Rank Up').setColor(0x5865f2);
        for (const cat of cats) {
          const s = getSettings(config, cat);
          embed.addFields({
            name: `${CAT_LABEL[cat]} — ${s.enabled ? '🟢 Açık' : '🔴 Kapalı'}${s.channelId ? ` · duyuru <#${s.channelId}>` : ''}`,
            value: ladderText(guild, s.steps).slice(0, 1024),
          });
        }
        embed.addFields({ name: 'Nasıl çalışır?', value: 'Üye bir rolü aldığı andan itibaren yaptığı davetler sayılır. Rank atlayınca davet sayacı **0**\'dan başlar. Üye ve yetkili kategorileri birbirinden bağımsızdır.' });
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (sub === 'durum') {
        const member = interaction.options.getMember('uye') || interaction.member;
        if (member.user.bot) return fail('Botlar rank atlamaz.');
        const embed = new EmbedBuilder().setTitle(`${member.user.tag} - Rank Durumu`).setColor(0x5865f2);
        let shown = 0;
        for (const cat of cats) {
          const s = getSettings(config, cat);
          if (s.steps.length < 2) { if (chosen) return fail(`${label} kategorisinde en az 2 rol yok. Önce \`/autorankup ekle\` kullan.`); continue; }
          const st = await getStatus(guild, member, s, cat);
          if (st.idx < 0) { if (chosen) { shown++; embed.addFields({ name: CAT_LABEL[cat], value: `Bu kategorideki rollerin hiçbirine sahip değil. Başlangıç rolü: **${roleLabel(guild, s.steps[0].roleId)}**.` }); } continue; }
          shown++;
          embed.addFields({
            name: `${CAT_LABEL[cat]}${s.enabled ? '' : ' (kapalı)'}`,
            value: st.next
              ? `**${roleLabel(guild, st.current.roleId)}** → **${roleLabel(guild, st.next.roleId)}**\n${bar(st.count, st.next.invites)} **${st.count}/${st.next.invites}** davet\n${st.next.partners > 0 ? `🤝 **${st.partnerCount}/${st.next.partners}** partner (davet **veya** partner yeter)\n` : ''}Rank atlayınca sayaç 0'dan başlar.`
              : `**${roleLabel(guild, st.current.roleId)}** — en üst rank, sıradaki rank yok.`,
          });
        }
        if (!shown) {
          return interaction.reply({ embeds: [warningEmbed('Basamakta Değil', `**${member.user.tag}** hiçbir kategorideki rollere sahip değil ya da kategoriler henüz ayarlanmadı.`)], ephemeral: true });
        }
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      if (sub === 'ac') {
        const settings = getSettings(config, chosen);
        if (settings.steps.length < 2) return fail(`${label} için açmak için en az 2 rol gerekli (başlangıç rolü + bir üst rol). \`/autorankup ekle\` ile ekle.`);
        if (settings.enabled) return interaction.reply({ embeds: [warningEmbed('Zaten Açık', `${label} auto rank up zaten açık.`)], ephemeral: true });
        await saveSettings(guild.id, chosen, { ...settings, enabled: true, enabledAt: new Date() });
        return interaction.reply({
          embeds: [successEmbed(`${label}: Auto Rank Up Açıldı`, 'Bundan sonra yapılan davetler sayılır. Önceden yapılan davetler sayılmaz.\n\n' + ladderText(guild, settings.steps))],
          ephemeral: true,
        });
      }

      if (sub === 'kapat') {
        const settings = getSettings(config, chosen);
        if (!settings.enabled) return interaction.reply({ embeds: [warningEmbed('Zaten Kapalı', `${label} auto rank up zaten kapalı.`)], ephemeral: true });
        await saveSettings(guild.id, chosen, { ...settings, enabled: false });
        return interaction.reply({ embeds: [successEmbed(`${label}: Auto Rank Up Kapatıldı`, `Liste duruyor, istediğinde \`/autorankup ac kategori:${label}\` ile tekrar açabilirsin.`)], ephemeral: true });
      }

      if (sub === 'kanal') {
        const settings = getSettings(config, chosen);
        const channel = interaction.options.getChannel('kanal');
        if (channel && !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
          return fail(`Botun ${channel} kanalında **Kanalı Gör** ve **Mesaj Gönder** yetkisi olmalı.`);
        }
        await saveSettings(guild.id, chosen, { ...settings, channelId: channel ? channel.id : null });
        return interaction.reply({
          embeds: [successEmbed(`${label}: Duyuru Kanalı`, channel ? `${label} kategorisinde rank atlayanlar ${channel} kanalında duyurulacak.` : 'Duyuru kapatıldı.')],
          ephemeral: true,
        });
      }

      if (sub === 'kontrol') {
        const open = cats.filter(c => getSettings(config, c).enabled);
        if (!open.length) return fail('Kontrol için önce `/autorankup ac` ile en az bir kategoriyi aç.');
        await interaction.deferReply({ ephemeral: true });
        const lines = [];
        for (const cat of open) {
          const { checked, promoted } = await sweepGuild(guild, cat);
          lines.push(`**${CAT_LABEL[cat]}:** ${checked} üye kontrol edildi, ${promoted} üye rank atladı.`);
        }
        return interaction.editReply({ embeds: [successEmbed('Kontrol Bitti', lines.join('\n'))] });
      }
    } catch (err) {
      if (err instanceof RankupError) return fail(err.message);
      throw err;
    }
  },
};
