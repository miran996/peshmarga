import * as THREE from 'three';
import { Bot } from './bots.js';
import { Stickman } from './stickman.js';
import { audio } from './audio.js';
import { t } from '../i18n.js';

const rand = (a, b) => a + Math.random() * (b - a);
const fmtTime = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const mapName = (game, id) => game.catalog.maps.find((m) => m.id === id)?.name || game.catalog.maps[0].name;
const TEAM_BY_CODE = { 1: 'red', 2: 'blue' };
const TEAM_COLOR = { red: '#e0473c', blue: '#3d8fe0' };
const FRIENDLY_LABEL = '#6fb8ff';

export function emitAck(socket, event, data, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeout);
    socket.emit(event, data, (res) => { clearTimeout(timer); resolve(res); });
  });
}

// =====================================================================
// Single player — free-for-all against AI
// =====================================================================
export class SinglePlayerMode {
  constructor(game, difficultyId, mapId, weather = 'clear') {
    this.game = game;
    this.diff = game.catalog.difficulty[difficultyId] || game.catalog.difficulty.normal;
    this.mapId = mapId;
    this.weather = weather;
    this.title = `${mapName(game, mapId)} · ${this.diff.name}`;
    this.pausable = true;
    this.localHealth = true;
    this.goal = 30;
    this.duration = 480;
  }

  async start() {
    const g = this.game;
    const res = await emitAck(g.socket, 'sp:start', { difficulty: this.diff.id });
    if (!res?.ok) throw new Error('Could not start a session');
    g.loadMap(this.mapId);
    g.applyWeather(this.weather || 'clear');
    this.timeLeft = this.duration;
    this.coinsEarned = 0;
    this.respawnQueue = [];
    this.playerRespawnT = 0;
    this.over = false;

    g.ai.clear();
    g.ai.entities = [g.player];
    for (let i = 0; i < this.diff.botCount; i++) {
      const b = new Bot(g.ai, this.diff, g.weapons);
      b.label = g.makeLabel(b.name);
      g.ai.bots.push(b);
      g.ai.entities.push(b);
    }
    const sp = g.bestSpawn([]);
    g.spawnPlayer(sp.x, sp.z, sp.yaw);
    for (const b of g.ai.bots) this.spawnBot(b);
  }

  spawnBot(b) {
    const g = this.game;
    const eye = g.player.pos.clone();
    eye.y += 1.6;
    const spawns = g.map.spawns.slice().sort(() => Math.random() - 0.5);
    const tmp = new THREE.Vector3();
    let chosen = null, fallback = null;
    for (const sp of spawns) {
      const d = Math.hypot(sp.x - g.player.pos.x, sp.z - g.player.pos.z);
      if (d < 20) continue;
      if (g.ai.bots.some((o) => o !== b && o.alive && Math.hypot(o.pos.x - sp.x, o.pos.z - sp.z) < 3)) continue;
      fallback = fallback || sp;
      if (g.player.alive && g.ai.losClear(eye, tmp.set(sp.x, 1.4, sp.z))) continue;
      chosen = sp;
      break;
    }
    chosen = chosen || fallback || spawns[0];
    b.spawn(chosen.x + rand(-0.8, 0.8), chosen.z + rand(-0.8, 0.8), Math.atan2(chosen.x, chosen.z));
  }

  targets() {
    return this.game.ai.entities;
  }

  onLocalShot(origin, dir, hit, def) {
    const g = this.game;
    g.ai.onGunshot(g.player, g.player.pos, g.time);
    if (!hit.entity) return;
    let dmg = def.damage * (hit.head ? def.headMult : 1);
    if (hit.t > def.range) dmg *= 0.65;
    g.damageEntity(hit.entity, dmg, g.player, hit.head, def.id);
  }

  onMelee(origin, dir, target, knife) {
    if (target) this.game.damageEntity(target, knife.damage, this.game.player, false, 'knife');
  }

  onGrenadeThrow(origin, vel, type) {
    const g = this.game;
    const L = g.catalog.equipment[type];
    g.spawnGrenade({
      ox: origin.x, oy: origin.y, oz: origin.z, vx: vel.x, vy: vel.y, vz: vel.z,
      fuse: type === 'molotov' ? L.flight : L.fuse, owner: g.player, detonate: true, type,
    });
  }

