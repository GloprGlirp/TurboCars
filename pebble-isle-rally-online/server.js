// Pebble Isle Rally game server.
// Serves the game page and relays live positions and race starts between players over a WebSocket.
// Player saves (money, XP, cars, parts) stay in each player's own browser; the server only keeps the lap records.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 40);
const PUBLIC = path.join(__dirname, 'public');
const RECORDS_FILE = process.env.RECORDS_FILE || path.join(__dirname, 'records.json');

// ---------- lap records ----------
let records = {};
try { records = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8')) || {}; } catch (e) { records = {}; }
let saveTimer = null;
function saveRecords() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(RECORDS_FILE, JSON.stringify(records), () => { }), 1000);
}
function topRecords() {
  return Object.entries(records).map(([id, r]) => Object.assign({ id }, r)).sort((a, b) => a.lap - b.lap).slice(0, 10);
}
const PAINTS = ['cherry', 'tangerine', 'lemon', 'mint', 'sky', 'grape', 'bubblegum', 'snow', 'midnight'];
const BODIES = ['bubble', 'zippy', 'buggy', 'kaze', 'muscle', 'truck', 'falcon', 'vento'];
const cleanName = s => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '').trim().slice(0, 14) : '');

// ---------- static files ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  const file = path.normalize(path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- live room ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });
const clients = new Map(); // ws -> { peer, presence, tokens, alive }

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg, except) {
  const text = JSON.stringify(msg);
  for (const ws of clients.keys()) if (ws !== except && ws.readyState === 1) ws.send(text);
}

wss.on('connection', ws => {
  if (clients.size >= MAX_PLAYERS) { send(ws, { t: 'full' }); ws.close(1013, 'full'); return; }
  const me = { peer: crypto.randomBytes(8).toString('hex'), presence: {}, tokens: 80, alive: true };
  clients.set(ws, me);
  send(ws, {
    t: 'hello', peer: me.peer, records: topRecords(),
    peers: [...clients.values()].filter(c => c !== me).map(c => ({ peer: c.peer, presence: c.presence })),
  });

  ws.on('pong', () => { me.alive = true; });
  ws.on('message', raw => {
    // simple rate limit: about 40 messages a second with a small burst
    if (me.tokens <= 0) return;
    me.tokens--;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'presence' && m.presence && typeof m.presence === 'object' && !Array.isArray(m.presence)) {
      if (JSON.stringify(m.presence).length > 4096) return;
      me.presence = m.presence;
      broadcast({ t: 'presence', peer: me.peer, presence: me.presence }, ws);
    } else if (m.t === 'emit' && m.topic === 'race') {
      if (JSON.stringify(m.data || null).length > 4096) return;
      broadcast({ t: 'msg', topic: 'race', data: m.data, peer: me.peer }, ws);
    } else if (m.t === 'record' && typeof m.id === 'string' && /^p[a-z0-9]{4,24}$/.test(m.id) && m.rec && typeof m.rec === 'object') {
      const lap = Number(m.rec.lap), total = Number(m.rec.total);
      if (!Number.isFinite(lap) || lap < 15000 || lap > 600000) return; // a lap under 15 s isn't real
      const prev = records[m.id];
      if (prev && prev.lap <= lap) return;
      records[m.id] = {
        lap: Math.round(lap), total: Number.isFinite(total) ? Math.round(total) : 0,
        nick: cleanName(m.rec.nick) || 'Racer',
        body: BODIES.includes(m.rec.body) ? m.rec.body : 'bubble',
        paint: PAINTS.includes(m.rec.paint) ? m.rec.paint : 'cherry',
        at: Date.now(),
      };
      saveRecords();
      broadcast({ t: 'records', records: topRecords() });
    }
  });
  ws.on('close', () => {
    clients.delete(ws);
    broadcast({ t: 'left', peer: me.peer });
  });
});

// refill rate-limit tokens and drop dead connections
setInterval(() => { for (const c of clients.values()) c.tokens = Math.min(80, c.tokens + 40); }, 1000);
setInterval(() => {
  for (const [ws, c] of clients) {
    if (!c.alive) { ws.terminate(); continue; }
    c.alive = false; ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log('Pebble Isle Rally running on http://localhost:' + PORT));
