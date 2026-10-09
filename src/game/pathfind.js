// Checks of a level against the map (0.18.0, the editor's "Перевірка"): can every gate be reached, is a gate on free ground and near a road, are
// two gates too close, and where is a "via" point needed (a detour round a dead end: the corners of the best way over the streets). No DOM, no
// three.js: runs in the game and in Node (tools/test-level-edit.mjs, tools/arcade-vias.mjs shares viasFromPath).
// The drivable street graph: the streets of data/city.json without the edges a tuk-tuk cannot drive (a wall or a slope above 33 % on them: steps
// and steep paths of OSM, 45 of 3032 edges); the list is data/drive-graph.json (tools/make-drivegraph.mjs), one-way streets are ignored
// (a Crazy Tuk player drives as he wants).
import { RoadGraph } from './route.js';

export const PATH = {
  detour: 1.35, devDeg: 60,         // a leg needs via points when the way is this much longer than the straight line, or starts this far off the straight direction
  gateGap: 25,                      // m: gates closer than this to each other are skipped by the next one
  roadMax: 20,                      // m: a gate this far from a drivable street is "away from the road"
  clearR: 1.0,                      // m: the body's clearance a gate's point must have to be free ground
  viaEps: 25, viaFromEnds: 40, viaThin: 60, viaMax: 8,   // the corners of the way: simplification (m), none closer than this to the ends / to each other, at most
};

// dropped: the indices of the edges to leave out (data/drive-graph.json "dropped")
export function driveGraph(city, dropped = []) {
  const g = city.tour.graph, drop = new Set(dropped), e = [];
  for (let k = 0; k < g.e.length / 3; k++) if (!drop.has(k)) e.push(g.e[k * 3], g.e[k * 3 + 1], g.e[k * 3 + 2] & ~1);   // & ~1: two-way
  return new RoadGraph({ n: g.n, e });
}

const distSeg = (p, a, b) => { const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1; let t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t); };
function simplify(pts, eps) {   // Douglas-Peucker
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const rec = (a, b) => { let best = -1, bd = 0; for (let i = a + 1; i < b; i++) { const d = distSeg(pts[i], pts[a], pts[b]); if (d > bd) { bd = d; best = i; } } if (bd > eps) { keep[best] = 1; rec(a, best); rec(best, b); } };
  rec(0, pts.length - 1); return pts.filter((_, i) => keep[i]);
}
export const pathLength = (pts) => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };
// the via points of a way A -> B: its corners, not close to the ends or to each other
export function viasFromPath(path, A, B) {
  const pts = simplify(path, PATH.viaEps).slice(1, -1).filter((p) => Math.hypot(p[0] - A[0], p[1] - A[1]) > PATH.viaFromEnds && Math.hypot(p[0] - B[0], p[1] - B[1]) > PATH.viaFromEnds);
  const thin = []; for (const p of pts) if (!thin.length || Math.hypot(p[0] - thin[thin.length - 1][0], p[1] - thin[thin.length - 1][1]) > PATH.viaThin) thin.push(p);
  return thin.slice(0, PATH.viaMax).map((p) => [Math.round(p[0]), Math.round(p[1])]);
}
// one leg: { reach, len (m, 0 when none), straight, dev (deg, how far the first 100 m head off the straight line), need, vias }
export function analyseLeg(dg, A, B) {
  const straight = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const r = dg.routeVia([A, B]);
  if (!r) return { reach: false, len: 0, straight, dev: 0, need: false, vias: [] };
  const path = r.pts, len = pathLength(path);
  let acc = 0, q = path[path.length - 1];
  for (let i = 1; i < path.length; i++) { acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); if (acc > 100) { q = path[i]; break; } }
  const a1 = Math.atan2(q[0] - A[0], q[1] - A[1]), a2 = Math.atan2(B[0] - A[0], B[1] - A[1]);
  const dev = Math.abs(Math.atan2(Math.sin(a1 - a2), Math.cos(a1 - a2))) * 180 / Math.PI;
  const need = len > PATH.detour * straight || dev > PATH.devDeg;
  return { reach: true, len, straight, dev, need, vias: need ? viasFromPath(path, A, B) : [] };
}

// doc: LevelDoc; ctx: { drive: driveGraph(...), clear(x, z, r) -> bool (free of walls with clearance r) }
// -> { level: [text], items: Map(index -> [text]), suggestions: [{ at, vias, text }], len (m of the way through the gates), legs: [{ at, ...analyseLeg }] }
export function checkLevel(doc, ctx) {
  const out = { level: [], items: new Map(), suggestions: [], len: 0, legs: [] };
  const add = (i, t) => { const a = out.items.get(i) || []; a.push(t); out.items.set(i, a); };
  const start = doc.startPoint(); if (!start) return out;
  // gates: on free ground, near a drivable street, not too close to each other
  const gates = [];
  doc.items.forEach((it, i) => {
    if (it.k !== 'gate') return;
    const p = doc.pointOf(it); if (!p) return; gates.push({ i, p });
    if (ctx.clear && !ctx.clear(p[0], p[1], PATH.clearR)) add(i, 'ворота стоять у стіні або будівлі: перетягни на дорогу');
    const e = ctx.drive.nearestEdge(p[0], p[1], 400);
    if (!e || e.d > PATH.roadMax) add(i, `далеко від дороги${e ? ` (${Math.round(e.d)} м)` : ''}: перетягни ближче до вулиці`);
  });
  for (let a = 0; a < gates.length; a++) for (let b = a + 1; b < gates.length; b++) {
    if (Math.hypot(gates[a].p[0] - gates[b].p[0], gates[a].p[1] - gates[b].p[1]) < PATH.gateGap) { add(gates[b].i, `ближче ${PATH.gateGap} м до воріт ${doc.gateNumber(gates[a].i)}: наступні ворота цей проїзд «пропустять»`); }
  }
  // legs between consecutive points. A leg from the start / a gate straight to the next gate is judged by the detour rule (and then gets its via points
  // suggested); legs that have via points in them are the author's: only whether they can be driven at all is checked (so that accepting the suggestions
  // always ends the suggestions)
  let prev = start, prevGate = true;
  doc.items.forEach((it, i) => {
    const p = doc.pointOf(it); if (!p) return;
    const leg = analyseLeg(ctx.drive, prev, p), direct = prevGate && it.k === 'gate';
    out.legs.push({ at: i, ...leg, direct });
    if (!leg.reach) add(i, 'недосяжні з попередньої точки по вулицях: перевір, чи не стоїть точка на сходах або за муром');
    else {
      out.len += leg.len;
      if (direct && leg.need && leg.vias.length) {
        const ratio = leg.len / (leg.straight || 1), text = `потрібен об'їзд: шлях ×${ratio.toFixed(1)} довший за пряму, ${leg.vias.length} точок «через»`;
        out.suggestions.push({ at: i, vias: leg.vias, text }); add(i, text);
      }
    }
    prev = p; prevGate = it.k === 'gate';
  });
  return out;
}
