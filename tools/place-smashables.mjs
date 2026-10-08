// Crazy Tuk 0.15.0: where the smashable things stand along a tour (traffic cones, terrace tables, bins, beach umbrellas).
// Positions are generated, not invented by hand: along the street route through the gates (the same drivable two-way graph and the
// via points of tools/arcade-vias.mjs), seeded, so the file is reproducible. Terrace tables stand near the bars / restaurants / cafes
// of the OSM dump that are close to the route, umbrellas on the sand between the route and the sea, cones in short lines on the edge of
// the road, bins on the pavement every ~100 m. Everything is checked against the collision world (never inside a building).
//   node tools/place-smashables.mjs [tourId=short] [--write]      -> data/smashables.json { tourId: [[type, x, z, rotation], ...] }
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { buildWorld } from './sim-tour.mjs';
import { Terrain } from '../src/city/terrain.js';
import { RoadGraph } from '../src/game/route.js';

const tourId = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'short';
const city = JSON.parse(await readFile('data/city.json', 'utf8'));
const spec = JSON.parse(await readFile('data/tour.json', 'utf8'));
const via = JSON.parse(await readFile('data/arcade-via.json', 'utf8'))[tourId] || {};
const osm = JSON.parse(await readFile('data/raw/alicante.osm.json', 'utf8'));
const terrain = Terrain.fromBin(city.meta.terrain, (await readFile(city.meta.terrain.file)).buffer.slice(0));
const { world } = buildWorld();
const g = city.tour.graph, N = g.n, E = g.e;
const free = (x, z, r) => world.penetration(x, z, r) === 0;
function segmentOk(a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]); let px = a[0], pz = a[1];
  for (let s = 0; s <= L; s += 1) { const t = L ? s / L : 0, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; if (!free(x, z, 0.75)) return false; if (s > 0 && Math.abs(terrain.height(x, z) - terrain.height(px, pz)) > 0.33 * Math.hypot(x - px, z - pz)) return false; px = x; pz = z; }
  return true;
}
const kept = []; for (let k = 0; k < E.length; k += 3) { const a = [N[E[k] * 2], N[E[k] * 2 + 1]], b = [N[E[k + 1] * 2], N[E[k + 1] * 2 + 1]]; if (segmentOk(a, b)) kept.push(E[k], E[k + 1], E[k + 2] & ~1); }
const graph = new RoadGraph({ n: N, e: kept });

// the route: start -> gates (through their via points) -> finish, resampled every 2 m
const tour = spec.tours.find((t) => t.id === tourId);
const ids = tour.route.map((r) => r.stop || r.pass);
let pts = [city.tour.places[tour.start].p];
for (const id of ids.concat([tour.start + ':finish'])) {
  const placeId = id.replace(':finish', '');
  for (const v of via[id] || []) pts.push(v);
  pts.push(city.tour.places[placeId].p);
}
const route = []; { const r = graph.routeVia(pts); for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let s = 0; s < L; s += 2) route.push([a[0] + (b[0] - a[0]) * s / L, a[1] + (b[1] - a[1]) * s / L, Math.atan2(b[1] - a[1], b[0] - a[0])]); } }
console.log(`${tourId}: route ${route.length * 2} m`);

let seed = 20261008; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const out = [], taken = [];
const near = (x, z, d) => taken.some(([a, b]) => Math.hypot(a - x, b - z) < d);
const add = (t, x, z, rot, gap) => { if (near(x, z, gap)) return false; taken.push([x, z]); out.push([t, +x.toFixed(1), +z.toFixed(1), +rot.toFixed(2)]); return true; };
const distToRoute = (x, z) => { let d = 1e9; for (let i = 0; i < route.length; i += 2) d = Math.min(d, Math.hypot(route[i][0] - x, route[i][1] - z)); return d; };
const seaDist = (x, z) => { let d = 1e9; for (const e of world.edgesNear(x, z, 120)) if (e.kind === 2) { const ex = e.bx - e.ax, ez = e.bz - e.az, l2 = ex * ex + ez * ez || 1; const t = Math.max(0, Math.min(1, ((x - e.ax) * ex + (z - e.az) * ez) / l2)); d = Math.min(d, Math.hypot(x - e.ax - ex * t, z - e.az - ez * t)); } return d; };