  onRocket(origin, dir) {
    const g = this.game;
    g.spawnRocket({ ox: origin.x, oy: origin.y, oz: origin.z, dx: dir.x, dy: dir.y, dz: dir.z, owner: g.player, detonate: true });
    g.ai.onGunshot(g.player, g.player.pos, g.time);
  }

  useUav() {
    const g = this.game;
    g.setStreakState(g.streak, { ...g.rewards, uav: false });
    g.activateUav(g.catalog.killstreaks.uav.duration);
  }

  useAirstrike(point, yaw) {
    const g = this.game;
    const A = g.catalog.equipment.airstrike;
    g.setStreakState(g.streak, { ...g.rewards, airstrike: false });
    g.hud.message('Airstrike inbound');
    g.airstrikeFx(g.airstrikeBombs(point, yaw), yaw, A.delay, A.interval, g.player);
  }

  useTrophy() {
    const g = this.game;
    const spec = g.perk?.trophy;
    if (!spec) return;
    g.trophyUntil = g.time + spec.duration;
    g.trophyReadyAt = g.trophyUntil + spec.cooldown;
    g.trophyPos = { x: g.player.pos.x, z: g.player.pos.z };
    g.hud.message('Trophy System', `${spec.duration}s active`);
    audio.radio();
  }

  onKill(killer, victim, head, weaponId) {
    const g = this.game;
    if (this.over) return;
    const suicide = killer === victim;
    victim.deaths++;
    if (killer && !suicide) killer.kills++;
    g.hud.killfeed(suicide ? '' : killer?.name || '', victim.name, g.weaponName(weaponId), head,
      !suicide && !!killer?.isPlayer, !!victim.isPlayer);

    if (victim.isPlayer) {
      g.killPlayer(suicide ? null : killer, suicide ? 'yourself' : killer?.name);
      g.socket.emit('sp:death');
      this.playerRespawnT = 3.5;
    } else {
      victim.kill();
      if (victim.label) victim.label.visible = false;
      g.effects.impact(new THREE.Vector3(victim.pos.x, victim.pos.y + 1.2, victim.pos.z), null, 'ink');
      this.respawnQueue.push({ bot: victim, t: 4 });
    }

    if (killer?.isPlayer && !suicide) {
      g.registerKillStreak(weaponId);
      g.addScavengerAmmo();
      g.socket.emit('sp:kill', { headshot: !!head }, (res) => {
        if (!res?.ok) return;
        this.coinsEarned += res.delta;
        g.hud.coinPop(res.delta);
        g.hud.setCoins(res.coins);
        g.onCoins(res);
      });
    }
    if (killer && !suicide && killer.kills >= this.goal) this.finish(killer);
  }

  update(dt) {
    const g = this.game;
    if (this.over) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      const leader = [...g.ai.entities].sort((a, b) => b.kills - a.kills)[0];
      const playerTied = g.player.kills >= leader.kills;
      this.finish(playerTied ? g.player : leader);
      return;
    }
    g.ai.update(dt, g.time);
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const r = this.respawnQueue[i];
      r.t -= dt;
      if (r.t <= 0) {
        this.spawnBot(r.bot);
        this.respawnQueue.splice(i, 1);
      }
    }
    if (!g.player.alive) {
      this.playerRespawnT -= dt;
      g.hud.setRespawn(this.playerRespawnT);
      if (this.playerRespawnT <= 0) {
        const sp = g.bestSpawn(g.ai.bots, 15);
        g.spawnPlayer(sp.x, sp.z, sp.yaw);
      }
    }
  }

  finish(winner) {
    const g = this.game;
    this.over = true;
    const won = !!winner?.isPlayer;
    g.socket.emit('sp:end', {}, () => {});
    this.ended = true;
    g.showResults(won ? 'Victory' : `Defeat — ${winner?.name || ''} wins`, {
      kills: g.player.kills, deaths: g.player.deaths, coins: this.coinsEarned,
    });
  }

  radarBlips(now, uav) {
    const out = [];
    for (const b of this.game.ai.bots) {
      if (!b.alive) continue;
      const age = now - b.lastShotAt;
      if (uav) out.push({ x: b.pos.x, z: b.pos.z, alpha: 1 });
      else if (age < 2) out.push({ x: b.pos.x, z: b.pos.z, alpha: 1 - age / 2 });
    }
    return out;
  }

  scoreboard() {
    return this.game.ai.entities
      .map((e) => ({ name: e.name, kills: e.kills, deaths: e.deaths, me: !!e.isPlayer, alive: e.alive }))
      .sort((a, b) => b.kills - a.kills);
  }

  updateScore() {
    this.game.hud.setScore(`${t('hud.ffa')} · ${this.diff.name}`, this.game.player.kills, this.goal, fmtTime(this.timeLeft));
  }

  stop() {
    const g = this.game;
    if (!this.ended) g.socket.emit('sp:end', {}, () => {});
    for (const b of g.ai.bots) if (b.label) g.scene.remove(b.label);
    g.ai.clear();
  }
}

