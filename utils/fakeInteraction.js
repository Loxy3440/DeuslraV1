// Panelden komut çalıştırmak için, Discord'un ChatInputCommandInteraction nesnesini taklit eder.
// Komutların kendi kodu (ban, rolver, dm...) hiç değişmeden çalışır.
const T = { SUB: 1, GROUP: 2, STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, MENTIONABLE: 9, NUMBER: 10, ATTACHMENT: 11 };

class PanelError extends Error {}

const IMG_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4' };

function makeAttachment(url) {
  let u;
  try { u = new URL(url); } catch { throw new PanelError('Dosya adresi geçersiz.'); }
  if (!/^https?:$/.test(u.protocol)) throw new PanelError('Dosya adresi http(s) olmalı.');
  const name = decodeURIComponent(u.pathname.split('/').pop() || 'dosya');
  const ext = name.split('.').pop().toLowerCase();
  return { id: '0', url: u.href, proxyURL: u.href, name, contentType: IMG_EXT[ext] || 'application/octet-stream', size: 0 };
}

// Form değerlerini komut seçeneği tanımına göre doğrular ve gerçek Discord nesnelerine çevirir.
async function resolveOptions({ command, sub, values, guild, client }) {
  const json = command.data.toJSON();
  let defs = json.options || [];
  let subName = null;
  if (defs.some(o => o.type === T.SUB)) {
    const s = defs.find(o => o.type === T.SUB && o.name === sub);
    if (!s) throw new PanelError('Alt komut seç.');
    subName = s.name;
    defs = s.options || [];
  }

  const out = {}; // name -> { type, value, user?, member? }
  for (const def of defs) {
    const raw = values?.[def.name];
    const empty = raw === undefined || raw === null || raw === '';
    if (empty) {
      if (def.required && def.type !== T.BOOLEAN) throw new PanelError(`"${def.name}" zorunlu.`);
      if (def.type === T.BOOLEAN) out[def.name] = { type: def.type, value: false };
      continue;
    }
    const v = typeof raw === 'string' ? raw.trim() : raw;
    let item = { type: def.type };
    switch (def.type) {
      case T.STRING:
        if (def.max_length && String(v).length > def.max_length) throw new PanelError(`"${def.name}" en fazla ${def.max_length} karakter.`);
        item.value = String(v);
        break;
      case T.INTEGER:
      case T.NUMBER: {
        const n = Number(v);
        if (!Number.isFinite(n) || (def.type === T.INTEGER && !Number.isInteger(n))) throw new PanelError(`"${def.name}" sayı olmalı.`);
        if (def.min_value != null && n < def.min_value) throw new PanelError(`"${def.name}" en az ${def.min_value} olmalı.`);
        if (def.max_value != null && n > def.max_value) throw new PanelError(`"${def.name}" en fazla ${def.max_value} olmalı.`);
        item.value = n;
        break;
      }
      case T.BOOLEAN:
        item.value = v === true || v === 'true' || v === 'on' || v === '1';
        break;
      case T.USER:
      case T.MENTIONABLE: {
        const id = String(v).replace(/[<@!>]/g, '');
        if (!/^\d{15,25}$/.test(id)) throw new PanelError(`"${def.name}": geçerli bir üye seç.`);
        item.member = await guild.members.fetch(id).catch(() => null);
        item.user = item.member?.user || (await client.users.fetch(id).catch(() => null));
        if (!item.user) throw new PanelError(`"${def.name}": kullanıcı bulunamadı.`);
        item.value = id;
        break;
      }
      case T.ROLE:
        item.role = guild.roles.cache.get(String(v)) || (await guild.roles.fetch(String(v)).catch(() => null));
        if (!item.role) throw new PanelError(`"${def.name}": rol bulunamadı.`);
        item.value = item.role.id;
        break;
      case T.CHANNEL:
        item.channel = guild.channels.cache.get(String(v)) || (await guild.channels.fetch(String(v)).catch(() => null));
        if (!item.channel) throw new PanelError(`"${def.name}": kanal bulunamadı.`);
        item.value = item.channel.id;
        break;
      case T.ATTACHMENT:
        item.attachment = makeAttachment(String(v));
        item.value = item.attachment.url;
        break;
      default:
        throw new PanelError(`"${def.name}" türü desteklenmiyor.`);
    }
    if (def.choices?.length && !def.choices.some(c => String(c.value) === String(item.value))) throw new PanelError(`"${def.name}" için geçersiz seçim.`);
    out[def.name] = item;
  }
  return { options: out, subName };
}

