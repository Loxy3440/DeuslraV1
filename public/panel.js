const $ = id => document.getElementById(id);
let ROLES = [];
let groupsLoaded = false; // rol grubu seçicileri sadece ilk yüklemede doldurulur (kaydedilmemiş seçim ezilmesin)
const roleName = id => (ROLES.find(r => r.id === id) || {}).name || "silinmiş rol";

// Çoklu rol seçici: açılır listeden ekle, çipten kaldır.
function rolePicker(mount) {
  let ids = [];
  const sel = el("select", { "aria-label": "Rol ekle" });
  const chips = el("div", { class: "chips2" });
  const redraw = () => {
    sel.replaceChildren(el("option", { value: "", text: "Rol ekle…" }),
      ...ROLES.filter(r => !ids.includes(r.id) && !r.managed).map(r => el("option", { value: r.id, text: "@" + r.name })));
    chips.replaceChildren(...ids.map(id => el("span", { class: "c" }, "@" + roleName(id),
      el("button", { type: "button", "aria-label": "Kaldır", text: "×", onclick: () => { ids = ids.filter(x => x !== id); redraw(); } }))));
  };
  sel.addEventListener("change", () => { if (sel.value) { ids.push(sel.value); redraw(); } });
  mount.classList.add("rp"); mount.replaceChildren(sel, chips); redraw();
  return { get: () => [...ids], set: v => { ids = [...(v || [])]; redraw(); }, redraw };
}
const pickers = {};
const lockSub = r => (r.allowedRoleIds && r.allowedRoleIds.length ? " · 🔒 " + r.allowedRoleIds.map(roleName).join(", ") : "");

const TYPE = { WATCHING: "İzliyor", PLAYING: "Oynuyor", STREAMING: "Yayında", LISTENING: "Dinliyor", COMPETING: "Yarışıyor", CUSTOM: "Durum:" };

function toast(msg, err) {
  const t = $("toast");
  t.textContent = msg; t.className = "show" + (err ? " err" : "");
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ""), 3200);
}

async function api(path, body) {
  const opt = body === undefined
    ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Requested-With": "panel" }, body: JSON.stringify(body) };
  const res = await fetch("/api/admin/" + path, opt);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.reload(); throw new Error("Oturum bitti"); }
  if (!res.ok) throw new Error(data.error || "Hata (" + res.status + ")");
  return data;
}

// Güvenli DOM üretici: kullanıcı/üye metinleri asla innerHTML'e girmez.
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  kids.flat().forEach(c => c && e.append(c));
  return e;
}

async function run(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try { const r = await fn(); toast(r?.message || okMsg || "Kaydedildi"); return true; }
  catch (e) { toast(e.message, true); return false; }
  finally { if (btn) btn.disabled = false; }
}

function row(title, sub, ...actions) {
  return el("li", { class: "item" }, el("div", { class: "txt" }, el("div", { class: "t", text: title }), sub ? el("div", { class: "s", text: sub }) : null), el("div", { class: "acts" }, actions));
}

