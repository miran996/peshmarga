import * as THREE from 'three';

/** Tiny procedural normal map (repeatable) for fabric / concrete micro-detail. */
function noiseNormalMap(size = 128, strength = 1.4) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const h = (x, y) => {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return (n - Math.floor(n));
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1) || 1;
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

let sharedFabricNormal = null;
let sharedMetalNormal = null;

function fabricNormal() {
  if (!sharedFabricNormal) sharedFabricNormal = noiseNormalMap(128, 1.8);
  return sharedFabricNormal;
}
function metalNormal() {
  if (!sharedMetalNormal) sharedMetalNormal = noiseNormalMap(64, 0.9);
  return sharedMetalNormal;
}

/**
 * Upgrade an existing Stickman to richer PBR look without changing skeleton/collision.
 * Safe to call multiple times; skips if already enhanced.
 */
export function enhanceOperatorMaterials(stickman, enabled) {
  if (!stickman || !enabled) return;
  if (stickman._hdPbr) return;
  stickman._hdPbr = true;

  const fab = fabricNormal();
  const met = metalNormal();

  const apply = (mat, { rough, metal, normal, scale = 2.2, env = 0.35 }) => {
    if (!mat) return;
    mat.roughness = rough;
    mat.metalness = metal;
    if (normal) {
      mat.normalMap = normal;
      mat.normalScale = new THREE.Vector2(scale, scale);
      if (normal.repeat) normal.repeat.set(3, 3);
    }
    mat.envMapIntensity = env;
    mat.needsUpdate = true;
  };

  apply(stickman.bodyMat, { rough: 0.88, metal: 0.02, normal: fab, scale: 1.6, env: 0.25 });
  apply(stickman.vestMat, { rough: 0.72, metal: 0.08, normal: fab, scale: 2.4, env: 0.4 });
  apply(stickman.helmetMat, { rough: 0.42, metal: 0.35, normal: met, scale: 1.2, env: 0.7 });
  apply(stickman.faceMat, { rough: 0.95, metal: 0, normal: fab, scale: 1.1, env: 0.15 });
  apply(stickman.gloveMat, { rough: 0.78, metal: 0.05, normal: fab, scale: 2.0, env: 0.3 });
  apply(stickman.bootMat, { rough: 0.7, metal: 0.12, normal: met, scale: 1.5, env: 0.35 });
  apply(stickman.metalMat, { rough: 0.38, metal: 0.65, normal: met, scale: 1.0, env: 0.85 });
  apply(stickman.flagMat, { rough: 0.55, metal: 0.05, normal: fab, scale: 1.2, env: 0.3 });
}

/** Raise anisotropy / ensure mipmaps on world textures after map build. */
export function boostWorldTextures(root, anisotropy = 8) {
  if (!root) return;
  root.traverse((o) => {
    const mats = o.isMesh ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (!m) continue;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
        const tex = m[key];
        if (!tex || !tex.isTexture) continue;
        tex.anisotropy = Math.max(tex.anisotropy || 1, anisotropy);
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
      }
    }
  });
}
