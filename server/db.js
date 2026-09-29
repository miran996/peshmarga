const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { WEAPONS, COSMETICS, FLAGS, COIN_PACKS, PAYMENT_METHODS, STARTING_COINS,
  LEVEL_UP_COINS, killsNeededAtLevel,
} = require('./catalog');
const { DATA_DIR } = require('./paths');

const DB_PATH = path.join(DATA_DIR, 'game.db');

let db;

function initDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  // FULL = fsync on commit so signups survive sudden process kills / deploys mid-write.
  db.exec('PRAGMA synchronous = FULL;');
  db.exec('PRAGMA temp_store = MEMORY;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      coins INTEGER NOT NULL DEFAULT ${STARTING_COINS},
      owned_weapons TEXT NOT NULL DEFAULT '["pistol"]',
      owned_cosmetics TEXT NOT NULL DEFAULT '["classic"]',
      equipped_cosmetic TEXT NOT NULL DEFAULT 'classic',
      owned_flags TEXT NOT NULL DEFAULT '["none"]',
      equipped_flag TEXT NOT NULL DEFAULT 'none',
      is_admin INTEGER NOT NULL DEFAULT 0,
      total_kills INTEGER NOT NULL DEFAULT 0,
      total_deaths INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS game_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      mode TEXT NOT NULL,
      difficulty TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      kills INTEGER NOT NULL DEFAULT 0,
      deaths INTEGER NOT NULL DEFAULT 0,
      coins_earned INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS coin_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS coin_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      pack_id TEXT NOT NULL,
      method_id TEXT NOT NULL,
      coins INTEGER NOT NULL,
      iqd INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      ref_code TEXT NOT NULL UNIQUE,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      fulfilled_at TEXT,
      fulfilled_by TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Lightweight migrations for older installs.
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('owned_flags')) {
    db.exec(`ALTER TABLE users ADD COLUMN owned_flags TEXT NOT NULL DEFAULT '["none"]'`);
  }
  if (!cols.includes('equipped_flag')) {
    db.exec(`ALTER TABLE users ADD COLUMN equipped_flag TEXT NOT NULL DEFAULT 'none'`);
  }
  if (!cols.includes('role')) {
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'none'`);
    db.exec(`UPDATE users SET role = 'super' WHERE is_admin = 1`);
  }
  if (!cols.includes('last_ip')) {
    db.exec(`ALTER TABLE users ADD COLUMN last_ip TEXT`);
  }
  if (!cols.includes('device_hash')) {
    db.exec(`ALTER TABLE users ADD COLUMN device_hash TEXT`);
  }
  if (!cols.includes('playtime_sec')) {
    db.exec(`ALTER TABLE users ADD COLUMN playtime_sec INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.includes('avatar')) {
    db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT`);
  }
  if (!cols.includes('last_seen_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN last_seen_at TEXT`);
  }
  if (!cols.includes('is_bot')) {
    db.exec(`ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.includes('level')) {
    db.exec(`ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1`);
  }
  if (!cols.includes('level_kills')) {
    db.exec(`ALTER TABLE users ADD COLUMN level_kills INTEGER NOT NULL DEFAULT 0`);
  }
  // Mark scripted / smoke-test accounts so they never pollute member Leaderboard.
  db.prepare(
    `UPDATE users SET is_bot = 1 WHERE is_bot = 0 AND (
      username LIKE 'dummy%' COLLATE NOCASE
      OR username LIKE 'tester%' COLLATE NOCASE
      OR username LIKE 'maptest%' COLLATE NOCASE
      OR username LIKE 'red1_%' COLLATE NOCASE
      OR username LIKE 'red2_%' COLLATE NOCASE
      OR username LIKE 'blue1_%' COLLATE NOCASE
      OR username LIKE 'blue2_%' COLLATE NOCASE
      OR username LIKE 'friend_a_%' COLLATE NOCASE
      OR username LIKE 'friend_b_%' COLLATE NOCASE
      OR username GLOB '[Aa][Ll][Pp][Hh][Aa]*[0-9]*'
      OR username GLOB '[Bb][Rr][Aa][Vv][Oo]*[0-9]*'
      OR username LIKE 'avtest%' COLLATE NOCASE
      OR username LIKE 'flagtest%' COLLATE NOCASE
      OR username LIKE 'searchguy%' COLLATE NOCASE
      OR username LIKE 'smoke%' COLLATE NOCASE
      OR username LIKE 'pwtest%' COLLATE NOCASE
      OR username LIKE 'renmum%' COLLATE NOCASE
      OR username GLOB '[Bb][Oo][Tt][0-9]*'
    )`
  ).run();

  const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
  if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      arena_key TEXT,
      team_only INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS economy_overrides (
      kind TEXT NOT NULL,
      item_id TEXT NOT NULL,
      price INTEGER,
      discount_pct INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT,
      PRIMARY KEY (kind, item_id)
    );
    CREATE TABLE IF NOT EXISTS live_events (
      id TEXT PRIMARY KEY,
      active INTEGER NOT NULL DEFAULT 0,
      mult REAL NOT NULL DEFAULT 1,
      starts_at TEXT,
      ends_at TEXT,
      meta TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS bans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ban_type TEXT NOT NULL,
      target TEXT NOT NULL,
      user_id INTEGER,
      reason TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT,
      expires_at TEXT
    );
    CREATE TABLE IF NOT EXISTS moderation_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      target_user_id INTEGER,
      target TEXT,
      reason TEXT,
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT
    );
    CREATE TABLE IF NOT EXISTS cheat_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      flag_type TEXT NOT NULL,
      detail TEXT,
      score REAL NOT NULL DEFAULT 1,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tournament_lobbies (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'ffa',
      password_hash TEXT NOT NULL,
      label TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT
    );
    CREATE TABLE IF NOT EXISTS liveops_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      weather TEXT NOT NULL DEFAULT 'clear',
      preferred_map TEXT,
      announce TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS coin_pack_config (
      id TEXT PRIMARY KEY,
      name TEXT,
      coins INTEGER,
      iqd INTEGER,
      bonus INTEGER,
      description TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS payment_method_config (
      id TEXT PRIMARY KEY,
      name TEXT,
      phone TEXT,
      hint TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS friendships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_id INTEGER NOT NULL,
      addressee_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(requester_id, addressee_id),
      FOREIGN KEY (requester_id) REFERENCES users(id),
      FOREIGN KEY (addressee_id) REFERENCES users(id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id, status)`);
  const liveops = db.prepare('SELECT id FROM liveops_state WHERE id = 1').get();
  if (!liveops) {
    db.prepare(`INSERT INTO liveops_state (id, weather) VALUES (1, 'clear')`).run();
  }
  const dc = db.prepare(`SELECT id FROM live_events WHERE id = 'double_coin'`).get();
  if (!dc) {
    db.prepare(
      `INSERT INTO live_events (id, active, mult) VALUES ('double_coin', 0, 2)`
    ).run();
  }

  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'admin123';
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUser);
  if (!existing) {
    db.prepare(
      `INSERT INTO users (username, password_hash, coins, owned_weapons, owned_cosmetics, owned_flags, equipped_flag, is_admin, role)
       VALUES (?, ?, ?, ?, ?, ?, 'none', 1, 'super')`
    ).run(
      adminUser,
      bcrypt.hashSync(adminPass, 10),
      STARTING_COINS,
      JSON.stringify(Object.keys(WEAPONS)),
      JSON.stringify(Object.keys(COSMETICS)),
      JSON.stringify(Object.keys(FLAGS))
    );
    console.log(`Created admin account: ${adminUser} / ${adminPass}`);
  } else {
    const admin = db.prepare('SELECT id, is_admin, role FROM users WHERE username = ?').get(adminUser);
    if (admin?.is_admin || admin?.role === 'super') {
      db.prepare(
        `UPDATE users SET owned_weapons = ?, owned_cosmetics = ?, owned_flags = ?, is_admin = 1, role = 'super' WHERE id = ?`
      ).run(
        JSON.stringify(Object.keys(WEAPONS)),
        JSON.stringify(Object.keys(COSMETICS)),
        JSON.stringify(Object.keys(FLAGS)),
        admin.id
      );
    }
  }
  return db;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function sanitizeUser(u) {
  let ownedFlags = ['none'];
  try { ownedFlags = JSON.parse(u.owned_flags || '["none"]'); } catch { /* keep default */ }
  if (!ownedFlags.includes('none')) ownedFlags = ['none', ...ownedFlags];
  let ownedWeapons = ['pistol'];
  try {
    const w = JSON.parse(u.owned_weapons || '["pistol"]');
    if (Array.isArray(w) && w.length) ownedWeapons = w;
  } catch { /* keep default */ }
  let ownedCosmetics = ['classic'];
  try {
    const c = JSON.parse(u.owned_cosmetics || '["classic"]');
    if (Array.isArray(c) && c.length) ownedCosmetics = c;
  } catch { /* keep default */ }
  const role = u.role && u.role !== 'none' ? u.role : (u.is_admin ? 'super' : 'none');
  const avatar = u.avatar || null;
  return {
    id: u.id,
    username: u.username,
    coins: u.coins,
    ownedWeapons,
    ownedCosmetics,
    equippedCosmetic: ownedCosmetics.includes(u.equipped_cosmetic) ? u.equipped_cosmetic : ownedCosmetics[0],
    ownedFlags,
    equippedFlag: u.equipped_flag || 'none',
    role,
    isAdmin: role !== 'none',
    totalKills: u.total_kills,
    totalDeaths: u.total_deaths,
    level: Math.max(1, Number(u.level) || 1),
    levelKills: Math.max(0, Number(u.level_kills) || 0),
    killsToNextLevel: killsNeededAtLevel(Math.max(1, Number(u.level) || 1)),
    playtimeSec: u.playtime_sec || 0,
    lastIp: u.last_ip || null,
    deviceHash: u.device_hash || null,
    avatar,
    avatarUrl: avatar ? `/avatars/${avatar}?v=${encodeURIComponent(avatar)}` : null,
    isBot: !!u.is_bot,
    createdAt: u.created_at,
  };
}