// =====================================================================
// Multiplayer — server-authoritative free-for-all or team deathmatch
// =====================================================================
export class MultiplayerMode {
  constructor(game, loadout, mapId, mpMode = 'ffa', lethal = 'frag', perk = 'doubletime', weather = 'clear') {
    this.game = game;
    this.loadout = loadout;
    this.lethal = lethal;
    this.perk = perk;
    this.mapId = mapId;
    this.weather = weather;
    this.mpMode = mpMode === 'tdm' ? 'tdm' : 'ffa';
    this.title = `${this.mpMode === 'tdm' ? 'Team Deathmatch' : 'Free-for-all'} · ${mapName(game, mapId)}`;
    this.pausable = false;
    this.localHealth = false;
    this.chat = true;
    this.teamChat = this.mpMode === 'tdm';
    this.remotes = new Map();
    this.handlers = [];
    this.offset = null;
    this.respawnT = 0;
    this.team = null;
    this.score = { red: 0, blue: 0 };
    this.endsAt = 0;
    this.roundState = 'playing';
    this.nextRoundAt = 0;
  }

  on(event, fn) {
    this.game.socket.on(event, fn);
    this.handlers.push([event, fn]);
  }

  isFriendly(team) { return !!this.team && team === this.team; }
  teamCls(team) { return this.team ? (team === this.team ? 'friendly' : 'enemy') : ''; }
  serverNow() { return performance.now() + (this.offset || 0); }

