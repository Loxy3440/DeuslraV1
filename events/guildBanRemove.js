const { logAction } = require('../utils/modLog');

module.exports = {
  name: 'guildBanRemove',
  once: false,
  async execute(ban) {
    let moderator;
    try {
      const audit = await ban.guild.fetchAuditLogs({ type: 23, limit: 5 }); // MEMBER_BAN_REMOVE
      const e = audit.entries.find(x => x.target?.id === ban.user.id && Date.now() - x.createdTimestamp < 10000);
      if (e) moderator = e.executor;
    } catch {}
    await logAction(ban.guild, { action: 'unban', dedupeKey: `ban:${ban.guild.id}:${ban.user.id}`, target: ban.user, moderator, fromPanel: false });
  },
};
