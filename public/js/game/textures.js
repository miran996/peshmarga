import * as THREE from 'three';

/**
 * Procedural textures, generated once and cached: surface detail maps (grey, multiplied onto each material's
 * colour so palettes stay intact), matching normal maps, and camouflage patterns for operator uniforms.
 */
const cache = new Map();

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function toTexture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.shared = true;
  return t;
}

/** Tileable value noise sampled at integer grid `cells`, smooth-interpolated. */
function noiseField(size, cells, R) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = R();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, fy = (y / size) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i, j) => g[((j % cells) * cells) + (i % cells)];
      const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function fbm(size, R, octaves = [[4, 0.5], [8, 0.25], [16, 0.15], [32, 0.1]]) {
  const out = new Float32Array(size * size);
  for (const [cells, amp] of octaves) {
    const n = noiseField(size, cells, R);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
  }
  return out;
}

/** Draws a grey detail map and a height field side by side via a per-pixel shader function. */
function makeDetail(key, size, shade) {
  if (cache.has(key)) return cache.get(key);
  const R = rng(key.length * 7919 + key.charCodeAt(0));
  const ctx = { R, size, fbm: (oct) => fbm(size, R, oct), noise: (cells) => noiseField(size, cells, R) };
  const { value, height, post } = shade(ctx);
  const [c, g] = canvas(size);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(0, Math.min(255, value[i] * 255));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (post) post(g, R, size);
  const heightCanvas = height ? heightToNormal(height, size, 2.2) : null;
  const res = { map: toTexture(c, true), normal: heightCanvas ? toTexture(heightCanvas, false) : null };
  cache.set(key, res);
  return res;
}