const fmtUp = s => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? d + "g " + h + "sa" : h ? h + "sa " + m + "dk" : m + "dk"; };
function renderStats(s) {
  if (!s) return;
  $("sMembers").textContent = s.members.toLocaleString("tr-TR"); $("sGuilds").textContent = s.guilds;
  $("sPing").textContent = s.ping > 0 ? s.ping + " ms" : "—"; $("sUp").textContent = fmtUp(s.uptime); $("sCmds").textContent = s.commands;
}
function render(d) {
  ROLES = d.roles || [];
  renderStats(d.stats);
  renderPresence(d.presence);
  renderLogSettings(d);
  Object.values(pickers).forEach(p => p.redraw());
  if (pickers.member && !groupsLoaded) { groupsLoaded = true; pickers.member.set(d.roleGroups.member); pickers.staff.set(d.roleGroups.staff); pickers.bot.set(d.roleGroups.bot); }
  $("intVal").value = d.activity.intervalSeconds;

  $("actList").replaceChildren(...d.activity.list.map((a, i) =>
    row(a.text, (TYPE[a.type] || a.type) + (a.state ? " · " + a.state : "") + (a.url ? " · " + a.url : ""),
      el("button", { class: "btn sm alt", text: "Düzenle", onclick: () => editActivity(i, a) }),
      el("button", { class: "btn sm danger", text: "Sil", onclick: e => run(e.target, async () => { await api("activity/remove", { index: i }); await load(); }, "Silindi") }))));

  const mk = (list, remove, fill) => list.map(r =>
    row(r.trigger, (r.response || "(sadece medya)") + (r.mediaUrl ? " 📎" : "") + (r.cooldownSeconds ? ` · ${r.cooldownSeconds}sn` : "") + lockSub(r),
      el("button", { class: "btn sm alt", text: "Düzenle", onclick: () => fill(r) }),
      el("button", { class: "btn sm danger", text: "Sil", onclick: e => run(e.target, async () => { await api(remove, { trigger: r.trigger }); await load(); }, "Silindi") })));

  const fillForm = (form, r, picker) => { for (const k of ["trigger", "response", "mediaUrl", "cooldownSeconds"]) if (form[k]) form[k].value = r[k] ?? (k === "cooldownSeconds" ? 3 : ""); picker.set(r.allowedRoleIds); form.scrollIntoView({ behavior: "smooth", block: "center" }); };
  $("menList").replaceChildren(...mk(d.mentionTriggers, "mention/remove", r => fillForm($("menForm"), r, pickers.men)));
  $("autoList").replaceChildren(...mk(d.autoResponses, "auto/remove", r => fillForm($("autoForm"), r, pickers.auto)));
  renderRankup(d);
}

// ---- Bot durumu ----
function renderPresence(p) {
  if (!p) return;
  if (p.bot) { $("bName").textContent = p.bot.name; $("bAvatar").src = p.bot.avatar; }
  $("bDot").className = "sdot " + p.status;
  const a = p.activity;
  const bub = $("bBubble"); bub.hidden = !p.custom; bub.textContent = p.custom || "";
  const verb = { WATCHING: "İzliyor", PLAYING: "Oynuyor", STREAMING: "Yayında", LISTENING: "Dinliyor", COMPETING: "Yarışıyor", CUSTOM: "Durum:" };
  $("bAct").textContent = a ? (verb[a.type] || "") + " " + a.text : "Aktivite yok";
  $("rpVerb").textContent = a ? (verb[a.type] || "") : "—";
  $("rpName").textContent = a ? a.text : "Aktivite yok";
  $("rpState").hidden = !(a && a.state); $("rpState").textContent = (a && a.state) || "";
  if (document.activeElement !== $("bsText")) $("bsText").value = p.customRaw || "";
  document.querySelectorAll("#statusPick .st").forEach(b => b.setAttribute("aria-checked", String(b.dataset.s === p.status)));
}
function wireStatus() {
  $("statusPick").addEventListener("click", async e => {
    const b = e.target.closest(".st"); if (!b || b.getAttribute("aria-checked") === "true") return;
    const all = document.querySelectorAll("#statusPick .st"); all.forEach(x => (x.disabled = true));
    try { const r = await api("status", { status: b.dataset.s }); renderPresence(r.presence); toast("Bot durumu değişti"); }
    catch (err) { toast(err.message, true); }
    finally { all.forEach(x => (x.disabled = false)); }
  });
}

