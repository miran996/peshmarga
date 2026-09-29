import * as THREE from 'three';
import { Stickman, HOSTILE_COSMETIC } from './stickman.js';
import { enhanceOperatorMaterials } from '../graphics/materials.js';
import { resolveGraphicsConfig } from '../graphics/config.js';
import { settings } from '../settings.js';

const { raycastBoxes, GRENADE } = window.StickMap;

/** Launch velocity that lobs a grenade from `from` to land near `to`, or null if out of reach. */
function lobVelocity(from, to, maxSpeed) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const d = Math.hypot(dx, dz), h = to.y - from.y;
  if (d < 1) return null;
  for (const ang of [0.6, 0.78, 0.45, 0.95]) {
    const c = Math.cos(ang);
    const denom = 2 * c * c * (d * Math.tan(ang) - h);
    if (denom <= 0) continue;
    const v = Math.sqrt((GRENADE.gravity * d * d) / denom);
    if (v > maxSpeed) continue;
    return { vx: (dx / d) * v * c, vy: v * Math.sin(ang), vz: (dz / d) * v * c };
  }
  return null;
}

// ------------------------------------------------------------------
// Navigation grid + A*
// ------------------------------------------------------------------
export class NavGrid {
  constructor(map, cell = 0.5, radius = 0.42) {
    this.cell = cell;
    this.half = map.HALF;
    const n = (this.n = Math.ceil(map.SIZE / cell));
    const N = n * n;
    this.grid = new Uint8Array(N);
    for (const b of map.boxes) {
      if (b.maxY < 0.5 || b.minY > 1.7) continue;
      const i0 = Math.max(0, Math.ceil((b.minX - radius + this.half) / cell - 0.5));
      const i1 = Math.min(n - 1, Math.floor((b.maxX + radius + this.half) / cell - 0.5));
      const j0 = Math.max(0, Math.ceil((b.minZ - radius + this.half) / cell - 0.5));
      const j1 = Math.min(n - 1, Math.floor((b.maxZ + radius + this.half) / cell - 0.5));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.grid[j * n + i] = 1;
    }
    const edge = Math.ceil(0.6 / cell);
    for (let i = 0; i < n; i++) for (let k = 0; k < edge; k++) {
      this.grid[k * n + i] = this.grid[(n - 1 - k) * n + i] = 1;
      this.grid[i * n + k] = this.grid[i * n + (n - 1 - k)] = 1;
    }
    this.g = new Float32Array(N);
    this.f = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.open = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.heap = new Int32Array(N);
    this.search = 0;
  }

  toCell(v) { return Math.max(0, Math.min(this.n - 1, Math.floor((v + this.half) / this.cell))); }
  center(i) { return (i + 0.5) * this.cell - this.half; }
  free(i, j) { return i >= 0 && j >= 0 && i < this.n && j < this.n && !this.grid[j * this.n + i]; }
  freeAt(x, z) { return this.free(this.toCell(x), this.toCell(z)); }

