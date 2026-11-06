// "10m", "2h", "1d", "30s" gibi metinleri milisaniyeye cevirir. Gecersizse null doner.
function parseDuration(input) {
  const match = /^(\d+)(s|m|h|d)$/i.exec(input?.trim() ?? '');
  if (!match) return null;

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
}

module.exports = { parseDuration };
