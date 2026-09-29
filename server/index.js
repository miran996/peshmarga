const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const db = require('./db');
const auth = require('./auth');
const catalog = require('./catalog');
const { setupRealtime } = require('./realtime');
const MapLib = require('../shared/map');
const { DATA_DIR } = require('./paths');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, '..');

db.initDb();
db.closeDanglingSessions();

const app = express();
app.disable('x-powered-by');
/** Render / Cloudflare sit behind a proxy — without this, req.ip is shared and login throttle locks everyone out. */
app.set('trust proxy', 1);
app.use(cookieParser());

const live = { realtime: null, adminRouter: null };
const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    if (out && typeof out.catch === 'function') out.catch(next);
  } catch (err) {
    next(err);
  }
};
function realtimeNotify(user) {
  try { live.realtime?.notifyUser(user); } catch { /* ignore */ }
}

app.use('/avatars', express.static(path.join(DATA_DIR, 'avatars'), {
  maxAge: '1d',
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=86400'),
}));

app.post('/api/me/avatar', auth.authMiddleware, express.json({ limit: '512kb' }), wrap((req, res) => {
  const user = db.setAvatar(req.user.id, req.body?.image);
  realtimeNotify(user);
  res.json({ user });
}));

app.post('/api/me/avatar/clear', auth.authMiddleware, wrap((req, res) => {
  const user = db.clearAvatar(req.user.id);
  realtimeNotify(user);
  res.json({ user });
}));

app.use(express.json({ limit: '16kb' }));

app.get(['/admin', '/admin.html', '/admin/'], (req, res) => {
  const payload = auth.verifyToken(req.cookies?.[auth.TOKEN_COOKIE]);
  const user = payload ? db.getUserById(payload.id) : null;
  if (!user?.isAdmin) return res.redirect('/');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(ROOT, 'public', 'admin', 'index.html'));
});

const noCache = { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate') };
app.use('/shared', express.static(path.join(ROOT, 'shared'), noCache));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three'), { maxAge: '7d' }));
app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html', ...noCache }));

// Login throttle per client IP (10 fails / minute). Successful logins do not count.
const attempts = new Map();
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim().slice(0, 64);
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}
function throttle(req, res, next) {
  const key = clientIp(req);
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, reset: now + 60_000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60_000; }
  attempts.set(key, entry);
  if (entry.count >= 10) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
  }
  res.on('finish', () => {
    if (res.statusCode === 401 || res.statusCode === 403) entry.count++;
    else if (res.statusCode < 400) entry.count = 0;
  });
  next();
}

function cookieSecure() {
  return process.env.COOKIE_SECURE === '1'
    || process.env.NODE_ENV === 'production'
    || process.env.RENDER === 'true';
}

function issueSession(res, user) {
  const token = auth.signToken(user);
  res.cookie(auth.TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    maxAge: 7 * 24 * 3600 * 1000,
  });
  return token;
}

function clearSession(res) {
  res.clearCookie(auth.TOKEN_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
  });
}

const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

app.post('/api/register', throttle, wrap((req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-16 letters, numbers or underscores.' });
  }
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) {
    return res.status(400).json({ error: 'Password must be 6-72 characters.' });
  }
  const user = db.createUser(username, password);
  const ip = clientIp(req);
  const deviceHash = typeof req.body?.deviceHash === 'string' ? req.body.deviceHash.slice(0, 128) : null;
  db.touchPresence(user.id, { ip, deviceHash });
  db.flushDb();
  // Re-read after flush so we never return a member that is not on disk.
  const saved = db.getUserById(user.id);
  if (!saved) return res.status(500).json({ error: 'Account could not be saved. Try again.' });
  const token = issueSession(res, saved);
  res.json({ user: saved, token, saved: true });
}));

app.get('/api/health', (req, res) => {
  const info = db.getDbInfo();
  const onRenderDisk = info.dataDir === '/var/data' || info.dataDir.startsWith('/var/data/');
  const hasDisk = !!process.env.DATA_DIR || onRenderDisk;
  res.json({
    ok: true,
    users: info.userCount,
    dbBytes: info.dbBytes,
    dataDir: info.dataDir,
    persistentDisk: hasDisk,
    warning: hasDisk
      ? null
      : 'Set DATA_DIR=/var/data and attach a Render Disk, or member accounts wipe on every deploy.',
  });
});

