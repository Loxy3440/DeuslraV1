const crypto = require('crypto');
const { ChannelType } = require('discord.js');
const { PanelError, resolveOptions, makeInteraction, T } = require('./fakeInteraction');
const { STATS_GUILD_ID } = require('./activityRotator');

// Panelden çalıştırılmayacaklar ve ayrı sekmesi olanlar.
const { logCommand } = require('./modLog');
const BLOCKED = { close: 'Botu kapatır; kapanınca panel de kapanır. Sadece Discord içinden, onay düğmesiyle kullan.' };
const HAS_TAB = { setactivity: 'activity', setmention: 'mention', auto: 'auto' };
// Komutun kodu "komutun yazıldığı kanalı" kullanıyorsa kanal seçmek zorunlu (yanlış kanalda işlem olmasın).
const NEEDS_CHANNEL = new Set(['delete', 'lock', 'invite', 'copy', 'slowmode']);
const DANGER = new Set(['ban', 'kick', 'unban', 'dmall', 'rolall', 'delete', 'emojiall', 'lock', 'refresh', 'copy', 'setevent', 'allmute']);

const jobs = new Map(); // id -> { status, outputs, error, started, userId }
const JOB_TTL = 60 * 60 * 1000;
setInterval(() => { for (const [id, j] of jobs) if (Date.now() - j.started > JOB_TTL) jobs.delete(id); }, 10 * 60 * 1000).unref?.();

function describe(client) {
  return [...client.commands.values()]
    .map(c => {
      const j = c.data.toJSON();
      const subs = (j.options || []).filter(o => o.type === T.SUB);
      const norm = o => ({
        name: o.name, description: o.description, type: o.type, required: !!o.required,
        min: o.min_value ?? null, max: o.max_value ?? null, maxLength: o.max_length ?? null,
        choices: o.choices?.map(x => ({ name: x.name, value: x.value })) || null,
        channelTypes: o.channel_types || null,
      });
      return {
        name: j.name, description: j.description,
        subcommands: subs.map(s => ({ name: s.name, description: s.description, options: (s.options || []).map(norm) })),
        options: subs.length ? [] : (j.options || []).map(norm),
        needsChannel: NEEDS_CHANNEL.has(j.name),
        danger: DANGER.has(j.name),
        blocked: BLOCKED[j.name] || null,
        tab: HAS_TAB[j.name] || null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function meta(guild) {
  const textLike = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum]);
  return {
    roles: [...guild.roles.cache.values()].filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position).map(r => ({ id: r.id, name: r.name, managed: r.managed })),
    channels: [...guild.channels.cache.values()].filter(c => textLike.has(c.type)).sort((a, b) => a.rawPosition - b.rawPosition).map(c => ({ id: c.id, name: c.name, type: c.type })),
  };
}

async function startRun(client, actor, body) {
  const guild = client.guilds.cache.get(STATS_GUILD_ID);
  if (!guild) throw new PanelError('Bot ayarlı sunucuda değil.');
  const command = client.commands.get(String(body.name || ''));
  if (!command) throw new PanelError('Komut bulunamadı.');
  if (BLOCKED[command.data.name]) throw new PanelError(BLOCKED[command.data.name]);

  const member = await guild.members.fetch(actor.id).catch(() => null);
  if (!member) throw new PanelError('Önce ayarlı sunucuya katılmış olmalısın (komutlar senin adına çalışır).');

  let channel = null;
  if (body.channelId) channel = guild.channels.cache.get(String(body.channelId)) || (await guild.channels.fetch(String(body.channelId)).catch(() => null));
  if (NEEDS_CHANNEL.has(command.data.name) && !channel) throw new PanelError('Bu komut için bir kanal seçmelisin.');
  if (!channel) channel = guild.systemChannel || guild.channels.cache.find(c => c.isTextBased?.() && !c.isThread?.()) || null;

  const { options, subName } = await resolveOptions({ command, sub: body.sub, values: body.values, guild, client });

  const outputs = [];
  const job = { status: 'running', outputs, error: null, started: Date.now(), name: command.data.name };
  const id = crypto.randomBytes(8).toString('hex');
  jobs.set(id, job);

  const interaction = makeInteraction({ client, guild, member, channel, command, subName, options, outputs });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Komut 10 dakikada bitmedi.')), 10 * 60 * 1000));
  Promise.race([command.execute(interaction), timeout])
    
    .then(() => { job.status = 'done';
      const optText = Object.entries(options).map(([k, o]) => `${k}: ${o.user ? '<@' + o.user.id + '>' : o.role ? '<@&' + o.role.id + '>' : o.channel ? '<#' + o.channel.id + '>' : o.attachment ? '[dosya]' : String(o.value).slice(0, 80)}`).join(' · ');
      logCommand(guild, { name: command.data.name, user: actor.id === member.id ? member.user : { id: actor.id, tag: actor.name }, optionsText: [subName, optText].filter(Boolean).join(' · '), fromPanel: true }); if (!outputs.length) outputs.push({ content: 'Komut çalıştı (çıktı yok).', embeds: [], hasComponents: false, files: 0 }); })
    .catch(err => {
      job.status = 'error';
      job.error = err instanceof PanelError ? err.message : 'Komut hata verdi: ' + (err.message || err);
      if (!(err instanceof PanelError)) console.error('[PANEL KOMUT]', command.data.name, err);
    });
  console.log(`[PANEL] ${actor.name} (${actor.id}) -> /${command.data.name}${subName ? ' ' + subName : ''}`);
  return { jobId: id };
}

function getJob(id, actorId) {
  const j = jobs.get(String(id));
  if (!j) throw new PanelError('Çalışma bulunamadı (süresi dolmuş olabilir).');
  return { status: j.status, outputs: j.outputs, error: j.error, name: j.name };
}

module.exports = { describe, meta, startRun, getJob, PanelError };
