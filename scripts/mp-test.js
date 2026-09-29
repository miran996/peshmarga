/* Two-client multiplayer combat test. Run while the server is up:  node scripts/mp-test.js */
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function account(name) {
  let res = await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password: 'secret123' }),
  });
  if (res.status === 409) {
    res = await fetch(`${BASE}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password: 'secret123' }),
    });
  }
  const { user } = await res.json();
  return { user, cookie: res.headers.get('set-cookie').split(';')[0] };
}

async function client(acc) {
  const s = io(BASE, { extraHeaders: { Cookie: acc.cookie }, transports: ['websocket'] });
  await new Promise((r, j) => { s.on('connect', r); s.on('connect_error', j); });
  const join = await new Promise((r) => s.emit('mp:join', { primary: 'autorifle', secondary: 'pistol' }, r));
  return { s, join, pos: { ...join.spawn } };
}

(async () => {
  const tag = Date.now() % 100000;
  const A = await client(await account(`alpha${tag}`));
  const B = await client(await account(`bravo${tag}`));
  const events = { hits: 0, kills: 0, coins: null, died: false, killfeed: null };
  A.s.on('mp:hit', (d) => { events.hits++; if (d.killed) events.kills++; });
  A.s.on('coins', (d) => { events.coins = d; });
  B.s.on('mp:died', () => { events.died = true; });
  A.s.on('mp:kill', (d) => { events.killfeed = d; });

  // Walk B toward A at a legal pace until they are 3 m apart.
  for (let i = 0; i < 400; i++) {
    const dx = A.pos.x - B.pos.x, dz = A.pos.z - B.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 3) break;
    B.pos.x += (dx / d) * 0.3;
    B.pos.z += (dz / d) * 0.3;
    B.s.emit('mp:state', { ...B.pos, y: 0, yaw: 0, pitch: 0, crouch: false, weapon: 'pistol' });
    A.s.emit('mp:state', { ...A.pos, y: 0, yaw: 0, pitch: 0, crouch: false, weapon: 'pistol' });
    await sleep(50);
  }
  await sleep(200);
  const dist = Math.hypot(A.pos.x - B.pos.x, A.pos.z - B.pos.z);
  console.log(`B walked to within ${dist.toFixed(2)} m of A`);

  // A fires at B's chest ten times (new accounts own only the pistol: 28 dmg -> 4 shots).
  for (let i = 0; i < 10 && !events.died; i++) {
    const o = { x: A.pos.x, y: 1.6, z: A.pos.z };
    const t = { x: B.pos.x, y: 1.1, z: B.pos.z };
    const len = Math.hypot(t.x - o.x, t.y - o.y, t.z - o.z);
    A.s.emit('mp:shoot', {
      ox: o.x, oy: o.y, oz: o.z, dx: (t.x - o.x) / len, dy: (t.y - o.y) / len, dz: (t.z - o.z) / len, weapon: 'pistol', rt: Date.now(),
    });
    await sleep(120);
  }
  await sleep(400);

  const ok = (label, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label} ${extra}`); if (!cond) process.exitCode = 1; };
  ok('shots registered as hits', events.hits >= 4, `(hits=${events.hits})`);
  ok('victim notified of death', events.died);
  ok('kill broadcast to arena', events.killfeed?.weapon === 'pistol', `(${events.killfeed?.killer} -> ${events.killfeed?.victim})`);
  ok('killer received 50 coins', events.coins?.delta === 50, `(coins=${events.coins?.coins})`);

  const respawn = await new Promise((r) => { B.s.once('mp:respawn', r); setTimeout(() => r(null), 5000); });
  ok('victim respawned', !!respawn);

  const tele = await new Promise((r) => {
    A.s.once('mp:correct', () => r(true));
    setTimeout(() => r(false), 1500);
    setTimeout(() => A.s.emit('mp:state', { x: A.pos.x + 40, y: 0, z: A.pos.z, yaw: 0, pitch: 0, crouch: false, weapon: 'pistol' }), 50);
  });
  ok('teleport attempt corrected by server', tele);

  A.s.disconnect();
  B.s.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
