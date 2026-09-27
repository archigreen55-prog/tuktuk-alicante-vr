// Builds the three.js scene content from data/city.json.
// Flat ground layers (ground, sea, parks, plazas, roads) are drawn first with depthWrite off and
// explicit renderOrder, so they layer like paint with no z-fighting; everything that stands up
// (buildings, mount, palms, the tuk-tuk) is drawn afterwards with normal depth.
import * as THREE from 'three';
import { GeoBuilder, pairs, orient, rand } from './geo.js';

const COLORS = {
  ground: 0xd9ccb0,
  sea: 0x2f86b8,
  park: 0x8fbf6a,
  plaza: 0xe4d6bc,
  road: { primary: 0x55585d, primary_link: 0x55585d, secondary: 0x5c5f64, tertiary: 0x63666b, residential: 0x6c6f74, unclassified: 0x6c6f74, living_street: 0x8a8580, service: 0x77797d, busway: 0x6a4a44, pedestrian: 0xcdbd9f },
  mountLow: 0x9a9a5c, mountHigh: 0xc8a878, castle: 0xd8c29a,
  trunk: 0x8a6a45, frond: 0x3f8f3a,
};
// Draw order among roads: paths first, big roads on top.
const ROAD_RANK = ['pedestrian', 'service', 'living_street', 'busway', 'residential', 'unclassified', 'tertiary', 'secondary', 'primary_link', 'primary'];

function flatMesh(geo, order, name) {
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false }));
  mesh.renderOrder = order;
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export function buildCity(city) {
  const group = new THREE.Group();
  group.name = 'city';
  const c = (hex) => new THREE.Color(hex);
  const stats = {};

  // ---------- ground ----------
  {
    const gb = new GeoBuilder();
    const S = 6000;
    gb.polygon([[-S, -S], [S, -S], [S, S], [-S, S]], null, 0, c(COLORS.ground));
    group.add(flatMesh(gb.build(), -20, 'ground'));
  }
  // ---------- sea ----------
  {
    const gb = new GeoBuilder();
    gb.polygon(pairs(city.sea), null, 0, c(COLORS.sea));
    group.add(flatMesh(gb.build(), -19, 'sea'));
  }
  // ---------- parks & plazas ----------
  {
    const gb = new GeoBuilder();
    for (const p of city.parks) gb.polygon(pairs(p), null, 0, c(COLORS.park));
    group.add(flatMesh(gb.build(), -18, 'parks'));
    const gp = new GeoBuilder();
    for (const p of city.plazas) gp.polygon(pairs(p), null, 0, c(COLORS.plaza));
    group.add(flatMesh(gp.build(), -17, 'plazas'));
  }
  // ---------- roads ----------
  {
    const gb = new GeoBuilder();
    const sorted = city.roads.slice().sort((a, b) => ROAD_RANK.indexOf(a.k) - ROAD_RANK.indexOf(b.k));
    const colCache = {};
    for (const r of sorted) {
      const col = colCache[r.k] || (colCache[r.k] = c(COLORS.road[r.k] ?? 0x6c6f74));
      addRibbon(gb, pairs(r.p), r.w, col);
    }
    group.add(flatMesh(gb.build(), -16, 'roads'));
    stats.roadTris = gb.triangles;
  }
  // ---------- buildings (chunked for frustum culling) ----------
  {
    const CH = 400;
    const chunks = new Map();
    const palette = city.palette.map((h) => c(h));
    const tmp = new THREE.Color();
    let tris = 0;
    city.buildings.forEach((b, idx) => {
      const ring = pairs(b.p);
      let cx = 0, cz = 0;
      for (const [x, z] of ring) { cx += x; cz += z; }
      cx /= ring.length; cz /= ring.length;
      const key = Math.floor(cx / CH) + ',' + Math.floor(cz / CH);
      let gb = chunks.get(key);
      if (!gb) chunks.set(key, (gb = new GeoBuilder()));
      const base = palette[b.c];
      const top = base.clone().multiplyScalar(0.96 + rand(idx) * 0.08);
      const bottom = top.clone().multiplyScalar(0.72); // cheap ambient-occlusion at street level
      const roof = tmp.copy(top).multiplyScalar(0.82).clone();
      const holes = (b.holes || []).map(pairs);
      addWalls(gb, ring, b.h, false, top, bottom);
      for (const h of holes) addWalls(gb, h, b.h, true, top, bottom);
      gb.polygon(ring, holes, b.h, roof);
    });
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const [key, gb] of chunks) {
      tris += gb.triangles;
      const mesh = new THREE.Mesh(gb.build(), mat);
      mesh.name = 'buildings ' + key;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    stats.buildingTris = tris;
    stats.buildingChunks = chunks.size;
  }
  // ---------- Benacantil + castle (decor) ----------
  group.add(buildMount(city.mount));
  // ---------- palms ----------
  group.add(...buildPalms(city.palms));

  group.updateMatrixWorld(true);
  return { group, stats };
}

