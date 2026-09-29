/*
 * Team Deathmatch, knife, grenades, chat, killstreaks and leaderboard, end to end with four socket clients.
 * Run while the server is up:  node scripts/features-test.js
 */
const { io } = require('socket.io-client');
const MapLib = require('../shared/map');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const MAP_ID = 'desert';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!ok) failed = true;
};

async function account(name) {
  const res = await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password: 'secret123' }),
  });
  return res.headers.get('set-cookie').split(';')[0];
}

async function join(name) {
  const cookie = await account(name);
  const s = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  await new Promise((r, j) => { s.on('connect', r); s.on('connect_error', j); });
  const res = await new Promise((r) => s.emit('mp:join', { primary: 'pistol', mapId: MAP_ID, mode: 'tdm' }, r));
  const P = { name, cookie, s, res, id: res.selfId, team: res.team, pos: { ...res.spawn }, alive: true, ev: {} };
  const log = (ev) => s.on(ev, (d) => { (P.ev[ev] ||= []).push(d); });
  ['mp:damage', 'mp:hit', 'mp:died', 'mp:kill', 'mp:grenade', 'mp:explode', 'mp:streak', 'mp:uav', 'mp:enemyUav', 'mp:airstrike', 'mp:chat'].forEach(log);
  s.on('mp:died', () => { P.alive = false; });
  s.on('mp:respawn', (d) => { P.pos = { x: d.x, y: 0, z: d.z }; P.alive = true; });
  s.on('mp:snap', (d) => { P.lastSnap = d; });
  return P;
}

const count = (P, ev, pred = () => true) => (P.ev[ev] || []).filter(pred).length;
const clear = (...ps) => ps.forEach((P) => { P.ev = {}; });

async function walkTo(P, x, z) {
  for (let i = 0; i < 200 && P.alive; i++) {
    const dx = x - P.pos.x, dz = z - P.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    const step = Math.min(1.2, d);
    P.pos.x += (dx / d) * step;
    P.pos.z += (dz / d) * step;
    P.s.emit('mp:state', { x: P.pos.x, y: 0, z: P.pos.z, yaw: 0, pitch: 0, crouch: false, weapon: 'pistol' });
    await sleep(60);
  }
  await sleep(120);
}

async function waitFor(pred, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await sleep(50); }
  return false;
}

async function shootUntilDead(A, V, max = 12) {
  for (let i = 0; i < max && V.alive; i++) {
    const o = { x: A.pos.x, y: 1.6, z: A.pos.z }, t = { x: V.pos.x, y: 1.1, z: V.pos.z };
    const len = Math.hypot(t.x - o.x, t.y - o.y, t.z - o.z);
    A.s.emit('mp:shoot', { ox: o.x, oy: o.y, oz: o.z, dx: (t.x - o.x) / len, dy: (t.y - o.y) / len, dz: (t.z - o.z) / len, weapon: 'pistol', rt: Date.now() });
    await sleep(230);
  }
  await waitFor(() => !V.alive, 1500);
  return !V.alive;
}

/** Centre of a 12 x 12 m patch with no collision boxes, so every shot has a clear line. */
function openSpot() {
  const map = MapLib.buildMap(MAP_ID);
  for (let r = 0; r < 50; r += 2) {
    for (let a = 0; a < 16; a++) {
      const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r), z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
      if (Math.abs(x) > 46 || Math.abs(z) > 46) continue;
      const clearArea = !map.boxes.some((b) => b.maxY > 0.3 && b.minX < x + 6 && b.maxX > x - 6 && b.minZ < z + 6 && b.maxZ > z - 6);
      if (clearArea) return { x, z };
    }
  }
  throw new Error('no open area found');
}