/** Auto / scripted accounts (dummy opponents, smoke tests) — not real members. */
const BOT_USERNAME_RE = /^(dummy|tester\d|maptest|red\d+_|blue\d+_|friend_[ab]_|alpha\d|bravo\d|avtest|flagtest|searchguy|smoke|pwtest|renmum|bot\d)/i;

function isBotUsername(username) {
  return BOT_USERNAME_RE.test(String(username || '').trim());
}

function createUser(username, password, opts = {}) {
  const isBot = (opts.isBot === true || isBotUsername(username)) ? 1 : 0;
  try {
    const r = db
      .prepare('INSERT INTO users (username, password_hash, is_bot) VALUES (?, ?, ?)')
      .run(username, bcrypt.hashSync(password, 10), isBot);
    const id = Number(r.lastInsertRowid);
    flushDb();
    const user = getUserById(id);
    if (!user) throw httpError(500, 'Account could not be saved. Try again.');
    return user;
  } catch (err) {
    if (err.status) throw err;
    if (/UNIQUE/i.test(err.message)) throw httpError(409, 'Username already taken');
    throw err;
  }
}

/** Force WAL pages onto the main DB file (critical after signup / password / economy writes). */
function flushDb() {
  if (!db) return;
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (err) {
    console.error('[db] flush failed:', err.message);
  }
}

function getDbInfo() {
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get()?.c || 0;
  let dbBytes = 0;
  try { dbBytes = fs.statSync(DB_PATH).size; } catch { /* ignore */ }
  return {
    dataDir: DATA_DIR,
    dbPath: DB_PATH,
    dbBytes,
    userCount: users,
  };
}

/** Change display/login name. Case-insensitive uniqueness — no two players can share a name. */
function changeUsername(userId, username) {
  const user = getUserById(userId);
  if (!user) throw httpError(404, 'User not found');
  if (user.username.toLowerCase() === username.toLowerCase()) {
    // Same spelling (any case) — keep the exact spelling they typed if different casing.
    if (user.username === username) return user;
  }
  const taken = db.prepare(
    'SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?'
  ).get(username, userId);
  if (taken) throw httpError(409, 'Username already taken');
  try {
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, userId);
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) throw httpError(409, 'Username already taken');
    throw err;
  }
  return getUserById(userId);
}

/** Change login password. Requires the current password. */
function changePassword(userId, currentPassword, newPassword) {
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    throw httpError(400, 'Current and new password required.');
  }
  if (newPassword.length < 6 || newPassword.length > 72) {
    throw httpError(400, 'New password must be 6-72 characters.');
  }
  if (currentPassword === newPassword) {
    throw httpError(400, 'New password must be different from the current one.');
  }
  const row = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(userId);
  if (!row) throw httpError(404, 'User not found');
  if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
    throw httpError(403, 'Current password is incorrect.');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), userId);
  flushDb();
  return getUserById(userId);
}

const AVATAR_MAX_BYTES = 220_000;