function addWalls(gb, ring, h, isHole, top, bottom) {
  const sgn = (orient(ring) > 0 ? 1 : -1) * (isHole ? -1 : 1);
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    const nn = [(sgn * dz) / len, 0, (-sgn * dx) / len];
    const a0 = [a[0], 0, a[1]], b0 = [b[0], 0, b[1]], b1 = [b[0], h, b[1]], a1 = [a[0], h, a[1]];
    gb.tri(a0, b0, b1, nn, bottom, bottom, top);
    gb.tri(a0, b1, a1, nn, bottom, top, top);
  }
}

// Road polyline -> ribbon with mitred joints and round-ish end caps.
function addRibbon(gb, pts, w, col) {
  const hw = w / 2, n = pts.length, up = [0, 1, 0], y = 0;
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    let nx = 0, nz = 0;
    const seg = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
    let n0 = null, n1 = null;
    if (i > 0) n0 = seg(pts[i - 1], pts[i]);
    if (i < n - 1) n1 = seg(pts[i], pts[i + 1]);
    const m = n0 && n1 ? [n0[0] + n1[0], n0[1] + n1[1]] : (n0 || n1);
    const ml = Math.hypot(m[0], m[1]) || 1;
    nx = m[0] / ml; nz = m[1] / ml;
    const ref = n1 || n0;
    const scale = hw / Math.max(0.5, nx * ref[0] + nz * ref[1]);
    L.push([pts[i][0] + nx * scale, y, pts[i][1] + nz * scale]);
    R.push([pts[i][0] - nx * scale, y, pts[i][1] - nz * scale]);
  }
  for (let i = 0; i < n - 1; i++) {
    gb.tri(L[i], R[i], R[i + 1], up, col);
    gb.tri(L[i], R[i + 1], L[i + 1], up, col);
  }
  for (const p of [pts[0], pts[n - 1]]) {
    const seg = 8;
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2;
      gb.tri([p[0], y, p[1]], [p[0] + Math.cos(a0) * hw, y, p[1] + Math.sin(a0) * hw], [p[0] + Math.cos(a1) * hw, y, p[1] + Math.sin(a1) * hw], up, col);
    }
  }
}

