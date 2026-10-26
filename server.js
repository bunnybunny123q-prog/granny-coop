const express = require('express'), http = require('http'), { WebSocketServer } = require('ws');
const app = express();
app.use(express.static(__dirname + '/public'));
app.get('/health', (_, r) => r.send('ok'));
const server = http.createServer(app), wss = new WebSocketServer({ server });

const W = 1600, H = 1000;
const WALLS = [
  [0,0,W,20],[0,H-20,740,20],[840,H-20,W-840,20],[0,0,20,H],[W-20,0,20,H],
  [520,20,20,280],[520,420,20,280],[520,820,20,160],
  [1060,20,20,180],[1060,320,20,280],[1060,720,20,260],
  [20,500,200,20],[320,500,200,20],[1080,500,170,20],[1350,500,230,20],[1250,500,100,20],[1080,590,200,10],[1080,720,200,10]
];
const HIDES = [[60,460],[560,60],[1000,940],[1540,460],[60,930],[1000,50]];
const KEYSPOTS = [[100,200],[400,80],[100,700],[420,900],[700,100],[900,880],[1300,120],[1450,700],[1200,900],[800,300]];
const EXIT = [740,980,100,20];
const DOORS = [{ id: 'base', r: [1060,600,20,120] }, { id: 'front', r: [740,980,100,20] }];
let CUR = null;
const INT = [
  { id:'k1', k:'cab', x:120, y:48, it:'note' },   { id:'k2', k:'cab', x:300, y:48, it:'bolt' },
  { id:'b1', k:'cab', x:60, y:780, it:'pliers' }, { id:'b2', k:'cab', x:200, y:955, it:'bolt' },
  { id:'h1', k:'cab', x:800, y:48, it:'hammer' }, { id:'r1', k:'cab', x:1300, y:48, it:'safekey' },
  { id:'r2', k:'cab', x:1552, y:200, it:'bolt' },  { id:'bs', k:'cab', x:1300, y:955, it:'bolt' },
  { id:'case', k:'case', x:620, y:70 }, { id:'pad', k:'pad', x:1070, y:660 },
  { id:'safe', k:'safe', x:1400, y:930 }, { id:'fuse', k:'fuse', x:690, y:955 }, { id:'front', k:'front', x:790, y:955 }
];
const WPS = [[520,360],[520,760],[1060,260],[1060,660],[270,500],[1300,660],[270,260],[270,740],[790,500],[1320,260],[1320,740]];
const COLORS = ['#4fc3f7','#81c784','#ffb74d','#ba68c8'];
const rooms = {};
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));

function hitWall(x, y, r) {
  for (const w of WALLS) {
    const cx = clamp(x, w[0], w[0]+w[2]), cy = clamp(y, w[1], w[1]+w[3]);
    if ((x-cx)**2 + (y-cy)**2 < r*r) return true;
  }
  if (CUR) for (const d of DOORS) if (!CUR.dr[d.id]) {
    const w = d.r, cx = clamp(x, w[0], w[0]+w[2]), cy = clamp(y, w[1], w[1]+w[3]);
    if ((x-cx)**2 + (y-cy)**2 < r*r) return true;
  }
  return false;
}
function move(e, dx, dy, r) {
  if (!hitWall(e.x+dx, e.y, r)) e.x += dx;
  if (!hitWall(e.x, e.y+dy, r)) e.y += dy;
}
function los(a, b) {
  const d = Math.hypot(b.x-a.x, b.y-a.y), n = Math.ceil(d/12);
  for (let i = 1; i < n; i++) {
    if (hitWall(a.x+(b.x-a.x)*i/n, a.y+(b.y-a.y)*i/n, 1)) return false;
  }
  return true;
}

function reset(r) {
  r.items = []; r.keys = 0; r.total = 0; r.open = {}; r.wired = true; r.dr = { base: 0, front: 0 };
  r.code = String(1000 + Math.floor(Math.random() * 9000));
  r.gi = []; r.gid = 0;
  r.msg = 'Search the house. Find the master key and escape!';
  r.g = { x: 790, y: 300, mode: 'patrol', wp: -1, tx: 790, ty: 300, lost: 0, stun: 0, det: 0, dx: 0, dy: 0, stuck: 0, away: 0 };
  let i = 0;
  for (const p of Object.values(r.players)) {
    p.x = 80 + i*40; p.y = 150; p.hold = null; p.ha = 0; p.down = false; p.hid = false; p.rev = 0; p.inv = 2; i++;
  }
}