// ---- Log ----
const LOGCAT = {};
let logSettingsDirty = false;
function renderLogSettings(d) {
  if (!d.log) return;
  Object.assign(LOGCAT, d.log.labels);
  if (!logSettingsDirty) {
    $("logChannel").replaceChildren(el("option", { value: "", text: "Log kapalı (sadece geçmiş tutulur)" }), ...(d.channels || []).map(c => el("option", { value: c.id, text: "#" + c.name })));
    $("logChannel").value = d.log.channelId || "";
    $("logCats").replaceChildren(...Object.entries(d.log.labels).map(([k, label]) => {
      const cb = el("input", { type: "checkbox", "data-k": k }); cb.checked = !!d.log.categories[k]; if (k === "mod") { cb.checked = true; cb.disabled = true; }
      return el("label", {}, cb, el("span", { text: label }));
    }));
    const f = $("logFilter"); const cur = f.value;
    f.replaceChildren(el("option", { value: "", text: "Tüm kategoriler" }), ...Object.entries(d.log.labels).map(([k, l]) => el("option", { value: k, text: l.split(" (")[0] })));
    f.value = cur;
  }
}
const fmtTime = iso => new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
async function loadLogs() {
  const cat = $("logFilter").value;
  const { entries } = await api("log" + (cat ? "?cat=" + encodeURIComponent(cat) : ""));
  $("logList").replaceChildren(...entries.map(e => el("li", { class: "item" },
    el("div", { class: "txt" }, el("div", { class: "t", text: e.title }), el("div", { class: "s", text: e.text })),
    el("div", { class: "tm", text: fmtTime(e.at) }))));
}
function wireLog() {
  $("logCats").addEventListener("change", () => (logSettingsDirty = true));
  $("logChannel").addEventListener("change", () => (logSettingsDirty = true));
  $("logSave").addEventListener("click", e => run(e.target, async () => {
    const categories = Object.fromEntries([...document.querySelectorAll("#logCats input")].map(i => [i.dataset.k, i.checked]));
    await api("log/save", { channelId: $("logChannel").value, categories });
    logSettingsDirty = false; await load();
  }, "Log ayarları kaydedildi"));
  $("logRefresh").addEventListener("click", e => run(e.target, async () => { await loadLogs(); return { message: "Yenilendi" }; }));
  $("logFilter").addEventListener("change", () => loadLogs().catch(err => toast(err.message, true)));
}

