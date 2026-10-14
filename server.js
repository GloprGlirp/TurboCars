// Pebble Isle Rally game server.
// Serves the game page, relays live positions and race starts, keeps the lap records
// and runs the player car market. Player saves (money, XP, cars) stay in each player's browser.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 40);
const PUBLIC = path.join(__dirname, 'public');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

// ---------- what a valid car looks like (mirrors the game) ----------
const PAINTS = ['cherry', 'tangerine', 'lemon', 'mint', 'sky', 'grape', 'bubblegum', 'snow', 'midnight'];
const BODIES = ['mini', 'bubble', 'brick', 'zippy', 'van', 'buggy', 'koi', 'kaze', 'pickup', 'muscle', 'truck', 'falcon', 'cruiser', 'tempest', 'vento', 'rocket', 'hatch', 'sedan', 'suv', 'coupe', 'gt', 'super', 'kitsune', 'hikari', 'sakura', 'yoru', 'raijin', 'arashi', 'oni', 'kaminari', 'hakone', 'shogun', 'tanuki', 'falke4', 'falke2', 'ostwind'];
const ENGINES = ['i4', 'i5', 'v6', 'i6', 'v8', 'v10', 'v12', 'kuro6'];
const INDUCTIONS = ['na', 't38', 't52', 't68', 'h76', 'c30', 'tsb', 'gt99'];
const INTAKES = ['stock', 'cai', 'ram', 'itb'];
const WHEELS = ['stock', 'star', 'dish', 'mesh', 'slick', 'knob', 'aero', 'split', 'y5', 'kagero', 'kagerow'];
const TYRES = ['street', 'sport', 'drift', 'semi', 'slick'];
const PARTS = { g: ['stock', 'short', 'long'], k: ['stock', 's1', 's2'], c: ['stock', 'rad', 'ic', 'full', 'ice'], p: ['stock', 'pist', 'rods', 'built', 'ti'], z: ['stock', 'irid', 'cold'], b: ['stock', 'pads', 'bbk', 'race'], x: ['stock', 's1', 's2', 'pro', 'bm'] };
const LOOK = { pl: ['lit', 'off'], kit: ['stock', 'street', 'wide'], wing: ['none', 'duck', 'gt', 'big'], stk: ['none', 'banner', 'hashiri', 'num', 'kings', 'devils', 'tengu'] };
const UPGRADES = ['engine', 'accel', 'grip', 'drift', 'nitro', 'susp'];
const cleanName = s => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '').trim().slice(0, 14) : '');
// ---------- word filter for usernames and chat (German + English) ----------
// SUB: blocked anywhere inside a word. WHOLE: blocked only as a whole word (they hide inside harmless words).
const BAD_SUB = ['arschloch', 'arschgeige', 'arsch', 'wichser', 'wixer', 'wichs', 'fotze', 'hurensohn', 'hure', 'schlampe', 'nutte', 'schwuchtel', 'spast', 'missgeburt', 'behindert',
  'mongo', 'bastard', 'fick', 'fuck', 'scheiss', 'kacke', 'pisser', 'schwanz', 'pimmel', 'muschi', 'titten', 'moese', 'nazi', 'hitler', 'siegheil', 'kanake', 'neger', 'nigg', 'zigeuner',
  'kinderficker', 'vergewaltig', 'porn', 'penis', 'vagina', 'dildo', 'bitch', 'slut', 'whore', 'cunt', 'faggot', 'retard', 'asshole', 'wanker', 'twat', 'shit', 'pussy', 'blowjob', 'handjob',
  'jerkoff', 'masturb', 'orgasm', 'nudes', 'hoden', 'sperma', 'judensau', 'heilhitler', 'killyourself', 'transe', 'tranny', 'dumbass', 'jackass', 'idiot', 'hurre', 'drecksau', 'sackgesicht',
  'wixxer', 'wichsa', 'spasti', 'schlitzauge', 'peniz', 'sex'];
