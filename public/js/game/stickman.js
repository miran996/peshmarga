import * as THREE from 'three';
import { buildWeaponModel } from './weapons.js';
import { camoTexture, flagTexture } from './textures.js';

const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
const INK = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.8 });

/** Opposing-force kit used by single-player bots: urban camo and glowing red lenses. */
export const HOSTILE_COSMETIC = {
  id: 'hostile', name: 'Hostile',
  colors: { body: '#2a2b2d', limb: '#303235', accent: '#e0362c' },
  camo: { pattern: 'urban', colors: ['#3b3d40', '#2a2c2f', '#4d5054', '#1c1d1f'] },
  vest: '#1e1f22', helmet: '#2c2e31', balaclava: '#161718', gloves: '#1a1b1d', boots: '#1a1a1a', lens: '#e0362c', hostileGlow: true,
};

function capsule(r, len, material, outlineScale = 1.18) {
  const geo = new THREE.CapsuleGeometry(r, len, 6, 16);
  geo.translate(0, -len / 2 - r * 0.3, 0);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  const o = new THREE.Mesh(geo, OUTLINE);
  o.scale.set(outlineScale, 1.04, outlineScale);
  m.add(o);
  return m;
}

function joint(parent, x, y, z) {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

function gear(parent, geo, material, pos, rot, ink = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  if (ink) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), INK));
  parent.add(m);
  return m;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/**
 * Articulated stickman dressed as a special-forces operator. Faces -Z. Root sits at the feet.
 */
export class Stickman {
  constructor(cosmetic, weaponId = null) {
    this.root = new THREE.Group();
    this.phase = Math.random() * 10;
    this.crouch = 0;
    this.deadT = -1;
    this.flash = 0;
    this.cosmetic = null;
    this.flagId = null;
    this.weaponId = null;
    this.build();
    this.setCosmetic(cosmetic || HOSTILE_COSMETIC);
    if (weaponId) this.setWeapon(weaponId);
  }