// ---- Auto rank up (iki kategori: üye / yetkili) ----
const RK_CATS = { uye: "Üye", yetkili: "Yetkili" };
const rkEmpty = () => ({ enabled: false, channelId: "", steps: [] });
const RK = { cat: "uye", data: { uye: rkEmpty(), yetkili: rkEmpty() }, dirty: { uye: false, yetkili: false }, channels: [] };
const rkCur = () => RK.data[RK.cat];
function renderRankup(d) {
  for (const c of Object.keys(RK_CATS)) {
    const s = d.autoRankup && d.autoRankup[c];
    if (s && !RK.dirty[c]) RK.data[c] = { enabled: !!s.enabled, channelId: s.channelId || "", steps: s.steps.map(x => ({ ...x })) };
  }
  RK.channels = d.channels || [];
  drawRankup();
}
function drawRankup() {
  const cur = rkCur(), label = RK_CATS[RK.cat];
  document.querySelectorAll("#rkCats button").forEach(b => b.classList.toggle("on", b.dataset.cat === RK.cat));
  $("rkEnabled").checked = cur.enabled;
  $("rkEnabledText").textContent = label + " sistemi açık";
  $("rkChannel").replaceChildren(el("option", { value: "", text: "Duyuru yok" }), ...RK.channels.map(c => el("option", { value: c.id, text: "#" + c.name })));
  $("rkChannel").value = cur.channelId;
  // Başka kategoride kullanılan roller listelenmez (bir rol tek kategoride olabilir).
  const taken = new Set(Object.keys(RK_CATS).filter(c => c !== RK.cat).flatMap(c => RK.data[c].steps.map(s => s.roleId)));
  $("rkRole").replaceChildren(el("option", { value: "", text: cur.steps.length ? "Sıradaki rol…" : "Başlangıç rolü…" }),
    ...ROLES.filter(r => !r.managed && !taken.has(r.id) && !cur.steps.some(s => s.roleId === r.id)).map(r => el("option", { value: r.id, text: "@" + r.name })));
  $("rkInv").hidden = cur.steps.length === 0; // ilk rol (başlangıç) için davet gerekmez
  const touch = () => { RK.dirty[RK.cat] = true; drawRankup(); };
  const move = (i, to) => { const [x] = cur.steps.splice(i, 1); cur.steps.splice(to, 0, x); touch(); };
  $("rkList").replaceChildren(...cur.steps.map((s, i) => row(
    (i + 1) + ". @" + roleName(s.roleId),
    i === 0 ? "Başlangıç rolü (davet gerekmez)" : "Bir önceki rolden sonra " + (Number(s.invites) || 1) + " davet" + (Number(s.partners) > 0 ? " veya " + Number(s.partners) + " partner" : "") + " · rank alınca sayaç sıfırlanır",
    i > 0 ? el("button", { class: "btn sm alt", type: "button", text: "▲", "aria-label": "Yukarı", onclick: () => move(i, i - 1) }) : null,
    i < cur.steps.length - 1 ? el("button", { class: "btn sm alt", type: "button", text: "▼", "aria-label": "Aşağı", onclick: () => move(i, i + 1) }) : null,
    i > 0 ? el("button", { class: "btn sm alt", type: "button", text: "Partner", onclick: () => { const n = Math.floor(Number(prompt("Gereken partner (0 = partner ile terfi kapalı, 1000 max):", s.partners || 0))); if (n >= 0 && n <= 1000) { s.partners = n; touch(); } } }) : null,
    i > 0 ? el("button", { class: "btn sm alt", type: "button", text: "Davet", onclick: () => { const n = Math.floor(Number(prompt("Gereken davet (1-1000):", s.invites || 1))); if (n >= 1 && n <= 1000) { s.invites = n; touch(); } } }) : null,
    el("button", { class: "btn sm danger", type: "button", text: "Sil", onclick: () => { cur.steps.splice(i, 1); touch(); } }))));
}
function wireRankup() {
  $("rkCats").addEventListener("click", e => { const b = e.target.closest("button[data-cat]"); if (b) { RK.cat = b.dataset.cat; drawRankup(); } });
  $("rkEnabled").addEventListener("change", e => { rkCur().enabled = e.target.checked; RK.dirty[RK.cat] = true; });
  $("rkChannel").addEventListener("change", e => { rkCur().channelId = e.target.value; RK.dirty[RK.cat] = true; });
  $("rkForm").addEventListener("submit", e => {
    e.preventDefault();
    const cur = rkCur(), roleId = $("rkRole").value;
    if (!roleId) return toast("Bir rol seç", true);
    let invites = 0;
    if (cur.steps.length) {
      invites = Math.floor(Number($("rkInv").value));
      if (!(invites >= 1 && invites <= 1000)) return toast("Gereken davet 1 ile 1000 arasında olmalı", true);
    }
    cur.steps.push({ roleId, invites, partners: 0 }); RK.dirty[RK.cat] = true; $("rkInv").value = ""; drawRankup();
  });
  $("rkSave").addEventListener("click", e => {
    const cat = RK.cat, cur = rkCur();
    return run(e.target, async () => {
      await api("rankup/save", { category: cat, enabled: $("rkEnabled").checked, channelId: $("rkChannel").value, steps: cur.steps.map((s, i) => ({ roleId: s.roleId, invites: i === 0 ? 0 : Math.max(1, Number(s.invites) || 1), partners: i === 0 ? 0 : Math.max(0, Number(s.partners) || 0) })) });
      RK.dirty[cat] = false;
      await load();
    }, RK_CATS[cat] + " auto rank up kaydedildi");
  });
}
async function load() { render(await api("overview")); }

function formData(form) { return Object.fromEntries(new FormData(form)); }

// ---- İstatistik ----
async function loadStats() {
  const d = await api("stats");
  const draw = (id, list) => $(id).replaceChildren(...(list.length ? list.map((r, i) => el("li", { class: "item" },
    el("div", { class: "txt" }, el("div", { class: "t", text: (["🥇", "🥈", "🥉"][i] || (i + 1) + ".") + " " + r.name })), el("div", { class: "tm", text: r.value }))) : [el("li", { class: "item" }, el("div", { class: "s", text: "Henüz veri yok." }))]));
  draw("stMsg", d.messages); draw("stVoice", d.voice);
}

