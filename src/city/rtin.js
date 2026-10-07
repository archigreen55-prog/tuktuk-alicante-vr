// RTIN (right-triangulated irregular network), after mapbox/martini. No three.js: used by the ground
// mesh (src/city/ground.js) in the browser and by tools/check-ground.mjs in Node.
// A tile is built from a size x size height array (size = 2^k + 1). `tol` (optional, same size) gives a
// per-node tolerance in metres: a node whose interpolation error exceeds ITS tolerance forces a split,
// so the mesh can be fine under the roads and coarse elsewhere. mesh(maxError) then takes the plain
// error bound (without `tol`) or any value >= 1 meaning "within tolerance" (with `tol`, pass 1).
export class Rtin {
  constructor(size) {
    this.size = size;
    const tileSize = size - 1;
    this.numTriangles = tileSize * tileSize * 2 - 2;
    this.numParentTriangles = this.numTriangles - tileSize * tileSize;
    this.indices = new Uint32Array(size * size);
    this.coords = new Uint16Array(this.numTriangles * 4);
    for (let i = 0; i < this.numTriangles; i++) {
      let id = i + 2, ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0;
      if (id & 1) { bx = by = cx = tileSize; } else { ax = ay = cy = tileSize; }
      while ((id >>= 1) > 1) {
        const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
        if (id & 1) { bx = ax; by = ay; ax = cx; ay = cy; } else { ax = bx; ay = by; bx = cx; by = cy; }
        cx = mx; cy = my;
      }
      const k = i * 4;
      this.coords[k] = ax; this.coords[k + 1] = ay; this.coords[k + 2] = bx; this.coords[k + 3] = by;
    }
  }
  tile(heights, tol = null) { return new RtinTile(heights, this, tol); }
}

export class RtinTile {
  constructor(terrain, rtin, tol = null) {
    this.terrain = terrain; this.rtin = rtin;
    this.errors = new Float32Array(terrain.length);
    const { numTriangles, numParentTriangles, coords, size } = rtin;
    for (let i = numTriangles - 1; i >= 0; i--) {
      const k = i * 4;
      const ax = coords[k], ay = coords[k + 1], bx = coords[k + 2], by = coords[k + 3];
      const mx = (ax + bx) >> 1, my = (ay + by) >> 1, cx = mx + my - ay, cy = my + ax - mx;
      const interpolated = (terrain[ay * size + ax] + terrain[by * size + bx]) / 2;
      const middle = my * size + mx;
      let err = Math.abs(interpolated - terrain[middle]);
      if (tol) err /= tol[middle];
      this.errors[middle] = Math.max(this.errors[middle], err);
      if (i < numParentTriangles) {
        const left = ((ay + cy) >> 1) * size + ((ax + cx) >> 1), right = ((by + cy) >> 1) * size + ((bx + cx) >> 1);
        this.errors[middle] = Math.max(this.errors[middle], this.errors[left], this.errors[right]);
      }
    }
  }
  // { vertices: Uint16Array [gx, gz, ...], triangles: Uint32Array [a, b, c, ...] }
  mesh(maxError = 0) {
    const { size, indices } = this.rtin, errors = this.errors, max = size - 1;
    let numVertices = 0, numTriangles = 0;
    indices.fill(0);
    const count = (ax, ay, bx, by, cx, cy) => {
      const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
      if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * size + mx] > maxError) {
        count(cx, cy, ax, ay, mx, my); count(bx, by, cx, cy, mx, my);
      } else {
        indices[ay * size + ax] = indices[ay * size + ax] || ++numVertices;
        indices[by * size + bx] = indices[by * size + bx] || ++numVertices;
        indices[cy * size + cx] = indices[cy * size + cx] || ++numVertices;
        numTriangles++;
      }
    };
    count(0, 0, max, max, max, 0); count(max, max, 0, 0, 0, max);
    const vertices = new Uint16Array(numVertices * 2), triangles = new Uint32Array(numTriangles * 3);
    let ti = 0;
    const emit = (ax, ay, bx, by, cx, cy) => {
      const mx = (ax + bx) >> 1, my = (ay + by) >> 1;
      if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * size + mx] > maxError) {
        emit(cx, cy, ax, ay, mx, my); emit(bx, by, cx, cy, mx, my);
      } else {
        const a = indices[ay * size + ax] - 1, b = indices[by * size + bx] - 1, c = indices[cy * size + cx] - 1;
        vertices[2 * a] = ax; vertices[2 * a + 1] = ay; vertices[2 * b] = bx; vertices[2 * b + 1] = by; vertices[2 * c] = cx; vertices[2 * c + 1] = cy;
        triangles[ti++] = a; triangles[ti++] = b; triangles[ti++] = c;
      }
    };
    emit(0, 0, max, max, max, 0); emit(max, max, 0, 0, 0, max);
    return { vertices, triangles };
  }
}
