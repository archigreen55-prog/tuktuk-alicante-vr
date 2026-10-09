// Crazy Tuk: intermediate "via" points for the legs between gates where the straight arrow leads into a dead end
// (docs/report-arcade-a2-wave1.md, wave 1.1: the way from the Postiguet beach to MARQ). For every leg of every tour the
// cheapest way over free ground is found (A* on a 1 m grid: no walls / buildings, no slope above 33 %, roads cost 1, open
// ground 2), and when the straight line is blocked or the way is more than 1.4 times longer than it, the corners of that way
// become via points. Writes data/arcade-via.json: { tourId: { gateId: [[x, z], ...] } } (the finish gate: "<id>:finish").
//   node tools/arcade-vias.mjs [--write]
import { readFile, writeFile } from 'node:fs/promises';
import { buildWorld } from './sim-tour.mjs';
import { Terrain } from '../src/city/terrain.js';
import { RoadGraph } from '../src/game/route.js';
import { viasFromPath } from '../src/game/pathfind.js';

const city = JSON.parse(await readFile('data/city.json', 'utf8'));
const spec = JSON.parse(await readFile('data/tour.json', 'utf8'));
const terrain = Terrain.fromBin(city.meta.terrain, (await readFile(city.meta.terrain.file)).buffer.slice(0));
const { world, bounds } = buildWorld();
const R_CAR = 1.0, SLOPE = 0.33, MARGIN = 150, STEP = 2;
const g = city.tour.graph, N = g.n, E = g.e;

const clear = (x, z, r = R_CAR) => world.penetration(x, z, r) === 0;
// a straight segment is drivable: free of walls with clearance r, and no step steeper than SLOPE
function segmentOk(a, b, r = R_CAR) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]); let px = a[0], pz = a[1];
  for (let s = 0; s <= L; s += 1) {
    const t = L ? s / L : 0, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    if (!clear(x, z, r)) return false;
    if (s > 0 && Math.abs(terrain.height(x, z) - terrain.height(px, pz)) > SLOPE * Math.hypot(x - px, z - pz)) return false;
    px = x; pz = z;
  }
  return true;
}
// road mask: graph edges that are really drivable (some are steps / steep paths in OSM), ±4 m
const roadCells = new Set(); const key = (i, j) => i * 100000 + j;
for (let k = 0; k < E.length; k += 3) {
  const a = [N[E[k] * 2], N[E[k] * 2 + 1]], b = [N[E[k + 1] * 2], N[E[k + 1] * 2 + 1]];
  if (!segmentOk(a, b, 0.75)) continue;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let s = 0; s <= L; s += 1.5) { const t = L ? s / L : 0, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; for (let di = -4; di <= 4; di += 2) for (let dj = -4; dj <= 4; dj += 2) roadCells.add(key(Math.round(x + di), Math.round(z + dj))); }
}
// the road graph without the edges that are not really drivable (steps / steep paths in OSM: a wall or > 33 % under the wheels)
const keptEdges = []; let dropped = 0;
for (let k = 0; k < E.length; k += 3) {
  const a = [N[E[k] * 2], N[E[k] * 2 + 1]], b = [N[E[k + 1] * 2], N[E[k + 1] * 2 + 1]];
  if (segmentOk(a, b, 0.75)) keptEdges.push(E[k], E[k + 1], E[k + 2] & ~1); else dropped++;   // & ~1: two-way, a Crazy Tuk player ignores one-way streets
}
const driveGraph = new RoadGraph({ n: N, e: keptEdges });
console.log(`road graph: ${E.length / 3} edges, ${dropped} not drivable (wall or steeper than ${SLOPE * 100} %) dropped`);
const onRoad = (x, z) => roadCells.has(key(Math.round(x), Math.round(z)));

