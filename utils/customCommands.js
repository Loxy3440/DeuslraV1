const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { REST, Routes } = require('discord.js');
const { getDb } = require('./db');

// Panelden eklenen komutlar: commands/ klasorune yazilir, hemen yuklenir, Discord'a kaydedilir
// ve (GITHUB_TOKEN varsa) GitHub deposuna commit edilir. Render dosyalari kalici tutmadigi icin
// GitHub'a commit etmek komutun yeniden baslatmada kaybolmamasini saglar.
const COMMANDS_DIR = path.join(__dirname, '..', 'commands');
const NAME_RE = /^[a-z0-9_-]{1,32}$/;
const DOC_ID = 'panelCommands';
const MAX_CODE = 100_000;

class CmdError extends Error {}

// ---------- kayit listesi (panelden eklenenler) ----------
async function getList() {
  const doc = await getDb().collection('botConfig').findOne({ _id: DOC_ID });
  return (doc && doc.list) || [];
}
async function saveList(list) {
  await getDb().collection('botConfig').updateOne({ _id: DOC_ID }, { $set: { list } }, { upsert: true });
}

// ---------- GitHub ----------
function ghCfg() {
  return {
    token: process.env.GITHUB_TOKEN || '',
    repo: process.env.GITHUB_REPO || '',
    branch: process.env.GITHUB_BRANCH || 'main',
  };
}
function githubInfo() {
  const c = ghCfg();
  return { enabled: !!(c.token && c.repo), repo: c.repo, branch: c.branch };
}
async function gh(method, urlPath, body) {
  const c = ghCfg();
  const res = await fetch(`https://api.github.com/repos/${c.repo}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gardiyan-panel',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}
async function ghSha(file) {
  const c = ghCfg();
  const r = await gh('GET', `/contents/commands/${file}?ref=${encodeURIComponent(c.branch)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new CmdError(`GitHub okuma hatası (${r.status}): ${r.data.message || ''}`);
  return r.data.sha;
}
async function ghPut(file, code, message) {
  const c = ghCfg();
  const sha = await ghSha(file);
  const r = await gh('PUT', `/contents/commands/${file}`, {
    message, branch: c.branch, content: Buffer.from(code, 'utf8').toString('base64'), ...(sha ? { sha } : {}),
  });
  if (!r.ok) throw new CmdError(`GitHub'a yazılamadı (${r.status}): ${r.data.message || ''}. Token'ın "Contents: Read and write" iznini kontrol et.`);
}
async function ghDelete(file, message) {
  const c = ghCfg();
  const sha = await ghSha(file);
  if (!sha) return;
  const r = await gh('DELETE', `/contents/commands/${file}`, { message, branch: c.branch, sha });
  if (!r.ok) throw new CmdError(`GitHub'dan silinemedi (${r.status}): ${r.data.message || ''}`);
}

// ---------- Discord kaydi ----------
function restAndRoute() {
  const rest = new REST().setToken(process.env.TOKEN);
  const g = process.env.GUILD_ID;
  return {
    rest,
    collection: g ? Routes.applicationGuildCommands(process.env.CLIENT_ID, g) : Routes.applicationCommands(process.env.CLIENT_ID),
    one: id => (g ? Routes.applicationGuildCommand(process.env.CLIENT_ID, g, id) : Routes.applicationCommand(process.env.CLIENT_ID, id)),
  };
}
async function registerOnDiscord(command) {
  const { rest, collection } = restAndRoute();
  await rest.post(collection, { body: command.data.toJSON() }); // ayni isimliyse uzerine yazar, digerlerine dokunmaz
}
async function unregisterOnDiscord(name) {
  const { rest, collection, one } = restAndRoute();
  const all = await rest.get(collection);
  const found = all.find(c => c.name === name);
  if (found) await rest.delete(one(found.id));
}

// ---------- kod dogrulama ----------
function loadFresh(file) {
  delete require.cache[require.resolve(file)];
  return require(file);
}

// Kodu gecici dosyaya yazip yukler; komut gecerliyse { name, command } doner.
function inspect(code) {
  if (typeof code !== 'string' || !code.trim()) throw new CmdError('Dosya boş.');
  if (code.length > MAX_CODE) throw new CmdError('Dosya çok büyük (en fazla 100 KB).');
  try { new vm.Script(code, { filename: 'komut.js' }); }
  catch (err) { throw new CmdError('Kodda sözdizimi hatası var: ' + err.message); }

  const tmp = path.join(COMMANDS_DIR, `__check_${crypto.randomBytes(4).toString('hex')}.js`);
  fs.writeFileSync(tmp, code);
  let command;
  try { command = loadFresh(tmp); }
  catch (err) { throw new CmdError('Dosya yüklenemedi: ' + err.message); }
  finally {
    try { delete require.cache[require.resolve(tmp)]; } catch {}
    fs.rmSync(tmp, { force: true });
  }
  if (!command || !command.data || typeof command.execute !== 'function' || typeof command.data.toJSON !== 'function') {
    throw new CmdError('Dosya bir komut gibi değil: module.exports içinde data (SlashCommandBuilder) ve execute fonksiyonu olmalı.');
  }
  const name = command.data.name;
  if (!NAME_RE.test(name)) throw new CmdError('Komut adı küçük harf, rakam, - veya _ içermeli (en fazla 32 karakter).');
  return { name, command };
}

// ---------- ekleme ----------
async function addCommand(client, code, { actorName = 'panel', origin = 'dosya' } = {}) {
  const { name } = inspect(code);
  const file = `${name}.js`;
  const target = path.join(COMMANDS_DIR, file);
  const list = await getList();
  const mine = list.find(x => x.name === name);

  if (!mine) {
    if (client.commands.has(name)) throw new CmdError(`/${name} adında hazır bir komut zaten var. Başka bir ad seç.`);
    if (fs.existsSync(target)) throw new CmdError(`commands/${file} zaten var. Başka bir ad seç.`);
  }

  const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  fs.writeFileSync(target, code);
  let command;
  try {
    command = loadFresh(target);
    await registerOnDiscord(command);
  } catch (err) {
    // geri al
    if (previous === null) fs.rmSync(target, { force: true }); else fs.writeFileSync(target, previous);
    throw new CmdError('Discord\'a kaydedilemedi: ' + (err.message || err));
  }
  client.commands.set(name, command);

  let github = false;
  let warn = '';
  if (ghCfg().token) {
    try { await ghPut(file, code, `Panel: /${name} komutu ${mine ? 'güncellendi' : 'eklendi'} (${actorName})`); github = true; }
    catch (err) { warn = err.message; }
  }

  const entry = { name, description: command.data.description || '', file, origin, github, createdAt: mine ? mine.createdAt : Date.now() };
  await saveList([...list.filter(x => x.name !== name), entry]);

  let message = `/${name} eklendi ve Discord'a kaydedildi.`;
  if (github) message += ' GitHub\'a da yazıldı.';
  else if (warn) message += ' Uyarı: ' + warn;
  else message += ' Uyarı: GITHUB_TOKEN yok, GitHub\'a yazılmadı; bot yeniden başlarsa komut kaybolur.';
  return { ok: true, name, github, message };
}

// ---------- silme ----------
async function removeCommand(client, name) {
  const list = await getList();
  const entry = list.find(x => x.name === name);
  if (!entry) throw new CmdError('Bu komut panelden eklenmemiş; sadece panelden eklenenler silinebilir.');
  const target = path.join(COMMANDS_DIR, entry.file);

  client.commands.delete(name);
  try { delete require.cache[require.resolve(target)]; } catch {}
  fs.rmSync(target, { force: true });

  const problems = [];
  try { await unregisterOnDiscord(name); } catch (err) { problems.push('Discord: ' + err.message); }
  if (ghCfg().token) {
    try { await ghDelete(entry.file, `Panel: /${name} komutu silindi`); } catch (err) { problems.push(err.message); }
  }
  await saveList(list.filter(x => x.name !== name));
  return { ok: true, message: problems.length ? `/${name} silindi ama: ${problems.join(' | ')}` : `/${name} silindi.` };
}

// ---------- kod yazmadan komut uretici ----------
function buildCode(o) {
  const J = JSON.stringify;
  return [
    '// Panelden "kod yazmadan" olusturuldu. Degistirmek icin panelden silip yeniden olustur.',
    "const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');",
    '',
    `const NAME = ${J(o.name)};`,
    `const DESCRIPTION = ${J(o.description)};`,
    `const REPLY = ${J(o.reply)};`,
    `const USE_EMBED = ${o.embed ? 'true' : 'false'};`,
    `const TITLE = ${J(o.title)};`,
    `const COLOR = ${J(o.color)};`,
    `const EPHEMERAL = ${o.ephemeral ? 'true' : 'false'};`,
    '',
    'const fill = (text, i) => String(text)',
    '  .replace(/\\{user\\}/gi, "<@" + i.user.id + ">")',
    '  .replace(/\\{username\\}/gi, i.user.username)',
    '  .replace(/\\{server\\}/gi, i.guild ? i.guild.name : "DM")',
    '  .replace(/\\{members\\}/gi, i.guild ? i.guild.memberCount.toLocaleString("tr-TR") : "0");',
    '',
    'module.exports = {',
    '  data: new SlashCommandBuilder().setName(NAME).setDescription(DESCRIPTION),',
    '  async execute(interaction) {',
    '    const text = fill(REPLY, interaction);',
    '    const extra = EPHEMERAL ? { ephemeral: true } : {};',
    '    if (USE_EMBED) {',
    '      const embed = new EmbedBuilder().setDescription(text).setColor(COLOR);',
    '      if (TITLE) embed.setTitle(fill(TITLE, interaction));',
    '      return interaction.reply({ embeds: [embed], ...extra });',
    '    }',
    '    return interaction.reply({ content: text, ...extra });',
    '  },',
    '};',
    '',
  ].join('\n');
}

function validateBuilder(b) {
  const text = (v, max, label, required = true) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (required && !s) throw new CmdError(`${label} boş olamaz.`);
    if (s.length > max) throw new CmdError(`${label} en fazla ${max} karakter olabilir.`);
    return s;
  };
  const name = text(b.name, 32, 'Komut adı').toLowerCase().replace(/^\/+/, '');
  if (!NAME_RE.test(name)) throw new CmdError('Komut adı sadece küçük harf, rakam, - ve _ içerebilir (boşluk yok).');
  const color = '#' + String(b.color || '5865F2').replace('#', '');
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new CmdError('Renk 6 haneli hex olmalı (örn. 5865F2).');
  return {
    name,
    description: text(b.description, 100, 'Açıklama'),
    reply: text(b.reply, 1900, 'Cevap'),
    embed: !!b.embed,
    title: text(b.title, 200, 'Başlık', false),
    color,
    ephemeral: !!b.ephemeral,
  };
}

module.exports = { CmdError, MAX_CODE, getList, githubInfo, addCommand, removeCommand, buildCode, validateBuilder };
