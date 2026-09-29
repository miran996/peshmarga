const fs = require('fs');
const p = 'public/js/game/weapons.js';
let s = fs.readFileSync(p, 'utf8');

const start = s.indexOf("case 'sniper'");
const end = s.indexOf('\n  g.add(muzzle);');
if (start < 0 || end < 0) throw new Error(`markers ${start} ${end}`);
let mid = s.slice(start, end);
mid = mid.replace(/part\(g,/g, 'partV(')
  .replace(/mountRedDot\(g,/g, 'mountRedDotV(')
  .replace(/mountHolo\(g,/g, 'mountHoloV(');
s = s.slice(0, start) + mid + s.slice(end);

if (!s.includes('scheduleHdWeapon(visual, id, muzzle)')) {
  s = s.replace(
    '\n  g.add(muzzle);\n  return { group: g, muzzle, sightY,',
    '\n  g.add(muzzle);\n  scheduleHdWeapon(visual, id, muzzle);\n  return { group: g, muzzle, sightY,',
  );
}

const helper = `
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

`;

if (!s.includes('async function scheduleHdWeapon')) {
  s = s.replace(
    '/** The rocket itself, for flight:',
    helper + '/** The rocket itself, for flight:',
  );
}

fs.writeFileSync(p, s);
console.log('ok', {
  partV: (s.match(/partV\(/g) || []).length,
  schedule: s.includes('scheduleHdWeapon(visual'),
  helper: s.includes('async function scheduleHdWeapon'),
});
