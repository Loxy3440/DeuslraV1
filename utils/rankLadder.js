// Promote/demote basamakları: "üye rolleri" + "yetkili rolleri" birlikte, Discord rol sırasına göre alttan üste.
// Sadece /setroles ile seçilen roller basamaktır; seçilmeyen roller (ör. sadece görünüm için "Yetkili" rolü) atlanır.
// Bot rolleri basamağa girmez.
function getLadder(guild, config) {
  const bot = new Set(config.roleBotIds || []);
  const staff = new Set(config.roleStaffIds || []);
  const ids = [...new Set([...(config.roleMemberIds || []), ...(config.roleStaffIds || [])])].filter(id => guild.roles.cache.has(id));

  let roles;
  if (ids.length) {
    roles = ids.map(id => guild.roles.cache.get(id));
  } else {
    // Hiç rol ayarlanmamışsa eski davranış: tüm roller, ama bot rolleri hariç.
    roles = [...guild.roles.cache.values()].filter(r => !r.managed && r.id !== guild.id);
  }
  roles = roles.filter(r => !bot.has(r.id) && !r.managed && r.id !== guild.id).sort((a, b) => a.position - b.position);

  return { ladder: roles, configured: ids.length > 0, staff, bot };
}

// Üyenin basamaklardaki en yüksek rolü (yoksa null) ve sırası.
function currentRank(member, ladder) {
  let idx = -1;
  ladder.forEach((r, i) => { if (member.roles.cache.has(r.id)) idx = i; });
  return { index: idx, role: idx >= 0 ? ladder[idx] : null };
}

// Terfi/tenzil yapılamayacak üye mi? (sadece botlar) -> neden metni döner, yapılabilirse null.
// Yetkili rolündekilere de promote/demote uygulanır (yetkili rolleri basamağın içinde).
function blockedReason(member) {
  if (member.user.bot) return 'Botlara terfi/tenzil uygulanmaz.';
  return null;
}

module.exports = { getLadder, currentRank, blockedReason };