function astar(A, B) {
  const x0 = Math.max(bounds.minX, Math.min(A[0], B[0]) - MARGIN), x1 = Math.min(bounds.maxX, Math.max(A[0], B[0]) + MARGIN);
  const z0 = Math.max(bounds.minZ, Math.min(A[1], B[1]) - MARGIN), z1 = Math.min(bounds.maxZ, Math.max(A[1], B[1]) + MARGIN);
  const W = Math.ceil((x1 - x0) / STEP), H = Math.ceil((z1 - z0) / STEP);
  const cx = (i) => x0 + (i + 0.5) * STEP, cz = (j) => z0 + (j + 0.5) * STEP;
  const freeC = new Int8Array(W * H).fill(-1);   // -1 unknown, 0 blocked, 1 free
  const tightC = new Int8Array(W * H).fill(-1), roadC = new Int8Array(W * H).fill(-1), hC = new Float32Array(W * H).fill(NaN);
  const tight = (c) => { let v = tightC[c]; if (v < 0) { v = clear(cx(c % W), cz((c / W) | 0), 2.2) ? 0 : 1; tightC[c] = v; } return v === 1; };
  const road = (c) => { let v = roadC[c]; if (v < 0) { v = onRoad(cx(c % W), cz((c / W) | 0)) ? 1 : 0; roadC[c] = v; } return v === 1; };
  const hAt = (c) => { let v = hC[c]; if (v !== v) { v = terrain.height(cx(c % W), cz((c / W) | 0)); hC[c] = v; } return v; };
  const isFree = (c) => { let v = freeC[c]; if (v < 0) { v = clear(cx(c % W), cz((c / W) | 0)) ? 1 : 0; freeC[c] = v; } return v === 1; };
  const nearest = (p) => { const i0 = Math.floor((p[0] - x0) / STEP), j0 = Math.floor((p[1] - z0) / STEP); for (let r = 0; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= W || j >= H) continue; const c = j * W + i; if (isFree(c)) return c; } return -1; };
  const s0 = nearest(A), t0 = nearest(B); if (s0 < 0 || t0 < 0) return null;
  const T0 = Date.now(), LIMIT = 60000; let expanded = 0;
  const gs = new Float64Array(W * H).fill(Infinity), prev = new Int32Array(W * H).fill(-1);
  const ti = t0 % W, tj = (t0 / W) | 0, heur = (c) => Math.hypot((c % W) - ti, ((c / W) | 0) - tj) * STEP;
  const heap = [[heur(s0), s0, 0]]; gs[s0] = 0;
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r2 = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r2 < heap.length && heap[r2][0] < heap[m][0]) m = r2; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.length) {
    const [, c, gc] = pop(); if (gc > gs[c]) continue;   // stale queue entry
    if (c === t0) break;
    if (++expanded % 20000 === 0 && Date.now() - T0 > LIMIT) { console.log('  (A* gave up after ' + expanded + ' cells)'); return null; }
    const ci = c % W, cj = (c / W) | 0, hc = hAt(c);
    for (const [di, dj] of D) {
      const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni; if (!isFree(n)) continue;
      const len = Math.hypot(di, dj) * STEP, hn = hAt(n), sl = Math.abs(hn - hc) / len;
      if (sl > SLOPE) continue;
      if (!clear((cx(ci) + cx(ni)) / 2, (cz(cj) + cz(nj)) / 2)) continue;   // a thin wall between two cell centres
      const cost = len * (road(n) ? 1 : 2) * (1 + Math.max(0, sl - 0.1) * 5) + (tight(n) ? 0.6 * len : 0);
      const ng = gs[c] + cost; if (ng < gs[n]) { gs[n] = ng; prev[n] = c; push([ng + heur(n), n, ng]); }
    }
  }
  if (!isFinite(gs[t0])) return null;
  const path = []; for (let c = t0; c >= 0; c = prev[c]) path.push([cx(c % W), cz((c / W) | 0)]);
  return path.reverse();
}
const out = {}; let any = false;
for (const tour of spec.tours) {
  const ids = tour.route.map((r) => r.stop || r.pass).concat([tour.start]);
  const places = city.tour.places;
  let prevP = places[tour.start].p;
  console.log(`\n=== ${tour.id} ===`);
  ids.forEach((id, k) => {
    const finish = k === ids.length - 1, B = places[id].p, A = prevP; prevP = B;
    const straight = Math.hypot(B[0] - A[0], B[1] - A[1]), direct = segmentOk(A, B);
    // the street route first (players drive on streets; one-way streets are respected by the router: it is the way the tour intends); the open-ground A* when there is none
    const rr = driveGraph.routeVia([A, B]);
    let path = rr ? rr.pts : null, how = 'streets';
    if (!path) { path = astar(A, B); how = 'open ground'; }
    let plen = 0; if (path) for (let i = 1; i < path.length; i++) plen += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    // where does the best way head in its first ~100 m, compared with the straight arrow?
    let dev = 0;
    if (path) { let acc = 0, q = path[path.length - 1]; for (let i = 1; i < path.length; i++) { acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); if (acc > 100) { q = path[i]; break; } }
      const a1 = Math.atan2(q[0] - A[0], q[1] - A[1]), a2 = Math.atan2(B[0] - A[0], B[1] - A[1]); dev = Math.abs(Math.atan2(Math.sin(a1 - a2), Math.cos(a1 - a2))) * 180 / Math.PI; }
    const need = path && (plen > 1.35 * straight || dev > 60);
    let vias = [];
    if (need) {
      vias = viasFromPath(path, A, B);   // the same rule as the level editor's suggestions (src/game/pathfind.js)
      any = true; (out[tour.id] ||= {})[finish ? id + ':finish' : id] = vias;
    }
    console.log(`${(finish ? 'FINISH ' : '').padEnd(7)}${id.padEnd(12)} straight ${straight.toFixed(0).padStart(4)} m  start ${dev.toFixed(0).padStart(3)}° off  way ${path ? plen.toFixed(0).padStart(4) + ' m (x' + (plen / straight).toFixed(2) + ', ' + how + ')' : 'NO WAY'}  ${need ? 'vias: ' + JSON.stringify(vias) : '-'}`);
  });
}
if (process.argv.includes('--write')) {
  const lines = Object.entries(out).map(([t, gs]) => `  ${JSON.stringify(t)}: {\n` + Object.entries(gs).map(([id, v]) => `    ${JSON.stringify(id)}: ${JSON.stringify(v)}`).join(',\n') + '\n  }');
  await writeFile('data/arcade-via.json', '{\n' + lines.join(',\n') + '\n}\n'); console.log('\nwritten data/arcade-via.json');
}
