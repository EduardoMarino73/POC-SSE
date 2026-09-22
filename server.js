// server.js
// Servidor mínimo (sin dependencias externas):
//  1) Authorization Code Flow con Spotify (login real del usuario)
//  2) pollea GET /me/top/tracks (tus canciones más escuchadas)
//  3) detecta cambios de posición/entradas/salidas
//  4) transmite todo por Server-Sent Events (SSE), una conexión por usuario/rango
//
// Sin credenciales configuradas, arranca en MODO DEMO (sin login real).

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

loadDotEnv();

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || `http://localhost:${PORT}/callback`;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 45000);
const VALID_RANGES = ['short_term', 'medium_term', 'long_term'];

const DEMO_MODE = !CLIENT_ID || !CLIENT_SECRET;

if (DEMO_MODE) {
  console.log('⚠️  No encontré SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET en .env');
  console.log('   Arrancando en MODO DEMO (sin login real).');
  console.log('   Completá .env (ver .env.example) para conectar tu cuenta de Spotify.\n');
}

// ---------- Sesiones en memoria ----------
const sessions = new Map(); // sid -> { accessToken, refreshToken, expiresAt, displayName }

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function httpsJson(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function getSession(req) {
  if (DEMO_MODE) return { demo: true, displayName: 'Demo' };
  const { sid } = parseCookies(req);
  if (!sid || !sessions.has(sid)) return null;
  return sessions.get(sid);
}

async function ensureFreshToken(session) {
  if (session.demo) return session;
  if (Date.now() < session.expiresAt - 10000) return session;
  const postData = 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(session.refreshToken);
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const data = await httpsJson(
    {
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    },
    postData
  );
  session.accessToken = data.access_token;
  session.expiresAt = Date.now() + data.expires_in * 1000;
  if (data.refresh_token) session.refreshToken = data.refresh_token;
  return session;
}

// ---------- Spotify: leer "mis top tracks" ----------
async function fetchMyTopTracks(accessToken, range) {
  const data = await httpsJson({
    hostname: 'api.spotify.com',
    path: `/v1/me/top/tracks?time_range=${range}&limit=50`,
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return (data.items || []).map((track, index) => ({
    id: track.id,
    position: index + 1,
    name: track.name,
    artists: (track.artists || []).map((a) => a.name).join(', '),
    album: track.album ? track.album.name : '',
    image: track.album && track.album.images && track.album.images[0] ? track.album.images[0].url : null,
    popularity: track.popularity,
  }));
}

// ---------- Modo demo ----------
const DEMO_SONGS = [
  ['Luz de Neón', 'Marea Sur'], ['Vértigo', 'Cala'], ['Costanera', 'Nico Ríos'],
  ['Doble Filo', 'Vainilla Negra'], ['Satélite', 'Juli Rey'], ['Vidrio', 'Marea Sur'],
  ['Ola Cero', 'Fénix 21'], ['Contraluz', 'Cala'], ['Sin Freno', 'Tomás Bravo'],
  ['Deriva', 'Nico Ríos'], ['Fuego Lento', 'Juli Rey'], ['Cassette', 'Vainilla Negra'],
  ['Horizonte', 'Fénix 21'], ['Mareas', 'Tomás Bravo'], ['Polvo de Estrellas', 'Cala'],
  ['Litoral', 'Marea Sur'], ['Sombra Larga', 'Juli Rey'], ['Radio Fantasma', 'Fénix 21'],
  ['Pulso', 'Nico Ríos'], ['Fin de Semana', 'Tomás Bravo'],
];

function buildDemoSnapshot() {
  return DEMO_SONGS.map(([name, artist], i) => ({
    id: `demo-${i}`, position: i + 1, name, artists: artist, album: 'Sencillo', image: null,
    popularity: 90 - i * 2,
  }));
}

function nextDemoSnapshot(prev) {
  const base = prev.length ? prev.map((t) => ({ ...t })) : buildDemoSnapshot();
  const a = Math.floor(Math.random() * base.length);
  let b = Math.floor(Math.random() * base.length);
  if (b === a) b = (b + 1) % base.length;
  const tmp = { ...base[a] };
  base[a] = { ...base[b] };
  base[b] = tmp;
  base.forEach((t, i) => {
    t.position = i + 1;
    t.popularity = Math.max(1, Math.min(100, t.popularity + (Math.random() > 0.5 ? 1 : -1)));
  });
  return base;
}

// ---------- Diff entre snapshots ----------
function diffSnapshots(prev, curr) {
  const prevById = new Map(prev.map((t) => [t.id, t]));
  const changes = [];
  for (const track of curr) {
    const before = prevById.get(track.id);
    if (!before) {
      changes.push({ type: 'entry', id: track.id, name: track.name, artists: track.artists, position: track.position });
    } else if (before.position !== track.position) {
      changes.push({
        type: track.position < before.position ? 'up' : 'down',
        id: track.id, name: track.name, artists: track.artists,
        from: before.position, to: track.position,
      });
    }
  }
  if (prev.length) {
    const currIds = new Set(curr.map((t) => t.id));
    for (const track of prev) {
      if (!currIds.has(track.id)) {
        changes.push({ type: 'exit', id: track.id, name: track.name, artists: track.artists, position: track.position });
      }
    }
  }
  return changes;
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ---------- HTTP server ----------
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ---- Login: redirige a Spotify ----
  if (url.pathname === '/login') {
    if (DEMO_MODE) {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    const state = crypto.randomBytes(8).toString('hex');
    const authUrl = new URL('https://accounts.spotify.com/authorize');
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('scope', 'user-top-read');
    authUrl.searchParams.set('state', state);
    res.writeHead(302, { Location: authUrl.toString() });
    return res.end();
  }

  // ---- Callback: intercambia el code por tokens ----
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error || !code) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end(`No se pudo conectar con Spotify: ${error || 'sin código'}`);
    }
    try {
      const postData = `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
      const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
      const tokenData = await httpsJson(
        {
          hostname: 'accounts.spotify.com', path: '/api/token', method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        postData
      );

      const me = await httpsJson({
        hostname: 'api.spotify.com', path: '/v1/me', method: 'GET',
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      const sid = crypto.randomBytes(16).toString('hex');
      sessions.set(sid, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + tokenData.expires_in * 1000,
        displayName: me.display_name || 'vos',
      });

      res.writeHead(302, {
        'Set-Cookie': `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`,
        Location: '/',
      });
      return res.end();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Error autenticando con Spotify: ' + err.message);
    }
  }

  // ---- Logout ----
  if (url.pathname === '/logout') {
    const { sid } = parseCookies(req);
    if (sid) sessions.delete(sid);
    res.writeHead(302, { 'Set-Cookie': 'sid=; Max-Age=0; Path=/', Location: '/' });
    return res.end();
  }

  // ---- Estado de sesión (lo usa el frontend para mostrar login o app) ----
  if (url.pathname === '/api/session') {
    const session = getSession(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(
      session ? { authenticated: true, displayName: session.displayName, demo: !!session.demo }
              : { authenticated: false }
    ));
  }

  // ---- SSE: stream personalizado por usuario + rango ----
  if (url.pathname === '/api/events') {
    let session = getSession(req);
    if (!session) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      sseSend(res, 'auth_required', {});
      return res.end();
    }

    const range = VALID_RANGES.includes(url.searchParams.get('range')) ? url.searchParams.get('range') : 'medium_term';

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('\n');

    let lastSnapshot = [];

    const pollOnce = async () => {
      try {
        session = await ensureFreshToken(session);
        const fresh = DEMO_MODE ? nextDemoSnapshot(lastSnapshot) : await fetchMyTopTracks(session.accessToken, range);
        const changes = diffSnapshots(lastSnapshot, fresh);
        lastSnapshot = fresh;
        sseSend(res, 'snapshot', { tracks: fresh, changes, demo: DEMO_MODE, updatedAt: new Date().toISOString() });
      } catch (err) {
        console.error('[poll] error:', err.message);
        sseSend(res, 'error', { message: err.message });
      }
    };

    await pollOnce();
    const interval = setInterval(pollOnce, POLL_INTERVAL_MS);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);

    req.on('close', () => {
      clearInterval(interval);
      clearInterval(heartbeat);
    });
    return;
  }

  // ---- Archivos estáticos ----
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(__dirname, 'public', filePath);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`🎧 Servidor arriba en http://localhost:${PORT}`);
  console.log(`   Modo: ${DEMO_MODE ? 'DEMO (sin login real)' : 'REAL (login con Spotify)'}`);
});