// Low-poly hill built from rings between the foot outline and the castle outline.
function buildMount(m) {
  const foot = pairs(m.foot), castle = pairs(m.castle);
  let cx = 0, cz = 0;
  for (const [x, z] of castle) { cx += x; cz += z; }
  cx /= castle.length; cz /= castle.length;
  const H = m.height - 16; // plateau under the castle walls
  const rayHit = (poly, ang) => {
    const dx = Math.cos(ang), dz = Math.sin(ang);
    let best = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a[0] - cx) * ez - (a[1] - cz) * ex) / den;
      const u = ((a[0] - cx) * dz - (a[1] - cz) * dx) / den;
      if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t);
    }
    return best;
  };
  const SEG = 40;
  const S = [1, 0.8, 0.6, 0.4, 0.2, 0]; // 1 = foot, 0 = plateau edge
  const HY = [0, 0.2, 0.45, 0.7, 0.9, 1];
  const low = new THREE.Color(COLORS.mountLow), high = new THREE.Color(COLORS.mountHigh);
  const rings = S.map((s, k) => {
    const out = [];
    for (let i = 0; i < SEG; i++) {
      const ang = (i / SEG) * Math.PI * 2;
      const rf = rayHit(foot, ang), rc = rayHit(castle, ang) * 0.95;
      const jitter = k > 0 && k < S.length - 1 ? (rand(i * 31 + k) - 0.5) * 0.12 : 0;
      const r = rc + (rf - rc) * s * (1 + jitter);
      const y = H * HY[k] * (k > 0 && k < S.length - 1 ? 1 + (rand(i * 17 + k * 5) - 0.5) * 0.12 : 1);
      out.push([cx + Math.cos(ang) * r, y, cz + Math.sin(ang) * r]);
    }
    return out;
  });
  const gb = new GeoBuilder();
  const colAt = (y) => low.clone().lerp(high, Math.min(1, y / H));
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    for (let i = 0; i < SEG; i++) {
      const j = (i + 1) % SEG;
      const a = A[i], b = A[j], c2 = B[j], d = B[i];
      for (const [p, q, r] of [[a, b, c2], [a, c2, d]]) {
        // outward normal = cross product, oriented away from the hill centre
        const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
        const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
        let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        const l = Math.hypot(...n) || 1; n = n.map((v) => v / l);
        if (n[1] < 0) n = n.map((v) => -v);
        gb.tri(p, q, r, n, colAt((p[1] + q[1] + r[1]) / 3));
      }
    }
  }
  // plateau
  const top = rings[rings.length - 1];
  for (let i = 0; i < SEG; i++) gb.tri([cx, H, cz], top[i], top[(i + 1) % SEG], [0, 1, 0], high);
  // castle: wall band along its outline + a few towers
  const stone = new THREE.Color(COLORS.castle), stoneDark = stone.clone().multiplyScalar(0.8);
  const wall = castle.map(([x, z]) => [cx + (x - cx) * 0.85, cz + (z - cz) * 0.85]);
  const WH = 12;
  const sgn = orient(wall) > 0 ? 1 : -1;
  for (let i = 0; i < wall.length; i++) {
    const a = wall[i], b = wall[(i + 1) % wall.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const n = [(sgn * dz) / l, 0, (-sgn * dx) / l];
    gb.tri([a[0], H - 2, a[1]], [b[0], H - 2, b[1]], [b[0], H + WH, b[1]], n, stoneDark, stoneDark, stone);
    gb.tri([a[0], H - 2, a[1]], [b[0], H + WH, b[1]], [a[0], H + WH, a[1]], n, stoneDark, stone, stone);
  }
  gb.polygon(wall, null, H + WH, stone.clone().multiplyScalar(0.9));
  // towers
  for (let t = 0; t < wall.length; t += Math.max(1, Math.floor(wall.length / 5))) {
    const [x, z] = wall[t];
    addBox(gb, x, z, 7, H + WH + 8, stone);
  }
  const mesh = new THREE.Mesh(gb.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.name = 'mount';
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function addBox(gb, x, z, s, h, col) {
  const r = s / 2;
  const q = [[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]];
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const mx = (a[0] + b[0]) / 2 - x, mz = (a[1] + b[1]) / 2 - z, l = Math.hypot(mx, mz);
    const n = [mx / l, 0, mz / l];
    gb.tri([a[0], 0 + h * 0.6, a[1]], [b[0], h * 0.6, b[1]], [b[0], h, b[1]], n, col);
    gb.tri([a[0], h * 0.6, a[1]], [b[0], h, b[1]], [a[0], h, a[1]], n, col);
  }
  gb.polygon(q, null, h, col);
}

function buildPalms(flat) {
  const count = flat.length / 2;
  // trunk: slim open cylinder, 5 sides
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 7, 5, 1, true).translate(0, 3.5, 0);
  // crown: 7 drooping fronds, 2 triangles each
  const fb = new GeoBuilder();
  const green = new THREE.Color(COLORS.frond), greenDark = green.clone().multiplyScalar(0.7);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), px = -sa, pz = ca;
    const T = [0, 7, 0], M = [ca * 1.6, 7.45, sa * 1.6], tip = [ca * 3.1, 6.2, sa * 3.1];
    const ML = [M[0] + px * 0.45, M[1], M[2] + pz * 0.45], MR = [M[0] - px * 0.45, M[1], M[2] - pz * 0.45];
    fb.tri(T, ML, MR, [0, 1, 0], greenDark, green, green);
    fb.tri(ML, tip, MR, [0, 1, 0], green, greenDark, green);
  }
  const crownGeo = fb.build();
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: COLORS.trunk }), count);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
  for (let i = 0; i < count; i++) {
    const sc = 0.8 + rand(i) * 0.55;
    e.set((rand(i + 7) - 0.5) * 0.08, rand(i + 3) * Math.PI * 2, (rand(i + 11) - 0.5) * 0.08);
    q.setFromEuler(e);
    m.compose(p.set(flat[i * 2], 0, flat[i * 2 + 1]), q, s.set(sc, sc, sc));
    trunk.setMatrixAt(i, m);
    crown.setMatrixAt(i, m);
  }
  trunk.name = 'palm trunks'; crown.name = 'palm crowns';
  trunk.computeBoundingSphere(); crown.computeBoundingSphere();
  return [trunk, crown];
}