/** Save a JPEG/PNG data-URL avatar (client should resize to ~128–256px). */
function setAvatar(userId, dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw httpError(400, 'Invalid image data');
  }
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!m) throw httpError(400, 'Only JPEG, PNG or WebP images are allowed');
  const ext = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
  const buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  if (buf.length < 64) throw httpError(400, 'Image too small');
  if (buf.length > AVATAR_MAX_BYTES) throw httpError(400, 'Image too large (max ~200 KB)');
  // Basic magic-byte checks
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const isWebp = buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  if (ext === 'jpeg' && !isJpeg) throw httpError(400, 'Corrupt JPEG');
  if (ext === 'png' && !isPng) throw httpError(400, 'Corrupt PNG');
  if (ext === 'webp' && !isWebp) throw httpError(400, 'Corrupt WebP');

  const dir = path.join(DATA_DIR, 'avatars');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const prev = db.prepare('SELECT avatar FROM users WHERE id = ?').get(userId);
  const file = `${userId}.${ext === 'jpeg' ? 'jpg' : ext}`;
  fs.writeFileSync(path.join(dir, file), buf);
  if (prev?.avatar && prev.avatar !== file) {
    try { fs.unlinkSync(path.join(dir, prev.avatar)); } catch { /* ignore */ }
  }
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(file, userId);
  return getUserById(userId);
}

function clearAvatar(userId) {
  const prev = db.prepare('SELECT avatar FROM users WHERE id = ?').get(userId);
  if (prev?.avatar) {
    try { fs.unlinkSync(path.join(DATA_DIR, 'avatars', prev.avatar)); } catch { /* ignore */ }
  }
  db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(userId);
  return getUserById(userId);
}

function verifyUser(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return null;
  return sanitizeUser(u);
}

function getUserById(id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return u ? sanitizeUser(u) : null;
}

function parseCoinAmount(raw) {
  const cleaned = typeof raw === 'string'
    ? raw.replace(/[,+\s]/g, '').trim()
    : raw;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  const amount = Math.trunc(n);
  if (amount === 0 || Math.abs(amount) > 1_000_000) return null;
  return amount;
}

function addCoins(userId, delta, reason, { flush = true } = {}) {
  const amount = Number(delta);
  if (!Number.isFinite(amount) || amount === 0) {
    throw httpError(400, 'Amount must be a non-zero number.');
  }
  const id = Number(userId);
  const r = db.prepare(
    'UPDATE users SET coins = CASE WHEN coins + ? < 0 THEN 0 ELSE coins + ? END WHERE id = ?'
  ).run(amount, amount, id);
  if (!r.changes) throw httpError(404, 'User not found');
  db.prepare('INSERT INTO coin_log (user_id, delta, reason) VALUES (?, ?, ?)')
    .run(id, amount, reason || 'adjust');
  if (flush) flushDb();
  const user = getUserById(id);
  if (!user) throw httpError(500, 'Coins updated but user could not be reloaded');
  return user;
}

function getEffectivePrice(kind, itemId, baseCost) {
  const row = db.prepare(
    'SELECT price, discount_pct FROM economy_overrides WHERE kind = ? AND item_id = ?'
  ).get(kind, itemId);
  if (!row) return baseCost;
  let price = row.price != null ? row.price : baseCost;
  const disc = Math.max(0, Math.min(90, Number(row.discount_pct) || 0));
  price = Math.max(0, Math.round(price * (1 - disc / 100)));
  return price;
}

function applyCatalogPrices(catalogObj, kind) {
  const out = {};
  for (const [id, item] of Object.entries(catalogObj)) {
    const base = item.cost;
    const cost = getEffectivePrice(kind, id, base);
    out[id] = { ...item, cost, baseCost: base, discounted: cost !== base };
  }
  return out;
}

function purchase(userId, kind, itemId) {
  const catalogs = { weapon: WEAPONS, cosmetic: COSMETICS, flag: FLAGS };
  const catalog = catalogs[kind];
  if (!catalog) throw httpError(400, 'Invalid item type');
  const item = catalog[itemId];
  if (!item) throw httpError(404, 'Unknown item');
  const user = getUserById(userId);
  if (!user) throw httpError(404, 'User not found');
  const cost = getEffectivePrice(kind, itemId, item.cost);
  if (cost < 0) throw httpError(400, 'Invalid price');

  if (kind === 'weapon') {
    if (user.ownedWeapons.includes(itemId)) throw httpError(400, 'Already owned');
    if (user.coins < cost) throw httpError(400, 'Not enough coins');
    db.prepare('UPDATE users SET coins = coins - ?, owned_weapons = ? WHERE id = ?')
      .run(cost, JSON.stringify([...user.ownedWeapons, itemId]), userId);
  } else if (kind === 'cosmetic') {
    if (user.ownedCosmetics.includes(itemId)) throw httpError(400, 'Already owned');
    if (user.coins < cost) throw httpError(400, 'Not enough coins');
    db.prepare('UPDATE users SET coins = coins - ?, owned_cosmetics = ?, equipped_cosmetic = ? WHERE id = ?')
      .run(cost, JSON.stringify([...user.ownedCosmetics, itemId]), itemId, userId);
  } else {
    if (user.ownedFlags.includes(itemId)) throw httpError(400, 'Already owned');
    if (item.cost <= 0 && cost <= 0) throw httpError(400, 'Nothing to buy');
    if (user.coins < cost) throw httpError(400, 'Not enough coins');
    db.prepare('UPDATE users SET coins = coins - ?, owned_flags = ?, equipped_flag = ? WHERE id = ?')
      .run(cost, JSON.stringify([...user.ownedFlags, itemId]), itemId, userId);
  }
  db.prepare('INSERT INTO coin_log (user_id, delta, reason) VALUES (?, ?, ?)').run(
    userId, -cost, `purchase:${kind}:${itemId}`
  );
  flushDb();
  return getUserById(userId);
}

function equipCosmetic(userId, cosmeticId) {
  const user = getUserById(userId);
  if (!user) throw httpError(404, 'User not found');
  if (!user.ownedCosmetics.includes(cosmeticId)) throw httpError(400, 'Not owned');
  db.prepare('UPDATE users SET equipped_cosmetic = ? WHERE id = ?').run(cosmeticId, userId);
  return getUserById(userId);
}

function equipFlag(userId, flagId) {
  const user = getUserById(userId);
  if (!user) throw httpError(404, 'User not found');
  if (!FLAGS[flagId]) throw httpError(404, 'Unknown flag');
  if (!user.ownedFlags.includes(flagId)) throw httpError(400, 'Not owned');
  db.prepare('UPDATE users SET equipped_flag = ? WHERE id = ?').run(flagId, userId);
  return getUserById(userId);
}

function makeRefCode() {
  const n = Math.floor(Math.random() * 1e9).toString(36).toUpperCase();
  return `SW-${Date.now().toString(36).toUpperCase()}-${n.slice(0, 4)}`;
}

