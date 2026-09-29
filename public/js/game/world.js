import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfaceTextures } from './textures.js';
import {
  KIND_ASSETS, DEBRIS_ASSETS, placeGltf, preloadGltf, loadGltf, cloneGltf, fitGltf,
} from '../graphics/gltf.js';

const INK = new THREE.LineBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.7 });

/** Material look per surface: detail texture tile size (m), roughness, metalness, relief strength. */
const SURFACES = {
  concrete: { scale: 2.4, rough: 0.95, metal: 0, normal: 0.9 },
  plaster: { scale: 2.6, rough: 0.92, metal: 0, normal: 0.6 },
  wood: { scale: 1.6, rough: 0.85, metal: 0, normal: 0.7 },
  metal: { scale: 3.0, rough: 0.55, metal: 0.35, normal: 0.5 },
  corrugated: { scale: 2.2, rough: 0.6, metal: 0.3, normal: 1.0 },
  fabric: { scale: 0.7, rough: 1, metal: 0, normal: 0.6 },
  rock: { scale: 3.2, rough: 0.95, metal: 0, normal: 1.1 },
  bark: { scale: 0.9, rough: 0.95, metal: 0, normal: 1.0 },
  foliage: { scale: 1.3, rough: 0.9, metal: 0, normal: 0.8 },
  asphalt: { scale: 4.0, rough: 0.9, metal: 0, normal: 0.5 },
  water: { scale: 5.0, rough: 0.12, metal: 0.2, normal: 0.6 },
  plain: null,
};
const KIND_SURFACE = {
  wall: 'concrete', slab: 'concrete', boundary: 'concrete', bunker: 'concrete', barrier: 'concrete', rubble: 'concrete',
  pillar: 'concrete', rock: 'rock', car: 'metal', bus: 'metal', container: 'corrugated', crane: 'metal', rack: 'metal',
  barrel: 'metal', crate: 'wood', platform: 'wood', stair: 'wood', rail: 'wood', log: 'bark', tree: 'bark', pole: 'wood',
  tent: 'fabric', sandbag: 'fabric',
};

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#b8912e';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#141414';
  for (let x = -32; x < 160; x += 32) {
    g.beginPath();
    g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Ground colour texture plus a height-derived normal map; 1 tile = 10 m. */
function groundTextures(spec, normals) {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = spec.fill;
  g.fillRect(0, 0, size, size);
  const [or, og, ob] = spec.off;
  for (let i = 0; i < 14000; i++) {
    const v = spec.base + Math.random() * spec.range;
    g.fillStyle = `rgba(${v + or},${v + og},${v + ob},${Math.random() * 0.35})`;
    const s = Math.random() * 3 + 1;
    g.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 20 + Math.random() * 60;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${spec.crack},${0.08 + Math.random() * 0.1})`);
    grad.addColorStop(1, `rgba(${spec.crack},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 80; i++) {
    g.strokeStyle = `rgba(${spec.crack},${0.1 + Math.random() * 0.2})`;
    g.lineWidth = Math.random() * 1.5 + 0.5;
    g.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; g.lineTo(x, y); }
    g.stroke();
  }
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  let normal = null;
  if (normals) {
    const img = g.getImageData(0, 0, size, size).data;
    const nc = document.createElement('canvas');
    nc.width = nc.height = size;
    const ng = nc.getContext('2d');
    const out = ng.createImageData(size, size);
    const L = (x, y) => img[(((y + size) % size) * size + ((x + size) % size)) * 4 + 1] / 255;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (L(x + 1, y) - L(x - 1, y)) * 3, dy = (L(x, y + 1) - L(x, y - 1)) * 3;
        const len = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
        out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
        out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
        out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        out.data[i + 3] = 255;
      }
    }
    ng.putImageData(out, 0, 0);
    normal = new THREE.CanvasTexture(nc);
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  }
  return { map, normal };
}

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Overcast sky dome: gradient, drifting fbm cloud deck and a sun diffused through it. */
function sky(theme) {
  const geo = new THREE.SphereGeometry(420, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(theme.sky[0]) },
      mid: { value: new THREE.Color(theme.sky[1]) },
      horizon: { value: new THREE.Color(theme.sky[2]) },
      cloudLight: { value: new THREE.Color(theme.cloudLight || theme.sky[2]) },
      cloudDark: { value: new THREE.Color(theme.cloudDark || theme.sky[0]) },
      sunColor: { value: new THREE.Color(theme.sunColor) },
      sunDir: { value: new THREE.Vector3(...theme.sunDir).normalize() },
      cover: { value: theme.clouds ?? 0.6 },
      time: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 cloudLight; uniform vec3 cloudDark;
      uniform vec3 sunColor; uniform vec3 sunDir; uniform float cover; uniform float time; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x){
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, top, smoothstep(0.22, 0.8, h));
        vec2 uv = d.xz / max(0.06, h + 0.1);
        float c = fbm(vec3(uv * 0.9 + vec2(time * 0.004, time * 0.0015), time * 0.002));
        float cl = smoothstep(1.05 - cover, 1.45 - cover, c + cover * 0.35);
        float shade = fbm(vec3(uv * 1.9 + 7.0, time * 0.003));
        vec3 cloudCol = mix(cloudDark, cloudLight, smoothstep(0.35, 0.75, shade));
        float fade = smoothstep(-0.02, 0.18, h);
        col = mix(col, cloudCol, cl * fade);
        float s = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(s, 90.0) * 0.8 * (1.0 - cl * 0.85) + pow(s, 6.0) * 0.1);
        col = mix(col, horizon * 0.45, smoothstep(0.0, -0.12, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

/** Box-projected world-space UVs so detail textures keep their real-world scale on any surface. */
function worldUV(geo, tile) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  if (!uv || !nor) return;
  const k = 1 / tile;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (ny >= nx && ny >= nz) uv.setXY(i, x * k, z * k);
    else if (nx >= nz) uv.setXY(i, z * k, y * k);
    else uv.setXY(i, x * k, y * k);
  }
  uv.needsUpdate = true;
}

