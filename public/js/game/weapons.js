import * as THREE from 'three';
import { camoTexture } from './textures.js';
import { WEAPON_ASSETS, loadGltf, cloneGltf } from '../graphics/gltf.js';

const INK = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.85 });
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, ...opts }));
  }
  return matCache.get(key);
}

function part(group, geo, material, pos, rot, outline = true) {
  const m = new THREE.Mesh(geo, typeof material === 'string' ? mat(material) : material);
  m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true;
  group.add(m);
  if (outline) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), INK));
  return m;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const C = (r, len, seg = 14) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);
const TUBE = (r, len) => new THREE.CylinderGeometry(r, r, len, 20, 1, true).rotateX(Math.PI / 2);
const CONE = (r0, r1, len) => new THREE.CylinderGeometry(r0, r1, len, 16).rotateX(Math.PI / 2);

const STEEL = mat('#3a3d42', { metalness: 0.65, roughness: 0.38 });
const GUNMETAL = mat('#2b2e33', { metalness: 0.55, roughness: 0.45 });
const POLY = mat('#1f2124', { metalness: 0.05, roughness: 0.75 });
const FDE = mat('#8a7a5a', { metalness: 0.05, roughness: 0.8 });
const OD = mat('#4b5237', { metalness: 0.05, roughness: 0.8 });
const WOOD = mat('#6b4a2e', { metalness: 0, roughness: 0.7 });
const LENS = mat('#16252e', { metalness: 0.9, roughness: 0.08 });
const TUBE_MAT = new THREE.MeshStandardMaterial({ color: '#23262a', metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide });
const RED_DOT = new THREE.MeshBasicMaterial({ color: '#ff3b2e' });
const HOLO_WINDOW = new THREE.MeshStandardMaterial({
  color: '#1a3038', metalness: 0.2, roughness: 0.15, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
});

/** Compact tube red-dot (Aimpoint-style). Returns sightY for ADS. */
function mountRedDot(g, y, z = 0, scale = 1) {
  const s = scale;
  part(g, B(0.028 * s, 0.012 * s, 0.05 * s), GUNMETAL, [0, y - 0.01 * s, z]);
  part(g, C(0.014 * s, 0.055 * s), GUNMETAL, [0, y, z]);
  part(g, C(0.016 * s, 0.01 * s), GUNMETAL, [0, y, z - 0.028 * s], null, false);
  part(g, C(0.012 * s, 0.004 * s), LENS, [0, y, z - 0.03 * s], null, false);
  part(g, C(0.0022 * s, 0.002 * s), RED_DOT, [0, y, z - 0.01 * s], null, false);
  part(g, B(0.006 * s, 0.014 * s, 0.01 * s), GUNMETAL, [0.016 * s, y, z], null, false);
  return y;
}

/** Open holographic window (EOTech-style). Returns sightY for ADS. */
function mountHolo(g, y, z = 0, scale = 1) {
  const s = scale;
  part(g, B(0.05 * s, 0.014 * s, 0.07 * s), GUNMETAL, [0, y - 0.028 * s, z]);
  part(g, B(0.012 * s, 0.055 * s, 0.012 * s), GUNMETAL, [-0.022 * s, y, z + 0.022 * s]);
  part(g, B(0.012 * s, 0.055 * s, 0.012 * s), GUNMETAL, [0.022 * s, y, z + 0.022 * s]);
  part(g, B(0.056 * s, 0.012 * s, 0.012 * s), GUNMETAL, [0, y + 0.028 * s, z + 0.022 * s]);
  part(g, B(0.048 * s, 0.048 * s, 0.004 * s), HOLO_WINDOW, [0, y, z + 0.018 * s], null, false);
  part(g, B(0.04 * s, 0.028 * s, 0.05 * s), GUNMETAL, [0, y - 0.008 * s, z - 0.02 * s]);
  part(g, C(0.003 * s, 0.002 * s), RED_DOT, [0, y + 0.004 * s, z + 0.016 * s], null, false);
  return y;
}

/**
 * Weapon models point down -Z. Returns { group, muzzle, sightY, grip, support, warhead? }.
 * When a Poly Haven glTF exists for the id, procedural meshes are swapped out after load.
 */
