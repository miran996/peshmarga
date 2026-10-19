/**
 * Full 3D procedural vehicles for map props (sedan / wreck / bus / truck).
 * Collision stays on map.boxes; this is visual only.
 */
import * as THREE from 'three';

const _mats = new Map();

function mat(hex, opts = {}) {
  const key = `${hex}|${opts.metal || 0}|${opts.rough || 0.55}|${opts.glass ? 1 : 0}|${opts.emissive || ''}`;
  if (_mats.has(key)) return _mats.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    roughness: opts.glass ? 0.15 : (opts.rough ?? 0.55),
    metalness: opts.glass ? 0.1 : (opts.metal ?? 0.35),
    transparent: !!opts.glass,
    opacity: opts.glass ? 0.45 : 1,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : undefined,
    emissiveIntensity: opts.emissive ? 0.55 : 0,
  });
  _mats.set(key, m);
  return m;
}

function boxMesh(w, h, d, color, opts, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cylMesh(rTop, rBot, h, color, opts, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 12), mat(color, opts));
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function addWheel(parent, x, y, z, alongX, radius = 0.38, width = 0.28) {
  const tire = cylMesh(radius, radius, width, '#121212', { rough: 0.95, metal: 0.05 },
    x, y, z, alongX ? Math.PI / 2 : 0, 0, alongX ? 0 : Math.PI / 2);
  const hub = cylMesh(radius * 0.45, radius * 0.45, width * 1.15, '#3a3a3a', { rough: 0.4, metal: 0.7 },
    x, y, z, alongX ? Math.PI / 2 : 0, 0, alongX ? 0 : Math.PI / 2);
  parent.add(tire, hub);
}

function darken(hex, amount = 0.35) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(1 - amount);
  return `#${c.getHexString()}`;
}

/** Civilian sedan — hood / cabin / trunk, glass, lights, wheels. */
function buildSedan(color, style = 'intact') {
  const g = new THREE.Group();
  g.name = 'vehicle-sedan';
  const body = color || '#6a2f26';
  const paint = style === 'crushed' || style === 'flipped' ? darken(body, 0.25) : body;
  const metal = '#2a2c30';
  const glass = '#1a2228';

  if (style === 'flipped') {
    const inner = new THREE.Group();
    inner.add(boxMesh(4.2, 1.15, 1.85, paint, { metal: 0.4 }, 0, 0.7, 0));
    inner.add(boxMesh(2.0, 0.12, 1.7, metal, { metal: 0.6 }, -0.35, 1.35, 0));
    inner.add(boxMesh(1.6, 0.08, 1.5, glass, { glass: true }, -0.2, 0.2, 0));
    for (const [wx, wz] of [[-1.35, -0.85], [1.25, -0.85], [-1.35, 0.85], [1.25, 0.85]]) {
      addWheel(inner, wx, 1.35, wz, true, 0.36, 0.26);
    }
    inner.rotation.z = Math.PI;
    inner.position.y = 1.5;
    g.add(inner);
    return g;
  }

  const crushed = style === 'crushed';
  // Underbody / chassis
  g.add(boxMesh(4.0, 0.22, 1.7, '#1a1a1a', { rough: 0.9, metal: 0.2 }, 0, 0.28, 0));
  // Main body
  g.add(boxMesh(4.15, crushed ? 0.72 : 0.85, 1.88, paint, { metal: 0.4, rough: 0.5 }, 0, crushed ? 0.7 : 0.78, 0));
  // Hood
  g.add(boxMesh(1.15, 0.12, 1.7, paint, { metal: 0.45 }, 1.35, crushed ? 1.05 : 1.22, 0));
  // Cabin
  const cabH = crushed ? 0.28 : 0.72;
  g.add(boxMesh(1.85, cabH, 1.72, paint, { metal: 0.35 }, -0.15, crushed ? 1.2 : 1.5, 0));
  // Trunk
  g.add(boxMesh(0.95, 0.14, 1.7, paint, { metal: 0.4 }, -1.55, crushed ? 1.05 : 1.2, 0));
  if (!crushed) {
    // Windows
    g.add(boxMesh(1.55, 0.55, 1.62, glass, { glass: true }, -0.15, 1.52, 0));
    g.add(boxMesh(0.08, 0.42, 1.5, glass, { glass: true }, 0.78, 1.48, 0)); // windshield
    g.add(boxMesh(0.08, 0.38, 1.45, glass, { glass: true }, -1.05, 1.45, 0)); // rear
    // Side mirrors
    g.add(boxMesh(0.12, 0.1, 0.22, metal, { metal: 0.6 }, 0.55, 1.25, 1.05));
    g.add(boxMesh(0.12, 0.1, 0.22, metal, { metal: 0.6 }, 0.55, 1.25, -1.05));
    // Bumpers
    g.add(boxMesh(0.22, 0.28, 1.92, '#222', { metal: 0.5 }, 2.12, 0.55, 0));
    g.add(boxMesh(0.22, 0.28, 1.92, '#222', { metal: 0.5 }, -2.12, 0.55, 0));
    // Lights
    g.add(boxMesh(0.12, 0.16, 0.35, '#f5f0d8', { emissive: '#f5e6a8', metal: 0.2 }, 2.2, 0.72, 0.55));
    g.add(boxMesh(0.12, 0.16, 0.35, '#f5f0d8', { emissive: '#f5e6a8', metal: 0.2 }, 2.2, 0.72, -0.55));
    g.add(boxMesh(0.1, 0.14, 0.32, '#a01818', { emissive: '#501010', metal: 0.2 }, -2.2, 0.7, 0.55));
    g.add(boxMesh(0.1, 0.14, 0.32, '#a01818', { emissive: '#501010', metal: 0.2 }, -2.2, 0.7, -0.55));
    // Roof rail hint
    g.add(boxMesh(1.6, 0.05, 1.55, darken(paint, 0.15), { metal: 0.4 }, -0.15, 1.88, 0));
  } else {
    g.add(boxMesh(1.7, 0.12, 1.55, metal, { metal: 0.5 }, -0.2, 1.35, 0));
    g.add(boxMesh(0.2, 0.35, 1.7, '#3a2018', { rough: 0.9 }, 1.6, 0.95, 0)); // crumpled hood
  }

  for (const [wx, wz] of [[-1.35, -0.92], [1.3, -0.92], [-1.35, 0.92], [1.3, 0.92]]) {
    if (crushed && Math.random() < 0.15) continue;
    addWheel(g, wx, 0.38, wz, true, crushed ? 0.34 : 0.38, 0.28);
  }
  // Exhaust
  g.add(cylMesh(0.06, 0.06, 0.35, '#333', { metal: 0.8 }, -2.0, 0.22, 0.55, 0, 0, Math.PI / 2));
  return g;
}

