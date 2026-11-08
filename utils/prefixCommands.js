// Yazıyla (prefix) komutlar: .ban, .mute vb. Slash komutlarının aynısını çalıştırır, komut dosyalarına dokunmaz.
// Ayarlar MongoDB'de guildConfig.prefixCommands altında tutulur ve panelden yönetilir.
const { PermissionFlagsBits } = require('discord.js');
const { PanelError, resolveOptions, makeInteraction, T } = require('./fakeInteraction');
const { logCommand, describeOptions } = require('./modLog');
const { setConfig } = require('./guildConfig');

// Sadece web panelinden yönetilen ayar komutları (interactionCreate'teki liste ile aynı) yazıyla kullanılamaz.
const WEB_ONLY = new Set(['auto', 'mention', 'setmention', 'setactivity', 'setdurum', 'setroles']);
const ACCESS = ['default', 'everyone', 'roles'];
const NAME_RE = /^[\p{L}\p{N}_-]{1,32}$/u;
const MAX_COMMANDS = 150;

class PrefixError extends Error {}

const cooldowns = new Map(); // guild:user:komutAdı -> son kullanım (ms)

// ---------- ayarlar ----------
function defaultCommands(client) {
  return [...client.commands.values()]
    .filter(c => !WEB_ONLY.has(c.data.name))
    .map(c => ({
      enabled: true, name: c.data.name, aliases: [], action: c.data.name,
      access: 'default', roleIds: [], cooldownSeconds: 0, help: String(c.data.description || '').slice(0, 100),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Kaydedilmiş ayar yoksa varsayılan: açık, önek ".", bütün slash komutları aynı adla.
function effective(config, client) {
  const s = config.prefixCommands;
  if (s && Array.isArray(s.commands)) return { saved: true, ...s };
  return { saved: false, enabled: true, prefix: '.', deleteReplySeconds: 0, deleteInvokerMessage: false, commands: defaultCommands(client) };
}

function available(client) {
  return [...client.commands.values()]
    .filter(c => !WEB_ONLY.has(c.data.name))
    .map(c => ({ name: c.data.name, description: c.data.description || '', restricted: !!c.data.toJSON().default_member_permissions }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function validate(body, client, guild) {
  const prefix = typeof body.prefix === 'string' ? body.prefix.trim() : '';
  if (!/^\S{1,3}$/u.test(prefix)) throw new PrefixError('Önek 1-3 karakter olmalı ve boşluk içermemeli.');
  const del = Number(body.deleteReplySeconds || 0);
  if (!Number.isInteger(del) || del < 0 || del > 3600) throw new PrefixError('Cevabı silme süresi 0-3600 saniye arasında olmalı.');
  if (!Array.isArray(body.commands)) throw new PrefixError('Komut listesi geçersiz.');
  if (body.commands.length > MAX_COMMANDS) throw new PrefixError(`En fazla ${MAX_COMMANDS} komut olabilir.`);

  const used = new Map(); // ad -> hangi komutta
  const commands = body.commands.map((raw, idx) => {
    const n = idx + 1;
    const name = String(raw.name || '').trim().toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '');
    if (!NAME_RE.test(name)) throw new PrefixError(`${n}. komut: ad boş olamaz; harf, rakam, - ve _ kullan (en fazla 32).`);
    const aliasList = Array.isArray(raw.aliases) ? raw.aliases : String(raw.aliases || '').split(',');
    const aliases = [...new Set(aliasList.map(a => String(a).trim().toLowerCase()).filter(Boolean))];
    for (const a of aliases) if (!NAME_RE.test(a)) throw new PrefixError(`"${a}" geçerli bir ek ad değil.`);
    for (const nm of [name, ...aliases]) {
      if (used.has(nm)) throw new PrefixError(`"${nm}" birden fazla yerde kullanılmış. Ad ve ek adlar benzersiz olmalı.`);
      used.set(nm, name);
    }
    const action = String(raw.action || '');
    const cmd = client.commands.get(action);
    if (!cmd || WEB_ONLY.has(action)) throw new PrefixError(`"${name}": bağlanan komut (/${action}) bulunamadı veya yazıyla kullanılamaz.`);
    const access = ACCESS.includes(raw.access) ? raw.access : 'default';
    if (access === 'everyone' && cmd.data.toJSON().default_member_permissions) {
      throw new PrefixError(`"${name}": /${action} yetki gerektiren bir komut, "Herkes" seçilemez. "Slash'taki gibi" ya da "Belirli roller" seç.`);
    }
    let roleIds = [];
    if (access === 'roles') {
      roleIds = [...new Set((Array.isArray(raw.roleIds) ? raw.roleIds : []).map(String))];
      if (!roleIds.length) throw new PrefixError(`"${name}": "Belirli roller" için en az bir rol seç.`);
      if (roleIds.length > 25) throw new PrefixError(`"${name}": en fazla 25 rol seçilebilir.`);
      for (const id of roleIds) if (!guild.roles.cache.has(id) || id === guild.id) throw new PrefixError(`"${name}": geçersiz rol seçilmiş.`);
    }
    const cd = Number(raw.cooldownSeconds || 0);
    if (!Number.isInteger(cd) || cd < 0 || cd > 3600) throw new PrefixError(`"${name}": bekleme süresi 0-3600 saniye olmalı.`);
    return { enabled: raw.enabled !== false, name, aliases, action, access, roleIds, cooldownSeconds: cd, help: String(raw.help || '').trim().slice(0, 100) };
  });

  return { enabled: body.enabled !== false, prefix, deleteReplySeconds: del, deleteInvokerMessage: !!body.deleteInvokerMessage, commands };
}

async function savePrefixConfig(client, guild, body) {
  const clean = validate(body, client, guild);
  await setConfig(guild.id, { prefixCommands: clean });
  return clean;
}

// ---------- yetki ----------
function allowed(entry, command, member, guild) {
  if (member.id === guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const need = command.data.toJSON().default_member_permissions;
  if (entry.access === 'everyone' && !need) return true;
  if (entry.access === 'roles') return entry.roleIds.some(id => member.roles.cache.has(id));
  return !need || member.permissions.has(BigInt(need));
}

// ---------- argüman ayrıştırma ----------
function tokenize(s) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push({ v: m[1] !== undefined ? m[1] : m[2], i: m.index });
  return out;
}

const TRUE_WORDS = new Set(['true', 'evet', 'e', '1', 'on', 'aç', 'ac', 'açık', 'acik', 'yes']);
const FALSE_WORDS = new Set(['false', 'hayır', 'hayir', 'h', '0', 'off', 'kapalı', 'kapali', 'no']);

function parseArgs(command, argStr, message) {
  let defs = command.data.toJSON().options || [];
  const tokens = tokenize(argStr);
  let t = 0;
  let sub = null;
  const subs = defs.filter(o => o.type === T.SUB);
  if (subs.length) {
    const w = (tokens[0]?.v || '').toLowerCase();
    const s = subs.find(x => x.name === w);
    if (!s) throw new PanelError('Alt komut seçmelisin: ' + subs.map(x => x.name).join(', '));
    sub = s.name;
    defs = s.options || [];
    t = 1;
  }
  const files = [...message.attachments.values()];
  let fi = 0;
  const values = {};
  let lastPositional = -1;
  defs.forEach((d, i) => { if (d.type !== T.ATTACHMENT && d.type !== T.BOOLEAN) lastPositional = i; });

  defs.forEach((def, idx) => {
    if (def.type === T.ATTACHMENT) { const f = files[fi++]; if (f) values[def.name] = f.url; return; }
    if (def.type === T.BOOLEAN) {
      const w = (tokens[t]?.v || '').toLowerCase();
      if (TRUE_WORDS.has(w)) { values[def.name] = true; t++; } else if (FALSE_WORDS.has(w)) { values[def.name] = false; t++; }
      return;
    }
    const tok = tokens[t];
    if (!tok) return;
    let v;
    if (def.type === T.STRING && idx === lastPositional && !def.choices?.length) {
      v = argStr.slice(tok.i).trim(); // son metin alanı mesajın kalanını alır
      if (/^"[^"]*"$/.test(v)) v = v.slice(1, -1);
      t = tokens.length;
    } else { v = tok.v; t++; }

    if (def.type === T.ROLE) v = v.replace(/[<@&>]/g, '');
    else if (def.type === T.CHANNEL) v = v.replace(/[<#>]/g, '');
    if (def.choices?.length) {
      const c = def.choices.find(x => String(x.value).toLowerCase() === v.toLowerCase() || String(x.name).toLowerCase() === v.toLowerCase());
      if (c) v = c.value;
    }
    values[def.name] = v;
  });
  return { sub, values };
}

function usageOf(prefix, word, command) {
  const json = command.data.toJSON();
  const opts = defs => (defs || []).map(o => {
    const n = o.type === T.ATTACHMENT ? `${o.name}: dosya ekle` : o.name;
    return o.required ? `<${n}>` : `[${n}]`;
  }).join(' ');
  const subs = (json.options || []).filter(o => o.type === T.SUB);
  const lines = subs.length
    ? subs.map(s => `${prefix}${word} ${s.name} ${opts(s.options)}`.trim())
    : [`${prefix}${word} ${opts(json.options)}`.trim()];
  return '```\n' + lines.join('\n') + '\n```';
}

// ---------- mesaj tabanlı interaction ----------
function makeMessageInteraction({ message, client, guild, member, command, subName, options, pc, track, schedule }) {
  const i = makeInteraction({ client, guild, member, channel: message.channel, command, subName, options, outputs: [] });
  const state = { replied: false, deferred: false };
  let sent = null;

  const clean = p => {
    const o = typeof p === 'string' ? { content: p } : { ...p };
    delete o.ephemeral; delete o.fetchReply; delete o.flags; delete o.withResponse;
    o.allowedMentions = o.allowedMentions || { repliedUser: false };
    return o;
  };
  const afterSend = (msg, p) => {
    track(msg);
    if (p && p.ephemeral && !pc.deleteReplySeconds) schedule(msg, 20); // "sadece sen gör" cevapları herkese açık kalmasın
    return msg;
  };

  Object.defineProperty(i, 'replied', { get: () => state.replied, configurable: true });
  Object.defineProperty(i, 'deferred', { get: () => state.deferred, configurable: true });
  Object.assign(i, {
    createdTimestamp: message.createdTimestamp, fromPanel: false, fromPrefix: true, id: 'prefix-' + message.id, locale: 'tr',
    reply: async p => {
      state.replied = true;
      const body = clean(p);
      sent = await message.reply(body).catch(() => message.channel.send(body));
      return afterSend(sent, p);
    },
    deferReply: async () => { state.deferred = true; await message.channel.sendTyping().catch(() => {}); },
    editReply: async p => {
      state.replied = true;
      const body = clean(p);
      delete body.allowedMentions;
      if (sent) { sent = await sent.edit(body).catch(() => sent); return sent; }
      sent = await message.reply({ ...body, allowedMentions: { repliedUser: false } }).catch(() => message.channel.send(body));
      return afterSend(sent, p);
    },
    followUp: async p => { const m = await message.channel.send(clean(p)); return afterSend(m, p); },
    fetchReply: async () => sent,
    deleteReply: async () => { if (sent) await sent.delete().catch(() => {}); },
    showModal: async () => { throw new PanelError('Bu komut Discord içinde pencere (modal) açtığı için sadece slash ile kullanılabilir.'); },
  });
  // loglar için seçenek listesi
  const data = Object.entries(options).map(([name, o]) => ({ name, type: o.type, value: o.value, user: o.user, role: o.role, channel: o.channel, attachment: o.attachment }));
  i.options.data = subName ? [{ name: subName, type: T.SUB, options: data }] : data;
  return i;
}

// ---------- ana giriş ----------
// messageCreate'ten çağrılır. true dönerse mesaj bir komuttu ve işlendi.
async function handlePrefixCommand(message, config) {
  const client = message.client;
  const pc = effective(config, client);
  if (!pc.enabled || !message.content.startsWith(pc.prefix)) return false;

  const rest = message.content.slice(pc.prefix.length);
  const m = rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!m) return false;
  const word = m[1].toLowerCase();
  const argStr = (m[2] || '').trim();
  const entry = pc.commands.find(e => e.enabled && (e.name === word || e.aliases.includes(word)));
  if (!entry) return false;
  const command = client.commands.get(entry.action);
  if (!command || WEB_ONLY.has(entry.action)) return false;

  const guild = message.guild;
  const member = message.member || (await guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return true;

  const sentMessages = [];
  const schedule = (msg, sec) => { if (msg && sec > 0) setTimeout(() => msg.delete().catch(() => {}), sec * 1000).unref?.(); };
  const track = msg => { sentMessages.push(msg); schedule(msg, pc.deleteReplySeconds); };
  const notice = async (content, sec = 6) => {
    const msg = await message.reply({ content, allowedMentions: { repliedUser: false } }).catch(() => null);
    schedule(msg, pc.deleteReplySeconds || sec);
    return msg;
  };
  const cleanup = () => { if (pc.deleteInvokerMessage) message.delete().catch(() => {}); };

  if (!allowed(entry, command, member, guild)) {
    await notice('⛔ Bu komutu kullanma yetkin yok.');
    cleanup();
    return true;
  }

  if (entry.cooldownSeconds > 0) {
    const key = `${guild.id}:${member.id}:${entry.name}`;
    const left = (cooldowns.get(key) || 0) + entry.cooldownSeconds * 1000 - Date.now();
    if (left > 0) {
      await notice(`⏳ Bu komutu tekrar kullanmak için ${Math.ceil(left / 1000)} sn bekle.`);
      cleanup();
      return true;
    }
    cooldowns.set(key, Date.now());
  }

  let resolved, subName;
  try {
    const parsed = parseArgs(command, argStr, message);
    subName = parsed.sub;
    resolved = await resolveOptions({ command, sub: parsed.sub, values: parsed.values, guild, client });
  } catch (err) {
    if (!(err instanceof PanelError)) { console.error('[PREFIX]', err); return true; }
    await notice(`⚠️ ${err.message}\n**Kullanım:**\n${usageOf(pc.prefix, word, command)}`, 15);
    cleanup();
    return true;
  }

  const interaction = makeMessageInteraction({ message, client, guild, member, command, subName, options: resolved.options, pc, track, schedule });
  try {
    await command.execute(interaction);
    logCommand(guild, { name: command.data.name, user: member.user, optionsText: describeOptions(interaction.options.data) });
  } catch (err) {
    if (err instanceof PanelError) {
      await notice(`⚠️ ${err.message}`);
    } else {
      console.error('[PREFIX KOMUT]', command.data.name, err);
      await notice('❌ Komut çalıştırılırken bir hata oluştu.');
    }
  } finally {
    cleanup();
  }
  return true;
}

module.exports = { parseArgs, usageOf, handlePrefixCommand, effective, available, savePrefixConfig, PrefixError, WEB_ONLY };
