const { logAction } = require('../utils/modLog');
const { getConfig } = require('../utils/guildConfig');

module.exports = {
  name: 'messageUpdate',
  once: false,
  async execute(oldMsg, newMsg) {
    try {
      if (!newMsg.guild || newMsg.author?.bot || oldMsg.partial) return;
      if (oldMsg.content === newMsg.content) return; // sadece içerik değişimi (embed yüklenmesi vb. değil)
      const config = await getConfig(newMsg.guild.id);
      if (newMsg.channelId === config.logChannelId) return;
      await logAction(newMsg.guild, {
        action: 'msgedit',
        target: newMsg.author,
        fields: [
          { name: 'Eski', value: oldMsg.content || '—' },
          { name: 'Yeni', value: newMsg.content || '—' },
          { name: 'Kanal', value: `[<#${newMsg.channelId}>](${newMsg.url})`, inline: true },
        ],
      });
    } catch (err) { console.error('[messageUpdate]', err.message); }
  },
};
