const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getConfig } = require('../utils/guildConfig');
const { wearsTag, syncMember } = require('../utils/tagRole');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tagkontrol')
    .setDescription('Botun bir üyenin sunucu etiketini görüp görmediğini kontrol eder (hata ayıklama)')
    .addUserOption(opt => opt.setName('uye').setDescription('Kontrol edilecek üye').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const target = interaction.options.getUser('uye');
    const member = await guild.members.fetch({ user: target.id, force: true }).catch(() => null);
    if (!member) return interaction.editReply('Üye sunucuda bulunamadı.');

    const config = await getConfig(guild.id);
    const role = config.tagRoleId ? guild.roles.cache.get(config.tagRoleId) : null;
    const me = guild.members.me;
    const pg = member.user.primaryGuild;

    const problems = [];
    if (!config.tagRoleId) problems.push('`/settag` ile rol ayarlanmamış.');
    else if (!role) problems.push('Ayarlanan rol silinmiş, `/settag` ile yeniden seç.');
    else {
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) problems.push('Botun **Rolleri Yönet** yetkisi yok.');
      if (role.position >= me.roles.highest.position) problems.push(`Bot rolü ${role} rolünün üstünde değil.`);
    }
    if (!pg) problems.push('Discord bu üye için hiç etiket bilgisi göndermiyor (üye etiket seçmemiş olabilir).');
    else if (pg.identityGuildId !== guild.id) problems.push('Üyenin taktığı etiket bu sunucunun etiketi değil.');
    else if (!pg.identityEnabled) problems.push('Üye etiketi seçmiş ama profilinde **göster** kapalı.');

    const tagged = wearsTag(member);
    if (tagged && role) await syncMember(member).catch(err => problems.push(`Senkron hatası: ${err.message}`));

    const embed = new EmbedBuilder()
      .setTitle('Etiket Kontrolü')
      .setColor(problems.length ? 0xe67e22 : 0x57f287)
      .addFields(
        { name: 'Üye', value: `${member}`, inline: true },
        { name: 'Etiketi takıyor mu', value: tagged ? '✅ Evet' : '❌ Hayır', inline: true },
        { name: 'Rolü var mı', value: role && member.roles.cache.has(role.id) ? '✅ Evet' : '❌ Hayır', inline: true },
        {
          name: 'Botun gördüğü ham veri',
          value: pg
            ? `etiket: \`${pg.tag ?? '-'}\`\nsunucu ID: \`${pg.identityGuildId}\`\ngöster: \`${pg.identityEnabled}\``
            : '`primaryGuild: null`',
        },
        { name: 'Sorunlar', value: problems.length ? problems.map(p => `• ${p}`).join('\n') : 'Sorun görünmüyor.' },
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