/** City bus — long body, windows strip, doors, wheels. */
function buildBus(color) {
  const g = new THREE.Group();
  g.name = 'vehicle-bus';
  const paint = color || '#8f8458';
  const glass = '#1a2228';
  g.add(boxMesh(9.8, 0.35, 2.35, '#1a1a1a', { rough: 0.9 }, 0, 0.4, 0));
  g.add(boxMesh(10.0, 2.15, 2.45, paint, { metal: 0.3, rough: 0.55 }, 0, 1.55, 0));
  g.add(boxMesh(9.5, 0.18, 2.35, darken(paint, 0.2), { metal: 0.35 }, 0, 2.72, 0));
  // Window band
  g.add(boxMesh(8.6, 0.85, 2.38, glass, { glass: true }, 0.2, 1.95, 0));
  // Front windshield
  g.add(boxMesh(0.12, 1.1, 2.2, glass, { glass: true }, 4.85, 1.7, 0));
  // Door recess
  g.add(boxMesh(0.9, 1.6, 0.08, darken(paint, 0.1), { metal: 0.3 }, 3.2, 1.3, 1.24));
  // Bumpers / lights
  g.add(boxMesh(0.25, 0.4, 2.5, '#222', { metal: 0.5 }, 5.05, 0.7, 0));
  g.add(boxMesh(0.25, 0.4, 2.5, '#222', { metal: 0.5 }, -5.05, 0.7, 0));
  g.add(boxMesh(0.1, 0.2, 0.45, '#f5f0d8', { emissive: '#f5e6a8' }, 5.15, 1.0, 0.7));
  g.add(boxMesh(0.1, 0.2, 0.45, '#f5f0d8', { emissive: '#f5e6a8' }, 5.15, 1.0, -0.7));
  g.add(boxMesh(0.1, 0.18, 0.4, '#a01818', { emissive: '#501010' }, -5.15, 1.0, 0.7));
  g.add(boxMesh(0.1, 0.18, 0.4, '#a01818', { emissive: '#501010' }, -5.15, 1.0, -0.7));
  // Side destination board
  g.add(boxMesh(2.4, 0.28, 0.06, '#111', { rough: 0.8 }, 2.5, 2.45, 1.24));
  for (const [wx, wz] of [[-3.6, -1.15], [3.5, -1.15], [-3.6, 1.15], [3.5, 1.15]]) {
    addWheel(g, wx, 0.48, wz, true, 0.48, 0.32);
  }
  return g;
}