const BAD_WHOLE = ['anal', 'cum', 'cock', 'dick', 'fag', 'heil', 'kkk', 'rape', 'tit', 'tits', 'nutten', 'opfer', 'depp', 'nigga', 'hoe', 'hoes', 'ss', 'nsdap', 'kys', 'assi', 'kotz'];
const BAD_OK = ['marsch', 'barsch', 'harsch', 'scunthorpe', 'mongol', 'sextett', 'sextant', 'essex', 'sussex', 'middlesex', 'schwanzflosse', 'unisex', 'mongoose'];
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i', '€': 'e' };
const rxOf = w => new RegExp(w.split('').map(c => c + '+').join(''));
const BAD_SUB_RX = BAD_SUB.map(rxOf), BAD_WHOLE_RX = BAD_WHOLE.map(w => new RegExp('^' + w.split('').map(c => c + '+').join('') + '$'));
function normWord(s) {
  s = String(s).toLowerCase().replace(/^[.,!?;:()"'\s]+|[.,!?;:()"'\s]+$/g, '').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[0134578@$!|€]/g, c => LEET[c] || c);
  return s.replace(/[^a-z]/g, '');
}
function badToken(w) {
  let n = normWord(w); if (!n) return false;
  for (const ok of BAD_OK) n = n.split(ok).join('_');
  if (BAD_WHOLE_RX.some(r => r.test(n))) return true;
  return BAD_SUB_RX.some(r => r.test(n));
}
// usernames: check each word and the whole name squashed together (catches "Ar sch" or "F.u.c.k")
function nameIsBad(name) {
  const parts = String(name).split(/[\s_.\-]+/).filter(Boolean);
  if (parts.some(badToken)) return true;
  const joined = normWord(name); let j = joined; for (const ok of BAD_OK) j = j.split(ok).join('_');
  return BAD_SUB_RX.some(r => r.test(j));
}
// chat: blank out bad words, including ones spelled out with spaces between the letters
function censorText(text) {
  const toks = String(text).split(/(\s+)/);
  const out = toks.slice();
  for (let i = 0; i < toks.length; i++) if (toks[i].trim() && badToken(toks[i])) out[i] = '*'.repeat(Math.min(8, toks[i].length));
  // runs of single letters: "f u c k"
  const words = []; toks.forEach((t, i) => { if (t.trim()) words.push(i); });
  for (let a = 0; a < words.length; a++) {
    if (normWord(toks[words[a]]).length !== 1) continue;
    let b = a; while (b + 1 < words.length && normWord(toks[words[b + 1]]).length === 1) b++;
    if (b - a >= 2) { const joined = words.slice(a, b + 1).map(i => toks[i]).join(''); if (badToken(joined) || nameIsBad(joined)) for (let k = a; k <= b; k++) out[words[k]] = '*'; }
    a = b;
  }
  return out.join('');
}
const safeName = s => { const n = cleanName(s); return n && !nameIsBad(n) ? n : 'Racer'; };

// licence plates: A-Z, 0-9, space and dash, up to 8, and nothing rude
function cleanPlate(p) { const t = String(p == null ? '' : p).toUpperCase().replace(/[^A-Z0-9 \-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 8); return t && !nameIsBad(t) ? t : ''; }
function cleanCar(c) {
  if (!c || typeof c !== 'object' || !BODIES.includes(c.m)) return null;
  const up = {};
  for (const k of UPGRADES) up[k] = Math.max(0, Math.min(5, Math.floor(Number(c.up && c.up[k]) || 0)));
  const t = c.tune && typeof c.tune === 'object' ? c.tune : {};
  const has = Array.isArray(t.has) ? t.has.filter(h => typeof h === 'string' && /^[eiawygkcpzbx]:[a-z0-9]{1,8}$/.test(h)).slice(0, 60) : [];
  return {
    m: c.m, paint: PAINTS.includes(c.paint) ? c.paint : 'cherry', up, neon: ['none', 'pink', 'cyan', 'green', 'purple', 'orange', 'yellow'].includes(c.neon) ? c.neon : 'none', stance: ['stock', 'low', 'slammed'].includes(c.stance) ? c.stance : 'stock',
    tune: { e: ENGINES.includes(t.e) ? t.e : 'i4', i: INDUCTIONS.includes(t.i) ? t.i : 'na', a: INTAKES.includes(t.a) ? t.a : 'stock', w: WHEELS.includes(t.w) ? t.w : 'stock', y: TYRES.includes(t.y) ? t.y : 'street', ...Object.fromEntries(Object.entries(PARTS).map(([k, l]) => [k, l.includes(t[k]) ? t[k] : 'stock'])), has },
    look: Object.fromEntries(Object.entries(LOOK).map(([k, l]) => [k, l.includes(c.look && c.look[k]) ? c.look[k] : l[0]])),
    lookOwn: Array.isArray(c.lookOwn) ? c.lookOwn.filter(x => typeof x === 'string' && /^[a-z]{2,5}:[a-z0-9]{1,10}$/.test(x)).slice(0, 40) : [],
    wear: Math.max(0, Math.min(1, Number(c.wear) || 0)),
    ecu: Object.fromEntries(['boost', 'timing', 'rev'].map(k => [k, Math.max(-1.25, Math.min(1.25, Number(c.ecu && c.ecu[k]) || 0))])),
    plate: cleanPlate(c.plate),
  };
}

// ---------- stored state: lap records, market listings, unpaid sales, player keys ----------
let state = { records: {}, listings: {}, sold: {}, auth: {} };
try { state = Object.assign(state, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || {}); } catch (e) {
  try { state.records = JSON.parse(fs.readFileSync(path.join(__dirname, 'records.json'), 'utf8')) || {}; } catch (e2) { }
}
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DATA_FILE, JSON.stringify(state), () => { }), 1000);
}
const topRecords = () => Object.entries(state.records).map(([id, r]) => Object.assign({ id }, r)).sort((a, b) => a.lap - b.lap).slice(0, 10);
const listingsOut = () => Object.values(state.listings).sort((a, b) => b.at - a.at).slice(0, 300);
const hashKey = k => crypto.createHash('sha256').update(String(k)).digest('hex');

