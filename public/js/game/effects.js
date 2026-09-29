import * as THREE from 'three';
import { buildRocketModel } from './weapons.js';

class Particles {
  constructor(scene, count, color, size, emissive = false) {
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = emissive
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshStandardMaterial({ color, roughness: 1 });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count);
    this.gravity = new Float32Array(count);
    this.next = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
    this.p = new THREE.Vector3();
    this.e = new THREE.Euler();
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
  }

  emit(x, y, z, vx, vy, vz, life, gravity = 9.8) {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.gravity[i] = gravity;
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= this.gravity[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.02) { this.pos[k + 1] = 0.02; this.vel[k] *= 0.5; this.vel[k + 1] *= -0.2; this.vel[k + 2] *= 0.5; }
      const sc = this.life[i] > 0 ? Math.min(1, (this.life[i] / this.max[i]) * 2) : 0;
      this.e.set(i + this.life[i] * 7, i * 0.3, 0);
      this.q.setFromEuler(this.e);
      this.s.setScalar(sc);
      this.p.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.dust = new Particles(scene, 300, '#9d9384', 0.06);
    this.ink = new Particles(scene, 300, '#050505', 0.07);
    this.sparks = new Particles(scene, 150, '#ffcf6a', 0.025, true);

    this.tracers = [];
    const tracerGeo = new THREE.BoxGeometry(0.018, 0.018, 1).translate(0, 0, -0.5);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
        color: '#ffe0a0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false;
      m.userData.life = 0;
      scene.add(m);
      this.tracers.push(m);
    }
    this.tracerIdx = 0;

    const decalTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      grad.addColorStop(0, 'rgba(0,0,0,0.95)');
      grad.addColorStop(0.35, 'rgba(10,8,6,0.7)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const decalMat = new THREE.MeshBasicMaterial({
      map: decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    });
    const decalGeo = new THREE.PlaneGeometry(0.16, 0.16);
    this.decals = [];
    for (let i = 0; i < 90; i++) {
      const d = new THREE.Mesh(decalGeo, decalMat);
      d.visible = false;
      scene.add(d);
      this.decals.push(d);
    }
    this.decalIdx = 0;

    const flashTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      g.translate(64, 64);
      for (let i = 0; i < 6; i++) {
        g.rotate(Math.PI / 3);
        const grad = g.createLinearGradient(0, 0, 60, 0);
        grad.addColorStop(0, 'rgba(255,245,210,1)');
        grad.addColorStop(1, 'rgba(255,150,40,0)');
        g.fillStyle = grad;
        g.beginPath(); g.moveTo(0, -7); g.lineTo(62, 0); g.lineTo(0, 7); g.fill();
      }
      const r = g.createRadialGradient(0, 0, 0, 0, 0, 30);
      r.addColorStop(0, 'rgba(255,255,230,1)');
      r.addColorStop(1, 'rgba(255,180,60,0)');
      g.fillStyle = r;
      g.fillRect(-64, -64, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    this.flashMat = new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.worldFlashes = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(this.flashMat.clone());
      s.visible = false;
      s.userData.life = 0;
      scene.add(s);
      this.worldFlashes.push(s);
    }
    this.flashIdx = 0;

    const radial = (inner, outer) => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, inner);
      grad.addColorStop(1, outer);
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    };
    const fireTex = radial('rgba(255,240,200,1)', 'rgba(255,120,20,0)');
    const smokeTex = radial('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
    this.fireballs = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, color: '#ffb35c', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      s.userData = { life: 0, max: 1, size: 1 };
      scene.add(s);
      this.fireballs.push(s);
    }
    this.smokePuffs = [];
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: '#2f2b28', depthWrite: false, transparent: true, opacity: 0 }));
      s.visible = false;
      s.userData = { life: 0, max: 1, size: 1, vx: 0, vy: 0, vz: 0 };
      scene.add(s);
      this.smokePuffs.push(s);
    }
    this.fireIdx = 0;
    this.smokeIdx = 0;
    this.boomLights = [0, 1].map(() => {
      const l = new THREE.PointLight('#ffae5c', 0, 22, 2);
      scene.add(l);
      return l;
    });
    this.boomIdx = 0;
    const scorchMat = new THREE.MeshBasicMaterial({
      map: radial('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4,
    });
    this.scorches = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), scorchMat);
      m.visible = false;
      scene.add(m);
      this.scorches.push(m);
    }
    this.scorchIdx = 0;
    this.jets = [];
    this.smokeTex = smokeTex;
    this.fireTex = fireTex;
    this.glass = new Particles(scene, 60, '#9fd1c4', 0.03, true);

    this.flames = [];
    for (let i = 0; i < 90; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, color: '#ff9a3c', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      s.userData = { fire: null };
      scene.add(s);
      this.flames.push(s);
    }
    this.fireLights = [0, 1].map(() => {
      const l = new THREE.PointLight('#ff8a3a', 0, 14, 2);
      scene.add(l);
      return l;
    });
    this.fires = [];
    this.rockets = [];
  }

  /** Burning pool of fuel: flickering flames, heat light, smoke. `duration` in seconds. */
  fireArea(pos, radius, duration) {
    const f = { pos: pos.clone(), r: radius, life: duration, max: duration, smokeT: 0, sprites: [], light: null };
    const free = this.flames.filter((s) => !s.visible).slice(0, 26);
    for (const s of free) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * radius * 0.9;
      s.userData = { fire: f, ox: Math.cos(a) * rr, oz: Math.sin(a) * rr, ph: Math.random() * 10, size: 0.6 + Math.random() * 0.9 };
      s.visible = true;
      f.sprites.push(s);
    }
    f.light = this.fireLights.find((l) => l.intensity === 0 && !l.userData.busy) || null;
    if (f.light) { f.light.userData.busy = true; f.light.position.set(pos.x, pos.y + 1, pos.z); }
    const sc = this.scorches[this.scorchIdx];
    this.scorchIdx = (this.scorchIdx + 1) % this.scorches.length;
    sc.position.set(pos.x, pos.y + 0.02, pos.z);
    sc.scale.setScalar(radius * 2.3);
    sc.visible = true;
    this.fires.push(f);
    return f;
  }

  glassBurst(pos) {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 4;
      this.glass.emit(pos.x, pos.y + 0.1, pos.z, Math.cos(a) * v, 1 + Math.random() * 4, Math.sin(a) * v, 0.4 + Math.random() * 0.4);
    }
  }

  /** Visible rocket with flame and smoke trail; the caller moves it via `pos`/`dir` and calls removeRocket. */
  addRocket(pos, dir) {
    const mesh = buildRocketModel();
    mesh.position.copy(pos);
    mesh.lookAt(pos.clone().add(dir));
    mesh.rotateY(Math.PI);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.fireTex, color: '#ffc27a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    flame.scale.setScalar(0.7);
    this.scene.add(mesh, flame);
    const r = { mesh, flame, trailT: 0 };
    this.rockets.push(r);
    return r;
  }

  moveRocket(r, pos, dir, dt) {
    r.mesh.position.copy(pos);
    r.mesh.lookAt(pos.clone().add(dir));
    r.mesh.rotateY(Math.PI);
    r.flame.position.copy(pos).addScaledVector(dir, -0.35);
    r.flame.material.rotation = Math.random() * Math.PI;
    r.flame.scale.setScalar(0.55 + Math.random() * 0.35);
    r.trailT -= dt;
    while (r.trailT <= 0) {
      r.trailT += 0.018;
      const s = this.smokePuffs[this.smokeIdx];
      this.smokeIdx = (this.smokeIdx + 1) % this.smokePuffs.length;
      s.position.copy(pos).addScaledVector(dir, -0.5 - Math.random() * 0.3);
      s.userData = { life: 1.4, max: 1.4, size: 0.5 + Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.4, vy: 0.3, vz: (Math.random() - 0.5) * 0.4 };
      s.material.color.set('#8d8a86');
      s.visible = true;
    }
  }

  removeRocket(r) {
    this.scene.remove(r.mesh, r.flame);
    r.mesh.traverse((o) => o.geometry?.dispose());
    r.flame.material.dispose();
    const i = this.rockets.indexOf(r);
    if (i >= 0) this.rockets.splice(i, 1);
  }

  /** Muzzle backblast smoke for launchers. */
  backblast(pos, dir) {
    for (let i = 0; i < 6; i++) {
      const s = this.smokePuffs[this.smokeIdx];
      this.smokeIdx = (this.smokeIdx + 1) % this.smokePuffs.length;
      s.position.copy(pos).addScaledVector(dir, -1 - i * 0.3);
      s.userData = { life: 1.6, max: 1.6, size: 0.9 + Math.random() * 0.6, vx: -dir.x * 2, vy: 0.4, vz: -dir.z * 2 };
      s.material.color.set('#9a958f');
      s.visible = true;
    }
  }

  /** Fireball, smoke, debris, light flash and a scorch mark on the ground. */
  explosion(pos, scale = 1) {
    for (let i = 0; i < 3; i++) {
      const s = this.fireballs[this.fireIdx];
      this.fireIdx = (this.fireIdx + 1) % this.fireballs.length;
      s.position.set(pos.x + (Math.random() - 0.5) * scale, pos.y + 0.5 + Math.random() * scale * 0.8, pos.z + (Math.random() - 0.5) * scale);
      s.userData = { life: 0.35 + i * 0.08, max: 0.35 + i * 0.08, size: (2.6 + i) * scale };
      s.material.rotation = Math.random() * Math.PI;
      s.visible = true;
    }
    for (let i = 0; i < 9; i++) {
      const s = this.smokePuffs[this.smokeIdx];
      this.smokeIdx = (this.smokeIdx + 1) % this.smokePuffs.length;
      const a = Math.random() * Math.PI * 2, r = Math.random() * scale;
      s.position.set(pos.x + Math.cos(a) * r, pos.y + 0.4 + Math.random() * 0.8, pos.z + Math.sin(a) * r);
      const life = 2.2 + Math.random() * 1.6;
      s.userData = {
        life, max: life, size: (1.6 + Math.random() * 1.6) * scale,
        vx: Math.cos(a) * 1.4 * scale, vy: 1.2 + Math.random() * 1.4, vz: Math.sin(a) * 1.4 * scale,
      };
      s.material.color.set(Math.random() < 0.5 ? '#2f2b28' : '#4a4540');
      s.visible = true;
    }
    for (let i = 0; i < 26 * scale; i++) {
      const a = Math.random() * Math.PI * 2, up = Math.random();
      const v = 4 + Math.random() * 7;
      this.dust.emit(pos.x, pos.y + 0.2, pos.z, Math.cos(a) * v * (1 - up * 0.5), 3 + up * 8, Math.sin(a) * v * (1 - up * 0.5), 0.8 + Math.random() * 0.8);
    }
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 6 + Math.random() * 10;
      this.sparks.emit(pos.x, pos.y + 0.3, pos.z, Math.cos(a) * v, 2 + Math.random() * 9, Math.sin(a) * v, 0.3 + Math.random() * 0.5, 12);
    }
    const l = this.boomLights[this.boomIdx];
    this.boomIdx = (this.boomIdx + 1) % this.boomLights.length;
    l.position.set(pos.x, pos.y + 1.5, pos.z);
    l.intensity = 60 * scale;
    const sc = this.scorches[this.scorchIdx];
    this.scorchIdx = (this.scorchIdx + 1) % this.scorches.length;
    sc.position.set(pos.x, pos.y + 0.02, pos.z);
    sc.scale.setScalar(3.2 * scale);
    sc.rotation.y = Math.random() * Math.PI;
    sc.visible = true;
  }

  /** A jet silhouette crossing the sky from `from` to `to` over `duration` seconds. */
  jetFlyby(from, to, duration) {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: '#23262b', roughness: 0.6, metalness: 0.3 });
    const ink = new THREE.LineBasicMaterial({ color: 0x000000 });
    const add = (geo, pos) => {
      const m = new THREE.Mesh(geo, dark);
      m.position.set(...pos);
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), ink));
      g.add(m);
    };
    add(new THREE.BoxGeometry(1.0, 0.9, 8), [0, 0, 0]);
    add(new THREE.BoxGeometry(0.6, 0.5, 2).translate(0, 0, -5), [0, 0.05, 0]);
    add(new THREE.BoxGeometry(9, 0.14, 2.4), [0, -0.1, 0.6]);
    add(new THREE.BoxGeometry(3.4, 0.12, 1.2), [0, 0.05, 3.6]);
    add(new THREE.BoxGeometry(0.14, 1.8, 1.4), [0, 1.1, 3.4]);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12), new THREE.MeshBasicMaterial({ color: '#ffb35c' }));
    glow.position.set(0, 0, 4.02);
    g.add(glow);
    g.position.copy(from);
    g.lookAt(to);
    g.rotateY(Math.PI);
    this.scene.add(g);
    this.jets.push({ g, from: from.clone(), to: to.clone(), t: 0, duration });
  }

  tracer(from, to, bright = 1) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    t.position.copy(from);
    t.lookAt(to);
    t.scale.set(1, 1, len);
    t.visible = true;
    t.material.opacity = 0.8 * bright;
    t.userData.life = 0.07;
  }

  impact(point, normal, kind = 'dust') {
    const n = normal || new THREE.Vector3(0, 1, 0);
    if (kind === 'ink') {
      for (let i = 0; i < 14; i++) {
        this.ink.emit(point.x, point.y, point.z,
          (Math.random() - 0.5) * 3 + n.x * 2, Math.random() * 3, (Math.random() - 0.5) * 3 + n.z * 2, 0.5 + Math.random() * 0.4);
      }
      return;
    }
    for (let i = 0; i < 7; i++) {
      this.dust.emit(point.x, point.y, point.z,
        n.x * 2 + (Math.random() - 0.5) * 2, n.y * 2 + Math.random() * 1.5, n.z * 2 + (Math.random() - 0.5) * 2, 0.4 + Math.random() * 0.4);
    }
    for (let i = 0; i < 4; i++) {
      this.sparks.emit(point.x, point.y, point.z,
        n.x * 4 + (Math.random() - 0.5) * 4, n.y * 4 + Math.random() * 3, n.z * 4 + (Math.random() - 0.5) * 4, 0.15 + Math.random() * 0.15, 12);
    }
    const d = this.decals[this.decalIdx];
    this.decalIdx = (this.decalIdx + 1) % this.decals.length;
    d.position.copy(point).addScaledVector(n, 0.012);
    d.lookAt(d.position.x + n.x, d.position.y + n.y, d.position.z + n.z);
    d.rotateZ(Math.random() * Math.PI);
    d.scale.setScalar(0.7 + Math.random() * 0.6);
    d.visible = true;
  }

  muzzleFlash(pos, size = 0.5) {
    const s = this.worldFlashes[this.flashIdx];
    this.flashIdx = (this.flashIdx + 1) % this.worldFlashes.length;
    s.position.copy(pos);
    s.scale.setScalar(size);
    s.material.rotation = Math.random() * Math.PI;
    s.visible = true;
    s.userData.life = 0.05;
  }

  update(dt) {
    this.dust.update(dt);
    this.ink.update(dt);
    this.sparks.update(dt);
    for (const t of this.tracers) {
      if (!t.visible) continue;
      t.userData.life -= dt;
      t.material.opacity *= 0.7;
      if (t.userData.life <= 0) t.visible = false;
    }
    for (const s of this.worldFlashes) {
      if (!s.visible) continue;
      s.userData.life -= dt;
      if (s.userData.life <= 0) s.visible = false;
    }
    for (const s of this.fireballs) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life -= dt;
      if (u.life <= 0) { s.visible = false; continue; }
      const k = 1 - u.life / u.max;
      s.scale.setScalar(u.size * (0.4 + k * 0.9));
      s.material.opacity = 1 - k * k;
    }
    for (const s of this.smokePuffs) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life -= dt;
      if (u.life <= 0) { s.visible = false; continue; }
      const k = 1 - u.life / u.max;
      u.vx *= 1 - dt * 1.5; u.vz *= 1 - dt * 1.5; u.vy *= 1 - dt * 0.6;
      s.position.x += u.vx * dt; s.position.y += u.vy * dt; s.position.z += u.vz * dt;
      s.scale.setScalar(u.size * (0.6 + k * 1.6));
      s.material.opacity = 0.75 * Math.min(1, k * 8) * (1 - k);
    }
    for (const l of this.boomLights) if (l.intensity > 0) l.intensity = Math.max(0, l.intensity - dt * 220);
    this.glass.update(dt);
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.life -= dt;
      const k = Math.min(1, f.life / 1.2, (f.max - f.life) / 0.3 + 0.2);
      for (const s of f.sprites) {
        const u = s.userData;
        u.ph += dt * (4 + Math.random() * 3);
        const h = u.size * (0.8 + Math.sin(u.ph) * 0.25) * k;
        s.position.set(f.pos.x + u.ox, f.pos.y + h * 0.45, f.pos.z + u.oz);
        s.scale.set(h * 0.8, h * 1.3, 1);
        s.material.rotation = Math.sin(u.ph * 0.7) * 0.2;
        s.material.opacity = 0.85 * k;
      }
      if (f.light) f.light.intensity = Math.max(0, k) * (22 + Math.random() * 10);
      f.smokeT -= dt;
      if (f.smokeT <= 0 && f.life > 0.5) {
        f.smokeT = 0.12;
        const s = this.smokePuffs[this.smokeIdx];
        this.smokeIdx = (this.smokeIdx + 1) % this.smokePuffs.length;
        const a = Math.random() * Math.PI * 2, rr = Math.random() * f.r * 0.7;
        s.position.set(f.pos.x + Math.cos(a) * rr, f.pos.y + 1, f.pos.z + Math.sin(a) * rr);
        s.userData = { life: 2.5, max: 2.5, size: 1.2 + Math.random(), vx: 0.2, vy: 1.6, vz: 0.1 };
        s.material.color.set('#1f1c1a');
        s.visible = true;
      }
      if (f.life <= 0) {
        for (const s of f.sprites) { s.visible = false; s.userData.fire = null; }
        if (f.light) { f.light.intensity = 0; f.light.userData.busy = false; }
        this.fires.splice(i, 1);
      }
    }
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i];
      j.t += dt;
      j.g.position.lerpVectors(j.from, j.to, Math.min(1, j.t / j.duration));
      if (j.t >= j.duration) {
        this.scene.remove(j.g);
        j.g.traverse((o) => { o.geometry?.dispose(); });
        this.jets.splice(i, 1);
      }
    }
  }

  clear() {
    this.decals.forEach((d) => (d.visible = false));
    this.scorches.forEach((d) => (d.visible = false));
    for (const f of this.fires) f.life = 0;
    for (const r of [...this.rockets]) this.removeRocket(r);
  }
}
