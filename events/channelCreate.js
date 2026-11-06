const { logAction } = require('../utils/modLog');
const { getConfig } = require('../utils/guildConfig');

module.exports = {
  name: 'channelCreate',
  once: false,
  async execute(channel) {
    try {
      if (channel.guild) logAction(channel.guild, { action: 'chcreate', fields: [{ name: 'Kanal', value: `<#${channel.id}> (#${channel.name})`, inline: true }] });
      if (!channel.guild || !channel.parentId) return;
      if (!channel.isTextBased || !channel.isTextBased()) return;

      const config = await getConfig(channel.guild.id);
      if (!config.activityTriggers?.length) return;

      const trigger = config.activityTriggers.find(t => t.watchType === 'category' && t.watchId === channel.parentId);
      if (!trigger || !trigger.newChannelMessage) return;

      const text = trigger.newChannelMessage.replace(/{kanal}/g, `<#${channel.id}>`).replace(/{server}/g, channel.guild.name);

      if (text) await channel.send({ content: text }).catch(() => {});
    } catch (err) {
      console.error('[channelCreate]', err);
    }
  },
};