  build() {
    this.bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    this.limbMat = this.bodyMat;
    this.vestMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    this.helmetMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 });
    this.faceMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    this.gloveMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
    this.bootMat = new THREE.MeshStandardMaterial({ roughness: 0.75 });
    this.lensMat = new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.7 });
    this.accentMat = new THREE.MeshStandardMaterial({ roughness: 0.4 });
    this.metalMat = new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.45, metalness: 0.6 });
    this.flagMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, transparent: true });

    const hips = joint(this.root, 0, 0.95, 0);
    this.hips = hips;
    const spine = joint(hips, 0, 0, 0);
    this.spine = spine;
    const torso = capsule(0.075, 0.42, this.bodyMat, 1.14);
    torso.rotation.x = Math.PI;
    torso.position.y = -0.02;
    spine.add(torso);

    // Plate carrier: front and back plates, cummerbund, mag pouches, radio and shoulder straps.
    const V = this.vestMat;
    gear(spine, B(0.2, 0.25, 0.05), V, [0, 0.29, -0.095]);
    gear(spine, B(0.2, 0.26, 0.045), V, [0, 0.3, 0.09]);
    for (const s of [-1, 1]) {
      gear(spine, B(0.035, 0.15, 0.15), V, [s * 0.095, 0.22, 0]);
      gear(spine, B(0.04, 0.014, 0.2), V, [s * 0.07, 0.43, 0], [0, 0, s * 0.2], false);
    }
    for (let i = 0; i < 3; i++) gear(spine, B(0.052, 0.075, 0.035), V, [(i - 1) * 0.062, 0.21, -0.135]);
    gear(spine, B(0.05, 0.1, 0.035), V, [0.075, 0.3, 0.125]);
    // Admin plate on the upper back (not covering the national patch).
    gear(spine, B(0.12, 0.04, 0.028), this.metalMat, [-0.02, 0.38, 0.118], null, false);
    this.backGear = new THREE.Group();
    spine.add(this.backGear);
    // National flag: large chest patch + left-shoulder IR tab (visible on every outfit).
    this.flagPatch = gear(spine, B(0.11, 0.072, 0.008), this.flagMat, [0.06, 0.34, -0.128], null, false);
    this.flagPatch.visible = false;
    this.flagSleeve = gear(spine, B(0.055, 0.038, 0.008), this.flagMat, [-0.118, 0.28, -0.02], [0, Math.PI / 2, 0], false);
    this.flagSleeve.visible = false;

    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), this.bodyMat);
    pelvis.castShadow = true;
    hips.add(pelvis);
    gear(hips, new THREE.CylinderGeometry(0.098, 0.098, 0.04, 16), V, [0, 0.03, 0], null, false);
    gear(hips, B(0.035, 0.1, 0.07), this.metalMat, [0.11, -0.07, -0.01]);

    // Head: balaclava, lens band, helmet with rails, ear cups, NVG mount with flipped-up tubes.
    this.neck = joint(spine, 0, 0.5, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 16), this.faceMat);
    head.position.y = 0.14;
    head.castShadow = true;
    const headOutline = new THREE.Mesh(head.geometry, OUTLINE);
    headOutline.scale.setScalar(1.09);
    head.add(headOutline);
    this.neck.add(head);
    this.head = head;
    gear(head, new THREE.TorusGeometry(0.128, 0.024, 6, 24, Math.PI * 0.72), this.lensMat, [0, 0.015, 0], [Math.PI / 2, 0, Math.PI * 1.14], false);
    const helmet = gear(head, new THREE.SphereGeometry(0.158, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), this.helmetMat, [0, 0.03, 0.01], null, false);
    helmet.scale.set(1, 0.92, 1.06);
    const helmetOutline = new THREE.Mesh(helmet.geometry, OUTLINE);
    helmetOutline.scale.setScalar(1.06);
    helmet.add(helmetOutline);
    for (const s of [-1, 1]) {
      gear(head, B(0.014, 0.03, 0.13), this.metalMat, [s * 0.153, 0.05, 0.01]);
      gear(head, new THREE.CylinderGeometry(0.048, 0.048, 0.035, 14), this.helmetMat, [s * 0.14, -0.01, 0.01], [0, 0, Math.PI / 2]);
    }
    gear(head, B(0.045, 0.03, 0.025), this.metalMat, [0, 0.12, -0.14]);
    const nvg = new THREE.Group();
    nvg.position.set(0, 0.15, -0.135);
    nvg.rotation.x = -1.05;
    head.add(nvg);
    for (const s of [-1, 1]) gear(nvg, new THREE.CylinderGeometry(0.018, 0.02, 0.08, 12), this.metalMat, [s * 0.026, 0.04, 0]);
    this.nvgLenses = [-1, 1].map((s) => gear(nvg, new THREE.CylinderGeometry(0.016, 0.016, 0.006, 12), this.lensMat, [s * 0.026, 0.083, 0], null, false));
    gear(head, B(0.07, 0.045, 0.035), this.metalMat, [0, 0.09, 0.16]);
    this.headGear = new THREE.Group();
    head.add(this.headGear);

    this.shoulderR = joint(spine, 0.16, 0.44, 0);
    this.shoulderL = joint(spine, -0.16, 0.44, 0);
    const shoulderBar = capsule(0.04, 0.32, this.bodyMat, 1.2);
    shoulderBar.rotation.z = Math.PI / 2;
    shoulderBar.position.set(-0.19, 0.44, 0);
    spine.add(shoulderBar);

    const arm = (shoulder) => {
      const upper = capsule(0.042, 0.27, this.bodyMat);
      shoulder.add(upper);
      const elbow = joint(shoulder, 0, -0.31, 0);
      const lower = capsule(0.038, 0.25, this.bodyMat);
      elbow.add(lower);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.047, 10, 8), this.gloveMat);
      hand.position.y = -0.3;
      elbow.add(hand);
      gear(elbow, new THREE.CylinderGeometry(0.043, 0.043, 0.04, 12), this.gloveMat, [0, -0.24, 0], null, false);
      return { elbow };
    };
    this.elbowR = arm(this.shoulderR).elbow;
    this.elbowL = arm(this.shoulderL).elbow;

    const leg = (x) => {
      const hip = joint(hips, x, -0.02, 0);
      hip.add(capsule(0.05, 0.4, this.bodyMat));
      gear(hip, B(0.03, 0.12, 0.09), V, [x > 0 ? 0.05 : -0.05, -0.2, -0.01]);
      const knee = joint(hip, 0, -0.45, 0);
      knee.add(capsule(0.045, 0.4, this.bodyMat));
      gear(knee, B(0.08, 0.1, 0.04), V, [0, -0.02, -0.045]);
      const foot = gear(knee, B(0.1, 0.07, 0.2), this.bootMat, [0, -0.45, -0.035]);
      foot.castShadow = true;
      gear(knee, new THREE.CylinderGeometry(0.052, 0.056, 0.1, 12), this.bootMat, [0, -0.39, 0], null, false);
      return { hip, knee };
    };
    const l = leg(-0.1), r = leg(0.1);
    this.hipL = l.hip; this.kneeL = l.knee;
    this.hipR = r.hip; this.kneeR = r.knee;

    this.weaponMount = joint(spine, 0.06, 0.34, -0.3);
  }

  setCosmetic(c) {
    if (!c) return;
    this.cosmetic = c;
    const camo = c.camo;
    this.bodyMat.map = camo ? camoTexture(camo) : null;
    this.bodyMat.color.set(camo ? '#ffffff' : c.colors.body);
    this.bodyMat.needsUpdate = true;
    this.vestMat.color.set(c.vest || c.colors.body);
    this.helmetMat.color.set(c.helmet || c.colors.body);
    this.faceMat.color.set(c.balaclava || c.colors.body);
    this.gloveMat.color.set(c.gloves || c.colors.limb);
    this.bootMat.color.set(c.boots || '#222');
    this.lensMat.color.set(c.lens || '#1c2326');
    this.accentMat.color.set(c.marker || c.insignia || c.colors.accent);
    const glowLens = !!(c.glow || c.hostileGlow);
    this.lensMat.emissive.set(glowLens ? c.lens : '#000000');
    this.lensMat.emissiveIntensity = glowLens ? 1.6 : 0;
    this.accentMat.emissive.set(c.marker ? c.marker : '#000000');
    this.accentMat.emissiveIntensity = c.marker ? (c.glow ? 1.8 : 1.1) : 0;
    this.baseEmissive = this.bodyMat.emissive.clone();

    for (const g of [this.headGear, this.backGear]) {
      g.traverse((o) => { if (o !== g && o.geometry) o.geometry.dispose(); });
      g.clear();
    }
    if (c.marker) gear(this.headGear, B(0.03, 0.02, 0.02), this.accentMat, [0, 0.14, 0.12], null, false);
    if (c.shemagh) {
      const sm = new THREE.MeshStandardMaterial({ color: c.shemagh, roughness: 0.95 });
      const scarf = gear(this.headGear, new THREE.TorusGeometry(0.1, 0.05, 8, 20), sm, [0, -0.14, 0], [Math.PI / 2, 0, 0], false);
      scarf.scale.set(1, 1, 0.8);
      gear(this.headGear, B(0.09, 0.22, 0.03), sm, [0.04, -0.26, 0.1], [0.3, 0, 0.2], false);
    }
    if (c.insignia) {
      // Gold rank tab on the RIGHT shoulder — left shoulder stays free for the national flag.
      const gold = new THREE.MeshStandardMaterial({ color: c.insignia, metalness: 0.8, roughness: 0.3 });
      gear(this.backGear, B(0.045, 0.03, 0.008), gold, [0.12, 0.3, -0.02], [0, -Math.PI / 2, 0], false);
    }
    if (c.antenna) {
      gear(this.backGear, new THREE.CylinderGeometry(0.005, 0.005, 0.55, 5), this.metalMat, [0.075, 0.62, 0.13], [0.12, 0, 0], false);
    }
    // Keep the equipped national flag on every outfit.
    if (this._flagDef) this.setFlag(this._flagDef);
  }

  /** National / regional patch on the plate carrier + shoulder. Pass null/none to clear. */
  setFlag(flag) {
    const id = flag?.id || 'none';
    this.flagId = id;
    this._flagDef = flag && id !== 'none' ? flag : null;
    const show = !!(this._flagDef?.stripes);
    if (!show) {
      this.flagPatch.visible = false;
      if (this.flagSleeve) this.flagSleeve.visible = false;
      this.flagMat.map = null;
      this.flagMat.needsUpdate = true;
      return;
    }
    this.flagMat.map = flagTexture(this._flagDef);
    this.flagMat.color.set('#ffffff');
    this.flagMat.needsUpdate = true;
    this.flagPatch.visible = true;
    if (this.flagSleeve) this.flagSleeve.visible = true;
  }

  setWeapon(id) {
    if (this.weaponId === id) return;
    this.weaponId = id;
    this.weaponMount.clear();
    const w = buildWeaponModel(id);
    w.group.scale.setScalar(1.1);
    this.weaponMount.add(w.group);
    this.muzzle = w.muzzle;
  }

  hitFlash() { this.flash = 1; }

  /** Coloured armbands so teammates and enemies can be told apart at a glance (null removes them). */
  setTeam(color) {
    if (this.bands) {
      for (const b of this.bands) b.parent.remove(b);
      this.bandMat.dispose();
      this.bands = null;
    }
    if (!color) return;
    this.bandMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.4 });
    const geo = new THREE.CylinderGeometry(0.052, 0.052, 0.07, 14);
    this.bands = [this.shoulderR, this.shoulderL].map((s) => {
      const band = new THREE.Mesh(geo, this.bandMat);
      band.position.y = -0.12;
      s.add(band);
      return band;
    });
  }

  /** Quick knife slash / throwing motion with the left arm, played over the normal pose. */
  swing() { this.swingT = 0.35; }

  /**
   * speed: horizontal m/s, crouch: 0..1, pitch: aim pitch (rad, +up), dead: bool
   */
  update(dt, { speed = 0, crouch = 0, pitch = 0, dead = false, recoil = 0 } = {}) {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
      this.bodyMat.emissive.setRGB(this.flash, this.flash, this.flash);
      this.vestMat.emissive.setRGB(this.flash * 0.6, this.flash * 0.6, this.flash * 0.6);
    } else if (this.baseEmissive) {
      this.bodyMat.emissive.copy(this.baseEmissive);
      this.vestMat.emissive.setRGB(0, 0, 0);
    }

    if (dead) {
      if (this.deadT < 0) this.deadT = 0;
      this.deadT = Math.min(1, this.deadT + dt * 2.6);
      const t = 1 - Math.pow(1 - this.deadT, 3);
      this.hips.rotation.x = t * -1.45;
      this.hips.position.y = 0.95 - t * 0.78;
      this.shoulderL.rotation.set(-t * 2.2, 0, t * 0.6);
      this.shoulderR.rotation.set(-t * 2.4, 0, -t * 0.5);
      this.hipL.rotation.x = t * 0.5; this.hipR.rotation.x = t * 0.2;
      this.kneeL.rotation.x = -t * 0.4; this.kneeR.rotation.x = -t * 0.1;
      this.weaponMount.visible = this.deadT < 0.4;
      return;
    }
    if (this.deadT >= 0) {
      this.deadT = -1;
      this.hips.rotation.set(0, 0, 0);
      this.weaponMount.visible = true;
    }

    this.crouch += (crouch - this.crouch) * Math.min(1, dt * 10);
    const c = this.crouch;
    const moveAmt = Math.min(1, speed / 5);
    this.phase += dt * (3 + speed * 1.7);
    const s = Math.sin(this.phase), co = Math.cos(this.phase);
    const swing = 0.75 * moveAmt * (1 - c * 0.5);

    this.hips.position.y = 0.95 - c * 0.36 + Math.abs(co) * 0.04 * moveAmt;
    this.hips.rotation.y = s * 0.08 * moveAmt;
    this.hipL.rotation.x = s * swing + c * 1.25;
    this.hipR.rotation.x = -s * swing + c * 1.25;
    this.kneeL.rotation.x = -Math.max(0, -s) * 1.1 * moveAmt - c * 2.1;
    this.kneeR.rotation.x = -Math.max(0, s) * 1.1 * moveAmt - c * 2.1;

    this.spine.rotation.x = -0.08 - c * 0.25 - moveAmt * 0.06;
    this.spine.rotation.y = -this.hips.rotation.y;
    this.neck.rotation.x = -pitch * 0.5;

    const aim = pitch * 0.85 + recoil;
    this.shoulderR.rotation.set(0.5 + aim, 0, -0.3);
    this.elbowR.rotation.set(2.2, 0, 0);
    this.shoulderL.rotation.set(1.5 + aim, 0, 0.6);
    this.elbowL.rotation.set(0.15, 0, 0);
    const oy = 0.09, oz = -0.45, ca = Math.cos(aim), sa = Math.sin(aim);
    this.weaponMount.position.set(0.1, 0.44 + oy * ca - oz * sa, oy * sa + oz * ca);
    this.weaponMount.rotation.x = aim;
    if (this.swingT > 0) {
      this.swingT -= dt;
      const k = Math.sin(Math.PI * (1 - this.swingT / 0.35));
      this.shoulderL.rotation.set(1.5 + aim + k * 0.9, k * 0.8, 0.6 - k * 0.9);
      this.elbowL.rotation.set(0.15 + k * 0.6, 0, 0);
      this.spine.rotation.y += k * 0.35;
    }
    if (this.cosmetic?.glow && this.accentMat.emissiveIntensity) {
      this.accentMat.emissiveIntensity = Math.sin(this.phase * 2.2) > 0.6 ? 2.2 : 0.3;
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
    for (const m of [this.bodyMat, this.vestMat, this.helmetMat, this.faceMat, this.gloveMat, this.bootMat, this.lensMat, this.accentMat, this.metalMat, this.flagMat]) m.dispose();
    this.bandMat?.dispose();
  }
}