export function buildWeaponModel(id) {
  const g = new THREE.Group();
  const visual = new THREE.Group();
  visual.name = 'weapon-visual';
  g.add(visual);
  const muzzle = new THREE.Object3D();
  let sightY = 0.05, grip = [0, -0.06, 0.05], support = [0, -0.04, -0.2], warhead = null;

  // Build into `visual` so we can clear it when HD glTF arrives.
  const partV = (geo, material, pos, rot, outline = true) => part(visual, geo, material, pos, rot, outline);
  const mountRedDotV = (...a) => mountRedDot(visual, ...a);
  const mountHoloV = (...a) => mountHolo(visual, ...a);

  switch (id) {
    case 'pistol': {
      partV(B(0.03, 0.032, 0.19), STEEL, [0, 0.022, -0.02]);
      for (let i = 0; i < 4; i++) {
        for (const s of [-1, 1]) partV(B(0.002, 0.024, 0.004), POLY, [s * 0.0155, 0.022, 0.045 + i * 0.008], null, false);
      }
      partV(B(0.028, 0.02, 0.16), POLY, [0, -0.002, -0.03]);
      partV(B(0.02, 0.01, 0.05), POLY, [0, -0.013, -0.08]);
      partV(B(0.029, 0.1, 0.042), POLY, [0, -0.058, 0.05], [0.22, 0, 0]);
      partV(B(0.03, 0.012, 0.045), POLY, [0, -0.108, 0.062], [0.22, 0, 0], false);
      partV(B(0.006, 0.026, 0.034), POLY, [0, -0.022, -0.005], null, false);
      partV(B(0.006, 0.01, 0.008), GUNMETAL, [0, 0.043, -0.105], null, false);
      partV(B(0.022, 0.01, 0.01), GUNMETAL, [0, 0.043, 0.065], null, false);
      partV(C(0.007, 0.012), GUNMETAL, [0, 0.022, -0.116], null, false);
      sightY = mountRedDotV(0.058, 0.02, 0.72);
      muzzle.position.set(0, 0.022, -0.125);
      grip = [0, -0.06, 0.06]; support = [-0.01, -0.07, 0.04];
      break;
    }
    case 'autorifle': {
      const SY = 0.086;
      partV(B(0.048, 0.052, 0.21), GUNMETAL, [0, 0.012, 0]);
      partV(B(0.044, 0.045, 0.15), GUNMETAL, [0, -0.03, 0.03]);
      partV(B(0.036, 0.05, 0.06), GUNMETAL, [0, -0.06, -0.035]);
      partV(B(0.03, 0.09, 0.058), FDE, [0, -0.11, -0.04], [0.12, 0, 0]);
      partV(B(0.03, 0.06, 0.056), FDE, [0, -0.17, -0.026], [0.32, 0, 0]);
      partV(B(0.032, 0.085, 0.04), POLY, [0, -0.07, 0.075], [0.35, 0, 0]);
      partV(B(0.008, 0.006, 0.05), POLY, [0, -0.058, 0.03], null, false);
      partV(C(0.014, 0.12), GUNMETAL, [0, 0.004, 0.16]);
      partV(B(0.042, 0.068, 0.11), FDE, [0, -0.008, 0.24]);
      partV(B(0.044, 0.075, 0.014), POLY, [0, -0.01, 0.3]);
      partV(B(0.05, 0.052, 0.24), POLY, [0, 0.01, -0.225]);
      for (let i = 0; i < 4; i++) {
        for (const s of [-1, 1]) partV(B(0.002, 0.012, 0.03), GUNMETAL, [s * 0.0255, 0.01, -0.14 - i * 0.05], null, false);
      }
      partV(B(0.022, 0.01, 0.44), GUNMETAL, [0, 0.042, -0.1]);
      partV(C(0.009, 0.06), STEEL, [0, 0.01, -0.37]);
      partV(C(0.019, 0.17), POLY, [0, 0.01, -0.48]);
      partV(C(0.02, 0.012), GUNMETAL, [0, 0.01, -0.568], null, false);
      partV(B(0.03, 0.008, 0.02), GUNMETAL, [0, 0.032, 0.1], null, false);
      partV(B(0.026, 0.04, 0.035), POLY, [0, -0.034, -0.25], [-0.4, 0, 0]);
      partV(B(0.024, 0.02, 0.05), GUNMETAL, [0, 0.056, -0.01]);
      partV(TUBE(0.021, 0.12), TUBE_MAT, [0, SY, -0.01]);
      partV(TUBE(0.025, 0.035), TUBE_MAT, [0, SY, -0.085]);
      partV(TUBE(0.018, 0.028), TUBE_MAT, [0, SY, 0.063]);
      partV(B(0.008, 0.006, 0.05), RED_DOT, [0, SY + 0.024, -0.01], null, false);
      partV(C(0.008, 0.012), GUNMETAL, [0.024, SY, -0.01], [0, Math.PI / 2, 0], false);
      muzzle.position.set(0, 0.01, -0.58);
      sightY = SY; grip = [0, -0.07, 0.08]; support = [0, -0.03, -0.25];
      break;
    }
    case 'machinegun': {
      partV(B(0.07, 0.085, 0.3), GUNMETAL, [0, 0, 0.02]);
      partV(B(0.072, 0.02, 0.2), GUNMETAL, [0, 0.052, 0]);
      partV(B(0.02, 0.03, 0.12), POLY, [0, 0.085, -0.05]);
      partV(C(0.013, 0.42), STEEL, [0, 0.005, -0.36]);
      partV(B(0.03, 0.012, 0.2), GUNMETAL, [0, 0.025, -0.25], null, false);
      partV(C(0.018, 0.05), GUNMETAL, [0, 0.005, -0.58]);
      partV(B(0.075, 0.06, 0.16), POLY, [0, -0.012, -0.21]);
      for (const s of [-1, 1]) partV(C(0.006, 0.26), GUNMETAL, [s * 0.02, -0.035, -0.42], [0.12, 0, 0], false);
      partV(B(0.1, 0.12, 0.14), FDE, [-0.07, -0.09, -0.02]);
      partV(B(0.03, 0.01, 0.06), GUNMETAL, [-0.03, -0.025, -0.02], [0, 0, 0.6], false);
      partV(B(0.034, 0.1, 0.045), POLY, [0, -0.085, 0.12], [0.3, 0, 0]);
      partV(B(0.04, 0.09, 0.2), POLY, [0, -0.015, 0.28]);
      partV(B(0.03, 0.035, 0.05), POLY, [0, 0.1, 0.05]);
      sightY = mountHoloV(0.125, 0.02, 1.05);
      muzzle.position.set(0, 0.005, -0.61);
      grip = [0, -0.085, 0.13]; support = [0, -0.03, -0.22];
      break;
    }
    case 'sniper': {
      const SY = 0.082;
      partV( B(0.05, 0.06, 0.3), GUNMETAL, [0, 0, -0.01]);
      partV( B(0.05, 0.1, 0.34), OD, [0, -0.025, 0.3]);
      partV( B(0.034, 0.1, 0.045), OD, [0, -0.08, 0.14], [0.3, 0, 0]);
      partV( B(0.03, 0.03, 0.14), OD, [0, 0.045, 0.3]);
      partV( B(0.056, 0.055, 0.32), OD, [0, -0.012, -0.27]);
      partV( C(0.013, 0.6, 10), STEEL, [0, 0.008, -0.56]);
      partV( B(0.034, 0.03, 0.06), GUNMETAL, [0, 0.008, -0.88]);
      partV( C(0.006, 0.05), STEEL, [0.04, 0.015, 0.06], [0, Math.PI / 2, 0], false);
      partV( new THREE.SphereGeometry(0.012, 10, 8), POLY, [0.066, 0.015, 0.06], null, false);
      partV( B(0.04, 0.05, 0.07), POLY, [0, -0.06, -0.03]);
      partV( C(0.018, 0.36), GUNMETAL, [0, SY, -0.02]);
      partV( C(0.028, 0.1), GUNMETAL, [0, SY, -0.2]);
      partV( C(0.024, 0.06), GUNMETAL, [0, SY, 0.16]);
      partV( C(0.02, 0.004), LENS, [0, SY, -0.252], null, false);
      partV( C(0.011, 0.03), GUNMETAL, [0, SY + 0.028, -0.02], [Math.PI / 2, 0, 0], false);
      partV( C(0.011, 0.03), GUNMETAL, [0.028, SY, -0.02], [0, Math.PI / 2, 0], false);
      for (const z of [-0.1, 0.07]) partV( B(0.03, 0.03, 0.02), GUNMETAL, [0, 0.055, z], null, false);
      for (const s of [-1, 1]) partV( C(0.006, 0.28), GUNMETAL, [s * 0.022, -0.045, -0.3], [0.08, 0, 0], false);
      muzzle.position.set(0, 0.008, -0.92);
      sightY = SY; grip = [0, -0.08, 0.15]; support = [0, -0.04, -0.27];
      break;
    }
    case 'rpg': {
      partV( C(0.034, 0.95), OD, [0, 0, 0.05]);
      partV( CONE(0.036, 0.062, 0.14), OD, [0, 0, 0.58]);
      partV( C(0.043, 0.26), WOOD, [0, 0, -0.06]);
      partV( B(0.03, 0.09, 0.04), POLY, [0, -0.07, -0.02], [0.2, 0, 0]);
      partV( B(0.03, 0.09, 0.04), POLY, [0, -0.07, 0.14], [0.25, 0, 0]);
      partV( B(0.03, 0.05, 0.09), GUNMETAL, [-0.045, 0.045, 0.08]);
      partV( C(0.012, 0.04), LENS, [-0.045, 0.05, 0.14], null, false);
      partV( B(0.006, 0.02, 0.006), GUNMETAL, [0, 0.045, -0.25], null, false);
      partV( B(0.014, 0.02, 0.006), GUNMETAL, [0, 0.045, 0.12], null, false);
      warhead = new THREE.Group();
      part(warhead, C(0.02, 0.1), OD, [0, 0, -0.45]);
      part(warhead, C(0.045, 0.14), OD, [0, 0, -0.56]);
      part(warhead, CONE(0.012, 0.045, 0.18), OD, [0, 0, -0.72]);
      g.add(warhead);
      muzzle.position.set(0, 0, -0.5);
      sightY = 0.045; grip = [0, -0.07, 0.15]; support = [0, -0.07, -0.02];
      break;
    }
    case 'smg': {
      partV( B(0.04, 0.045, 0.18), GUNMETAL, [0, 0.01, -0.02]);
      partV( B(0.038, 0.04, 0.12), POLY, [0, -0.02, 0.02]);
      partV( B(0.028, 0.1, 0.04), POLY, [0, -0.08, 0.05], [0.25, 0, 0]);
      partV( B(0.034, 0.12, 0.05), POLY, [0, -0.09, -0.02], [0.1, 0, 0]);
      partV( C(0.01, 0.16), STEEL, [0, 0.01, -0.18]);
      partV( C(0.014, 0.05), POLY, [0, 0.01, -0.28]);
      partV( B(0.036, 0.05, 0.08), POLY, [0, 0.005, 0.12]);
      partV( B(0.02, 0.008, 0.22), GUNMETAL, [0, 0.038, -0.04]);
      sightY = mountRedDotV( 0.055, -0.01, 0.85);
      muzzle.position.set(0, 0.01, -0.31);
      grip = [0, -0.07, 0.06]; support = [0, -0.04, -0.12];
      break;
    }
    case 'shotgun': {
      partV( B(0.045, 0.05, 0.28), GUNMETAL, [0, 0.01, 0]);
      partV( B(0.042, 0.06, 0.22), FDE, [0, -0.02, 0.18]);
      partV( B(0.03, 0.09, 0.04), POLY, [0, -0.08, 0.08], [0.25, 0, 0]);
      partV( C(0.012, 0.38), STEEL, [0, 0.01, -0.3]);
      partV( C(0.016, 0.06), GUNMETAL, [0, 0.01, -0.5]);
      partV( B(0.04, 0.04, 0.1), POLY, [0, -0.01, -0.18]);
      partV( B(0.05, 0.03, 0.08), FDE, [0, 0.04, -0.05]);
      partV( B(0.01, 0.02, 0.01), GUNMETAL, [0, 0.055, -0.12], null, false);
      partV( B(0.018, 0.01, 0.01), GUNMETAL, [0, 0.055, 0.05], null, false);
      muzzle.position.set(0, 0.01, -0.54);
      sightY = 0.05; grip = [0, -0.07, 0.1]; support = [0, -0.02, -0.18];
      break;
    }
    case 'dmr': {
      const SY = 0.078;
      partV( B(0.046, 0.05, 0.26), GUNMETAL, [0, 0.005, 0]);
      partV( B(0.044, 0.08, 0.2), FDE, [0, -0.02, 0.22]);
      partV( B(0.03, 0.09, 0.04), POLY, [0, -0.08, 0.1], [0.22, 0, 0]);
      partV( B(0.042, 0.048, 0.22), FDE, [0, -0.005, -0.22]);
      partV( C(0.011, 0.42), STEEL, [0, 0.008, -0.42]);
      partV( C(0.016, 0.08), POLY, [0, 0.008, -0.66]);
      partV( B(0.028, 0.06, 0.045), POLY, [0, -0.05, -0.05]);
      partV( B(0.02, 0.008, 0.3), GUNMETAL, [0, 0.038, -0.08]);
      partV( TUBE(0.018, 0.1), TUBE_MAT, [0, SY, -0.02]);
      partV( TUBE(0.022, 0.03), TUBE_MAT, [0, SY, -0.08]);
      partV( TUBE(0.015, 0.025), TUBE_MAT, [0, SY, 0.05]);
      partV( B(0.007, 0.005, 0.04), RED_DOT, [0, SY + 0.02, -0.02], null, false);
      muzzle.position.set(0, 0.008, -0.7);
      sightY = SY; grip = [0, -0.07, 0.12]; support = [0, -0.03, -0.22];
      break;
    }
    case 'revolver': {
      partV( B(0.032, 0.035, 0.16), STEEL, [0, 0.02, -0.02]);
      partV( C(0.028, 0.04), STEEL, [0, 0.01, 0.02], [0, Math.PI / 2, 0]);
      partV( B(0.03, 0.1, 0.045), WOOD, [0, -0.055, 0.05], [0.25, 0, 0]);
      partV( C(0.009, 0.1), STEEL, [0, 0.02, -0.12]);
      partV( B(0.01, 0.018, 0.01), GUNMETAL, [0, 0.045, -0.08], null, false);
      partV( B(0.02, 0.01, 0.01), GUNMETAL, [0, 0.045, 0.04], null, false);
      muzzle.position.set(0, 0.02, -0.18);
      sightY = 0.045; grip = [0, -0.055, 0.06]; support = [-0.01, -0.06, 0.04];
      break;
    }
    case 'vector': {
      partV( B(0.042, 0.055, 0.16), GUNMETAL, [0, 0.02, -0.02]);
      partV( B(0.04, 0.08, 0.1), POLY, [0, -0.03, 0]);
      partV( B(0.03, 0.1, 0.04), POLY, [0, -0.1, 0.04], [0.2, 0, 0]);
      partV( B(0.036, 0.12, 0.055), POLY, [0, -0.08, -0.04]);
      partV( C(0.01, 0.14), STEEL, [0, 0.015, -0.16]);
      partV( C(0.014, 0.04), POLY, [0, 0.015, -0.25]);
      partV( B(0.038, 0.04, 0.07), POLY, [0, 0.01, 0.1]);
      partV( B(0.02, 0.008, 0.18), GUNMETAL, [0, 0.055, -0.02]);
      sightY = mountHoloV( 0.075, -0.02, 0.9);
      muzzle.position.set(0, 0.015, -0.28);
      grip = [0, -0.08, 0.05]; support = [0, -0.04, -0.1];
      break;
    }
    case 'goldar': {
      const GOLD = mat('#c9a227', { metalness: 0.85, roughness: 0.35 });
      const SY = 0.086;
      partV( B(0.048, 0.052, 0.21), GOLD, [0, 0.012, 0]);
      partV( B(0.044, 0.045, 0.15), GOLD, [0, -0.03, 0.03]);
      partV( B(0.03, 0.09, 0.058), POLY, [0, -0.11, -0.04], [0.12, 0, 0]);
      partV( B(0.032, 0.09, 0.04), POLY, [0, -0.07, 0.075], [0.35, 0, 0]);
      partV( C(0.014, 0.14), GOLD, [0, 0.004, 0.16]);
      partV( B(0.042, 0.068, 0.12), POLY, [0, -0.008, 0.25]);
      partV( B(0.05, 0.052, 0.24), POLY, [0, 0.01, -0.225]);
      partV( B(0.022, 0.01, 0.44), GOLD, [0, 0.042, -0.1]);
      partV( C(0.009, 0.06), STEEL, [0, 0.01, -0.37]);
      partV( C(0.019, 0.17), POLY, [0, 0.01, -0.48]);
      partV( TUBE(0.021, 0.12), TUBE_MAT, [0, SY, -0.01]);
      partV( TUBE(0.025, 0.035), TUBE_MAT, [0, SY, -0.085]);
      partV( B(0.008, 0.006, 0.05), RED_DOT, [0, SY + 0.024, -0.01], null, false);
      muzzle.position.set(0, 0.01, -0.58);
      sightY = SY; grip = [0, -0.07, 0.08]; support = [0, -0.03, -0.25];
      break;
    }
    case 'antimaterial': {
      const SY = 0.09;
      partV( B(0.06, 0.07, 0.36), GUNMETAL, [0, 0, 0]);
      partV( B(0.058, 0.12, 0.4), OD, [0, -0.03, 0.35]);
      partV( B(0.036, 0.11, 0.05), OD, [0, -0.1, 0.16], [0.28, 0, 0]);
      partV( B(0.062, 0.06, 0.4), OD, [0, -0.01, -0.35]);
      partV( C(0.018, 0.75, 10), STEEL, [0, 0.01, -0.7]);
      partV( B(0.04, 0.04, 0.08), GUNMETAL, [0, 0.01, -1.1]);
      partV( C(0.022, 0.42), GUNMETAL, [0, SY, -0.05]);
      partV( C(0.032, 0.12), GUNMETAL, [0, SY, -0.28]);
      partV( C(0.028, 0.08), GUNMETAL, [0, SY, 0.18]);
      partV( C(0.022, 0.004), LENS, [0, SY, -0.342], null, false);
      for (const s of [-1, 1]) partV( C(0.008, 0.35), GUNMETAL, [s * 0.028, -0.05, -0.4], [0.1, 0, 0], false);
      muzzle.position.set(0, 0.01, -1.14);
      sightY = SY; grip = [0, -0.09, 0.18]; support = [0, -0.04, -0.32];
      break;
    }
  }
  g.add(muzzle);
  scheduleHdWeapon(visual, id, muzzle);
  return { group: g, muzzle, sightY, grip: new THREE.Vector3(...grip), support: new THREE.Vector3(...support), warhead };
}


