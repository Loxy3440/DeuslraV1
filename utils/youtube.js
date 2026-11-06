const { getDb } = require('./db');

const MAX_CHANNELS = 10; // bir sunucuda izlenecek en fazla YouTube kanali
const MAX_ANNOUNCE_PER_CHANNEL = 5; // tek seferde bir kanal icin en fazla kac video paylasilsin (spam korumasi)
const MAX_SEEN = 60; // kanal basina hatirlanan video sayisi

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  // Avrupa'daki "cerez onayi" sayfasina takilmamak icin
  Cookie: 'CONSENT=YES+1; SOCS=CAI',
};

async function fetchText(url) {
  const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function decodeXml(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, '&');
}

// ---------- Link -> kanal ID ----------
const CHANNEL_ID_RE = /^UC[\w-]{22}$/;

// Girilen metni ya dogrudan kanal ID'sine ya da kanal sayfasi adresine cevirir. Desteklenmiyorsa null.
function interpretInput(raw) {
  let text = String(raw || '').trim().replace(/[),.;]+$/, '');
  if (!text) return null;
  if (CHANNEL_ID_RE.test(text)) return { channelId: text };
  if (text.startsWith('@')) return { pageUrl: `https://www.youtube.com/${text}` };
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return null;

  const [first, second] = url.pathname.split('/').filter(Boolean);
  if (first === 'channel' && CHANNEL_ID_RE.test(second || '')) return { channelId: second };
  if (first && first.startsWith('@')) return { pageUrl: `https://www.youtube.com/${first}` };
  if ((first === 'c' || first === 'user') && second) return { pageUrl: `https://www.youtube.com/${first}/${second}` };
  return null; // video, shorts, playlist vb. desteklenmez
}

// Kanal sayfasinin HTML'inden kanal ID'sini cikarir.
function extractChannelId(html) {
  const patterns = [
    /feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/,
    /<link[^>]+rel="canonical"[^>]+href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /"externalId":"(UC[\w-]{22})"/,
    /<meta[^>]+itemprop="(?:channelId|identifier)"[^>]+content="(UC[\w-]{22})"/,
    /"channelId":"(UC[\w-]{22})"/,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return m[1];
  }
  return null;
}

async function resolveChannelId(raw) {
  const parsed = interpretInput(raw);
  if (!parsed) throw new Error('Gecerli bir YouTube kanal linki degil (kanal linki, @kullaniciadi veya /channel/ linki olmali)');
  if (parsed.channelId) return parsed.channelId;

  let html;
  try {
    html = await fetchText(parsed.pageUrl);
  } catch (err) {
    throw new Error(`Kanal sayfasi acilamadi (${err.message})`);
  }
  const id = extractChannelId(html);
  if (!id) throw new Error('Kanal ID\'si bulunamadi');
  return id;
}

// ---------- RSS ----------
function parseFeed(xml) {
  const firstEntry = xml.indexOf('<entry>');
  const head = firstEntry === -1 ? xml : xml.slice(0, firstEntry);
  const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(head);

  const videos = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const body = m[1];
    const id = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(body)?.[1];
    if (!id) continue;
    videos.push({
      id,
      title: decodeXml(/<title>([\s\S]*?)<\/title>/.exec(body)?.[1] || 'Yeni video').trim(),
      published: /<published>([^<]+)<\/published>/.exec(body)?.[1] || null,
    });
  }
  return { title: titleMatch ? decodeXml(titleMatch[1]).trim() : null, videos };
}

async function fetchFeed(channelId) {
  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  return parseFeed(xml);
}

// ---------- Veritabani ----------
async function getYtConfig(guildId) {
  return getDb().collection('ytConfig').findOne({ guildId });
}

async function saveYtConfig(guildId, data) {
  await getDb().collection('ytConfig').updateOne(
    { guildId },
    { $set: { ...data, guildId, updatedAt: new Date() } },
    { upsert: true },
  );
}

// ---------- Yeni video kontrolu ve paylasim ----------
const running = new Set(); // ayni sunucuda /yt ust uste calisip ayni videoyu iki kez atmasin

function buildMessage(channelTitle, video) {
  return `@here **${channelTitle}** yeni bir video yukledi!\n**${video.title}**\nhttps://www.youtube.com/watch?v=${video.id}`;
}

