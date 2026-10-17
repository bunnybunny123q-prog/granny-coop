const express = require('express'), http = require('http'), { WebSocketServer } = require('ws');
const app = express();
app.use(express.static(__dirname + '/public'));
app.get('/health', (_, r) => r.send('ok'));
const server = http.createServer(app), wss = new WebSocketServer({ server });

const W = 1600, H = 1000;
const WALLS = [
  [0,0,W,20],[0,H-20,W,20],[0,0,20,H],[W-20,0,20,H],
  [520,20,20,280],[520,420,20,280],[520,820,20,160],
  [1060,20,20,180],[1060,320,20,280],[1060,720,20,260],
  [20,500,200,20],[320,500,200,20],[1080,500,170,20],[1350,500,230,20]
];
const HIDES = [[60,460],[560,60],[1000,940],[1540,460],[100,900],[800,500]];
const KEYSPOTS = [[100,200],[400,80],[100,700],[420,900],[700,100],[900,880],[1300,120],[1450,700],[1200,900],[800,300]];
const EXIT = [1500,860,80,100];
const WPS = [[520,360],[520,760],[1060,260],[1060,660],[270,500],[1300,500],[270,260],[270,740],[790,500],[1320,260],[1320,740]];
const COLORS = ['#4fc3f7','#81c784','#ffb74d','#ba68c8'];
const rooms = {};
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));

function hitWall(x, y, r) {
  for (const w of WALLS) {
    const cx = clamp(x, w[0], w[0]+w[2]), cy = clamp(y, w[1], w[1]+w[3]);
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
  const spots = KEYSPOTS.slice().sort(() => Math.random()-0.5).slice(0, 4);
  r.items = spots.map(s => ({ x: s[0], y: s[1] }));
  r.keys = 0; r.total = 4; r.msg = 'Find all 4 keys, then reach the exit!';
  r.g = { x: 1320, y: 740, mode: 'patrol', wp: -1, tx: 1320, ty: 740, lost: 0, stun: 0, det: 0, dx: 0, dy: 0, stuck: 0 };
  let i = 0;
  for (const p of Object.values(r.players)) {
    p.x = 80 + i*40; p.y = 80; p.down = false; p.hid = false; p.rev = 0; p.inv = 2; i++;
  }
}

function granny(r, dt) {
  const g = r.g, ps = Object.values(r.players);
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
    if (g.wp < 0 || Math.hypot(WPS[g.wp][0]-g.x, WPS[g.wp][1]-g.y) < 25) g.wp = Math.floor(Math.random()*WPS.length);
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
      p.down = true; p.rev = 0; g.stun = 1.5; r.msg = p.name + ' got caught! Revive them (hold E)';
    }
  }
}

function tick(r, dt) {
  if (r.state !== 'play') return;
  const ps = Object.values(r.players);
  for (const p of ps) {
    p.inv = Math.max(0, p.inv - dt);
    const edge = p.act && !p.pact; p.pact = p.act;
    p.noisy = false;
    if (p.down) continue;
    if (edge) {
      if (p.hid) p.hid = false;
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
  else if (r.keys >= r.total && alive.every(p => p.x > EXIT[0] && p.y > EXIT[1])) { r.state = 'won'; r.msg = 'You escaped!'; }
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
      p: ps.map(p => ({ id: p.id, n: p.name, c: p.c, x: Math.round(p.x), y: Math.round(p.y), d: p.down, h: p.hid, rv: +p.rev.toFixed(2) })),
      g: r.g && { x: Math.round(r.g.x), y: Math.round(r.g.y), m: r.g.mode },
      it: r.items
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
      ws.send(JSON.stringify({ t: 'hello', id, code, W, H, walls: WALLS, hides: HIDES, exit: EXIT }));
    } else if (room && me) {
      if (m.t === 'in') { me.dx = clamp(+m.dx || 0, -1, 1); me.dy = clamp(+m.dy || 0, -1, 1); me.sprint = !!m.sp; me.act = !!m.a; }
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