/** Swap procedural meshes for a Poly Haven glTF when available (pistol / sniper / dmr). */
async function scheduleHdWeapon(visual, weaponId, muzzle) {
  const spec = WEAPON_ASSETS[weaponId];
  if (!spec || !visual) return;
  try {
    const tpl = await loadGltf(spec.id);
    if (!tpl || !visual.parent) return;
    const inst = cloneGltf(tpl);
    inst.rotation.set(spec.pitch || 0, spec.yaw ?? Math.PI, spec.roll || 0);
    inst.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inst);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetLen = weaponId === 'pistol' || weaponId === 'revolver' ? 0.22 : 1.05;
    const sc = (targetLen / Math.max(size.z, size.x, 0.01)) * (spec.scale || 1);
    inst.scale.setScalar(sc);
    inst.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(inst);
    const c = new THREE.Vector3();
    box2.getCenter(c);
    inst.position.sub(c);
    inst.position.y -= box2.min.y * 0.15;
    while (visual.children.length) visual.remove(visual.children[0]);
    visual.add(inst);
    if (spec.muzzle) muzzle.position.set(...spec.muzzle);
    visual.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
  } catch (e) {
    console.warn('[weapon-gltf]', weaponId, e);
  }
}

/** The rocket itself, for flight: fins, body and warhead, pointing down -Z. */
export function buildRocketModel() {
  const g = new THREE.Group();
  part(g, C(0.02, 0.26), OD, [0, 0, 0.05]);
  part(g, C(0.045, 0.14), OD, [0, 0, -0.1]);
  part(g, CONE(0.012, 0.045, 0.18), OD, [0, 0, -0.26]);
  for (let i = 0; i < 4; i++) {
    const fin = part(g, B(0.004, 0.05, 0.06), GUNMETAL, [0, 0, 0.17], null, false);
    fin.rotation.z = (i / 4) * Math.PI;
  }
  return g;
}

