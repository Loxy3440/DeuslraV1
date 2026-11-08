const { PermissionFlagsBits } = require('discord.js');
const { STATUSES, getActivityConfig, setActivityConfig, addActivity, updateActivity, removeActivity, isStreamUrl } = require('./activityConfig');
const { getTemplateView } = require('./richPresence');
const { logAction, getRecentLogs, CATEGORIES: LOG_CATS } = require('./modLog');
const { startActivityRotation, setBotStatus, getPresenceView, setRichPresence } = require('./activityRotator');
const { getConfig, setConfig, upsertMentionTrigger, removeMentionTrigger, upsertAutoResponse, removeAutoResponse } = require('./guildConfig');
const { parseDuration } = require('./parseDuration');
const { clearActiveTimer } = require('./activeTimers');
const { STATS_GUILD_ID } = require('./activityRotator');
const runner = require('./commandRunner');
const prefixCmds = require('./prefixCommands');
const cc = require('./customCommands');
const { getTop, formatVoice } = require('./stats');
const { presenceEnabled } = require('./statusRole');
const { getAllSettings: getRankupAll, getSettings: getRankupSettings, saveSettings: saveRankupSettings, validateSteps, RankupError, CATEGORIES } = require('./autoRankup');

const TYPES = ['PLAYING', 'STREAMING', 'WATCHING', 'LISTENING', 'COMPETING', 'CUSTOM'];
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const str = (v, max, name, required = true) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new ApiError(400, `${name} boş olamaz.`);
  if (s.length > max) throw new ApiError(400, `${name} en fazla ${max} karakter olabilir.`);
  return s;
};

function getGuild(client) {
  const guild = client.guilds.cache.get(STATS_GUILD_ID);
  if (!guild) throw new ApiError(503, 'Bot ayarlı sunucuda değil (STATS_GUILD_ID).');
  return guild;
}

async function getTarget(client, userId, actor) {
  const guild = getGuild(client);
  if (!/^\d{15,25}$/.test(String(userId || ''))) throw new ApiError(400, 'Geçersiz üye.');
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new ApiError(404, 'Üye sunucuda bulunamadı.');
  if (member.id === guild.ownerId) throw new ApiError(400, 'Sunucu sahibine işlem yapılamaz.');
  if (member.id === client.user.id) throw new ApiError(400, 'Bota işlem yapılamaz.');
  if (member.id === actor.id) throw new ApiError(400, 'Kendine işlem yapamazsın.');
  return member;
}

// Gelen rol ID listesini doğrular (sunucuda var mı, en fazla 25). undefined -> değiştirme.
function roleList(guild, v, name = 'Roller') {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new ApiError(400, `${name} liste olmalı.`);
  if (v.length > 25) throw new ApiError(400, `${name} en fazla 25 rol olabilir.`);
  const ids = [...new Set(v.map(String))];
  for (const id of ids) if (!guild.roles.cache.has(id) || id === guild.id) throw new ApiError(400, `${name}: geçersiz rol seçildi.`);
  return ids;
}

// Panelden gelen aktivite alanlarini dogrular (add ve update ortak kullanir).
function readActivity(b) {
  if (!TYPES.includes(b.type)) throw new ApiError(400, 'Geçersiz aktivite türü.');
  const text = str(b.text, 100, 'Metin');
  const state = str(b.state, 128, 'Alt satır', false);
  let url = null;
  if (b.type === 'STREAMING') {
    url = str(b.url, 200, 'Yayın adresi');
    if (!isStreamUrl(url)) throw new ApiError(400, 'Yayın adresi Twitch veya YouTube olmalı (https://twitch.tv/...).');
  }
  return { type: b.type, text, url, state };
}