  nearestFree(x, z) {
    const ci = this.toCell(x), cj = this.toCell(z);
    if (this.free(ci, cj)) return { i: ci, j: cj };
    for (let r = 1; r < 16; r++) {
      for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
        if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
        if (this.free(ci + di, cj + dj)) return { i: ci + di, j: cj + dj };
      }
    }
    return null;
  }

  lineFree(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (this.cell * 0.5));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (!this.freeAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  findPath(sx, sz, tx, tz, maxIter = 14000) {
    const start = this.nearestFree(sx, sz), goal = this.nearestFree(tx, tz);
    if (!start || !goal) return null;
    const n = this.n;
    const s = start.j * n + start.i, gIdx = goal.j * n + goal.i;
    const id = ++this.search;
    const { g, f, parent, open, closed, heap } = this;
    let size = 0;
    const h = (idx) => {
      const dx = Math.abs((idx % n) - goal.i), dz = Math.abs(((idx / n) | 0) - goal.j);
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    const push = (idx) => {
      let i = size++;
      heap[i] = idx;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (f[heap[p]] <= f[heap[i]]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--size];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < size && f[heap[l]] < f[heap[m]]) m = l;
        if (r < size && f[heap[r]] < f[heap[m]]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
      return top;
    };
    g[s] = 0; f[s] = h(s); parent[s] = -1; open[s] = id;
    push(s);
    let iter = 0, found = false;
    while (size > 0 && iter++ < maxIter) {
      const cur = pop();
      if (closed[cur] === id) continue;
      closed[cur] = id;
      if (cur === gIdx) { found = true; break; }
      const ci = cur % n, cj = (cur / n) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!this.free(ni, nj)) continue;
        if (di && dj && (!this.free(ci + di, cj) || !this.free(ci, cj + dj))) continue;
        const nIdx = nj * n + ni;
        if (closed[nIdx] === id) continue;
        const ng = g[cur] + (di && dj ? Math.SQRT2 : 1);
        if (open[nIdx] === id && ng >= g[nIdx]) continue;
        open[nIdx] = id;
        g[nIdx] = ng;
        f[nIdx] = ng + h(nIdx);
        parent[nIdx] = cur;
        push(nIdx);
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = gIdx; c !== -1; c = parent[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => ({ x: this.center(c % n), z: this.center((c / n) | 0) }));
    const out = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      if (!this.lineFree(pts[anchor].x, pts[anchor].z, pts[i].x, pts[i].z)) {
        out.push(pts[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
}

// ------------------------------------------------------------------
// Bots
// ------------------------------------------------------------------
const NAMES = ['Viper', 'Havoc', 'Reaper', 'Nomad', 'Blitz', 'Onyx', 'Talon', 'Wraith', 'Sable', 'Ghost', 'Rook', 'Kestrel'];
const rand = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }

let botSeq = 0;

export class Bot {
  constructor(ai, diff, weapons) {
    this.ai = ai;
    this.id = `bot${++botSeq}`;
    this.name = NAMES[botSeq % NAMES.length];
    this.isBot = true;
    this.diff = diff;
    this.weapons = weapons;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.hp = 100;
    this.alive = false;
    this.kills = 0;
    this.deaths = 0;
    this.crouch = false;
    this.model = new Stickman(HOSTILE_COSMETIC);
    enhanceOperatorMaterials(this.model, resolveGraphicsConfig(settings.quality).operatorPbr);
    ai.scene.add(this.model.root);
    this.model.root.visible = false;
    this.lastShotAt = -99;
    this.turnSpeed = 2.5 + diff.trackRate * 2.8;
  }

  spawn(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.hp = 100;
    this.alive = true;
    this.crouch = false;
    this.weaponId = this.diff.weapons[Math.floor(Math.random() * this.diff.weapons.length)];
    this.weapon = this.weapons[this.weaponId];
    this.mag = this.weapon.magSize;
    this.reloadT = 0;
    this.fireCd = 0.5;
    this.burstLeft = 0;
    this.burstPause = 0;
    this.target = null;
    this.targetVisible = false;
    this.lastSeenPos = null;
    this.lastSeenAt = -99;
    this.reactT = 0;
    this.aimErr = this.diff.aimError;
    this.state = 'patrol';
    this.path = null;
    this.pathIdx = 0;
    this.pathPending = false;
    this.destReason = null;
    this.senseT = Math.random() * 0.2;
    this.strafeT = 0;
    this.strafeDir = 0;
    this.coverT = 0;
    this.lastDamageAt = -99;
    this.stuckT = 0;
    this.stuckRef = this.pos.clone();
    this.flankDecided = false;
    this.settle = 0;
    this.grenades = this.diff.grenades || 0;
    this.grenadeCd = rand(5, 10);
    this.meleeCd = 0;
    this.dodgeT = 0;
    this.model.setWeapon(this.weaponId);
    this.model.root.visible = true;
    this.model.root.position.copy(this.pos);
  }

  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + (this.crouch ? 1.1 : 1.6), this.pos.z); }

  onDamaged(attacker, now) {
    this.lastDamageAt = now;
    this.model.hitFlash();
    if (!attacker || attacker === this) return;
    if (!this.targetVisible || this.target !== attacker) {
      this.lastSeenPos = attacker.pos.clone();
      this.lastSeenAt = now;
      if (!this.targetVisible) {
        this.target = attacker;
        this.reactT = this.diff.reaction * rand(0.6, 1.0);
      }
    }
    if (this.hp < 55 && this.state !== 'cover' && Math.random() < this.diff.useCover) this.goCover(now);
  }

  hear(src, pos, now) {
    if (this.targetVisible || !this.alive || !src || src === this) return;
    if (this.pos.distanceTo(pos) > this.diff.hearing) return;
    if (Math.random() > 0.35 + this.diff.seekPlayer * 0.6) return;
    this.lastSeenPos = pos.clone();
    this.lastSeenAt = now;
    this.target = src;
  }

  goCover(now) {
    const threat = this.target?.alive ? this.target.pos : this.lastSeenPos;
    if (!threat) return;
    const ai = this.ai;
    const tEye = new THREE.Vector3(threat.x, threat.y + 1.5, threat.z);
    let best = null, bestScore = Infinity;
    for (const c of ai.map.coverPoints) {
      const d = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
      if (d > 18 || d < 1) continue;
      const dt = Math.hypot(c.x - threat.x, c.z - threat.z);
      if (dt < 7) continue;
      const toThreatX = threat.x - c.x, toThreatZ = threat.z - c.z;
      if (c.nx * toThreatX + c.nz * toThreatZ > 0) continue;
      const score = d + Math.random() * 3;
      if (score >= bestScore) continue;
      if (!ai.losClear(tEye, new THREE.Vector3(c.x, 0.9, c.z))) {
        best = c;
        bestScore = score;
      }
    }
    if (!best) return;
    this.state = 'cover';
    this.coverT = rand(1.4, 3.2) * (1.3 - this.diff.aggression * 0.5);
    this.coverPoint = best;
    ai.requestPath(this, best.x, best.z, 'cover');
  }

  sense(now) {
    const ai = this.ai;
    const eye = this.eye(ai._v1);
    let best = null, bestScore = Infinity;
    const halfFov = (this.diff.fov * Math.PI) / 360;
    for (const e of ai.entities) {
      if (e === this || !e.alive) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > this.diff.viewDist) continue;
      const recentlyHit = now - this.lastDamageAt < 1.5 && this.target === e;
      if (d > 5 && !recentlyHit && Math.abs(angDiff(yawTo(dx, dz), this.yaw)) > halfFov) continue;
      const head = ai._v2.set(e.pos.x, e.pos.y + (e.crouch ? 1.12 : 1.6), e.pos.z);
      let vis = ai.losClear(eye, head);
      if (!vis) {
        head.y = e.pos.y + (e.crouch ? 0.7 : 1.0);
        vis = ai.losClear(eye, head);
      }
      if (!vis) continue;
      let score = d * (e.isPlayer ? 1 - this.diff.seekPlayer * 0.45 : 1);
      if (e === this.target) score *= 0.65;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) {
      if (best !== this.target || !this.targetVisible) {
        const fresh = best !== this.target || now - this.lastSeenAt > 2;
        this.target = best;
        if (fresh) {
          this.reactT = this.diff.reaction * rand(0.8, 1.3);
          this.aimErr = this.diff.aimError * rand(1, 1.6);
          this.settle = this.weaponId === 'sniper' ? 0.5 + (1 - this.diff.trackRate / 2.4) * 0.6 : 0;
        }
      }
      this.targetVisible = true;
      this.lastSeenPos = best.pos.clone();
      this.lastSeenAt = now;
      this.flankDecided = false;
    } else {
      this.targetVisible = false;
    }
  }

  update(dt, now) {
    if (!this.alive) return;
    const diff = this.diff;
    const ai = this.ai;

    if (now - this.lastDamageAt > 5 && this.hp < 100) this.hp = Math.min(100, this.hp + 30 * dt);

    this.senseT -= dt;
    if (this.senseT <= 0) {
      this.senseT = 0.12 + Math.random() * 0.1;
      this.sense(now);
    }

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.mag = this.weapon.magSize;
    }
    this.fireCd -= dt;

    let moveX = 0, moveZ = 0, speed = diff.moveSpeed;
    let desiredYaw = this.yaw, desiredPitch = 0;
    let wantCrouch = false;
    const t = this.target;

    this.grenadeCd -= dt;
    this.meleeCd -= dt;
    for (const f of ai.game.fires) {
      if (this.dodgeT > 0 || Math.hypot(this.pos.x - f.x, this.pos.z - f.z) > f.r + 1.2) continue;
      this.dodgeT = 0.7;
      this.dodgeFrom = f;
    }
    for (const g of ai.game.liveGrenades) {
      if (g.owner === this || g.done) continue;
      g.seenBy ??= new Set();
      if (g.seenBy.has(this) || g.fuse - g.t > 2.3 || this.pos.distanceTo(g.pos) > 6.5) continue;
      g.seenBy.add(this);
      if (Math.random() < diff.dodgeGrenades) {
        this.dodgeT = Math.max(0.6, g.fuse - g.t + 0.25);
        this.dodgeFrom = g.pos;
      }
    }

    if (this.state === 'cover') {
      if (this.path && this.pathIdx < this.path.length) {
        [moveX, moveZ] = this.followPath();
        speed *= 1.35;
        desiredYaw = yawTo(moveX, moveZ);
      } else if (!this.pathPending) {
        wantCrouch = true;
        this.coverT -= dt;
        if (t && this.targetVisible) {
          desiredYaw = yawTo(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
        } else if (this.lastSeenPos) {
          desiredYaw = yawTo(this.lastSeenPos.x - this.pos.x, this.lastSeenPos.z - this.pos.z);
        }
        if (this.coverT <= 0 || this.hp > 85) { this.state = 'engage'; this.path = null; }
      }
      if (t && this.targetVisible && this.pos.distanceTo(t.pos) < 8) this.state = 'engage';
    }

    if (this.state !== 'cover') {
      if (t && t.alive && this.targetVisible) {
        this.state = 'engage';
        const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
        const dist = Math.hypot(dx, dz);
        desiredYaw = yawTo(dx, dz);
        const eyeY = this.pos.y + (this.crouch ? 1.1 : 1.6);
        desiredPitch = Math.atan2(t.pos.y + 1.1 - eyeY, dist);
        const ideal = this.weaponId === 'sniper' ? 35 : this.weaponId === 'pistol' ? 10 : 18;
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafeT = rand(0.5, 1.4);
          this.strafeDir = Math.random() < diff.strafe ? (Math.random() < 0.5 ? -1 : 1) : 0;
          this.combatCrouch = Math.random() < diff.useCover * 0.35;
        }
        const fx = dx / (dist || 1), fz = dz / (dist || 1);
        let approach = 0;
        if (dist > ideal * 1.3) approach = diff.aggression;
        else if (dist < ideal * 0.5 && this.weaponId === 'sniper') approach = -0.8;
        moveX = fx * approach + -fz * this.strafeDir;
        moveZ = fz * approach + fx * this.strafeDir;
        speed *= 0.65;
        wantCrouch = this.combatCrouch && !this.strafeDir;
        this.path = null;
      } else if (this.lastSeenPos && now - this.lastSeenAt < 6) {
        if (this.state !== 'hunt') {
          this.state = 'hunt';
          let tx = this.lastSeenPos.x, tz = this.lastSeenPos.z;
          if (!this.flankDecided && Math.random() < diff.flank) {
            const dx = this.pos.x - tx, dz = this.pos.z - tz;
            const d = Math.hypot(dx, dz) || 1;
            const side = Math.random() < 0.5 ? -1 : 1;
            const fx = tx + (-dz / d) * side * 11 + (dx / d) * 4;
            const fz = tz + (dx / d) * side * 11 + (dz / d) * 4;
            if (ai.nav.freeAt(fx, fz)) { tx = fx; tz = fz; }
          }
          this.flankDecided = true;
          ai.requestPath(this, tx, tz, 'hunt');
        }
        if (this.path && this.pathIdx < this.path.length) {
          [moveX, moveZ] = this.followPath();
          speed *= 1 + diff.aggression * 0.35;
          desiredYaw = yawTo(moveX, moveZ);
        } else if (!this.pathPending) {
          desiredYaw = yawTo(this.lastSeenPos.x - this.pos.x, this.lastSeenPos.z - this.pos.z);
          this.yaw += dt * 1.2;
        }
        if (this.grenades > 0 && this.grenadeCd <= 0 && now - this.lastSeenAt < 3.5 && t?.alive) {
          this.grenadeCd = 1.2;
          const d = this.pos.distanceTo(this.lastSeenPos);
          if (d > 7 && d < 30 && Math.random() < diff.grenadeChance) this.throwGrenade();
        }
      } else {
        if (this.state !== 'patrol') { this.state = 'patrol'; this.path = null; }
        if ((!this.path || this.pathIdx >= this.path.length) && !this.pathPending) this.pickPatrol();
        if (this.path && this.pathIdx < this.path.length) {
          [moveX, moveZ] = this.followPath();
          speed *= this.destReason === 'hunt-player' ? 0.9 + diff.aggression * 0.3 : 0.7;
          desiredYaw = yawTo(moveX, moveZ);
        }
      }
    }

    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      const ax = this.pos.x - this.dodgeFrom.x, az = this.pos.z - this.dodgeFrom.z;
      const al = Math.hypot(ax, az) || 1;
      moveX = ax / al;
      moveZ = az / al;
      speed = diff.moveSpeed * 1.5;
      wantCrouch = false;
    }

    const turn = this.turnSpeed * dt;
    const yd = angDiff(desiredYaw, this.yaw);
    this.yaw += Math.max(-turn, Math.min(turn, yd));
    this.pitch += (desiredPitch - this.pitch) * Math.min(1, dt * 6);
    this.crouch = wantCrouch;
    if (wantCrouch) speed *= 0.4;

    const ml = Math.hypot(moveX, moveZ);
    const tvx = ml > 0.01 ? (moveX / ml) * speed * Math.min(1, ml) : 0;
    const tvz = ml > 0.01 ? (moveZ / ml) * speed * Math.min(1, ml) : 0;
    const k = Math.min(1, dt * 8);
    this.vel.x += (tvx - this.vel.x) * k;
    this.vel.z += (tvz - this.vel.z) * k;

    for (const o of ai.bots) {
      if (o === this || !o.alive) continue;
      const sx = this.pos.x - o.pos.x, sz = this.pos.z - o.pos.z;
      const d2 = sx * sx + sz * sz;
      if (d2 < 1.2 && d2 > 1e-4) { const d = Math.sqrt(d2); this.vel.x += (sx / d) * 2; this.vel.z += (sz / d) * 2; }
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const blocked = ai.physics.resolveXZ(this.pos, 0.35, 1.7);
    this.pos.y = ai.physics.groundHeight(this.pos, 0.35);
    if (blocked && this.state === 'engage') this.strafeDir *= -1;

    this.stuckT += dt;
    if (this.stuckT > 1.5) {
      if (ml > 0.1 && this.pos.distanceTo(this.stuckRef) < 0.4 && this.state !== 'engage') {
        this.path = null;
        if (this.state === 'hunt') this.lastSeenAt = -99;
        if (this.state === 'cover') this.state = 'patrol';
      }
      this.stuckRef.copy(this.pos);
      this.stuckT = 0;
    }

    if (t && t.alive && this.targetVisible && this.state === 'engage') this.combat(dt, now, t, yd);
    else if (this.mag < this.weapon.magSize * 0.5 && this.reloadT <= 0) this.startReload();

    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.yaw;
    this.model.update(dt, { speed: hs, crouch: this.crouch ? 1 : 0, pitch: this.pitch, recoil: this.fireCd > 0 ? 0.05 : 0 });
  }

  startReload() {
    if (this.reloadT > 0) return;
    this.reloadT = this.weapon.reloadTime * (1.3 - this.diff.trackRate * 0.1);
  }

  combat(dt, now, t, yawErr) {
    const diff = this.diff;
    this.reactT -= dt;
    const floor = diff.aimError * 0.3;
    this.aimErr = Math.max(floor, this.aimErr * Math.exp(-diff.trackRate * dt));
    if (this.settle > 0) this.settle -= dt;
    if (this.reactT > 0 || this.settle > 0 || Math.abs(yawErr) > 0.25) return;
    if (this.meleeCd <= 0 && this.pos.distanceTo(t.pos) < 1.8) {
      this.meleeCd = 1.3;
      this.model.swing();
      this.ai.game.damageEntity(t, 100 * Math.min(1, diff.damageMult + 0.15), this, false, 'knife');
      return;
    }
    if (this.reloadT > 0) return;
    if (this.mag <= 0) { this.startReload(); return; }
    if (this.fireCd > 0) return;
    if (this.burstPause > 0) { this.burstPause -= dt; return; }
    if (this.burstLeft <= 0) {
      this.burstLeft = Math.round(rand(diff.burst[0], diff.burst[1]));
      if (!this.weapon.auto) this.burstLeft = Math.min(this.burstLeft, this.weaponId === 'sniper' ? 1 : 3);
    }
    this.fire(t, now);
    this.burstLeft--;
    this.fireCd = 1 / (this.weapon.fireRate * diff.fireRateMult);
    if (this.burstLeft <= 0) {
      const base = diff.id === 'hard' ? rand(0.15, 0.4) : diff.id === 'medium' ? rand(0.35, 0.8) : rand(0.8, 1.5);
      this.burstPause = this.weaponId === 'sniper' ? base + 1.2 : base;
    }
  }

  fire(t, now) {
    const ai = this.ai;
    this.mag--;
    this.lastShotAt = now;
    const eye = this.eye(new THREE.Vector3());
    const headChance = this.diff.id === 'hard' ? 0.3 : this.diff.id === 'medium' ? 0.15 : 0.05;
    const aimY = Math.random() < headChance ? (t.crouch ? 1.12 : 1.6) : (t.crouch ? 0.7 : 1.05);
    const tp = new THREE.Vector3(t.pos.x, t.pos.y + aimY, t.pos.z);
    const dir = tp.sub(eye).normalize();
    const tSpeed = t.vel ? Math.hypot(t.vel.x, t.vel.z) : 0;
    const err = this.aimErr + tSpeed * 0.006 * (1.4 - this.diff.trackRate * 0.3) + this.weapon.hipSpread * 0.15;
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const realUp = new THREE.Vector3().crossVectors(right, dir);
    dir.addScaledVector(right, gauss() * err).addScaledVector(realUp, gauss() * err).normalize();
    ai.game.entityShoot(this, eye, dir, this.weaponId, this.diff.damageMult);
  }

  throwGrenade() {
    const ai = this.ai;
    const type = this.diff.id !== 'normal' && Math.random() < (this.diff.id === 'hard' ? 0.45 : 0.3) ? 'molotov' : 'frag';
    const F = ai.game.catalog.equipment[type];
    const eye = this.eye(new THREE.Vector3());
    const err = this.diff.grenadeError;
    const aim = new THREE.Vector3(this.lastSeenPos.x + gauss() * err, this.lastSeenPos.y, this.lastSeenPos.z + gauss() * err);
    const dx = aim.x - eye.x, dz = aim.z - eye.z;
    const dist = Math.hypot(dx, dz);
    const short = type === 'frag' ? Math.min(2.5, dist * 0.12) : 0;
    aim.x -= (dx / dist) * short;
    aim.z -= (dz / dist) * short;
    const v = lobVelocity(eye, aim, F.speed + 4);
    if (!v) return;
    const len = Math.hypot(v.vx, v.vy, v.vz);
    const hit = raycastBoxes(ai.map.boxes, eye.x, eye.y, eye.z, v.vx / len, v.vy / len, v.vz / len, 1.5);
    if (hit && !hit.ground) return;
    this.grenades--;
    this.grenadeCd = rand(9, 16);
    this.yaw = yawTo(dx, dz);
    this.model.swing();
    ai.game.spawnGrenade({
      ox: eye.x, oy: eye.y, oz: eye.z, vx: v.vx, vy: v.vy, vz: v.vz, fuse: type === 'molotov' ? F.flight : F.fuse,
      owner: this, detonate: true, type,
    });
  }

  followPath() {
    const p = this.path[this.pathIdx];
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) {
      this.pathIdx++;
      if (this.pathIdx >= this.path.length) return [0, 0];
      return this.followPath();
    }
    return [dx / d, dz / d];
  }

  pickPatrol() {
    const ai = this.ai;
    const player = ai.entities.find((e) => e.isPlayer && e.alive);
    let x, z, reason = 'patrol';
    if (player && Math.random() < this.diff.seekPlayer * 0.7) {
      x = player.pos.x + rand(-10, 10);
      z = player.pos.z + rand(-10, 10);
      reason = 'hunt-player';
    } else if (Math.random() < 0.6) {
      const c = ai.map.coverPoints[Math.floor(Math.random() * ai.map.coverPoints.length)];
      x = c.x; z = c.z;
    } else {
      const lim = ai.map.HALF - 10;
      x = rand(-lim, lim); z = rand(-lim, lim);
    }
    ai.requestPath(this, x, z, reason);
  }

  kill() {
    this.alive = false;
    this.path = null;
    this.pathPending = false;
  }

  updateDead(dt) {
    this.model.update(dt, { dead: true });
  }

  dispose() {
    this.ai.scene.remove(this.model.root);
    this.model.dispose();
  }
}

