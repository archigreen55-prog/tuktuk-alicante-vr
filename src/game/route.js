// Routes for the tour: A* over the drivable street graph that tools/build-city.mjs writes into
// city.json (tour.graph). No three.js here, so the same code runs in the browser and in Node tools.
// Points snap to the nearest graph EDGE (not node): a stop on one carriageway of a dual road must not
// be reached via the opposite one, and one-way streets are respected.

// speed class (edge flags bits 1-3) -> typical driving speed, m/s: primary/secondary, service and
// links, tertiary, residential, living street
export const CLASS_SPEED = [8, 7, 6.5, 5.5, 4];
// half width of the road surface by the same class (the map draws primary / secondary 12 / 10 m, service 4, tertiary 8, residential 6.5, living street 5):
// the "stay on the road" levels (0.17.0) allow the tuk-tuk's axis this far from the street's axis plus the level's margin
export const ROAD_HALF = [5.5, 2.5, 4, 3.25, 2.5];
const TURN_ANGLE = 50 * Math.PI / 180;  // a heading change above this over ~15 m counts as a turn
const TURN_TIME = 3;                     // s added per turn to the estimate
const CELL = 40;                         // m, grid for nearest-edge queries

export class RoadGraph {
  // g: { n: [x0, z0, x1, z1, ...], e: [a, b, flags, ...] }; flags bit0 = one-way a->b, bits 1-3 speed class
  constructor(g) {
    const n = g.n.length / 2;
    this.x = new Float64Array(n); this.z = new Float64Array(n);
    for (let i = 0; i < n; i++) { this.x[i] = g.n[i * 2]; this.z[i] = g.n[i * 2 + 1]; }
    const m = g.e.length / 3;
    this.ea = new Int32Array(m); this.eb = new Int32Array(m); this.eow = new Uint8Array(m); this.ecls = new Uint8Array(m);
    this.elen = new Float64Array(m); this.etime = new Float64Array(m);
    this.out = Array.from({ length: n }, () => []); // [edge, toNode] pairs usable from a node
    let minX = Infinity, minZ = Infinity;
    for (let i = 0; i < n; i++) { minX = Math.min(minX, this.x[i]); minZ = Math.min(minZ, this.z[i]); }
    this.gx0 = minX - CELL; this.gz0 = minZ - CELL;
    this.grid = new Map();
    for (let k = 0; k < m; k++) {
      const a = g.e[k * 3], b = g.e[k * 3 + 1], f = g.e[k * 3 + 2];
      this.ea[k] = a; this.eb[k] = b; this.eow[k] = f & 1; this.ecls[k] = Math.min(CLASS_SPEED.length - 1, f >> 1);
      const len = Math.hypot(this.x[b] - this.x[a], this.z[b] - this.z[a]);
      this.elen[k] = len;
      this.etime[k] = len / CLASS_SPEED[Math.min(CLASS_SPEED.length - 1, f >> 1)];
      this.out[a].push(k, b);
      if (!(f & 1)) this.out[b].push(k, a);
      // grid cells along the edge
      const i0 = this.cellX(Math.min(this.x[a], this.x[b])), i1 = this.cellX(Math.max(this.x[a], this.x[b]));
      const j0 = this.cellZ(Math.min(this.z[a], this.z[b])), j1 = this.cellZ(Math.max(this.z[a], this.z[b]));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const key = i * 100000 + j;
        let cell = this.grid.get(key);
        if (!cell) this.grid.set(key, (cell = []));
        cell.push(k);
      }
    }
    this.nodeCount = n; this.edgeCount = m;
  }
  roadHalf(k) { return ROAD_HALF[this.ecls[k]]; }   // m: half the width of the road surface of edge k
  cellX(x) { return Math.floor((x - this.gx0) / CELL); }
  cellZ(z) { return Math.floor((z - this.gz0) / CELL); }

  // Nearest point on any edge: { e, t (0..1 from a to b), x, z, d } or null
  nearestEdge(px, pz, maxDist = 400) {
    const ci = this.cellX(px), cj = this.cellZ(pz);
    let best = null;
    for (let r = 0; r * CELL <= maxDist + CELL; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue; // ring r only
        const cell = this.grid.get(i * 100000 + j);
        if (!cell) continue;
        for (const k of cell) {
          const ax = this.x[this.ea[k]], az = this.z[this.ea[k]], bx = this.x[this.eb[k]], bz = this.z[this.eb[k]];
          const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
          let t = ((px - ax) * ex + (pz - az) * ez) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + ex * t, qz = az + ez * t, d = Math.hypot(px - qx, pz - qz);
          if (!best || d < best.d) best = { e: k, t, x: qx, z: qz, d };
        }
      }
      if (best && best.d < r * CELL) break; // nothing in further rings can be closer
    }
    return best && best.d <= maxDist ? best : null;
  }

  // Fastest route between two points: { pts: [[x, z], ...], len (m), time (s, estimate) } or null.
  route(from, to) {
    const s = this.nearestEdge(from[0], from[1]), g = this.nearestEdge(to[0], to[1]);
    if (!s || !g) return null;
    const S = -1, G = -2;
    const tS = (k, frac) => this.etime[k] * frac;
    // same edge, reachable directly
    if (s.e === g.e && (g.t >= s.t || !this.eow[s.e])) {
      return this.finish([[from[0], from[1]], [s.x, s.z], [g.x, g.z], [to[0], to[1]]], this.etime[s.e] * Math.abs(g.t - s.t));
    }
    // start: virtual node on edge s.e; goal: virtual node on g.e
    const start = [[this.eb[s.e], tS(s.e, 1 - s.t)]];
    if (!this.eow[s.e]) start.push([this.ea[s.e], tS(s.e, s.t)]);
    const goalFrom = new Map([[this.ea[g.e], tS(g.e, g.t)]]); // node -> extra time to reach the goal point
    if (!this.eow[g.e]) goalFrom.set(this.eb[g.e], Math.min(goalFrom.get(this.eb[g.e]) ?? Infinity, tS(g.e, 1 - g.t)));
    const gx = g.x, gz = g.z, VMAX = CLASS_SPEED[0];
    const h = (i) => Math.hypot(this.x[i] - gx, this.z[i] - gz) / VMAX;
    const dist = new Map(), prev = new Map(), heap = new MinHeap();
    for (const [node, t] of start) if (t < (dist.get(node) ?? Infinity)) { dist.set(node, t); prev.set(node, S); heap.push(t + h(node), node); }
    let bestGoal = Infinity, bestNode = null;
    const closed = new Set();
    while (heap.size) {
      const [f, u] = heap.pop();
      if (f >= bestGoal) break;
      if (closed.has(u)) continue;
      closed.add(u);
      const du = dist.get(u);
      const extra = goalFrom.get(u);
      if (extra !== undefined && du + extra < bestGoal) { bestGoal = du + extra; bestNode = u; }
      const o = this.out[u];
      for (let i = 0; i < o.length; i += 2) {
        const k = o[i], v = o[i + 1], nd = du + this.etime[k];
        if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); heap.push(nd + h(v), v); }
      }
    }
    if (bestNode === null) return null;
    const nodes = [bestNode];
    while (prev.get(nodes[0]) !== S) nodes.unshift(prev.get(nodes[0]));
    const pts = [[from[0], from[1]], [s.x, s.z]];
    for (const i of nodes) pts.push([this.x[i], this.z[i]]);
    pts.push([g.x, g.z], [to[0], to[1]]);
    return this.finish(pts, bestGoal);
  }

  // Route through several points in order (waypoints); null if any leg has no route.
  routeVia(points) {
    let pts = [], len = 0, time = 0, turns = 0;
    for (let i = 1; i < points.length; i++) {
      const r = this.route(points[i - 1], points[i]);
      if (!r) return null;
      pts = pts.length ? pts.concat(r.pts.slice(1)) : r.pts;
      len += r.len; time += r.time; turns += r.turns;
    }
    return { pts, len, time, turns };
  }

  // drop near-duplicate points, add the turn penalty
  finish(raw, time) {
    const pts = [];
    for (const p of raw) { const q = pts[pts.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.5) pts.push(p); }
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const turns = countTurns(pts);
    return { pts, len, time: time + turns * TURN_TIME, turns };
  }
}