// Her izlenen kanal icin yeni videolari bulur, duyuru kanalina atar. Sonuc listesi doner.
async function checkAndAnnounce(guild, config) {
  if (running.has(guild.id)) throw new Error('Kontrol zaten calisiyor, birkac saniye sonra tekrar dene.');
  running.add(guild.id);

  try {
    const announceChannel = guild.channels.cache.get(config.announceChannelId);
    if (!announceChannel || !announceChannel.isTextBased()) {
      throw new Error('Duyuru kanali bulunamadi. /setyt ile tekrar ayarla.');
    }

    const results = [];
    const updates = new Map(); // channelId -> { title, seen, baselined }

    for (const entry of config.channels) {
      const result = { channelId: entry.channelId, title: entry.title || entry.channelId, posted: 0, skipped: 0, status: 'ok' };
      results.push(result);

      let feed;
      try {
        feed = await fetchFeed(entry.channelId);
      } catch (err) {
        result.status = 'error';
        result.error = err.message;
        continue;
      }

      const title = feed.title || entry.title || entry.channelId;
      result.title = title;
      const seen = new Set(entry.seen || []);

      // Ilk kez goruluyorsa (kurulumda feed alinamamissa) mevcut videolari sadece "goruldu" say, paylasma.
      if (!entry.baselined) {
        feed.videos.forEach(v => seen.add(v.id));
        result.status = 'baseline';
        updates.set(entry.channelId, { title, seen: [...seen].slice(-MAX_SEEN), baselined: true });
        continue;
      }

      // Feed yeniden eskiye gelir; paylasimi eskiden yeniye yap.
      const fresh = feed.videos.filter(v => !seen.has(v.id)).reverse();
      const toPost = fresh.slice(-MAX_ANNOUNCE_PER_CHANNEL);
      result.skipped = fresh.length - toPost.length;

      // Tasmayi onlemek icin atlananlari da goruldu say.
      fresh.slice(0, result.skipped).forEach(v => seen.add(v.id));

      for (const video of toPost) {
        try {
          await announceChannel.send({
            content: buildMessage(title, video),
            allowedMentions: { parse: ['everyone'] },
          });
          seen.add(video.id);
          result.posted++;
        } catch (err) {
          result.status = 'error';
          result.error = `Mesaj gonderilemedi: ${err.message}`;
          break; // gonderilemeyen video "goruldu" sayilmaz, sonraki /yt'de tekrar denenir
        }
      }

      // Feed'de olanlari her zaman hatirla; fazlasini kirp.
      updates.set(entry.channelId, { title, seen: [...seen].slice(-MAX_SEEN), baselined: true });
    }

    // Guncel ayari tekrar okuyup sadece bu kanallarin kayitlarini guncelle (arada /setyt yapildiysa ezmesin).
    const latest = (await getYtConfig(guild.id)) || config;
    const merged = latest.channels.map(c => (updates.has(c.channelId) ? { ...c, ...updates.get(c.channelId) } : c));
    await saveYtConfig(guild.id, { channels: merged });

    return results;
  } finally {
    running.delete(guild.id);
  }
}

// Tek bir videoyu duyuru kanalina atar ve "goruldu" olarak kaydeder (/ytsend icin).
async function announceVideo(guild, config, channelEntry, channelTitle, video) {
  const announceChannel = guild.channels.cache.get(config.announceChannelId);
  if (!announceChannel || !announceChannel.isTextBased()) {
    throw new Error('Duyuru kanali bulunamadi. /setyt ile tekrar ayarla.');
  }

  await announceChannel.send({
    content: buildMessage(channelTitle, video),
    allowedMentions: { parse: ['everyone'] },
  });

  // Ayni video sonra /yt ile tekrar atilmasin.
  const latest = (await getYtConfig(guild.id)) || config;
  const channels = latest.channels.map(c => {
    if (c.channelId !== channelEntry.channelId) return c;
    const seen = [...new Set([...(c.seen || []), video.id])].slice(-MAX_SEEN);
    return { ...c, title: channelTitle, seen };
  });
  await saveYtConfig(guild.id, { channels });
  return announceChannel;
}

module.exports = {
  announceVideo,
  MAX_CHANNELS,
  MAX_ANNOUNCE_PER_CHANNEL,
  interpretInput,
  extractChannelId,
  resolveChannelId,
  parseFeed,
  fetchFeed,
  getYtConfig,
  saveYtConfig,
  checkAndAnnounce,
  buildMessage,
};