const handlers = {
  // ---- okuma ----
  'GET overview': async client => {
    const guild = getGuild(client);
    const [activity, config] = await Promise.all([getActivityConfig(), getConfig(guild.id)]);
    return {
      guild: { id: guild.id, name: guild.name },
      activity: { list: activity.list, intervalSeconds: activity.intervalSeconds },
      presence: getPresenceView(client),
      stats: {
        members: guild.memberCount,
        guilds: client.guilds.cache.size,
        ping: Math.round(client.ws.ping),
        uptime: Math.floor(process.uptime()),
        commands: client.commands?.size || 0,
      },
      log: { channelId: config.logChannelId || '', categories: Object.fromEntries(Object.keys(LOG_CATS).map(k => [k, (config.logCategories || {})[k] !== false])), labels: LOG_CATS },
      mentionTriggers: config.mentionTriggers || [],
      autoResponses: config.autoResponses || [],
      roles: [...guild.roles.cache.values()].filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position).map(r => ({ id: r.id, name: r.name, managed: r.managed })),
      roleGroups: { member: config.roleMemberIds || [], staff: config.roleStaffIds || [], bot: config.roleBotIds || [] },
      autoRankup: Object.fromEntries(Object.entries(getRankupAll(config)).map(([cat, { enabled, channelId, steps }]) => [cat, { enabled, channelId, steps }])),
      channels: [...guild.channels.cache.values()].filter(c => c.type === 0 || c.type === 5).sort((a, b) => a.rawPosition - b.rawPosition).map(c => ({ id: c.id, name: c.name })),
    };
  },

  'GET members': async (client, _b, _a, query) => {
    const guild = getGuild(client);
    const q = (query.get('q') || '').trim();
    if (q.length < 2) return { members: [] };
    const found = await guild.members.search({ query: q.slice(0, 32), limit: 10 });
    return {
      members: [...found.values()].map(m => ({
        id: m.id,
        tag: m.user.tag,
        name: m.displayName,
        avatar: m.displayAvatarURL({ size: 64 }),
        mutedUntil: m.communicationDisabledUntilTimestamp && m.communicationDisabledUntilTimestamp > Date.now() ? m.communicationDisabledUntilTimestamp : null,
      })),
    };
  },

  // ---- aktivite ----
  'POST activity/add': async (client, b) => {
    const { type, text, url, state } = readActivity(b);
    await addActivity(type, text, url, state);
    await startActivityRotation(client);
    return { ok: true };
  },
  'POST activity/update': async (client, b) => {
    const config = await getActivityConfig();
    if (!Number.isInteger(b.index) || b.index < 0 || b.index >= config.list.length) throw new ApiError(400, 'Geçersiz sıra.');
    const { type, text, url, state } = readActivity(b);
    await updateActivity(b.index, type, text, url, state);
    await startActivityRotation(client);
    return { ok: true };
  },
  'POST activity/remove': async (client, b) => {
    const config = await getActivityConfig();
    if (!Number.isInteger(b.index) || b.index < 0 || b.index >= config.list.length) throw new ApiError(400, 'Geçersiz sıra.');
    await removeActivity(b.index);
    await startActivityRotation(client);
    return { ok: true };
  },
  'POST activity/interval': async (client, b) => {
    const s = Number(b.seconds);
    if (!Number.isFinite(s) || s < 5 || s > 3600) throw new ApiError(400, 'Süre 5 ile 3600 saniye arasında olmalı.');
    await setActivityConfig({ intervalSeconds: Math.round(s) });
    await startActivityRotation(client);
    return { ok: true };
  },

  // ---- bot durumu (çevrimiçi / boşta / rahatsız etme / görünmez) ----
  'POST status': async (client, b) => {
    if (!STATUSES.includes(b.status)) throw new ApiError(400, 'Geçersiz durum.');
    await setActivityConfig({ status: b.status });
    setBotStatus(client, b.status);
    return { ok: true, presence: getPresenceView(client) };
  },
  // Botun profilindeki durum yazısı (balon): aktivite listesinden ayrı tek bir yazı. Boş = kaldır.
  'POST botstatus': async (client, b) => {
    const text = str(b.text, 100, 'Durum yazısı', false);
    await setActivityConfig({ customStatus: text });
    await startActivityRotation(client);
    return { ok: true, presence: getPresenceView(client) };
  },
  'GET presence': async client => getPresenceView(client),

  // ---- Rich Presence: icerik utils/richPresence.js taslaginda, panelde sadece ac/kapat ----
  'GET rp': async client => ({ enabled: getPresenceView(client).richOn, template: getTemplateView() }),
  'POST rp/save': async (client, b) => {
    await setRichPresence(client, !!b.enabled);
    return { ok: true, enabled: !!b.enabled, template: getTemplateView(), message: b.enabled ? 'Rich Presence açıldı.' : 'Rich Presence kapatıldı.' };
  },

  // ---- komut ekle (kod yazmadan / dosya yukleyerek) ----
  'GET cmdlist': async () => ({ commands: await cc.getList(), github: cc.githubInfo() }),
  'POST cmd/create': async (client, b, actor) => {
    const o = cc.validateBuilder(b);
    return cc.addCommand(client, cc.buildCode(o), { actorName: actor.name, origin: 'kodsuz' });
  },
  'POST cmd/upload': async (client, b, actor) => cc.addCommand(client, b.code, { actorName: actor.name, origin: 'dosya' }),
  'POST cmd/remove': async (client, b) => cc.removeCommand(client, String(b.name || '')),

  // ---- log ----
  'GET log': async (client, _b, _a, query) => {
    const guild = getGuild(client);
    const cat = query.get('cat') || undefined;
    return { entries: await getRecentLogs(guild.id, { limit: 120, cat }) };
  },
  'POST log/save': async (client, b) => {
    const guild = getGuild(client);
    const update = {};
    if (b.channelId !== undefined) {
      if (b.channelId) {
        const ch = guild.channels.cache.get(String(b.channelId));
        if (!ch || !ch.isTextBased?.()) throw new ApiError(400, 'Log kanalı geçersiz.');
        update.logChannelId = ch.id;
      } else update.logChannelId = null;
    }
    if (b.categories && typeof b.categories === 'object') {
      update.logCategories = Object.fromEntries(Object.keys(LOG_CATS).map(k => [k, b.categories[k] !== false]));
    }
    await setConfig(guild.id, update);
    return { ok: true };
  },

  // ---- istatistik (/mesajtop, /sestop) ----
  'GET stats': async client => {
    const guild = getGuild(client);
    const name = async id => {
      const m = guild.members.cache.get(id) || (await guild.members.fetch(id).catch(() => null));
      return m ? m.displayName : id;
    };
    const build = async which => Promise.all((await getTop(guild.id, which, 15)).map(async r => ({
      userId: r.userId, name: await name(r.userId),
      value: which === 'voice' ? formatVoice(r.value) : r.value.toLocaleString('tr-TR') + ' mesaj',
    })));
    return { messages: await build('messages'), voice: await build('voice') };
  },

  // ---- durum rolü (/setdurum) ----
  'GET durum': async client => {
    const guild = getGuild(client);
    const c = await getConfig(guild.id);
    return { text: c.statusText || '', roleId: c.statusRoleId || '', channelId: c.statusChannelId || '', presence: presenceEnabled(client) };
  },
  'POST durum/save': async (client, b) => {
    const guild = getGuild(client);
    if (!b.enabled) {
      await setConfig(guild.id, { statusText: null, statusRoleId: null, statusChannelId: null });
      return { ok: true, message: 'Durum rolü kapatıldı.' };
    }
    const text = str(b.text, 100, 'Durum yazısı');
    const role = guild.roles.cache.get(String(b.roleId || ''));
    if (!role || role.id === guild.id) throw new ApiError(400, 'Rol seç.');
    if (role.managed) throw new ApiError(400, 'Bot/entegrasyon rolü verilemez.');
    if (role.permissions.has(PermissionFlagsBits.Administrator)) throw new ApiError(400, 'Yönetici yetkisi olan rol seçilemez.');
    const me = guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position) throw new ApiError(400, 'Bu rolü veremem: botun rolü bu rolün üstünde olmalı.');
    const ch = guild.channels.cache.get(String(b.channelId || ''));
    if (!ch || !ch.isTextBased?.()) throw new ApiError(400, 'Kanal seç.');
    if (!ch.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages])) throw new ApiError(400, 'Botun bu kanalda Kanalı Gör, Mesaj Gönder ve Mesajları Yönet yetkisi olmalı.');
    await setConfig(guild.id, { statusText: text, statusRoleId: role.id, statusChannelId: ch.id });
    return { ok: true, message: presenceEnabled(client) ? 'Kaydedildi.' : 'Kaydedildi, ama Presence intent kapalı (USE_PRESENCE=true + Portal).' };
  },

  // ---- oto nick (yeni gelen üyeye otomatik takma ad eki) ----
  'GET autonick': async client => {
    const guild = getGuild(client);
    const c = await getConfig(guild.id);
    return { enabled: !!c.autoNickEnabled, text: c.autoNickText || '', position: c.autoNickPosition || 'sona', includeBots: !!c.autoNickIncludeBots };
  },
  'POST autonick/save': async (client, b) => {
    const guild = getGuild(client);
    if (!b.enabled) {
      await setConfig(guild.id, { autoNickEnabled: false });
      return { ok: true, message: 'Oto nick kapatıldı.' };
    }
    const text = str(b.text, 20, 'Nick yazısı');
    const position = b.position === 'basa' ? 'basa' : 'sona';
    const me = guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) throw new ApiError(400, 'Botun "Takma Adları Yönet" yetkisi olmalı.');
    await setConfig(guild.id, { autoNickEnabled: true, autoNickText: text, autoNickPosition: position, autoNickIncludeBots: !!b.includeBots });
    return { ok: true, message: 'Oto nick kaydedildi. Yeni gelen üyelerin adına eklenecek.' };
  },

  // ---- etiketlenme cevapları (/setmention) ----
  'POST mention/upsert': async (client, b) => {
    const guild = getGuild(client);
    const trigger = str(b.trigger, 100, 'Tetikleyici');
    const response = str(b.response, 1800, 'Cevap', !b.mediaUrl);
    await upsertMentionTrigger(guild.id, trigger, response, b.mediaUrl ? str(b.mediaUrl, 500, 'Medya adresi') : null, roleList(guild, b.allowedRoleIds, 'Rol sınırı'));
    return { ok: true };
  },
  'POST mention/remove': async (client, b) => {
    await removeMentionTrigger(getGuild(client).id, str(b.trigger, 100, 'Tetikleyici'));
    return { ok: true };
  },

  // ---- otomatik mesajlar (/auto) ----
  'POST auto/upsert': async (client, b) => {
    const guild = getGuild(client);
    const trigger = str(b.trigger, 100, 'Tetikleyici');
    const response = str(b.response, 1800, 'Cevap', !b.mediaUrl);
    const cd = Math.min(Math.max(Math.round(Number(b.cooldownSeconds) || 3), 1), 3600);
    await upsertAutoResponse(guild.id, trigger, response, b.mediaUrl ? str(b.mediaUrl, 500, 'Medya adresi') : null, cd, roleList(guild, b.allowedRoleIds, 'Rol sınırı'));
    return { ok: true };
  },
  'POST auto/remove': async (client, b) => {
    await removeAutoResponse(getGuild(client).id, str(b.trigger, 100, 'Tetikleyici'));
    return { ok: true };
  },

  // ---- rol grupları (/setroles) ----
  'POST roles/save': async (client, b) => {
    const guild = getGuild(client);
    const groups = { roleMemberIds: roleList(guild, b.member, 'Üye rolleri'), roleStaffIds: roleList(guild, b.staff, 'Yetkili rolleri'), roleBotIds: roleList(guild, b.bot, 'Bot rolleri') };
    const names = { roleMemberIds: 'Üye', roleStaffIds: 'Yetkili', roleBotIds: 'Bot' };
    const seen = new Map();
    for (const [field, ids] of Object.entries(groups)) {
      for (const id of ids || []) {
        if (seen.has(id)) throw new ApiError(400, `"${guild.roles.cache.get(id).name}" rolü hem ${seen.get(id)} hem ${names[field]} grubunda. Bir rol tek grupta olabilir.`);
        seen.set(id, names[field]);
      }
    }
    await setConfig(guild.id, Object.fromEntries(Object.entries(groups).filter(([, v]) => v !== undefined)));
    return { ok: true };
  },

  // ---- auto rank up (/autorankup): iki kategori, "uye" ve "yetkili" ----
  'POST rankup/save': async (client, b) => {
    const guild = getGuild(client);
    const category = String(b.category || '');
    if (!CATEGORIES.includes(category)) throw new ApiError(400, 'Kategori geçersiz.');
    const config = await getConfig(guild.id);
    const current = getRankupSettings(config, category);
    let steps;
    try {
      steps = validateSteps(guild, b.steps, category, config);
    } catch (err) {
      if (err instanceof RankupError) throw new ApiError(400, err.message);
      throw err;
    }
    const enabled = Boolean(b.enabled);
    if (enabled && steps.length < 2) throw new ApiError(400, 'Açmak için en az 2 rol gerekli (başlangıç rolü + bir üst rol).');
    let channelId = null;
    if (b.channelId) {
      const ch = guild.channels.cache.get(String(b.channelId));
      if (!ch || !ch.isTextBased?.()) throw new ApiError(400, 'Duyuru kanalı geçersiz.');
      channelId = ch.id;
    }
    // Kategori kapalıyken açılırsa davetler o andan itibaren sayılır.
    const enabledAt = enabled ? (current.enabled && current.enabledAt ? current.enabledAt : new Date()) : current.enabledAt;
    await saveRankupSettings(guild.id, category, { enabled, channelId, steps, enabledAt });
    return { ok: true };
  },

  // ---- tüm komutlar ----
  'GET commands': async client => ({ commands: runner.describe(client) }),
  'GET meta': async client => runner.meta(getGuild(client)),
  'POST commands/run': async (client, b, actor) => runner.startRun(client, actor, b),
  'GET commands/job': async (_c, _b, actor, query) => runner.getJob(query.get('id'), actor.id),

  // ---- yazıyla (prefix) komutlar ----
  'GET prefix': async client => {
    const guild = getGuild(client);
    const cfg = prefixCmds.effective(await getConfig(guild.id), client);
    return { config: cfg, saved: cfg.saved, available: prefixCmds.available(client), roles: runner.meta(guild).roles };
  },
  'POST prefix/save': async (client, b) => {
    const guild = getGuild(client);
    const cfg = await prefixCmds.savePrefixConfig(client, guild, b);
    return { ok: true, config: { saved: true, ...cfg }, message: 'Yazıyla komut ayarları kaydedildi.' };
  },

  // ---- moderasyon ----
  'POST mute': async (client, b, actor) => {
    const member = await getTarget(client, b.userId, actor);
    const ms = parseDuration(String(b.duration || ''));
    if (!ms) throw new ApiError(400, 'Süreyi 10m, 2h, 1d şeklinde yaz.');
    if (ms > MAX_TIMEOUT_MS) throw new ApiError(400, 'En fazla 28 gün susturabilirsin.');
    if (!member.moderatable) throw new ApiError(403, 'Bu üyeyi susturamıyorum (rolü benden yüksek).');
    const reason = str(b.reason, 200, 'Sebep', false) || 'Sebep belirtilmedi';
    await member.timeout(ms, `Panel (${actor.name}): ${reason}`);
    await logAction(member.guild, { action: 'mute', markKey: `mute:${member.guild.id}:${member.id}`, target: member, moderator: { id: actor.id, tag: actor.name }, reason, fields: [{ name: 'Süre', value: String(b.duration), inline: true }], fromPanel: true });
    return { ok: true, message: `${member.user.tag} susturuldu.` };
  },
  'POST unmute': async (client, b, actor) => {
    const member = await getTarget(client, b.userId, actor);
    if (!member.moderatable) throw new ApiError(403, 'Bu üyeye işlem yapamıyorum.');
    await member.timeout(null, `Panel (${actor.name}): susturma kaldırıldı`);
    await logAction(member.guild, { action: 'unmute', markKey: `mute:${member.guild.id}:${member.id}`, target: member, moderator: { id: actor.id, tag: actor.name }, fromPanel: true });
    clearActiveTimer(`mute_${member.guild.id}_${member.id}`);
    return { ok: true, message: `${member.user.tag} susturması kaldırıldı.` };
  },
  'POST kick': async (client, b, actor) => {
    const member = await getTarget(client, b.userId, actor);
    if (!member.kickable) throw new ApiError(403, 'Bu üyeyi atamıyorum (rolü benden yüksek).');
    const reason = str(b.reason, 200, 'Sebep', false) || 'Sebep belirtilmedi';
    await logAction(member.guild, { action: 'kick', markKey: `kick:${member.guild.id}:${member.id}`, target: member, moderator: { id: actor.id, tag: actor.name }, reason, fromPanel: true });
    await member.kick(`Panel (${actor.name}): ${reason}`);
    return { ok: true, message: `${member.user.tag} sunucudan atıldı.` };
  },
};

