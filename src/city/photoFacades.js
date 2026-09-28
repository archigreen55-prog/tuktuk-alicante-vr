// Photo facades (plan-stage-5 §2.7, docs/report-mercado.md): which walls of a landmark a photo
// covers and where a wall point lands in the photo. Pure math, no three.js: shared by the game
// (src/city/landmarks.js builds the mesh) and tools/prepare-facade.mjs (rectifies the photos).
//
// data/facades.json, per building (OSM id):
//   "h": 11.1                    building height = roof (merged into city.json by tools/build-city.mjs)
//   "photos": [ entry, ... ]     read by the game at load time
// A placed photo:
//   "id", "src"                  prepared image (tools/prepare-facade.mjs writes it; *.mask.png next to it
//                                if the entry has an "outline")
//   "edges": [first, last]       ring edges it covers (inclusive, may wrap), see `prepare-facade.mjs --list`
//   "view": 60                   optional: compass bearing the camera looked along (default: straight at
//                                the walls). Needed for round walls (a rotunda)
//   "span": [from, to]           optional: metres along the facade the photo shows (default: all of it);
//                                the rest of those walls gets the wall tile
//   "lathe": [[y, r], ...]       optional: a dome (body of revolution) on the circle of these walls,
//                                profile height/radius in metres (radii scaled so the first sits on the
//                                walls), textured by the same photo; the walls stop at the first height
//   "mirror": 0.54               optional, with "lathe": the dome's axis in the photo (fraction of the width);
//                                the dome uses only the photo's left half, mirrored (e.g. a palm covers the right)
//   "align": { "13": 0.304 }     optional: where the start corner of wall 13 really is in the prepared
//                                image (fraction of its width; see assets/facades/.check/<id>-walls.jpg),
//                                when the OSM outline and the photo disagree a little
// A wall tile (repeats along every wall no photo covers):
//   "wall": 6.4                  tile width in metres (the height follows from the image), "top": wall
//                                height in metres (default: the tile height)
// Tool-only fields (the game ignores them): "from", "corners", "outline", "height", "focal35", "px", "credit".
// The image's bottom row is ground level; its top (in metres) follows from its aspect ratio.

export const JOG_INSET = 0.3;    // m: walls across the photo plane (jogs) take the photo column this far in
const FACE_COS = 0.5;            // |cos| between an edge and the photo plane: above = the edge faces the camera

export function ringOf(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}
function orient(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
// Edge i: start, end, unit direction, length, outward normal (same convention as the wall builder)
export function edgeOf(ring, i) {
  const sgn = orient(ring) > 0 ? 1 : -1;
  const a = ring[i], b = ring[(i + 1) % ring.length];
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1e-6;
  return { i, a, b, dir: [dx / len, dz / len], len, n: [(sgn * dz) / len, (-sgn * dx) / len] };
}
export function edgeRange(n, [first, last]) {
  const out = [];
  for (let k = 0, i = ((first % n) + n) % n; k < n; k++, i = (i + 1) % n) { out.push(i); if (i === ((last % n) + n) % n) break; }
  return out;
}
// compass bearing (0 = north, 90 = east) of a direction in the game's x = east, z = south plane
export const bearingOf = (dx, dz) => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
const dirOfBearing = (deg) => [Math.sin((deg * Math.PI) / 180), -Math.cos((deg * Math.PI) / 180)];

// Where a placed photo sits: the photo's horizontal axis ("right" as seen by the camera), the covered
// edges and the span in metres from the facade's left end.
export function photoPlacement(ring, entry) {
  const edges = edgeRange(ring.length, entry.edges).map((i) => edgeOf(ring, i));
  let d;
  if (entry.view != null) d = dirOfBearing(entry.view);
  else {
    let nx = 0, nz = 0;
    for (const e of edges) { nx += e.n[0] * e.len; nz += e.n[1] * e.len; }
    const l = Math.hypot(nx, nz) || 1;
    d = [-nx / l, -nz / l];
  }
  const right = [-d[1], d[0]];             // camera right = view x up
  const proj = (p) => p[0] * right[0] + p[1] * right[1];
  let min = Infinity, max = -Infinity;
  for (const e of edges) for (const p of [e.a, e.b]) { const u = proj(p); min = Math.min(min, u); max = Math.max(max, u); }
  const extent = max - min;
  const [s0, s1] = entry.span || [0, extent];
  // with an explicit view (round walls) every edge takes the projection; otherwise edges across the
  // photo plane are jogs of a straight facade (they get a photo column, see landmarks.js)
  for (const e of edges) e.face = entry.view != null || Math.abs(e.dir[0] * right[0] + e.dir[1] * right[1]) >= FACE_COS;
  const pl = { edges, view: d, right, min, extent, s0, s1, width: s1 - s0 };
  pl.u = (x, z) => x * right[0] + z * right[1] - min;           // metres from the left end of the facade
  // photo x (0..1) of a facade position u (m): linear over the span, bent through the "align" knots
  const knots = [[s0, 0], [s1, 1]];
  for (const [k, f] of Object.entries(entry.align || {})) {
    const e = edges.find((q) => q.i === +k);
    if (e) knots.push([pl.u(e.a[0], e.a[1]), f]);
  }
  knots.sort((p, q) => p[0] - q[0]);
  pl.knots = knots.map((k) => k[0]);
  pl.frac = (u) => {
    let i = 1;
    while (i < knots.length - 1 && u > knots[i][0]) i++;
    const [u0, f0] = knots[i - 1], [u1, f1] = knots[i];
    return f0 + ((u - u0) / (u1 - u0 || 1)) * (f1 - f0);
  };
  if (entry.lathe) pl.circle = fitCircle(edges.flatMap((e) => [e.a, e.b]));
  return pl;
}

// Least-squares circle through points (Kåsa fit): { c: [x, z], r }
export function fitCircle(pts) {
  let sx = 0, sz = 0;
  for (const p of pts) { sx += p[0]; sz += p[1]; }
  const mx = sx / pts.length, mz = sz / pts.length;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx, v = p[1] - mz;
    suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv || 1e-9;
  const bu = (suuu + suvv) / 2, bv = (svvv + svuu) / 2;
  const uc = (bu * svv - bv * suv) / det, vc = (bv * suu - bu * suv) / det;
  return { c: [mx + uc, mz + vc], r: Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length) };
}

// Human-readable table of a building's edges for choosing "edges" (tools/prepare-facade.mjs --list)
export function describeEdges(ring, codes = '') {
  const kinds = ['двір', 'житлова вулиця', 'головна вулиця'];
  return ring.map((_, i) => {
    const e = edgeOf(ring, i);
    const code = codes.charCodeAt(i) - 48;
    const street = code >= 0 ? (code & 1 ? 'спільна стіна' : kinds[code >> 1]) : '';
    return { i, len: e.len, faces: Math.round(bearingOf(e.n[0], e.n[1])), street };
  });
}
