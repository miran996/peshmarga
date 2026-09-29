/** Spatial-hashed AABB collision for characters (feet position, radius, height). */
export class Physics {
  constructor(map, cellSize = 4) {
    this.map = map;
    this.cs = cellSize;
    this.cells = new Map();
    for (const b of map.boxes) {
      const x0 = Math.floor(b.minX / cellSize), x1 = Math.floor(b.maxX / cellSize);
      const z0 = Math.floor(b.minZ / cellSize), z1 = Math.floor(b.maxZ / cellSize);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x * 1000 + z;
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(b);
      }
    }
    this.stamp = 0;
    this.out = [];
  }

  query(minX, maxX, minZ, maxZ) {
    const cs = this.cs;
    const out = this.out;
    out.length = 0;
    this.stamp++;
    for (let x = Math.floor(minX / cs); x <= Math.floor(maxX / cs); x++) {
      for (let z = Math.floor(minZ / cs); z <= Math.floor(maxZ / cs); z++) {
        const list = this.cells.get(x * 1000 + z);
        if (!list) continue;
        for (const b of list) {
          if (b._s === this.stamp) continue;
          b._s = this.stamp;
          out.push(b);
        }
      }
    }
    return out;
  }

  /** Push the character out of walls on the XZ plane. Returns true if blocked. */
  resolveXZ(pos, r, h, step = 0.45) {
    const feet = pos.y;
    let blocked = false;
    const list = this.query(pos.x - r - 0.1, pos.x + r + 0.1, pos.z - r - 0.1, pos.z + r + 0.1);
    for (let iter = 0; iter < 2; iter++) {
      for (const b of list) {
        if (b.maxY <= feet + step || b.minY >= feet + h) continue;
        const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        blocked = true;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x += (dx / d) * (r - d);
          pos.z += (dz / d) * (r - d);
        } else {
          const pen = [pos.x - b.minX, b.maxX - pos.x, pos.z - b.minZ, b.maxZ - pos.z];
          const m = Math.min(...pen);
          if (m === pen[0]) pos.x = b.minX - r;
          else if (m === pen[1]) pos.x = b.maxX + r;
          else if (m === pen[2]) pos.z = b.minZ - r;
          else pos.z = b.maxZ + r;
        }
      }
    }
    const lim = this.map.HALF - r;
    pos.x = Math.max(-lim, Math.min(lim, pos.x));
    pos.z = Math.max(-lim, Math.min(lim, pos.z));
    return blocked;
  }

  /** Highest surface beneath the character that it can stand on. */
  groundHeight(pos, r, step = 0.45) {
    let g = 0;
    const list = this.query(pos.x - r, pos.x + r, pos.z - r, pos.z + r);
    const rr = r * 0.7;
    for (const b of list) {
      if (b.maxY > pos.y + step) continue;
      if (pos.x + rr < b.minX || pos.x - rr > b.maxX || pos.z + rr < b.minZ || pos.z - rr > b.maxZ) continue;
      if (b.maxY > g) g = b.maxY;
    }
    return g;
  }

  /** Lowest ceiling above the character's feet (for jump / uncrouch). */
  ceiling(pos, r, from) {
    let c = Infinity;
    const list = this.query(pos.x - r, pos.x + r, pos.z - r, pos.z + r);
    const rr = r * 0.8;
    for (const b of list) {
      if (b.minY < from) continue;
      if (pos.x + rr < b.minX || pos.x - rr > b.maxX || pos.z + rr < b.minZ || pos.z - rr > b.maxZ) continue;
      if (b.minY < c) c = b.minY;
    }
    return c;
  }
}
