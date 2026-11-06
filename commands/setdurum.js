const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const { errorEmbed, successEmbed, warningEmbed } = require('../utils/embeds');
const { getConfig, setConfig } = require('../utils/guildConfig');
const { syncMember, customStatusText, hasStatusText, presenceEnabled } = require('../utils/statusRole');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setdurum')
    .setDescription('Durumuna belirli bir yazıyı yazana otomatik rol verir (örn: durumunda .gg/sunucu yazanlar)')
    .addSubcommand(sub =>
      sub.setName('ayarla').setDescription('Durum yazısını, verilecek rolü ve kanalı ayarlar')
        .addStringOption(opt => opt.setName('mesaj').setDescription('Özel durumda geçmesi gereken yazı (örn: .gg/deuslra)').setRequired(true).setMaxLength(100))
        .addRoleOption(opt => opt.setName('rol').setDescription('Yazıyı yazana verilecek rol').setRequired(true))
        .addChannelOption(opt =>
          opt.setName('kanal').setDescription('Rol verilince üyenin etiketlenip mesajın silineceği kanal')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand(sub => sub.setName('kapat').setDescription('Durum rolü sistemini kapatır (roller geri alınmaz)'))
    .addSubcommand(sub =>
      sub.setName('kontrol').setDescription('Botun bir üyenin durumunu görüp görmediğini kontrol eder (hata ayıklama)')
        .addUserOption(opt => opt.setName('uye').setDescription('Kontrol edilecek üye').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const me = guild.members.me;

    if (sub === 'kapat') {
      await setConfig(guild.id, { statusRoleId: null, statusChannelId: null, statusText: null });
      return interaction.reply({ embeds: [successEmbed('Durum Rolü Kapatıldı', 'Artık durum yazısına göre rol verilmeyecek.')], ephemeral: true });
    }

    if (sub === 'kontrol') {
      await interaction.deferReply({ ephemeral: true });
      const target = interaction.options.getUser('uye');
      const member = await guild.members.fetch({ user: target.id, force: true }).catch(() => null);
      if (!member) return interaction.editReply({ embeds: [errorEmbed('Üye sunucuda bulunamadı.')] });
      const config = await getConfig(guild.id);
      const role = config.statusRoleId ? guild.roles.cache.get(config.statusRoleId) : null;
      const problems = [];
      if (!presenceEnabled(interaction.client)) problems.push('Presence intent kapalı: `.env` içine `USE_PRESENCE=true` yaz ve Developer Portal > Bot > **Presence Intent** aç.');
      if (!config.statusText || !config.statusRoleId) problems.push('`/setdurum ayarla` ile yazı ve rol ayarlanmamış.');
      else if (!role) problems.push('Ayarlanan rol silinmiş.');
      else {
        if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) problems.push('Botun **Rolleri Yönet** yetkisi yok.');
        if (role.position >= me.roles.highest.position) problems.push(`Bot rolü ${role} rolünün üstünde değil.`);
      }
      if (!member.presence) problems.push('Bot bu üyenin durumunu görmüyor (çevrimdışı/görünmez olabilir).');
      const has = config.statusText ? hasStatusText(member, config.statusText) : null;
      if (has && role) await syncMember(member).catch(err => problems.push(`Senkron hatası: ${err.message}`));
      const embed = new EmbedBuilder().setTitle('Durum Kontrolü').setColor(problems.length ? 0xe67e22 : 0x57f287).addFields(
        { name: 'Üye', value: `${member}`, inline: true },
        { name: 'Aranan yazı', value: config.statusText ? `\`${config.statusText}\`` : '—', inline: true },
        { name: 'Yazıyı yazıyor mu', value: has === null ? '❔ Bilinmiyor' : has ? '✅ Evet' : '❌ Hayır', inline: true },
        { name: 'Botun gördüğü durum yazısı', value: customStatusText(member) ? `\`${customStatusText(member)}\`` : '`yok`' },
        { name: 'Sorunlar', value: problems.length ? problems.map(p => `• ${p}`).join('\n') : 'Sorun görünmüyor.' },
      );
      return interaction.editReply({ embeds: [embed] });
    }

    // ayarla
    const text = interaction.options.getString('mesaj').trim();
    const role = interaction.options.getRole('rol');
    const channel = interaction.options.getChannel('kanal');
    if (!text) return interaction.reply({ embeds: [errorEmbed('Mesaj boş olamaz.')], ephemeral: true });
    if (role.id === guild.id) return interaction.reply({ embeds: [errorEmbed('@everyone rolü seçilemez.')], ephemeral: true });
    if (role.managed) return interaction.reply({ embeds: [errorEmbed('Bu rol bir bot/entegrasyona ait, verilemez.')], ephemeral: true });
    if (role.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ embeds: [errorEmbed('Yönetici yetkisi olan bir rol seçilemez (güvenlik).')], ephemeral: true });
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return interaction.reply({ embeds: [errorEmbed('Botun **Rolleri Yönet** yetkisi yok.')], ephemeral: true });
    if (role.position >= me.roles.highest.position) {
      return interaction.reply({ embeds: [errorEmbed(`${role} rolü botun en yüksek rolünden yukarıda veya aynı seviyede. Bot rolünü ${role} rolünün üstüne taşı.`)], ephemeral: true });
    }
    if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages])) {
      return interaction.reply({ embeds: [errorEmbed(`Botun ${channel} kanalında **Kanalı Gör**, **Mesaj Gönder** ve **Mesajları Yönet** yetkisi olmalı.`)], ephemeral: true });
    }

    await setConfig(guild.id, { statusText: text, statusRoleId: role.id, statusChannelId: channel.id });
    const embed = successEmbed('Durum Rolü Ayarlandı',
      `Özel durumunda \`${text}\` yazan üyeye ${role} verilecek, ${channel} kanalında etiketlenip mesaj silinecek. Yazıyı kaldıran üyeden rol geri alınır.\n\n` +
      `Çevrimdışı/görünmez üyelerin durumu görünmediği için o sırada rol değişmez.`);
    if (!presenceEnabled(interaction.client)) {
      embed.addFields({ name: '⚠️ Presence intent kapalı', value: 'Sistemin çalışması için `.env` içine `USE_PRESENCE=true` ekle ve Developer Portal > Bot > **Presence Intent** seçeneğini aç, sonra botu yeniden başlat.' });
    }
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
