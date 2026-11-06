const { syncMember } = require('../utils/tagRole');

// Sunucu etiketi (primaryGuild) değişince discord.js guildMemberUpdate değil userUpdate olayını tetikler.
module.exports = {
  name: 'userUpdate',
  once: false,
  async execute(oldUser, newUser, client) {
    const oldTagGuild = oldUser.primaryGuild?.identityGuildId;
    const newTagGuild = newUser.primaryGuild?.identityGuildId;
    const tagChanged =
      oldTagGuild !== newTagGuild || oldUser.primaryGuild?.identityEnabled !== newUser.primaryGuild?.identityEnabled;
    if (!tagChanged) return;

    // Etiketin ait olduğu (eski veya yeni) sunucuları kontrol et.
    const guildIds = new Set([oldTagGuild, newTagGuild].filter(Boolean));
    for (const guildId of guildIds) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      try {
        const member = await guild.members.fetch({ user: newUser.id, force: true }).catch(() => null);
        if (member) await syncMember(member);
      } catch (err) {
        console.error('[TAG userUpdate]', err);
      }
    }
  },
};
