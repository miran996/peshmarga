/*
 * Team Deathmatch round flow: score limit -> round end -> intermission -> new round with reset scores.
 * Starts its own throwaway server (score limit 2, 2 s intermission) on a spare port:  node scripts/round-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');
const MapLib = require('../shared/map');

const PORT = 3000 + 100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fps-round-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!ok) failed = true;
};

const server = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: DATA, TDM_SCORE_LIMIT: '2', TDM_INTERMISSION: '2' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverErr = '';
server.stderr.on('data', (d) => { serverErr += d; });

async function join(name) {
  const res = await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password: 'secret123' }),
  });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const s = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  await new Promise((r, j) => { s.on('connect', r); s.on('connect_error', j); });
  const j = await new Promise((r) => s.emit('mp:join', { primary: 'pistol', mapId: 'ruins', mode: 'tdm' }, r));
  const P = { s, id: j.selfId, pos: { ...j.spawn }, alive: true, ev: {} };
  for (const ev of ['mp:roundEnd', 'mp:roundStart', 'mp:respawn', 'mp:hit']) s.on(ev, (d) => { (P.ev[ev] ||= []).push(d); });
  s.on('mp:died', () => { P.alive = false; });
  s.on('mp:respawn', (d) => { P.pos = { x: d.x, y: 0, z: d.z }; P.alive = true; });
  s.on('mp:snap', (d) => { P.snap = d; });
  return P;
}

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

async function waitFor(pred, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await sleep(50); }
  return false;
}

(async () => {
  for (let i = 0; i < 60; i++) {
    try { await fetch(`${BASE}/api/catalog`); break; } catch { await sleep(100); }
  }
  const tag = Date.now() % 100000;
  const A = await join(`rr${tag}`);
  const B = await join(`rb${tag}`);
  const map = MapLib.buildMap('ruins');
  const open = (x, z) => !map.boxes.some((b) => b.maxY > 0.3 && b.minX < x + 4 && b.maxX > x - 4 && b.minZ < z + 4 && b.maxZ > z - 4);
  let S = { x: 0, z: 0 };
  search: for (let x = -40; x <= 40; x += 2) for (let z = -40; z <= 40; z += 2) if (open(x, z)) { S = { x, z }; break search; }

  const knife = async () => {
    await waitFor(() => B.alive, 6000);
    await Promise.all([walkTo(A, S.x, S.z), walkTo(B, S.x + 1.5, S.z)]);
    await sleep(900);
    A.s.emit('mp:melee', { dx: 1, dz: 0, rt: Date.now() });
    await waitFor(() => !B.alive, 2000);
  };
  await knife();
  await knife();
  const ended = await waitFor(() => A.ev['mp:roundEnd']?.length, 2000);
  const end = A.ev['mp:roundEnd']?.[0];
  check('reaching the score limit ends the round', ended && end.winner === 'red' && end.score.red === 2, JSON.stringify(end));
  await waitFor(() => A.snap?.st === 'ended', 3000);
  check('snapshots report the ended state', A.snap?.st === 'ended');

  B.alive = true;
  await walkTo(B, S.x + 1.5, S.z);
  A.s.emit('mp:melee', { dx: 1, dz: 0, rt: Date.now() });
  await sleep(500);
  check('no damage during intermission', (A.ev['mp:hit'] || []).length === 2);

  const started = await waitFor(() => A.ev['mp:roundStart']?.length, 4000);
  const st = A.ev['mp:roundStart']?.[0];
  check('new round starts after the intermission', started && st.state === 'playing' && st.score.red === 0 && st.score.blue === 0);
  await sleep(200);
  const me = A.snap?.p.find((p) => p[0] === A.id);
  check('kills reset and everyone respawned for the new round', me && me[10] === 0 && A.ev['mp:respawn']?.length >= 1 && B.alive);

  A.s.close();
  B.s.close();
  server.kill();
  if (serverErr.trim()) console.log(serverErr);
  try { fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* Windows may lock temp db briefly */ }
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  server.kill();
  try { fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* ignore */ }
  process.exit(1);
});
