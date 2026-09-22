const board = document.getElementById('board');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const modeBadge = document.getElementById('modeBadge');
const tickerTrack = document.getElementById('tickerTrack');
const loginGate = document.getElementById('loginGate');
const rangeSelect = document.getElementById('rangeSelect');
const app = document.getElementById('app');
const userName = document.getElementById('userName');

let recentEvents = [];
let currentEs = null;

function setStatus(state, label) {
  statusDot.className = 'dot' + (state ? ' ' + state : '');
  statusText.textContent = label;
}

function popularityWidth(p) {
  return Math.max(4, Math.min(100, p || 0)) + '%';
}

function deltaLabel(change) {
  if (!change) return { text: '—', cls: 'flat' };
  if (change.type === 'entry') return { text: 'NUEVO', cls: 'new' };
  if (change.type === 'up') return { text: `▲ ${change.from - change.to}`, cls: 'up' };
  if (change.type === 'down') return { text: `▼ ${change.to - change.from}`, cls: 'down' };
  return { text: '—', cls: 'flat' };
}

function renderBoard(tracks, changesById) {
  board.innerHTML = '';
  if (!tracks.length) {
    board.innerHTML = '<div class="empty">Todavía no tenemos suficiente historial de escucha para armar tu top. Probá con un rango más amplio.</div>';
    return;
  }
  tracks.forEach((track) => {
    const change = changesById.get(track.id);
    const row = document.createElement('div');
    row.className = 'row';
    if (change) row.classList.add(`flash-${change.type === 'entry' ? 'entry' : change.type}`);

    const cover = track.image
      ? `<img class="cover" src="${track.image}" alt="" />`
      : `<div class="cover placeholder">—</div>`;

    const d = deltaLabel(change);

    row.innerHTML = `
      <div class="rank">${track.position}</div>
      ${cover}
      <div class="meta">
        <div class="title">${escapeHtml(track.name)}</div>
        <div class="artist">${escapeHtml(track.artists)}</div>
      </div>
      <div class="right">
        <div class="pop-bar"><span style="width:${popularityWidth(track.popularity)}"></span></div>
        <div class="delta ${d.cls}">${d.text}</div>
      </div>
    `;
    board.appendChild(row);

    if (change) {
      setTimeout(() => row.classList.remove(`flash-${change.type === 'entry' ? 'entry' : change.type}`), 1200);
    }
  });
}

function tickerLine(change) {
  const name = escapeHtml(change.name);
  const artist = escapeHtml(change.artists || '');
  if (change.type === 'entry') return `<span class="ticker-item"><span class="new">● NUEVO</span> "${name}" — ${artist} entra a tu top en #${change.position}</span>`;
  if (change.type === 'exit') return `<span class="ticker-item"><span class="exit">○ SALE</span> "${name}" — ${artist} sale de tu top</span>`;
  if (change.type === 'up') return `<span class="ticker-item"><span class="up">▲</span> "${name}" sube de #${change.from} a #${change.to} en tu top</span>`;
  if (change.type === 'down') return `<span class="ticker-item"><span class="down">▼</span> "${name}" baja de #${change.from} a #${change.to} en tu top</span>`;
  return '';
}

function renderTicker() {
  if (!recentEvents.length) {
    tickerTrack.innerHTML = '<span class="ticker-empty">sin movimientos todavía en tu top…</span>';
    return;
  }
  const html = recentEvents.map(tickerLine).join('<span class="ticker-item">·</span>');
  tickerTrack.innerHTML = html + '<span class="ticker-item">·</span>' + html;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- Sesión / login con Spotify ----------
async function checkSession() {
  try {
    const res = await fetch('/api/session');
    if (!res.ok) throw new Error('no session');
    const data = await res.json();
    return data.authenticated ? data : null;
  } catch {
    return null;
  }
}

function showLoginGate() {
  app.hidden = true;
  loginGate.hidden = false;
}

function showApp(displayName) {
  loginGate.hidden = true;
  app.hidden = false;
  userName.textContent = displayName || '';
}

// ---------- Conexión SSE (según el rango elegido) ----------
function connect(range) {
  if (currentEs) currentEs.close();
  recentEvents = [];
  renderTicker();
  setStatus(null, 'conectando…');

  const es = new EventSource(`/api/events?range=${encodeURIComponent(range)}`);
  currentEs = es;

  es.onopen = () => setStatus('live', 'en vivo');

  es.addEventListener('snapshot', (evt) => {
    const data = JSON.parse(evt.data);
    modeBadge.hidden = !data.demo;
    setStatus('live', data.demo ? 'en vivo (demo)' : 'en vivo');

    const changesById = new Map(data.changes.map((c) => [c.id, c]));
    renderBoard(data.tracks, changesById);

    if (data.changes.length) {
      recentEvents = [...data.changes, ...recentEvents].slice(0, 20);
      renderTicker();
    }
  });

  es.addEventListener('auth_required', () => {
    setStatus('error', 'sesión vencida');
    showLoginGate();
  });

  es.addEventListener('error', () => {
    setStatus('error', 'error al leer Spotify — reintentando…');
  });

  es.onerror = () => {
    setStatus('error', 'conexión perdida — reconectando…');
  };
}

// ---------- Init ----------
(async function init() {
  const session = await checkSession();
  if (!session) {
    showLoginGate();
    return;
  }
  showApp(session.displayName);
  connect(rangeSelect.value);

  rangeSelect.addEventListener('change', () => connect(rangeSelect.value));
})();