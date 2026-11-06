const { cacheGuildInvites } = require('../utils/inviteTracker');

module.exports = {
  name: 'guildCreate',
  once: false,
  async execute(guild) {
    await cacheGuildInvites(guild);
  },
};