// ---- Oto nick ----
async function loadAutoNick() {
  const d = await api("autonick");
  $("anOn").checked = d.enabled; $("anText").value = d.text; $("anPos").value = d.position; $("anBots").checked = d.includeBots;
}
function wireAutoNick() {
  $("anSave").addEventListener("click", e => run(e.target, async () => api("autonick/save", { enabled: $("anOn").checked, text: $("anText").value, position: $("anPos").value, includeBots: $("anBots").checked })));
}

// ---- Durum yazısı rolü ----
async function loadDurum() {
  const [d, ov] = await Promise.all([api("durum"), api("overview")]);
  $("duWarn").hidden = d.presence;
  $("duOn").checked = Boolean(d.text && d.roleId);
  $("duText").value = d.text;
  $("duRole").replaceChildren(el("option", { value: "", text: "Rol seç" }), ...ov.roles.filter(r => !r.managed).map(r => el("option", { value: r.id, text: "@" + r.name })));
  $("duChannel").replaceChildren(el("option", { value: "", text: "Kanal seç" }), ...ov.channels.map(c => el("option", { value: c.id, text: "#" + c.name })));
  $("duRole").value = d.roleId; $("duChannel").value = d.channelId;
}
function wireDurum() {
  $("duSave").addEventListener("click", e => run(e.target, async () => api("durum/save", { enabled: $("duOn").checked, text: $("duText").value, roleId: $("duRole").value, channelId: $("duChannel").value })));
  $("stRefresh").addEventListener("click", e => run(e.target, async () => { await loadStats(); return { message: "Yenilendi" }; }));
}

