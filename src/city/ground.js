// The ground mesh (plan-terrain.md 4.1): the height grid is resampled onto a 2^k + 1 square grid and
// triangulated with an error bound (RTIN, after mapbox/martini: flat blocks become big triangles, the hill
// keeps small ones), then split into chunks for frustum culling. Around the grid a skirt of flat quads
// continues the edge heights out to the fog, so there is no cliff at the edge of the data.
// Vertex colours: sand / dry scrub by height, rock on steep slopes. One MeshLambertMaterial.
import * as THREE from 'three';
import { rand } from './geo.js';

const GRID = 513;            // RTIN grid (2^9 + 1)
const SKIRT = 1500;          // m the skirt reaches beyond the grid
const COL = {
  low: new THREE.Color(0xd9ccb0),    // the city ground colour (flat land)
  scrub: new THREE.Color(0xa8a06a),  // dry scrub on the hill
  rock: new THREE.Color(0xb8a78e),   // bare rock on steep slopes
  high: new THREE.Color(0xc4b48c),
};

// terrain: Terrain (src/city/terrain.js). Returns { group, stats }
export function buildGround(terrain, { chunks = 4, maxError = 0.55, farError = 1.4, far = 900 } = {}) {
  const t0 = performance.now();
  const x0 = terrain.x0, z0 = terrain.z0, x1 = terrain.x1, z1 = terrain.z1;
  const N = GRID, sx = (x1 - x0) / (N - 1), sz = (z1 - z0) / (N - 1);
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = terrain.height(x0 + i * sx, z0 + j * sz);
  const rtin = new Rtin(N);
  const tile = rtin.tile(H);
  const centre = [(x0 + x1) / 2, (z0 + z1) / 2];
  const group = new THREE.Group();
  group.name = 'ground';
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  let tris = 0;
  // two meshes per chunk would double the draw calls; instead one mesh at the fine error and the far
  // chunks (from the centre) at the coarse one — the player rarely sees far chunks up close
  const fine = tile.mesh(maxError), coarse = tile.mesh(farError);
  const cw = (x1 - x0) / chunks, ch = (z1 - z0) / chunks;
  const buckets = new Map();
  const put = (mesh, filter) => {
    const { vertices, triangles } = mesh;
    for (let k = 0; k < triangles.length; k += 3) {
      const a = triangles[k], b = triangles[k + 1], c = triangles[k + 2];
      const cx = ((vertices[a * 2] + vertices[b * 2] + vertices[c * 2]) / 3) * sx + x0;
      const cz = ((vertices[a * 2 + 1] + vertices[b * 2 + 1] + vertices[c * 2 + 1]) / 3) * sz + z0;
      const ci = Math.min(chunks - 1, Math.floor((cx - x0) / cw)), cj = Math.min(chunks - 1, Math.floor((cz - z0) / ch));
      if (!filter(ci, cj)) continue;
      const key = ci + ',' + cj;
      let g = buckets.get(key);
      if (!g) buckets.set(key, (g = { pos: [], col: [] }));
      for (const v of [a, b, c]) {
        const gx = vertices[v * 2], gz = vertices[v * 2 + 1];
        g.pos.push(x0 + gx * sx, H[gz * N + gx], z0 + gz * sz);
      }
      tris++;
    }
  };
  // which chunks are "far": those whose centre is beyond `far` from the area centre
  const isFar = (ci, cj) => Math.hypot(x0 + (ci + 0.5) * cw - centre[0], z0 + (cj + 0.5) * ch - centre[1]) > far;
  put(fine, (ci, cj) => !isFar(ci, cj));
  put(coarse, (ci, cj) => isFar(ci, cj));
  for (const [key, g] of buckets) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(g.pos);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // normals from the height grid (smooth across triangle edges), colours by height and slope
    const n = pos.length / 3, nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const tmp = new THREE.Color();
    for (let v = 0; v < n; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const [gx, gz] = terrain.gradient(x, z);
      const nx = -gx, ny = 1, nz = -gz, l = Math.hypot(nx, ny, nz);
      nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
      const slope = Math.hypot(gx, gz);
      tmp.copy(COL.low).lerp(COL.scrub, THREE.MathUtils.smoothstep(y, 6, 30)).lerp(COL.high, THREE.MathUtils.smoothstep(y, 60, 150));
      tmp.lerp(COL.rock, THREE.MathUtils.smoothstep(slope, 0.35, 0.8));
      const j = 0.97 + 0.06 * rand(Math.round(x * 3 + z * 7));
      col[v * 3] = tmp.r * j; col[v * 3 + 1] = tmp.g * j; col[v * 3 + 2] = tmp.b * j;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'ground ' + key;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  group.add(buildSkirt(terrain, mat));
  return { group, stats: { groundTris: tris, groundChunks: buckets.size, fineTris: fine.triangles.length / 3, coarseTris: coarse.triangles.length / 3, groundMs: Math.round(performance.now() - t0) } };
}

// Flat quads from the grid edge outwards, at the edge heights (the sea side is 0 anyway)
function buildSkirt(terrain, mat) {
  const x0 = terrain.x0, z0 = terrain.z0, x1 = terrain.x1, z1 = terrain.z1;
  const pos = [], col = [];
  const c = COL.low;
  const STEP = 40;
  const quad = (ax, az, bx, bz, cx, cz, dx, dz, ya, yb) => { // a-b along the edge, c-d outside (same heights)
    pos.push(ax, ya, az, bx, yb, bz, cx, yb, cz, ax, ya, az, cx, yb, cz, dx, ya, dz);
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  };
  for (let x = x0; x < x1 - 0.01; x += STEP) {
    const xb = Math.min(x1, x + STEP);
    quad(x, z0, xb, z0, xb, z0 - SKIRT, x, z0 - SKIRT, terrain.height(x, z0), terrain.height(xb, z0)); // north
    quad(xb, z1, x, z1, x, z1 + SKIRT, xb, z1 + SKIRT, terrain.height(xb, z1), terrain.height(x, z1)); // south
  }
  for (let z = z0; z < z1 - 0.01; z += STEP) {
    const zb = Math.min(z1, z + STEP);
    quad(x0, zb, x0, z, x0 - SKIRT, z, x0 - SKIRT, zb, terrain.height(x0, zb), terrain.height(x0, z)); // west
    quad(x1, z, x1, zb, x1 + SKIRT, zb, x1 + SKIRT, z, terrain.height(x1, z), terrain.height(x1, zb)); // east
  }
  // corners
  for (const [cx, cz, ox, oz] of [[x0, z0, -1, -1], [x1, z0, 1, -1], [x1, z1, 1, 1], [x0, z1, -1, 1]]) {
    const y = terrain.height(cx, cz);
    const p = [[cx, cz], [cx + ox * SKIRT, cz], [cx + ox * SKIRT, cz + oz * SKIRT], [cx, cz + oz * SKIRT]];
    const order = ox * oz > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const k of order) { pos.push(p[k][0], y, p[k][1]); col.push(c.r, c.g, c.b); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = pos.length / 3, nor = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) nor[v * 3 + 1] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ground skirt';
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ---------- RTIN (right-triangulated irregular network), after mapbox/martini ----------
class Rtin {
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
  tile(terrain) { return new RtinTile(terrain, this); }
}
class RtinTile {
  constructor(terrain, rtin) {
    this.terrain = terrain; this.rtin = rtin;
    this.errors = new Float32Array(terrain.length);
    const { numTriangles, numParentTriangles, coords, size } = rtin;
    for (let i = numTriangles - 1; i >= 0; i--) {
      const k = i * 4;
      const ax = coords[k], ay = coords[k + 1], bx = coords[k + 2], by = coords[k + 3];
      const mx = (ax + bx) >> 1, my = (ay + by) >> 1, cx = mx + my - ay, cy = my + ax - mx;
      const interpolated = (terrain[ay * size + ax] + terrain[by * size + bx]) / 2;
      const middle = my * size + mx;
      const err = Math.abs(interpolated - terrain[middle]);
      this.errors[middle] = Math.max(this.errors[middle], err);
      if (i < numParentTriangles) {
        const left = ((ay + cy) >> 1) * size + ((ax + cx) >> 1), right = ((by + cy) >> 1) * size + ((bx + cx) >> 1);
        this.errors[middle] = Math.max(this.errors[middle], this.errors[left], this.errors[right]);
      }
    }
  }
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