const _up = new THREE.Vector3(0, 1, 0);
function limbBetween(a, b, r, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CapsuleGeometry(r, len, 4, 10);
  const m = new THREE.Mesh(geo, material);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(_up, dir.normalize());
  const outline = new THREE.Mesh(geo, OUTLINE_MAT);
  outline.scale.setScalar(1.12);
  m.add(outline);
  return m;
}
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
const VM_SCALE = 0.55;

/** Camo sleeve up to the wrist, then a tactical glove and hand. */
function operatorArm(root, start, hand, cosmetic) {
  const sleeve = new THREE.MeshStandardMaterial({
    color: '#ffffff', map: cosmetic?.camo ? camoTexture(cosmetic.camo) : null, roughness: 0.85,
  });
  if (!cosmetic?.camo) sleeve.color.set(cosmetic?.colors?.limb || '#1b1b1d');
  const glove = new THREE.MeshStandardMaterial({
    color: cosmetic?.gloves || '#2f2c27', roughness: 0.7,
    emissive: cosmetic?.glow ? cosmetic.marker : '#000000', emissiveIntensity: cosmetic?.glow ? 0.35 : 0,
  });
  const dir = new THREE.Vector3().subVectors(hand, start).normalize();
  const wrist = hand.clone().addScaledVector(dir, -0.07);
  root.add(limbBetween(start, wrist, 0.026, sleeve));
  root.add(limbBetween(wrist, hand, 0.021, glove));
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), glove);
  palm.position.copy(hand);
  palm.scale.set(1, 0.85, 1.2);
  root.add(palm);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 12), glove);
  cuff.position.copy(wrist);
  cuff.quaternion.setFromUnitVectors(_up, dir);
  root.add(cuff);
}