// ---------- static files ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary' };
// files are gzipped once and kept in memory: the page and the car models load a lot faster
const zcache = new Map();
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  const file = path.normalize(path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    const type = TYPES[path.extname(file)] || 'application/octet-stream', gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const hit = zcache.get(file);
    const reply = e => {
      const h = { 'content-type': type, 'cache-control': path.extname(file) === '.glb' ? 'public, max-age=3600' : 'no-cache', vary: 'accept-encoding' };
      if (gz) h['content-encoding'] = 'gzip';
      res.writeHead(200, h); res.end(gz ? e.gz : e.raw);
    };
    if (hit && hit.mtime === st.mtimeMs) return reply(hit);
    fs.readFile(file, (err2, raw) => {
      if (err2) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
      zlib.gzip(raw, (err3, z) => { const e = { raw, gz: err3 ? null : z, mtime: st.mtimeMs }; if (!e.gz) { res.writeHead(200, { 'content-type': type }); res.end(raw); return; } zcache.set(file, e); reply(e); });
    });
  });
});

// ---------- live room ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const clients = new Map(); // ws -> { peer, pid, presence, tokens, alive }

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg, except) {
  const text = JSON.stringify(msg);
  for (const ws of clients.keys()) if (ws !== except && ws.readyState === 1) ws.send(text);
}
function toPlayer(pid, msg) { for (const [ws, c] of clients) if (c.pid === pid) send(ws, msg); }

