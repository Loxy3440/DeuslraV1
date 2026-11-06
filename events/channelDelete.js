const { logAction } = require('../utils/modLog');

module.exports = {
  name: 'channelDelete',
  once: false,
  async execute(channel) {
    if (!channel.guild) return;
    await logAction(channel.guild, { action: 'chdelete', fields: [{ name: 'Kanal', value: `#${channel.name}`, inline: true }, { name: 'Tür', value: String(channel.type), inline: true }] });
  },
};
