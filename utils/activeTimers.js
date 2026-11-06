// rolver/mute komutlarindaki canli geri sayimlarin (setInterval) referanslarini tutar.
// Boylece kullanici manuel olarak "Geri Al" / "Unmute" yaptiginda, hala calisan
// eski geri sayimi durdurup mesaji ikinci kez (yanlis bilgiyle) duzenlememis oluruz.

const timers = new Map();

function setActiveTimer(key, handle) {
  clearActiveTimer(key);
  timers.set(key, handle);
}

function clearActiveTimer(key) {
  const handle = timers.get(key);
  if (handle) {
    clearInterval(handle);
    clearTimeout(handle);
    timers.delete(key);
  }
}

module.exports = { setActiveTimer, clearActiveTimer };