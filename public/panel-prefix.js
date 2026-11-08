// "Yazıyla komutlar" sekmesi: önek, silme ayarları ve komut listesi (ad, ek adlar, bağlı komut, yetki, bekleme).
(function () {
  let st = null; // { cfg, available, roles }
  let loading = false;
  const open = new Set(); // açık kartlar (ad)

  document.getElementById("tabs").addEventListener("click", e => {
    const b = e.target.closest("button[data-tab]");
    if (b && b.dataset.tab === "prefix") load();
  });

  async function load(force) {
    if ((st && !force) || loading) return;
    loading = true;
    try {
      const d = await api("prefix");
      st = { cfg: d.config, available: d.available, roles: d.roles };
      st.cfg.commands = st.cfg.commands.map(c => ({ ...c, aliases: [...(c.aliases || [])], roleIds: [...(c.roleIds || [])] }));
      draw();
    } catch (e) { toast(e.message, true); }
    loading = false;
  }

  const restricted = action => !!(st.available.find(a => a.name === action) || {}).restricted;
  const ACCESS = [["default", "Slash'taki gibi (Discord yetkisi)"], ["everyone", "Herkes"], ["roles", "Belirli roller"]];

  // Kartlardaki pickers'ı kayıt/yeniden çizimden önce komut nesnelerine yazar.
  function sync() {
    if (!st) return;
    st.cfg.enabled = $("pfOn").checked;
    st.cfg.prefix = $("pfPrefix").value.trim();
    st.cfg.deleteReplySeconds = Number($("pfDel").value || 0);
    st.cfg.deleteInvokerMessage = $("pfDelMsg").checked;
    st.cfg.commands.forEach(c => { if (c._picker) c.roleIds = c._picker.get(); });
  }

  function draw() {
    const cfg = st.cfg;
    $("pfOn").checked = cfg.enabled !== false;
    $("pfPrefix").value = cfg.prefix || ".";
    $("pfDel").value = cfg.deleteReplySeconds || 0;
    $("pfDelMsg").checked = !!cfg.deleteInvokerMessage;
    drawList();
  }

  function drawList() {
    const q = $("pfSearch").value.trim().toLowerCase();
    const prefix = st.cfg.prefix || ".";
    const cards = [];
    st.cfg.commands.forEach((c, idx) => {
      if (q && !(c.name.includes(q) || c.action.includes(q) || c.aliases.some(a => a.includes(q)))) return;
      cards.push(card(c, idx, prefix));
    });
    $("pfList").replaceChildren(...(cards.length ? cards : [el("p", { class: "hint", text: "Komut yok." })]));
  }

  const field = (label, input, hint) => el("div", { class: "fld" }, el("label", { text: label }), input, hint ? el("div", { class: "d", text: hint }) : null);

  function card(c, idx, prefix) {
    const list = st.cfg.commands;
    const details = el("details", { class: "pfc" });
    if (open.has(c._key || (c._key = Math.random().toString(36).slice(2)))) details.setAttribute("open", "");
    details.addEventListener("toggle", () => (details.open ? open.add(c._key) : open.delete(c._key)));

    const title = el("span", { class: "pfs" + (c.enabled ? "" : " off") }, el("b", { text: prefix + (c.name || "?") }),
      el("small", { text: "→ /" + c.action + (c.aliases.length ? " · " + c.aliases.join(", ") : "") + (c.enabled ? "" : " · kapalı") }));
    details.append(el("summary", {}, title, el("span", { class: "hint", text: "▾" })));

    const body = el("div", { class: "pfb" });

    const enabled = el("input", { type: "checkbox" }); enabled.checked = c.enabled;
    enabled.addEventListener("change", () => { c.enabled = enabled.checked; title.classList.toggle("off", !c.enabled); });
    body.append(el("label", { class: "chk" }, enabled, "Açık"));

    const name = el("input", { maxlength: "32", autocomplete: "off" }); name.value = c.name;
    name.addEventListener("input", () => { c.name = name.value.trim().toLowerCase(); title.firstChild.textContent = prefix + (c.name || "?"); });
    body.append(field("Komut adı (önek yazma)", name, "Örn. useradd yazarsan " + prefix + "useradd olur."));

    const aliases = el("input", { autocomplete: "off", placeholder: "virgülle ayır" }); aliases.value = c.aliases.join(", ");
    aliases.addEventListener("input", () => { c.aliases = aliases.value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean); });
    body.append(field("Ek adlar (virgülle)", aliases, "Aynı işi yapan başka adlar."));

    const action = el("select", {}, st.available.map(a => el("option", { value: a.name, text: "/" + a.name + " — " + a.description.slice(0, 50) })));
    action.value = c.action;
    action.addEventListener("change", () => {
      c.action = action.value;
      if (c.access === "everyone" && restricted(c.action)) { c.access = "default"; access.value = "default"; toast("Bu komut yetki gerektirir, erişim \"Slash'taki gibi\" yapıldı.", true); }
      title.lastChild.textContent = "→ /" + c.action + (c.aliases.length ? " · " + c.aliases.join(", ") : "");
    });
    body.append(field("Ne yapsın?", action));

    const rolesMount = el("div", {});
    const access = el("select", {}, ACCESS.map(([v, t]) => el("option", { value: v, text: t })));
    access.value = c.access;
    c._picker = rolePicker(rolesMount); c._picker.set(c.roleIds);
    const syncRoles = () => { rolesMount.parentElement.hidden = c.access !== "roles"; };
    access.addEventListener("change", () => {
      if (access.value === "everyone" && restricted(c.action)) { toast("/" + c.action + " yetki gerektiren bir komut, herkese açılamaz.", true); access.value = c.access; return; }
      c.access = access.value; syncRoles();
    });
    body.append(field("Kimler kullanabilsin?", access, "Yönetici ve sunucu sahibi her zaman kullanabilir."));
    body.append(el("div", { class: "fld" }, el("label", { text: "Kullanabilecek roller" }), rolesMount));
    syncRoles();

    const cd = el("input", { type: "number", min: "0", max: "3600" }); cd.value = c.cooldownSeconds || 0;
    cd.addEventListener("input", () => { c.cooldownSeconds = Number(cd.value || 0); });
    body.append(field("Bekleme süresi (saniye)", cd, "Kişi başı; 0 = sınırsız."));

    const help = el("input", { maxlength: "100" }); help.value = c.help || "";
    help.addEventListener("input", () => { c.help = help.value; });
    body.append(field("Yardım listesindeki açıklama", help));

    const move = d => () => { sync(); const j = idx + d; if (j < 0 || j >= list.length) return; [list[idx], list[j]] = [list[j], list[idx]]; drawList(); };
    body.append(el("div", { class: "pfacts" },
      el("button", { class: "btn alt", type: "button", text: "↑", onclick: move(-1) }),
      el("button", { class: "btn alt", type: "button", text: "↓", onclick: move(1) }),
      el("button", { class: "btn alt", type: "button", text: "Sil", onclick: () => { sync(); list.splice(idx, 1); drawList(); } })));

    details.append(body);
    return details;
  }

  const blank = action => ({ enabled: true, name: action, aliases: [], action, access: "default", roleIds: [], cooldownSeconds: 0, help: (st.available.find(a => a.name === action) || {}).description || "" });

  $("pfAdd").addEventListener("click", () => {
    if (!st) return;
    sync();
    const used = new Set(st.cfg.commands.flatMap(c => [c.name, ...c.aliases]));
    const first = st.available.find(a => !used.has(a.name)) || st.available[0];
    const c = blank(first.name);
    if (used.has(c.name)) c.name = c.name + "2";
    c._key = Math.random().toString(36).slice(2); open.add(c._key);
    st.cfg.commands.unshift(c);
    $("pfSearch").value = "";
    drawList();
  });

  $("pfAddAll").addEventListener("click", () => {
    if (!st) return;
    sync();
    const used = new Set(st.cfg.commands.flatMap(c => [c.name, ...c.aliases]));
    const have = new Set(st.cfg.commands.map(c => c.action));
    let n = 0;
    for (const a of st.available) if (!have.has(a.name) && !used.has(a.name)) { st.cfg.commands.push(blank(a.name)); n++; }
    drawList();
    toast(n ? n + " komut eklendi. Kaydetmeyi unutma." : "Eksik komut yok.");
  });

  $("pfSearch").addEventListener("input", () => { if (st) { sync(); drawList(); } });
  $("pfPrefix").addEventListener("input", () => { if (st) { sync(); drawList(); } });

  $("pfSave").addEventListener("click", async e => {
    if (!st) return;
    sync();
    const body = {
      enabled: st.cfg.enabled, prefix: st.cfg.prefix, deleteReplySeconds: st.cfg.deleteReplySeconds, deleteInvokerMessage: st.cfg.deleteInvokerMessage,
      commands: st.cfg.commands.map(({ enabled, name, aliases, action, access, roleIds, cooldownSeconds, help }) => ({ enabled, name, aliases, action, access, roleIds, cooldownSeconds, help })),
    };
    const ok = await run(e.currentTarget, async () => {
      const r = await api("prefix/save", body);
      st.cfg = { ...r.config, commands: r.config.commands.map(c => ({ ...c })) };
      return r;
    });
    if (ok) draw();
  });
})();