/** First-person combat knife held in an operator arm; animated by the engine during melee. */
export function buildKnifeViewModel(cosmetic) {
  const root = new THREE.Group();
  const blade = new THREE.Group();
  part(blade, B(0.012, 0.034, 0.17), mat('#b9bcc2', { metalness: 0.8, roughness: 0.25 }), [0, 0.006, -0.12]);
  part(blade, B(0.012, 0.014, 0.05), mat('#b9bcc2', { metalness: 0.8, roughness: 0.25 }), [0, 0.02, -0.215], [-0.5, 0, 0]);
  part(blade, B(0.05, 0.012, 0.018), GUNMETAL, [0, 0, -0.03]);
  part(blade, B(0.026, 0.032, 0.1), POLY, [0, -0.004, 0.03]);
  root.add(blade);
  operatorArm(root, new THREE.Vector3(0.12, -0.3, 0.42), new THREE.Vector3(0, -0.004, 0.03), cosmetic);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 10; } });
  root.scale.setScalar(VM_SCALE);
  const holder = new THREE.Group();
  holder.add(root);
  holder.visible = false;
  return { root: holder };
}

/**
 * First-person viewmodel: weapon + operator arms dressed in the equipped outfit.
 */
export function buildViewModel(id, cosmetic) {
  const w = buildWeaponModel(id);
  const root = new THREE.Group();
  root.add(w.group);
  const rightStart = new THREE.Vector3(0.14, -0.32, 0.42);
  const leftStart = (id === 'pistol' || id === 'revolver')
    ? new THREE.Vector3(-0.16, -0.34, 0.35)
    : new THREE.Vector3(-0.2, -0.3, 0.12);
  operatorArm(root, rightStart, w.grip, cosmetic);
  operatorArm(root, leftStart, w.support, cosmetic);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 10; } });
  const holder = new THREE.Group();
  root.scale.setScalar(VM_SCALE);
  holder.add(root);
  return { root: holder, muzzle: w.muzzle, sightY: w.sightY * VM_SCALE, warhead: w.warhead };
}