function noise(r, x, y) { const g = r.g; if (g && g.away <= 0) { g.mode = 'chase'; g.tx = x; g.ty = y; g.lost = 4; } }
const NAMES = { note: 'a note', pliers: 'pliers', hammer: 'a hammer', safekey: 'a safe key', xbow: 'a crossbow', master: 'the MASTER KEY' };
function spawnItem(r, k, x, y, h, a) { r.gi.push({ id: ++r.gid, k, x, y, h, a: a || 0 }); }
function dropHold(r, p) {
  if (!p.hold) return;
  let x = p.x - Math.sin(p.yw || 0) * 30, y = p.y - Math.cos(p.yw || 0) * 30;
  if (hitWall(x, y, 8)) { x = p.x; y = p.y; }
  spawnItem(r, p.hold, Math.round(x), Math.round(y), 0, p.ha); p.hold = null; p.ha = 0;
}
function interact(r, p) {
  let gi = null, gd = 60;
  for (const it of r.gi) { const d = Math.hypot(it.x - p.x, it.y - p.y); if (d < gd) { gd = d; gi = it; } }
  if (gi) {
    if (gi.k === 'bolt') {
      if (p.hold === 'xbow') { p.ha++; r.gi.splice(r.gi.indexOf(gi), 1); r.ev = 'key'; r.msg = p.name + ' loaded a bolt (' + p.ha + ' in the crossbow)'; }
      else r.msg = 'Take the crossbow in your hands to load this bolt.';
    } else if (p.hold) r.msg = 'Your hands are full! Drop it first (G).';
    else { p.hold = gi.k; p.ha = gi.a || 0; r.gi.splice(r.gi.indexOf(gi), 1); r.ev = 'key'; r.msg = p.name + ' picked up ' + NAMES[gi.k]; }
    return true;
  }
  const t = INT.find(i => Math.hypot(i.x - p.x, i.y - p.y) < 60); if (!t) return false;
  const say = m => { r.msg = m; };
  if (t.k === 'cab') { if (r.open[t.id]) say('Empty.'); else { r.open[t.id] = 1; r.ev = 'key'; spawnItem(r, t.it, t.x, t.y, 1); say('The cabinet is open...'); } }
  else if (t.k === 'case') {
    if (r.open.case) return true;
    if (p.hold !== 'hammer') say('A locked glass case with a crossbow. Hold a hammer to break it.');
    else { r.open.case = 1; r.ev = 'key'; spawnItem(r, 'xbow', t.x, t.y, 2); say('Smashed the glass! That was LOUD...'); noise(r, t.x, t.y); }
  }
  else if (t.k === 'pad') { if (!r.dr.base) p.ws.send(JSON.stringify({ t: 'ui', k: 'pad' })); }
  else if (t.k === 'safe') {
    if (r.open.safe) return true;
    if (p.hold !== 'safekey') say('A heavy safe. Hold the safe key to open it.');
    else { r.open.safe = 1; r.ev = 'key'; spawnItem(r, 'master', t.x, t.y, 1); say('The safe is open! Take the master key.'); }
  }
  else if (t.k === 'fuse') {
    if (!r.wired) return true;
    if (p.hold !== 'pliers') say('Live wires feed the front door. Hold pliers to cut them.');
    else { r.wired = false; say('Cables cut. The front door is safe now.'); }
  }
  else if (t.k === 'front') {
    if (r.dr.front) return true;
    if (r.wired) { dropHold(r, p); p.down = true; p.rev = 0; say('ZAP! ' + p.name + ' was electrocuted! Cut the cables first.'); }
    else if (p.hold !== 'master') say('Locked. Hold the master key.');
    else { r.dr.front = 1; say('The door is open! Everyone get out!'); }
  }
  return true;
}
function shoot(r, p) {
  const g = r.g;
  if (p.hold !== 'xbow') return;
  if (p.ha <= 0) { r.msg = 'The crossbow is empty. Find bolts!'; return; }
  p.ha--; const dx = -Math.sin(p.yw), dy = -Math.cos(p.yw); let hit = false;
  for (let d = 20; d < 900; d += 8) {
    const x = p.x + dx * d, y = p.y + dy * d;
    if (hitWall(x, y, 1)) break;
    if (g.away <= 0 && Math.hypot(g.x - x, g.y - y) < 28) { hit = true; break; }
  }
  r.ev = hit ? 'hit' : 'shot';
  if (hit) { g.away = 60; g.x = g.y = -300; r.msg = 'DIRECT HIT! Granny is gone for 1 minute!'; }
  else r.msg = 'Missed! ' + p.ha + ' bolts left in the crossbow.';
}