  async start() {
    const g = this.game;
    this.on('mp:joined', (d) => this.addRemote(d, true));
    this.on('mp:left', (d) => this.removeRemote(d.id));
    this.on('mp:renamed', (d) => {
      const r = this.remotes.get(d.id);
      if (!r) return;
      r.name = d.username;
      if (r.label) {
        g.scene.remove(r.label);
        r.label.material?.map?.dispose();
        r.label.material?.dispose();
      }
      r.label = g.makeLabel(d.username, r.friendly ? FRIENDLY_LABEL : undefined);
    });
    this.on('mp:snap', (d) => this.onSnap(d));
    this.on('mp:shot', (d) => {
      const r = this.remotes.get(d.id);
      const from = new THREE.Vector3(d.ox, d.oy, d.oz);
      const end = new THREE.Vector3(d.ex, d.ey, d.ez);
      const dir = end.clone().sub(from);
      const len = dir.length();
      if (len < 0.01) return;
      dir.divideScalar(len);
      const hit = g.trace(from, dir, len + 0.2, r);
      const muzzle = r?.model?.muzzle ? r.model.muzzle.getWorldPosition(new THREE.Vector3()) : from;
      g.shotVisuals(muzzle, end, d.weapon, hit.normal, !!hit.entity);
      if (r) r.lastShotAt = g.time;
    });
    this.on('mp:swing', (d) => {
      const r = this.remotes.get(d.id);
      if (!r) return;
      r.model.swing();
      if (g.player.pos.distanceTo(r.pos) < 12) audio.knife(false);
    });
    this.on('mp:hit', (d) => {
      g.hud.hitmarker(d.head, d.killed);
      audio.hit(d.head, d.killed);
      if (d.killed) {
        if (!g.announceKill()) g.announceStreak(d.streak);
        g.addScavengerAmmo();
      }
    });
    this.on('mp:streak', (d) => g.setStreakState(d.streak, d.rewards));
    this.on('mp:damage', (d) => {
      g.player.hp = d.hp;
      g.onPlayerHurt({ x: d.fromX, z: d.fromZ });
    });
    this.on('mp:died', (d) => {
      const r = d.killerId ? this.remotes.get(d.killerId) : null;
      g.killPlayer(r || (d.killerId ? { pos: new THREE.Vector3(d.kx, d.ky, d.kz) } : null), d.killerName || 'yourself');
      this.respawnT = d.respawnIn;
    });
    this.on('mp:respawn', (d) => g.spawnPlayer(d.x, d.z, d.yaw, d.grenades));
    this.on('mp:correct', (d) => { g.player.pos.set(d.x, d.y, d.z); g.player.vel.set(0, 0, 0); });
    this.on('mp:kill', (d) => {
      g.hud.killfeed(d.killer, d.victim, g.weaponName(d.weapon), d.head, d.killerId === this.selfId, d.victimId === this.selfId,
        this.teamCls(d.killerTeam), this.teamCls(d.victimTeam));
      const r = this.remotes.get(d.victimId);
      if (r) { r.alive = false; r.forceDead = 0.5; }
    });
    this.on('mp:grenade', (d) => {
      g.spawnGrenade({
        ox: d.ox, oy: d.oy, oz: d.oz, vx: d.vx, vy: d.vy, vz: d.vz, fuse: d.fuse, gid: d.gid, type: d.type || 'frag',
        owner: d.owner === this.selfId ? g.player : this.remotes.get(d.owner) || null,
      });
      const r = this.remotes.get(d.owner);
      if (r) r.model.swing();
    });
    this.on('mp:explode', (d) => {
      const live = g.liveGrenades.find((x) => x.gid != null && x.gid === d.gid);
      if (live) g.removeGrenade(live);
      if (d.rid != null) g.removeRocketById(d.rid);
      g.explosionFx(new THREE.Vector3(d.x, d.y, d.z), d.kind === 'airstrike' ? 1.5 : d.kind === 'rpg' ? 1.3 : 1);
    });
    this.on('mp:rocket', (d) => {
      g.spawnRocket({
        ox: d.ox, oy: d.oy, oz: d.oz, dx: d.dx, dy: d.dy, dz: d.dz, rid: d.rid,
        owner: d.owner === this.selfId ? g.player : this.remotes.get(d.owner) || null,
      });
    });
    this.on('mp:fire', (d) => {
      const live = g.liveGrenades.find((x) => x.gid != null && x.gid === d.gid);
      if (live) g.removeGrenade(live);
      g.startFire({ x: d.x, y: d.y, z: d.z }, null, false, d.duration);
    });
    this.on('mp:uav', (d) => g.activateUav(d.duration, d.owner === this.selfId ? null : d.name));
    this.on('mp:enemyUav', (d) => g.enemyUav(d.duration));
    this.on('mp:trophy', (d) => {
      if (d.id === this.selfId) {
        g.trophyUntil = g.time + d.duration;
        g.trophyReadyAt = g.trophyUntil + (g.perk?.trophy?.cooldown || 28);
        g.hud.message('Trophy System', `${d.duration}s active`);
        return;
      }
      g.enemyTrophies = (g.enemyTrophies || []).filter((t) => g.time < t.until);
      g.enemyTrophies.push({ id: d.id, x: d.x, z: d.z, radius: d.radius, until: g.time + d.duration });
      g.hud.message('Enemy Trophy', 'Nearby lethals may be destroyed');
    });
    this.on('mp:trophyPop', (d) => {
      if (d.gid != null) {
        const gnd = g.liveGrenades.find((x) => x.gid === d.gid);
        if (gnd) g.removeGrenade(gnd);
      }
      g.effects.glassBurst(new THREE.Vector3(d.x, d.y || 1, d.z));
      audio.bounce(0.3);
    });
    this.on('mp:airstrike', (d) => {
      const mine = d.owner === this.selfId;
      const friendly = mine || this.isFriendly(d.team);
      g.hud.message(mine ? 'Airstrike inbound' : friendly ? 'Friendly airstrike' : 'Enemy airstrike!', mine ? '' : d.name);
      const A = g.catalog.equipment.airstrike;
      const bombs = d.bombs?.length ? d.bombs : g.airstrikeBombs({ x: d.x, z: d.z }, d.yaw);
      g.airstrikeFx(bombs, d.yaw, d.delay ?? A.delay, d.interval ?? A.interval);
    });
    this.on('mp:chat', (d) => {
      if (d.system) g.hud.addChat({ system: true, text: d.text });
      else g.hud.addChat({ name: d.name, text: d.text, teamOnly: d.teamOnly, cls: d.id === this.selfId ? 'me' : this.teamCls(d.team) });
      audio.chat();
    });
    this.on('mp:roundEnd', (d) => {
      this.roundState = 'ended';
      this.nextRoundAt = g.time + d.nextIn;
      this.score = d.score;
      this.roundResult = d.winner;
    });
    this.on('mp:roundStart', (d) => {
      this.roundState = 'playing';
      this.score = d.score;
      this.endsAt = d.endsAt;
      g.hud.hideRoundEnd();
      g.hud.message('New round', 'First team to 50 kills wins');
    });
    this.on('coins', (d) => {
      if (d.delta > 0) g.hud.coinPop(d.delta);
      g.hud.setCoins(d.coins);
    });

    const primary = this.loadout.find((id) => g.weapons[id]?.slot === 'primary');
    const secondary = this.loadout.find((id) => g.weapons[id]?.slot === 'secondary' && id !== 'pistol') || 'pistol';
    const res = await emitAck(g.socket, 'mp:join', {
      primary, secondary, lethal: this.lethal, perk: this.perk, mapId: this.mapId, mode: this.mpMode,
      weather: this.weather,
      deviceHash: localStorage.getItem('sw_device_hash') || undefined,
      lobbyId: this.lobbyId || undefined,
      lobbyPassword: this.lobbyPassword || undefined,
      inviteToken: this.inviteToken || undefined,
      characterId: localStorage.getItem('fps_selected_character') || undefined,
    });
    if (!res?.ok) throw new Error(res?.error || 'Could not join arena');
    this.inviteToken = null;
    if (res.loadout.join() !== g.slots.map((s) => s.id).join()) g.setLoadout(res.loadout);
    g.setLethal(res.lethal);
    if (res.perk) g.setPerk(res.perk);
    this.mapId = res.mapId;
    this.mpMode = res.mode;
    this.team = res.team;
    g.player.team = res.team;
    if (res.quarantine) g.hud.message('Quarantine lobby', 'Matchmaking restricted');
    if (res.round) {
      this.score = res.round.score;
      this.endsAt = res.round.endsAt;
      this.offset = res.round.now - performance.now();
    }
    g.loadMap(res.mapId);
    g.applyWeather(res.weather || this.weather || 'clear');
    this.selfId = res.selfId;
    for (const p of res.players) this.addRemote(p, false);
    g.spawnPlayer(res.spawn.x, res.spawn.z, res.spawn.yaw, res.grenades);
    if (res.matched) {
      g.hud.message('Joined live lobby', `${mapName(g, res.mapId)} · ${res.capacity?.count || '?'}/${res.capacity?.max || '?'} players`);
    } else if (res.party) {
      g.hud.message(t('friends.joinedParty'), `${mapName(g, res.mapId)} · ${res.capacity?.count || '?'}/${res.capacity?.max || '?'}`);
    } else if (res.capacity) {
      g.hud.message(mapName(g, res.mapId), `${res.capacity.count}/${res.capacity.max} in this arena`);
    }
    if (this.team) g.hud.message(`You are on ${this.team} team`, 'First team to 50 kills wins');
    this.sendT = 0;
  }