function heightToNormal(h, size, strength) {
  const [c, g] = canvas(size);
  const img = g.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function cracks(g, R, size, count, alpha) {
  for (let i = 0; i < count; i++) {
    g.strokeStyle = `rgba(20,18,16,${alpha * (0.5 + R() * 0.5)})`;
    g.lineWidth = 0.6 + R() * 1.2;
    g.beginPath();
    let x = R() * size, y = R() * size;
    g.moveTo(x, y);
    for (let k = 0; k < 7; k++) { x += (R() - 0.5) * size * 0.12; y += (R() - 0.5) * size * 0.12; g.lineTo(x, y); }
    g.stroke();
  }
}

const SHADERS = {
  concrete: ({ R, size, fbm, noise }) => {
    const base = fbm(), fine = noise(64), stains = noise(3);
    const value = new Float32Array(size * size), height = new Float32Array(size * size);
    for (let i = 0; i < value.length; i++) {
      const pit = fine[i] > 0.93 ? -0.25 : 0;
      value[i] = 0.78 + (base[i] - 0.5) * 0.28 + (fine[i] - 0.5) * 0.12 - Math.max(0, stains[i] - 0.6) * 0.5 + pit;
      height[i] = base[i] * 0.6 + fine[i] * 0.4 + pit * 2;
    }
    return { value, height, post: (g) => { cracks(g, R, size, 14, 0.55); streaks(g, R, size, 10); } };
  },
  plaster: ({ R, size, fbm, noise }) => {
    const base = fbm(), chips = noise(12);
    const value = new Float32Array(size * size), height = new Float32Array(size * size);
    for (let i = 0; i < value.length; i++) {
      const chip = chips[i] > 0.78 ? -0.18 : 0;
      value[i] = 0.84 + (base[i] - 0.5) * 0.22 + chip;
      height[i] = base[i] * 0.5 + (chip ? -0.6 : 0.2);
    }
    return { value, height, post: (g) => cracks(g, R, size, 8, 0.4) };
  },
  metal: ({ R, size, fbm, noise }) => {
    const base = fbm(), rust = noise(5);
    const value = new Float32Array(size * size), height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const seam = (x % (size / 4) < 2) || (y % (size / 2) < 2) ? -0.3 : 0;
        const brush = Math.sin(y * 0.9 + base[i] * 12) * 0.03;
        value[i] = 0.8 + (base[i] - 0.5) * 0.2 + brush + seam - Math.max(0, rust[i] - 0.62) * 0.8;
        height[i] = seam ? 0 : 0.5 + base[i] * 0.3;
      }
    }
    return { value, height, post: (g) => streaks(g, R, size, 16) };
  },
  corrugated: ({ size, fbm, noise }) => {
    const base = fbm(), rust = noise(4);
    const value = new Float32Array(size * size), height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const wave = Math.sin((x / size) * Math.PI * 2 * 16);
        value[i] = 0.8 + wave * 0.07 + (base[i] - 0.5) * 0.2 - Math.max(0, rust[i] - 0.6) * 0.7 * (1 - y / size * 0.5);
        height[i] = wave * 0.5 + 0.5;
      }
    }
    return { value, height };
  },
  wood: ({ R, size, noise }) => {
    const grain = noise(6), knots = noise(10);
    const value = new Float32Array(size * size), height = new Float32Array(size * size);
    const plank = size / 4;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const gap = y % plank < 2 ? -0.35 : 0;
        const rings = Math.sin((x * 0.08 + grain[i] * 9 + Math.floor(y / plank) * 3.7)) * 0.08;
        value[i] = 0.78 + rings + gap - (knots[i] > 0.85 ? 0.15 : 0) + (R() - 0.5) * 0.04;
        height[i] = gap ? 0 : 0.6 + rings;
      }
    }
    return { value, height };
  },
  fabric: ({ size, fbm }) => {
    const base = fbm([[4, 0.6], [16, 0.4]]);
    const value = new Float32Array(size * size), height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const weave = ((x >> 1) + (y >> 1)) % 2 ? 0.05 : -0.05;
        value[i] = 0.82 + weave + (base[i] - 0.5) * 0.25;
        height[i] = 0.5 + weave * 4;
      }
    }
    return { value, height };
  },
  rock: ({ size, fbm }) => {
    const base = fbm([[3, 0.5], [6, 0.3], [12, 0.2], [32, 0.15]]);
    const value = new Float32Array(size * size), height = new Float32Array(size * size);
    for (let i = 0; i < value.length; i++) {
      value[i] = 0.72 + (base[i] - 0.5) * 0.5;
      height[i] = base[i];
    }
    return { value, height };
  },
  bark: ({ size, noise }) => {
    const n = noise(8), fine = noise(40);
    const value = new Float32Array(size * size), height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const ridge = Math.abs(Math.sin(x * 0.2 + n[i] * 6));
        value[i] = 0.65 + ridge * 0.25 + (fine[i] - 0.5) * 0.1;
        height[i] = ridge;
      }
    }
    return { value, height };
  },
  foliage: ({ size, noise, fbm }) => {
    const leaves = noise(32), base = fbm();
    const value = new Float32Array(size * size), height = new Float32Array(size * size);
    for (let i = 0; i < value.length; i++) {
      value[i] = 0.7 + (leaves[i] - 0.5) * 0.45 + (base[i] - 0.5) * 0.2;
      height[i] = leaves[i];
    }
    return { value, height };
  },
  asphalt: ({ R, size, noise, fbm }) => {
    const fine = noise(96), base = fbm();
    const value = new Float32Array(size * size), height = new Float32Array(size * size);
    for (let i = 0; i < value.length; i++) {
      value[i] = 0.8 + (fine[i] - 0.5) * 0.25 + (base[i] - 0.5) * 0.2;
      height[i] = fine[i] * 0.5;
    }
    return { value, height, post: (g) => cracks(g, R, size, 10, 0.5) };
  },
  water: ({ size, fbm }) => {
    const base = fbm([[4, 0.5], [8, 0.3], [16, 0.2]]);
    const value = new Float32Array(size * size), height = new Float32Array(size * size);
    for (let i = 0; i < value.length; i++) { value[i] = 0.85 + (base[i] - 0.5) * 0.3; height[i] = base[i]; }
    return { value, height };
  },
};

