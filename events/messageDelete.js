const { logAction } = require('../utils/modLog');
const { getConfig } = require('../utils/guildConfig');

// Silinen mesajı log kanalına yazar. Önbellekte yoksa (bot kapalıyken atılmış, eski mesaj) içerik bilinmez.
module.exports = {
  name: 'messageDelete',
  once: false,
  async execute(message) {
    try {
      if (!message.guild || message.author?.bot) return;
      const config = await getConfig(message.guild.id);
      if (message.channelId === config.logChannelId) return; // log kanalındaki silmeler döngü yapmasın

      // Kim sildi? (Denetim kaydı izni varsa; yoksa yazar kendi silmiştir diye bilinmez.)
      let deleter = null;
      try {
        const audit = await message.guild.fetchAuditLogs({ type: 72, limit: 5 }); // MESSAGE_DELETE
        const e = audit.entries.find(x => x.target?.id === message.author?.id && x.extra?.channel?.id === message.channelId && Date.now() - x.createdTimestamp < 8000);
        if (e) deleter = e.executor;
      } catch {}

      const files = [...(message.attachments?.values?.() || [])].map(a => a.url);
      await logAction(message.guild, {
        action: 'msgdelete',
        target: message.author || undefined,
        moderator: deleter || undefined,
        description: message.content ? message.content : (message.partial ? '*(Mesaj önbellekte yoktu, içeriği bilinmiyor)*' : '*(metin yok)*'),
        fields: [
          { name: 'Kanal', value: `<#${message.channelId}>`, inline: true },
          ...(files.length ? [{ name: 'Ekler', value: files.join('\n') }] : []),
        ],
      });
    } catch (err) { console.error('[messageDelete]', err.message); }
  },
};
