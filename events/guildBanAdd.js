const { logAction } = require('../utils/modLog');

// Komutla (/ban) atılan banlar zaten loglandı; burası Discord'dan elle atılanlar için (tekrar yazmaz).
module.exports = {
  name: 'guildBanAdd',
  once: false,
  async execute(ban) {
    let moderator, reason = ban.reason || undefined;
    try {
      const audit = await ban.guild.fetchAuditLogs({ type: 22, limit: 5 }); // MEMBER_BAN_ADD
      const e = audit.entries.find(x => x.target?.id === ban.user.id && Date.now() - x.createdTimestamp < 10000);
      if (e) { moderator = e.executor; reason = e.reason || reason; }
    } catch {}
    await logAction(ban.guild, { action: 'ban', dedupeKey: `ban:${ban.guild.id}:${ban.user.id}`, target: ban.user, moderator, reason, fromPanel: false });
  },
};