app.post('/api/login', throttle, wrap((req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password required.' });
  }
  const user = db.verifyUser(username, password);
  if (!user) return res.status(401).json({ error: 'Invalid username or password.' });
  const ip = clientIp(req);
  const deviceHash = typeof req.body?.deviceHash === 'string' ? req.body.deviceHash.slice(0, 128) : null;
  // Super staff must never be locked out by IP/device bans (self-ban footgun).
  const staffImmune = user.role === 'super' || user.role === 'accountant' || user.isAdmin;
  if (!staffImmune) {
    const ban = db.findActiveBan({ userId: user.id, ip, deviceHash: deviceHash || user.deviceHash });
    if (ban && ban.ban_type !== 'shadow') {
      return res.status(403).json({ error: `Banned (${ban.ban_type}): ${ban.reason || 'Contact support'}` });
    }
  }
  db.touchPresence(user.id, { ip, deviceHash });
  const token = issueSession(res, user);
  res.json({ user, token });
}));

app.post('/api/logout', (req, res) => {
  const payload = auth.verifyToken(req.cookies?.[auth.TOKEN_COOKIE]);
  if (payload?.id) {
    const uid = Number(payload.id);
    db.clearPresence(uid);
    realtime.disconnectUser?.(uid);
  }
  clearSession(res);
  res.json({ ok: true });
});

app.get('/api/catalog', (req, res) => {
  res.json({
    weapons: db.applyCatalogPrices(catalog.WEAPONS, 'weapon'),
    cosmetics: db.applyCatalogPrices(catalog.COSMETICS, 'cosmetic'),
    flags: db.applyCatalogPrices(catalog.FLAGS, 'flag'),
    coinPacks: db.getCoinPacks(),
    paymentMethods: db.getPaymentMethods(),
    difficulty: catalog.DIFFICULTY,
    coinsPerKill: catalog.COINS_PER_KILL,
    headshotBonus: catalog.HEADSHOT_BONUS,
    levelUpCoins: catalog.LEVEL_UP_COINS,
    killsNeededAtLevel1: catalog.killsNeededAtLevel(1),
    levelKillStep: 20,
    coinMultiplier: db.getCoinMultiplier(),
    maps: MapLib.MAP_LIST,
    equipment: catalog.EQUIPMENT,
    killstreaks: catalog.KILLSTREAKS,
    perks: catalog.PERKS,
    tdm: catalog.TDM,
    weather: db.getLiveopsState()?.weather || 'clear',
  });
});

app.get('/api/leaderboard', auth.authMiddleware, (req, res) => {
  const sort = ['kills', 'coins', 'kd'].includes(req.query.sort) ? req.query.sort : 'kills';
  res.json({ sort, ...db.getLeaderboard(sort, 25, req.user.id) });
});

app.get('/api/arenas', auth.authMiddleware, (req, res) => res.json(realtime.getMatchmaking()));

app.get('/api/me', auth.authMiddleware, wrap((req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });
  const ip = clientIp(req);
  db.touchPresence(user.id, { ip, deviceHash: user.deviceHash });
  res.json({ user });
}));

app.post('/api/me/username', auth.authMiddleware, wrap((req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-16 letters, numbers or underscores.' });
  }
  const user = db.changeUsername(req.user.id, username);
  const token = issueSession(res, user);
  realtime.renameUser(user.id, user.username);
  realtime.notifyUser(user);
  res.json({ user, token });
}));

app.post('/api/me/password', auth.authMiddleware, wrap((req, res) => {
  const currentPassword = req.body?.currentPassword;
  const newPassword = req.body?.newPassword;
  const user = db.changePassword(req.user.id, currentPassword, newPassword);
  const token = issueSession(res, user);
  res.json({ ok: true, user, token });
}));

app.post('/api/shop/buy', auth.authMiddleware, wrap((req, res) => {
  const { kind, id } = req.body || {};
  if (kind !== 'weapon' && kind !== 'cosmetic' && kind !== 'flag') {
    return res.status(400).json({ error: 'Invalid item type' });
  }
  const user = db.purchase(req.user.id, kind, String(id));
  realtime.notifyUser(user);
  res.json({ user });
}));

app.post('/api/shop/equip', auth.authMiddleware, wrap((req, res) => {
  const user = db.equipCosmetic(req.user.id, String(req.body?.id));
  res.json({ user });
}));

app.post('/api/shop/equip-flag', auth.authMiddleware, wrap((req, res) => {
  const user = db.equipFlag(req.user.id, String(req.body?.id));
  realtime.notifyUser(user);
  res.json({ user });
}));

app.post('/api/shop/coin-order', auth.authMiddleware, wrap((req, res) => {
  const { packId, methodId, note } = req.body || {};
  const order = db.createCoinOrder(req.user.id, String(packId), String(methodId), note);
  res.json({ order });
}));