function streaks(g, R, size, count) {
  for (let i = 0; i < count; i++) {
    const x = R() * size, w = 2 + R() * 6, h = size * (0.2 + R() * 0.5);
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgba(30,26,22,${0.12 + R() * 0.2})`);
    grad.addColorStop(1, 'rgba(30,26,22,0)');
    g.fillStyle = grad;
    g.fillRect(x, R() * size * 0.3, w, h);
  }
}

/** Detail + normal map pair for a surface type (null for untextured surfaces). */
export function surfaceTextures(surface, size = 256) {
  const shade = SHADERS[surface];
  return shade ? makeDetail(`${surface}:${size}`, size, shade) : null;
}

/** Tileable camouflage pattern texture. pattern: multicam | arid | snow | digital | woodland | urban. */
export function camoTexture(camo) {
  const key = `camo:${camo.pattern}:${camo.colors.join(',')}`;
  if (cache.has(key)) return cache.get(key);
  const [base, c1, c2, c3] = camo.colors;
  const size = 256;
  const [c, g] = canvas(size);
  const R = rng(key.length * 131 + camo.colors[0].charCodeAt(1));
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  const blob = (color, count, rMin, rMax, stretch = 1.6) => {
    g.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const x = R() * size, y = R() * size, r = rMin + R() * (rMax - rMin);
      g.beginPath();
      const pts = 9;
      for (let k = 0; k <= pts; k++) {
        const a = (k / pts) * Math.PI * 2, rr = r * (0.55 + R() * 0.6);
        const px = x + Math.cos(a) * rr * stretch, py = y + Math.sin(a) * rr;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      for (const ox of [-size, size]) for (const oy of [-size, 0, size]) if (x + ox > -rMax * 2 && x + ox < size + rMax * 2) {
        g.save(); g.translate(ox, oy); g.fill(); g.restore();
      }
    }
  };
  switch (camo.pattern) {
    case 'digital': {
      const px = 8;
      for (let y = 0; y < size; y += px) {
        for (let x = 0; x < size; x += px) {
          const r = R();
          g.fillStyle = r < 0.3 ? c1 : r < 0.5 ? c2 : r < 0.56 ? c3 : base;
          g.fillRect(x, y, px, px);
        }
      }
      break;
    }
    case 'woodland':
      blob(c1, 26, 16, 34, 2.2);
      blob(c2, 20, 12, 26, 2.4);
      blob(c3, 30, 5, 12, 2);
      break;
    case 'snow':
      blob(c1, 30, 10, 24);
      blob(c2, 24, 8, 18);
      blob(c3, 40, 2, 5, 1);
      break;
    default:
      blob(c1, 34, 10, 24);
      blob(c2, 30, 8, 20);
      blob(c3, 60, 2, 6, 3);
      g.strokeStyle = c3;
      g.lineWidth = 1.5;
      for (let i = 0; i < 40; i++) {
        const x = R() * size, y = R() * size;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 14, y + R() * 16); g.stroke();
      }
  }
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (R() - 0.5) * 16;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const tex = toTexture(c, true);
  tex.repeat.set(2, 2);
  cache.set(key, tex);
  return tex;
}

/** Flat national patch for vest stickers. stripes top→bottom; optional sun / mark / triangle. */
export function flagTexture(flag) {
  const key = `flag:${flag.id}:${(flag.stripes || []).join(',')}:${flag.sun || ''}:${flag.mark || ''}:${flag.triangle || ''}`;
  if (cache.has(key)) return cache.get(key);
  const size = 128;
  const [c, g] = canvas(size);
  const stripes = flag.stripes || ['#888', '#aaa', '#666'];
  const band = size / stripes.length;
  for (let i = 0; i < stripes.length; i++) {
    g.fillStyle = stripes[i];
    g.fillRect(0, i * band, size, band + 1);
  }
  if (flag.sun) {
    g.fillStyle = flag.sun;
    g.beginPath();
    g.arc(size / 2, size / 2, size * 0.18, 0, Math.PI * 2);
    g.fill();
    if (flag.id === 'kurdistan') {
      for (let i = 0; i < 21; i++) {
        const a = (i / 21) * Math.PI * 2;
        g.beginPath();
        g.moveTo(size / 2 + Math.cos(a) * size * 0.18, size / 2 + Math.sin(a) * size * 0.18);
        g.lineTo(size / 2 + Math.cos(a) * size * 0.28, size / 2 + Math.sin(a) * size * 0.28);
        g.strokeStyle = flag.sun;
        g.lineWidth = 2;
        g.stroke();
      }
    }
  }
  if (flag.mark) {
    g.fillStyle = flag.mark;
    g.beginPath();
    g.arc(size * 0.42, size / 2, size * 0.16, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(size * 0.48, size / 2, size * 0.13, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';
  }
  if (flag.triangle) {
    g.fillStyle = flag.triangle;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(size * 0.38, size / 2);
    g.lineTo(0, size);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, size - 4, size - 4);
  const tex = toTexture(c, true);
  tex.repeat.set(1, 1);
  cache.set(key, tex);
  return tex;
}

/** Soft radial sprite used for film grain on Low quality (CSS) and particles. */
export function grainDataUrl() {
  if (cache.has('grain')) return cache.get('grain');
  const [c, g] = canvas(128);
  const img = g.createImageData(128, 128);
  const R = rng(4242);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = R() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 28;
  }
  g.putImageData(img, 0, 0);
  const url = c.toDataURL('image/png');
  cache.set('grain', url);
  return url;
}
