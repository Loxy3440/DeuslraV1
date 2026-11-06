const crypto = require('crypto');

const SESSION_COOKIE = 'gd_session';
const STATE_COOKIE = 'gd_state';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function baseUrl() {
  return (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
}

function secret() {
  // SESSION_SECRET yoksa bot token'ından türetilir (sızdırılmaz, ama ayrı bir secret daha iyi).
  return process.env.SESSION_SECRET || crypto.createHash('sha256').update('gd:' + (process.env.TOKEN || '')).digest('hex');
}

// Panele girebilenler: OWNER_ID ve (isteğe bağlı) DASHBOARD_ADMIN_IDS=id1,id2
function isAdmin(userId) {
  if (!userId) return false;
  const ids = [process.env.OWNER_ID, ...(process.env.DASHBOARD_ADMIN_IDS || '').split(',')]
    .map(s => (s || '').trim())
    .filter(Boolean);
  return ids.includes(String(userId));
}

const sign = data => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

function makeSession(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, name: user.name, avatar: user.avatar, exp: Date.now() + SESSION_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readSession(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    if (!isAdmin(data.id)) return null; // yetki sonradan alındıysa oturum da geçersiz
    return data;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, maxAgeMs) {
  const secure = baseUrl().startsWith('https') ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
}

function getSession(req) {
  return readSession(parseCookies(req)[SESSION_COOKIE]);
}

// ---------- Discord OAuth2 (yalnızca "identify" izni) ----------
function loginUrl(state) {
  const p = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    redirect_uri: baseUrl() + '/auth/callback',
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'none',
  });
  return 'https://discord.com/oauth2/authorize?' + p;
}

async function exchangeCode(code) {
  const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET || '',
      grant_type: 'authorization_code',
      code,
      redirect_uri: baseUrl() + '/auth/callback',
    }),
  });
  if (!tokenRes.ok) throw new Error('Token alınamadı (' + tokenRes.status + '). CLIENT_SECRET ve redirect adresini kontrol et.');
  const { access_token } = await tokenRes.json();
  const meRes = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: 'Bearer ' + access_token } });
  if (!meRes.ok) throw new Error('Kullanıcı bilgisi alınamadı.');
  const me = await meRes.json();
  return { id: me.id, name: me.global_name || me.username, avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null };
}

module.exports = { SESSION_COOKIE, STATE_COOKIE, SESSION_MS, baseUrl, isAdmin, makeSession, getSession, parseCookies, cookie, loginUrl, exchangeCode };
