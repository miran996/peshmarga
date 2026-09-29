/* Joins the multiplayer arena as a wandering, shooting dummy so you can test MP solo.
   Usage:  node scripts/dummy-player.js [seconds]   (default 120) */
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DURATION = Number(process.argv[2] || 120) * 1000;

(async () => {
  const name = `dummy${Date.now() % 10000}`; // is_bot=1 via username prefix — hidden from Leaderboard
  const body = JSON.stringify({ username: name, password: 'dummy123' });
  const res = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const s = io(BASE, { extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  await new Promise((r) => s.on('connect', r));
  const join = await new Promise((r) => s.emit('mp:join', {}, r));
  const pos = { x: join.spawn.x, y: 0, z: join.spawn.z };
  let heading = Math.random() * Math.PI * 2, alive = true;
  s.on('mp:died', () => { alive = false; });
  s.on('mp:respawn', (d) => { Object.assign(pos, { x: d.x, z: d.z }); alive = true; });
  s.on('mp:correct', (d) => Object.assign(pos, d));
  console.log(`${name} joined the arena at (${pos.x}, ${pos.z})`);

  const end = Date.now() + DURATION;
  const timer = setInterval(() => {
    if (Date.now() > end) { clearInterval(timer); s.disconnect(); return; }
    if (!alive) return;
    if (Math.random() < 0.03) heading += (Math.random() - 0.5) * 2;
    const nx = pos.x + Math.sin(heading) * 0.2, nz = pos.z + Math.cos(heading) * 0.2;
    if (Math.abs(nx) > 55 || Math.abs(nz) > 55) heading += Math.PI;
    else { pos.x = nx; pos.z = nz; }
    s.emit('mp:state', { ...pos, yaw: -heading + Math.PI, pitch: 0, crouch: false, weapon: 'pistol' });
    if (Math.random() < 0.04) {
      const a = Math.random() * Math.PI * 2;
      s.emit('mp:shoot', { ox: pos.x, oy: 1.6, oz: pos.z, dx: Math.sin(a), dy: -0.02, dz: Math.cos(a), weapon: 'pistol', rt: Date.now() });
    }
  }, 50);
})();
