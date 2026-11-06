const { EmbedBuilder, ActionRowBuilder, RoleSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfig, setConfig } = require('./guildConfig');

const GROUPS = [
  { key: 'member', field: 'roleMemberIds', label: 'Üye rolleri', hint: 'promote/demote basamakları (alttan üste, rol sırasına göre)' },
  { key: 'staff', field: 'roleStaffIds', label: 'Yetkili rolleri', hint: 'üye rolleriyle birlikte promote/demote basamağı sayılır' },
  { key: 'bot', field: 'roleBotIds', label: 'Bot rolleri', hint: 'basamaklara girmez, botlara uygulanmaz' },
];

const canEdit = member => Boolean(member?.permissions.has(PermissionFlagsBits.ManageGuild) || (process.env.OWNER_ID && member?.id === process.env.OWNER_ID));

function buildPanel(guild, config) {
  const fmt = ids => {
    const live = (ids || []).filter(id => guild.roles.cache.has(id));
    return live.length ? live.map(id => `<@&${id}>`).join(' ') : '*Ayarlanmadı*';
  };
  const embed = new EmbedBuilder()
    .setTitle('Rol Grupları (Setroles)')
    .setColor(0x5865f2)
    .setDescription(
      '`/promote` ve `/demote` **üye rolleri** ve **yetkili rolleri** arasında basamak değiştirir (rol sırasına göre, alttan üste). Burada seçilmeyen roller atlanır, botlara uygulanmaz.\n' +
        'Bir rol sadece tek grupta olabilir. Aşağıdaki menülerden seçimi güncelle (seçimi boşaltırsan grup temizlenir).',
    )
    .addFields(GROUPS.map(g => ({ name: `${g.label}`, value: `${fmt(config[g.field])}\n-# ${g.hint}` })));

  const rows = GROUPS.map(g => {
    const defaults = (config[g.field] || []).filter(id => guild.roles.cache.has(id)).slice(0, 25);
    const menu = new RoleSelectMenuBuilder()
      .setCustomId(`setroles_${g.key}`)
      .setPlaceholder(`${g.label} seç...`)
      .setMinValues(0)
      .setMaxValues(25);
    if (defaults.length) menu.setDefaultRoles(defaults);
    return new ActionRowBuilder().addComponents(menu);
  });
  return { embeds: [embed], components: rows };
}

async function handleRoleGroupsInteraction(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('setroles_') || !interaction.isRoleSelectMenu() || !interaction.guild) return false;

  if (!canEdit(interaction.member)) {
    await interaction.reply({ content: '🚫 Bu paneli sadece **Sunucuyu Yönet** yetkisi olanlar kullanabilir.', ephemeral: true });
    return true;
  }

  const group = GROUPS.find(g => `setroles_${g.key}` === id);
  if (!group) return true;

  const picked = interaction.values;
  const config = await getConfig(interaction.guild.id);

  // Bir rol iki grupta olamaz (hangi gruba ait olduğu belirsiz kalır).
  for (const other of GROUPS) {
    if (other.key === group.key) continue;
    const clash = picked.filter(r => (config[other.field] || []).includes(r));
    if (clash.length) {
      await interaction.reply({
        content: `⚠️ ${clash.map(r => `<@&${r}>`).join(' ')} zaten **${other.label}** grubunda. Önce oradan çıkar.`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return true;
    }
  }

  await setConfig(interaction.guild.id, { [group.field]: picked });
  await interaction.update(buildPanel(interaction.guild, { ...config, [group.field]: picked }));
  return true;
}

module.exports = { GROUPS, buildPanel, handleRoleGroupsInteraction };
