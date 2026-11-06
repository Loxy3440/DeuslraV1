const http = require('http');
const fs = require('fs');
const path = require('path');
const { getMemberCount, STATS_GUILD_ID } = require('./activityRotator');
const auth = require('./dashAuth');
const { handleAdmin, ApiError } = require('./adminApi');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function buildStats(client) {
  const guild = client.guilds.cache.get(STATS_GUILD_ID);
  return {
    ready: client.isReady(),
    guildName: guild?.name ?? null,
    guildIcon: guild?.iconURL({ size: 128 }) ?? null,
    members: getMemberCount(client),
    channels: guild?.channels.cache.size ?? null,
    roles: guild?.roles.cache.size ?? null,
    boosts: guild?.premiumSubscriptionCount ?? null,
    boostTier: guild?.premiumTier ?? null,
    totalGuilds: client.guilds.cache.size,
    commands: client.commands?.size ?? 0,
    ping: Math.round(client.ws.ping),
    uptime: Math.round(process.uptime()),
    bot: client.user ? { tag: client.user.tag, avatar: client.user.displayAvatarURL({ size: 128 }) } : null,
    time: Date.now(),
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 150_000) { reject(new ApiError(413, 'İstek çok büyük.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new ApiError(400, 'Geçersiz JSON.')); }
    });
    req.on('error', reject);
  });
}

// Değiştiren isteklerde CSRF koruması: özel başlık + (varsa) aynı origin.
function csrfOk(req) {
  if (req.headers['x-requested-with'] !== 'panel') return false;
  const origin = req.headers.origin;
  if (origin) {
    try { return new URL(origin).host === new URL(auth.baseUrl()).host; } catch { return false; }
  }
  return true;
}

function redirect(res, to, extraHeaders = {}) {
  res.writeHead(302, { Location: to, ...extraHeaders });
  res.end();
}

async function handleAuthRoutes(req, res, url) {
  if (url.pathname === '/auth/login') {
    if (!process.env.CLIENT_SECRET) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('CLIENT_SECRET tanimli degil. Render > Environment kismina ekle.');
    }
    const state = require('crypto').randomBytes(16).toString('hex');
    return redirect(res, auth.loginUrl(state), { 'Set-Cookie': auth.cookie(auth.STATE_COOKIE, state, 10 * 60 * 1000) });
  }

  if (url.pathname === '/auth/callback') {
    const cookies = auth.parseCookies(req);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state || state !== cookies[auth.STATE_COOKIE]) return redirect(res, '/panel.html?err=state');
    try {
      const user = await auth.exchangeCode(code);
      if (!auth.isAdmin(user.id)) return redirect(res, '/panel.html?err=forbidden', { 'Set-Cookie': auth.cookie(auth.STATE_COOKIE, '', 0) });
      return redirect(res, '/panel.html', {
        'Set-Cookie': [auth.cookie(auth.SESSION_COOKIE, auth.makeSession(user), auth.SESSION_MS), auth.cookie(auth.STATE_COOKIE, '', 0)],
      });
    } catch (err) {
      console.error('[AUTH]', err.message);
      return redirect(res, '/panel.html?err=login');
    }
  }

  if (url.pathname === '/auth/logout') {
    return redirect(res, '/panel.html', { 'Set-Cookie': auth.cookie(auth.SESSION_COOKIE, '', 0) });
  }
  return false;
}

function startWebServer(client) {
  const port = process.env.PORT || 3000;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith('/auth/')) {
      const handled = await handleAuthRoutes(req, res, url);
      if (handled !== false) return;
    }

    if (url.pathname === '/api/me') {
      const session = auth.getSession(req);
      return sendJson(res, 200, session ? { loggedIn: true, user: { id: session.id, name: session.name, avatar: session.avatar } } : { loggedIn: false });
    }

    if (url.pathname.startsWith('/api/admin/')) {
      const session = auth.getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Giriş yapmalısın.' });
      if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { error: 'Yöntem desteklenmiyor.' });
      if (req.method === 'POST' && !csrfOk(req)) return sendJson(res, 403, { error: 'İstek reddedildi.' });
      try {
        const body = req.method === 'POST' ? await readBody(req) : null;
        const result = await handleAdmin(client, req.method, url.pathname.slice('/api/admin/'.length), body, session, url.searchParams);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, err.status || 500, { error: err.message || 'Hata' });
      }
    }

    if (url.pathname === '/api/stats') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*', // dashboard GitHub Pages gibi başka yerden de açılabilsin
      });
      return res.end(JSON.stringify(buildStats(client)));
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('ok');
    }

    // Statik dosyalar (public/). Klasör dışına çıkmayı engelle.
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403);
      return res.end('Yasak');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Bulunamadi');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });

  server.listen(port, () => console.log(`[WEB] Port ${port} dinleniyor (dashboard + /api/stats).`));
  return server;
}

module.exports = { startWebServer };