export class BotAI {
  constructor(game, map, scene, physics) {
    this.game = game;
    this.map = map;
    this.scene = scene;
    this.physics = physics;
    this.nav = new NavGrid(map);
    this.bots = [];
    this.entities = [];
    this.queue = [];
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._d = new THREE.Vector3();
  }

  losClear(a, b) {
    const d = this._d.subVectors(b, a);
    const len = d.length();
    if (len < 0.01) return true;
    d.divideScalar(len);
    const hit = raycastBoxes(this.map.boxes, a.x, a.y, a.z, d.x, d.y, d.z, len);
    return !hit;
  }

  requestPath(bot, x, z, reason) {
    bot.pathPending = true;
    bot.destReason = reason;
    this.queue = this.queue.filter((q) => q.bot !== bot);
    this.queue.push({ bot, x, z });
  }

  update(dt, now) {
    for (let i = 0; i < 2 && this.queue.length; i++) {
      const { bot, x, z } = this.queue.shift();
      if (!bot.alive) continue;
      bot.path = this.nav.findPath(bot.pos.x, bot.pos.z, x, z);
      bot.pathIdx = bot.path && bot.path.length > 1 ? 1 : 0;
      bot.pathPending = false;
      if (!bot.path && bot.state === 'hunt') bot.lastSeenAt = -99;
    }
    for (const b of this.bots) {
      if (b.alive) b.update(dt, now);
      else b.updateDead(dt);
    }
  }

  onGunshot(src, pos, now) {
    for (const b of this.bots) if (b !== src) b.hear(src, pos, now);
  }

  clear() {
    for (const b of this.bots) b.dispose();
    this.bots = [];
    this.entities = [];
    this.queue = [];
  }
}