  addRemote(d, announce) {
    if (d.id === this.selfId || this.remotes.has(d.id)) return;
    const g = this.game;
    const cos = g.catalog.cosmetics[d.cosmetic] || g.catalog.cosmetics.classic;
    const model = new Stickman(cos, d.weapon);
    const flag = g.catalog.flags?.[d.flag];
    if (flag) model.setFlag(flag);
    g.graphics?.enhanceOperator(model);
    if (d.team) model.setTeam(TEAM_COLOR[d.team]);
    g.scene.add(model.root);
    const friendly = this.isFriendly(d.team);
    const r = {
      id: d.id, name: d.username, isRemote: true, team: d.team, friendly, flag: d.flag || 'none',
      pos: new THREE.Vector3(d.x, d.y, d.z), vel: new THREE.Vector3(), yaw: d.yaw, pitch: d.pitch,
      crouch: d.crouch, alive: d.alive, kills: d.kills, deaths: d.deaths, weapon: d.weapon,
      model, buffer: [], label: g.makeLabel(d.username, friendly ? FRIENDLY_LABEL : undefined), lastShotAt: -99, forceDead: 0,
    };
    model.root.position.copy(r.pos);
    this.remotes.set(d.id, r);
    if (announce) g.hud.addChat({ system: true, text: `${d.username} joined${d.team ? ` the ${d.team} team` : ''}` });
  }

  removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.game.scene.remove(r.model.root);
    this.game.scene.remove(r.label);
    r.model.dispose();
    this.remotes.delete(id);
  }

  onSnap(d) {
    const g = this.game;
    const now = performance.now();
    const off = d.t - now;
    this.offset = this.offset == null ? off : this.offset + (off - this.offset) * 0.05;
    if (d.s) {
      this.score = { red: d.s[0], blue: d.s[1] };
      this.endsAt = d.e;
    }
    for (const e of d.p) {
      const [id, x, y, z, yaw, pitch, crouch, weapon, alive, hp, kills, deaths] = e;
      if (id === this.selfId) {
        g.player.kills = kills;
        g.player.deaths = deaths;
        if (g.player.alive && alive) {
          g.player.hp = hp;
          g.hud.setHealth(hp);
        }
        continue;
      }
      const r = this.remotes.get(id);
      if (!r) continue;
      r.buffer.push({ t: d.t, x, y, z, yaw, pitch, crouch: !!crouch, alive: !!alive });
      if (r.buffer.length > 40) r.buffer.shift();
      r.kills = kills;
      r.deaths = deaths;
      const team = TEAM_BY_CODE[e[12]] || null;
      if (team !== r.team) {
        r.team = team;
        r.friendly = this.isFriendly(team);
        r.model.setTeam(team ? TEAM_COLOR[team] : null);
      }
      if (weapon !== r.weapon) { r.weapon = weapon; r.model.setWeapon(weapon); }
    }
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    this.sendT -= dt;
    if (this.sendT <= 0 && p.alive) {
      this.sendT = 0.05;
      g.socket.volatile.emit('mp:state', {
        x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: g.yaw, pitch: g.pitch, crouch: p.crouch, weapon: g.slot.id,
      });
    }
    if (!p.alive) {
      this.respawnT -= dt;
      g.hud.setRespawn(this.respawnT);
    }
    if (this.roundState === 'ended') {
      const res = this.roundResult;
      const title = res === 'draw' ? 'Draw' : res === this.team ? 'Victory' : 'Defeat';
      const cls = res === 'draw' ? '' : res === this.team ? 'win' : 'lose';
      g.hud.showRoundEnd(title, cls, `RED ${this.score.red}  —  ${this.score.blue} BLUE`, this.nextRoundAt - g.time);
    }

    const renderT = performance.now() + (this.offset || 0) - 80;
    this.renderT = renderT;
    for (const r of this.remotes.values()) {
      const buf = r.buffer;
      if (!buf.length) continue;
      let a = buf[0], b = buf[0];
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].t <= renderT && buf[i + 1].t >= renderT) { a = buf[i]; b = buf[i + 1]; break; }
        if (buf[i + 1].t < renderT) { a = b = buf[i + 1]; }
      }
      const span = b.t - a.t;
      const k = span > 0 ? Math.min(1, Math.max(0, (renderT - a.t) / span)) : 1;
      const src = a.alive !== b.alive ? b : null;
      const prevX = r.pos.x, prevZ = r.pos.z;
      if (src) r.pos.set(src.x, src.y, src.z);
      else r.pos.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      const dy = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
      r.yaw = a.yaw + dy * k;
      r.pitch = a.pitch + (b.pitch - a.pitch) * k;
      r.crouch = b.crouch;
      if (r.forceDead > 0) { r.forceDead -= dt; r.alive = false; }
      else r.alive = (src || b).alive;
      r.vel.set((r.pos.x - prevX) / Math.max(dt, 1e-3), 0, (r.pos.z - prevZ) / Math.max(dt, 1e-3));
      const speed = Math.min(9, Math.hypot(r.vel.x, r.vel.z));
      r.model.root.position.copy(r.pos);
      r.model.root.rotation.y = r.yaw;
      r.model.update(dt, { speed, crouch: r.crouch ? 1 : 0, pitch: r.pitch, dead: !r.alive });
    }
  }

  onLocalShot(origin, dir, hit, def) {
    this.game.socket.emit('mp:shoot', {
      ox: origin.x, oy: origin.y, oz: origin.z, dx: dir.x, dy: dir.y, dz: dir.z, weapon: def.id, rt: this.renderT,
    });
  }

  onMelee(origin, dir) {
    this.game.socket.emit('mp:melee', { dx: dir.x, dz: dir.z, rt: this.renderT });
  }

  onGrenadeThrow(origin, vel) {
    this.game.socket.emit('mp:grenade', { ox: origin.x, oy: origin.y, oz: origin.z, vx: vel.x, vy: vel.y, vz: vel.z });
  }

  onRocket(origin, dir) {
    this.game.socket.emit('mp:rocket', { ox: origin.x, oy: origin.y, oz: origin.z, dx: dir.x, dy: dir.y, dz: dir.z });
  }

  async useUav() {
    const res = await emitAck(this.game.socket, 'mp:uav', {}).catch(() => null);
    if (!res?.ok) this.game.hud.message('UAV unavailable');
  }

  async useAirstrike(point, yaw) {
    const res = await emitAck(this.game.socket, 'mp:airstrike', { x: point.x, z: point.z, yaw }).catch(() => null);
    if (!res?.ok) this.game.hud.message('Airstrike unavailable');
  }

  async useTrophy() {
    const res = await emitAck(this.game.socket, 'mp:trophy', {}).catch(() => null);
    if (!res?.ok) this.game.hud.message('Trophy unavailable');
  }

  sendChat(text, team) {
    this.game.socket.emit('mp:chat', { text, team: !!team });
  }

  onKill() {}

  /** Entities our bullets, knife and crosshair labels can hit: never teammates. */
  targets() { return [...this.remotes.values()].filter((r) => !r.friendly); }

  labeled() { return this.remotes.values(); }

  radarBlips(now, uav) {
    const out = [];
    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      if (r.friendly) { out.push({ x: r.pos.x, z: r.pos.z, alpha: 1, color: '#4aa3ff' }); continue; }
      const age = now - r.lastShotAt;
      if (uav) out.push({ x: r.pos.x, z: r.pos.z, alpha: 1 });
      else if (age < 2) out.push({ x: r.pos.x, z: r.pos.z, alpha: 1 - age / 2 });
    }
    return out;
  }

  scoreboard() {
    const g = this.game;
    const rows = [{ name: g.player.name, kills: g.player.kills, deaths: g.player.deaths, me: true, alive: g.player.alive, team: this.team }];
    for (const r of this.remotes.values()) rows.push({ name: r.name, kills: r.kills, deaths: r.deaths, alive: r.alive, team: r.team });
    rows.sort((a, b) => b.kills - a.kills);
    if (this.mpMode !== 'tdm') return rows;
    const order = this.team === 'blue' ? ['blue', 'red'] : ['red', 'blue'];
    return {
      rows,
      teams: order.map((id) => ({ id, label: `${id === this.team ? 'Your team' : 'Enemy'} · ${id.toUpperCase()}`, score: this.score[id] })),
    };
  }

  updateScore() {
    const g = this.game;
    if (this.mpMode === 'tdm') {
      const mine = this.team || 'red', theirs = mine === 'red' ? 'blue' : 'red';
      const left = this.roundState === 'ended' ? 0 : (this.endsAt - this.serverNow()) / 1000;
      g.hud.setTeamScore(`${t('hud.tdm')} · ${g.catalog.tdm.scoreLimit}`, this.score[mine], this.score[theirs], mine, fmtTime(left));
      return;
    }
    let leader = g.player.kills;
    for (const r of this.remotes.values()) leader = Math.max(leader, r.kills);
    g.hud.setScore(`${mapName(g, this.mapId).toUpperCase()} · ${t('hud.ffa')}`, g.player.kills, leader, `${this.remotes.size + 1}`);
  }

  stop() {
    const g = this.game;
    g.socket.emit('mp:leave', {}, () => {});
    for (const [ev, fn] of this.handlers) g.socket.off(ev, fn);
    this.handlers = [];
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    g.player.team = null;
  }
}
