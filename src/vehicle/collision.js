// 2D collision world: polygon edges (buildings, walls, sea, play-area bounds)
// indexed in a uniform grid; circles are pushed out of edges.
export const KIND = { building: 0, wall: 1, sea: 2, bounds: 3, model: 4 };
export const KIND_NAME = ['будівля', 'мур замку/міста', 'море', 'межа зони', 'модель пам\'ятки'];

export class CollisionWorld {
  constructor(rect, cell = 16, margin = 80) {
    this.cell = cell;
    this.ox = rect.minX - margin;
    this.oz = rect.minZ - margin;
    this.nx = Math.ceil((rect.maxX - rect.minX + 2 * margin) / cell);
    this.nz = Math.ceil((rect.maxZ - rect.minZ + 2 * margin) / cell);
    this.cells = Array.from({ length: this.nx * this.nz }, () => []);
    this.edges = [];
    this.kindList = [];   // per edge: what it belongs to (KIND), for the ?debug=walls overlay and its messages
    this.stamp = null;
    this.query = 0;
  }

  addPolygon(flat, closed = true, kind = 0) {
    const n = flat.length / 2;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n;
      this.addEdge(flat[i * 2], flat[i * 2 + 1], flat[j * 2], flat[j * 2 + 1], kind);
    }
  }

  addEdge(ax, az, bx, bz, kind = 0) {
    const c = this.cell;
    let i0 = Math.floor((Math.min(ax, bx) - this.ox) / c), i1 = Math.floor((Math.max(ax, bx) - this.ox) / c);
    let j0 = Math.floor((Math.min(az, bz) - this.oz) / c), j1 = Math.floor((Math.max(az, bz) - this.oz) / c);
    if (i1 < 0 || j1 < 0 || i0 >= this.nx || j0 >= this.nz) return;
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(this.nx - 1, i1); j1 = Math.min(this.nz - 1, j1);
    const idx = this.edges.length / 4;
    this.edges.push(ax, az, bx, bz);
    this.kindList[idx] = kind;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[j * this.nx + i].push(idx);
  }

  finalize() {
    this.E = new Float64Array(this.edges);
    this.kind = Uint8Array.from(this.kindList); this.kindList = null;
    this.stamp = new Uint32Array(this.E.length / 4);
    this.edges = null;
    this.cells = this.cells.map((a) => Int32Array.from(a));
  }

  get edgeCount() { return this.E.length / 4; }

  // the edges within r of (x, z), for the debug overlay: [{ ax, az, bx, bz, kind }]
  edgesNear(x, z, r) {
    const c = this.cell, out = [], seen = new Set();
    const i0 = Math.max(0, Math.floor((x - r - this.ox) / c)), i1 = Math.min(this.nx - 1, Math.floor((x + r - this.ox) / c));
    const j0 = Math.max(0, Math.floor((z - r - this.oz) / c)), j1 = Math.min(this.nz - 1, Math.floor((z + r - this.oz) / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const e of this.cells[j * this.nx + i]) {
      if (seen.has(e)) continue; seen.add(e);
      out.push({ ax: this.E[e * 4], az: this.E[e * 4 + 1], bx: this.E[e * 4 + 2], bz: this.E[e * 4 + 3], kind: this.kind[e] });
    }
    return out;
  }

  // Pushes the circle (cx, cz, r) out of all nearby edges. Calls onContact(nx, nz, depth)
  // for each push. Returns the corrected centre as [x, z].
  resolveCircle(cx, cz, r, onContact) {
    const c = this.cell, E = this.E;
    const i0 = Math.max(0, Math.floor((cx - r - this.ox) / c)), i1 = Math.min(this.nx - 1, Math.floor((cx + r - this.ox) / c));
    const j0 = Math.max(0, Math.floor((cz - r - this.oz) / c)), j1 = Math.min(this.nz - 1, Math.floor((cz + r - this.oz) / c));
    const q = ++this.query;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = this.cells[j * this.nx + i];
        for (let k = 0; k < cell.length; k++) {
          const e = cell[k];
          if (this.stamp[e] === q) continue;
          this.stamp[e] = q;
          const ax = E[e * 4], az = E[e * 4 + 1], bx = E[e * 4 + 2], bz = E[e * 4 + 3];
          const ex = bx - ax, ez = bz - az;
          const len2 = ex * ex + ez * ez;
          let t = len2 > 0 ? ((cx - ax) * ex + (cz - az) * ez) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + ex * t, pz = az + ez * t;
          const dx = cx - px, dz = cz - pz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r || d2 < 1e-12) continue;
          const d = Math.sqrt(d2), depth = r - d, nx = dx / d, nz = dz / d;
          cx += nx * depth; cz += nz * depth;
          if (onContact) onContact(nx, nz, depth, e);
        }
      }
    }
    return [cx, cz];
  }

  // Deepest penetration of a circle (no correction).
  penetration(cx, cz, r) {
    let worst = 0;
    this.resolveCircle(cx, cz, r, (nx, nz, d) => { if (d > worst) worst = d; });
    return worst;
  }
}