/** Semi truck — cab + chassis + container or flatbed. */
function buildTruck(color, cargo = 'container') {
  const g = new THREE.Group();
  g.name = 'vehicle-truck';
  const cab = color || '#6a2f26';
  const glass = '#1a2228';
  // Chassis rail
  g.add(boxMesh(10.5, 0.35, 2.1, '#2a2c30', { metal: 0.55 }, 0.2, 0.55, 0));
  // Cab
  g.add(boxMesh(2.3, 1.55, 2.35, cab, { metal: 0.35 }, -4.2, 1.35, 0));
  g.add(boxMesh(2.0, 0.95, 2.2, cab, { metal: 0.3 }, -4.15, 2.5, 0));
  g.add(boxMesh(0.1, 0.85, 2.05, glass, { glass: true }, -3.05, 2.35, 0));
  g.add(boxMesh(1.6, 0.7, 2.15, glass, { glass: true }, -4.15, 2.45, 0));
  // Bumper / lights
  g.add(boxMesh(0.28, 0.45, 2.4, '#222', { metal: 0.5 }, -5.4, 0.75, 0));
  g.add(boxMesh(0.1, 0.18, 0.4, '#f5f0d8', { emissive: '#f5e6a8' }, -5.5, 1.05, 0.7));
  g.add(boxMesh(0.1, 0.18, 0.4, '#f5f0d8', { emissive: '#f5e6a8' }, -5.5, 1.05, -0.7));
  // Exhaust stack
  g.add(cylMesh(0.1, 0.1, 2.2, '#3a3a3a', { metal: 0.7 }, -3.3, 2.4, 1.15));
  // Fuel tanks
  g.add(cylMesh(0.28, 0.28, 1.4, '#2f4f5f', { metal: 0.5 }, -2.6, 0.85, 1.15, 0, 0, Math.PI / 2));
  g.add(cylMesh(0.28, 0.28, 1.4, '#2f4f5f', { metal: 0.5 }, -2.6, 0.85, -1.15, 0, 0, Math.PI / 2));

  if (cargo === 'container') {
    const cont = pickContainer();
    g.add(boxMesh(7.0, 2.55, 2.4, cont, { metal: 0.45, rough: 0.55 }, 1.1, 2.15, 0));
    // Corrugation hint strips
    for (let i = -2; i <= 2; i++) {
      g.add(boxMesh(0.08, 2.4, 2.42, darken(cont, 0.12), { metal: 0.5 }, 1.1 + i * 1.2, 2.15, 0));
    }
  } else {
    g.add(boxMesh(6.8, 0.18, 2.25, '#3a3a3a', { metal: 0.5 }, 1.0, 1.25, 0));
    g.add(boxMesh(1.2, 1.1, 1.1, '#6e5234', { rough: 0.85 }, 0.2, 1.85, 0));
    g.add(boxMesh(1.2, 1.1, 1.1, '#7a5c3a', { rough: 0.85 }, 1.6, 1.85, 0.15));
    g.add(boxMesh(1.2, 0.9, 1.1, '#6e5234', { rough: 0.85 }, 2.9, 1.75, -0.1));
  }

  for (const wx of [-4.5, -1.6, 2.0, 3.4]) {
    for (const wz of [-1.2, 1.2]) {
      addWheel(g, wx, 0.5, wz, true, 0.5, 0.34);
    }
  }
  return g;
}

const CONTAINER_PALETTE = ['#2f5f7a', '#8a3a2a', '#3d6b4f', '#c4a035', '#4a4a4a'];
function pickContainer() {
  return CONTAINER_PALETTE[Math.floor(Math.random() * CONTAINER_PALETTE.length)];
}

/**
 * @param {{ vehicleType?: string, vehicleStyle?: string, color?: string, cargo?: string, alongX?: boolean, rotY?: number }} spec
 * @returns {THREE.Group}
 */
export function buildVehicle3D(spec = {}) {
  const type = spec.vehicleType || 'sedan';
  const style = spec.vehicleStyle || 'intact';
  const color = spec.color || '#6a2f26';
  let mesh;
  if (type === 'bus') mesh = buildBus(color);
  else if (type === 'truck') mesh = buildTruck(color, spec.cargo || 'container');
  else mesh = buildSedan(color, style);

  const yaw = spec.rotY != null
    ? spec.rotY
    : (spec.alongX === false ? Math.PI / 2 : 0);
  mesh.rotation.y = yaw;
  mesh.userData.vehicle = true;
  mesh.userData.vehicleType = type;
  return mesh;
}

/** Place a vehicle at world x,z grounded on y=0. */
export function placeVehicle3D(parent, spec, x, z) {
  const mesh = buildVehicle3D(spec);
  mesh.position.set(x, 0, z);
  parent.add(mesh);
  return mesh;
}