/**
 * Builds the visible world for a map into its own group so it can be torn down when the map changes.
 * opts: { particles: 0..1, normals: bool }. Returns { root, sun, update(dt, time), dispose() }.
 */
export function buildWorld(scene, map, opts = {}) {
  const T = map.theme;
  const normals = !!opts.normals;
  const root = new THREE.Group();
  root.name = `world:${map.id}`;
  scene.add(root);
  scene.fog = new THREE.Fog(T.fog[0], T.fog[1], T.fog[2]);
  const skyMesh = sky(T);
  skyMesh.name = 'sky';
  skyMesh.userData.sky = true;
  root.add(skyMesh);

  // Extra ambient so interiors / shadow side of ruins stay readable.
  root.add(new THREE.AmbientLight('#d8dce0', 0.55));
  root.add(new THREE.HemisphereLight(T.hemi[0], T.hemi[1], T.hemi[2]));
  const sun = new THREE.DirectionalLight(T.sunColor, T.sunIntensity);
  sun.position.set(...T.sunPos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  const ext = map.HALF * 1.25;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 10; sc.far = 320;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 3;
  root.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(T.hemi[0], Math.max(0.85, (T.fill ?? 0.3) * 1.25));
  fill.position.set(-T.sunPos[0], 40, -T.sunPos[2]);
  root.add(fill);
  const bounce = new THREE.DirectionalLight('#fff2e0', 0.55);
  bounce.position.set(T.sunPos[0] * 0.3, 25, -T.sunPos[2] * 0.4);
  root.add(bounce);

  const gt = groundTextures(T.ground, normals);
  const tiles = map.SIZE / 10;
  gt.map.repeat.set(tiles, tiles);
  if (gt.normal) gt.normal.repeat.set(tiles, tiles);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(map.SIZE, map.SIZE),
    new THREE.MeshStandardMaterial({ map: gt.map, normalMap: gt.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);
  const outer = new THREE.Mesh(
    new THREE.RingGeometry(map.HALF * 1.42, 420, 4, 1),
    new THREE.MeshStandardMaterial({ color: T.outer, roughness: 1 })
  );
  outer.rotation.x = -Math.PI / 2;
  outer.rotation.z = Math.PI / 4;
  outer.position.y = -0.02;
  root.add(outer);
  const outerNear = new THREE.Mesh(
    new THREE.PlaneGeometry(map.SIZE + 60, map.SIZE + 60),
    new THREE.MeshStandardMaterial({ color: T.outerNear, roughness: 1 })
  );
  outerNear.rotation.x = -Math.PI / 2;
  outerNear.position.y = -0.03;
  root.add(outerNear);

  // ---- merged geometry, grouped by colour + surface (flat ground decals kept separate for depth offset) ----
  // Kinds listed in KIND_ASSETS are rendered as high-quality glTF instead of boxes.
  const GLTF_KINDS = new Set(Object.keys(KIND_ASSETS));
  const gltfBoxTargets = [];
  const groups = new Map();
  const edgeGeos = [];
  const tmp = new THREE.Matrix4();
  const addGeo = (geo, color, surface, withEdges = true, flat = false) => {
    const spec = SURFACES[surface] ? surface : 'plain';
    if (SURFACES[spec]) worldUV(geo, SURFACES[spec].scale);
    const key = `${color}|${spec}|${flat ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, { color, surface: spec, flat, geos: [] });
    groups.get(key).geos.push(geo);
    if (withEdges) edgeGeos.push(new THREE.EdgesGeometry(geo, 30));
  };
  for (const b of map.boxes) {
    if (b.kind === 'boundary' || b.invisible) continue;
    if (GLTF_KINDS.has(b.kind) && b.h >= 0.45) {
      gltfBoxTargets.push(b);
      continue; // collision stays on map.boxes; visual comes from glTF
    }
    const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
    tmp.makeRotationY(b.rotY || 0).setPosition(b.x, b.y, b.z);
    geo.applyMatrix4(tmp);
    addGeo(geo, b.color, b.surface || KIND_SURFACE[b.kind] || 'concrete');
  }
  const bTex = surfaceTextures('concrete');
  const boundaryMat = new THREE.MeshStandardMaterial({ color: T.boundary, roughness: 0.95, map: bTex?.map, normalMap: normals ? bTex?.normal : null });
  for (const b of map.boxes) {
    if (b.kind !== 'boundary') continue;
    const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
    tmp.makeTranslation(b.x, b.y, b.z);
    geo.applyMatrix4(tmp);
    worldUV(geo, 2.4);
    const m = new THREE.Mesh(geo, boundaryMat);
    m.receiveShadow = true;
    root.add(m);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), INK));
  }

  const hazardTex = stripeTexture();
  for (const d of map.decor) {
    switch (d.type) {
      case 'box': {
        const geo = new THREE.BoxGeometry(d.w, d.h, d.d);
        tmp.makeRotationFromEuler(new THREE.Euler(d.rx || 0, d.ry || 0, d.rz || 0)).setPosition(d.x, d.y, d.z);
        geo.applyMatrix4(tmp);
        addGeo(geo, d.color, d.surface || 'concrete', !d.noEdges && d.w * d.h * d.d > 0.004, !!d.noEdges);
        break;
      }
      case 'cyl': {
        const geo = new THREE.CylinderGeometry(d.rt ?? d.r, d.r, d.h, d.r > 0.1 ? 14 : 5);
        tmp.makeRotationFromEuler(new THREE.Euler(d.rx || 0, d.ry || 0, d.rz || 0)).setPosition(d.x, d.y, d.z);
        geo.applyMatrix4(tmp);
        addGeo(geo, d.color, d.surface || 'plain', d.r > 0.1);
        break;
      }
      case 'ico': {
        const geo = new THREE.IcosahedronGeometry(d.r, 1);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const s = 0.85 + (Math.sin(i * 12.9898 + d.x) * 43758.5453 % 1 + 1) % 1 * 0.3;
          pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.8, pos.getZ(i) * s);
        }
        geo.computeVertexNormals();
        tmp.makeRotationY(d.ry || 0).setPosition(d.x, d.y, d.z);
        geo.applyMatrix4(tmp);
        addGeo(geo, d.color, d.surface || 'foliage', true);
        break;
      }
      case 'plane': {
        const geo = new THREE.PlaneGeometry(d.w, d.d).rotateX(-Math.PI / 2).translate(d.x, d.y || 0.01, d.z);
        addGeo(geo, d.color, d.surface || 'plain', false, true);
        break;
      }
      case 'disc': {
        const geo = new THREE.CircleGeometry(d.r, 24).rotateX(-Math.PI / 2).translate(d.x, d.y || 0.02, d.z);
        addGeo(geo, d.color, d.surface || 'plain', false, true);
        break;
      }
      case 'hazard': {
        const len = Math.max(d.w, d.d);
        const tex = hazardTex.clone();
        tex.needsUpdate = true;
        tex.repeat.set(len / 2, 1);
        const m = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
        m.position.set(d.x, d.y, d.z);
        root.add(m);
        break;
      }
    }
  }

  let water = null;
  for (const { color, surface, flat, geos } of groups.values()) {
    const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    const spec = SURFACES[surface];
    const tex = spec ? surfaceTextures(surface) : null;
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: spec?.rough ?? 0.92, metalness: spec?.metal ?? 0,
      map: tex?.map || null, normalMap: normals && tex?.normal ? tex.normal : null,
      normalScale: new THREE.Vector2(spec?.normal ?? 1, spec?.normal ?? 1),
      polygonOffset: flat, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    if (surface === 'water') {
      mat.transparent = true;
      mat.opacity = 0.88;
      water = mat;
    }
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = !flat && surface !== 'water';
    mesh.receiveShadow = true;
    root.add(mesh);
    geos.forEach((g) => g.dispose());
  }
  if (edgeGeos.length) {
    root.add(new THREE.LineSegments(mergeGeometries(edgeGeos, false), INK));
    edgeGeos.forEach((g) => g.dispose());
  }

  // ---- barbed wire on the boundary ----
  const wirePts = [];
  const Hw = map.WALL_H + 0.35, L = map.HALF;
  const edgesList = [
    [[-L, -L], [L, -L]], [[L, -L], [L, L]], [[L, L], [-L, L]], [[-L, L], [-L, -L]],
  ];
  for (const [[ax, az], [bx, bz]] of edgesList) {
    const n = Math.round(map.SIZE * 2);
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const y0 = Hw + Math.sin(i * 1.9) * 0.18, y1 = Hw + Math.sin((i + 1) * 1.9) * 0.18;
      wirePts.push(ax + (bx - ax) * t0, y0, az + (bz - az) * t0, ax + (bx - ax) * t1, y1, az + (bz - az) * t1);
    }
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      wirePts.push(x, map.WALL_H, z, x, Hw + 0.35, z);
    }
  }
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  root.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x1a1a1a })));

  // ---- floodlights on the corners (landmark silhouettes) ----
  for (const [x, z] of [[-L + 1, -L + 1], [L - 1, -L + 1], [-L + 1, L - 1], [L - 1, L - 1]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 12, 8), new THREE.MeshStandardMaterial({ color: '#2b2b2b' }));
    pole.position.set(x, 6, z);
    pole.castShadow = true;
    root.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.4), new THREE.MeshStandardMaterial({ color: '#222', emissive: '#ffe2a8', emissiveIntensity: 0.6 }));
    lamp.position.set(x, 12, z);
    lamp.lookAt(0, 0, 0);
    root.add(lamp);
  }

  // ---- ambient smoke columns & drifting dust / falling snow ----
  const dot = softDot();
  const smoke = [];
  const smokeMat = new THREE.SpriteMaterial({ map: dot, color: T.smoke, transparent: true, depthWrite: false, opacity: 0.5 });
  for (const [x, z] of map.smoke) {
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(smokeMat.clone());
      s.userData = { x, z, t: Math.random() * 8, speed: 0.7 + Math.random() * 0.4, drift: Math.random() * 2 };
      root.add(s);
      smoke.push(s);
    }
    const ember = new THREE.PointLight(T.ember, 6, 9, 2);
    ember.position.set(x, 1.4, z);
    ember.userData.base = 6;
    smoke.push(ember);
    root.add(ember);
  }

  const snow = !!T.snow;
  const area = (map.SIZE / 120) ** 2;
  const dustCount = Math.round((snow ? 1400 : 480) * area * (opts.particles ?? 1));
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * map.SIZE;
    dustPos[i * 3 + 1] = Math.random() * (snow ? 20 : 12);
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * map.SIZE;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  root.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({
    size: snow ? 0.11 : 0.07, map: dot, color: T.dust, transparent: true, opacity: snow ? 0.85 : 0.45, depthWrite: false,
  })));

  function update(dt, time) {
    skyMesh.material.uniforms.time.value = time;
    if (water?.normalMap) {
      water.normalMap.offset.x = time * 0.02;
      water.normalMap.offset.y = time * 0.013;
    }
    for (const s of smoke) {
      if (s.isPointLight) {
        s.intensity = s.userData.base * (0.75 + Math.sin(time * 13 + s.position.x) * 0.12 + Math.random() * 0.2);
        continue;
      }
      const u = s.userData;
      u.t = (u.t + dt * u.speed) % 8;
      const k = u.t / 8;
      s.position.set(u.x + Math.sin(u.t + u.drift) * 0.4 + k * 3.5, 1 + u.t * 1.7, u.z + k * 1.8);
      s.scale.setScalar(1 + k * 7);
      s.material.opacity = 0.6 * (1 - k) * Math.min(1, u.t * 2);
    }
    const p = dustGeo.attributes.position.array;
    for (let i = 0; i < dustCount; i++) {
      if (snow) {
        p[i * 3] += (0.6 + Math.sin(time * 0.7 + i) * 0.4) * dt;
        p[i * 3 + 1] -= (1.1 + (i % 7) * 0.12) * dt;
        p[i * 3 + 2] += Math.cos(time * 0.9 + i * 1.3) * 0.3 * dt;
        if (p[i * 3 + 1] < 0) p[i * 3 + 1] += 20;
      } else {
        p[i * 3] += dt * 0.35;
        p[i * 3 + 1] += Math.sin(time + i) * dt * 0.05;
      }
      if (p[i * 3] > map.HALF) p[i * 3] = -map.HALF;
    }
    dustGeo.attributes.position.needsUpdate = true;
  }

  function dispose() {
    scene.remove(root);
    root.traverse((o) => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (m === INK) continue;
        for (const t of [m.map, m.normalMap]) if (t && !t.userData?.shared) t.dispose();
        m.dispose();
      }
    });
    sun.shadow.map?.dispose();
  }

  // High-quality Poly Haven props (async; collision already from map.boxes).
  const hdRoot = new THREE.Group();
  hdRoot.name = 'hd-props';
  root.add(hdRoot);
  populateHdProps(hdRoot, gltfBoxTargets, map).catch((e) => console.warn('[hd-props]', e));

  return { root, sun, sky: skyMesh, update, dispose, hdRoot };
}

/** Cluster nearby boxes of the same kind into one AABB for a single glTF instance.
 *  Map boxes store center `y` and also `minY`/`maxY` — always prefer min/max. */
function clusterBoxes(boxes, maxDist = 4.2) {
  const clusters = [];
  for (const b of boxes) {
    let hit = null;
    for (const c of clusters) {
      if (c.kind !== b.kind) continue;
      if (Math.hypot(c.x - b.x, c.z - b.z) > maxDist) continue;
      hit = c;
      break;
    }
    const minY = b.minY != null ? b.minY : b.y - b.h / 2;
    const maxY = b.maxY != null ? b.maxY : b.y + b.h / 2;
    if (!hit) {
      clusters.push({
        kind: b.kind, x: b.x, z: b.z,
        minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
        minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
        minY, maxY, n: 1,
      });
      continue;
    }
    hit.minX = Math.min(hit.minX, b.x - b.w / 2);
    hit.maxX = Math.max(hit.maxX, b.x + b.w / 2);
    hit.minZ = Math.min(hit.minZ, b.z - b.d / 2);
    hit.maxZ = Math.max(hit.maxZ, b.z + b.d / 2);
    hit.minY = Math.min(hit.minY, minY);
    hit.maxY = Math.max(hit.maxY, maxY);
    hit.x = (hit.minX + hit.maxX) / 2;
    hit.z = (hit.minZ + hit.maxZ) / 2;
    hit.n++;
  }
  return clusters.map((c) => ({
    kind: c.kind,
    x: c.x,
    y: c.minY, // ground / bottom — never the box center
    z: c.z,
    w: Math.max(0.4, c.maxX - c.minX),
    h: Math.max(0.4, c.maxY - c.minY),
    d: Math.max(0.4, c.maxZ - c.minZ),
  }));
}

async function populateHdProps(hdRoot, boxTargets, map) {
  // Facade kits are multi-piece packs with huge bounds — they float into the sky. Skip them.
  const ids = [
    ...new Set([
      ...Object.values(KIND_ASSETS).flat(),
      ...DEBRIS_ASSETS,
    ]),
  ];
  await preloadGltf(ids);

  const clusters = clusterBoxes(boxTargets);
  const maxCars = 28, maxOther = 40;
  let cars = 0, other = 0;
  for (const c of clusters) {
    const assets = KIND_ASSETS[c.kind];
    if (!assets?.length) continue;
    const isCar = c.kind === 'car' || c.kind === 'bus';
    if (isCar) { if (cars >= maxCars) continue; cars++; }
    else { if (other >= maxOther) continue; other++; }
    const asset = assets[(Math.abs(Math.floor(c.x * 7 + c.z * 13)) % assets.length)];
    const yaw = c.w >= c.d ? 0 : Math.PI / 2;
    // Cap height so oversized kits / trucks never launch into the sky.
    const h = Math.min(c.h, isCar ? 2.4 : 2.8);
    const pad = isCar ? 0.9 : 0.85;
    const maxScale = isCar ? 3.5 : 4.5;
    await placeGltf(hdRoot, asset, { ...c, h }, { pad, yaw, yAlign: 'bottom', maxScale, groundY: 0 });
  }

  // Scatter debris near car clusters for war-zone feel (grounded).
  const debrisTpl = {};
  for (const id of DEBRIS_ASSETS) debrisTpl[id] = await loadGltf(id);
  let debris = 0;
  for (const c of clusters) {
    if (c.kind !== 'car' && c.kind !== 'bus') continue;
    if (debris >= 36) break;
    for (let i = 0; i < 2; i++) {
      const id = DEBRIS_ASSETS[(debris + i) % DEBRIS_ASSETS.length];
      const tpl = debrisTpl[id];
      if (!tpl) continue;
      const inst = cloneGltf(tpl);
      const ang = (debris * 1.7 + i) % (Math.PI * 2);
      const r = 2.2 + (i * 0.8);
      const x = c.x + Math.cos(ang) * r;
      const z = c.z + Math.sin(ang) * r;
      if (Math.abs(x) > map.HALF - 2 || Math.abs(z) > map.HALF - 2) continue;
      fitGltf(inst, {
        x, y: 0, z,
        w: 0.9 + (i % 2) * 0.4,
        h: 0.55,
        d: 0.9 + (i % 2) * 0.4,
      }, { pad: 1, yaw: ang, yAlign: 'bottom', maxScale: 2.2, groundY: 0 });
      hdRoot.add(inst);
      debris++;
    }
  }
}
