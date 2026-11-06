const { handleRoleUpdate } = require('../utils/askPerm');
const { syncMember } = require('../utils/tagRole');
const { onRoleChange } = require('../utils/autoRankup');

const { logAction, wasHandled } = require('../utils/modLog');

async function logChanges(oldM, newM) {
  if (oldM.partial) return;
  const g = newM.guild;
  if (oldM.nickname !== newM.nickname) {
    await logAction(g, { action: 'nick', target: newM, fields: [{ name: 'Eski', value: oldM.nickname || '(yok)', inline: true }, { name: 'Yeni', value: newM.nickname || '(yok)', inline: true }] });
  }
  const added = newM.roles.cache.filter(r => !oldM.roles.cache.has(r.id));
  const removed = oldM.roles.cache.filter(r => !newM.roles.cache.has(r.id));
  for (const r of added.values()) await logAction(g, { action: 'roleadd', target: newM, fields: [{ name: 'Rol', value: `${r.name} (<@&${r.id}>)` }] });
  for (const r of removed.values()) await logAction(g, { action: 'roleremove', target: newM, fields: [{ name: 'Rol', value: `${r.name} (<@&${r.id}>)` }] });
  // Discord'dan elle verilen susturma (komutla verilen /mute zaten loglandı)
  const a = oldM.communicationDisabledUntilTimestamp || 0, b = newM.communicationDisabledUntilTimestamp || 0;
  if (a !== b && !wasHandled(`mute:${g.id}:${newM.id}`)) {
    if (b > Date.now()) await logAction(g, { action: 'mute', target: newM, fields: [{ name: 'Bitiş', value: `<t:${Math.floor(b / 1000)}:R>`, inline: true }] });
    else if (a > Date.now()) await logAction(g, { action: 'unmute', target: newM });
  }
}

module.exports = {
  name: 'guildMemberUpdate',
  once: false,
  async execute(oldMember, newMember) {
    logChanges(oldMember, newMember).catch(err => console.error('[LOG]', err.message));
    try {
      await handleRoleUpdate(oldMember, newMember);
    } catch (err) {
      console.error('[guildMemberUpdate]', err);
    }
    try {
      await syncMember(newMember);
    } catch (err) {
      console.error('[TAG]', err);
    }
    try {
      await onRoleChange(oldMember, newMember); // auto rank up: rol değişince davet sayacı o andan başlar
    } catch (err) {
      console.error('[AUTORANKUP]', err);
    }
  },
};
