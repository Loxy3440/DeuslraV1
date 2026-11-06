const { logAction } = require('../utils/modLog');
const { onVoice } = require('../utils/stats');

// Ses kanalı giriş / çıkış / geçiş. Sadece kanal değişimi loglanır (mikrofon kapatma vb. değil).
module.exports = {
  name: 'voiceStateUpdate',
  once: false,
  async execute(oldState, newState) {
    try { onVoice(oldState, newState); } catch (err) { console.error('[STATS]', err.message); }
    try {
      const member = newState.member || oldState.member;
      if (!member || member.user.bot) return;
      const a = oldState.channelId, b = newState.channelId;
      if (a === b) return;
      const guild = newState.guild || oldState.guild;
      if (!a) return logAction(guild, { action: 'voicejoin', target: member, fields: [{ name: 'Kanal', value: `<#${b}>`, inline: true }] });
      if (!b) return logAction(guild, { action: 'voiceleave', target: member, fields: [{ name: 'Kanal', value: `<#${a}>`, inline: true }] });
      return logAction(guild, { action: 'voicemove', target: member, fields: [{ name: 'Önce', value: `<#${a}>`, inline: true }, { name: 'Sonra', value: `<#${b}>`, inline: true }] });
    } catch (err) { console.error('[voiceStateUpdate]', err.message); }
  },
};
