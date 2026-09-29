/**
 * Deterministic battlefield layouts shared by server (hit detection) and client (render, physics, AI).
 * All collision volumes are axis-aligned boxes. `surface` hints tell the renderer which detail texture to use.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StickMap = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIZE = 120;
  const HALF = SIZE / 2;
  const WALL_H = 5;
  const DEFAULT_MAP = 'ruins';

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const CAR_COLORS = ['#3b3431', '#5e4636', '#4f5a60', '#6a2f26', '#44423a', '#2c3438'];
  const BURNT_CARS = ['#2b2826', '#3a2e27', '#33302c', '#4a3a2e', '#2e2b28'];
  const CONTAINER_COLORS = ['#6b3a2e', '#2f4f5f', '#5a6b3a', '#7a6a3a'];
  const CONCRETE = ['#8f8d88', '#9a968f', '#85827c', '#a19c93', '#7d7a74'];
  const PLASTER = ['#a39a88', '#968d7d', '#aca290', '#8f887b'];
  const RUBBLE = ['#8a8680', '#77736d', '#96918a', '#6b6761', '#827b70'];
  const ROCKS = ['#6f6b63', '#5f5c55', '#7c776d'];

  // =================================================================
  // Building kit: primitives every layout composes from.
  // =================================================================
  function makeKit(def) {
    const S = def.size || SIZE, H = S / 2;
    const R = mulberry32(def.seed);
    const rand = (a, b) => a + (b - a) * R();
    const pick = (arr) => arr[Math.floor(R() * arr.length)];

    const boxes = [];
    const decor = [];
    const doors = [];
    const roads = [];
    const smoke = [];
    const spawns = def.spawns.map(([x, z]) => ({ x, z }));

    function box(x, y0, z, w, h, d, kind, color, opts) {
      const b = {
        x, y: y0 + h / 2, z, w, h, d, kind, color,
        minX: x - w / 2, maxX: x + w / 2,
        minY: y0, maxY: y0 + h,
        minZ: z - d / 2, maxZ: z + d / 2,
      };
      if (opts) Object.assign(b, opts);
      boxes.push(b);
      return b;
    }
    const deco = (o) => (decor.push(o), o);

    function overlaps(minX, maxX, minZ, maxZ, pad) {
      for (const b of boxes) {
        if (b.maxY < 0.3) continue;
        if (minX < b.maxX + pad && maxX > b.minX - pad && minZ < b.maxZ + pad && maxZ > b.minZ - pad) return true;
      }
      return false;
    }
    const nearAny = (list, x, z, r) => list.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < r * r);
    const inside = (x, z, margin) => Math.abs(x) < H - margin && Math.abs(z) < H - margin;

    function road(x, z, len, width, alongX, color, dash, surface = 'asphalt') {
      const w = alongX ? len : width, d = alongX ? width : len;
      roads.push({ x, z, w, d });
      deco({ type: 'plane', x, z, w, d, color, y: 0.01 + roads.length * 0.002, surface });
      if (!dash) return;
      for (let p = -len / 2 + 4; p <= len / 2 - 4; p += 6) {
        if (R() > 0.8) continue;
        deco(alongX
          ? { type: 'plane', x: x + p, z, w: 2.4, d: 0.18, color: dash, y: 0.03 }
          : { type: 'plane', x, z: z + p, w: 0.18, d: 2.4, color: dash, y: 0.03 });
      }
    }

    function boundary(color, pillar, hazard = true) {
      box(0, 0, -H - 0.5, S + 2, WALL_H, 1, 'boundary', color);
      box(0, 0, H + 0.5, S + 2, WALL_H, 1, 'boundary', color);
      box(-H - 0.5, 0, 0, 1, WALL_H, S, 'boundary', color);
      box(H + 0.5, 0, 0, 1, WALL_H, S, 'boundary', color);
      for (let p = -H + 5; p < H; p += 10) {
        deco({ type: 'box', x: p, y: 2.75, z: -H + 0.1, w: 0.7, h: 5.5, d: 0.5, color: pillar });
        deco({ type: 'box', x: p, y: 2.75, z: H - 0.1, w: 0.7, h: 5.5, d: 0.5, color: pillar });
        deco({ type: 'box', x: -H + 0.1, y: 2.75, z: p, w: 0.5, h: 5.5, d: 0.7, color: pillar });
        deco({ type: 'box', x: H - 0.1, y: 2.75, z: p, w: 0.5, h: 5.5, d: 0.7, color: pillar });
      }
      if (!hazard) return;
      deco({ type: 'hazard', x: 0, y: 4.4, z: -H + 0.02, w: S, h: 0.5, d: 0.05 });
      deco({ type: 'hazard', x: 0, y: 4.4, z: H - 0.02, w: S, h: 0.5, d: 0.05 });
      deco({ type: 'hazard', x: -H + 0.02, y: 4.4, z: 0, w: 0.05, h: 0.5, d: S });
      deco({ type: 'hazard', x: H - 0.02, y: 4.4, z: 0, w: 0.05, h: 0.5, d: S });
    }

    const rebar = (x, y, z) => {
      for (let k = 0; k < 3; k++) {
        deco({ type: 'cyl', x: x + rand(-0.5, 0.5), y: y + 0.35, z: z + rand(-0.15, 0.15), r: 0.02, h: rand(0.5, 1.1),
          color: '#4a3b30', rx: rand(-0.5, 0.5), rz: rand(-0.5, 0.5), surface: 'metal' });
      }
    };

    /** Single-storey segmented walls with doors, windows, breaches and jagged tops. */
    function house(cx, cz, w, d, o = {}) {
      const t = 0.3, Ht = o.H || 3.2, dmg = o.damage ?? 1;
      const color = pick(o.palette || PLASTER);
      const surface = o.surface || 'plaster';
      const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
      const sides = [
        { axis: 'x', fixed: z0, from: x0 - t / 2, to: x1 + t / 2, door: true },
        { axis: 'x', fixed: z1, from: x0 - t / 2, to: x1 + t / 2, door: true },
        { axis: 'z', fixed: x0, from: z0 + t / 2, to: z1 - t / 2, door: o.allDoors || R() < 0.4 },
        { axis: 'z', fixed: x1, from: z0 + t / 2, to: z1 - t / 2, door: o.allDoors || R() < 0.4 },
      ];
      if (o.floor !== false) deco({ type: 'plane', x: cx, z: cz, w, d, color: o.floor || '#57524a', y: 0.015, surface: 'concrete' });
      for (const side of sides) {
        const len = side.to - side.from;
        const n = Math.max(3, Math.round(len / 2.2));
        const sl = len / n;
        const doorIdx = side.door ? (o.centerDoors ? Math.floor(n / 2) : 1 + Math.floor(R() * (n - 2))) : -1;
        for (let i = 0; i < n; i++) {
          const c = side.from + sl * (i + 0.5);
          const seg = (y0, h) => {
            if (h <= 0.05) return;
            if (side.axis === 'x') box(c, y0, side.fixed, sl, h, t, 'wall', color, { surface });
            else box(side.fixed, y0, c, t, h, sl, 'wall', color, { surface });
          };
          const top = R() < 0.45 * dmg ? Ht - rand(0.4, 1.7) * Math.min(1, Ht / 3.2) : Ht;
          const px = side.axis === 'x' ? c : side.fixed;
          const pz = side.axis === 'x' ? side.fixed : c;
          if (i === doorIdx) {
            doors.push({ x: px, z: pz });
            if (top > 2.4) seg(2.2, top - 2.2);
          } else if (i > 0 && i < n - 1 && R() < 0.12 * dmg) {
            seg(0, rand(0.25, 0.45));
            if (surface !== 'wood') rebar(px, 0.2, pz);
          } else if (i > 0 && i < n - 1 && R() < 0.38) {
            seg(0, 1.0);
            if (top > 2.1) seg(2.0, top - 2.0);
          } else {
            seg(0, top);
          }
        }
      }
      if (o.interior !== false && w > 9 && R() < 0.7) {
        const iz = cz + rand(-d / 5, d / 5);
        box(cx - w / 4, 0, iz, w / 2 - 0.6, rand(1.2, 2.6), 0.25, 'wall', color, { surface });
      }
      if (o.debris !== false) {
        deco({ type: 'box', x: cx + rand(-w / 4, w / 4), y: 0.9, z: cz + rand(-d / 4, d / 4), w: w * 0.45, h: 0.2, d: d * 0.5,
          color: o.debrisColor || '#6d655a', rx: rand(-0.5, 0.5), rz: rand(-0.5, 0.5), ry: rand(0, Math.PI), surface });
      }
      if (o.roof) {
        const roofSurface = o.roofSurface || 'metal';
        deco({ type: 'box', x: cx, y: Ht + 0.12, z: cz - d / 4, w: w + 0.6, h: 0.14, d: d / 2 + 0.5, color: o.roof, rx: -0.28, surface: roofSurface });
        if (R() < 0.6) deco({ type: 'box', x: cx, y: Ht + 0.12, z: cz + d / 4, w: w + 0.6, h: 0.14, d: d / 2 + 0.5, color: o.roof, rx: 0.28, surface: roofSurface });
      }
      return { cx, cz, w, d };
    }

    /**
     * Gutted multi-storey concrete block: window rows, blown-out sections, broken floor slabs with rebar,
     * and optionally an interior staircase along the west wall up to the first floor.
     */
    function building(cx, cz, w, d, o = {}) {
      const t = 0.35, FH = 3.3, floors = o.floors || 2, stairs = !!o.stairs;
      const color = pick(o.palette || CONCRETE);
      const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
      deco({ type: 'plane', x: cx, z: cz, w, d, color: '#55534f', y: 0.015, surface: 'concrete' });
      const sides = [
        { axis: 'x', fixed: z0, from: x0 - t / 2, to: x1 + t / 2, door: true },
        { axis: 'x', fixed: z1, from: x0 - t / 2, to: x1 + t / 2, door: true },
        { axis: 'z', fixed: x0, from: z0 + t / 2, to: z1 - t / 2, door: !stairs && R() < 0.5 },
        { axis: 'z', fixed: x1, from: z0 + t / 2, to: z1 - t / 2, door: R() < 0.5 },
      ];
      const STEPS = Math.round(FH / 0.4), stepH = FH / STEPS, run = STEPS * 0.6;
      const slabBox = (ax0, ax1, az0, az1, y) => {
        if (ax1 - ax0 < 0.6 || az1 - az0 < 0.6) return;
        box((ax0 + ax1) / 2, y, (az0 + az1) / 2, ax1 - ax0, 0.25, az1 - az0, 'slab', color, { surface: 'concrete' });
        if (R() < 0.6) rebar(R() < 0.5 ? ax0 : ax1, y - 0.1, (az0 + az1) / 2);
      };
      for (let f = 0; f < floors; f++) {
        const y0 = f * FH, top = f === floors - 1;
        for (const side of sides) {
          const len = side.to - side.from;
          const n = Math.max(3, Math.round(len / 2.4));
          const sl = len / n;
          const doorIdx = f === 0 && side.door ? 1 + Math.floor(R() * (n - 2)) : -1;
          for (let i = 0; i < n; i++) {
            const c = side.from + sl * (i + 0.5);
            const px = side.axis === 'x' ? c : side.fixed;
            const pz = side.axis === 'x' ? side.fixed : c;
            const seg = (ya, h) => {
              if (h <= 0.05) return;
              if (side.axis === 'x') box(c, ya, side.fixed, sl, h, t, 'wall', color, { surface: 'concrete' });
              else box(side.fixed, ya, c, t, h, sl, 'wall', color, { surface: 'concrete' });
            };
            const inner = i > 0 && i < n - 1;
            if (f > 0 && inner && R() < (top ? 0.24 : 0.12)) {
              if (R() < 0.5) seg(y0, rand(0.3, 1.0));
              rebar(px, y0 + 0.4, pz);
              continue;
            }
            const h = top && R() < 0.5 ? FH - rand(0.5, 2.1) : FH;
            if (i === doorIdx) {
              doors.push({ x: px, z: pz });
              seg(y0 + 2.3, FH - 2.3);
            } else if (inner && R() < (f === 0 ? 0.35 : 0.62)) {
              seg(y0, 1.0);
              if (h > 2.2) seg(y0 + 2.2, h - 2.2);
            } else {
              seg(y0, h);
            }
          }
        }
        const sy = y0 + FH - 0.25;
        if (f === 0 && stairs) {
          const oz1 = z0 + 0.9 + run + 0.5, ox1 = x0 + 2.1;
          slabBox(ox1, x1 + t / 2, z0 - t / 2, z1 + t / 2, sy);
          slabBox(x0 - t / 2, ox1, oz1, z1 + t / 2, sy);
        } else if (!top || R() < 0.65) {
          const qx = cx + rand(-w / 6, w / 6), qz = cz + rand(-d / 6, d / 6);
          for (const [ax0, ax1] of [[x0 - t / 2, qx], [qx, x1 + t / 2]]) {
            for (const [az0, az1] of [[z0 - t / 2, qz], [qz, z1 + t / 2]]) if (R() > (top ? 0.4 : 0.22)) slabBox(ax0, ax1, az0, az1, sy);
          }
        }
      }
      if (stairs) {
        const sx = x0 + t / 2 + 0.75;
        for (let s = 0; s < STEPS; s++) {
          box(sx, 0, z0 + 0.9 + s * 0.6 + 0.3, 1.3, (s + 1) * stepH, 0.6, 'stair', color, { surface: 'concrete' });
        }
      }
      if (w >= 10 && d >= 8 && !stairs) box(cx + rand(-1, 1), 0, cz + rand(-1, 1), 0.45, FH * floors - 0.3, 0.45, 'pillar', color, { surface: 'concrete' });
      deco({ type: 'box', x: cx + rand(-w / 4, w / 4), y: 0.25, z: cz + rand(-d / 4, d / 4), w: w * 0.4, h: 0.25, d: d * 0.35,
        color: '#6f6b64', rx: rand(-0.35, 0.35), rz: rand(-0.35, 0.35), ry: rand(0, Math.PI), surface: 'concrete' });
      return { cx, cz, w, d };
    }

    /** Large industrial shed with roll-up doors, roof trusses and storage racks. */
    function hall(cx, cz, w, d, o = {}) {
      const t = 0.35, Ht = o.H || 5.2;
      const color = o.color || pick(['#6f7479', '#646b70', '#77736a']);
      const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
      deco({ type: 'plane', x: cx, z: cz, w, d, color: '#3e4247', y: 0.015, surface: 'concrete' });
      const sides = [
        { axis: 'x', fixed: z0, from: x0 - t / 2, to: x1 + t / 2 },
        { axis: 'x', fixed: z1, from: x0 - t / 2, to: x1 + t / 2 },
        { axis: 'z', fixed: x0, from: z0 + t / 2, to: z1 - t / 2 },
        { axis: 'z', fixed: x1, from: z0 + t / 2, to: z1 - t / 2 },
      ];
      for (const side of sides) {
        const len = side.to - side.from;
        const n = Math.max(3, Math.round(len / 3));
        const sl = len / n;
        const doorIdx = len > 12 ? [Math.round(n / 3) - 1, n - Math.round(n / 3)] : [Math.floor(n / 2)];
        for (let i = 0; i < n; i++) {
          const c = side.from + sl * (i + 0.5);
          const seg = (y0, h) => {
            if (h <= 0.05) return;
            if (side.axis === 'x') box(c, y0, side.fixed, sl, h, t, 'wall', color, { surface: 'corrugated' });
            else box(side.fixed, y0, c, t, h, sl, 'wall', color, { surface: 'corrugated' });
          };
          const px = side.axis === 'x' ? c : side.fixed;
          const pz = side.axis === 'x' ? side.fixed : c;
          if (doorIdx.includes(i)) {
            doors.push({ x: px, z: pz });
            seg(3.6, Ht - 3.6);
            const dy = rand(2.6, 3.4);
            deco(side.axis === 'x'
              ? { type: 'box', x: px, y: dy + (3.6 - dy) / 2, z: pz, w: sl - 0.1, h: 3.6 - dy, d: 0.08, color: '#8a6b3a', surface: 'corrugated' }
              : { type: 'box', x: px, y: dy + (3.6 - dy) / 2, z: pz, w: 0.08, h: 3.6 - dy, d: sl - 0.1, color: '#8a6b3a', surface: 'corrugated' });
          } else if (i > 0 && i < n - 1 && R() < 0.12) {
            seg(0, rand(0.3, 0.6));
          } else if (R() < 0.35) {
            seg(0, 1.3);
            seg(2.5, Ht - 2.5);
          } else {
            seg(0, Ht);
          }
        }
      }
      for (let bx = x0 + 1.5; bx < x1 - 0.5; bx += 3) {
        deco({ type: 'box', x: bx, y: Ht + 0.2, z: cz, w: 0.25, h: 0.4, d, color: '#3d4247', surface: 'metal' });
        if (R() < 0.55) deco({ type: 'box', x: bx + 1.5, y: Ht + 0.45, z: cz, w: 2.95, h: 0.08, d: d + 0.3, color: '#4f565c', surface: 'corrugated' });
      }
      if (o.racks !== false) {
        for (const rz of [cz - d / 4, cz + d / 4]) {
          for (const rx of [cx - w / 4, cx + w / 4]) {
            if (R() < 0.2) continue;
            box(rx, 0, rz, w * 0.28, 2.4, 0.9, 'rack', '#5c6a78');
            for (let k = 0; k < 3; k++) {
              deco({ type: 'box', x: rx + rand(-w * 0.1, w * 0.1), y: 2.4 + 0.35, z: rz, w: 0.9, h: 0.7, d: 0.8, color: pick(['#7a5c3a', '#6e5234', '#4e5a3a']), surface: 'wood' });
            }
          }
        }
      }
      return { cx, cz, w, d };
    }

    /** Raised platform with stairs; `height` is the platform deck height (default 3.7 m). */
    function tower(cx, cz, s, o = {}) {
      const c = { platform: '#6b5a48', pillar: '#4e4238', stair: '#7d6e5e', rail: '#5a4b3d', roof: '#5d6b4a', surface: 'wood', ...o };
      const Hd = c.height || 3.7, top = Hd + 0.3;
      const n = Math.round(top / 0.4), stepH = top / n;
      const edge = cx - s * 2;
      const sf = { surface: c.surface };
      box(cx, Hd, cz, 4, 0.3, 4, 'platform', c.platform, sf);
      for (const [ox, oz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) box(cx + ox, 0, cz + oz, 0.3, Hd, 0.3, 'pillar', c.pillar, sf);
      for (let i = 0; i < n; i++) box(edge - s * (n * 0.6 - 0.3 - 0.6 * i), 0, cz, 0.6, stepH * (i + 1), 2, 'stair', c.stair, sf);
      const far = cx + s * 2;
      box(far - s * 0.075, top, cz, 0.15, 1.05, 4, 'rail', c.rail, sf);
      box(cx, top, cz - 1.925, 4, 1.05, 0.15, 'rail', c.rail, sf);
      box(cx, top, cz + 1.925, 4, 1.05, 0.15, 'rail', c.rail, sf);
      box(edge + s * 0.075, top, cz - 1.5, 0.15, 1.05, 1, 'rail', c.rail, sf);
      box(edge + s * 0.075, top, cz + 1.5, 0.15, 1.05, 1, 'rail', c.rail, sf);
      for (const [ox, oz] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]]) {
        deco({ type: 'box', x: cx + ox, y: top + 1.9, z: cz + oz, w: 0.12, h: 1.8, d: 0.12, color: c.pillar, surface: c.surface });
      }
      deco({ type: 'box', x: cx, y: top + 2.85, z: cz, w: 4.6, h: 0.12, d: 4.6, color: c.roof, rx: 0.08, rz: -0.06, surface: c.roofSurface || 'metal' });
    }

    function car(x, z, alongX, style, palette) {
      const L = 4.2, W = 1.9;
      const w = alongX ? L : W, d = alongX ? W : L;
      const color = pick(palette || CAR_COLORS);
      if (style === 'flipped') {
        box(x, 0, z, w, 1.25, d, 'car', color);
        box(x, 0, z, alongX ? 2.2 : 1.7, 0.1, alongX ? 1.7 : 2.2, 'car', '#1a1a1a');
      } else {
        box(x, 0, z, w, 1.1, d, 'car', color);
        const crushed = style === 'crushed';
        const off = 0.25;
        box(x + (alongX ? -off : 0), 1.1, z + (alongX ? 0 : -off), alongX ? 2.2 : W - 0.2, crushed ? 0.3 : 0.62,
          alongX ? W - 0.2 : 2.2, 'car', '#1f2226');
      }
      const wy = style === 'flipped' ? 1.45 : 0.38;
      for (const [a, b] of [[-1.35, -0.85], [1.35, -0.85], [-1.35, 0.85], [1.35, 0.85]]) {
        if (R() < 0.2) continue;
        deco({ type: 'cyl', x: x + (alongX ? a : b), y: wy, z: z + (alongX ? b : a), r: 0.38, h: 0.28, color: '#141414',
          rx: alongX ? Math.PI / 2 : 0, rz: alongX ? 0 : Math.PI / 2, surface: 'plain' });
      }
      deco({ type: 'disc', x, z, r: 2.6, color: '#24211e', y: 0.025 });
    }

    function bus(x, z, color) {
      box(x, 0, z, 10, 2.7, 2.5, 'bus', color);
      box(x, 2.7, z, 9.4, 0.15, 2.3, 'bus', '#3a3526');
      for (const [a, b] of [[-3.8, -1.1], [3.8, -1.1], [-3.8, 1.1], [3.8, 1.1]]) {
        deco({ type: 'cyl', x: x + a, y: 0.45, z: z + b, r: 0.45, h: 0.3, color: '#141414', rx: Math.PI / 2, surface: 'plain' });
      }
    }

    /** Semi truck: cab, chassis and either a container or a flatbed load. */
    function truck(x, z, alongX, cargo = 'container', cabPalette) {
      const part = (off, len, wid, y0, h, kind, color) => (alongX
        ? box(x + off, y0, z, len, h, wid, kind, color)
        : box(x, y0, z + off, wid, h, len, kind, color));
      part(-4.4, 2.2, 2.4, 0, 2.6, 'car', pick(cabPalette || ['#6a2f26', '#2f4f5f', '#a39a88', '#3b3431']));
      part(0.3, 7.2, 2.4, 0, 1.2, 'car', '#2a2c30');
      if (cargo === 'container') part(0.3, 7.0, 2.44, 1.2, 2.6, 'container', pick(CONTAINER_COLORS));
      else part(0.3, 6.6, 2.2, 1.2, 1.2, 'crate', '#6e5234');
      for (const a of [-4.6, -1.8, 2.2, 3.4]) {
        for (const b of [-1.25, 1.25]) {
          deco({ type: 'cyl', x: x + (alongX ? a : b), y: 0.5, z: z + (alongX ? b : a), r: 0.5, h: 0.35, color: '#141414',
            rx: alongX ? Math.PI / 2 : 0, rz: alongX ? 0 : Math.PI / 2, surface: 'plain' });
        }
      }
      deco(alongX
        ? { type: 'box', x: x - 5.52, y: 1.9, z, w: 0.05, h: 0.8, d: 2.1, color: '#1b1f24', surface: 'plain' }
        : { type: 'box', x, y: 1.9, z: z - 5.52, w: 2.1, h: 0.8, d: 0.05, color: '#1b1f24', surface: 'plain' });
      deco({ type: 'disc', x, z, r: 4.6, color: '#24211e', y: 0.025 });
    }

    function container(x, z, alongX, y0 = 0) {
      box(x, y0, z, alongX ? 6.1 : 2.44, 2.6, alongX ? 2.44 : 6.1, 'container', pick(CONTAINER_COLORS));
    }

    const barrier = (x, z, alongX) => box(x, 0, z, alongX ? 3 : 0.6, 1.05, alongX ? 0.6 : 3, 'barrier', '#9a978f');
    const sandbag = (x, z, alongX, color = '#8c7b58') => box(x, 0, z, alongX ? 2.4 : 0.7, 0.95, alongX ? 0.7 : 2.4, 'sandbag', color);

    function crates(x, z, color = '#7a5c3a') {
      box(x, 0, z, 1.1, 1.1, 1.1, 'crate', color);
      if (R() < 0.6) box(x + 1.15, 0, z, 1.1, 1.1, 1.1, 'crate', '#6e5234');
      if (R() < 0.4) box(x, 1.1, z, 1.1, 1.1, 1.1, 'crate', color);
    }

    function barrels(x, z, color = '#7a3a2a') {
      for (let i = 0; i < 4; i++) {
        const bx = x + (i % 2) * 0.75, bz = z + Math.floor(i / 2) * 0.75;
        if (i && R() < 0.3) continue;
        box(bx, 0, bz, 0.6, 0.9, 0.6, 'barrel', i % 2 ? color : '#3f5a4a');
      }
    }

    function deadTree(x, z, color = '#2a2320') {
      if (overlaps(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 0.3)) return;
      box(x, 0, z, 0.45, 4.2, 0.45, 'tree', color);
      for (let k = 0; k < 4; k++) {
        deco({ type: 'cyl', x: x + rand(-0.6, 0.6), y: rand(3, 4.5), z: z + rand(-0.6, 0.6), r: 0.06, h: rand(1.2, 2.2),
          color, rx: rand(-0.9, 0.9), rz: rand(-0.9, 0.9), surface: 'bark' });
      }
    }

    function palm(x, z) {
      if (overlaps(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 0.5)) return;
      const h = rand(4.6, 6);
      box(x, 0, z, 0.4, h, 0.4, 'tree', '#6b5236');
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rand(-0.2, 0.2);
        deco({ type: 'box', x: x + Math.cos(a) * 1.2, y: h - 0.2, z: z + Math.sin(a) * 1.2, w: 2.6, h: 0.06, d: 0.55,
          color: i % 2 ? '#4f6b33' : '#5d7a3a', ry: -a, rz: -0.4, surface: 'foliage' });
      }
    }

    function treeSpot(x, z, r) {
      if (!inside(x, z, 2.5) || overlaps(x - r, x + r, z - r, z + r, 0.4)) return false;
      return !(nearAny(spawns, x, z, 3) || nearAny(doors, x, z, 2.5));
    }

    function pine(x, z, s, snowTips = true) {
      if (!treeSpot(x, z, 0.9 * s)) return false;
      box(x, 0, z, 0.5, 2.4 * s, 0.5, 'tree', '#3b2a20');
      box(x, 1.2 * s, z, 1.0 * s, 2.4 * s, 1.0 * s, 'foliage', '#2e4a38', { invisible: true });
      const green = pick(['#1f3a2c', '#264533', '#2b4b36', '#23402f']);
      deco({ type: 'cyl', x, y: 2.3 * s, z, r: 1.9 * s, rt: 0, h: 2.6 * s, color: green, surface: 'foliage' });
      deco({ type: 'cyl', x, y: 3.7 * s, z, r: 1.5 * s, rt: 0, h: 2.3 * s, color: green, surface: 'foliage' });
      deco({ type: 'cyl', x, y: 5.0 * s, z, r: 1.0 * s, rt: 0, h: 2.0 * s, color: green, surface: 'foliage' });
      deco({ type: 'cyl', x, y: 5.75 * s, z, r: 0.45 * s, rt: 0, h: 0.8 * s, color: snowTips ? '#e6ecf0' : green, surface: 'foliage' });
      return true;
    }

    /** Broadleaf tree: trunk, branches and a clumpy low-poly canopy that bullets cannot pass. */
    function oak(x, z, s) {
      if (!treeSpot(x, z, 1.2 * s)) return false;
      box(x, 0, z, 0.55 * s, 3.2 * s, 0.55 * s, 'tree', '#3a2e24');
      box(x, 2.6 * s, z, 2.3 * s, 2.8 * s, 2.3 * s, 'foliage', '#3c5230', { invisible: true });
      for (let k = 0; k < 3; k++) {
        deco({ type: 'cyl', x: x + rand(-0.5, 0.5) * s, y: 3.1 * s, z: z + rand(-0.5, 0.5) * s, r: 0.09 * s, h: 1.6 * s,
          color: '#3a2e24', rx: rand(-0.8, 0.8), rz: rand(-0.8, 0.8), surface: 'bark' });
      }
      const greens = ['#3f5a32', '#4a6638', '#35502c', '#465e30'];
      for (let i = 0; i < 4; i++) {
        deco({ type: 'ico', x: x + rand(-0.9, 0.9) * s, y: (3.6 + rand(0, 1.5)) * s, z: z + rand(-0.9, 0.9) * s,
          r: rand(1.2, 1.8) * s, color: pick(greens), surface: 'foliage', ry: R() * 3 });
      }
      return true;
    }

    function bush(x, z, s = 1) {
      if (!inside(x, z, 2) || overlaps(x - 0.8, x + 0.8, z - 0.8, z + 0.8, 0.2)) return;
      for (let i = 0; i < 3; i++) {
        deco({ type: 'ico', x: x + rand(-0.5, 0.5) * s, y: 0.45 * s, z: z + rand(-0.5, 0.5) * s, r: rand(0.5, 0.8) * s,
          color: pick(['#3b5530', '#46603a', '#324a2b']), surface: 'foliage', ry: R() * 3 });
      }
    }

    function rock(x, z, s, palette, snowCap) {
      if (!inside(x, z, s) || overlaps(x - s / 2, x + s / 2, z - s / 2, z + s / 2, 0.8)) return;
      if (nearAny(spawns, x, z, s / 2 + 2)) return;
      const c = pick(palette);
      const h = s * rand(0.55, 0.9), d = s * rand(0.7, 1.1);
      box(x, 0, z, s, h, d, 'rock', c);
      if (snowCap) deco({ type: 'box', x, y: h + 0.04, z, w: s * 0.9, h: 0.1, d: d * 0.9, color: '#e9eef2', surface: 'plain' });
      if (R() < 0.7) {
        const s2 = s * rand(0.4, 0.6), h2 = s * rand(0.9, 1.35);
        const ox = rand(-s / 4, s / 4), oz = rand(-d / 4, d / 4);
        box(x + ox, 0, z + oz, s2, h2, s2, 'rock', pick(palette));
        if (snowCap) deco({ type: 'box', x: x + ox, y: h2 + 0.04, z: z + oz, w: s2 * 0.85, h: 0.1, d: s2 * 0.85, color: '#e9eef2', surface: 'plain' });
      }
      for (let k = 0; k < 5; k++) {
        const a = R() * Math.PI * 2, r = s * 0.7 + rand(0, 1);
        const ps = rand(0.15, 0.4);
        deco({ type: 'box', x: x + Math.cos(a) * r, y: ps / 3, z: z + Math.sin(a) * r, w: ps, h: ps / 1.5, d: ps, color: c, ry: R() * 3, surface: 'rock' });
      }
    }

    /** Gantry crane: four collidable legs, beams, and a suspended container overhead. */
    function crane(xa, xb, za, zb, Hc = 15) {
      const col = '#c7792b';
      for (const x of [xa, xb]) for (const z of [za, zb]) box(x, 0, z, 0.9, Hc, 0.9, 'crane', col);
      const mz = (za + zb) / 2, mx = (xa + xb) / 2, len = Math.abs(zb - za) + 1, span = Math.abs(xb - xa) + 2;
      const m = { surface: 'metal' };
      for (const x of [xa, xb]) {
        deco({ type: 'box', x, y: Hc + 0.4, z: mz, w: 1.0, h: 0.8, d: len, color: col, ...m });
        deco({ type: 'box', x, y: 4, z: mz, w: 0.35, h: 0.35, d: len, color: '#a8662a', ...m });
      }
      for (const z of [za, zb]) deco({ type: 'box', x: mx, y: Hc - 1.5, z, w: span, h: 0.6, d: 0.6, color: '#a8662a', ...m });
      const tz = mz + rand(-len / 4, len / 4);
      deco({ type: 'box', x: mx, y: Hc + 1.2, z: tz, w: span, h: 1.0, d: 1.4, color: col, ...m });
      deco({ type: 'box', x: mx, y: Hc + 0.3, z: tz, w: 2.4, h: 1.4, d: 2.0, color: '#3d4247', ...m });
      const hangY = rand(7, 9.5);
      for (const ox of [-1, 1]) {
        deco({ type: 'cyl', x: mx + ox, y: (Hc + hangY + 2.6) / 2, z: tz, r: 0.04, h: Hc - hangY - 2.6, color: '#1a1a1a', surface: 'plain' });
      }
      deco({ type: 'box', x: mx, y: hangY + 1.3, z: tz, w: 6.1, h: 2.6, d: 2.44, color: pick(CONTAINER_COLORS), surface: 'corrugated' });
    }

    function bunker(x, z, alongX) {
      const c = '#8d9196';
      if (alongX) {
        box(x, 0, z - 1.6, 4.4, 1.2, 0.4, 'bunker', c);
        box(x - 2.0, 0, z, 0.4, 2.1, 3.2, 'bunker', c);
        box(x + 2.0, 0, z, 0.4, 2.1, 3.2, 'bunker', c);
      } else {
        box(x - 1.6, 0, z, 0.4, 1.2, 4.4, 'bunker', c);
        box(x, 0, z - 2.0, 3.2, 2.1, 0.4, 'bunker', c);
        box(x, 0, z + 2.0, 3.2, 2.1, 0.4, 'bunker', c);
      }
      deco({ type: 'box', x, y: 2.2, z, w: alongX ? 4.8 : 3.6, h: 0.22, d: alongX ? 3.6 : 4.8, color: '#7b8085', surface: 'concrete' });
      deco({ type: 'box', x, y: 2.34, z, w: alongX ? 4.4 : 3.2, h: 0.08, d: alongX ? 3.2 : 4.4, color: '#e9eef2', surface: 'plain' });
    }

    function tent(x, z, alongX) {
      const w = alongX ? 3.2 : 2.4, d = alongX ? 2.4 : 3.2;
      box(x, 0, z, w, 1.6, d, 'tent', '#8f8a6a');
      const tilt = 0.55;
      const f = { surface: 'fabric' };
      if (alongX) {
        deco({ type: 'box', x, y: 1.95, z: z - 0.6, w: w + 0.2, h: 0.06, d: 1.5, color: '#7d7858', rx: tilt, ...f });
        deco({ type: 'box', x, y: 1.95, z: z + 0.6, w: w + 0.2, h: 0.06, d: 1.5, color: '#7d7858', rx: -tilt, ...f });
      } else {
        deco({ type: 'box', x: x - 0.6, y: 1.95, z, w: 1.5, h: 0.06, d: d + 0.2, color: '#7d7858', rz: -tilt, ...f });
        deco({ type: 'box', x: x + 0.6, y: 1.95, z, w: 1.5, h: 0.06, d: d + 0.2, color: '#7d7858', rz: tilt, ...f });
      }
    }

    function logPile(x, z, alongX, snow = true) {
      box(x, 0, z, alongX ? 3.2 : 1.3, 0.95, alongX ? 1.3 : 3.2, 'log', '#5b4130');
      for (let i = 0; i < 3; i++) {
        deco({ type: 'cyl', x: x + (alongX ? 0 : (i - 1) * 0.42), y: 1.12, z: z + (alongX ? (i - 1) * 0.42 : 0), r: 0.2, h: 3.3,
          color: '#6a4d36', rx: alongX ? 0 : Math.PI / 2, rz: alongX ? Math.PI / 2 : 0, surface: 'bark' });
      }
      if (snow) deco({ type: 'box', x, y: 0.97, z, w: alongX ? 3 : 1.1, h: 0.05, d: alongX ? 1.1 : 3, color: '#e9eef2', surface: 'plain' });
    }

    /** A single fallen trunk lying on the forest floor: low cover. */
    function fallenLog(x, z, len, alongX) {
      if (!inside(x, z, len / 2 + 1) || overlaps(alongX ? x - len / 2 : x - 0.5, alongX ? x + len / 2 : x + 0.5,
        alongX ? z - 0.5 : z - len / 2, alongX ? z + 0.5 : z + len / 2, 0.6)) return;
      if (nearAny(spawns, x, z, len / 2 + 1.5)) return;
      box(x, 0, z, alongX ? len : 0.8, 0.72, alongX ? 0.8 : len, 'log', '#4a3a2c');
      deco({ type: 'cyl', x, y: 0.38, z, r: 0.4, h: len + 0.2, color: '#4f3d2e',
        rx: alongX ? 0 : Math.PI / 2, rz: alongX ? Math.PI / 2 : 0, surface: 'bark' });
      deco({ type: 'ico', x: x + (alongX ? len / 2 : 0), y: 0.4, z: z + (alongX ? 0 : len / 2), r: 0.55, color: '#3d4a2c', surface: 'foliage' });
    }

    function rubble(cx, cz, radius, count, colors = RUBBLE) {
      for (let i = 0; i < count; i++) {
        const ang = R() * Math.PI * 2, rr = Math.sqrt(R()) * radius;
        const x = cx + Math.cos(ang) * rr, z = cz + Math.sin(ang) * rr;
        if (!inside(x, z, 1.5)) continue;
        const s = rand(0.3, 1.4);
        const h = s > 0.8 ? rand(0.3, 0.95) : rand(0.12, 0.4);
        const color = pick(colors);
        if (s >= 0.6) {
          if (nearAny(spawns, x, z, 2.8) || nearAny(doors, x, z, 1.8)) continue;
          if (overlaps(x - s / 2, x + s / 2, z - s / 2, z + s / 2, 0.05)) continue;
          box(x, 0, z, s, h, s * rand(0.7, 1.2), 'rubble', color, { rotY: rand(-0.35, 0.35) });
        } else {
          deco({ type: 'box', x, y: h / 2, z, w: s, h, d: s, color, ry: R() * Math.PI, rx: rand(-0.3, 0.3), surface: 'concrete' });
        }
      }
    }

    /** Tilted slabs of broken concrete over a low collidable core, with rebar. */
    function slabPile(x, z) {
      if (!inside(x, z, 3) || overlaps(x - 1.6, x + 1.6, z - 1.2, z + 1.2, 0.3) || nearAny(spawns, x, z, 3.5) || nearAny(doors, x, z, 2.5)) return;
      box(x, 0, z, 2.6, 0.7, 1.8, 'rubble', pick(RUBBLE));
      for (let i = 0; i < 3; i++) {
        deco({ type: 'box', x: x + rand(-0.6, 0.6), y: 0.7 + i * 0.18, z: z + rand(-0.4, 0.4), w: rand(1.6, 2.6), h: 0.22, d: rand(1.0, 1.6),
          color: pick(CONCRETE), rx: rand(-0.35, 0.35), rz: rand(-0.45, 0.45), ry: rand(0, Math.PI), surface: 'concrete' });
      }
      rebar(x + rand(-0.8, 0.8), 0.8, z);
    }

    /** Shell crater: scorched earth ringed by a lip of broken ground. */
    function crater(x, z, r) {
      deco({ type: 'disc', x, z, r: r * 1.35, color: '#4a4640', y: 0.022 });
      deco({ type: 'disc', x, z, r, color: '#26231f', y: 0.026 });
      deco({ type: 'disc', x, z, r: r * 0.45, color: '#171513', y: 0.03 });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + rand(-0.2, 0.2), rr = r * rand(0.95, 1.25);
        const s = rand(0.3, 0.7);
        deco({ type: 'box', x: x + Math.cos(a) * rr, y: s * 0.25, z: z + Math.sin(a) * rr, w: s, h: s * 0.5, d: s * 1.3,
          color: pick(RUBBLE), ry: a, rx: rand(-0.4, 0.4), surface: 'concrete' });
      }
    }

    /** Winding stream (walkable) from a polyline: muddy banks, water and stones. Returns the points for spacing checks. */
    function stream(pts, width) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az), ang = Math.atan2(bz - az, bx - ax);
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        deco({ type: 'box', x: mx, y: 0.012, z: mz, w: len + width, h: 0.02, d: width + 1.8, ry: -ang, color: '#3b3829', surface: 'plain', noEdges: true });
        deco({ type: 'box', x: mx, y: 0.03, z: mz, w: len + width * 0.8, h: 0.02, d: width, ry: -ang, color: '#2a444c', surface: 'water', noEdges: true });
        for (let k = 0; k < 4; k++) {
          const t = R(), side = R() < 0.5 ? -1 : 1, off = (width / 2 + rand(0.2, 0.9)) * side;
          const px = ax + (bx - ax) * t - Math.sin(ang) * off, pz = az + (bz - az) * t + Math.cos(ang) * off;
          const s = rand(0.25, 0.6);
          deco({ type: 'box', x: px, y: s * 0.3, z: pz, w: s, h: s * 0.6, d: s * 1.2, color: pick(ROCKS), ry: R() * 3, surface: 'rock' });
        }
      }
      return pts;
    }

    function distToPolyline(pts, x, z) {
      let best = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
      }
      return best;
    }

    /** Plank footbridge along the given axis with collidable side rails. */
    function bridge(x, z, alongX, len) {
      const w = alongX ? len : 2.6, d = alongX ? 2.6 : len;
      deco({ type: 'box', x, y: 0.12, z, w, h: 0.12, d, color: '#6b5036', surface: 'wood' });
      for (const s of [-1, 1]) {
        if (alongX) box(x, 0, z + s * 1.25, len, 1.0, 0.12, 'rail', '#5a4128', { surface: 'wood' });
        else box(x + s * 1.25, 0, z, 0.12, 1.0, len, 'rail', '#5a4128', { surface: 'wood' });
      }
    }

    /** Rock ridge plateau with natural steps on its west end: a sniper perch. */
    function ridge(xa, xb, za, zb, height) {
      const depth = zb - za, cz = (za + zb) / 2;
      box((xa + xb) / 2, 0, cz, xb - xa, height, depth, 'rock', pick(ROCKS), { surface: 'rock' });
      const n = Math.round(height / 0.4);
      for (let s = 0; s < n - 1; s++) {
        box(xa - (n - 1 - s) * 0.7 + 0.35, 0, cz, 0.7, 0.4 * (s + 1), depth, 'stair', pick(ROCKS), { surface: 'rock' });
      }
      for (let i = 0; i < 4; i++) {
        const bx = rand(xa + 2, xb - 1);
        box(bx, height, rand(za + 0.4, zb - 0.4) + (R() < 0.5 ? -0.6 : 0.6), rand(0.5, 0.9), rand(0.5, 0.9), rand(0.5, 0.8), 'rock', pick(ROCKS), { surface: 'rock' });
      }
    }

    /** Moves any spawn that ended up inside geometry to the nearest open spot. */
    function fixSpawns() {
      const blocked = (x, z) => !inside(x, z, 2) || overlaps(x - 0.5, x + 0.5, z - 0.5, z + 0.5, 0.4);
      for (const sp of spawns) {
        if (!blocked(sp.x, sp.z)) continue;
        search: for (let r = 0.5; r <= 12; r += 0.5) {
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            const x = sp.x + Math.cos(a) * r, z = sp.z + Math.sin(a) * r;
            if (!blocked(x, z)) { sp.x = x; sp.z = z; break search; }
          }
        }
      }
    }

    function coverPoints() {
      const out = [];
      for (const b of boxes) {
        if (b.kind === 'boundary' || b.h < 0.8 || b.minY > 0.3) continue;
        if (b.kind === 'pole' || b.kind === 'tree' || b.kind === 'stair' || b.kind === 'crane' || b.kind === 'foliage') continue;
        const faces = [
          { nx: -1, nz: 0, len: b.d, ax: 'z', px: b.minX - 0.7, pz: b.z },
          { nx: 1, nz: 0, len: b.d, ax: 'z', px: b.maxX + 0.7, pz: b.z },
          { nx: 0, nz: -1, len: b.w, ax: 'x', px: b.x, pz: b.minZ - 0.7 },
          { nx: 0, nz: 1, len: b.w, ax: 'x', px: b.x, pz: b.maxZ + 0.7 },
        ];
        for (const f of faces) {
          const count = Math.max(1, Math.floor(f.len / 2.5));
          for (let k = 0; k < count; k++) {
            const off = (k + 0.5) / count - 0.5;
            const x = f.ax === 'x' ? f.px + off * f.len : f.px;
            const z = f.ax === 'z' ? f.pz + off * f.len : f.pz;
            if (!inside(x, z, 1.5)) continue;
            if (overlaps(x - 0.35, x + 0.35, z - 0.35, z + 0.35, 0)) continue;
            out.push({ x, z, nx: f.nx, nz: f.nz, h: b.maxY });
          }
        }
      }
      return out;
    }

    function finish() {
      fixSpawns();
      return {
        id: def.id, name: def.name, SIZE: S, HALF: H, WALL_H, theme: def.theme,
        boxes, decor, spawns, coverPoints: coverPoints(), doors, roads, smoke,
      };
    }

    return {
      S, H, R, rand, pick, box, deco, overlaps, nearAny, inside, doors, spawns, smoke,
      road, boundary, house, building, hall, tower, car, bus, truck, container, barrier, sandbag, crates, barrels,
      deadTree, palm, pine, oak, bush, rock, crane, bunker, tent, logPile, fallenLog, rubble, slabPile, crater,
      stream, distToPolyline, bridge, ridge, rebar, finish,
    };
  }

  // Common overcast grading: desaturated, contrasty, grainy.
  const GRITTY = { saturation: 0.96, contrast: 1.02, tint: [1.04, 1.03, 1.0], lift: [0.09, 0.09, 0.1], grain: 0.03, vignette: 0.08 };

  // =================================================================
  // Map definitions
  // =================================================================
  const MAPS = {
    ruins: {
      id: 'ruins', name: 'Ashfall Ruins', seed: 20260929, accent: '#a3a9ad',
      desc: 'A war-torn city under a heavy overcast sky. Gutted concrete blocks, craters, rubble and burned wrecks.',
      theme: {
        sky: ['#2e343a', '#62686e', '#9a9ea0'], clouds: 0.85, cloudLight: '#8a8e91', cloudDark: '#3a3e42',
        sunDir: [-0.5, 0.32, -0.8], sunPos: [-60, 70, -80], sunColor: '#e8e2d6', sunIntensity: 1.75, fill: 0.55,
        hemi: ['#c4c8cc', '#5a564e', 2.55], fog: ['#7a7e7e', 28, 175],
        exposure: 1.18, ground: { base: 78, range: 34, off: [0, -2, -6], fill: '#5a5752', crack: '26,25,24' },
        outer: '#2b2a28', outerNear: '#33312e', boundary: '#4a4c4f', dust: '#cfc8bb',
        smoke: '#262422', ember: '#ff7a2e', radarBg: '#2a2a29', radarRoad: '#1b1b1a', grade: GRITTY,
      },
      spawns: [
        [-52, -20], [-52, 20], [52, -20], [52, 20], [-20, -53], [20, -53], [-20, 53], [20, 53],
        [-32, -32], [32, 32], [-32, 32], [32, -32], [-8, 10], [10, -8], [-36, -2], [36, 5],
      ],
      build(k) {
        const { R, rand, deco, box } = k;
        k.road(0, 0, k.S, 8, true, '#383837', '#8a8568');
        k.road(0, 0, k.S, 8, false, '#383837', '#8a8568');
        for (const s of [-1, 1]) {
          for (const [a, b] of [[-k.H, -4.4], [4.4, k.H]]) {
            const len = b - a, mid = (a + b) / 2;
            deco({ type: 'box', x: mid, y: 0.07, z: s * 4.25, w: len, h: 0.14, d: 0.5, color: '#7f7c76', surface: 'concrete' });
            deco({ type: 'box', x: s * 4.25, y: 0.07, z: mid, w: 0.5, h: 0.14, d: len, color: '#7f7c76', surface: 'concrete' });
          }
        }
        k.boundary('#4a4c4f', '#3a3c3f');

        const blocks = [
          [20, 20, 10, 8, 3, true], [-22, 20, 10, 10, 2], [-20, -22, 12, 8, 3, true],
          [22, -22, 9, 9, 2], [22, 42, 12, 9, 2, true], [-40, -40, 10, 10, 2],
        ].map(([x, z, w, d, floors, stairs]) => k.building(x, z, w, d, { floors, stairs }));
        const houses = [
          [40, 18, 8, 8], [-42, 24, 9, 8], [-24, 44, 8, 10], [-42, -20, 8, 9], [42, -26, 10, 8], [24, -44, 8, 8],
        ].map(([x, z, w, d]) => k.house(x, z, w, d, { damage: 1.3 }));

        k.tower(50, 50, 1, { platform: '#5f5a52', pillar: '#4a4640', stair: '#6b665e', rail: '#55504a', roof: '#4a4d4f' });
        k.tower(-50, -50, -1, { platform: '#5f5a52', pillar: '#4a4640', stair: '#6b665e', rail: '#55504a', roof: '#4a4d4f' });

        [
          [-44, -1.5, true], [-30, -2, true, 'crushed'], [12, 2, true], [30, -1.5, true, 'flipped'], [48, 1.8, true],
          [1.8, -44, false], [-1.5, -28, false, 'flipped'], [2, 14, false], [-2, 30, false, 'crushed'], [1.5, 46, false],
          [-33, 12, true, 'flipped'], [34, -12, false], [12, -33, true, 'crushed'], [-12, 33, false],
        ].forEach(([x, z, ax, st]) => k.car(x, z, ax, st, BURNT_CARS));
        k.bus(-18, 1.6, '#4f4a3a');

        k.container(48, 8, true); k.container(48, 8, true, 2.6);
        k.container(-48, -8, true); k.container(-48, -8, true, 2.6);
        k.container(8, 50, false); k.container(-8, -50, false);

        k.barrier(7, -5.5, true); k.barrier(-7, 5.5, true); k.barrier(5.5, 7, false); k.barrier(-5.5, -7, false);
        for (const s of [-1, 1]) {
          k.barrier(s * 54, -2.5, false); k.barrier(s * 54, 2.5, false);
          k.barrier(-2.5, s * 54, true); k.barrier(2.5, s * 54, true);
          k.barrier(s * 14, 7, true); k.barrier(s * 14, -7, true);
        }
        [[44, 44, true], [-44, -44, true], [28, 8, true], [-28, -8, true], [8, -28, false], [-8, 28, false],
          [15, 30, false], [-15, -30, false], [30, -8, true], [-30, 8, true]].forEach(([x, z, a]) => k.sandbag(x, z, a, '#7d735c'));
        for (const [x, z] of [[33, 26], [-33, -26], [26, -33], [-26, 33], [10, 24], [-10, -24]]) k.crates(x, z, '#6b5a44');
        for (const [x, z] of [[-50, 40], [-35, 52], [35, -52], [50, -38], [-54, -30], [54, 30], [30, 54], [-10, -40], [10, 38], [-38, 8]]) {
          k.deadTree(x, z);
        }
        for (let p = -56; p <= 56; p += 16) {
          if (Math.abs(p) < 6) continue;
          if (!k.overlaps(p - 0.2, p + 0.2, 5.0, 5.4, 0.2)) {
            box(p, 0, 5.2, 0.3, 7, 0.3, 'pole', '#3d352e');
            deco({ type: 'box', x: p, y: 6.4, z: 5.2, w: 0.15, h: 0.15, d: 1.8, color: '#3d352e', surface: 'wood' });
          }
          if (!k.overlaps(-5.4, -5.0, p - 0.2, p + 0.2, 0.2)) {
            box(-5.2, 0, p, 0.3, 7, 0.3, 'pole', '#3d352e');
            deco({ type: 'box', x: -5.2, y: 6.4, z: p, w: 1.8, h: 0.15, d: 0.15, color: '#3d352e', surface: 'wood' });
          }
        }
        for (const [x, z, r] of [[0, 0, 3.2], [-26, 0, 2.4], [0, 22, 2.2], [31, 0, 2.6], [0, -35, 2.8], [-12, -12, 1.8], [14, 14, 1.8]]) k.crater(x, z, r);
        for (const [x, z] of [[-30, 28], [30, -30], [-12, -34], [12, 34], [-46, 10], [46, -10], [-34, -12], [34, 12], [16, -12], [-16, 12], [-6, 40], [6, -40]]) k.slabPile(x, z);
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          k.rubble(Math.cos(a) * 5.8, Math.sin(a) * 5.8, 1.2, 4);
        }
        for (const h of [...blocks, ...houses]) {
          k.rubble(h.cx + rand(-h.w / 4, h.w / 4), h.cz + rand(-h.d / 4, h.d / 4), 2.4, 12);
          const sx = R() < 0.5 ? -1 : 1;
          k.rubble(h.cx + sx * (h.w / 2 + 1.6), h.cz + rand(-h.d / 3, h.d / 3), 2.2, 12);
          k.rubble(h.cx + rand(-h.w / 3, h.w / 3), h.cz + (R() < 0.5 ? -1 : 1) * (h.d / 2 + 1.6), 1.8, 8);
        }
        for (let i = 0; i < 40; i++) k.rubble(rand(-54, 54), rand(-54, 54), rand(1.5, 3.2), 7);
        for (let i = 0; i < 50; i++) {
          deco({ type: 'plane', x: rand(-56, 56), z: rand(-56, 56), w: rand(0.8, 2.5), d: rand(0.8, 2.5), color: k.pick(['#3a3834', '#46433e', '#2f2d2a']), y: 0.02, surface: 'concrete' });
        }
        k.smoke.push([30, -1.5], [-1.5, -28], [-33, 12], [-18, 1.6], [12, -33], [20, 20], [-20, -22]);
      },
    },

    harbor: {
      id: 'harbor', name: 'Iron Harbor', seed: 7712, accent: '#8fb3c9',
      desc: 'An overcast container port. Tight lanes between stacks, two warehouses and gantry cranes.',
      theme: {
        sky: ['#2a343e', '#5a6672', '#8e99a2'], clouds: 0.78, cloudLight: '#7d888f', cloudDark: '#353e46',
        sunDir: [0.5, 0.25, -0.8], sunPos: [45, 55, -70], sunColor: '#e2e8f0', sunIntensity: 1.85, fill: 0.5,
        hemi: ['#c0ccd6', '#46505a', 2.4], fog: ['#7a8894', 32, 185],
        exposure: 1.16, ground: { base: 88, range: 30, off: [0, 3, 8], fill: '#575b60', crack: '28,32,36' },
        outer: '#16242e', outerNear: '#1d2d38', boundary: '#3b4450', dust: '#d6e2ea',
        smoke: '#262a2e', ember: '#ff8a3a', radarBg: '#23272b', radarRoad: '#16191c',
        grade: { ...GRITTY, tint: [0.96, 0.99, 1.03] },
      },
      spawns: [
        [-54, -2], [54, 2], [-2, -50], [2, 54], [-30, -6], [30, 6], [-6, 30], [6, -30],
        [-54, -30], [54, 30], [-30, 54], [30, -54], [-20, -20], [20, 20], [-14, -44], [14, 44],
      ],
      build(k) {
        const { R, rand, pick } = k;
        k.road(0, 0, k.S, 9, true, '#34373b', '#b3a456');
        k.road(0, 0, k.S, 7, false, '#34373b', '#b3a456');
        k.deco({ type: 'disc', x: 0, z: 0, r: 5, color: '#2b2e31', y: 0.035 });
        k.boundary('#3b4450', '#2e353e');

        const halls = [k.hall(-34, -30, 22, 14), k.hall(34, 30, 22, 14)];
        const steel = { platform: '#4d5660', pillar: '#3a4149', stair: '#5d6670', rail: '#454d55', roof: '#8a4a2e', surface: 'metal' };
        k.tower(50, -50, 1, steel);
        k.tower(-50, 50, -1, steel);

        for (const s of [1, -1]) {
          for (const rz of [44, 34, 24, 14]) {
            for (const rx of [14, 24, 34, 44]) {
              if (R() < 0.15) continue;
              const x = s * rx + rand(-0.8, 0.8), z = -s * rz;
              k.container(x, z, true);
              if (R() < 0.35) k.container(x, z, true, 2.6);
            }
          }
          k.crane(s * 19, s * 39, -s * 52, -s * 8);
        }

        k.truck(-40, 0, true); k.truck(20, 2, true, 'flatbed');
        k.truck(0, -36, false); k.truck(0, 40, false, 'flatbed');
        for (const [x, z, ax] of [[-26, -18, true], [26, 18, true], [-8, -14, false], [8, 14, false]]) {
          k.box(x, 0, z, ax ? 2.2 : 1.2, 1.3, ax ? 1.2 : 2.2, 'car', '#b08f2a');
          k.deco({ type: 'box', x: x + (ax ? 1.2 : 0), y: 1.4, z: z + (ax ? 0 : 1.2), w: ax ? 0.12 : 1.0, h: 2.8, d: ax ? 1.0 : 0.12, color: '#2a2c30', surface: 'metal' });
        }
        for (const [x, z, ax] of [[-14, -12, true], [-50, -14, false], [-14, -48, false], [-30, -50, true],
          [14, 12, true], [50, 14, false], [14, 48, false], [30, 50, true]]) k.container(x, z, ax);
        for (const [x, z] of [[-20, -44], [20, 44], [-44, -16], [44, 16], [-6, -22], [6, 22]]) k.barrels(x, z);
        for (const [x, z] of [[-10, -30], [10, 30], [-28, -8], [28, 8], [-40, -45], [40, 45]]) k.crates(x, z);
        k.barrier(7, -6, true); k.barrier(-7, 6, true); k.barrier(5, 8, false); k.barrier(-5, -8, false);
        [[-22, 8, true], [22, -8, true], [-48, 22, false], [48, -22, false]].forEach(([x, z, a]) => k.sandbag(x, z, a, '#6f6a58'));
        for (let p = -54; p <= 54; p += 6) {
          k.deco({ type: 'cyl', x: p, y: 0.35, z: -k.H + 1.4, r: 0.22, h: 0.7, color: '#2a2c30', surface: 'metal' });
          k.deco({ type: 'cyl', x: p, y: 0.35, z: k.H - 1.4, r: 0.22, h: 0.7, color: '#2a2c30', surface: 'metal' });
        }
        const GREY = ['#6b6f74', '#5a5e63', '#7b7f84'];
        for (const h of halls) {
          k.rubble(h.cx + (R() < 0.5 ? -1 : 1) * (h.w / 2 + 2), h.cz + rand(-h.d / 3, h.d / 3), 2.2, 10, GREY);
        }
        for (const [x, z] of [[-24, 6], [24, -6], [-6, -26], [6, 26]]) k.slabPile(x, z);
        for (const [x, z, r] of [[-12, 0, 2.2], [12, 0, 2], [0, 18, 1.8]]) k.crater(x, z, r);
        for (let i = 0; i < 26; i++) k.rubble(rand(-54, 54), rand(-54, 54), rand(1.2, 2.6), 5, GREY);
        for (let i = 0; i < 40; i++) {
          k.deco({ type: 'plane', x: rand(-56, 56), z: rand(-56, 56), w: rand(1, 3), d: rand(1, 3), color: pick(['#2e3236', '#383c40']), y: 0.02, surface: 'concrete' });
        }
        k.smoke.push([-40, 0], [20, 2], [0, 40], [-30, -50]);
      },
    },

    desert: {
      id: 'desert', name: 'Dune Outpost', seed: 4421, accent: '#d9b877',
      desc: 'A dusty desert village under a hazy sky. A walled compound, a wrecked highway, rocks and long sight lines.',
      theme: {
        sky: ['#6a6d70', '#a49888', '#d2c2a4'], clouds: 0.55, cloudLight: '#b8ad98', cloudDark: '#6f675a',
        sunDir: [0.45, 0.5, -0.65], sunPos: [50, 80, -60], sunColor: '#f7ebcf', sunIntensity: 2.35, fill: 0.45,
        hemi: ['#efe1c6', '#8a7050', 2.15], fog: ['#c0af92', 42, 230],
        exposure: 1.12, ground: { base: 160, range: 36, off: [0, -16, -46], fill: '#a88d64', crack: '110,86,58' },
        outer: '#a68a62', outerNear: '#b0936a', boundary: '#7d6a50', dust: '#e8d5ae',
        smoke: '#3a3028', ember: '#ff8a3a', radarBg: '#6e5a40', radarRoad: '#4a4036',
        grade: { ...GRITTY, saturation: 0.8, tint: [1.03, 0.99, 0.93] },
      },
      spawns: [
        [-54, -30], [-54, 30], [54, -30], [54, 30], [-30, -54], [30, -54], [-30, 54], [30, 54],
        [-24, -22], [24, -22], [0, 40], [0, -40], [-40, 4], [40, 4], [-38, -40], [38, 40],
      ],
      build(k) {
        const { rand } = k;
        const ADOBE = ['#b99c70', '#ad9064', '#c2a67a', '#a88a62'];
        const SAND = ['#a88e66', '#977e58', '#b29870', '#8d8173'];
        k.road(0, -8, k.S, 11, true, '#4a4640', '#c8bf9e');
        k.road(-28, 0, k.S, 6, false, '#9c8260', null, 'plain');
        k.boundary('#7d6a50', '#6f5c44');

        k.house(0, 20, 30, 24, { H: 2.6, allDoors: true, centerDoors: true, interior: false, palette: ['#b39468'], floor: false, debris: false, damage: 0.5 });
        const inner = [[-8, 14, 6, 5], [8, 26, 6, 6], [-7, 27, 5, 5]].map(([x, z, w, d]) =>
          k.house(x, z, w, d, { H: 3, palette: ADOBE, floor: '#8f7550', debrisColor: '#9c8058', roof: '#7d6444', roofSurface: 'wood' }));
        k.box(2, 0, 18, 1.4, 0.9, 1.4, 'wall', '#9c8058', { surface: 'plaster' });
        k.deco({ type: 'cyl', x: 2, y: 1.6, z: 18, r: 0.05, h: 1.4, color: '#4a3a2a', surface: 'wood' });
        k.box(9, 0, 13, 2.4, 1.0, 1.0, 'crate', '#7a5c3a');
        k.deco({ type: 'box', x: 9, y: 2.3, z: 13.3, w: 3, h: 0.05, d: 1.8, color: '#8f4a34', rx: 0.2, surface: 'fabric' });

        const houses = [
          [-40, 22, 9, 8], [-44, 40, 8, 8], [40, -26, 10, 8], [26, -40, 8, 9],
          [-22, -34, 9, 8], [44, 18, 8, 8], [22, 44, 9, 8], [-46, -22, 8, 8],
        ].map(([x, z, w, d]) => k.house(x, z, w, d, { palette: ADOBE, floor: '#8f7550', debrisColor: '#9c8058', damage: 1.2 }));

        const wood = { platform: '#6e5436', pillar: '#5a4128', stair: '#7d6040', rail: '#6a4d30', roof: '#8f4a34' };
        k.tower(50, 50, 1, wood);
        k.tower(-50, -50, -1, wood);

        [[-50, -10, 'flipped'], [-42, -6], [-34, -11, 'crushed'], [-20, -5], [-8, -10, 'flipped'],
          [4, -6, 'crushed'], [12, -11], [26, -5, 'flipped'], [36, -10], [46, -6, 'crushed']]
          .forEach(([x, z, st]) => k.car(x, z, true, st, ['#a39a88', '#7d624a', '#5e6a6a', '#8f4a34', '#c2b8a2']));
        k.bus(-14, -7.5, '#a88a2a');
        k.sandbag(20, -15.5, true); k.sandbag(22.5, -15.5, true); k.sandbag(20, -0.5, true);
        k.box(26, 0, -17, 2.2, 2.6, 2.2, 'wall', '#c2a67a', { surface: 'plaster' });

        for (const [x, z, s] of [[-48, 6, 4], [48, 8, 4.5], [-10, -44, 5], [10, 46, 4], [-36, -28, 3.5], [30, -30, 4],
          [-18, 44, 3.5], [52, -40, 4], [-8, -26, 3], [16, -26, 3], [36, 4, 3], [-52, -34, 3.5], [-4, 50, 3], [50, -2, 3]]) {
          k.rock(x, z, s, ['#8f7552', '#7d6546', '#a0845c']);
        }
        for (const [x, z] of [[-18, 4], [18, 4], [20, 36], [-20, 36], [-4, 36], [6, -20], [-40, 8], [40, 30], [30, -16], [-34, 48], [50, -18]]) k.palm(x, z);
        k.tent(-44, -38, true); k.tent(-38, -44, false); k.tent(-32, -40, true);
        for (const [x, z] of [[12, -20], [-12, -20], [34, 26], [-34, 30], [44, -44], [-6, 42]]) k.crates(x, z);
        for (const [x, z] of [[-26, -44], [30, -46], [-50, 14], [52, 12]]) k.barrels(x, z, '#8a4a2a');
        [[-6, -18, true], [6, -18, true], [-18, 30, false], [18, 12, false], [-46, 2, false], [46, -12, false]]
          .forEach(([x, z, a]) => k.sandbag(x, z, a, '#a08a5c'));
        for (const [x, z, r] of [[-2, -8, 2.4], [30, -8, 2], [-38, -8, 2.2]]) k.crater(x, z, r);
        for (const [x, z] of [[-30, 14], [30, 12], [14, -30], [-14, 32]]) k.slabPile(x, z);
        for (const h of [...houses, ...inner]) k.rubble(h.cx + rand(-h.w / 3, h.w / 3), h.cz + rand(-h.d / 3, h.d / 3), 2.2, 9, SAND);
        for (let i = 0; i < 30; i++) k.rubble(rand(-54, 54), rand(-54, 54), rand(1.5, 3), 6, SAND);
        for (let i = 0; i < 30; i++) {
          k.deco({ type: 'disc', x: rand(-56, 56), z: rand(-56, 56), r: rand(1.5, 4), color: k.pick(['#b69a70', '#9c8260']), y: 0.02 });
        }
        k.smoke.push([-34, -11], [26, -5], [-8, -10]);
      },
    },

    winter: {
      id: 'winter', name: 'Frostbite Pass', seed: 9133, accent: '#bfe3ff',
      desc: 'A snowed-in mountain village. Log cabins, pine forests, bunkers and heavy fog.',
      theme: {
        sky: ['#6d7a86', '#a8b3bc', '#d8dee4'], clouds: 0.88, cloudLight: '#c7ced4', cloudDark: '#7d8791',
        sunDir: [-0.4, 0.35, 0.8], sunPos: [-40, 60, 50], sunColor: '#f6f2ea', sunIntensity: 1.7, fill: 0.5,
        hemi: ['#eef3f7', '#88929c', 2.45], fog: ['#c4ccd4', 28, 155],
        exposure: 1.14, ground: { base: 205, range: 30, off: [0, 4, 12], fill: '#cfd6dd', crack: '140,155,170' },
        outer: '#d5dde3', outerNear: '#ccd4db', boundary: '#4a5058', dust: '#ffffff', snow: true,
        smoke: '#3a3d42', ember: '#ff8a3a', radarBg: '#5a6570', radarRoad: '#3d4650',
        grade: { ...GRITTY, saturation: 0.8, tint: [0.97, 0.99, 1.03] },
      },
      spawns: [
        [-52, -20], [-52, 20], [52, -20], [52, 20], [-20, -53], [20, -53], [-20, 53], [20, 53],
        [-32, -32], [32, 32], [-32, 32], [32, -32], [-8, 10], [10, -8], [-36, -2], [36, 5],
      ],
      build(k) {
        const { rand, R } = k;
        const WOOD = ['#5f4430', '#523a28', '#6b4e35', '#4a372a'];
        const SNOWY = ['#c9d1d8', '#aab3bb', '#8d969e'];
        k.road(0, 0, k.S, 7, false, '#8d959d', null, 'plain');
        k.road(0, 0, k.S, 7, true, '#8d959d', null, 'plain');
        k.boundary('#4a5058', '#3a4048');

        const cabinOpts = { H: 3.0, palette: WOOD, floor: '#6b5a4a', debrisColor: '#4a3a2c', roof: '#3a3d42', damage: 0.7, surface: 'wood' };
        const cabins = [
          [-20, -20, 9, 8], [-38, -22, 8, 8], [-22, -40, 10, 8], [20, -24, 9, 8], [40, -20, 8, 8], [24, -42, 9, 9],
          [-22, 30, 9, 9], [-42, 34, 8, 8], [24, 30, 10, 8], [42, 36, 8, 9],
        ].map(([x, z, w, d]) => k.house(x, z, w, d, cabinOpts));
        cabins.push(k.house(18, 12, 12, 9, { H: 3.8, palette: ['#523a28'], floor: '#6b5a4a', roof: '#2f3338', surface: 'wood' }));
        cabins.push(k.house(-18, 12, 10, 8, { H: 3.4, palette: ['#6b4e35'], floor: '#6b5a4a', roof: '#2f3338', surface: 'wood' }));

        const wood = { platform: '#523a28', pillar: '#3b2a20', stair: '#5f4430', rail: '#4a372a', roof: '#e9eef2', roofSurface: 'plain' };
        k.tower(50, 50, 1, wood);
        k.tower(-50, -50, -1, wood);

        k.bunker(-34, 8, true); k.bunker(34, -8, true); k.bunker(8, -34, false); k.bunker(-8, 34, false);
        k.truck(-1.5, -28, false); k.truck(1.5, 40, false, 'flatbed');
        k.truck(-44, -1.5, true, 'flatbed'); k.truck(44, 1.5, true);
        [[-30, -2, true, 'crushed'], [12, 2, true], [1.8, -46, false, 'flipped'], [-1.8, 20, false, 'crushed'], [30, 2, true, 'flipped']]
          .forEach(([x, z, ax, st]) => k.car(x, z, ax, st, ['#4f5a60', '#6a2f26', '#2c3438', '#b8b2a4']));
        k.logPile(-10, -12, true); k.logPile(10, 22, true); k.logPile(-40, 14, false); k.logPile(40, -36, true);

        for (const [cx, cz] of [[-48, -6], [48, 8], [-8, -50], [8, 50], [-48, 48], [48, -48], [-32, -50], [32, 50], [-52, 30], [52, -30]]) {
          let planted = 0;
          for (let tries = 0; tries < 20 && planted < 7; tries++) {
            const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 7;
            if (k.pine(cx + Math.cos(a) * r, cz + Math.sin(a) * r, rand(0.8, 1.3))) planted++;
          }
        }
        for (const [x, z, s] of [[-52, -38, 3.5], [52, -30, 3], [30, -50, 3.5], [-6, -40, 3], [6, 40, 3], [-50, 22, 3], [50, 22, 3.5], [-28, 50, 3]]) {
          k.rock(x, z, s, ['#7d848c', '#6b7279', '#8d949b'], true);
        }
        for (const [x, z] of [[-12, -26], [12, 26], [-30, 20], [30, -14], [-44, -44], [44, 44]]) k.crates(x, z, '#6e5234');
        [[-6, -8, true], [6, 8, true], [-26, -30, false], [26, 22, false]].forEach(([x, z, a]) => k.sandbag(x, z, a, '#8f8a78'));
        for (const [x, z] of [[-30, -10], [30, 10], [-10, 26]]) k.slabPile(x, z);
        for (const h of cabins) k.rubble(h.cx + rand(-h.w / 3, h.w / 3), h.cz + rand(-h.d / 3, h.d / 3), 2, 6, SNOWY);
        for (let i = 0; i < 24; i++) k.rubble(rand(-54, 54), rand(-54, 54), rand(1.5, 3), 5, SNOWY);
        for (let i = 0; i < 40; i++) {
          k.deco({ type: 'disc', x: rand(-56, 56), z: rand(-56, 56), r: rand(1.2, 3.5), color: k.pick(['#eef2f5', '#c5ced6']), y: 0.02 });
        }
        k.smoke.push([-44, -1.5], [1.5, 40], [18, 12]);
      },
    },

    forest: {
      id: 'forest', name: 'Timber Ridge', seed: 5150, size: 160, accent: '#8fb58a',
      desc: 'A large misty pine forest made for snipers: long firebreak lanes, clearings, watchtowers, a ridge and a stream.',
      theme: {
        sky: ['#3a4346', '#727c78', '#a8b0a8'], clouds: 0.72, cloudLight: '#98a19c', cloudDark: '#48514f',
        sunDir: [0.35, 0.4, -0.85], sunPos: [40, 80, -95], sunColor: '#eef0e4', sunIntensity: 1.8, fill: 0.45,
        hemi: ['#d0dbd4', '#465240', 2.35], fog: ['#8a9590', 40, 235],
        exposure: 1.16, ground: { base: 58, range: 34, off: [-4, 6, -10], fill: '#454d36', crack: '28,32,22' },
        outer: '#2b3326', outerNear: '#323a2b', boundary: '#3b3f36', dust: '#dfe6d8',
        smoke: '#2e302c', ember: '#ff8a3a', radarBg: '#26301f', radarRoad: '#46473a',
        grade: { ...GRITTY, saturation: 0.8, tint: [0.97, 1.0, 0.96] },
      },
      spawns: [
        [-70, -20], [-70, 30], [70, -30], [70, 20], [-20, -70], [30, -70], [-30, 70], [20, 70],
        [-45, -45], [45, 45], [-45, 55], [55, -45], [-12, 12], [12, -12], [-30, 6], [30, -6],
      ],
      build(k) {
        const { R, rand, pick, deco, box } = k;
        const H = k.H;
        const lanesX = [[0, 4.5], [-50, 3.5]], lanesZ = [[0, 4.5], [46, 3.5]];
        for (const [x, hw] of lanesX) k.road(x, 0, k.S, hw * 2, false, '#56603e', null, 'plain');
        for (const [z, hw] of lanesZ) k.road(0, z, k.S, hw * 2, true, '#56603e', null, 'plain');
        k.boundary('#3b3f36', '#2e322a', false);

        const clearings = [[-32, -32, 14], [34, 30, 12], [42, -46, 14], [-40, 36, 11], [8, -30, 7]];
        for (const [x, z, r] of clearings) deco({ type: 'disc', x, z, r, color: '#525c3a', y: 0.018 });
        const creek = k.stream([[-80, 22], [-58, 16], [-36, 26], [-14, 18], [6, 28], [28, 20], [50, 30], [80, 24]], 3.2);

        k.house(-34, -30, 8, 7, { H: 3.0, palette: ['#5f4430', '#523a28'], floor: '#5a4a3a', roof: '#343834', surface: 'wood', damage: 0.5 });
        k.house(-24, -39, 7, 6, { H: 2.8, palette: ['#6b4e35'], floor: '#5a4a3a', roof: '#343834', surface: 'wood', damage: 0.6 });
        k.house(-40, 38, 10, 8, { H: 3.4, palette: ['#523a28'], floor: '#5a4a3a', roof: '#2f3338', surface: 'wood', damage: 0.4 });
        k.house(36, 32, 6, 5, { H: 2.8, palette: ['#5f4430'], floor: '#5a4a3a', roof: '#343834', surface: 'wood', damage: 0.6 });
        k.logPile(30, 26, true, false); k.logPile(-28, -24, false, false);

        const tall = { height: 6.2, platform: '#5a4430', pillar: '#3e2e22', stair: '#6b5038', rail: '#4f3b2a', roof: '#3d4a36', roofSurface: 'wood' };
        const stand = { height: 3.2, platform: '#5a4430', pillar: '#3e2e22', stair: '#6b5038', rail: '#4f3b2a', roof: '#3d4a36', roofSurface: 'wood' };
        k.tower(66, 4, 1, tall);
        k.tower(-68, 42, -1, tall);
        k.tower(10, -68, 1, tall);
        k.tower(-54, 68, -1, stand);
        k.tower(-20, -58, 1, stand);
        k.tower(40, 60, -1, stand);
        k.ridge(35, 51, -54, -50.5, 3.2);
        k.bridge(0, 25, false, 6);
        k.bridge(-50, 19.6, false, 6);

        const inLane = (x, z) => lanesX.some(([lx, hw]) => Math.abs(x - lx) < hw + 1.5) || lanesZ.some(([lz, hw]) => Math.abs(z - lz) < hw + 1.5);
        const inClearing = (x, z) => clearings.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r);
        for (let gx = -H + 5; gx < H - 4; gx += 5) {
          for (let gz = -H + 5; gz < H - 4; gz += 5) {
            const x = gx + rand(-1.8, 1.8), z = gz + rand(-1.8, 1.8);
            if (inLane(x, z) || inClearing(x, z) || k.distToPolyline(creek, x, z) < 4.2) continue;
            const density = 0.72 + 0.22 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.09 - 0.4);
            if (R() > density) continue;
            if (R() < 0.62) k.pine(x, z, rand(1.0, 1.55), false);
            else k.oak(x, z, rand(0.95, 1.35));
          }
        }
        for (let i = 0; i < 70; i++) {
          const x = rand(-H + 6, H - 6), z = rand(-H + 6, H - 6);
          if (!inLane(x, z) || R() < 0.5) k.bush(x, z, rand(0.8, 1.3));
        }
        for (let i = 0; i < 34; i++) {
          const x = rand(-H + 8, H - 8), z = rand(-H + 8, H - 8);
          if (inLane(x, z) && R() < 0.7) continue;
          k.fallenLog(x, z, rand(4, 7), R() < 0.5);
        }
        for (let i = 0; i < 22; i++) {
          const x = rand(-H + 8, H - 8), z = rand(-H + 8, H - 8);
          if (inLane(x, z)) continue;
          k.rock(x, z, rand(1.6, 3.4), ['#6b6a60', '#5d5c54', '#77756a']);
        }
        for (const [x, z] of [[-33, -36], [34, 36], [-38, 44]]) k.crates(x, z, '#5f4b34');
        k.sandbag(62, -2, false, '#6f6a50'); k.sandbag(-64, 48, false, '#6f6a50');
        for (let i = 0; i < 60; i++) {
          deco({ type: 'disc', x: rand(-H + 3, H - 3), z: rand(-H + 3, H - 3), r: rand(1, 3), color: pick(['#3f4630', '#4a5237', '#383f2b']), y: 0.016 });
        }
        for (let i = 0; i < 40; i++) {
          const x = rand(-H + 4, H - 4), z = rand(-H + 4, H - 4);
          const s = rand(0.2, 0.5);
          deco({ type: 'box', x, y: s * 0.3, z, w: s, h: s * 0.6, d: s * 1.2, color: pick(['#6b6a60', '#5d5c54']), ry: R() * 3, surface: 'rock' });
        }
        box(-32, 0, -32, 1.2, 0.35, 1.2, 'rubble', '#3a3530', { surface: 'rock' });
        k.smoke.push([-32, -32]);
      },
    },
    nightcity: {
      id: 'nightcity', name: 'Neon District', seed: 8801, accent: '#ff4fd8',
      desc: 'A rainy night city block. Neon storefronts, alleyways, rooftops and tight mid-range fights.',
      theme: {
        sky: ['#06070c', '#12161f', '#2a3140'], clouds: 0.55, cloudLight: '#3a4252', cloudDark: '#0c1018',
        sunDir: [0.2, 0.15, -0.9], sunPos: [30, 40, -90], sunColor: '#8aa0c8', sunIntensity: 0.55, fill: 0.7,
        hemi: ['#4a5a78', '#1a1420', 1.85], fog: ['#1a1e28', 18, 120],
        exposure: 1.2, ground: { base: 42, var: 22, off: [0, 0, 8], fill: '#2a2c34', crack: '18,18,22' },
        outer: '#0a0c12', outerNear: '#12151c', boundary: '#2a2e38', dust: '#6a7a9a',
        smoke: '#1a1c22', ember: '#ff4fd8', radarBg: '#12151c', radarRoad: '#0a0c10',
        grade: { ...GRITTY, saturation: 0.9, tint: [1.0, 0.95, 1.08], vignette: 0.28 },
      },
      spawns: [
        [-50, -18], [-50, 18], [50, -18], [50, 18], [-18, -50], [18, -50], [-18, 50], [18, 50],
        [-30, -30], [30, 30], [-30, 30], [30, -30], [-8, 12], [12, -8], [-36, 0], [36, 0],
      ],
      build(k) {
        const { rand, pick, deco, R } = k;
        const NEON = ['#ff4fd8', '#3de0ff', '#ffe066', '#7cff6b'];
        k.road(0, 0, k.S, 9, true, '#1c1e24', '#c9a227');
        k.road(0, 0, k.S, 9, false, '#1c1e24', '#c9a227');
        k.boundary('#2a2e38', '#1a1e28');
        [[-28, -24, 14, 12, 4], [28, 24, 14, 12, 4], [-30, 26, 12, 14, 3], [30, -28, 12, 14, 3],
          [0, 34, 16, 10, 3, true], [0, -34, 16, 10, 3, true]].forEach(([x, z, w, d, floors, stairs]) =>
          k.building(x, z, w, d, { floors, stairs, palette: ['#2a2e36', '#343944', '#1e222a'], roof: '#151820' }));
        [[-46, 0, 8, 10], [46, 0, 8, 10], [0, 0, 10, 8]].forEach(([x, z, w, d]) =>
          k.house(x, z, w, d, { H: 3.2, palette: ['#2c3038'], roof: '#12151a', damage: 0.4 }));
        k.tower(52, 52, 1, { platform: '#2e3440', pillar: '#222830', stair: '#3a4250', rail: '#4a5568', roof: '#ff4fd8' });
        k.tower(-52, -52, -1, { platform: '#2e3440', pillar: '#222830', stair: '#3a4250', rail: '#4a5568', roof: '#3de0ff' });
        for (const [x, z, ax] of [[-40, 2, true], [22, -2, true], [2, 38, false], [-2, -28, false], [34, 14, true]]) {
          k.car(x, z, ax, null, ['#1a1c22', '#2a2030', '#102028']);
        }
        for (let i = 0; i < 28; i++) {
          const x = rand(-k.H + 6, k.H - 6), z = rand(-k.H + 6, k.H - 6);
          if (Math.abs(x) < 6 || Math.abs(z) < 6) continue;
          const c = pick(NEON);
          deco({ type: 'box', x, y: 2.4 + rand(0, 4), z, w: rand(1.2, 3.5), h: 0.35, d: 0.25, color: c, surface: 'metal' });
          deco({ type: 'box', x: x + rand(-4, 4), y: 0.9, z: z + rand(-4, 4), w: 0.2, h: 1.6, d: 0.2, color: c, surface: 'metal' });
        }
        for (let i = 0; i < 18; i++) k.barrier(rand(-40, 40), rand(-40, 40), R() > 0.5);
        k.crates(-16, 16, '#3a2a1a'); k.crates(18, -14, '#2a3a2a');
        k.smoke.push([12, 22], [-24, -10]);
      },
    },
    airport: {
      id: 'airport', name: 'Runway 07', seed: 6604, size: 140, accent: '#c9d6e2',
      desc: 'An abandoned airfield. Long runway sightlines, hangars, a terminal and open taxiways for snipers and LMGs.',
      theme: {
        sky: ['#4a5560', '#7d8a96', '#b0bcc6'], clouds: 0.7, cloudLight: '#c0c8d0', cloudDark: '#5a6570',
        sunDir: [0.55, 0.45, -0.5], sunPos: [70, 85, -40], sunColor: '#f0e8d8', sunIntensity: 1.9, fill: 0.5,
        hemi: ['#d0dae4', '#5a646e', 2.3], fog: ['#9aa6b0', 40, 220],
        exposure: 1.15, ground: { base: 110, var: 24, off: [0, 2, 6], fill: '#6a7078', crack: '50,54,58' },
        outer: '#5a6068', outerNear: '#646a72', boundary: '#4a5058', dust: '#d8e0e8',
        smoke: '#2a2e32', ember: '#ff8a3a', radarBg: '#3a424a', radarRoad: '#2a3038',
        grade: { ...GRITTY, saturation: 0.84, tint: [0.98, 1.0, 1.04] },
      },
      spawns: [
        [-60, -10], [-60, 20], [60, -20], [60, 10], [-10, -60], [20, -60], [-20, 60], [10, 60],
        [-40, -40], [40, 40], [-40, 45], [45, -40], [-15, 8], [15, -8], [-50, 5], [50, -5],
      ],
      build(k) {
        const { deco, box, H } = k;
        k.road(0, 0, k.S, 14, true, '#4a5058', '#e8eef2');
        k.road(0, -28, k.S * 0.7, 6, true, '#525860', null, 'plain');
        k.road(0, 32, k.S * 0.55, 6, true, '#525860', null, 'plain');
        k.boundary('#4a5058', '#3a4048');
        k.hall(-35, -40, 28, 16, { H: 5, palette: ['#8a929a', '#6a727a'], roof: '#3a4048' });
        [[40, -36, 22, 18], [42, 34, 20, 16], [-48, 38, 18, 14]].forEach(([x, z, w, d]) => {
          box(x, 0, z, w, 6.5, d, 'hangar', '#6a727c', { surface: 'metal' });
          deco({ type: 'box', x, y: 6.6, z, w: w + 1, h: 0.4, d: d + 1, color: '#3a4048', surface: 'metal' });
          deco({ type: 'box', x: x - w * 0.35, y: 3.2, z: z - d * 0.5 + 0.2, w: w * 0.25, h: 6.2, d: 0.35, color: '#4a5058', surface: 'metal' });
          deco({ type: 'box', x: x + w * 0.35, y: 3.2, z: z - d * 0.5 + 0.2, w: w * 0.25, h: 6.2, d: 0.35, color: '#4a5058', surface: 'metal' });
        });
        k.tower(60, 55, 1, { platform: '#5a6270', pillar: '#3a424e', stair: '#6a7280', rail: '#7a8490', roof: '#c04030' });
        k.tower(-60, -55, -1, { platform: '#5a6270', pillar: '#3a424e', stair: '#6a7280', rail: '#7a8490', roof: '#c04030' });
        box(8, 0, -48, 4, 14, 4, 'tower', '#5a6270', { surface: 'concrete' });
        deco({ type: 'box', x: 8, y: 14.5, z: -48, w: 7, h: 2.2, d: 7, color: '#3a90c0', surface: 'metal' });
        for (const [x, z] of [[-20, 8], [25, -6], [10, 20], [-12, -18]]) k.truck(x, z, Math.abs(x) > Math.abs(z));
        for (let i = 0; i < 12; i++) k.barrier((-50 + i * 9), 8, true);
        for (let i = 0; i < 10; i++) {
          deco({ type: 'box', x: -H + 8 + i * 12, y: 0.4, z: 0, w: 2.5, h: 0.08, d: 0.6, color: '#e8eef2' });
        }
        k.crates(38, -20, '#5a4a34'); k.barrels(44, 20, '#6a3a2a');
        k.sandbag(20, 40, true); k.sandbag(-22, -42, false);
        k.smoke.push([40, -36]);
      },
    },
    metro: {
      id: 'metro', name: 'Blackline Metro', seed: 3307, accent: '#f0a030',
      desc: 'Underground transit tunnels and platforms. Close quarters, choke points and orange service lights.',
      theme: {
        sky: ['#050608', '#0c0e12', '#1a1c22'], clouds: 0.2, cloudLight: '#2a2c32', cloudDark: '#08090c',
        sunDir: [0, 1, 0.1], sunPos: [0, 40, 0], sunColor: '#ffb060', sunIntensity: 0.35, fill: 0.85,
        hemi: ['#3a3028', '#121014', 2.0], fog: ['#12141a', 12, 90],
        exposure: 1.22, ground: { base: 36, var: 16, off: [0, -2, 0], fill: '#222428', crack: '14,14,16' },
        outer: '#08090c', outerNear: '#0e1014', boundary: '#1e2026', dust: '#6a6050',
        smoke: '#1a1816', ember: '#f0a030', radarBg: '#12141a', radarRoad: '#0a0c10',
        grade: { ...GRITTY, saturation: 0.88, tint: [1.06, 0.98, 0.9], vignette: 0.3 },
      },
      spawns: [
        [-48, 0], [48, 0], [0, -48], [0, 48], [-24, -8], [24, 8], [-8, 24], [8, -24],
        [-36, -36], [36, 36], [-36, 36], [36, -36], [-16, 0], [16, 0], [0, -16], [0, 16],
      ],
      build(k) {
        const { deco, box } = k;
        k.road(0, 0, k.S, 10, true, '#1a1c20', '#f0a030');
        k.road(0, 0, k.S, 10, false, '#1a1c20', '#f0a030');
        k.boundary('#1e2026', '#12141a', false);
        for (const s of [-1, 1]) {
          for (const [a, b] of [[-50, -18], [18, 50]]) {
            const len = b - a, mid = (a + b) / 2;
            box(mid, 0, s * 6.5, len, 3.2, 0.6, 'tunnel', '#2a2c32', { surface: 'concrete' });
            box(s * 6.5, 0, mid, 0.6, 3.2, len, 'tunnel', '#2a2c32', { surface: 'concrete' });
          }
        }
        [[-34, -34, 14, 12], [34, 34, 14, 12], [-34, 34, 12, 14], [34, -34, 12, 14]].forEach(([x, z, w, d]) => {
          k.hall(x, z, w, d, { H: 4.2, palette: ['#3a3c42', '#2e3036'], roof: '#14161a' });
          deco({ type: 'box', x, y: 0.5, z, w: w * 0.55, h: 1.0, d: 2.0, color: '#4a3a28', surface: 'concrete' });
        });
        [[0, 22, 8, 6], [0, -22, 8, 6], [22, 0, 6, 8], [-22, 0, 6, 8]].forEach(([x, z, w, d]) =>
          k.house(x, z, w, d, { H: 3.2, palette: ['#2e3038'], roof: '#12141a', damage: 0.15, allDoors: true, centerDoors: true }));
        for (let i = -4; i <= 4; i++) {
          if (Math.abs(i) <= 1) continue;
          deco({ type: 'box', x: i * 10, y: 2.8, z: 5.2, w: 0.35, h: 0.2, d: 0.35, color: '#f0a030', surface: 'metal' });
          deco({ type: 'box', x: i * 10, y: 2.8, z: -5.2, w: 0.35, h: 0.2, d: 0.35, color: '#f0a030', surface: 'metal' });
          deco({ type: 'box', x: 5.2, y: 2.8, z: i * 10, w: 0.35, h: 0.2, d: 0.35, color: '#f0a030', surface: 'metal' });
          deco({ type: 'box', x: -5.2, y: 2.8, z: i * 10, w: 0.35, h: 0.2, d: 0.35, color: '#f0a030', surface: 'metal' });
        }
        for (const [x, z] of [[-14, 4], [14, -4], [4, 14], [-4, -14]]) k.barrier(x, z, Math.abs(x) > Math.abs(z));
        k.crates(-30, 20, '#3a2a1a'); k.crates(28, -22, '#3a2a1a');
        k.barrels(20, 30, '#6a3a1a'); k.sandbag(10, -10, true);
        k.smoke.push([0, 22], [-34, 34]);
      },
    }
  };

  // Brighten every map theme — overcast cinematic look was too dark for play.
  for (const def of Object.values(MAPS)) {
    const t = def.theme;
    if (!t) continue;
    t.exposure = (t.exposure || 1) * 1.45;
    t.sunIntensity = (t.sunIntensity || 1) * 1.55;
    t.fill = (t.fill ?? 0.4) * 1.8;
    if (Array.isArray(t.hemi) && t.hemi.length >= 3) t.hemi[2] = (t.hemi[2] || 1) * 1.5;
    if (Array.isArray(t.fog) && t.fog.length >= 3) {
      t.fog[1] = (t.fog[1] || 30) * 1.35;
      t.fog[2] = (t.fog[2] || 160) * 1.3;
    }
  }

  const MAP_LIST = Object.values(MAPS).map((m) => ({ id: m.id, name: m.name, desc: m.desc, accent: m.accent, size: m.size || SIZE }));
  const cache = new Map();

  function buildMap(id) {
    const def = MAPS[id] || MAPS[DEFAULT_MAP];
    if (cache.has(def.id)) return cache.get(def.id);
    const kit = makeKit(def);
    def.build(kit);
    const map = kit.finish();
    cache.set(def.id, map);
    return map;
  }

  const hasMap = (id) => Object.prototype.hasOwnProperty.call(MAPS, id);

  function raycastBoxes(boxes, ox, oy, oz, dx, dy, dz, maxDist) {
    const ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9);
    let best = maxDist, hit = null;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      let t1 = (b.minX - ox) * ix, t2 = (b.maxX - ox) * ix;
      let tmin = t1 < t2 ? t1 : t2, tmax = t1 < t2 ? t2 : t1;
      t1 = (b.minY - oy) * iy; t2 = (b.maxY - oy) * iy;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmax < tmin) continue;
      t1 = (b.minZ - oz) * iz; t2 = (b.maxZ - oz) * iz;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmax < Math.max(tmin, 0)) continue;
      const t = tmin > 0 ? tmin : 0;
      if (t < best) { best = t; hit = b; }
    }
    if (dy < 0) {
      const tg = -oy / dy;
      if (tg >= 0 && tg < best) return { t: tg, box: null, ground: true };
    }
    return hit ? { t: best, box: hit } : null;
  }

  function rayHumanoid(ox, oy, oz, dx, dy, dz, px, py, pz, crouch, maxDist) {
    let best = null;
    const headY = py + (crouch ? 1.12 : 1.6), hr = 0.26;
    const lx = ox - px, ly = oy - headY, lz = oz - pz;
    const b = lx * dx + ly * dy + lz * dz;
    const c = lx * lx + ly * ly + lz * lz - hr * hr;
    const disc = b * b - c;
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < maxDist) best = { t, head: true };
    }
    const top = py + (crouch ? 0.92 : 1.38), r = 0.3;
    const box = { minX: px - r, maxX: px + r, minY: py, maxY: top, minZ: pz - r, maxZ: pz + r };
    const hit = raycastBoxes([box], ox, oy, oz, dx, dy, dz, best ? best.t : maxDist);
    if (hit && !hit.ground) best = { t: hit.t, head: false };
    return best;
  }

  // =================================================================
  // Grenades and explosions (server and client run the exact same maths)
  // =================================================================
  const GRENADE = { radius: 0.07, gravity: 15, restitution: 0.38, friction: 0.72, dt: 1 / 120 };

  /**
   * Deterministic grenade flight until the fuse runs out, or until the first impact with { impact: true }
   * (molotovs). Returns { x, y, z, t, impact, samples, bounces }: samples are positions every 1/60 s packed
   * as [x, y, z, ...], bounces the sample indices of hard impacts (for sound), t the flight time.
   */
  function simulateGrenade(boxes, x, y, z, vx, vy, vz, fuse, opts = {}) {
    const r = GRENADE.radius, g = GRENADE.gravity, e = GRENADE.restitution, fr = GRENADE.friction, dt = GRENADE.dt;
    const steps = Math.round(fuse / dt);
    const samples = new Float32Array((Math.floor(steps / 2) + 2) * 3);
    const bounces = [];
    const reach = Math.hypot(vx, vz) * fuse + 3;
    const near = boxes.filter((b) => b.maxX > x - reach && b.minX < x + reach && b.maxZ > z - reach && b.minZ < z + reach);
    const lim = (opts.half || HALF) - r;
    let si = 1, resting = false;
    samples[0] = x; samples[1] = y; samples[2] = z;
    for (let i = 1; i <= steps; i++) {
      if (!resting) {
        vy -= g * dt;
        x += vx * dt; y += vy * dt; z += vz * dt;
        let impact = 0, touched = false;
        if (y < r) {
          y = r;
          touched = true;
          if (vy < 0) { impact = Math.max(impact, -vy); vy = -vy * e; vx *= fr; vz *= fr; }
        }
        for (let k = 0; k < near.length; k++) {
          const b = near[k];
          if (x + r <= b.minX || x - r >= b.maxX || y + r <= b.minY || y - r >= b.maxY || z + r <= b.minZ || z - r >= b.maxZ) continue;
          touched = true;
          const px = Math.min(x + r - b.minX, b.maxX - (x - r));
          const py = Math.min(y + r - b.minY, b.maxY - (y - r));
          const pz = Math.min(z + r - b.minZ, b.maxZ - (z - r));
          if (px <= py && px <= pz) {
            x = x < b.x ? b.minX - r : b.maxX + r;
            impact = Math.max(impact, Math.abs(vx));
            vx = -vx * e; vz *= 0.85; vy *= 0.85;
          } else if (py <= pz) {
            if (y > b.y) {
              y = b.maxY + r;
              if (vy < 0) { impact = Math.max(impact, -vy); vy = -vy * e; vx *= fr; vz *= fr; }
            } else {
              y = b.minY - r;
              if (vy > 0) { impact = Math.max(impact, vy); vy = -vy * e; }
            }
          } else {
            z = z < b.z ? b.minZ - r : b.maxZ + r;
            impact = Math.max(impact, Math.abs(vz));
            vz = -vz * e; vx *= 0.85; vy *= 0.85;
          }
        }
        if (x < -lim || x > lim) { x = Math.max(-lim, Math.min(lim, x)); vx = -vx * e; touched = true; }
        if (z < -lim || z > lim) { z = Math.max(-lim, Math.min(lim, z)); vz = -vz * e; touched = true; }
        if (opts.impact && touched) {
          samples[si * 3] = x; samples[si * 3 + 1] = y; samples[si * 3 + 2] = z;
          return { x, y, z, t: i * dt, impact: true, samples: samples.slice(0, (si + 1) * 3), bounces };
        }
        if (impact > 1.5) bounces.push(si);
        if (Math.abs(vy) < 0.6 && impact > 0) {
          vx *= 0.94; vz *= 0.94;
          if (Math.hypot(vx, vz) < 0.25) { vx = vy = vz = 0; resting = true; }
        }
      }
      if (i % 2 === 0) {
        samples[si * 3] = x; samples[si * 3 + 1] = y; samples[si * 3 + 2] = z;
        si++;
      }
    }
    return { x, y, z, t: fuse, impact: false, samples: samples.slice(0, si * 3), bounces };
  }

  /** Damage from a blast at (ex, ey, ez) to a humanoid standing at (px, py, pz); 0 when fully behind cover. */
  function blastDamage(boxes, ex, ey, ez, px, py, pz, crouch, spec) {
    const chestY = py + (crouch ? 0.6 : 1.0);
    const d = Math.hypot(px - ex, chestY - ey, pz - ez);
    if (d >= spec.radius) return 0;
    const dmg = d <= spec.innerRadius ? spec.maxDamage : spec.maxDamage * (1 - (d - spec.innerRadius) / (spec.radius - spec.innerRadius));
    const oy = ey + 0.25;
    for (const ty of [chestY, py + (crouch ? 1.1 : 1.55)]) {
      const dx = px - ex, dy = ty - oy, dz = pz - ez;
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.05) return dmg;
      const hit = raycastBoxes(boxes, ex, oy, ez, dx / len, dy / len, dz / len, len);
      if (!hit || hit.t >= len - 0.05) return dmg;
    }
    return 0;
  }

  /** Height of the highest walkable surface at (x, z) below `ceiling` (0 = open ground). */
  function surfaceHeight(boxes, x, z, ceiling = 30) {
    let h = 0;
    for (const b of boxes) {
      if (b.kind === 'boundary' || b.invisible) continue;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (b.maxY > h && b.maxY < ceiling) h = b.maxY;
    }
    return h;
  }

  /** Where a molotov that shattered at (x, y, z) pools its fire: the surface just below the impact point. */
  function fireSpot(boxes, x, y, z) {
    return { x, y: surfaceHeight(boxes, x, z, y + 0.25), z };
  }

  return {
    SIZE, HALF, WALL_H, DEFAULT_MAP, MAP_LIST, GRENADE, hasMap, buildMap, raycastBoxes, rayHumanoid,
    simulateGrenade, blastDamage, surfaceHeight, fireSpot,
  };
});