// ---- Aktivite formu: ekleme / düzenleme modu ----
function resetActForm() {
  const f = $("actForm");
  f.reset(); $("actIndex").value = "";
  $("actSubmit").textContent = "Ekle"; $("actCancel").hidden = true;
  f.elements.type.dispatchEvent(new Event("change"));
}
function editActivity(i, a) {
  const f = $("actForm");
  if (a.type === "CUSTOM") { toast("Eski 'durum yazısı' kaydı düzenlenemez; sil ve yeniden ekle.", true); return; }
  $("actIndex").value = String(i);
  f.elements.type.value = a.type; f.elements.text.value = a.text || ""; $("actState").value = a.state || ""; $("actUrl").value = a.url || "";
  f.elements.type.dispatchEvent(new Event("change"));
  $("actSubmit").textContent = "Kaydet"; $("actCancel").hidden = false;
  f.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---- Rich Presence (sadece ac/kapat; icerik utils/richPresence.js taslaginda) ----
const URP_VERB = { 0: "oynuyor", 2: "dinliyor", 3: "izliyor", 5: "yarışıyor" };
function fillUrp(d) {
  $("urpOn").checked = !!d.enabled;
  const t = d.template || {};
  $("urpHead").textContent = (t.name || "Uygulama") + " " + (URP_VERB[t.type] || "");
  $("urpD").textContent = t.details || ""; $("urpS").textContent = t.state || "";
  $("urpE").hidden = !t.timer || t.timer === "yok"; $("urpE").textContent = "⏱ süre sayacı açık";
}
async function loadUserRp() { fillUrp(await api("rp")); }
function wireUserRp() {
  $("urpForm").addEventListener("submit", e => { e.preventDefault(); run($("urpSave"), async () => { const r = await api("rp/save", { enabled: $("urpOn").checked }); fillUrp(r); return r; }); });
}

// ---- Komut ekle ----
async function loadCmdAdd() {
  const d = await api("cmdlist");
  $("cmGh").textContent = d.github.enabled
    ? "GitHub bağlı: eklediğin komutlar " + d.github.repo + " (" + d.github.branch + ") deposuna da yazılır."
    : "⚠️ GITHUB_TOKEN tanımlı değil: komut hemen çalışır ama GitHub'a yazılmaz, bot yeniden başlayınca kaybolur.";
  $("cmList").replaceChildren(...(d.commands.length ? d.commands : []).map(c => row("/" + c.name,
    (c.description || "") + (c.github ? " · GitHub ✓" : " · GitHub ✗"),
    el("button", { class: "btn sm", type: "button", text: "Sil", onclick: e => { if (!confirm("/" + c.name + " silinsin mi?")) return; run(e.target, async () => { const r = await api("cmd/remove", { name: c.name }); await loadCmdAdd(); return r; }); } }))));
  if (!d.commands.length) $("cmList").replaceChildren(el("li", { class: "item" }, el("div", { class: "txt" }, el("div", { class: "s", text: "Henüz panelden eklenen komut yok." }))));
}
function wireCmdAdd() {
  $("cmForm").addEventListener("submit", e => {
    e.preventDefault();
    run($("cmSave"), async () => {
      const r = await api("cmd/create", { name: $("cmName").value, description: $("cmDesc").value, reply: $("cmReply").value, embed: $("cmEmbed").checked, title: $("cmTitle").value, color: $("cmColor").value, ephemeral: $("cmEph").checked });
      $("cmName").value = ""; $("cmDesc").value = ""; $("cmReply").value = "";
      await loadCmdAdd(); return r;
    });
  });
  $("cmUp").addEventListener("click", () => {
    const f = $("cmFile").files[0];
    if (!f) { toast("Önce bir .js dosyası seç.", true); return; }
    if (!f.name.endsWith(".js")) { toast("Sadece .js dosyası yüklenebilir.", true); return; }
    if (f.size > 100000) { toast("Dosya 100 KB'tan büyük olamaz.", true); return; }
    run($("cmUp"), async () => { const code = await f.text(); const r = await api("cmd/upload", { code }); $("cmFile").value = ""; await loadCmdAdd(); return r; });
  });
}

function wireBotStatus() {
  $("bsForm").addEventListener("submit", e => { e.preventDefault(); run(e.target.querySelector("button"), async () => { const r = await api("botstatus", { text: $("bsText").value.trim() }); renderPresence(r.presence); }, "Durum yazısı kaydedildi"); });
}

function wire() {
  pickers.men = rolePicker($("menRoles")); pickers.auto = rolePicker($("autoRoles"));
  pickers.member = rolePicker($("grpMember")); pickers.staff = rolePicker($("grpStaff")); pickers.bot = rolePicker($("grpBot"));
  $("grpSave").addEventListener("click", e => run(e.target, async () => {
    await api("roles/save", { member: pickers.member.get(), staff: pickers.staff.get(), bot: pickers.bot.get() });
    await load();
  }, "Roller kaydedildi"));

  wireRankup(); wireStatus(); wireLog(); wireDurum(); wireAutoNick(); wireBotStatus(); wireUserRp(); wireCmdAdd();
  $("tabs").addEventListener("click", e => {
    const b = e.target.closest("button[data-tab]"); if (!b) return;
    document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("on", x === b));
    $("pageTitle").textContent = b.lastChild.textContent.trim();
    document.querySelectorAll(".pane").forEach(p => (p.hidden = p.id !== "pane-" + b.dataset.tab));
    if (b.dataset.tab === "stats") loadStats().catch(err => toast(err.message, true));
    if (b.dataset.tab === "userrp") { loadUserRp().catch(err => toast(err.message, true)); }
    if (b.dataset.tab === "cmdadd") loadCmdAdd().catch(err => toast(err.message, true));
    if (b.dataset.tab === "autonick") loadAutoNick().catch(err => toast(err.message, true));
    if (b.dataset.tab === "durum") loadDurum().catch(err => toast(err.message, true));
    if (b.dataset.tab === "log") loadLogs().catch(err => toast(err.message, true));
  });

  const submit = (id, path, tweak, after) => $(id).addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, body = tweak ? tweak(formData(f)) : formData(f);
    if (await run(f.querySelector("button"), async () => { await api(path, body); await load(); })) { after?.(f); }
  });
  // Yayında seçilince Twitch/YouTube adresi alanı açılır.
  const actType = $("actForm").elements.type, actUrl = $("actUrl");
  const syncUrl = () => { const on = actType.value === "STREAMING"; actUrl.hidden = !on; actUrl.required = on; };
  actType.addEventListener("change", syncUrl); syncUrl();
  $("actCancel").addEventListener("click", resetActForm);
  $("actForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, d = formData(f), editing = d.index !== "";
    const body = { type: d.type, text: d.text, state: d.state || "" };
    if (d.type === "STREAMING") body.url = d.url;
    if (editing) body.index = Number(d.index);
    if (await run($("actSubmit"), async () => { await api(editing ? "activity/update" : "activity/add", body); await load(); }, editing ? "Aktivite güncellendi" : "Aktivite eklendi")) resetActForm();
  });
  submit("intForm", "activity/interval", d => ({ seconds: Number(d.seconds) }));
  submit("menForm", "mention/upsert", d => ({ ...d, allowedRoleIds: pickers.men.get() }), f => { f.reset(); pickers.men.set([]); });
  submit("autoForm", "auto/upsert", d => ({ ...d, cooldownSeconds: Number(d.cooldownSeconds) || 3, allowedRoleIds: pickers.auto.get() }), f => { f.reset(); f.cooldownSeconds.value = 3; pickers.auto.set([]); });

  $("searchForm").addEventListener("submit", async e => {
    e.preventDefault();
    await run(e.target.querySelector("button"), async () => {
      const { members } = await api("members?q=" + encodeURIComponent($("q").value.trim()));
      $("memList").replaceChildren(...members.map(memberRow));
      if (!members.length) toast("Üye bulunamadı", true); else return { message: members.length + " üye bulundu" };
    });
  });
}

