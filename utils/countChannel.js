// Sayaç kanalı: kanal adında sunucunun toplam üye sayısını (botlar dahil) gösterir.
// Discord kanal adı değişikliğini 10 dakikada en fazla 2 kez kabul eder; bu yüzden güncellemeler
// en az MIN_GAP aralıkla yapılır, art arda gelen katılım/ayrılmalar tek güncellemede birleşir.
const { PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('./guildConfig');

const MIN_GAP = Number(process.env.COUNT_MIN_GAP_MS) || 6 * 60 * 1000;
const DEFAULT_FORMAT = 'Üye Sayısı: {sayi}';
const state = new Map(); // guildId -> { last, timer }

const renderName = (format, count) => String(format || DEFAULT_FORMAT).replace(/\{sayi\}/gi, count.toLocaleString('tr-TR')).slice(0, 100);
// Yazı kanallarında Discord adı küçük harfe çevirip boşlukları "-" yapar; karşılaştırırken bunu hesaba kat.
const normalize = (name, channel) => (channel.isVoiceBased?.() ? name : name.toLowerCase().replace(/\s+/g, '-'));

async function updateNow(guild) {
  const config = await getConfig(guild.id);
  if (!config.countChannelId) return 'kapalı';
  const channel = guild.channels.cache.get(config.countChannelId) || (await guild.channels.fetch(config.countChannelId).catch(() => null));
  if (!channel) return 'kanal yok';

  const me = guild.members.me;
  if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) return 'yetki yok';

  const name = renderName(config.countFormat, guild.memberCount);
  if (channel.name === normalize(name, channel)) return 'güncel';

  const st = state.get(guild.id) || {};
  await channel.setName(name, 'Üye sayacı');
  state.set(guild.id, { ...st, last: Date.now() });
  return 'güncellendi';
}

// Üye sayısı değişince çağrılır: sıradaki uygun zamanda tek bir güncelleme planlar.
function scheduleUpdate(guild) {
  const st = state.get(guild.id) || {};
  if (st.timer) return; // zaten planlı, çalışınca en güncel sayıyı okur
  const wait = Math.max(3000, MIN_GAP - (Date.now() - (st.last || 0)));
  const timer = setTimeout(async () => {
    state.set(guild.id, { ...(state.get(guild.id) || {}), timer: null });
    try { await updateNow(guild); } catch (err) { console.error('[CKANAL]', guild.id, err.message); }
  }, wait);
  timer.unref?.();
  state.set(guild.id, { ...st, timer });
}

function startCountSweep(client) {
  const run = () => client.guilds.cache.forEach(g => scheduleUpdate(g));
  run();
  setInterval(run, MIN_GAP).unref?.();
}

module.exports = { updateNow, scheduleUpdate, startCountSweep, renderName, DEFAULT_FORMAT };
