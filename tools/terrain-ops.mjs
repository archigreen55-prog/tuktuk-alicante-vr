// Terrain shaping for tools/build-city.mjs (plan-terrain.md 4.2–4.4): road profiles along the
// street axes (sampled every 5 m, smoothed, agreed at junctions, grade-limited), roads carved into the
// height grid (flat across the carriageway and sidewalk, a blend band outside), areas flattened
// (sea, car parks). Pure functions over a Terrain from src/city/terrain.js.

const STEP = 5;          // m between profile samples
const SMOOTH = 15;       // m, half window of the moving average along a road
const MAX_GRADE = 0.25;  // steeper profiles are clipped (short DEM noise; real ramps this steep are stairs)
const BAND = 4;          // m of blend from the carved road edge back to the natural ground

// Points every STEP metres along a polyline, the original vertices kept (with their index)
export function resampleKeep(pts, step = STEP) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const a = pts[i - 1], b = pts[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.round(L / step));
      for (let k = 1; k < n; k++) out.push({ x: a[0] + (b[0] - a[0]) * k / n, z: a[1] + (b[1] - a[1]) * k / n, v: -1 });
    }
    out.push({ x: pts[i][0], z: pts[i][1], v: i });
  }
  let s = 0;
  for (let i = 0; i < out.length; i++) { if (i) s += Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z); out[i].s = s; }
  return out;
}

// Height profile of one road: DEM sampled, smoothed along s, grade-limited. Returns the samples with y.
export function roadProfile(terrain, pts) {
  const P = resampleKeep(pts);
  const raw = P.map((p) => terrain.height(p.x, p.z));
  for (let i = 0; i < P.length; i++) {
    let sum = 0, wsum = 0;
    for (let j = 0; j < P.length; j++) {
      const d = Math.abs(P[j].s - P[i].s);
      if (d > SMOOTH) continue;
      const w = 1 - d / (SMOOTH + 1);
      sum += raw[j] * w; wsum += w;
    }
    P[i].y = sum / wsum;
  }
  limitGrade(P);
  return P;
}

function limitGrade(P) {
  for (let i = 1; i < P.length; i++) {
    const ds = P[i].s - P[i - 1].s;
    P[i].y = Math.min(P[i - 1].y + MAX_GRADE * ds, Math.max(P[i - 1].y - MAX_GRADE * ds, P[i].y));
  }
  for (let i = P.length - 2; i >= 0; i--) {
    const ds = P[i + 1].s - P[i].s;
    P[i].y = Math.min(P[i + 1].y + MAX_GRADE * ds, Math.max(P[i + 1].y - MAX_GRADE * ds, P[i].y));
  }
}

// Roads sharing an OSM node get one height there: the height of the most important road (profile.rank,
// higher wins; pedestrian ways adapt to the streets, side streets to the avenues; ties average), then
// each profile is bent linearly between its pinned vertices. profiles[i].nodes: OSM node id per vertex.
export function pinJunctions(profiles) {
  const at = new Map(); // node id -> [{ profile, sample }]
  for (const pr of profiles) {
    if (!pr.nodes) continue;
    for (const p of pr.P) {
      if (p.v < 0) continue;
      const id = pr.nodes[p.v];
      if (id == null) continue;
      (at.get(id) || at.set(id, []).get(id)).push({ pr, p });
    }
  }
  let pinned = 0;
  const pins = new Map();
  for (const [id, list] of at) {
    if (list.length < 2) continue;
    const top = Math.max(...list.map((e) => e.pr.rank || 0));
    const best = list.filter((e) => (e.pr.rank || 0) === top);
    const y = best.reduce((s, e) => s + e.p.y, 0) / best.length;
    pins.set(id, y); pinned++;
  }
  for (const pr of profiles) {
    if (!pr.nodes) continue;
    const P = pr.P;
    const idx = [];
    for (let i = 0; i < P.length; i++) if (P[i].v >= 0 && pins.has(pr.nodes[P[i].v])) idx.push(i);
    if (!idx.length) continue;
    const corr = new Float64Array(P.length);
    const c = (i) => pins.get(pr.nodes[P[i].v]) - P[i].y;
    for (let i = 0; i < P.length; i++) {
      if (i <= idx[0]) corr[i] = c(idx[0]);
      else if (i >= idx[idx.length - 1]) corr[i] = c(idx[idx.length - 1]);
      else {
        let k = 0;
        while (idx[k + 1] < i) k++;
        const a = idx[k], b = idx[k + 1], t = (P[i].s - P[a].s) / (P[b].s - P[a].s || 1);
        corr[i] = c(a) * (1 - t) + c(b) * t;
      }
    }
    for (let i = 0; i < P.length; i++) P[i].y += corr[i];
    limitGrade(P);
    for (const i of idx) P[i].y = pins.get(pr.nodes[P[i].v]); // the pins win over the grade limit: roads must meet
  }
  return pinned;
}