function memberRow(m) {
  const act = (label, cls, fn) => el("button", { class: "btn sm " + cls, text: label, onclick: e => fn(e.target) });
  const li = el("li", { class: "item" },
    el("div", { class: "who2" }, el("img", { src: m.avatar, alt: "" }), el("div", { class: "txt" }, el("div", { class: "t", text: m.name }), el("div", { class: "s", text: m.tag + (m.mutedUntil ? " · susturulu" : "") }))),
    el("div", { class: "acts" },
      act("Sustur", "alt", b => {
        const d = prompt("Süre (10m, 2h, 1d):", "10m"); if (!d) return;
        const reason = prompt("Sebep (isteğe bağlı):", "") || "";
        run(b, () => api("mute", { userId: m.id, duration: d, reason }));
      }),
      act("Susturmayı kaldır", "alt", b => run(b, () => api("unmute", { userId: m.id }))),
      act("At", "danger", b => {
        if (!confirm(m.tag + " sunucudan atılsın mı?")) return;
        run(b, () => api("kick", { userId: m.id, reason: prompt("Sebep (isteğe bağlı):", "") || "" }));
      })));
  return li;
}

(async function init() {
  const err = new URLSearchParams(location.search).get("err");
  const msgs = { forbidden: "Bu hesabın panele girme yetkisi yok.", login: "Giriş tamamlanamadı. Tekrar dene.", state: "Giriş doğrulaması başarısız. Tekrar dene." };
  const me = await fetch("/api/me", { credentials: "same-origin" }).then(r => r.json()).catch(() => ({ loggedIn: false }));
  if (!me.loggedIn) {
    $("login").hidden = false;
    if (err && msgs[err]) $("loginMsg").textContent = msgs[err];
    return;
  }
  $("who").hidden = false; $("whoName").textContent = me.user.name; if (me.user.avatar) $("whoImg").src = me.user.avatar; else $("whoImg").hidden = true;
  $("app").hidden = false; $("side").hidden = false;
  wire();
  try { await load(); } catch (e) { toast(e.message, true); }
})();