(async () => {
  const tag = Date.now() % 100000;
  const catalog = await (await fetch(`${BASE}/api/catalog`)).json();
  check('catalog lists equipment and killstreaks', !!catalog.equipment?.frag && !!catalog.killstreaks?.airstrike && catalog.tdm?.scoreLimit > 0);

  const A = await join(`featR1_${tag}`);
  const B = await join(`featB1_${tag}`);
  const C = await join(`featR2_${tag}`);
  const D = await join(`featB2_${tag}`);
  check('TDM balances teams', A.team === 'red' && B.team === 'blue' && C.team === 'red' && D.team === 'blue',
    [A, B, C, D].map((p) => p.team).join(' '));
  check('join reports round info', A.res.round?.state === 'playing' && A.res.round.scoreLimit === catalog.tdm.scoreLimit);

  const S = openSpot();
  await Promise.all([walkTo(A, S.x, S.z), walkTo(C, S.x, S.z - 2.5), walkTo(B, S.x + 1.5, S.z), walkTo(D, S.x + 5, S.z + 5)]);

  // --- friendly fire is off
  clear(A, C);
  await shootUntilDead(C, A, 5);
  check('teammate bullets do no damage', A.alive && count(A, 'mp:damage') === 0 && count(C, 'mp:hit') === 0);

  // --- knife
  clear(A, B, C, D);
  A.s.emit('mp:melee', { dx: 1, dz: 0, rt: Date.now() });
  await waitFor(() => !B.alive, 2000);
  const kfKnife = (A.ev['mp:kill'] || []).find((k) => k.weapon === 'knife');
  check('knife kills an enemy in front', !B.alive && kfKnife?.victimId === B.id);

  // --- chat
  clear(A, B, C, D);
  A.s.emit('mp:chat', { text: '  hello <b>all</b>\u0007  ' });
  A.s.emit('mp:chat', { text: 'push left', team: true });
  await sleep(400);
  const allMsg = (D.ev['mp:chat'] || []).find((m) => !m.teamOnly);
  check('all-chat reaches everyone, sanitised', allMsg?.text === 'hello <b>all</b>' && count(C, 'mp:chat') === 2, allMsg?.text);
  check('team chat reaches teammates only', count(C, 'mp:chat', (m) => m.teamOnly) === 1 && count(D, 'mp:chat', (m) => m.teamOnly) === 0);
  for (let i = 0; i < 6; i++) A.s.emit('mp:chat', { text: `spam ${i}` });
  await sleep(300);
  check('chat spam is rate-limited', count(A, 'mp:chat', (m) => m.system) >= 1 && count(D, 'mp:chat', (m) => /spam/.test(m.text)) < 6);

  // --- grenade: lob at D, then run away from the blast
  clear(A, B, C, D);
  const eye = { x: A.pos.x, y: 1.6, z: A.pos.z };
  const dx = D.pos.x - eye.x, dz = D.pos.z - eye.z, dist = Math.hypot(dx, dz) * 0.8;
  const ang = 0.6, g = MapLib.GRENADE.gravity;
  const v = Math.sqrt((g * dist * dist) / (2 * Math.cos(ang) ** 2 * (dist * Math.tan(ang) + 1.6)));
  const hd = Math.hypot(dx, dz);
  A.s.emit('mp:grenade', { ox: eye.x, oy: eye.y, oz: eye.z, vx: (dx / hd) * v * Math.cos(ang), vy: v * Math.sin(ang), vz: (dz / hd) * v * Math.cos(ang) });
  await sleep(150);
  check('grenade broadcast to the whole arena', [A, B, C, D].every((p) => count(p, 'mp:grenade') === 1));
  await walkTo(A, S.x - 5, S.z - 5);
  await waitFor(() => count(A, 'mp:explode') > 0, 4000);
  await sleep(300);
  const fragHit = count(D, 'mp:damage') > 0 || (D.ev['mp:died'] || []).some((x) => x.weapon === 'frag');
  const boom = A.ev['mp:explode']?.[0];
  const boomDist = boom ? Math.hypot(boom.x - D.pos.x, boom.z - D.pos.z).toFixed(1) : '?';
  check('grenade explodes after its fuse and damages the enemy', count(A, 'mp:explode', (e) => e.kind === 'frag') === 1 && fragHit,
    `blast ${boomDist} m from D, D ${D.alive ? `hp ${D.ev['mp:damage']?.at(-1)?.hp?.toFixed(0)}` : 'killed'}`);
  check('thrower is safe at a distance, teammate immune', count(A, 'mp:damage') === 0 && count(C, 'mp:damage') === 0);
  await walkTo(A, S.x, S.z);
  if (D.alive) { await walkTo(D, S.x + 3, S.z); await shootUntilDead(A, D); }

  // --- third kill -> UAV
  await waitFor(() => B.alive, 5000);
  await walkTo(B, S.x + 2.5, S.z);
  await shootUntilDead(A, B);
  await waitFor(() => (A.ev['mp:streak'] || []).some((s) => s.rewards.uav), 2000);
  const streak3 = (A.ev['mp:streak'] || []).find((s) => s.rewards.uav);
  check('3 kills in a row unlocks the UAV', streak3?.streak === 3, `streak ${A.ev['mp:streak']?.at(-1)?.streak}`);
  clear(A, B, C, D);
  const uav = await new Promise((r) => A.s.emit('mp:uav', {}, r));
  await sleep(200);
  check('UAV reveals for the whole team, warns the enemy', uav.ok && count(A, 'mp:uav') === 1 && count(C, 'mp:uav') === 1 && count(B, 'mp:enemyUav') === 1);
  const again = await new Promise((r) => A.s.emit('mp:uav', {}, r));
  check('a used UAV cannot be reused', !again.ok);

  // --- fourth and fifth kills -> airstrike
  for (const V of [D, B]) {
    await waitFor(() => V.alive, 6000);
    await walkTo(V, S.x + 2.5, S.z);
    await shootUntilDead(A, V);
  }
  await waitFor(() => (A.ev['mp:streak'] || []).some((s) => s.rewards.airstrike), 2000);
  check('5 kills in a row unlocks the airstrike', (A.ev['mp:streak'] || []).some((s) => s.rewards.airstrike && s.streak === 5));

  await waitFor(() => D.alive, 6000);
  await walkTo(C, S.x - 5, S.z + 5);
  await walkTo(D, S.x, S.z - 4);
  clear(A, B, C, D);
  const strike = await new Promise((r) => A.s.emit('mp:airstrike', { x: D.pos.x, z: D.pos.z, yaw: 0 }, r));
  await waitFor(() => count(A, 'mp:explode', (e) => e.kind === 'airstrike') >= catalog.equipment.airstrike.bombs, 5000);
  check('airstrike announced to everyone and drops all bombs', strike.ok && [A, B, C, D].every((p) => count(p, 'mp:airstrike') === 1)
    && count(A, 'mp:explode', (e) => e.kind === 'airstrike') === catalog.equipment.airstrike.bombs);
  await sleep(300);
  const strikeKill = (A.ev['mp:kill'] || []).find((k) => k.weapon === 'airstrike' && k.victimId === D.id);
  check('airstrike kills the enemy under it, owner and teammate unhurt', !!strikeKill && count(A, 'mp:damage') === 0 && count(C, 'mp:damage') === 0);
  const lastStreak = A.ev['mp:streak']?.at(-1)?.streak;
  check('airstrike kills do not extend the streak', lastStreak === 5, `streak ${lastStreak}`);

  // --- team score
  await sleep(200);
  const s = A.lastSnap?.s;
  check('team score counts kills', s && s[0] >= 6 && s[1] === 0, `red ${s?.[0]} blue ${s?.[1]}`);

  // --- leaderboard
  const lb = await (await fetch(`${BASE}/api/leaderboard?sort=kills`, { headers: { Cookie: A.cookie } })).json();
  const sorted = lb.rows.every((r, i) => i === 0 || lb.rows[i - 1].kills >= r.kills);
  check('leaderboard sorted, includes me, excludes admins', sorted && lb.me?.username === A.name && !lb.rows.some((r) => r.username === 'admin'),
    `me #${lb.me?.rank} with ${lb.me?.kills} kills`);
  const lbCoins = await (await fetch(`${BASE}/api/leaderboard?sort=coins`, { headers: { Cookie: A.cookie } })).json();
  check('leaderboard sorts by coins', lbCoins.rows.every((r, i) => i === 0 || lbCoins.rows[i - 1].coins >= r.coins));

  for (const P of [A, B, C, D]) P.s.close();
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