// Heading changes above TURN_ANGLE between directions sampled ~15 m apart along the polyline.
export function countTurns(pts) {
  const samples = resample(pts, 7.5);
  let turns = 0, last = -Infinity;
  for (let i = 2; i < samples.length; i++) {
    const a = samples[i - 2], b = samples[i - 1], c = samples[i];
    const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]), h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    const dh = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
    if (dh > TURN_ANGLE && i - last > 2) { turns++; last = i; }
  }
  return turns;
}

// Points every `step` metres along a polyline.
export function resample(pts, step) {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = step - carry;
    while (s <= L) { out.push([a[0] + (b[0] - a[0]) * s / L, a[1] + (b[1] - a[1]) * s / L]); s += step; }
    carry = L - (s - step);
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) > 0.5) out.push(last);
  return out;
}

// Distance from a point to a polyline, and the arc length at the closest point.
export function polylineDistance(pts, px, pz) {
  let best = Infinity, at = 0, acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez, L = Math.sqrt(l2);
    let t = l2 ? ((px - a[0]) * ex + (pz - a[1]) * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(px - a[0] - ex * t, pz - a[1] - ez * t);
    if (d < best) { best = d; at = acc + L * t; }
    acc += L;
  }
  return { d: best, at };
}

// Distance from a point to flat [x0, z0, x1, z1, ...] segments (closed ring if closed).
export function flatDistance(flat, px, pz, closed) {
  const n = flat.length / 2;
  if (n === 1) return Math.hypot(px - flat[0], pz - flat[1]);
  let best = Infinity;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    const ax = flat[i * 2], az = flat[i * 2 + 1], ex = flat[j * 2] - ax, ez = flat[j * 2 + 1] - az;
    const l2 = ex * ex + ez * ez;
    let t = l2 ? ((px - ax) * ex + (pz - az) * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    best = Math.min(best, Math.hypot(px - ax - ex * t, pz - az - ez * t));
  }
  return best;
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = [k[0], v[0]];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}
