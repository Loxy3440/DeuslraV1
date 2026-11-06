const { syncMember } = require('../utils/statusRole');

// Üyenin durumu/özel durum yazısı değişince rolü kontrol eder (GuildPresences intent'i açıksa çalışır).
module.exports = {
  name: 'presenceUpdate',
  once: false,
  async execute(oldPresence, newPresence) {
    try {
      const member = newPresence?.member;
      if (member) await syncMember(member);
    } catch (err) {
      console.error('[DURUM presenceUpdate]', err);
    }
  },
};
