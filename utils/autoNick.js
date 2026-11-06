const MAX_NICK_LENGTH = 32;

function buildAutoNick(baseName, text, position) {
  const base = String(baseName || '').trim();
  const tag = String(text || '').trim();
  if (!base || !tag || !['basa', 'sona'].includes(position)) return null;

  const lowerBase = base.toLowerCase();
  const lowerTag = tag.toLowerCase();
  if (position === 'basa' && (lowerBase === lowerTag || lowerBase.startsWith(lowerTag + ' '))) return null;
  if (position === 'sona' && (lowerBase === lowerTag || lowerBase.endsWith(' ' + lowerTag))) return null;

  const nameRoom = MAX_NICK_LENGTH - tag.length - 1;
  if (nameRoom < 1) return null;
  const shortenedBase = base.slice(0, nameRoom).trimEnd();
  if (!shortenedBase) return null;
  return position === 'basa' ? tag + ' ' + shortenedBase : shortenedBase + ' ' + tag;
}

async function applyAutoNick(member, config) {
  if (!member || !config?.autoNickEnabled || !String(config.autoNickText || '').trim()) return false;
  if (member.user?.bot && !config.autoNickIncludeBots) return false;
  if (!member.manageable) return false;

  const nextNick = buildAutoNick(member.displayName, config.autoNickText, config.autoNickPosition);
  if (!nextNick || nextNick === member.displayName) return false;
  await member.setNickname(nextNick, 'Otomatik takma ad ayarı');
  return true;
}

module.exports = { buildAutoNick, applyAutoNick };
