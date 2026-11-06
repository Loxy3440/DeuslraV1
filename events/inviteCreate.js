const { onInviteCreate } = require('../utils/inviteTracker');

module.exports = {
  name: 'inviteCreate',
  once: false,
  execute(invite) {
    onInviteCreate(invite);
  },
};