/** Player requests a coin pack; admin must fulfill after verifying the local payment. */
function createCoinOrder(userId, packId, methodId, note = '') {
  const packs = getCoinPacks();
  const methods = getPaymentMethods();
  const pack = packs[packId];
  const method = methods[methodId];
  if (!pack || !method) throw httpError(400, 'Invalid pack or payment method');
  const user = getUserById(userId);
  if (!user) throw httpError(404, 'User not found');
  const coins = pack.coins + (pack.bonus || 0);
  const ref = makeRefCode();
  const cleanNote = String(note || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
  db.prepare(
    `INSERT INTO coin_orders (user_id, pack_id, method_id, coins, iqd, ref_code, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, packId, methodId, coins, pack.iqd, ref, cleanNote || null);
  return {
    refCode: ref,
    pack,
    method,
    coins,
    iqd: pack.iqd,
    status: 'pending',
    note: cleanNote || null,
  };
}

/** Effective Buy Coins packs (catalog defaults + admin overrides). */
function getCoinPacks() {
  const rows = db.prepare('SELECT * FROM coin_pack_config').all();
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const out = {};
  for (const [id, base] of Object.entries(COIN_PACKS)) {
    const o = byId[id];
    out[id] = {
      id,
      name: o?.name != null && o.name !== '' ? o.name : base.name,
      coins: o?.coins != null ? o.coins : base.coins,
      iqd: o?.iqd != null ? o.iqd : base.iqd,
      bonus: o?.bonus != null ? o.bonus : base.bonus,
      description: o?.description != null && o.description !== '' ? o.description : base.description,
      base: { coins: base.coins, iqd: base.iqd, bonus: base.bonus, name: base.name },
      overridden: !!o,
    };
  }
  return out;
}

function setCoinPack(id, { name, coins, iqd, bonus, description, by }) {
  if (!COIN_PACKS[id]) throw httpError(404, 'Unknown coin pack');
  const coinsN = Number(coins);
  const iqdN = Number(iqd);
  const bonusN = Number(bonus);
  if (!Number.isInteger(coinsN) || coinsN < 1 || coinsN > 10_000_000) {
    throw httpError(400, 'Coins must be an integer from 1 to 10,000,000');
  }
  if (!Number.isInteger(iqdN) || iqdN < 100 || iqdN > 100_000_000) {
    throw httpError(400, 'IQD price must be an integer from 100 to 100,000,000');
  }
  if (!Number.isInteger(bonusN) || bonusN < 0 || bonusN > 10_000_000) {
    throw httpError(400, 'Bonus must be an integer from 0 to 10,000,000');
  }
  const cleanName = String(name || COIN_PACKS[id].name).trim().slice(0, 48);
  const cleanDesc = String(description || '').trim().slice(0, 120);
  db.prepare(
    `INSERT INTO coin_pack_config (id, name, coins, iqd, bonus, description, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, coins = excluded.coins, iqd = excluded.iqd, bonus = excluded.bonus,
       description = excluded.description, updated_at = datetime('now'), updated_by = excluded.updated_by`
  ).run(id, cleanName, coinsN, iqdN, bonusN, cleanDesc || null, by || null);
  return getCoinPacks()[id];
}

function resetCoinPack(id) {
  if (!COIN_PACKS[id]) throw httpError(404, 'Unknown coin pack');
  db.prepare('DELETE FROM coin_pack_config WHERE id = ?').run(id);
  return getCoinPacks()[id];
}

/** Effective payment methods (catalog + admin phone/name overrides). */
function getPaymentMethods() {
  const rows = db.prepare('SELECT * FROM payment_method_config').all();
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const out = {};
  for (const [id, base] of Object.entries(PAYMENT_METHODS)) {
    const o = byId[id];
    out[id] = {
      id,
      name: o?.name != null && o.name !== '' ? o.name : base.name,
      phone: o?.phone != null && o.phone !== '' ? o.phone : base.phone,
      hint: o?.hint != null && o.hint !== '' ? o.hint : base.hint,
      base: { name: base.name, phone: base.phone, hint: base.hint },
      overridden: !!o,
    };
  }
  return out;
}

function setPaymentMethod(id, { name, phone, hint, by }) {
  if (!PAYMENT_METHODS[id]) throw httpError(404, 'Unknown payment method');
  const cleanPhone = String(phone || '').replace(/[^\d+\s\-]/g, '').trim().slice(0, 32);
  if (cleanPhone.length < 7) throw httpError(400, 'Phone number looks too short');
  const cleanName = String(name || PAYMENT_METHODS[id].name).trim().slice(0, 48);
  const cleanHint = String(hint || '').trim().slice(0, 200);
  db.prepare(
    `INSERT INTO payment_method_config (id, name, phone, hint, updated_at, updated_by)
     VALUES (?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, phone = excluded.phone, hint = excluded.hint,
       updated_at = datetime('now'), updated_by = excluded.updated_by`
  ).run(id, cleanName, cleanPhone, cleanHint || null, by || null);
  return getPaymentMethods()[id];
}

function resetPaymentMethod(id) {
  if (!PAYMENT_METHODS[id]) throw httpError(404, 'Unknown payment method');
  db.prepare('DELETE FROM payment_method_config WHERE id = ?').run(id);
  return getPaymentMethods()[id];
}

function listCoinOrders(status = 'pending') {
  const rows = status === 'all'
    ? db.prepare(
      `SELECT o.*, u.username FROM coin_orders o JOIN users u ON u.id = o.user_id
       ORDER BY o.id DESC LIMIT 80`
    ).all()
    : db.prepare(
      `SELECT o.*, u.username FROM coin_orders o JOIN users u ON u.id = o.user_id
       WHERE o.status = ? ORDER BY o.id DESC LIMIT 80`
    ).all(status);
  return rows.map((o) => ({
    id: o.id, username: o.username, userId: o.user_id, packId: o.pack_id, methodId: o.method_id,
    coins: o.coins, iqd: o.iqd, status: o.status, refCode: o.ref_code, note: o.note,
    createdAt: o.created_at, fulfilledAt: o.fulfilled_at, fulfilledBy: o.fulfilled_by,
  }));
}

function fulfillCoinOrder(orderId, adminUsername) {
  const o = db.prepare('SELECT * FROM coin_orders WHERE id = ?').get(orderId);
  if (!o) throw httpError(404, 'Order not found');
  if (o.status !== 'pending') throw httpError(400, 'Order already handled');
  db.exec('BEGIN IMMEDIATE');
  try {
    const upd = db.prepare(
      `UPDATE coin_orders SET status = 'fulfilled', fulfilled_at = datetime('now'), fulfilled_by = ?
       WHERE id = ? AND status = 'pending'`
    ).run(adminUsername, orderId);
    if (!upd.changes) throw httpError(400, 'Order already handled');
    const user = addCoins(o.user_id, o.coins, `coin_order:${o.ref_code}:${o.pack_id}`, { flush: false });
    db.exec('COMMIT');
    flushDb();
    return { user, coins: o.coins };
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

function rejectCoinOrder(orderId, adminUsername) {
  const o = db.prepare('SELECT * FROM coin_orders WHERE id = ?').get(orderId);
  if (!o) throw httpError(404, 'Order not found');
  if (o.status !== 'pending') throw httpError(400, 'Order already handled');
  db.prepare(
    `UPDATE coin_orders SET status = 'rejected', fulfilled_at = datetime('now'), fulfilled_by = ? WHERE id = ?`
  ).run(adminUsername, orderId);
  return getUserById(o.user_id);
}

function listMyCoinOrders(userId) {
  return db.prepare(
    `SELECT id, pack_id as packId, method_id as methodId, coins, iqd, status, ref_code as refCode,
            note, created_at as createdAt, fulfilled_at as fulfilledAt
     FROM coin_orders WHERE user_id = ? ORDER BY id DESC LIMIT 20`
  ).all(userId);
}

function getAllUsers() {
  return db.prepare('SELECT * FROM users ORDER BY id').all().map(sanitizeUser);
}

const LEADERBOARD_ORDER = {
  kills: 'total_kills DESC, total_deaths ASC',
  coins: 'coins DESC, total_kills DESC',
  kd: '(total_kills * 1.0 / MAX(1, total_deaths)) DESC, total_kills DESC',
};

/** Top real members only (admins + bot/test accounts excluded from the public list). */
function getLeaderboard(sort, limit, userId) {
  const order = LEADERBOARD_ORDER[sort] || LEADERBOARD_ORDER.kills;
  const rows = db.prepare(`SELECT id, username, coins, total_kills, total_deaths, equipped_cosmetic, avatar
    FROM users WHERE is_admin = 0 AND IFNULL(is_bot, 0) = 0 ORDER BY ${order}, username ASC`).all();
  const shape = (u, i) => ({
    rank: i + 1, id: u.id, username: u.username, coins: u.coins, kills: u.total_kills, deaths: u.total_deaths,
    kd: Math.round((u.total_kills / Math.max(1, u.total_deaths)) * 100) / 100, cosmetic: u.equipped_cosmetic,
    avatarUrl: u.avatar ? `/avatars/${u.avatar}?v=${encodeURIComponent(u.avatar)}` : null,
  });
  const uid = Number(userId);
  let idx = rows.findIndex((u) => u.id === uid);
  let me = idx >= 0 ? shape(rows[idx], idx) : null;
  // Always return the viewer's own row when logged in (even if filtered from the public board).
  if (!me && Number.isFinite(uid)) {
    const self = db.prepare(
      `SELECT id, username, coins, total_kills, total_deaths, equipped_cosmetic, avatar, is_admin
       FROM users WHERE id = ?`
    ).get(uid);
    if (self && !self.is_admin) me = { ...shape(self, Math.max(0, idx)), rank: null };
  }
  return {
    rows: rows.slice(0, limit).map(shape),
    me,
    total: rows.length,
  };
}

function recordKill(userId) {
  const row = db.prepare('SELECT level, level_kills FROM users WHERE id = ?').get(userId);
  if (!row) return { levelsGained: 0, bonus: 0, user: null };

  let level = Math.max(1, Number(row.level) || 1);
  let levelKills = Math.max(0, Number(row.level_kills) || 0) + 1;
  let levelsGained = 0;
  let bonus = 0;
  let needed = killsNeededAtLevel(level);
  while (levelKills >= needed) {
    levelKills -= needed;
    level += 1;
    levelsGained += 1;
    bonus += LEVEL_UP_COINS;
    needed = killsNeededAtLevel(level);
  }

  db.prepare(
    'UPDATE users SET total_kills = total_kills + 1, level = ?, level_kills = ? WHERE id = ?'
  ).run(level, levelKills, userId);

  if (bonus > 0) addCoins(userId, bonus, `level_up:${level}`);

  return { levelsGained, bonus, user: getUserById(userId) };
}

function recordDeath(userId) {
  db.prepare('UPDATE users SET total_deaths = total_deaths + 1 WHERE id = ?').run(userId);
}

function startSession(userId, mode, difficulty) {
  const r = db
    .prepare('INSERT INTO game_sessions (user_id, mode, difficulty) VALUES (?, ?, ?)')
    .run(userId, mode, difficulty || null);
  return Number(r.lastInsertRowid);
}

function updateSession(sessionId, { kills = 0, deaths = 0, coins = 0 }) {
  db.prepare(
    'UPDATE game_sessions SET kills = kills + ?, deaths = deaths + ?, coins_earned = coins_earned + ? WHERE id = ?'
  ).run(kills, deaths, coins, sessionId);
}

function endSession(sessionId) {
  db.prepare("UPDATE game_sessions SET ended_at = datetime('now') WHERE id = ? AND ended_at IS NULL").run(sessionId);
}

function closeDanglingSessions() {
  db.prepare("UPDATE game_sessions SET ended_at = datetime('now') WHERE ended_at IS NULL").run();
}

function recentSessions(limit = 50) {
  return db
    .prepare(
      `SELECT s.*, u.username FROM game_sessions s JOIN users u ON u.id = s.user_id
       ORDER BY s.id DESC LIMIT ?`
    )
    .all(limit);
}

function setUserRole(userId, role) {
  if (!['none', 'mod', 'accountant', 'super'].includes(role)) throw httpError(400, 'Invalid role');
  const user = getUserById(userId);
  if (!user) throw httpError(404, 'User not found');
  db.prepare('UPDATE users SET role = ?, is_admin = ? WHERE id = ?')
    .run(role, role === 'none' ? 0 : 1, userId);
  return getUserById(userId);
}

function touchPresence(userId, { ip, deviceHash, playtimeDelta = 0 } = {}) {
  const id = Number(userId);
  if (!Number.isFinite(id)) return;
  db.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?").run(id);
  if (ip) db.prepare('UPDATE users SET last_ip = ? WHERE id = ?').run(String(ip).slice(0, 64), id);
  if (deviceHash) db.prepare('UPDATE users SET device_hash = ? WHERE id = ?').run(String(deviceHash).slice(0, 128), id);
  if (playtimeDelta > 0) {
    db.prepare('UPDATE users SET playtime_sec = playtime_sec + ? WHERE id = ?').run(Math.floor(playtimeDelta), id);
  }
}

/** Mark user offline immediately (logout / kick). */
function clearPresence(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id)) return;
  db.prepare('UPDATE users SET last_seen_at = NULL WHERE id = ?').run(id);
}

/** Users with HTTP/socket activity within the last window (seconds). */
function getRecentlySeenUserIds(withinSec = 180) {
  const sec = Math.max(30, Math.min(600, Number(withinSec) || 180));
  return db.prepare(
    `SELECT id FROM users WHERE last_seen_at IS NOT NULL
     AND datetime(last_seen_at) >= datetime('now', ?)`
  ).all(`-${sec} seconds`).map((r) => Number(r.id)).filter(Number.isFinite);
}

function getCoinMultiplier() {
  const ev = db.prepare(`SELECT active, mult, starts_at, ends_at FROM live_events WHERE id = 'double_coin'`).get();
  if (!ev || !ev.active) return 1;
  const now = Date.now();
  if (ev.starts_at && Date.parse(ev.starts_at) > now) return 1;
  if (ev.ends_at && Date.parse(ev.ends_at) < now) return 1;
  return Number(ev.mult) > 0 ? Number(ev.mult) : 2;
}

function setLiveEvent(id, { active, mult, startsAt, endsAt, by }) {
  db.prepare(
    `INSERT INTO live_events (id, active, mult, starts_at, ends_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(id) DO UPDATE SET
       active = excluded.active, mult = excluded.mult, starts_at = excluded.starts_at,
       ends_at = excluded.ends_at, updated_at = datetime('now'), updated_by = excluded.updated_by`
  ).run(id, active ? 1 : 0, mult ?? 2, startsAt || null, endsAt || null, by || null);
  return db.prepare('SELECT * FROM live_events WHERE id = ?').get(id);
}

function listLiveEvents() {
  return db.prepare('SELECT * FROM live_events ORDER BY id').all();
}

function listEconomyOverrides() {
  return db.prepare('SELECT * FROM economy_overrides ORDER BY kind, item_id').all();
}

function setEconomyOverride(kind, itemId, { price, discountPct, by }) {
  if (!['weapon', 'cosmetic', 'flag'].includes(kind)) throw httpError(400, 'Invalid kind');
  db.prepare(
    `INSERT INTO economy_overrides (kind, item_id, price, discount_pct, updated_at, updated_by)
     VALUES (?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(kind, item_id) DO UPDATE SET
       price = excluded.price, discount_pct = excluded.discount_pct,
       updated_at = datetime('now'), updated_by = excluded.updated_by`
  ).run(kind, itemId, price == null ? null : Number(price), Number(discountPct) || 0, by || null);
  return db.prepare('SELECT * FROM economy_overrides WHERE kind = ? AND item_id = ?').get(kind, itemId);
}

function clearEconomyOverride(kind, itemId) {
  db.prepare('DELETE FROM economy_overrides WHERE kind = ? AND item_id = ?').run(kind, itemId);
}

function giftCoinsByUsername(username, amount, by) {
  const u = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(String(username || '').trim());
  if (!u) throw httpError(404, 'User not found');
  const parsed = parseCoinAmount(amount);
  if (parsed == null) {
    throw httpError(400, 'Amount must be a non-zero integer up to 1,000,000.');
  }
  return addCoins(u.id, parsed, `gift:${by || 'admin'}`);
}

function logChat({ userId, username, arenaKey, teamOnly, text }) {
  db.prepare(
    `INSERT INTO chat_logs (user_id, username, arena_key, team_only, text) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, username, arenaKey || null, teamOnly ? 1 : 0, text);
}

function getChatLogs({ userId, q, limit = 50 } = {}) {
  limit = Math.min(200, Math.max(1, Number(limit) || 50));
  if (userId) {
    return db.prepare(
      `SELECT * FROM chat_logs WHERE user_id = ? ORDER BY id DESC LIMIT ?`
    ).all(userId, limit);
  }
  if (q) {
    return db.prepare(
      `SELECT * FROM chat_logs WHERE username LIKE ? OR text LIKE ? ORDER BY id DESC LIMIT ?`
    ).all(`%${q}%`, `%${q}%`, limit);
  }
  return db.prepare(`SELECT * FROM chat_logs ORDER BY id DESC LIMIT ?`).all(limit);
}

function getPlayerProfile(idOrName) {
  let u;
  if (/^\d+$/.test(String(idOrName))) u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(idOrName));
  else u = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(idOrName));
  if (!u) throw httpError(404, 'User not found');
  const user = sanitizeUser(u);
  const sessions = db.prepare(
    `SELECT * FROM game_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 40`
  ).all(user.id);
  const chats = getChatLogs({ userId: user.id, limit: 40 });
  const flags = db.prepare(
    `SELECT * FROM cheat_flags WHERE user_id = ? ORDER BY id DESC LIMIT 30`
  ).all(user.id);
  const bans = db.prepare(
    `SELECT * FROM bans WHERE active = 1 AND (
      user_id = ?
      OR target = ?
      OR target = ?
      OR target = ?
      OR target = ?
    ) ORDER BY id DESC`
  ).all(
    user.id,
    String(user.id),
    user.username,
    u.last_ip || '__none__',
    u.device_hash || '__none__'
  );
  const coinLog = db.prepare(
    `SELECT * FROM coin_log WHERE user_id = ? ORDER BY id DESC LIMIT 30`
  ).all(user.id);
  const coinOrders = listMyCoinOrders(user.id);
  const playtime = sessions.reduce((s, x) => {
    const start = Date.parse(x.started_at.replace(' ', 'T') + 'Z') || 0;
    const end = x.ended_at ? (Date.parse(x.ended_at.replace(' ', 'T') + 'Z') || start) : Date.now();
    return s + Math.max(0, (end - start) / 1000);
  }, 0);
  return {
    user,
    kd: Math.round((user.totalKills / Math.max(1, user.totalDeaths)) * 100) / 100,
    sessions,
    chats,
    flags,
    bans,
    coinLog,
    coinOrders,
    estimatedPlaytimeSec: Math.round(playtime),
  };
}

function createBan({ banType, target, userId, reason, by, expiresAt }) {
  if (!['account', 'ip', 'device', 'shadow'].includes(banType)) throw httpError(400, 'Invalid ban type');
  if (!target) throw httpError(400, 'Target required');
  const r = db.prepare(
    `INSERT INTO bans (ban_type, target, user_id, reason, created_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(banType, String(target).slice(0, 128), userId || null, reason || null, by || null, expiresAt || null);
  db.prepare(
    `INSERT INTO moderation_actions (action, target_user_id, target, reason, created_by)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`ban:${banType}`, userId || null, String(target).slice(0, 128), reason || null, by || null);
  return db.prepare('SELECT * FROM bans WHERE id = ?').get(Number(r.lastInsertRowid));
}

function liftBan(banId, by) {
  const b = db.prepare('SELECT * FROM bans WHERE id = ?').get(banId);
  if (!b) throw httpError(404, 'Ban not found');
  db.prepare('UPDATE bans SET active = 0 WHERE id = ?').run(banId);
  db.prepare(
    `INSERT INTO moderation_actions (action, target_user_id, target, reason, created_by)
     VALUES ('unban', ?, ?, ?, ?)`
  ).run(b.user_id, b.target, `lifted #${banId}`, by || null);
  return getUserById(b.user_id);
}

function listBans(activeOnly = true) {
  return activeOnly
    ? db.prepare('SELECT * FROM bans WHERE active = 1 ORDER BY id DESC LIMIT 100').all()
    : db.prepare('SELECT * FROM bans ORDER BY id DESC LIMIT 100').all();
}

function findActiveBan({ userId, ip, deviceHash }) {
  const rows = db.prepare(
    `SELECT * FROM bans WHERE active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))`
  ).all();
  for (const b of rows) {
    if (b.ban_type === 'account' && userId && (b.user_id === userId || b.target === String(userId))) return b;
    if (b.ban_type === 'ip' && ip && b.target === ip) return b;
    if (b.ban_type === 'device' && deviceHash && b.target === deviceHash) return b;
    if (b.ban_type === 'shadow' && userId && b.user_id === userId) return b;
  }
  return null;
}

function isShadowBanned(userId) {
  const b = db.prepare(
    `SELECT id FROM bans WHERE active = 1 AND ban_type = 'shadow' AND user_id = ?
     AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 1`
  ).get(userId);
  return !!b;
}

function addCheatFlag(userId, flagType, detail, score = 1) {
  db.prepare(
    `INSERT INTO cheat_flags (user_id, flag_type, detail, score) VALUES (?, ?, ?, ?)`
  ).run(userId, flagType, detail || null, score);
}

function listCheatFlags({ unresolvedOnly = true, limit = 50 } = {}) {
  limit = Math.min(200, Number(limit) || 50);
  return unresolvedOnly
    ? db.prepare(
      `SELECT f.*, u.username FROM cheat_flags f JOIN users u ON u.id = f.user_id
       WHERE f.resolved = 0 ORDER BY f.id DESC LIMIT ?`
    ).all(limit)
    : db.prepare(
      `SELECT f.*, u.username FROM cheat_flags f JOIN users u ON u.id = f.user_id
       ORDER BY f.id DESC LIMIT ?`
    ).all(limit);
}

function resolveCheatFlag(id) {
  db.prepare('UPDATE cheat_flags SET resolved = 1 WHERE id = ?').run(id);
}

function evaluateSessionHeuristics(userId, { kills, headshots, shots, durationSec }) {
  if (kills >= 8 && shots > 0) {
    const hsRate = headshots / Math.max(1, kills);
    if (hsRate >= 0.95 && kills >= 10) {
      addCheatFlag(userId, 'hs_rate', `HS ${headshots}/${kills} (${Math.round(hsRate * 100)}%)`, hsRate);
    }
  }
  if (durationSec > 30 && kills / (durationSec / 60) > 25) {
    addCheatFlag(userId, 'kill_rate', `${kills} kills in ${Math.round(durationSec)}s`, kills / (durationSec / 60));
  }
}

function getAnalyticsSnapshot() {
  const allUsers = db.prepare('SELECT COUNT(*) as c FROM users').get();
  const players = db.prepare(`SELECT COUNT(*) as c, COALESCE(SUM(coins),0) as coins FROM users WHERE COALESCE(role,'none') = 'none'`).get();
  const revenue = db.prepare(
    `SELECT date(fulfilled_at) as day, SUM(iqd) as iqd, SUM(coins) as coins, COUNT(*) as orders
     FROM coin_orders WHERE status = 'fulfilled' AND fulfilled_at IS NOT NULL
     GROUP BY date(fulfilled_at) ORDER BY day DESC LIMIT 14`
  ).all().reverse();
  const pendingOrders = db.prepare(`SELECT COUNT(*) as c FROM coin_orders WHERE status = 'pending'`).get();
  const openFlags = db.prepare(`SELECT COUNT(*) as c FROM cheat_flags WHERE resolved = 0`).get();
  return {
    userCount: allUsers.c,
    playerCount: players.c,
    coinsInCirculation: players.coins || 0,
    pendingOrders: pendingOrders.c,
    openFlags: openFlags.c,
    revenueByDay: revenue,
  };
}

function getLiveopsState() {
  return db.prepare('SELECT * FROM liveops_state WHERE id = 1').get();
}

function setLiveopsState({ weather, preferredMap, announce }) {
  const cur = getLiveopsState();
  db.prepare(
    `UPDATE liveops_state SET weather = ?, preferred_map = ?, announce = ?, updated_at = datetime('now') WHERE id = 1`
  ).run(
    weather != null ? weather : cur.weather,
    preferredMap !== undefined ? preferredMap : cur.preferred_map,
    announce !== undefined ? announce : cur.announce
  );
  return getLiveopsState();
}

function createTournamentLobby({ id, mapId, mode, passwordHash, label, by }) {
  db.prepare(
    `INSERT INTO tournament_lobbies (id, map_id, mode, password_hash, label, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, mapId, mode || 'ffa', passwordHash, label || null, by || null);
  return db.prepare('SELECT id, map_id, mode, label, active, created_at, created_by FROM tournament_lobbies WHERE id = ?').get(id);
}

function listTournamentLobbies() {
  return db.prepare(
    `SELECT id, map_id as mapId, mode, label, active, created_at as createdAt, created_by as createdBy
     FROM tournament_lobbies WHERE active = 1 ORDER BY created_at DESC`
  ).all();
}

function getTournamentLobby(id) {
  return db.prepare('SELECT * FROM tournament_lobbies WHERE id = ? AND active = 1').get(id);
}

function deactivateTournamentLobby(id) {
  db.prepare('UPDATE tournament_lobbies SET active = 0 WHERE id = ?').run(id);
}

function logModAction({ action, targetUserId, target, reason, by, meta }) {
  db.prepare(
    `INSERT INTO moderation_actions (action, target_user_id, target, reason, meta, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(action, targetUserId || null, target || null, reason || null, meta ? JSON.stringify(meta) : null, by || null);
}

function getUserRowByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(username || '').trim());
}

function friendshipBetween(a, b) {
  return db.prepare(
    `SELECT * FROM friendships WHERE
      (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
     LIMIT 1`
  ).get(a, b, b, a);
}

function areFriends(a, b) {
  const row = friendshipBetween(a, b);
  return !!(row && row.status === 'accepted');
}

function sendFriendRequest(fromId, username) {
  const target = getUserRowByUsername(username);
  if (!target) throw httpError(404, 'User not found');
  if (target.is_bot) throw httpError(404, 'User not found');
  if (target.id === fromId) throw httpError(400, 'Cannot add yourself');
  const existing = friendshipBetween(fromId, target.id);
  if (existing) {
    if (existing.status === 'accepted') throw httpError(400, 'Already friends');
    if (existing.requester_id === fromId) throw httpError(400, 'Request already sent');
    // They already requested us — accept.
    db.prepare(`UPDATE friendships SET status = 'accepted' WHERE id = ?`).run(existing.id);
    return { friendship: shapeFriendship(db.prepare('SELECT * FROM friendships WHERE id = ?').get(existing.id), fromId), autoAccepted: true };
  }
  const r = db.prepare(
    `INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')`
  ).run(fromId, target.id);
  return {
    friendship: shapeFriendship(db.prepare('SELECT * FROM friendships WHERE id = ?').get(r.lastInsertRowid), fromId),
    autoAccepted: false,
  };
}

function respondFriendRequest(userId, friendshipId, accept) {
  const row = db.prepare('SELECT * FROM friendships WHERE id = ?').get(Number(friendshipId));
  if (!row) throw httpError(404, 'Request not found');
  if (row.addressee_id !== userId) throw httpError(403, 'Not your request');
  if (row.status !== 'pending') throw httpError(400, 'Already handled');
  if (!accept) {
    const requesterId = row.requester_id;
    db.prepare('DELETE FROM friendships WHERE id = ?').run(row.id);
    return { ok: true, rejected: true, requesterId };
  }
  db.prepare(`UPDATE friendships SET status = 'accepted' WHERE id = ?`).run(row.id);
  return { friendship: shapeFriendship(db.prepare('SELECT * FROM friendships WHERE id = ?').get(row.id), userId), ok: true };
}

function removeFriend(userId, otherId) {
  const row = friendshipBetween(userId, Number(otherId));
  if (!row) throw httpError(404, 'Not friends');
  db.prepare('DELETE FROM friendships WHERE id = ?').run(row.id);
  return { ok: true };
}

function friendPublic(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    avatarUrl: u.avatar ? `/avatars/${u.avatar}?v=${encodeURIComponent(u.avatar)}` : null,
    cosmetic: u.equipped_cosmetic,
  };
}

function shapeFriendship(row, viewerId) {
  const otherId = row.requester_id === viewerId ? row.addressee_id : row.requester_id;
  const other = db.prepare('SELECT id, username, avatar, equipped_cosmetic FROM users WHERE id = ?').get(otherId);
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    incoming: row.status === 'pending' && row.addressee_id === viewerId,
    outgoing: row.status === 'pending' && row.requester_id === viewerId,
    other: friendPublic(other),
  };
}

function listFriends(userId) {
  const rows = db.prepare(
    `SELECT * FROM friendships WHERE requester_id = ? OR addressee_id = ? ORDER BY id DESC LIMIT 100`
  ).all(userId, userId);
  const friends = [];
  const incoming = [];
  const outgoing = [];
  for (const row of rows) {
    const shaped = shapeFriendship(row, userId);
    if (row.status === 'accepted') friends.push(shaped);
    else if (shaped.incoming) incoming.push(shaped);
    else outgoing.push(shaped);
  }
  return { friends, incoming, outgoing };
}

function listAcceptedFriendIds(userId) {
  const rows = db.prepare(
    `SELECT requester_id, addressee_id FROM friendships
     WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`
  ).all(userId, userId);
  return rows.map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id));
}

