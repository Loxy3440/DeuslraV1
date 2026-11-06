// "Tüm komutlar" sekmesi: komut tanımından form üretir, çalıştırır, sonucu gösterir.
(function () {
  const T = { SUB: 1, STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, MENTIONABLE: 9, NUMBER: 10, ATTACHMENT: 11 };
  const GOTO = { activity: "Aktivite", mention: "Etiket cevapları", auto: "Otomatik mesaj" };
  let commands = null, meta = null, loading = false;

  async function ensureLoaded() {
    if (commands || loading) return;
    loading = true;
    try {
      [commands, meta] = await Promise.all([api("commands").then(r => r.commands), api("meta")]);
      renderChips("");
    } catch (e) { toast(e.message, true); }
    loading = false;
  }

  document.getElementById("tabs").addEventListener("click", e => { if (e.target.dataset?.tab === "commands") ensureLoaded(); });
  $("cmdSearch").addEventListener("input", e => renderChips(e.target.value.trim().toLowerCase()));

  function renderChips(q) {
    if (!commands) return;
    $("cmdChips").replaceChildren(...commands
      .filter(c => !q || c.name.includes(q) || c.description.toLowerCase().includes(q))
      .map(c => el("button", { class: "chip" + (c.danger ? " dg" : ""), type: "button", onclick: () => openForm(c) },
        "/" + c.name, el("small", { text: c.description }))));
  }

  function showList() { $("cmdForm").hidden = true; $("cmdList").hidden = false; $("cmdResult").replaceChildren(); }

  // --- alan üreticileri ---
  function userPicker(def, state) {
    const input = el("input", { placeholder: "Üye adı ya da ID", autocomplete: "off" });
    const res = el("div", { class: "res" });
    const chosen = el("div", { class: "chosen" });
    let timer;
    input.addEventListener("input", () => {
      state[def.name] = "";
      chosen.textContent = "";
      const v = input.value.trim();
      if (/^\d{15,25}$/.test(v)) { state[def.name] = v; chosen.textContent = "ID: " + v; res.replaceChildren(); return; }
      clearTimeout(timer);
      if (v.length < 2) { res.replaceChildren(); return; }
      timer = setTimeout(async () => {
        try {
          const { members } = await api("members?q=" + encodeURIComponent(v));
          res.replaceChildren(...members.map(m => el("button", { type: "button", onclick: () => { state[def.name] = m.id; input.value = m.tag; chosen.textContent = "Seçildi: " + m.name; res.replaceChildren(); } },
            el("img", { src: m.avatar, alt: "" }), m.name + " (" + m.tag + ")")));
        } catch (e) { toast(e.message, true); }
      }, 300);
    });
    return el("div", { class: "pick" }, input, res, chosen);
  }

  function selectOf(items, label, onChange) {
    const s = el("select", {}, el("option", { value: "", text: label }), items.map(i => el("option", { value: i.value, text: i.text })));
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }

  function fieldFor(def, state) {
    let control;
    switch (def.type) {
      case T.USER: case T.MENTIONABLE: control = userPicker(def, state); break;
      case T.ROLE:
        control = selectOf(meta.roles.map(r => ({ value: r.id, text: "@" + r.name + (r.managed ? " (bot rolü)" : "") })), "Rol seç…", v => (state[def.name] = v)); break;
      case T.CHANNEL: {
        const types = def.channelTypes;
        const list = meta.channels.filter(c => !types || types.includes(c.type));
        control = selectOf(list.map(c => ({ value: c.id, text: (c.type === 2 || c.type === 13 ? "🔊 " : "# ") + c.name })), "Kanal seç…", v => (state[def.name] = v)); break;
      }
      case T.BOOLEAN: {
        const cb = el("input", { type: "checkbox" });
        cb.addEventListener("change", () => (state[def.name] = cb.checked));
        state[def.name] = false;
        control = el("label", { class: "check" }, cb, el("span", { text: def.description }));
        break;
      }
      case T.INTEGER: case T.NUMBER: {
        const i = el("input", { type: "number", inputmode: "numeric" });
        if (def.min != null) i.min = def.min; if (def.max != null) i.max = def.max;
        i.addEventListener("input", () => (state[def.name] = i.value));
        control = i; break;
      }
      case T.ATTACHMENT: {
        const i = el("input", { type: "url", placeholder: "https://… resim/dosya adresi" });
        i.addEventListener("input", () => (state[def.name] = i.value));
        control = i; break;
      }
      default: {
        if (def.choices) { control = selectOf(def.choices.map(c => ({ value: c.value, text: c.name })), "Seç…", v => (state[def.name] = v)); break; }
        const i = el(def.maxLength > 150 ? "textarea" : "input", { placeholder: def.description });
        if (def.maxLength) i.maxLength = def.maxLength;
        if (i.tagName === "TEXTAREA") i.rows = 3;
        i.addEventListener("input", () => (state[def.name] = i.value));
        control = i;
      }
    }
    const label = el("label", {}, def.name.replace(/[-_]/g, " "), def.required ? el("b", { text: " *" }) : null);
    return el("div", { class: "fld" }, def.type === T.BOOLEAN ? null : label, control, def.type === T.BOOLEAN || !def.description ? null : el("div", { class: "d", text: def.description }));
  }

  // --- form ---
  function openForm(cmd) {
    $("cmdList").hidden = true; $("cmdResult").replaceChildren();
    const form = $("cmdForm"); form.hidden = false;
    const state = {}; let sub = cmd.subcommands.length ? cmd.subcommands[0].name : null; let channelId = "";
    const fields = el("div");
    const back = el("button", { class: "back", type: "button", text: "← Komutlar", onclick: showList });
    const head = [back, el("h2", { text: "/" + cmd.name }), el("p", { class: "hint", text: cmd.description })];

    if (cmd.blocked) { form.replaceChildren(...head, el("div", { class: "note bad", text: cmd.blocked })); return; }

    const notes = [];
    if (cmd.tab) notes.push(el("div", { class: "note", text: "Bu komutun menüleri Discord'a özel. Panelde bunun için hazır bir sekme var: “" + GOTO[cmd.tab] + "”." }));

    const drawFields = () => {
      for (const k of Object.keys(state)) delete state[k];
      const sc = cmd.subcommands.find(s => s.name === sub);
      const defs = sc ? sc.options : cmd.options;
      fields.replaceChildren(...defs.map(d => fieldFor(d, state)));
    };

    let subSel = null;
    if (cmd.subcommands.length) {
      subSel = el("div", { class: "fld" }, el("label", { text: "Alt komut" }), (() => {
        const s = el("select", {}, cmd.subcommands.map(x => el("option", { value: x.name, text: x.name + " — " + x.description })));
        s.addEventListener("change", () => { sub = s.value; drawFields(); });
        return s;
      })());
    }
    drawFields();

    let chSel = null;
    if (cmd.needsChannel) {
      chSel = el("div", { class: "fld" }, el("label", {}, "İşlem yapılacak kanal", el("b", { text: " *" })),
        selectOf(meta.channels.filter(c => c.type !== 2 && c.type !== 13).map(c => ({ value: c.id, text: "# " + c.name })), "Kanal seç…", v => (channelId = v)),
        el("div", { class: "d", text: "Komut Discord'da yazıldığı kanalda çalışır; panelde bu kanalı sen seçersin." }));
    }

    const btn = el("button", { class: "btn", type: "submit", text: "Çalıştır" });
    const f = el("form", { class: "stack", onsubmit: async e => {
      e.preventDefault();
      if (cmd.danger) {
        const warning = cmd.name === "allmute"
          ? "Bulunduğun ses kanalındaki seçilen üyeler susturulacak. Devam edilsin mi?"
          : "/" + cmd.name + " çalıştırılsın mı? Bu işlem geri alınamayabilir.";
        if (!confirm(warning)) return;
      }
      btn.disabled = true;
      try {
        const { jobId } = await api("commands/run", { name: cmd.name, sub, values: state, channelId });
        await poll(jobId);
      } catch (err) { toast(err.message, true); }
      btn.disabled = false;
    } }, subSel, fields, chSel, cmd.danger ? el("div", { class: "note bad", text: cmd.name === "allmute" ? "Bulunduğun ses kanalındaki seçilen üyeler susturulacak; bot hesaplarını da seçebilirsin. Çalıştırmadan önce onay istenecek." : "Dikkat: bu komut çalışınca geri alınamayabilir. Çalıştırmadan önce onay istenecek." }) : null, btn);
    form.replaceChildren(...head, ...notes, f);
  }

  // --- sonuç ---
  async function poll(jobId) {
    const box = $("cmdResult");
    box.replaceChildren(el("div", { class: "rout spin", text: "Çalışıyor…" }));
    for (let n = 0; n < 400; n++) {
      const j = await api("commands/job?id=" + jobId);
      if (j.status !== "running" || j.outputs.length) renderOut(box, j);
      if (j.status !== "running") { toast(j.status === "done" ? "Tamamlandı" : "Hata", j.status !== "done"); return; }
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  function renderOut(box, j) {
    const parts = [];
    for (const o of j.outputs) {
      if (o.content) parts.push(el("div", { class: "txt-out", text: o.content }));
      for (const e of o.embeds) {
        const kids = [];
        if (e.author) kids.push(el("div", { class: "ft", text: e.author }));
        if (e.title) kids.push(el("h4", { text: e.title }));
        if (e.description) kids.push(el("p", { text: e.description }));
        for (const f of e.fields) kids.push(el("div", { class: "f" }, el("b", { text: f.name }), el("span", { text: f.value })));
        if (e.image && /^https?:/.test(e.image)) kids.push(el("img", { src: e.image, alt: "" }));
        if (e.footer) kids.push(el("div", { class: "ft", text: e.footer }));
        const card = el("div", { class: "emb" }, kids);
        if (e.color != null) card.style.borderLeftColor = "#" + e.color.toString(16).padStart(6, "0");
        parts.push(card);
      }
      if (o.hasComponents) parts.push(el("div", { class: "note", text: "Bu cevaptaki düğme/menüler sadece Discord'da çalışır. İşlemin kendisi yapıldı." }));
      if (o.files) parts.push(el("div", { class: "note", text: "Komut dosya da gönderdi; dosyalar sadece Discord'da görünür." }));
    }
    if (j.status === "running") parts.push(el("div", { class: "spin", text: "Hâlâ çalışıyor…" }));
    if (j.error) parts.push(el("div", { class: "note bad", text: j.error }));
    box.replaceChildren(el("div", { class: "rout" }, parts));
  }
})();