function granny(r, dt) {
  const g = r.g, ps = Object.values(r.players);
  if (g.away > 0) { g.away -= dt; if (g.away <= 0) { g.x = 790; g.y = 300; g.mode = 'patrol'; g.wp = -1; r.msg = 'Granny is back...'; } return; }
  if (g.stun > 0) { g.stun -= dt; return; }
  let best = null, bd = 1e9;
  for (const p of ps) {
    if (p.down || p.hid) continue;
    const d = Math.hypot(p.x-g.x, p.y-g.y);
    if (((d < 320 && los(g, p)) || (p.noisy && d < 380)) && d < bd) { bd = d; best = p; }
  }
  if (best) { g.mode = 'chase'; g.tx = best.x; g.ty = best.y; g.lost = 3; }
  else if (g.mode === 'chase') { g.lost -= dt; if (g.lost <= 0) { g.mode = 'patrol'; g.wp = -1; } }
  if (g.mode === 'patrol') {
    if (g.wp < 0 || Math.hypot(WPS[g.wp][0]-g.x, WPS[g.wp][1]-g.y) < 25) { do { g.wp = Math.floor(Math.random()*WPS.length); } while (!r.dr.base && WPS[g.wp][0] >= 1060 && WPS[g.wp][1] > 520); }
    g.tx = WPS[g.wp][0]; g.ty = WPS[g.wp][1];
  }
  let tx = g.tx, ty = g.ty;
  if (!los(g, { x: tx, y: ty })) {
    let bw = null, bdist = 1e9;
    for (const w of WPS) {
      if (Math.hypot(w[0]-g.x, w[1]-g.y) < 20 || !los(g, { x: w[0], y: w[1] })) continue;
      const d = Math.hypot(w[0]-tx, w[1]-ty);
      if (d < bdist) { bdist = d; bw = w; }
    }
    if (bw) { tx = bw[0]; ty = bw[1]; }
  }
  if (g.det > 0) { g.det -= dt; tx = g.dx; ty = g.dy; }
  const sp = g.mode === 'chase' ? 135 : 80, d = Math.hypot(tx-g.x, ty-g.y) || 1;
  const bx = g.x, by = g.y;
  move(g, (tx-g.x)/d*sp*dt, (ty-g.y)/d*sp*dt, 16);
  if (Math.hypot(g.x-bx, g.y-by) < sp*dt*0.25) {
    g.stuck += dt;
    if (g.stuck > 0.8) { const w = WPS[Math.floor(Math.random()*WPS.length)]; g.dx = w[0]; g.dy = w[1]; g.det = 1.5; g.stuck = 0; }
  } else g.stuck = 0;
  for (const p of ps) {
    if (!p.down && !p.hid && p.inv <= 0 && Math.hypot(p.x-g.x, p.y-g.y) < 26) {
      dropHold(r, p); p.down = true; p.rev = 0; g.stun = 1.5; r.msg = p.name + ' got caught! Revive them (hold E)';
    }
  }
}

function tick(r, dt) {
  if (r.state !== 'play') return;
  CUR = r;
  const ps = Object.values(r.players);
  for (const p of ps) {
    p.inv = Math.max(0, p.inv - dt);
    const edge = p.act && !p.pact; p.pact = p.act;
    p.noisy = false;
    if (p.down) continue;
    const she = p.sh && !p.psh; p.psh = p.sh; if (she && !p.hid) shoot(r, p);
    const dpe = p.dp && !p.pdp; p.pdp = p.dp; if (dpe && !p.hid) dropHold(r, p);
    if (edge) {
      if (p.hid) p.hid = false;
      else if (interact(r, p)) {}
      else {
        const h = HIDES.find(h => Math.hypot(h[0]-p.x, h[1]-p.y) < 45);
        if (h) { p.hid = true; p.x = h[0]; p.y = h[1]; }
      }
    }
    if (!p.hid) {
      const m = Math.hypot(p.dx, p.dy);
      if (m > 0) {
        const sp = p.sprint ? 190 : 130; p.noisy = !!p.sprint;
        move(p, p.dx/m*sp*dt, p.dy/m*sp*dt, 12);
      }
    }
    for (let i = r.items.length-1; i >= 0; i--) {
      if (Math.hypot(r.items[i].x-p.x, r.items[i].y-p.y) < 26) {
        r.items.splice(i, 1); r.keys++; r.ev = 'key';
        r.msg = r.keys >= r.total ? 'Exit unlocked! Everyone get out!' : p.name + ' found a key (' + r.keys + '/' + r.total + ')';
      }
    }
  }
  for (const d of ps) {
    if (!d.down) continue;
    const helper = ps.find(p => !p.down && !p.hid && p.act && Math.hypot(p.x-d.x, p.y-d.y) < 50);
    if (helper) { d.rev += dt; if (d.rev >= 3) { d.down = false; d.rev = 0; d.inv = 2; r.msg = d.name + ' is back up!'; } }
    else d.rev = Math.max(0, d.rev - dt);
  }
  granny(r, dt);
  const alive = ps.filter(p => !p.down);
  if (!alive.length) { r.state = 'lost'; r.msg = 'Granny got everyone...'; }
  else if (r.dr.front && alive.every(p => p.x > 730 && p.x < 850 && p.y > 992)) { r.state = 'won'; r.msg = 'You escaped!'; }
}