// Carve one road (profile P, half width r0) into the grid: cells within r0 of the axis take the
// profile height, cells within r0 + BAND blend back. `owner` (Float32Array per cell, Infinity = natural
// ground) remembers how far from its road's axis a carved cell lies: a road only overwrites a cell that
// another road carved when its own axis is nearer, so a lane on a terrace keeps its level where a wide
// avenue passes below it (there is a retaining wall between them in reality).
export function carveRoad(terrain, P, r0, owner, claim = true) {
  const best = new Map(); // cell index -> { d, y }
  const R = r0 + BAND;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-9;
    const [u0, v0] = terrain.cell(Math.min(a.x, b.x) - R, Math.min(a.z, b.z) - R);
    const [u1, v1] = terrain.cell(Math.max(a.x, b.x) + R, Math.max(a.z, b.z) + R);
    for (let j = Math.max(0, Math.floor(v0)); j <= Math.min(terrain.rows - 1, Math.ceil(v1)); j++) {
      const z = terrain.z0 + j * terrain.dz;
      for (let ii = Math.max(0, Math.floor(u0)); ii <= Math.min(terrain.cols - 1, Math.ceil(u1)); ii++) {
        const x = terrain.x0 + ii * terrain.dx;
        let t = ((x - a.x) * ex + (z - a.z) * ez) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - a.x - ex * t, z - a.z - ez * t);
        if (d > R) continue;
        const k = j * terrain.cols + ii;
        const cur = best.get(k);
        if (!cur || d < cur.d) best.set(k, { d, y: a.y + (b.y - a.y) * t });
      }
    }
  }
  for (const [k, { d, y }] of best) {
    const other = owner ? owner[k] : Infinity;
    if (d <= r0) {
      if (d > other && Math.abs(y - terrain.h[k]) > 1.5) continue; // a terrace: the nearer road keeps its level
      terrain.h[k] = y;
      if (owner && claim) owner[k] = Math.min(d, other);
    } else if (other === Infinity) {        // the band never touches another road's carriageway
      const t = (d - r0) / BAND; terrain.h[k] = y * (1 - t) + terrain.h[k] * t;
    }
  }
}

// Every cell whose centre lies inside the ring gets fn(currentHeight)
export function shapeInside(terrain, ring, fn) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const [u0, v0] = terrain.cell(minX, minZ), [u1, v1] = terrain.cell(maxX, maxZ);
  let n = 0;
  for (let j = Math.max(0, Math.ceil(v0)); j <= Math.min(terrain.rows - 1, Math.floor(v1)); j++) {
    const z = terrain.z0 + j * terrain.dz;
    for (let i = Math.max(0, Math.ceil(u0)); i <= Math.min(terrain.cols - 1, Math.floor(u1)); i++) {
      const x = terrain.x0 + i * terrain.dx;
      if (!pip([x, z], ring)) continue;
      const k = j * terrain.cols + i;
      terrain.h[k] = fn(terrain.h[k]); n++;
    }
  }
  return n;
}

export function pip(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > pt[1]) !== (zj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// mean height of a ring's vertices
export function meanHeight(terrain, ring) {
  let s = 0;
  for (const [x, z] of ring) s += terrain.height(x, z);
  return s / ring.length;
}