wss.on('connection', ws => {
  if (clients.size >= MAX_PLAYERS) { send(ws, { t: 'full' }); ws.close(1013, 'full'); return; }
  const me = { peer: crypto.randomBytes(8).toString('hex'), pid: null, presence: {}, tokens: 80, alive: true };
  clients.set(ws, me);
  send(ws, {
    t: 'hello', peer: me.peer, now: Date.now(), records: topRecords(),
    peers: [...clients.values()].filter(c => c !== me).map(c => ({ peer: c.peer, presence: c.presence })),
  });
  send(ws, { t: 'mk_listings', listings: listingsOut() });

  const reply = (rq, ok, extra) => send(ws, Object.assign({ t: 'mk_res', rq, ok }, extra || {}));

  ws.on('pong', () => { me.alive = true; });
  ws.on('message', raw => {
    if (me.tokens <= 0) return;
    me.tokens--;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'presence' && m.presence && typeof m.presence === 'object' && !Array.isArray(m.presence)) {
      if (JSON.stringify(m.presence).length > 4096) return;
      if (typeof m.presence.n === 'string' && nameIsBad(m.presence.n)) m.presence.n = 'Racer';
      if (m.presence.pl != null) m.presence.pl = cleanPlate(m.presence.pl) || null;
      if (m.presence.ft != null && (typeof m.presence.ft !== 'string' || !/^[0-9.]{1,60}$/.test(m.presence.ft))) m.presence.ft = null;
      m.presence.id = me.pid || null;   // only the signed-in id, never one a client made up
      me.presence = m.presence; me.lastPres = Date.now();
      broadcast({ t: 'presence', peer: me.peer, presence: me.presence }, ws);
    } else if (m.t === 'emit' && m.topic === 'chat' && m.data && typeof m.data.text === 'string') {
      // chat: short, filtered, at most one message a second per player
      const now = Date.now(); if (now - (me.lastChat || 0) < 1000) return; me.lastChat = now;
      const text = censorText(m.data.text.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120)).trim(); if (!text) return;
      broadcast({ t: 'msg', topic: 'chat', data: { text, n: safeName(me.presence && me.presence.n) }, peer: me.peer }, ws);
    } else if (m.t === 'emit' && m.topic === 'street') {
      // underground race invites, joins and starts between players
      if (JSON.stringify(m.data || null).length > 1024) return;
      broadcast({ t: 'msg', topic: 'street', data: m.data, peer: me.peer }, ws);
    } else if (m.t === 'emit' && m.topic === 'race') {
      if (JSON.stringify(m.data || null).length > 4096) return;
      broadcast({ t: 'msg', topic: 'race', data: m.data, peer: me.peer }, ws);
    } else if (m.t === 'auth' && typeof m.id === 'string' && /^p[a-z0-9]{4,24}$/.test(m.id) && typeof m.key === 'string' && m.key.length >= 16 && m.key.length <= 64) {
      // the first browser to use an id owns it; after that the same secret key is needed
      const h = hashKey(m.key);
      if (state.auth[m.id] && state.auth[m.id] !== h) return;
      if (!state.auth[m.id]) { state.auth[m.id] = h; saveState(); }
      me.pid = m.id;
      // the same player connecting again (new tab, reload, or a tab that never closed properly): the old connection goes
      for (const [ows, oc] of clients) if (ows !== ws && oc.pid === me.pid) { send(ows, { t: 'replaced' }); oc.pid = null; try { ows.close(4000, 'replaced'); } catch (e) { } setTimeout(() => { try { ows.terminate(); } catch (e) { } }, 1500); }
      const mine = Object.values(state.listings).filter(l => l.seller === me.pid).map(l => l.lid);
      const unpaid = state.sold[me.pid] || [];
      send(ws, { t: 'auth_ok', mine: mine.concat(unpaid.map(s => s.lid)) });
      for (const s of unpaid) send(ws, { t: 'mk_sold', lid: s.lid, price: s.price, buyer: s.buyer });
    } else if (m.t === 'record' && me.pid && m.id === me.pid && m.rec && typeof m.rec === 'object') {
      const lap = Number(m.rec.lap), total = Number(m.rec.total);
      if (!Number.isFinite(lap) || lap < 15000 || lap > 600000) return;
      const prev = state.records[me.pid];
      if (prev && prev.lap <= lap) return;
      state.records[me.pid] = {
        lap: Math.round(lap), total: Number.isFinite(total) ? Math.round(total) : 0,
        nick: safeName(m.rec.nick),
        body: BODIES.includes(m.rec.body) ? m.rec.body : 'bubble',
        paint: PAINTS.includes(m.rec.paint) ? m.rec.paint : 'cherry',
        at: Date.now(),
      };
      saveState();
      broadcast({ t: 'records', records: topRecords() });
    } else if (m.t === 'mk_list') {
      if (!me.pid) return reply(m.rq, false, { err: 'Not signed in to the market yet.' });
      const car = cleanCar(m.car), price = Math.floor(Number(m.price));
      if (!car) return reply(m.rq, false, { err: "That car can't be listed." });
      if (!(price >= 1 && price <= 50000000)) return reply(m.rq, false, { err: 'Set a price between $1 and $50,000,000.' });
      if (Object.values(state.listings).filter(l => l.seller === me.pid).length >= 8) return reply(m.rq, false, { err: 'You can have up to 8 cars on the market at once.' });
      if (Object.keys(state.listings).length >= 400) return reply(m.rq, false, { err: 'The market is full right now.' });
      const lid = 'l' + crypto.randomBytes(8).toString('hex');
      state.listings[lid] = { lid, seller: me.pid, nick: safeName(m.nick), car, price, at: Date.now() };
      saveState();
      reply(m.rq, true, { lid });
      broadcast({ t: 'mk_listings', listings: listingsOut() });
    } else if (m.t === 'mk_cancel') {
      const l = state.listings[m.lid];
      if (!me.pid || !l || l.seller !== me.pid) return reply(m.rq, false, { err: 'That listing is gone. If it sold, the coins arrive shortly.' });
      delete state.listings[m.lid];
      saveState();
      reply(m.rq, true);
      broadcast({ t: 'mk_listings', listings: listingsOut() });
    } else if (m.t === 'mk_buy') {
      const l = state.listings[m.lid];
      if (!me.pid) return reply(m.rq, false, { err: 'Not signed in to the market yet.' });
      if (!l) return reply(m.rq, false, { err: 'That car is no longer for sale.' });
      if (l.seller === me.pid) return reply(m.rq, false, { err: "That's your own listing." });
      delete state.listings[m.lid];
      const sale = { lid: l.lid, price: l.price, buyer: safeName(m.nick) };
      (state.sold[l.seller] = state.sold[l.seller] || []).push(sale);
      saveState();
      reply(m.rq, true, { car: l.car, price: l.price });
      broadcast({ t: 'mk_listings', listings: listingsOut() });
      toPlayer(l.seller, Object.assign({ t: 'mk_sold' }, sale));
    } else if (m.t === 'mk_ack' && me.pid && typeof m.lid === 'string') {
      const list = state.sold[me.pid];
      if (list) { state.sold[me.pid] = list.filter(s => s.lid !== m.lid); if (!state.sold[me.pid].length) delete state.sold[me.pid]; saveState(); }
    }
  });
  ws.on('close', () => {
    clients.delete(ws);
    broadcast({ t: 'left', peer: me.peer });
  });
});

// refill rate-limit tokens and drop dead connections
setInterval(() => { for (const c of clients.values()) c.tokens = Math.min(80, c.tokens + 40); }, 1000);
// a closed tab whose connection didn't say goodbye is gone within ~12 s
setInterval(() => {
  for (const [ws, c] of clients) {
    if (!c.alive) { ws.terminate(); continue; }
    c.alive = false; try { ws.ping(); } catch (e) { }
  }
}, 6000);
// a player who stopped sending for 20 s (tab in the background, closed, phone locked) leaves the world until they're back
setInterval(() => {
  const now = Date.now();
  for (const [ws, c] of clients) if (c.lastPres && now - c.lastPres > 20000 && Object.keys(c.presence).length) { c.presence = {}; broadcast({ t: 'presence', peer: c.peer, presence: {} }, ws); }
}, 4000);

server.listen(PORT, () => console.log('Pebble Isle Rally running on http://localhost:' + PORT));
