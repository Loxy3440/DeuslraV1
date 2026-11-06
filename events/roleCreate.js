const { logAction } = require('../utils/modLog');
module.exports = { name: 'roleCreate', once: false, async execute(role) { await logAction(role.guild, { action: 'rolecreate', fields: [{ name: 'Rol', value: `${role.name} (<@&${role.id}>)` }] }); } };