function serializeEmbed(e) {
  const d = typeof e?.toJSON === 'function' ? e.toJSON() : e || {};
  return {
    title: d.title || null,
    description: d.description || null,
    color: d.color ?? null,
    fields: (d.fields || []).map(f => ({ name: f.name, value: f.value, inline: !!f.inline })),
    footer: d.footer?.text || null,
    image: d.image?.url || null,
    thumbnail: d.thumbnail?.url || null,
    author: d.author?.name || null,
  };
}

function capture(payload) {
  if (typeof payload === 'string') return { content: payload, embeds: [], hasComponents: false, files: 0 };
  return {
    content: payload?.content || '',
    embeds: (payload?.embeds || []).map(serializeEmbed),
    hasComponents: Boolean(payload?.components?.length),
    files: payload?.files?.length || 0,
  };
}

function makeInteraction({ client, guild, member, channel, command, subName, options, outputs }) {
  const sentinel = { id: 'panel', get createdTimestamp() { return Date.now(); }, edit: async () => sentinel, delete: async () => {}, react: async () => {} };
  const state = { replied: false, deferred: false };
  const get = name => options[name];
  const val = (name, type) => (get(name) && get(name).type === type ? get(name).value : null);

  const i = {
    client, guild, guildId: guild.id, channel, channelId: channel?.id ?? null, member, user: member.user,
    memberPermissions: member.permissions, commandName: command.data.name, createdTimestamp: Date.now(), id: 'panel-' + Date.now(),
    locale: 'tr', fromPanel: true,
    isChatInputCommand: () => true, isCommand: () => true, isRepliable: () => true, inGuild: () => true, inCachedGuild: () => true,
    get replied() { return state.replied; }, get deferred() { return state.deferred; },
    options: {
      get: name => (get(name) ? { name, value: get(name).value, type: get(name).type } : null),
      getString: (n, req) => reqOr(val(n, T.STRING), n, req),
      getInteger: (n, req) => reqOr(val(n, T.INTEGER), n, req),
      getNumber: (n, req) => reqOr(val(n, T.NUMBER) ?? val(n, T.INTEGER), n, req),
      getBoolean: (n, req) => reqOr(get(n)?.type === T.BOOLEAN ? get(n).value : null, n, req),
      getUser: (n, req) => reqOr(get(n)?.user ?? null, n, req),
      getMember: n => get(n)?.member ?? null,
      getRole: (n, req) => reqOr(get(n)?.role ?? null, n, req),
      getChannel: (n, req) => reqOr(get(n)?.channel ?? null, n, req),
      getMentionable: (n, req) => reqOr(get(n)?.member ?? get(n)?.user ?? null, n, req),
      getAttachment: (n, req) => reqOr(get(n)?.attachment ?? null, n, req),
      getSubcommand: req => { if (!subName && req !== false) throw new PanelError('Alt komut yok.'); return subName; },
      getSubcommandGroup: () => null,
    },
    deferReply: async () => { state.deferred = true; },
    reply: async p => { state.replied = true; outputs.push(capture(p)); return sentinel; },
    editReply: async p => { state.replied = true; const c = capture(p); if (outputs.length) outputs[outputs.length - 1] = c; else outputs.push(c); return sentinel; },
    followUp: async p => { outputs.push(capture(p)); return sentinel; },
    fetchReply: async () => sentinel,
    deleteReply: async () => {},
    showModal: async () => { throw new PanelError('Bu komut Discord içindeki pencere (modal) ister, panelden çalışmaz.'); },
  };

  function reqOr(v, name, required) {
    if (v == null && required) throw new PanelError(`"${name}" zorunlu.`);
    return v ?? null;
  }
  return i;
}

module.exports = { PanelError, resolveOptions, makeInteraction, T };
