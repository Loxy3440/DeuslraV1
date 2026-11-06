const { logAction } = require('../utils/modLog');
const { refreshActivity } = require('../utils/activityRotator');
const { recordLeave } = require('../utils/inviteTracker');
const { scheduleUpdate } = require('../utils/countChannel');

module.exports = {
  name: 'guildMemberRemove',
  once: false,
  async execute(member) {
    logAction(member.guild, { action: 'leave', dedupeKey: `kick:${member.guild.id}:${member.id}`, target: member.user, fields: [{ name: 'Sunucuda kaldığı', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R> katılmıştı` : 'bilinmiyor', inline: true }] });
    refreshActivity(member.client);
    scheduleUpdate(member.guild);
    try {
      await recordLeave(member);
    } catch (err) {
      console.error('[guildMemberRemove]', err);
    }
  },
};