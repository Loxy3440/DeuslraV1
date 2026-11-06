// /auto ve /setmention için: bir tetikleyiciyi sadece seçilen roller kullanabilsin.
// Akış: menüden "Rol Sınırı" -> tetikleyici seç -> rolleri seç (boş = herkes).
const { ActionRowBuilder, StringSelectMenuBuilder, RoleSelectMenuBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfig, setTriggerRoles } = require('./guildConfig');

const KINDS = {
  auto: { field: 'autoResponses', menuId: 'auto_menu', value: 'roles_auto', name: 'otomatik mesaj' },
  mention: { field: 'mentionTriggers', menuId: 'setmention_menu', value: 'roles_mention', name: 'etiket cevabı' },
};

const canEdit = m => Boolean(m?.permissions.has(PermissionFlagsBits.ManageGuild) || (process.env.OWNER_ID && m?.id === process.env.OWNER_ID));

// Embed'lerde tetikleyicinin yanına yazılacak kısa metin.
function lockText(entry) {
  const ids = entry?.allowedRoleIds || [];
  if (!ids.length) return '';
  const shown = ids.slice(0, 3).map(id => `<@&${id}>`).join(' ');
  return ` 🔒 ${shown}${ids.length > 3 ? ` +${ids.length - 3}` : ''}`;
}

async function handleTriggerRolesInteraction(interaction) {
  if (!interaction.guild) return false;
  const id = interaction.customId || '';

  // 1) Menüden "Rol Sınırı" seçildi -> tetikleyici listesi
  for (const [kind, k] of Object.entries(KINDS)) {
    if (interaction.isStringSelectMenu() && id === k.menuId && interaction.values[0] === k.value) {
      if (!canEdit(interaction.member)) { await interaction.reply({ content: '🚫 Yetkin yok.', ephemeral: true }); return true; }
      const config = await getConfig(interaction.guild.id);
      const list = config[k.field];
      if (!list.length) { await interaction.reply({ content: `Önce bir ${k.name} ekle.`, ephemeral: true }); return true; }
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`trigroles_pick_${kind}`)
        .setPlaceholder('Hangi tetikleyici için?')
        .addOptions(list.slice(0, 25).map((r, i) => ({
          label: r.trigger.slice(0, 100),
          description: (r.allowedRoleIds?.length ? `Sınırlı: ${r.allowedRoleIds.length} rol` : 'Herkes kullanabilir').slice(0, 100),
          value: String(i),
        })));
      await interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
      return true;
    }
  }

  // 2) Tetikleyici seçildi -> rol seçici
  const pick = /^trigroles_pick_(auto|mention)$/.exec(id);
  if (pick && interaction.isStringSelectMenu()) {
    const kind = pick[1], idx = Number(interaction.values[0]);
    const config = await getConfig(interaction.guild.id);
    const entry = config[KINDS[kind].field][idx];
    if (!entry) { await interaction.update({ content: 'Tetikleyici bulunamadı.', components: [] }); return true; }
    const defaults = (entry.allowedRoleIds || []).filter(r => interaction.guild.roles.cache.has(r)).slice(0, 25);
    const menu = new RoleSelectMenuBuilder().setCustomId(`trigroles_set_${kind}_${idx}`).setPlaceholder('Kullanabilecek roller (boş = herkes)').setMinValues(0).setMaxValues(25);
    if (defaults.length) menu.setDefaultRoles(defaults);
    await interaction.update({
      content: `**${entry.trigger}** tetikleyicisini hangi roller kullanabilsin? Seçilmeyen kişilere bot cevap vermez. Hepsini boşaltırsan herkes kullanır.`,
      components: [new ActionRowBuilder().addComponents(menu)],
    });
    return true;
  }

  // 3) Roller seçildi -> kaydet
  const set = /^trigroles_set_(auto|mention)_(\d+)$/.exec(id);
  if (set && interaction.isRoleSelectMenu()) {
    if (!canEdit(interaction.member)) { await interaction.reply({ content: '🚫 Yetkin yok.', ephemeral: true }); return true; }
    const entry = await setTriggerRoles(interaction.guild.id, set[1], Number(set[2]), interaction.values);
    await interaction.update({
      content: entry
        ? `✅ **${entry.trigger}** → ${interaction.values.length ? interaction.values.map(r => `<@&${r}>`).join(' ') : 'herkes kullanabilir'}`
        : 'Tetikleyici bulunamadı (silinmiş olabilir).',
      components: [],
      allowedMentions: { parse: [] },
    });
    return true;
  }
  return false;
}

module.exports = { handleTriggerRolesInteraction, lockText };
