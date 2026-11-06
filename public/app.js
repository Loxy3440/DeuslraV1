// Dashboard başka yerde (ör. GitHub Pages) açılırsa botun Render adresini buraya yaz.
// Bot aynı adresten yayın yapıyorsa boş bırak.
const API_BASE = "";

const $ = id => document.getElementById(id);
const fmt = n => (n == null ? "–" : Number(n).toLocaleString("tr-TR"));
const history = [];
let lastMembers = null;

function fmtUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}g ${h}s` : h ? `${h}s ${m}dk` : `${m}dk`;
}

function drawSpark() {
  if (history.length < 2) return;
  $("spark").style.display = "block";
  const min = Math.min(...history), max = Math.max(...history), span = max - min || 1;
  const pts = history.map((v, i) => `${(i / (history.length - 1)) * 300},${55 - ((v - min) / span) * 50}`);
  $("sparkLine").setAttribute("d", "M" + pts.join(" L"));
  $("sparkNote").textContent = `Bu oturumdaki değişim: ${fmt(min)} – ${fmt(max)}`;
}

function setLive(ok, text) {
  $("live").className = "live " + (ok ? "ok" : "bad");
  $("liveText").textContent = text;
}

async function load() {
  try {
    const res = await fetch(API_BASE + "/api/stats", { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    const s = await res.json();

    if (!s.ready) { setLive(false, "Bot başlıyor"); return; }
    setLive(true, "Canlı");

    if (s.guildName) $("guildName").textContent = s.guildName;
    if (s.guildIcon) { $("guildIcon").src = s.guildIcon; $("guildIcon").hidden = false; }

    $("members").textContent = fmt(s.members);
    if (lastMembers !== null && lastMembers !== s.members) {
      $("members").classList.remove("bump"); void $("members").offsetWidth; $("members").classList.add("bump");
    }
    lastMembers = s.members;
    history.push(s.members); if (history.length > 60) history.shift();
    drawSpark();

    $("channels").textContent = fmt(s.channels);
    $("roles").textContent = fmt(s.roles);
    $("boosts").textContent = fmt(s.boosts);
    $("tier").textContent = s.boostTier != null ? `Seviye ${s.boostTier}` : "";
    $("commands").textContent = fmt(s.commands);
    $("ping").textContent = s.ping >= 0 ? s.ping + " ms" : "–";
    $("uptime").textContent = fmtUptime(s.uptime);
    if (s.bot) $("botTag").textContent = s.bot.tag;
    $("updated").textContent = "Son güncelleme " + new Date(s.time).toLocaleTimeString("tr-TR");
  } catch (e) {
    setLive(false, "Bağlantı yok");
  }
}

load();
setInterval(load, 5000);