/** Search members by username for friend add UI. */
function searchUsers(viewerId, query, limit = 12) {
  const q = String(query || '').trim();
  if (q.length < 1) return [];
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = db.prepare(
    `SELECT id, username, avatar, equipped_cosmetic, role, is_admin, is_bot
     FROM users
     WHERE id != ?
       AND IFNULL(is_bot, 0) = 0
       AND username LIKE ? COLLATE NOCASE
     ORDER BY
       CASE WHEN username LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
       username COLLATE NOCASE ASC
     LIMIT ?`
  ).all(viewerId, like, `${q.replace(/[%_]/g, '')}%`, Math.min(30, Math.max(1, Number(limit) || 12)));

  return rows
    .filter((u) => !(u.is_admin && (u.role === 'super' || u.role === 'accountant')))
    .map((u) => {
      const rel = friendshipBetween(viewerId, u.id);
      let relation = 'none';
      if (rel?.status === 'accepted') relation = 'friends';
      else if (rel?.status === 'pending' && rel.requester_id === viewerId) relation = 'outgoing';
      else if (rel?.status === 'pending') relation = 'incoming';
      return {
        ...friendPublic(u),
        relation,
        friendshipId: rel?.id || null,
      };
    });
}

module.exports = {
  initDb,
  flushDb,
  getDbInfo,
  httpError,
  getLeaderboard,
  createUser,
  changeUsername,
  changePassword,
  setAvatar,
  clearAvatar,
  verifyUser,
  getUserById,
  parseCoinAmount,
  addCoins,
  getEffectivePrice,
  applyCatalogPrices,
  purchase,
  equipCosmetic,
  equipFlag,
  createCoinOrder,
  listCoinOrders,
  fulfillCoinOrder,
  rejectCoinOrder,
  listMyCoinOrders,
  getCoinPacks,
  setCoinPack,
  resetCoinPack,
  getPaymentMethods,
  setPaymentMethod,
  resetPaymentMethod,
  getAllUsers,
  recordKill,
  recordDeath,
  startSession,
  updateSession,
  endSession,
  closeDanglingSessions,
  recentSessions,
  setUserRole,
  touchPresence,
  clearPresence,
  getRecentlySeenUserIds,
  getCoinMultiplier,
  setLiveEvent,
  listLiveEvents,
  listEconomyOverrides,
  setEconomyOverride,
  clearEconomyOverride,
  giftCoinsByUsername,
  logChat,
  getChatLogs,
  getPlayerProfile,
  createBan,
  liftBan,
  listBans,
  findActiveBan,
  isShadowBanned,
  addCheatFlag,
  listCheatFlags,
  resolveCheatFlag,
  evaluateSessionHeuristics,
  getAnalyticsSnapshot,
  getLiveopsState,
  setLiveopsState,
  createTournamentLobby,
  listTournamentLobbies,
  getTournamentLobby,
  deactivateTournamentLobby,
  logModAction,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  listFriends,
  listAcceptedFriendIds,
  areFriends,
  searchUsers,
};
