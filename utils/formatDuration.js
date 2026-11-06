// Milisaniyeyi "1g 2s 3d 4sn" gibi okunabilir bir metne cevirir.
function formatRemaining(ms) {
  if (ms <= 0) return '0 saniye';

  const totalSeconds = Math.ceil(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days) parts.push(`${days}g`);
  if (hours) parts.push(`${hours}s`);
  if (minutes) parts.push(`${minutes}d`);
  if (seconds || parts.length === 0) parts.push(`${seconds}sn`);

  // Cok uzun surelerde sadece en buyuk 2 birimi goster (embed kisa kalsin).
  return parts.slice(0, 2).join(' ');
}

// Bir sonraki edit/tick icin ne kadar beklenmesi gerektigini kalan sureye gore secer.
// Kisa sureler saniye saniye, uzun sureler daha seyrek guncellenir (rate limit'e takilmamak icin).
function pickTickInterval(remainingMs) {
  if (remainingMs <= 60_000) return 1000;
  if (remainingMs <= 10 * 60_000) return 5000;
  if (remainingMs <= 60 * 60_000) return 15_000;
  return 60_000;
}

module.exports = { formatRemaining, pickTickInterval };