// Panelde yapılan her ayar değişikliği log kanalına ve geçmişe yazılır (komut çalıştırma ve moderasyon zaten kendi logunu yazar).
const PANEL_LABELS = {
  'activity/add': b => `Aktivite eklendi: ${b.type} — ${b.text}`,
  'activity/update': b => `Aktivite düzenlendi (sıra ${Number(b.index) + 1}): ${b.type} — ${b.text}`,
  'cmd/create': b => `Komut eklendi: /${b.name}`,
  'cmd/upload': () => 'Komut dosyası yüklendi',
  'cmd/remove': b => `Komut silindi: /${b.name}`,
  'rp/save': b => (b.enabled ? 'Rich Presence açıldı' : 'Rich Presence kapatıldı'),
  'activity/remove': b => `Aktivite silindi (sıra ${Number(b.index) + 1})`,
  'activity/interval': b => `Aktivite geçiş süresi: ${b.seconds} sn`,
  'botstatus': b => (b.text ? `Bot durum yazısı: ${b.text}` : 'Bot durum yazısı kaldırıldı'),
  'status': b => `Bot durumu: ${({ online: 'Çevrimiçi', idle: 'Boşta', dnd: 'Rahatsız etmeyin', invisible: 'Görünmez' })[b.status] || b.status}`,
  'mention/upsert': b => `Etiket cevabı kaydedildi: ${b.trigger}`,
  'mention/remove': b => `Etiket cevabı silindi: ${b.trigger}`,
  'auto/upsert': b => `Otomatik mesaj kaydedildi: ${b.trigger}`,
  'auto/remove': b => `Otomatik mesaj silindi: ${b.trigger}`,
  'roles/save': () => 'Rol grupları (üye/yetkili/bot) güncellendi',
  'rankup/save': b => `Auto rank up (${b.category}) ayarları güncellendi — ${b.enabled ? 'açık' : 'kapalı'}`,
  'prefix/save': b => `Yazıyla komutlar güncellendi — ${b.enabled === false ? 'kapalı' : 'açık'}, önek: ${b.prefix}, ${(b.commands || []).length} komut`,
  'log/save': () => 'Log ayarları güncellendi',
  'autonick/save': b => (b.enabled ? `Oto nick ayarlandı: "${b.text}" (${b.position === 'basa' ? 'başa' : 'sona'})` : 'Oto nick kapatıldı'),
  'durum/save': b => (b.enabled ? `Durum rolü ayarlandı: "${b.text}"` : 'Durum rolü kapatıldı'),
};
function panelLog(client, route, body, actor) {
  const make = PANEL_LABELS[route];
  if (!make) return; // mute/unmute/kick/commands/run kendi logunu yazar
  const guild = client.guilds.cache.get(STATS_GUILD_ID);
  if (!guild) return;
  const action = route === 'status' ? 'status' : 'panel';
  logAction(guild, { action, moderator: { id: actor.id, tag: actor.name }, fromPanel: true, description: make(body) });
}

async function handleAdmin(client, method, route, body, actor, query) {
  const fn = handlers[`${method} ${route}`];
  if (!fn) throw new ApiError(404, 'Bulunamadı.');
  try {
    const result = await fn(client, body || {}, actor, query);
    if (method === 'POST') {
      console.log(`[PANEL] ${actor.name} (${actor.id}) -> ${route}`);
      panelLog(client, route, body || {}, actor);
    }
    return result;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof runner.PanelError || err instanceof cc.CmdError || err instanceof prefixCmds.PrefixError) throw new ApiError(400, err.message);
    console.error('[PANEL]', route, err);
    throw new ApiError(500, 'İşlem başarısız: ' + (err.message || 'bilinmeyen hata'));
  }
}

module.exports = { handleAdmin, ApiError };
