/**
 * Sanity-checks every map layout: spawns are clear of geometry and every spawn can walk to every other
 * (same grid rules as the bot navigation in public/js/game/bots.js).
 */
const MapLib = require('../shared/map');

const CELL = 0.5, RADIUS = 0.42;
let failed = false;

for (const { id, name } of MapLib.MAP_LIST) {
  const t0 = process.hrtime.bigint();
  const map = MapLib.buildMap(id);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const n = Math.ceil(map.SIZE / CELL);
  const grid = new Uint8Array(n * n);
  for (const b of map.boxes) {
    if (b.maxY < 0.5 || b.minY > 1.7) continue;
    const i0 = Math.max(0, Math.ceil((b.minX - RADIUS + map.HALF) / CELL - 0.5));
    const i1 = Math.min(n - 1, Math.floor((b.maxX + RADIUS + map.HALF) / CELL - 0.5));
    const j0 = Math.max(0, Math.ceil((b.minZ - RADIUS + map.HALF) / CELL - 0.5));
    const j1 = Math.min(n - 1, Math.floor((b.maxZ + RADIUS + map.HALF) / CELL - 0.5));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) grid[j * n + i] = 1;
  }
  const edge = Math.ceil(0.6 / CELL);
  for (let i = 0; i < n; i++) for (let k = 0; k < edge; k++) {
    grid[k * n + i] = grid[(n - 1 - k) * n + i] = 1;
    grid[i * n + k] = grid[i * n + (n - 1 - k)] = 1;
  }
  const cell = (v) => Math.max(0, Math.min(n - 1, Math.floor((v + map.HALF) / CELL)));

  const problems = [];
  const s0 = map.spawns[0];
  const seen = new Uint8Array(n * n);
  const start = cell(s0.z) * n + cell(s0.x);
  const stack = [start];
  seen[start] = 1;
  let reach = 0;
  while (stack.length) {
    const c = stack.pop();
    reach++;
    const i = c % n, j = (c / n) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const k = b * n + a;
      if (!grid[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
    }
  }
  let free = 0;
  for (let k = 0; k < n * n; k++) if (!grid[k]) free++;

  map.spawns.forEach((sp, idx) => {
    const k = cell(sp.z) * n + cell(sp.x);
    if (grid[k]) problems.push(`spawn ${idx} (${sp.x.toFixed(1)}, ${sp.z.toFixed(1)}) is inside geometry`);
    else if (!seen[k]) problems.push(`spawn ${idx} (${sp.x.toFixed(1)}, ${sp.z.toFixed(1)}) is cut off from spawn 0`);
  });
  const pct = ((reach / free) * 100).toFixed(1);
  if (reach / free < 0.9) problems.push(`only ${pct}% of open ground is reachable`);

  const status = problems.length ? 'FAIL' : 'PASS';
  console.log(`${status}  ${name.padEnd(15)} ${String(map.boxes.length).padStart(4)} boxes, ${String(map.coverPoints.length).padStart(4)} cover points, ${pct}% reachable, built in ${ms.toFixed(0)} ms`);
  for (const p of problems) console.log(`      - ${p}`);
  if (problems.length) failed = true;
}

process.exit(failed ? 1 : 0);