setInterval(() => {
  for (const r of Object.values(rooms)) {
    tick(r, 1/30);
  }
}, 1000/30);

setInterval(() => {
  for (const [code, r] of Object.entries(rooms)) {
    const ps = Object.values(r.players);
    if (!ps.length) { delete rooms[code]; continue; }
    const s = JSON.stringify({
      t: 's', st: r.state, keys: r.keys, total: r.total, msg: r.msg, ev: r.ev, host: r.host,
      p: ps.map(p => ({ id: p.id, n: p.name, c: p.c, x: Math.round(p.x), y: Math.round(p.y), d: p.down, h: p.hid, rv: +p.rev.toFixed(2), hd: p.hold, ha: p.ha })),
      g: r.g && { x: Math.round(r.g.x), y: Math.round(r.g.y), m: r.g.mode, a: r.g.away > 0 ? 1 : 0 },
      it: r.items, gi: r.gi, nc: r.code, dr: r.dr, o: Object.keys(r.open || {}), w: r.wired ? 1 : 0
    });
    r.ev = null;
    for (const p of ps) if (p.ws.readyState === 1) p.ws.send(s);
  }
}, 50);

wss.on('connection', ws => {
  let room = null, me = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && !room) {
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || Math.random().toString(36).slice(2, 6).toUpperCase();
      const r = rooms[code] || (rooms[code] = { code, players: {}, state: 'lobby', keys: 0, total: 4, items: [], g: null, host: null, msg: 'Waiting for players...' });
      const used = Object.values(r.players);
      if (used.length >= 4) return ws.send(JSON.stringify({ t: 'err', m: 'Room full (4 max)' }));
      if (r.state === 'play') return ws.send(JSON.stringify({ t: 'err', m: 'Game already in progress' }));
      const id = Math.random().toString(36).slice(2, 8);
      me = { id, ws, name: String(m.name || 'Player').slice(0, 12), c: COLORS.find(c => !used.some(u => u.c === c)), x: 80, y: 80, dx: 0, dy: 0, down: false, hid: false, rev: 0, inv: 0, act: false };
      r.players[id] = me; room = r; if (!r.host) r.host = id;
      ws.send(JSON.stringify({ t: 'hello', id, code, W, H, walls: WALLS, hides: HIDES, exit: EXIT, ints: INT.map(({ id, k, x, y }) => ({ id, k, x, y })) }));
    } else if (room && me) {
      if (m.t === 'in') { me.dx = clamp(+m.dx || 0, -1, 1); me.dy = clamp(+m.dy || 0, -1, 1); me.sprint = !!m.sp; me.act = !!m.a; me.sh = !!m.sh; me.dp = !!m.g; me.yw = +m.yw || 0; }
      if (m.t === 'code' && room.state === 'play' && !room.dr.base) {
        const pd = INT.find(i => i.k === 'pad');
        if (Math.hypot(pd.x - me.x, pd.y - me.y) < 90) {
          if (String(m.c) === room.code) { room.dr.base = 1; room.ev = 'key'; room.msg = 'Padlock opened! The basement is open.'; }
          else { room.msg = 'Wrong code! The padlock rattled loudly...'; noise(room, pd.x, pd.y); }
        }
      }
      if (m.t === 'chat') {
        const now = Date.now(); if (now - (me.lt || 0) < 500) return; me.lt = now;
        const text = String(m.m || '').replace(/\s+/g, ' ').trim().slice(0, 120); if (!text) return;
        const out = JSON.stringify({ t: 'chat', id: me.id, n: me.name, c: me.c, m: text });
        for (const p of Object.values(room.players)) if (p.ws.readyState === 1) p.ws.send(out);
      }
      if (m.t === 'start' && room.host === me.id && room.state !== 'play') { room.state = 'play'; reset(room); }
    }
  });
  ws.on('close', () => {
    if (!room || !me) return;
    delete room.players[me.id];
    if (room.host === me.id) room.host = Object.keys(room.players)[0] || null;
  });
});

server.listen(process.env.PORT || 3000, () => console.log('Granny co-op running'));