// 1. terrace tables near the eateries close to the route (clusters of 3 table sets)
const eat = [];
for (const e of osm.elements) {
  const t = e.tags; if (!t || !(t.amenity === 'restaurant' || t.amenity === 'bar' || t.amenity === 'cafe' || t.outdoor_seating === 'yes')) continue;
  let lat, lon; if (e.type === 'node') { lat = e.lat; lon = e.lon; } else if (e.geometry) { lat = e.geometry.reduce((a, p) => a + p.lat, 0) / e.geometry.length; lon = e.geometry.reduce((a, p) => a + p.lon, 0) / e.geometry.length; } else continue;
  eat.push([(lon - city.meta.origin.lon) * city.meta.metresPerDeg.lon, (city.meta.origin.lat - lat) * city.meta.metresPerDeg.lat, t.name || t.amenity]);
}
let tables = 0;
for (const [ex, ez, name] of eat) {
  if (distToRoute(ex, ez) > 80) continue;
  let placed = 0;
  for (let k = 0; k < 80 && placed < 3; k++) {
    const a = rnd() * Math.PI * 2, d = 3 + rnd() * 7, x = ex + Math.cos(a) * d, z = ez + Math.sin(a) * d;
    if (distToRoute(x, z) < 3.2 || !free(x, z, 1.1) || seaDist(x, z) < 6) continue;
    if (add('t', x, z, rnd() * 3.14, 2.6)) placed++;
  }
  if (placed) { tables += placed; console.log(`  tables ${placed} near ${name}`); }
}
// 2. beach umbrellas between the route and the sea (rows of 4, four rows)
let umb = 0;
for (let i = 0; i < route.length && umb < 16; i += 60) {
  const [rx, rz] = route[i], sd = seaDist(rx, rz);
  if (sd < 20 || sd > 220) continue;
  // seaward: the direction to the nearest sea edge point
  let best = null; for (const e of world.edgesNear(rx, rz, 130)) if (e.kind === 2) { const ex = e.bx - e.ax, ez = e.bz - e.az, l2 = ex * ex + ez * ez || 1; const t = Math.max(0, Math.min(1, ((rx - e.ax) * ex + (rz - e.az) * ez) / l2)), px = e.ax + ex * t, pz = e.az + ez * t, d = Math.hypot(rx - px, rz - pz); if (!best || d < best.d) best = { d, px, pz }; }
  if (!best) continue;
  const ux = (best.px - rx) / best.d, uz = (best.pz - rz) / best.d, vx = -uz, vz = ux;
  for (let r = 0; r < 4; r++) {
    const off = Math.min(sd - 10, 10 + r * 3.2 + rnd() * 3), x = rx + ux * off + vx * (r - 1.5) * 4.5, z = rz + uz * off + vz * (r - 1.5) * 4.5;
    if (terrain.height(x, z) > 3 || !free(x, z, 1.4) || seaDist(x, z) < 8) continue;
    if (add('u', x, z, rnd() * 6.28, 3.4)) umb++;
  }
  i += 120;
}
// 3. cones: a short line on the edge of the road every ~330 m; 4. bins: on the pavement every ~100 m
let cones = 0, bins = 0, nextCone = 150, nextBin = 60;
for (let i = 0; i < route.length; i++) {
  const s = i * 2, [rx, rz, ang] = route[i], nx = -Math.sin(ang), nz = Math.cos(ang);
  if (s >= nextCone && cones < 40) {
    const side = rnd() < 0.5 ? 1 : -1; let placed = 0;
    for (let k = 0; k < 6 && i + k * 1 < route.length; k++) { const [px, pz, a2] = route[Math.min(route.length - 1, i + k)]; const x = px - Math.sin(a2) * 2.1 * side, z = pz + Math.cos(a2) * 2.1 * side; if (free(x, z, 0.5) && add('c', x, z, 0, 1.8)) placed++; }
    if (placed >= 3) { cones += placed; nextCone = s + 300 + rnd() * 80; } else nextCone = s + 40;
  }
  if (s >= nextBin && bins < 28) {
    const side = rnd() < 0.5 ? 1 : -1, d = 3.6 + rnd() * 1.2, x = rx + nx * d * side, z = rz + nz * d * side;
    if (free(x, z, 0.9) && seaDist(x, z) > 5 && add('b', x, z, 0, 8)) { bins++; nextBin = s + 80 + rnd() * 50; } else nextBin = s + 10;
  }
}
console.log(`tables ${tables}, umbrellas ${umb}, cones ${cones}, bins ${bins}: ${out.length} things`);
if (process.argv.includes('--write')) {
  const all = existsSync('data/smashables.json') ? JSON.parse(await readFile('data/smashables.json', 'utf8')) : {};
  all[tourId] = out;
  await writeFile('data/smashables.json', '{\n' + Object.entries(all).map(([k, v]) => `"${k}": [\n` + v.map((r) => JSON.stringify(r)).join(',\n') + '\n]').join(',\n') + '\n}\n');
  console.log('written data/smashables.json');
}