app.get('/api/shop/coin-orders', auth.authMiddleware, wrap((req, res) => {
  res.json({ orders: db.listMyCoinOrders(req.user.id) });
}));

app.get('/api/friends', auth.authMiddleware, wrap((req, res) => {
  const data = db.listFriends(req.user.id);
  const online = realtime.getOnlineUserIds?.() || new Set();
  const mark = (list) => list.map((f) => ({
    ...f,
    online: !!(f.other && online.has(Number(f.other.id))),
    inArena: realtime.getUserArenaSummary?.(f.other?.id) || null,
  }));
  res.json({
    friends: mark(data.friends),
    incoming: mark(data.incoming),
    outgoing: mark(data.outgoing),
  });
}));

app.get('/api/friends/search', auth.authMiddleware, wrap((req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 1) return res.json({ results: [] });
  const online = realtime.getOnlineUserIds?.() || new Set();
  const results = db.searchUsers(req.user.id, q, 15).map((u) => ({
    ...u,
    online: online.has(Number(u.id)),
    inArena: realtime.getUserArenaSummary?.(u.id) || null,
  }));
  res.json({ results });
}));

app.post('/api/friends/request', auth.authMiddleware, wrap((req, res) => {
  const username = String(req.body?.username || '').trim();
  if (!username) throw db.httpError(400, 'Username required');
  const result = db.sendFriendRequest(req.user.id, username);
  if (result.friendship?.other) {
    realtime.notifyFriendEvent?.(result.friendship.other.id, 'friends:updated', { reason: result.autoAccepted ? 'accepted' : 'request' });
  }
  realtime.notifyFriendEvent?.(req.user.id, 'friends:updated', { reason: 'self' });
  res.json(result);
}));

app.post('/api/friends/respond', auth.authMiddleware, wrap((req, res) => {
  const id = Number(req.body?.id);
  const accept = !!req.body?.accept;
  const result = db.respondFriendRequest(req.user.id, id, accept);
  const otherId = result.friendship?.other?.id ?? result.requesterId;
  if (otherId) realtime.notifyFriendEvent?.(otherId, 'friends:updated', { reason: accept ? 'accepted' : 'rejected' });
  realtime.notifyFriendEvent?.(req.user.id, 'friends:updated', { reason: 'self' });
  res.json(result);
}));

app.delete('/api/friends/:userId', auth.authMiddleware, wrap((req, res) => {
  const otherId = Number(req.params.userId);
  db.removeFriend(req.user.id, otherId);
  realtime.notifyFriendEvent?.(otherId, 'friends:updated', { reason: 'removed' });
  res.json({ ok: true });
}));

const { createAdminRouter } = require('./admin/routes');

app.use('/api/admin', (req, res, next) => {
  if (!live.adminRouter) return res.status(503).json({ error: 'Server starting' });
  return live.adminRouter(req, res, next);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' });
});

const server = http.createServer(app);
const io = new Server(server, { serveClient: true });
const realtime = setupRealtime(io);
live.realtime = realtime;
live.adminRouter = createAdminRouter({ db, auth, realtime });

// Rebind handlers that closed over realtime before init (shop notify etc. use live.realtime)
const notify = (user) => live.realtime?.notifyUser(user);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Start with a different port, e.g.  $env:PORT=8080; npm start`);
    process.exit(1);
  }
  throw err;
});

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.') || a.address.startsWith('192.168.56.')) continue;
      if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback/i.test(name)) continue;
      out.push({ name, address: a.address });
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  const info = db.getDbInfo();
  console.log('');
  console.log('  STICKMAN WARFARE server running');
  console.log(`  This PC:   http://localhost:${PORT}/`);
  if (HOST === '0.0.0.0') {
    const lan = lanAddresses();
    for (const { name, address } of lan) console.log(`  Network:   http://${address}:${PORT}/   (${name})`);
    if (!lan.length) console.log('  Network:   no LAN connection found');
  }
  console.log(`  Admin:     http://localhost:${PORT}/admin`);
  console.log(`  Database:  ${info.dbPath} (${info.userCount} members)`);
  if (!process.env.DATA_DIR) {
    console.warn('  WARNING: DATA_DIR is not set. On Render, attach a persistent disk and set DATA_DIR=/var/data');
    console.warn('           otherwise every deploy wipes all member accounts.');
  }
  if (!process.env.JWT_SECRET) {
    console.warn('  WARNING: JWT_SECRET is not set. Set a fixed secret in Render env or sessions reset when the secret file is lost.');
  }
  console.log('');
});
