const {
  WEAPONS, DIFFICULTY, EQUIPMENT, KILLSTREAKS, PERKS, TDM, COINS_PER_KILL, HEADSHOT_BONUS,
} = require('./catalog');
const db = require('./db');
const { verifyToken, TOKEN_COOKIE } = require('./auth');
const MapLib = require('../shared/map');

const MAPS = Object.fromEntries(MapLib.MAP_LIST.map((m) => [m.id, MapLib.buildMap(m.id)]));
const MODES = { ffa: 'Free-for-all', tdm: 'Team Deathmatch' };
const TEAM_CODE = { red: 1, blue: 2 };
const TICK_MS = 50;
const RESPAWN_MS = 3500;
const REGEN_DELAY_MS = 4000;
const REGEN_PER_SEC = 35;
const MAX_HP = 100;
const MAX_REWIND_MS = 300;
const MAX_MOVE = 11.5;
const noRewards = () => ({ uav: false, airstrike: false });

function perkOf(id) {
  return PERKS[id] || PERKS.doubletime;
}

function parseCookies(str) {
  const out = {};
  for (const part of str.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const finite = (...vals) => vals.every((v) => typeof v === 'number' && Number.isFinite(v));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Interpolated historical position used for lag-compensated hit detection. */
function positionAt(p, t) {
  const h = p.history;
  if (!h || !h.length || t >= h[h.length - 1].t) return { ...p.pos, crouch: p.crouch };
  for (let i = h.length - 1; i > 0; i--) {
    const a = h[i - 1], b = h[i];
    if (a.t <= t) {
      const k = (t - a.t) / Math.max(1, b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, crouch: b.crouch };
    }
  }
  return { x: h[0].x, y: h[0].y, z: h[0].z, crouch: h[0].crouch };
}

function setupRealtime(io) {
  const sessions = new Map();
  const players = new Map();
  const arenas = new Map();
  let grenadeSeq = 0, rocketSeq = 0, fireSeq = 0;
  const sockOf = (p) => io.sockets.sockets.get(p.id);

  io.use((socket, next) => {
    const cookies = parseCookies(socket.request.headers.cookie || '');
    const payload = verifyToken(cookies[TOKEN_COOKIE]);
    if (!payload) return next(new Error('unauthorized'));
    socket.user = payload;
    next();
  });

  // ------------------------------------------------------------ sessions & coins
  function startSession(socket, mode, detail) {
    endSession(socket);
    const now = Date.now();
    const s = {
      id: db.startSession(socket.user.id, mode, detail),
      socketId: socket.id,
      userId: socket.user.id,
      username: socket.user.username,
      mode, difficulty: detail || null,
      startedAt: now,
      kills: 0, deaths: 0, coins: 0,
      lastKillAt: now, killTokens: 3, killTimes: [],
    };
    sessions.set(socket.id, s);
    return s;
  }

  function endSession(socket) {
    const s = sessions.get(socket.id);
    if (!s) return null;
    const durationSec = (Date.now() - s.startedAt) / 1000;
    db.evaluateSessionHeuristics(s.userId, {
      kills: s.kills,
      headshots: s.headshots || 0,
      shots: s.shots || s.kills,
      durationSec,
    });
    db.touchPresence(s.userId, { playtimeDelta: durationSec });
    db.endSession(s.id);
    sessions.delete(socket.id);
    return { kills: s.kills, deaths: s.deaths, coins: s.coins, duration: Date.now() - s.startedAt };
  }

  function reward(s, headshot, reason) {
    const mult = db.getCoinMultiplier();
    const killDelta = Math.round((COINS_PER_KILL + (headshot ? HEADSHOT_BONUS : 0)) * mult);
    db.addCoins(s.userId, killDelta, reason);
    const leveled = db.recordKill(s.userId) || { levelsGained: 0, bonus: 0, user: null };
    const user = leveled.user || db.getUserById(s.userId);
    const delta = killDelta + (leveled.bonus || 0);
    db.updateSession(s.id, { kills: 1, coins: delta });
    s.kills++;
    s.coins += delta;
    s.headshots = (s.headshots || 0) + (headshot ? 1 : 0);
    s.shots = (s.shots || 0) + 1;
    return {
      user,
      delta,
      killDelta,
      levelsGained: leveled.levelsGained || 0,
      levelBonus: leveled.bonus || 0,
    };
  }

  const MAX_ARENA_PLAYERS = Number(process.env.MAX_ARENA_PLAYERS) || 12;
  const tournamentArenas = new Map(); // lobbyId -> arena key
  const partyInvites = new Map(); // token -> { fromId, toId, arenaKey, mapId, mode, exp }
  const WEATHERS = new Set(['clear', 'day', 'night', 'fog', 'rain']);
  const normalizeWeather = (w) => (WEATHERS.has(w) ? w : 'clear');
  let weather = normalizeWeather(db.getLiveopsState()?.weather || 'clear');
  let preferredMapOverride = db.getLiveopsState()?.preferred_map || null;
  let lastTickMs = 50;

  function normUserId(id) {
    const n = Number(id);
    return Number.isFinite(n) ? n : null;
  }

  function userOnline(userId) {
    const id = normUserId(userId);
    if (id == null) return false;
    const room = io.sockets.adapter.rooms.get(`user:${id}`);
    return !!(room && room.size > 0);
  }

  function getOnlineUserIds() {
    // Live sockets only — last_seen stale window caused false "online" after logout.
    const ids = new Set();
    for (const [roomName, room] of io.sockets.adapter.rooms) {
      if (!roomName.startsWith('user:') || room.size < 1) continue;
      const id = normUserId(roomName.slice(5));
      if (id != null) ids.add(id);
    }
    for (const sock of io.sockets.sockets.values()) {
      const id = normUserId(sock.user?.id);
      if (id != null) ids.add(id);
    }
    return ids;
  }

  function disconnectUser(userId, { reason, emitKick = false } = {}) {
    const id = normUserId(userId);
    if (id == null) return false;
    let kicked = false;
    const room = io.sockets.adapter.rooms.get(`user:${id}`);
    const sids = room ? [...room] : [];
    for (const sock of io.sockets.sockets.values()) {
      if (normUserId(sock.user?.id) === id && !sids.includes(sock.id)) sids.push(sock.id);
    }
    for (const sid of sids) {
      const sock = io.sockets.sockets.get(sid);
      if (!sock) continue;
      try { leaveArena(sock); } catch { /* ignore */ }
      try { endSession(sock); } catch { /* ignore */ }
      if (emitKick) sock.emit('admin:kick', { reason: reason || 'Kicked' });
      sock.disconnect(true);
      kicked = true;
    }
    db.clearPresence(id);
    broadcastPresence(id, false);
    return kicked;
  }

  function findPlayerByUserId(userId) {
    for (const p of players.values()) {
      if (p.userId === userId) return p;
    }
    return null;
  }

  function getUserArenaSummary(userId) {
    const p = findPlayerByUserId(userId);
    if (!p?.arena || p.arena.quarantine || p.arena.tournamentId) return null;
    return {
      mapId: p.arena.mapId,
      mapName: p.arena.map?.name || p.arena.mapId,
      mode: p.arena.mode,
      count: p.arena.players.size,
      max: MAX_ARENA_PLAYERS,
    };
  }

  function notifyFriendEvent(userId, event, payload) {
    io.to(`user:${userId}`).emit(event, payload || {});
  }

  function broadcastPresence(userId, online) {
    let friendIds = [];
    try { friendIds = db.listAcceptedFriendIds(userId); } catch { /* ignore */ }
    for (const fid of friendIds) {
      io.to(`user:${fid}`).emit('friends:presence', { userId, online: !!online });
    }
  }

  function purgePartyInvites() {
    const now = Date.now();
    for (const [tok, inv] of partyInvites) {
      if (inv.exp < now) partyInvites.delete(tok);
    }
  }

  // ------------------------------------------------------------ arenas
  function arenaFor(mapId, mode, { quarantine = false, tournamentId = null } = {}) {
    const key = tournamentId
      ? `tour:${tournamentId}`
      : quarantine
        ? `quarantine:${mapId}:${mode}`
        : `${mapId}:${mode}`;
    let a = arenas.get(key);
    if (!a) {
      a = {
        key, mapId, mode, map: MAPS[mapId], room: `arena:${key}`, players: new Map(), rockets: [], fires: [],
        score: { red: 0, blue: 0 }, state: 'playing', endsAt: Date.now() + TDM.timeLimitSec * 1000, nextRoundAt: 0,
        quarantine: !!quarantine, tournamentId: tournamentId || null,
        weather,
      };
      arenas.set(key, a);
    }
    return a;
  }

  /**
   * Matchmaking: pack players into the same live lobby for this mode.
   * Preferred map is used only when no open lobby exists (or every lobby is full → new map).
   * Shadow-banned players are isolated in quarantine arenas.
   */
  function findArena(preferredMapId, mode, { quarantine = false } = {}) {
    if (quarantine) {
      const preferred = MapLib.hasMap(preferredMapId) ? preferredMapId : MapLib.DEFAULT_MAP;
      return arenaFor(preferred, mode, { quarantine: true });
    }
    const preferred = preferredMapOverride && MapLib.hasMap(preferredMapOverride)
      ? preferredMapOverride
      : (MapLib.hasMap(preferredMapId) ? preferredMapId : MapLib.DEFAULT_MAP);
    const open = [...arenas.values()]
      .filter((a) => a.mode === mode && !a.quarantine && !a.tournamentId
        && a.players.size > 0 && a.players.size < MAX_ARENA_PLAYERS)
      .sort((a, b) => b.players.size - a.players.size || a.key.localeCompare(b.key));
    if (open.length) return open[0];
    return arenaFor(preferred, mode);
  }

  const roundInfo = (a) => (a.mode === 'tdm'
    ? { state: a.state, score: a.score, endsAt: a.endsAt, scoreLimit: TDM.scoreLimit, now: Date.now() }
    : null);

  function pickTeam(a) {
    let red = 0, blue = 0;
    for (const o of a.players.values()) if (o.team === 'red') red++; else if (o.team === 'blue') blue++;
    return red <= blue ? 'red' : 'blue';
  }

  const isEnemy = (p, o) => o !== p && (!p.team || o.team !== p.team);

  function chooseSpawn(p) {
    const a = p.arena;
    const others = [...a.players.values()].filter((o) => o !== p && o.alive);
    const enemies = others.filter((o) => isEnemy(p, o));
    const mates = others.filter((o) => p.team && o.team === p.team);
    const scored = a.map.spawns.map((sp) => {
      let minE = 60;
      for (const e of enemies) minE = Math.min(minE, Math.hypot(e.pos.x - sp.x, e.pos.z - sp.z));
      let score = minE;
      if (p.team) {
        let minM = 40;
        for (const m of mates) minM = Math.min(minM, Math.hypot(m.pos.x - sp.x, m.pos.z - sp.z));
        if (mates.length) score -= minM * 0.35;
        const home = p.team === 'red' ? -sp.x : sp.x;
        score += home * (enemies.length ? 0.08 : 0.6);
      }
      return { sp, score };
    });
    scored.sort((x, y) => y.score - x.score);
    const top = scored.slice(0, Math.min(3, scored.length));
    return top[Math.floor(Math.random() * top.length)].sp;
  }

  function placeAtSpawn(p, now) {
    const sp = chooseSpawn(p);
    p.pos = { x: sp.x, y: 0, z: sp.z };
    p.yaw = Math.atan2(sp.x, sp.z);
    p.hp = MAX_HP;
    p.alive = true;
    p.grenades = EQUIPMENT[p.lethal].perLife;
    p.rockets = p.loadout.includes('rpg') ? WEAPONS.rpg.magSize + WEAPONS.rpg.reserve : 0;
    p.graceUntil = now + 1500;
    p.lastStateAt = now;
    p.trophyUntil = 0;
    p.trophyReadyAt = 0;
    p.history = [];
  }

  const publicPlayer = (p) => ({
    id: p.id, username: p.username, cosmetic: p.cosmetic, flag: p.flag, team: p.team,
    x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch,
    crouch: p.crouch, weapon: p.weapon, alive: p.alive, kills: p.kills, deaths: p.deaths,
  });

  function leaveArena(socket) {
    const p = players.get(socket.id);
    if (!p) return;
    const a = p.arena;
    players.delete(socket.id);
    a.players.delete(socket.id);
    socket.leave(a.room);
    io.to(a.room).emit('mp:left', { id: socket.id });
    if (!a.players.size) arenas.delete(a.key);
  }

  function sendStreak(p) {
    sockOf(p)?.emit('mp:streak', { streak: p.streak, rewards: p.rewards });
  }

  function endRound(a, winner) {
    a.state = 'ended';
    a.nextRoundAt = Date.now() + TDM.intermissionSec * 1000;
    io.to(a.room).emit('mp:roundEnd', { winner, score: a.score, nextIn: TDM.intermissionSec });
  }

  function startRound(a) {
    const now = Date.now();
    a.state = 'playing';
    a.score = { red: 0, blue: 0 };
    a.endsAt = now + TDM.timeLimitSec * 1000;
    for (const p of a.players.values()) {
      p.kills = p.deaths = p.streak = 0;
      p.rewards = noRewards();
      p.alive = false;
    }
    for (const p of a.players.values()) {
      placeAtSpawn(p, now);
      sockOf(p)?.emit('mp:respawn', { x: p.pos.x, y: 0, z: p.pos.z, yaw: p.yaw, grenades: p.grenades });
      sendStreak(p);
    }
    io.to(a.room).emit('mp:roundStart', roundInfo(a));
  }

  /** quiet: no hitmarker for non-lethal ticks (fire damage arrives several times per second). */
  function applyDamage(victim, shooter, dmg, head, weaponId, from = shooter.pos, quiet = false) {
    const a = victim.arena;
    if (a.state !== 'playing' || !victim.alive) return;
    const now = Date.now();
    victim.hp -= dmg;
    victim.lastDamageAt = now;
    const shooterSock = sockOf(shooter);
    const victimSock = sockOf(victim);
    const suicide = victim === shooter;
    if (victim.hp > 0) {
      victimSock?.emit('mp:damage', { hp: victim.hp, fromX: from.x, fromZ: from.z, weapon: weaponId });
      if (!suicide && !quiet) shooterSock?.emit('mp:hit', { head, killed: false });
      return;
    }
    victim.hp = 0;
    victim.alive = false;
    victim.respawnAt = now + RESPAWN_MS;
    victim.deaths++;
    victim.streak = 0;

    if (!suicide) {
      shooter.kills++;
      if (weaponId !== 'airstrike') {
        shooter.streak++;
        for (const k of Object.values(KILLSTREAKS)) {
          const thresholds = Array.isArray(k.kills) ? k.kills : [k.kills];
          if (thresholds.includes(shooter.streak)) shooter.rewards[k.id] = true;
        }
      }
      const ss = sessions.get(shooter.id);
      if (ss) {
        const { user, delta, levelsGained, levelBonus } = reward(ss, head, 'mp_kill');
        shooterSock?.emit('coins', {
          coins: user.coins, delta, user, levelsGained, levelBonus, level: user.level,
        });
      }
      if (a.mode === 'tdm') a.score[shooter.team]++;
      if (shooter.loadout.includes('rpg')) shooter.rockets = Math.min(6, shooter.rockets + 1);
      shooterSock?.emit('mp:hit', { head, killed: true, streak: shooter.streak });
      sendStreak(shooter);
    }
    const vs = sessions.get(victim.id);
    if (vs) {
      vs.deaths++;
      db.recordDeath(vs.userId);
      db.updateSession(vs.id, { deaths: 1 });
    }
    victimSock?.emit('mp:died', {
      killerId: suicide ? null : shooter.id, killerName: suicide ? null : shooter.username, weapon: weaponId,
      respawnIn: RESPAWN_MS / 1000, kx: from.x, ky: from.y ?? 0, kz: from.z,
    });
    sendStreak(victim);
    io.to(a.room).emit('mp:kill', {
      killerId: suicide ? null : shooter.id, killer: suicide ? '' : shooter.username, killerTeam: shooter.team,
      victimId: victim.id, victim: victim.username, victimTeam: victim.team, weapon: weaponId, head,
    });
    if (a.mode === 'tdm' && !suicide && a.score[shooter.team] >= TDM.scoreLimit) endRound(a, shooter.team);
  }

  /** True if an enemy Trophy System covers (x,z) right now. */
  function trophyBlocks(a, x, z, owner, now) {
    for (const o of a.players.values()) {
      if (!o.alive || o === owner || !isEnemy(owner, o)) continue;
      if (!o.trophyUntil || now > o.trophyUntil) continue;
      const R = perkOf(o.perk).trophy?.radius || 7;
      const tx = o.trophyX ?? o.pos.x, tz = o.trophyZ ?? o.pos.z;
      if (Math.hypot(tx - x, tz - z) <= R) return o;
    }
    return null;
  }

  /** ids: { gid } for grenades, { rid } for rockets, so clients can retire the matching projectile. */
  function explode(a, x, y, z, owner, weaponId, spec, ids = {}) {
    if (arenas.get(a.key) !== a) return;
    const now = Date.now();
    if ((weaponId === 'frag' || weaponId === 'molotov') && trophyBlocks(a, x, z, owner, now)) {
      io.to(a.room).emit('mp:trophyPop', { x, y, z, ...ids });
      return;
    }
    io.to(a.room).emit('mp:explode', { x, y, z, kind: weaponId, ...ids });
    if (a.state !== 'playing') return;
    for (const o of [...a.players.values()]) {
      if (!o.alive) continue;
      if (o === owner ? weaponId === 'airstrike' : !isEnemy(owner, o)) continue;
      const dmg = MapLib.blastDamage(a.map.boxes, x, y, z, o.pos.x, o.pos.y, o.pos.z, o.crouch, spec);
      if (dmg > 0) applyDamage(o, owner, dmg, false, weaponId, { x, y, z });
    }
  }

  /** A molotov shattered: pool fire on the surface below the impact and broadcast it. */
  function igniteFire(a, x, y, z, owner, gid) {
    if (arenas.get(a.key) !== a) return;
    const now = Date.now();
    if (trophyBlocks(a, x, z, owner, now)) {
      io.to(a.room).emit('mp:trophyPop', { x, y, z, gid });
      return;
    }
    const M = EQUIPMENT.molotov;
    const spot = MapLib.fireSpot(a.map.boxes, x, y, z);
    const fire = { fid: ++fireSeq, ...spot, r: M.radius, until: Date.now() + M.duration * 1000, owner, acc: 0 };
    a.fires.push(fire);
    io.to(a.room).emit('mp:fire', { fid: fire.fid, gid, x: spot.x, y: spot.y, z: spot.z, r: M.radius, duration: M.duration });
  }

  /** Advances rockets and burns anyone standing in fire. Called every tick per arena. */
  function updateHazards(a, now, dt) {
    const W = WEAPONS.rpg;
    for (let i = a.rockets.length - 1; i >= 0; i--) {
      const r = a.rockets[i];
      let exploded = null;
      for (let s = 0; s < 2 && !exploded; s++) {
        const sdt = dt / 2;
        r.vy -= W.projectile.gravity * sdt;
        const sp = Math.hypot(r.vx, r.vy, r.vz);
        const dx = r.vx / sp, dy = r.vy / sp, dz = r.vz / sp, len = sp * sdt;
        const wall = MapLib.raycastBoxes(a.map.boxes, r.x, r.y, r.z, dx, dy, dz, len);
        let t = wall ? wall.t : Infinity;
        for (const o of a.players.values()) {
          if (!o.alive || o === r.owner || !isEnemy(r.owner, o)) continue;
          const h = MapLib.rayHumanoid(r.x, r.y, r.z, dx, dy, dz, o.pos.x, o.pos.y, o.pos.z, o.crouch, Math.min(t, len));
          if (h && h.t < t) t = h.t;
        }
        r.t += sdt;
        if (t <= len) {
          exploded = { x: r.x + dx * Math.max(0, t - 0.08), y: r.y + dy * Math.max(0, t - 0.08), z: r.z + dz * Math.max(0, t - 0.08) };
        } else {
          r.x += dx * len; r.y += dy * len; r.z += dz * len;
          if (r.t >= W.projectile.life || Math.abs(r.x) > a.map.HALF + 2 || Math.abs(r.z) > a.map.HALF + 2) exploded = { x: r.x, y: r.y, z: r.z };
        }
      }
      if (exploded) {
        a.rockets.splice(i, 1);
        explode(a, exploded.x, exploded.y, exploded.z, r.owner, 'rpg', W.blast, { rid: r.rid });
      }
    }
    const M = EQUIPMENT.molotov;
    for (let i = a.fires.length - 1; i >= 0; i--) {
      const f = a.fires[i];
      if (now >= f.until) { a.fires.splice(i, 1); continue; }
      f.acc += dt;
      if (f.acc < 0.25) continue;
      f.acc -= 0.25;
      if (a.state !== 'playing') continue;
      for (const o of [...a.players.values()]) {
        if (!o.alive || (o !== f.owner && !isEnemy(f.owner, o))) continue;
        if (Math.hypot(o.pos.x - f.x, o.pos.z - f.z) > f.r || Math.abs(o.pos.y - f.y) > 1.5) continue;
        applyDamage(o, f.owner, M.dps * 0.25, false, 'molotov', f, true);
      }
    }
  }

  // ------------------------------------------------------------ connections
  io.on('connection', (socket) => {
    const uid = normUserId(socket.user.id);
    if (uid == null) {
      socket.disconnect(true);
      return;
    }
    socket.user.id = uid;
    socket.join(`user:${uid}`);
    const ip = socket.handshake.address || '';
    db.touchPresence(uid, { ip });
    broadcastPresence(uid, true);
    const me = () => players.get(socket.id);

    socket.on('disconnect', () => {
      // Presence after leave — delay so multi-tab reconnects settle.
      setTimeout(() => {
        if (!userOnline(uid)) broadcastPresence(uid, false);
      }, 400);
    });

    socket.on('friends:invite', (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const toUserId = Number(data?.toUserId);
      if (!toUserId) return reply({ ok: false, error: 'Target required' });
      if (toUserId === socket.user.id) return reply({ ok: false, error: 'Cannot invite yourself' });
      if (!db.areFriends(socket.user.id, toUserId)) return reply({ ok: false, error: 'Not friends' });
      if (!userOnline(toUserId)) return reply({ ok: false, error: 'Friend offline' });
      purgePartyInvites();
      const p = findPlayerByUserId(socket.user.id);
      const preferredMap = MapLib.hasMap(data?.mapId) ? data.mapId : (p?.arena?.mapId || MapLib.DEFAULT_MAP);
      const mode = p?.arena?.mode
        || (Object.prototype.hasOwnProperty.call(MODES, data?.mode) ? data.mode : 'ffa');
      if (p?.arena) {
        if (p.arena.quarantine || p.arena.tournamentId) {
          return reply({ ok: false, error: 'Cannot invite from this lobby' });
        }
        if (p.arena.players.size >= MAX_ARENA_PLAYERS) {
          return reply({ ok: false, error: 'Arena full' });
        }
      }
      const token = require('crypto').randomBytes(10).toString('hex');
      partyInvites.set(token, {
        fromId: socket.user.id,
        toId: toUserId,
        arenaKey: p?.arena?.key || null,
        mapId: preferredMap,
        mode,
        exp: Date.now() + 120_000,
      });
      const fromUser = db.getUserById(socket.user.id);
      io.to(`user:${toUserId}`).emit('friends:invite', {
        token,
        from: { id: socket.user.id, username: fromUser?.username || socket.user.username },
        mapId: preferredMap,
        mapName: MAPS[preferredMap]?.name || preferredMap,
        mode,
        inArena: !!p?.arena,
        count: p?.arena?.players.size || 0,
        max: MAX_ARENA_PLAYERS,
        expiresIn: 120,
      });
      reply({ ok: true, token });
    });

    // ---------- Single-player ----------
    socket.on('sp:start', (data, ack) => {
      if (typeof ack !== 'function') return;
      const difficulty = DIFFICULTY[data?.difficulty] ? data.difficulty : 'normal';
      leaveArena(socket);
      const s = startSession(socket, 'single', difficulty);
      ack({ ok: true, sessionId: s.id });
    });

    socket.on('sp:kill', (data, ack) => {
      const s = sessions.get(socket.id);
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!s || s.mode !== 'single') return reply({ ok: false });
      const now = Date.now();
      s.killTokens = Math.min(4, s.killTokens + (now - s.lastKillAt) / 400);
      s.lastKillAt = now;
      s.killTimes = s.killTimes.filter((t) => now - t < 60_000);
      if (now - s.startedAt < 1500 || s.killTokens < 1 || s.killTimes.length >= 45) {
        return reply({ ok: false, error: 'rate' });
      }
      s.killTokens -= 1;
      s.killTimes.push(now);
      const { user, delta, levelsGained, levelBonus } = reward(s, !!data?.headshot, `sp_kill:${s.difficulty}`);
      socket.emit('coins', {
        coins: user.coins, delta, user, levelsGained, levelBonus, level: user.level,
      });
      reply({
        ok: true, coins: user.coins, delta, levelsGained, levelBonus, level: user.level, user,
      });
    });

    socket.on('sp:death', () => {
      const s = sessions.get(socket.id);
      if (!s || s.mode !== 'single') return;
      s.deaths++;
      db.recordDeath(s.userId);
      db.updateSession(s.id, { deaths: 1 });
    });

    socket.on('sp:end', (data, ack) => {
      const summary = endSession(socket);
      if (typeof ack === 'function') ack({ ok: true, summary });
    });

    // ---------- Multiplayer ----------
    socket.on('mp:join', (data, ack) => {
      if (typeof ack !== 'function') return;
      const user = db.getUserById(socket.user.id);
      if (!user) return ack({ ok: false, error: 'No account' });
      const ip = socket.handshake.address || '';
      const deviceHash = typeof data?.deviceHash === 'string' ? data.deviceHash.slice(0, 128) : user.deviceHash;
      const hardBan = db.findActiveBan({ userId: user.id, ip, deviceHash });
      if (hardBan && hardBan.ban_type !== 'shadow') {
        return ack({ ok: false, error: `Banned (${hardBan.ban_type})` });
      }
      db.touchPresence(user.id, { ip, deviceHash });
      const owns = (w, slot) => WEAPONS[w] && WEAPONS[w].slot === slot && user.ownedWeapons.includes(w);
      const primary = owns(data?.primary, 'primary') ? data.primary : null;
      const secondary = owns(data?.secondary, 'secondary') ? data.secondary : 'pistol';
      const loadout = primary ? [primary, secondary] : secondary === 'pistol' ? ['pistol'] : ['pistol', secondary];
      const lethal = EQUIPMENT[data?.lethal]?.lethal ? data.lethal : 'frag';
      const perk = perkOf(data?.perk).id;
      const preferredMap = MapLib.hasMap(data?.mapId) ? data.mapId : MapLib.DEFAULT_MAP;
      const mode = Object.prototype.hasOwnProperty.call(MODES, data?.mode) ? data.mode : 'ffa';
      const lobbyId = typeof data?.lobbyId === 'string' ? data.lobbyId : null;
      const lobbyPass = typeof data?.lobbyPassword === 'string' ? data.lobbyPassword : '';
      const inviteToken = typeof data?.inviteToken === 'string' ? data.inviteToken.slice(0, 64) : null;

      leaveArena(socket);
      let a;
      let usedInvite = false;
      if (inviteToken) {
        purgePartyInvites();
        const inv = partyInvites.get(inviteToken);
        if (!inv || inv.toId !== user.id || inv.exp < Date.now()) {
          return ack({ ok: false, error: 'Invite expired' });
        }
        if (inv.fromId && !db.areFriends(user.id, inv.fromId)) {
          return ack({ ok: false, error: 'Not friends' });
        }
        partyInvites.delete(inviteToken);
        usedInvite = true;
        if (inv.arenaKey) {
          a = arenas.get(inv.arenaKey);
          if (!a || a.quarantine || a.tournamentId || a.players.size >= MAX_ARENA_PLAYERS) {
            a = findArena(inv.mapId, inv.mode, { quarantine: db.isShadowBanned(user.id) });
          }
        } else {
          a = findArena(inv.mapId, inv.mode, { quarantine: db.isShadowBanned(user.id) });
        }
      } else if (lobbyId) {
        const lobby = db.getTournamentLobby(lobbyId);
        if (!lobby) return ack({ ok: false, error: 'Lobby not found' });
        const bcrypt = require('bcryptjs');
        if (!bcrypt.compareSync(lobbyPass, lobby.password_hash)) {
          return ack({ ok: false, error: 'Wrong lobby password' });
        }
        a = arenaFor(lobby.map_id, lobby.mode, { tournamentId: lobbyId });
      } else {
        const quarantine = db.isShadowBanned(user.id);
        a = findArena(preferredMap, mode, { quarantine });
      }
      // First player into an empty lobby sets the match weather.
      if (a.players.size === 0) a.weather = normalizeWeather(data?.weather || weather);
      const matchWeather = normalizeWeather(a.weather || weather);
      const mapId = a.mapId;
      startSession(socket, 'multiplayer', `${MAPS[mapId].name} · ${mode.toUpperCase()}${a.quarantine ? ' · Q' : ''}`);
      const now = Date.now();
      const characterId = typeof data?.characterId === 'string' ? data.characterId.slice(0, 32) : null;
      const p = {
        id: socket.id, userId: user.id, username: user.username, cosmetic: user.equippedCosmetic,
        flag: user.equippedFlag || 'none',
        characterId,
        arena: a, team: a.mode === 'tdm' ? pickTeam(a) : null, loadout, lethal, perk, weapon: loadout[0], lastRocketAt: 0,
        pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, crouch: false,
        hp: MAX_HP, alive: true, lastDamageAt: 0, respawnAt: 0,
        kills: 0, deaths: 0, streak: 0, rewards: noRewards(), grenades: EQUIPMENT.frag.perLife,
        lastMeleeAt: 0, lastGrenadeAt: 0, chatTokens: 3, lastChatAt: now,
        lastStateAt: now, graceUntil: now + 1500, shotBudget: 2, lastBudgetAt: now,
        trophyUntil: 0, trophyReadyAt: 0, history: [],
      };
      placeAtSpawn(p, now);
      a.players.set(socket.id, p);
      players.set(socket.id, p);
      socket.join(a.room);
      socket.to(a.room).emit('mp:joined', publicPlayer(p));
      socket.emit('admin:weather', { weather: matchWeather });
      ack({
        ok: true, selfId: socket.id, mapId, mode: a.mode, team: p.team, spawn: { ...p.pos, yaw: p.yaw }, loadout, lethal, perk,
        grenades: p.grenades, round: roundInfo(a), matched: mapId !== preferredMap && !lobbyId && !usedInvite,
        players: [...a.players.values()].filter((o) => o !== p).map(publicPlayer),
        capacity: { count: a.players.size, max: MAX_ARENA_PLAYERS },
        weather: matchWeather, quarantine: !!a.quarantine, party: usedInvite,
      });
    });

    socket.on('mp:state', (d) => {
      const p = me();
      if (!p || !p.alive || !d || !finite(d.x, d.y, d.z, d.yaw, d.pitch)) return;
      const now = Date.now();
      const dt = Math.min(1, (now - p.lastStateAt) / 1000);
      const dist = Math.hypot(d.x - p.pos.x, d.z - p.pos.z);
      if (now < p.graceUntil) {
        if (dist > 3) return;
      } else if (dist > MAX_MOVE * dt + 1.2) {
        socket.emit('mp:correct', { x: p.pos.x, y: p.pos.y, z: p.pos.z });
        p.lastStateAt = now;
        return;
      }
      const lim = p.arena.map.HALF - 0.4;
      p.pos.x = clamp(d.x, -lim, lim);
      p.pos.z = clamp(d.z, -lim, lim);
      p.pos.y = clamp(d.y, 0, 12);
      p.yaw = d.yaw;
      p.pitch = clamp(d.pitch, -1.6, 1.6);
      p.crouch = !!d.crouch;
      if (p.loadout.includes(d.weapon)) p.weapon = d.weapon;
      p.lastStateAt = now;
    });

    socket.on('mp:shoot', (d) => {
      const p = me();
      if (!p || !p.alive || !d || !finite(d.ox, d.oy, d.oz, d.dx, d.dy, d.dz)) return;
      const a = p.arena;
      const weapon = WEAPONS[d.weapon];
      if (!weapon || weapon.projectile || !p.loadout.includes(d.weapon)) return;
      const now = Date.now();
      p.shotBudget = Math.min(3, p.shotBudget + ((now - p.lastBudgetAt) / 1000) * weapon.fireRate);
      p.lastBudgetAt = now;
      if (p.shotBudget < 1) return;
      p.shotBudget -= 1;

      const eyeY = p.pos.y + (p.crouch ? 1.1 : 1.6);
      if (Math.hypot(d.ox - p.pos.x, d.oy - eyeY, d.oz - p.pos.z) > 2.5) return;
      const len = Math.hypot(d.dx, d.dy, d.dz);
      if (len < 1e-6) return;
      const dx = d.dx / len, dy = d.dy / len, dz = d.dz / len;

      const maxRange = Math.min(300, weapon.range * 3);
      const wall = MapLib.raycastBoxes(a.map.boxes, d.ox, d.oy, d.oz, dx, dy, dz, maxRange);
      let bestT = wall ? wall.t : maxRange;
      let victim = null, head = false;
      const rewindT = finite(d.rt) ? clamp(d.rt, now - MAX_REWIND_MS, now) : now;
      for (const o of a.players.values()) {
        if (!o.alive || !isEnemy(p, o)) continue;
        const at = positionAt(o, rewindT);
        const h = MapLib.rayHumanoid(d.ox, d.oy, d.oz, dx, dy, dz, at.x, at.y, at.z, at.crouch, bestT);
        if (h && h.t < bestT) { bestT = h.t; victim = o; head = h.head; }
      }
      socket.to(a.room).emit('mp:shot', {
        id: p.id, weapon: d.weapon, ox: d.ox, oy: d.oy, oz: d.oz,
        ex: d.ox + dx * bestT, ey: d.oy + dy * bestT, ez: d.oz + dz * bestT,
      });
      if (!victim || a.state !== 'playing') return;

      let dmg = weapon.damage * (head ? weapon.headMult : 1);
      if (bestT > weapon.range) dmg *= 0.65;
      applyDamage(victim, p, dmg, head, d.weapon);
    });

    socket.on('mp:melee', (d) => {
      const p = me();
      if (!p || !p.alive || !d || !finite(d.dx, d.dz)) return;
      const a = p.arena;
      const K = EQUIPMENT.knife;
      const now = Date.now();
      if (now - p.lastMeleeAt < K.cooldown * 800) return;
      p.lastMeleeAt = now;
      socket.to(a.room).emit('mp:swing', { id: p.id });
      if (a.state !== 'playing') return;
      const hl = Math.hypot(d.dx, d.dz);
      if (hl < 1e-6) return;
      const fx = d.dx / hl, fz = d.dz / hl;
      const rewindT = finite(d.rt) ? clamp(d.rt, now - MAX_REWIND_MS, now) : now;
      const eyeY = p.pos.y + (p.crouch ? 1.1 : 1.6);
      let best = null, bestD = K.range + 0.4;
      for (const o of a.players.values()) {
        if (!o.alive || !isEnemy(p, o)) continue;
        const at = positionAt(o, rewindT);
        const dx = at.x - p.pos.x, dz = at.z - p.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > bestD || Math.abs(at.y - p.pos.y) > 1.6) continue;
        if (dist > 0.3 && (dx * fx + dz * fz) / dist < Math.cos(0.9)) continue;
        const ty = at.y + (at.crouch ? 0.8 : 1.1);
        const ly = ty - eyeY, len = Math.hypot(dx, ly, dz);
        const wall = MapLib.raycastBoxes(a.map.boxes, p.pos.x, eyeY, p.pos.z, dx / len, ly / len, dz / len, len);
        if (wall && wall.t < len - 0.2) continue;
        best = o;
        bestD = dist;
      }
      if (best) applyDamage(best, p, K.damage, false, 'knife');
    });

    socket.on('mp:grenade', (d) => {
      const p = me();
      if (!p || !p.alive || p.grenades <= 0 || !d || !finite(d.ox, d.oy, d.oz, d.vx, d.vy, d.vz)) return;
      const a = p.arena;
      const F = EQUIPMENT.frag;
      const now = Date.now();
      if (now - p.lastGrenadeAt < 600 || a.state !== 'playing') return;
      const eyeY = p.pos.y + (p.crouch ? 1.1 : 1.6);
      if (Math.hypot(d.ox - p.pos.x, d.oy - eyeY, d.oz - p.pos.z) > 2.5) return;
      let { vx, vy, vz } = d;
      const L = EQUIPMENT[p.lethal];
      const speed = Math.hypot(vx, vy, vz), maxSpeed = L.speed + 10;
      if (speed > maxSpeed) { vx *= maxSpeed / speed; vy *= maxSpeed / speed; vz *= maxSpeed / speed; }
      p.grenades--;
      p.lastGrenadeAt = now;
      const gid = ++grenadeSeq;
      const molotov = p.lethal === 'molotov';
      const fuse = molotov ? L.flight : F.fuse;
      const sim = MapLib.simulateGrenade(a.map.boxes, d.ox, d.oy, d.oz, vx, vy, vz, fuse, { impact: molotov, half: a.map.HALF });
      io.to(a.room).emit('mp:grenade', { gid, owner: p.id, type: p.lethal, ox: d.ox, oy: d.oy, oz: d.oz, vx, vy, vz, fuse });
      if (molotov) setTimeout(() => igniteFire(a, sim.x, sim.y, sim.z, p, gid), sim.t * 1000);
      else setTimeout(() => explode(a, sim.x, sim.y, sim.z, p, 'frag', F, { gid }), F.fuse * 1000);
    });

    socket.on('mp:rocket', (d) => {
      const p = me();
      if (!p || !p.alive || !d || !finite(d.ox, d.oy, d.oz, d.dx, d.dy, d.dz)) return;
      const a = p.arena;
      const W = WEAPONS.rpg;
      const now = Date.now();
      if (!p.loadout.includes('rpg') || p.rockets <= 0 || a.state !== 'playing') return;
      if (now - p.lastRocketAt < W.reloadTime * 850) return;
      const eyeY = p.pos.y + (p.crouch ? 1.1 : 1.6);
      if (Math.hypot(d.ox - p.pos.x, d.oy - eyeY, d.oz - p.pos.z) > 2.5) return;
      const len = Math.hypot(d.dx, d.dy, d.dz);
      if (len < 1e-6) return;
      p.rockets--;
      p.lastRocketAt = now;
      const dx = d.dx / len, dy = d.dy / len, dz = d.dz / len, v = W.projectile.speed;
      const r = { rid: ++rocketSeq, owner: p, x: d.ox, y: d.oy, z: d.oz, vx: dx * v, vy: dy * v, vz: dz * v, t: 0 };
      a.rockets.push(r);
      io.to(a.room).emit('mp:rocket', { rid: r.rid, owner: p.id, ox: d.ox, oy: d.oy, oz: d.oz, dx, dy, dz });
    });

    socket.on('mp:uav', (d, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const p = me();
      if (!p || !p.rewards.uav || p.arena.state !== 'playing') return reply({ ok: false });
      const a = p.arena;
      p.rewards.uav = false;
      const duration = KILLSTREAKS.uav.duration;
      const info = { owner: p.id, name: p.username, team: p.team, duration };
      for (const o of a.players.values()) {
        if (o === p || (p.team && o.team === p.team)) sockOf(o)?.emit('mp:uav', info);
        else sockOf(o)?.emit('mp:enemyUav', { duration });
      }
      sendStreak(p);
      reply({ ok: true });
    });

    socket.on('mp:airstrike', (d, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const p = me();
      if (!p || !p.rewards.airstrike || !d || !finite(d.x, d.z, d.yaw) || p.arena.state !== 'playing') return reply({ ok: false });
      const a = p.arena;
      const A = EQUIPMENT.airstrike;
      p.rewards.airstrike = false;
      const lim = a.map.HALF - 2;
      const x = clamp(d.x, -lim, lim), z = clamp(d.z, -lim, lim);
      const fx = -Math.sin(d.yaw), fz = -Math.cos(d.yaw);
      const bombs = [];
      for (let i = 0; i < A.bombs; i++) {
        const ox = x + fx * (i - (A.bombs - 1) / 2) * A.spacing;
        const oz = z + fz * (i - (A.bombs - 1) / 2) * A.spacing;
        bombs.push({ x: ox, z: oz, at: Date.now() + (A.delay + i * A.interval) * 1000 });
      }
      io.to(a.room).emit('mp:airstrike', {
        x, z, yaw: d.yaw, owner: p.id, name: p.username, team: p.team,
        delay: A.delay, interval: A.interval,
        bombs: bombs.map((b) => [b.x, 0.2, b.z]),
      });
      for (const b of bombs) {
        setTimeout(() => explode(a, b.x, 0.2, b.z, p, 'airstrike', A), b.at - Date.now());
      }
      sendStreak(p);
      reply({ ok: true });
    });

    socket.on('mp:trophy', (d, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const p = me();
      const spec = perkOf(p?.perk).trophy;
      if (!p || !p.alive || !spec || p.arena.state !== 'playing') return reply({ ok: false });
      const now = Date.now();
      if (now < (p.trophyReadyAt || 0) || now < (p.trophyUntil || 0)) return reply({ ok: false });
      p.trophyUntil = now + spec.duration * 1000;
      p.trophyReadyAt = p.trophyUntil + spec.cooldown * 1000;
      p.trophyX = p.pos.x;
      p.trophyZ = p.pos.z;
      io.to(p.arena.room).emit('mp:trophy', {
        id: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, duration: spec.duration, radius: spec.radius,
      });
      reply({ ok: true, until: p.trophyUntil, readyAt: p.trophyReadyAt });
    });

    socket.on('mp:chat', (d) => {
      const p = me();
      if (!p || !d || typeof d.text !== 'string') return;
      const now = Date.now();
      p.chatTokens = Math.min(3, p.chatTokens + (now - p.lastChatAt) / 1500);
      p.lastChatAt = now;
      if (p.chatTokens < 1) {
        socket.emit('mp:chat', { system: true, text: 'You are sending messages too fast.' });
        return;
      }
      const text = d.text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '').trim().slice(0, 120);
      if (!text) return;
      p.chatTokens -= 1;
      const teamOnly = !!d.team && !!p.team;
      const msg = { id: p.id, name: p.username, team: p.team, teamOnly, text };
      db.logChat({
        userId: p.userId, username: p.username, arenaKey: p.arena.key, teamOnly, text,
      });
      if (teamOnly) {
        for (const o of p.arena.players.values()) if (o.team === p.team) sockOf(o)?.emit('mp:chat', msg);
      } else {
        io.to(p.arena.room).emit('mp:chat', msg);
      }
    });

    socket.on('mp:leave', (data, ack) => {
      leaveArena(socket);
      const summary = endSession(socket);
      if (typeof ack === 'function') ack({ ok: true, summary });
    });

    socket.on('disconnect', () => {
      leaveArena(socket);
      endSession(socket);
    });
  });

  // ------------------------------------------------------------ simulation tick
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    for (const a of arenas.values()) {
      updateHazards(a, now, dt);
      if (a.mode === 'tdm') {
        if (a.state === 'playing' && now >= a.endsAt) {
          const { red, blue } = a.score;
          endRound(a, red === blue ? 'draw' : red > blue ? 'red' : 'blue');
        } else if (a.state === 'ended' && now >= a.nextRoundAt) {
          startRound(a);
        }
      }
      for (const p of a.players.values()) {
        if (!p.alive && now >= p.respawnAt) {
          placeAtSpawn(p, now);
          sockOf(p)?.emit('mp:respawn', { x: p.pos.x, y: 0, z: p.pos.z, yaw: p.yaw, grenades: p.grenades });
        } else if (p.alive && p.hp < MAX_HP) {
          const perk = perkOf(p.perk);
          const delay = (perk.regenDelay ?? REGEN_DELAY_MS / 1000) * 1000;
          const rate = perk.regenRate ?? REGEN_PER_SEC;
          if (now - p.lastDamageAt > delay) p.hp = Math.min(MAX_HP, p.hp + rate * dt);
        }
        p.history.push({ t: now, x: p.pos.x, y: p.pos.y, z: p.pos.z, crouch: p.crouch });
        while (p.history.length && now - p.history[0].t > 1000) p.history.shift();
      }
      const snap = { t: now, p: [] };
      for (const p of a.players.values()) {
        snap.p.push([
          p.id, +p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3),
          p.crouch ? 1 : 0, p.weapon, p.alive ? 1 : 0, Math.ceil(p.hp), p.kills, p.deaths, TEAM_CODE[p.team] || 0,
        ]);
      }
      if (a.mode === 'tdm') Object.assign(snap, { s: [a.score.red, a.score.blue], e: a.endsAt, st: a.state });
      io.to(a.room).volatile.emit('mp:snap', snap);
    }
    lastTickMs = TICK_MS;
  }, TICK_MS);

  return {
    notifyUser(user) {
      io.to(`user:${user.id}`).emit('coins', { coins: user.coins, delta: 0, user });
    },
    notifyFriendEvent,
    getOnlineUserIds,
    disconnectUser,
    getUserArenaSummary,
    userOnline,
    renameUser(userId, username) {
      for (const [sid, s] of sessions) {
        if (s.userId === userId) {
          s.username = username;
          const sock = io.sockets.sockets.get(sid);
          if (sock?.user) sock.user.username = username;
        }
      }
      for (const p of players.values()) {
        if (p.userId === userId && p.username !== username) {
          p.username = username;
          io.to(p.arena.room).emit('mp:renamed', { id: p.id, username });
        }
      }
    },
    announce(text) {
      io.emit('admin:announce', { text, at: Date.now() });
    },
    setWeather(w) {
      weather = normalizeWeather(w);
      for (const a of arenas.values()) {
        if (a.players.size === 0) a.weather = weather;
      }
      io.emit('admin:weather', { weather });
    },
    setPreferredMap(mapId, { rotateEmpty } = {}) {
      preferredMapOverride = mapId || null;
      let rotated = 0;
      if (rotateEmpty) {
        for (const [key, a] of [...arenas.entries()]) {
          if (!a.tournamentId && a.players.size === 0) {
            arenas.delete(key);
            rotated++;
          }
        }
      }
      return { preferredMap: preferredMapOverride, rotatedEmpty: rotated };
    },
    registerTournamentLobby(id, mapId, mode) {
      tournamentArenas.set(id, { mapId, mode });
    },
    closeTournamentLobby(id) {
      tournamentArenas.delete(id);
      const key = `tour:${id}`;
      const a = arenas.get(key);
      if (a) {
        for (const p of [...a.players.values()]) {
          const sock = sockOf(p);
          if (sock) {
            leaveArena(sock);
            sock.emit('mp:chat', { system: true, text: 'Tournament lobby closed by admin.' });
          }
        }
        arenas.delete(key);
      }
    },
    kickUser(userId, reason) {
      return disconnectUser(userId, { reason: reason || 'Kicked', emitKick: true });
    },
    disconnectUser(userId) {
      return disconnectUser(userId, { emitKick: false });
    },
    broadcastEconomy() {
      io.emit('admin:economy', {
        coinMultiplier: db.getCoinMultiplier(),
        coinPacks: db.getCoinPacks(),
        paymentMethods: db.getPaymentMethods(),
      });
    },
    getLiveStats() {
      return {
        sessions: sessions.size,
        arenaPlayers: players.size,
        arenas: arenas.size,
        tickMs: lastTickMs,
      };
    },
    getActiveSessions() {
      const now = Date.now();
      return [...sessions.values()].map((s) => ({
        id: s.id, username: s.username, mode: s.mode, difficulty: s.difficulty,
        startedAt: new Date(s.startedAt).toISOString(), durationSec: Math.round((now - s.startedAt) / 1000),
        kills: s.kills, deaths: s.deaths, coins: s.coins, userId: s.userId,
      }));
    },
    getArenaInfo() {
      return [...players.values()].map((p) => ({
        username: p.username, kills: p.kills, deaths: p.deaths, hp: Math.ceil(p.hp), alive: p.alive,
        weapon: p.weapon, cosmetic: p.cosmetic, userId: p.userId,
        map: `${p.arena.map.name} · ${p.arena.mode.toUpperCase()}${p.team ? ` · ${p.team}` : ''}${p.arena.quarantine ? ' · Q' : ''}`,
      }));
    },
    getArenaCounts() {
      const counts = Object.fromEntries(Object.keys(MAPS).map((id) => [id, { ffa: 0, tdm: 0 }]));
      for (const p of players.values()) {
        if (p.arena.quarantine || p.arena.tournamentId) continue;
        counts[p.arena.mapId][p.arena.mode]++;
      }
      return counts;
    },
    getMatchmaking() {
      const counts = this.getArenaCounts();
      const live = {};
      for (const mode of Object.keys(MODES)) {
        const open = [...arenas.values()]
          .filter((a) => a.mode === mode && !a.quarantine && !a.tournamentId
            && a.players.size > 0 && a.players.size < MAX_ARENA_PLAYERS)
          .sort((a, b) => b.players.size - a.players.size);
        live[mode] = open[0]
          ? { mapId: open[0].mapId, name: open[0].map.name, count: open[0].players.size, max: MAX_ARENA_PLAYERS }
          : null;
      }
      return { counts, live, maxPlayers: MAX_ARENA_PLAYERS };
    },
  };
}

module.exports = { setupRealtime };
