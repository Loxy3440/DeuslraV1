const { logAction } = require('../utils/modLog');
module.exports = { name: 'roleDelete', once: false, async execute(role) { await logAction(role.guild, { action: 'roledelete', fields: [{ name: 'Rol', value: role.name }] }); } };
