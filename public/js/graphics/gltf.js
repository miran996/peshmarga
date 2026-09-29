/**
 * High-quality glTF asset cache (Poly Haven CC0).
 * Loads once, clones for placement. Fits models into map AABBs.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map(); // id → Promise<THREE.Object3D>
let manifestPromise = null;

const FALLBACK_PATHS = {
  covered_car: '/models/covered_car/model.gltf',
  Barrel_01: '/models/Barrel_01/model.gltf',
  old_military_crate: '/models/old_military_crate/model.gltf',
  wooden_military_crate: '/models/wooden_military_crate/model.gltf',
  ammo_box: '/models/ammo_box/model.gltf',
  metal_jerrycan: '/models/metal_jerrycan/model.gltf',
  old_tyre: '/models/old_tyre/model.gltf',
  rusted_wheel_rim_01: '/models/rusted_wheel_rim_01/model.gltf',
  concrete_road_barrier: '/models/concrete_road_barrier/model.gltf',
  modular_factory_facade: '/models/modular_factory_facade/model.gltf',
  modular_urban_apartments_facade: '/models/modular_urban_apartments_facade/model.gltf',
  bolt_action_rifle_7_62: '/models/bolt_action_rifle_7_62/model.gltf',
  service_pistol: '/models/service_pistol/model.gltf',
  stick_grenade: '/models/stick_grenade/model.gltf',
};

/** Map gameplay kinds → Poly Haven asset ids (variants for variety). */
export const KIND_ASSETS = {
  car: ['covered_car'],
  bus: ['covered_car'],
  barrel: ['Barrel_01'],
  crate: ['old_military_crate', 'wooden_military_crate', 'ammo_box'],
  barrier: ['concrete_road_barrier'],
  container: ['old_military_crate'],
};

/** World props scattered as extras near rubble / cars. */
export const DEBRIS_ASSETS = ['old_tyre', 'rusted_wheel_rim_01', 'metal_jerrycan', 'ammo_box'];

/** Weapon id → glTF asset (+ optional local axis fix). */
export const WEAPON_ASSETS = {
  pistol: { id: 'service_pistol', scale: 1, yaw: Math.PI, pitch: 0, roll: 0, muzzle: [0, 0.02, -0.14] },
  revolver: { id: 'service_pistol', scale: 1.05, yaw: Math.PI, pitch: 0, roll: 0, muzzle: [0, 0.02, -0.14] },
  sniper: { id: 'bolt_action_rifle_7_62', scale: 1, yaw: Math.PI, pitch: 0, roll: 0, muzzle: [0, 0.03, -0.55] },
  dmr: { id: 'bolt_action_rifle_7_62', scale: 0.95, yaw: Math.PI, pitch: 0, roll: 0, muzzle: [0, 0.03, -0.5] },
};

export const GRENADE_ASSET = { id: 'stick_grenade', scale: 1 };

async function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('/models/manifest.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return manifestPromise;
}

function pathFor(id) {
  return FALLBACK_PATHS[id] || `/models/${id}/model.gltf`;
}

function prepareScene(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      if (m.emissiveMap) m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      m.side = THREE.FrontSide;
      m.needsUpdate = true;
    }
  });
  return root;
}

/** Load template scene (shared). Call cloneGltf for instances. */
export function loadGltf(id) {
  if (cache.has(id)) return cache.get(id);
  const p = (async () => {
    const man = await loadManifest();
    const url = man?.assets?.[id] ? `/${man.assets[id]}` : pathFor(id);
    const gltf = await loader.loadAsync(url);
    prepareScene(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    return gltf.scene;
  })().catch((err) => {
    console.warn(`[gltf] failed ${id}`, err);
    cache.delete(id);
    return null;
  });
  cache.set(id, p);
  return p;
}

export function cloneGltf(template) {
  if (!template) return null;
  const c = template.clone(true);
  c.traverse((o) => {
    if (o.isMesh && o.material) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    }
  });
  return c;
}

/** Uniformly scale + center a model so its AABB matches target size (meters).
 *  `target.y` is the ground (bottom) height. Rotation is applied before grounding so props don't float. */
export function fitGltf(root, target, opts = {}) {
  const { pad = 0.92, yAlign = 'bottom', yaw = 0, maxScale = Infinity, groundY = null } = opts;
  root.position.set(0, 0, 0);
  root.rotation.set(0, yaw || 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.x < 1e-4 || size.y < 1e-4 || size.z < 1e-4) return root;
  const sx = (target.w * pad) / size.x;
  const sy = (target.h * pad) / size.y;
  const sz = (target.d * pad) / size.z;
  const s = Math.min(sx, sy, sz, maxScale);
  root.scale.setScalar(s);
  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box2.getCenter(center);
  const min = box2.min;
  const gy = groundY != null ? groundY : target.y;
  root.position.set(
    target.x - center.x,
    yAlign === 'bottom' ? gy - min.y : gy - center.y + (target.h || 0) / 2,
    target.z - center.z,
  );
  // Final clamp: keep the lowest point on the ground plane.
  root.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(root);
  if (yAlign === 'bottom' && Math.abs(box3.min.y - gy) > 0.01) {
    root.position.y += gy - box3.min.y;
  }
  return root;
}

/** Place a fitted clone into parent. Returns the instance or null. */
export async function placeGltf(parent, assetId, target, opts = {}) {
  const tpl = await loadGltf(assetId);
  if (!tpl) return null;
  const inst = cloneGltf(tpl);
  fitGltf(inst, target, opts);
  parent.add(inst);
  return inst;
}

/** Preload a list of asset ids (fire-and-forget). */
export function preloadGltf(ids) {
  return Promise.all(ids.map((id) => loadGltf(id)));
}

export function allKnownAssetIds() {
  return Object.keys(FALLBACK_PATHS);
}
