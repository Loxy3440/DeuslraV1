const { logAction } = require('../utils/modLog');
const { refreshActivity } = require('../utils/activityRotator');
const { getConfig } = require('../utils/guildConfig');
const { applyAutoNick } = require('../utils/autoNick');
const { handleBotJoin, registerCommandGrant } = require('../utils/askPerm');
const { recordJoin } = require('../utils/inviteTracker');
const { syncMember } = require('../utils/tagRole');
const { scheduleUpdate } = require('../utils/countChannel');
const { checkInviter } = require('../utils/autoRankup');

module.exports = {
  name: 'guildMemberAdd',
  once: false,
  async execute(member) {
    logAction(member.guild, { action: 'join', target: member, fields: [{ name: 'Hesap yaşı', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }] });
    refreshActivity(member.client);
    scheduleUpdate(member.guild);
    syncMember(member).catch(err => console.error('[TAG]', err));
    // Hangi davetle geldigini kaydet (hata verse bile diger islemler devam etsin).
    try {
      const joinDoc = await recordJoin(member);
      // Davet eden yeterli davete ulaştıysa bir üst role çıkar (auto rank up).
      if (joinDoc?.inviterId) checkInviter(member.guild, joinDoc.inviterId).catch(err => console.error('[AUTORANKUP]', err));
    } catch (err) {
      console.error('[INVITE TRACK]', err);
    }

    try {
      const config = await getConfig(member.guild.id);
      await applyAutoNick(member, config).catch(err => console.error('[AUTONICK]', err.message));

      // Bot eklendiyse kurucu rolünden izin iste (normal üyeler için izin istenmez).
      if (member.user.bot) {
        handleBotJoin(member).catch(err => console.error('[ASKPERM]', err));
      }

      if (config.autoRoleEnabled) {
        const roleId = member.user.bot ? config.autoRoleBotId : config.autoRoleId;
        const role = roleId ? member.guild.roles.cache.get(roleId) : null;
        if (role) {
          // Otorol bir sistem işlemi: izin istenmesin.
          registerCommandGrant(member.guild.id, member.id, role.id, member.client.user.id);
          await member.roles.add(role, 'Otomatik rol (otorol)').catch(err => console.error('[AUTOROLE]', err.message));
        }
      }

      // ---------- CHANNELBIP: yeni uye katilinca ayarlanan kanallara mesaj at ----------
      if (config.channelBips?.length) {
        for (const entry of config.channelBips) {
          const bipChannel = member.guild.channels.cache.get(entry.channelId);
          if (!bipChannel || !bipChannel.isTextBased()) continue;

          const text = (entry.message || '{user}')
            .replace(/{user}/g, member.toString())
            .replace(/{server}/g, member.guild.name);

          const sent = await bipChannel.send({ content: text }).catch(() => null);
          if (sent) {
            setTimeout(() => sent.delete().catch(() => {}), 1000);
          }
        }
      }
    } catch (err) {
      console.error('[guildMemberAdd]', err);
    }
  },
};