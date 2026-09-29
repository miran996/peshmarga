/* End-to-end API smoke test. Run while the server is up:  node scripts/smoke-test.js */
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function call(path, body, cookie) {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: setCookie ? setCookie.split(';')[0] : cookie };
}

function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const name = `tester${Date.now() % 100000}`;
  const reg = await call('/api/register', { username: name, password: 'secret123' });
  check('register', reg.status === 200, `coins=${reg.data.user?.coins}`);
  check('starts with 1000 coins + pistol only', reg.data.user?.coins === 1000 && reg.data.user.ownedWeapons.join() === 'pistol');
  const player = reg.cookie;

  const dup = await call('/api/register', { username: name, password: 'secret123' });
  check('duplicate username rejected', dup.status === 409);
  const bad = await call('/api/login', { username: name, password: 'wrong' });
  check('wrong password rejected', bad.status === 401);

  const buy = await call('/api/shop/buy', { kind: 'weapon', id: 'autorifle' }, player);
  check('buy automatic rifle', buy.status === 200 && buy.data.user.coins === 600, `coins=${buy.data.user?.coins}`);
  const poor = await call('/api/shop/buy', { kind: 'weapon', id: 'sniper' }, player);
  check('cannot buy without enough coins', poor.status === 400, poor.data.error);
  const cos = await call('/api/shop/buy', { kind: 'cosmetic', id: 'shadow' }, player);
  check('buy + auto-equip cosmetic', cos.status === 200 && cos.data.user.equippedCosmetic === 'shadow');

  const denied = await call('/api/admin/users', null, player);
  check('non-admin blocked from admin API', denied.status === 403);

  const admin = await call('/api/login', { username: 'admin', password: 'admin123' });
  check('admin login', admin.status === 200 && admin.data.user.isAdmin);
  const list = await call('/api/admin/users', null, admin.cookie);
  const me = list.data.users?.find((u) => u.username === name);
  check('admin lists players', !!me, `${list.data.users?.length} users`);
  const add = await call(`/api/admin/users/${me.id}/coins`, { amount: 500 }, admin.cookie);
  check('admin adds coins', add.data.user?.coins === me.coins + 500, `coins=${add.data.user?.coins}`);

  const sock = io(BASE, { extraHeaders: { Cookie: player }, transports: ['websocket'] });
  await new Promise((r, j) => { sock.on('connect', r); sock.on('connect_error', j); });
  const start = await new Promise((r) => sock.emit('sp:start', { difficulty: 'hard' }, r));
  check('single-player session starts', start.ok);
  await new Promise((r) => setTimeout(r, 1600));
  const kill = await new Promise((r) => sock.emit('sp:kill', { headshot: true }, r));
  check('kill awards 50 + 10 headshot coins', kill.ok && kill.delta === 60, `delta=${kill.delta}`);
  const burst = [];
  for (let i = 0; i < 10; i++) burst.push(await new Promise((r) => sock.emit('sp:kill', {}, r)));
  const accepted = burst.filter((b) => b.ok).length;
  check('multi-kills allowed, kill spam rate-limited', accepted >= 2 && accepted <= 5, `${accepted}/10 accepted`);

  const sessions = await call('/api/admin/sessions', null, admin.cookie);
  check('admin sees active session', sessions.data.active?.some((s) => s.username === name));

  const join = await new Promise((r) => sock.emit('mp:join', { primary: 'autorifle', secondary: 'pistol' }, r));
  check('multiplayer join', join.ok && join.loadout.join() === 'autorifle,pistol');
  const snap = await new Promise((r) => sock.once('mp:snap', r));
  check('receives multiplayer snapshots', Array.isArray(snap.p) && snap.p.length >= 1);
  sock.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
