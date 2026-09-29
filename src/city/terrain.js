// Terrain heights (plan-terrain.md 2.2, 4.1): one regular grid in local metres (x = east, z = south),
// row 0 = the northern edge. The same class serves tools/build-city.mjs (carves roads and building
// footprints into the grid, writes data/terrain.bin), the city builder (drapes roads, plazas, buildings),
// the physics (height and slope under the wheels) and tools/sim-tour.mjs in Node. No three.js.
//
// data/terrain.bin: Int16 little-endian, centimetres, rows * cols values; the header lives in
// city.json meta.terrain { cols, rows, x0, z0, dx, dz, min, max, file, attribution }.

export class Terrain {
  constructor({ cols, rows, x0, z0, dx, dz, h }) {
    this.cols = cols; this.rows = rows;
    this.x0 = x0; this.z0 = z0;   // world position of cell (0, 0) (its centre)
    this.dx = dx; this.dz = dz;   // cell size, m
    this.h = h;                   // Float32Array rows * cols
  }
  get x1() { return this.x0 + (this.cols - 1) * this.dx; }
  get z1() { return this.z0 + (this.rows - 1) * this.dz; }
  at(i, j) { return this.h[j * this.cols + i]; }
  set(i, j, v) { this.h[j * this.cols + i] = v; }
  // cell coordinates (fractional) of a world point
  cell(x, z) { return [(x - this.x0) / this.dx, (z - this.z0) / this.dz]; }

  // Bilinear height at a world point; outside the grid the nearest edge value (flat continuation)
  height(x, z) {
    const { cols, rows, h } = this;
    let u = (x - this.x0) / this.dx, v = (z - this.z0) / this.dz;
    if (u < 0) u = 0; else if (u > cols - 1) u = cols - 1;
    if (v < 0) v = 0; else if (v > rows - 1) v = rows - 1;
    const i = Math.min(cols - 2, Math.floor(u)), j = Math.min(rows - 2, Math.floor(v));
    const fu = u - i, fv = v - j;
    const k = j * cols + i;
    return (h[k] * (1 - fu) + h[k + 1] * fu) * (1 - fv) + (h[k + cols] * (1 - fu) + h[k + cols + 1] * fu) * fv;
  }
  // slope components dh/dx, dh/dz at a world point (central differences over one cell)
  gradient(x, z) {
    const gx = (this.height(x + this.dx, z) - this.height(x - this.dx, z)) / (2 * this.dx);
    const gz = (this.height(x, z + this.dz) - this.height(x, z - this.dz)) / (2 * this.dz);
    return [gx, gz];
  }
  // A flat grid (every height 0) of the same layout: ?terrain=0 and the T0 check
  static flat(like) { return new Terrain({ ...like.meta(), h: new Float32Array(like.cols * like.rows) }); }
  meta() { return { cols: this.cols, rows: this.rows, x0: this.x0, z0: this.z0, dx: this.dx, dz: this.dz }; }

  // ---------- files ----------
  // ESRI ASCII grid (data/raw/dem5.asc, lat/lon cells) -> local metres through proj(lat, lon). The
  // header of the IGN service has no NODATA_value line; cells are read while the line starts with a letter.
  static fromAsc(text, proj) {
    const lines = text.split('\n');
    const hdr = {};
    let i = 0;
    for (; i < lines.length && /^[a-zA-Z]/.test(lines[i]); i++) { const [k, v] = lines[i].trim().split(/\s+/); hdr[k.toLowerCase()] = +v; }
    const cols = hdr.ncols, rows = hdr.nrows, cell = hdr.cellsize;
    const nodata = hdr.nodata_value ?? -9999;
    const h = new Float32Array(cols * rows);
    let j = 0;
    for (; i < lines.length && j < rows; i++) {
      const s = lines[i].trim();
      if (!s) continue;
      const parts = s.split(/\s+/);
      for (let c = 0; c < cols; c++) { const v = +parts[c]; h[j * cols + c] = v === nodata || !Number.isFinite(v) ? 0 : v; }
      j++;
    }
    if (j !== rows) throw new Error(`ASCII grid: expected ${rows} rows, read ${j}`);
    // cell centres: the first row is the northern edge (max lat)
    const lat0 = hdr.yllcorner + (rows - 0.5) * cell, lon0 = hdr.xllcorner + 0.5 * cell;
    const [x0, z0] = proj(lat0, lon0);
    const [x1, z1] = proj(hdr.yllcorner + 0.5 * cell, hdr.xllcorner + (cols - 0.5) * cell);
    return new Terrain({ cols, rows, x0, z0, dx: (x1 - x0) / (cols - 1), dz: (z1 - z0) / (rows - 1), h });
  }
  // Int16 centimetres
  toBin() {
    const out = new Int16Array(this.h.length);
    for (let k = 0; k < out.length; k++) out[k] = Math.round(Math.max(-327, Math.min(327, this.h[k])) * 100);
    return new Uint8Array(out.buffer);
  }
  static fromBin(meta, buffer) {
    const src = new Int16Array(buffer.byteLength ? buffer : new ArrayBuffer(0));
    if (src.length !== meta.cols * meta.rows) throw new Error(`terrain.bin: ${src.length} values, expected ${meta.cols * meta.rows}`);
    const h = new Float32Array(src.length);
    for (let k = 0; k < h.length; k++) h[k] = src[k] / 100;
    return new Terrain({ ...meta, h });
  }
  stats() {
    let min = Infinity, max = -Infinity;
    for (const v of this.h) { if (v < min) min = v; if (v > max) max = v; }
    return { min, max };
  }
}

// Heights along a polyline [[x, z], ...] every `step` metres (and at the vertices): [{ s, x, z, y }]
export function profileAlong(terrain, pts, step = 5) {
  const out = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const a = pts[i - 1], b = pts[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = step; t < L - 0.5; t += step) {
        const x = a[0] + (b[0] - a[0]) * t / L, z = a[1] + (b[1] - a[1]) * t / L;
        out.push({ s: s + t, x, z, y: terrain.height(x, z) });
      }
      s += L;
    }
    out.push({ s, x: pts[i][0], z: pts[i][1], y: terrain.height(pts[i][0], pts[i][1]) });
  }
  return out;
}
