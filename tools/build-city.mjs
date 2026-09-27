// Converts data/raw/alicante.osm.json -> data/city.json (game format, local metres).
// Usage: node tools/build-city.mjs
// Axes: x = east, z = south (three.js convention, y up). Origin = bbox centre.
// Data © OpenStreetMap contributors, ODbL.
import { readFile, writeFile } from 'node:fs/promises';

const BBOX = { south: 38.3400, west: -0.4950, north: 38.3515, east: -0.4770 };
const LAT0 = (BBOX.south + BBOX.north) / 2;
const LON0 = (BBOX.west + BBOX.east) / 2;
const phi = LAT0 * Math.PI / 180;
const M_LAT = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const M_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
const r1 = (v) => Math.round(v * 10) / 10;
const proj = (lat, lon) => [(lon - LON0) * M_LON, -(lat - LAT0) * M_LAT];
const unproj = (x, z) => [LAT0 - z / M_LAT, LON0 + x / M_LON];

const [bx0, bz1] = proj(BBOX.south, BBOX.west);
const [bx1, bz0] = proj(BBOX.north, BBOX.east);
const RECT = { minX: bx0, maxX: bx1, minZ: bz0, maxZ: bz1 };

// ---------- geometry helpers ----------
const signedArea = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] - p[i][0]) * (p[j][1] + p[i][1]); return a / 2; };
const area = (p) => Math.abs(signedArea(p));
const centroid = (p) => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; };
function pip(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > pt[1]) !== (zj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function cleanRing(pts) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.4) out.push(p); }
  if (out.length > 1) { const a = out[0], b = out[out.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.4) out.pop(); }
  // drop nearly collinear points
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      if (cross < 0.05) { out.splice(i, 1); changed = true; break; }
    }
  }
  return out;
}
const geomToPts = (g) => g.map((n) => proj(n.lat, n.lon));
const flat = (pts) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);
function hash(n) { let h = Number(BigInt(n) % 2147483647n) | 0; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// Join way segments (with node ids) into closed rings (for multipolygon relations).
function joinRings(segments) {
  const segs = segments.map((s) => s.slice());
  const rings = [];
  while (segs.length) {
    let ring = segs.shift();
    let guard = 0;
    while (ring[0].id !== ring[ring.length - 1].id && guard++ < 1000) {
      const end = ring[ring.length - 1].id;
      const i = segs.findIndex((s) => s[0].id === end || s[s.length - 1].id === end);
      if (i < 0) break;
      let s = segs.splice(i, 1)[0];
      if (s[0].id !== end) s = s.reverse();
      ring = ring.concat(s.slice(1));
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}
const withIds = (m) => m.geometry.map((g, i) => ({ ...g, id: m.ref + ':' + i })); // fallback ids

// Sutherland–Hodgman clip against axis-aligned rect.
function clipRect(poly, R) {
  const edges = [
    (p) => p[0] >= R.minX, (p) => p[0] <= R.maxX, (p) => p[1] >= R.minZ, (p) => p[1] <= R.maxZ,
  ];
  const inter = [
    (a, b) => { const t = (R.minX - a[0]) / (b[0] - a[0]); return [R.minX, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (R.maxX - a[0]) / (b[0] - a[0]); return [R.maxX, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (R.minZ - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), R.minZ]; },
    (a, b) => { const t = (R.maxZ - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), R.maxZ]; },
  ];
  let out = poly;
  for (let k = 0; k < 4; k++) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      const ia = edges[k](a), ib = edges[k](b);
      if (ib) { if (!ia) out.push(inter[k](a, b)); out.push(b); } else if (ia) out.push(inter[k](a, b));
    }
  }
  return out;
}
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// ---------- load ----------
const raw = JSON.parse(await readFile('data/raw/alicante.osm.json', 'utf8'));
const E = raw.elements;
const nameOf = (t) => [t.name, t['name:es'], t['name:ca'], t['name:en'], t.official_name, t.alt_name].filter(Boolean).join(' | ');

// ---------- Benacantil (mount) ----------
// Foot outline drawn by hand in local metres, checked against OSM: stairs (highway=steps),
// hillside paths, Parc de l'Ereta and the castle walls lie inside; Plaça de Santa Maria (Basílica,
// MACA), Ajuntament and the Postiguet promenade stay outside on the flat.
const MOUNT_FOOT = [
  [235, -760], [232, -330], [245, -190], [290, -120], [380, -100], [470, -95], [540, -100],
  [650, -105], [760, -110], [900, -150], [1000, -300], [990, -600], [820, -780], [500, -800],
];
const peakNode = E.find((e) => e.type === 'node' && e.tags?.natural === 'peak');
const castleWay = E.find((e) => e.tags?.historic === 'castle' && /Santa B/i.test(nameOf(e.tags)));
const castleHull = convexHull(geomToPts(castleWay.geometry));
const inMount = (p) => pip(p, MOUNT_FOOT);

// ---------- buildings ----------
const PALETTE = [0xf3e6cf, 0xe9d3b0, 0xdcb78f, 0xf5efe6, 0xe8c3a8, 0xd9a47e, 0xefdcc0, 0xc98f6b, 0xf1d9d0, 0xe3cfa3];
function heightOf(t, id) {
  const num = (s) => { const v = parseFloat(String(s).replace(',', '.')); return Number.isFinite(v) ? v : null; };
  if (t.height && num(t.height)) return { h: num(t.height), src: 'height' };
  if (t['building:levels'] && num(t['building:levels']) != null) return { h: num(t['building:levels']) * 3.2 + 1, src: 'levels' };
  const r = hash(id);
  const byType = { church: 18, cathedral: 24, retail: 7, kiosk: 3, garage: 4, shed: 3, hut: 3, service: 4, commercial: 16, office: 20, hotel: 22, public: 14, civic: 14 };
  if (byType[t.building]) return { h: byType[t.building] * (0.9 + 0.2 * r), src: 'type' };
  return { h: 10 + r * 9, src: 'default' };
}
const buildings = [];
const stats = { heightSrc: {}, skipped: { mount: 0, fort: 0, roof: 0, underground: 0, tiny: 0 }, excludedNames: [] };
function addBuilding(outer, holes, t, id) {
  if (t.building === 'roof' || t.building === 'canopy') { stats.skipped.roof++; return; }
  if (t.location === 'underground' || (t.layer && parseInt(t.layer) < 0)) { stats.skipped.underground++; return; }
  if (t.historic === 'fort') { stats.skipped.fort++; stats.excludedNames.push(t.name); return; }
  outer = cleanRing(outer);
  if (outer.length < 3 || area(outer) < 6) { stats.skipped.tiny++; return; }
  if (inMount(centroid(outer))) { stats.skipped.mount++; if (t.name) stats.excludedNames.push(t.name); return; }
  if (signedArea(outer) < 0) outer.reverse(); // consistent orientation
  holes = holes.map(cleanRing).filter((h) => h.length >= 3 && area(h) > 4).map((h) => (signedArea(h) > 0 ? h.reverse() : h));
  const { h, src } = heightOf(t, id);
  stats.heightSrc[src] = (stats.heightSrc[src] || 0) + 1;
  const b = { p: flat(outer), h: r1(Math.min(Math.max(h, 3), 120)), c: Math.floor(hash(id * 7 + 3) * PALETTE.length) };
  if (holes.length) b.holes = holes.map(flat);
  if (t.name) b.n = t.name;
  buildings.push(b);
}
for (const e of E) {
  const t = e.tags || {};
  if (!t.building) continue;
  if (e.type === 'way') addBuilding(geomToPts(e.geometry), [], t, e.id);
  else if (e.type === 'relation') {
    const seg = (role) => e.members.filter((m) => m.type === 'way' && m.role === role && m.geometry)
      .map((m) => m.geometry.map((g, i) => ({ ...g, id: (i === 0 || i === m.geometry.length - 1) ? `${g.lat.toFixed(7)},${g.lon.toFixed(7)}` : `${m.ref}:${i}` })));
    const outers = joinRings(seg('outer')), inners = joinRings(seg('inner'));
    for (const o of outers) {
      const op = geomToPts(o);
      const hs = inners.map(geomToPts).filter((h) => pip(centroid(h), op));
      addBuilding(op, hs, t, e.id);
    }
  }
}

// ---------- roads ----------
const ROAD_W = { primary: 12, primary_link: 7, secondary: 10, secondary_link: 7, tertiary: 8, tertiary_link: 6, residential: 6.5, unclassified: 6, living_street: 5, service: 4, pedestrian: 5, busway: 7 };
const roads = [], plazas = [];
const roadCount = {};
for (const e of E) {
  const t = e.tags || {};
  if (e.type !== 'way' || !t.highway || !ROAD_W[t.highway]) continue;
  const pts = geomToPts(e.geometry);
  if (t.area === 'yes') {
    const ring = cleanRing(pts);
    if (ring.length >= 3 && !inMount(centroid(ring))) plazas.push(flat(ring));
    continue;
  }
  // split polyline where it enters the mount
  let run = [];
  const flush = () => { if (run.length >= 2) { roads.push({ p: flat(run), w: ROAD_W[t.highway], k: t.highway, ...(t.name ? { n: t.name } : {}) }); roadCount[t.highway] = (roadCount[t.highway] || 0) + 1; } run = []; };
  for (const p of pts) { if (inMount(p)) flush(); else run.push(p); }
  flush();
}

// ---------- parks ----------
const parks = [];
for (const e of E) {
  const t = e.tags || {};
  if (e.type !== 'way' || !e.geometry) continue;
  const isPark = /^(park|garden)$/.test(t.leisure || '') || /^(grass|flowerbed|recreation_ground)$/.test(t.landuse || '');
  if (!isPark) continue;
  const ring = cleanRing(geomToPts(e.geometry));
  if (ring.length < 3 || inMount(centroid(ring))) continue;
  parks.push(flat(ring));
}

// ---------- palms (trees) ----------
const bIndex = buildings.map((b) => { const xs = b.p.filter((_, i) => i % 2 === 0), zs = b.p.filter((_, i) => i % 2 === 1); return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), ring: xs.map((x, i) => [x, zs[i]]) }; });
const inAnyBuilding = (p) => bIndex.some((b) => p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minZ && p[1] <= b.maxZ && pip(p, b.ring));
const treePts = [];
for (const e of E) {
  const t = e.tags || {};
  if (e.type === 'node' && t.natural === 'tree') treePts.push(proj(e.lat, e.lon));
  if (e.type === 'way' && t.natural === 'tree_row') {
    const pts = geomToPts(e.geometry);
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s < L; s += 7) treePts.push([a[0] + (b[0] - a[0]) * s / L, a[1] + (b[1] - a[1]) * s / L]);
    }
  }
}
const inRect = (p, m = 0) => p[0] >= RECT.minX - m && p[0] <= RECT.maxX + m && p[1] >= RECT.minZ - m && p[1] <= RECT.maxZ + m;
const palms = treePts.filter((p) => inRect(p) && !inMount(p) && !inAnyBuilding(p));

// ---------- sea from natural=coastline ----------
let sea = null, seaSource = 'manual', seaNote = '';
const MANUAL_SEA = [ // fallback: rough port basin + open sea, local metres
  [-2800, 2600], [-2800, 700], [-600, 700], [-200, 380], [150, 330], [520, 260], [700, 180], [1000, 0], [2800, -300], [2800, 2600],
];
try {
  const coast = E.filter((e) => e.type === 'way' && e.tags?.natural === 'coastline');
  // chain by node ids
  let chain = coast.shift();
  let nodes = chain.nodes.slice(), geom = chain.geometry.slice();
  let guard = 0;
  while (coast.length && guard++ < 100) {
    const iNext = coast.findIndex((w) => w.nodes[0] === nodes[nodes.length - 1]);
    const iPrev = coast.findIndex((w) => w.nodes[w.nodes.length - 1] === nodes[0]);
    if (iNext >= 0) { const w = coast.splice(iNext, 1)[0]; nodes = nodes.concat(w.nodes.slice(1)); geom = geom.concat(w.geometry.slice(1)); }
    else if (iPrev >= 0) { const w = coast.splice(iPrev, 1)[0]; nodes = w.nodes.slice(0, -1).concat(nodes); geom = w.geometry.slice(0, -1).concat(geom); }
    else break;
  }
  if (coast.length) throw new Error(`coastline did not chain into one line (${coast.length} ways left)`);
  const line = geomToPts(geom);
  const first = line[0], last = line[line.length - 1];
  const F = 6000;
  // OSM: land on the left, water on the right. Line runs SW -> NE, so water is to the south-east;
  // close the polygon around the south-east far away.
  const poly = [...line, [F, last[1]], [F, F], [-F, F], [-F, first[1]]];
  const clipped = clipRect(poly, { minX: -F, maxX: F, minZ: -F, maxZ: F });
  // validation
  const lm = (lat, lon) => proj(lat, lon);
  const mustLand = [lm(38.3478, -0.4899), lm(38.3440, -0.4835), lm(38.3465, -0.4860), lm(38.3460, -0.4906)];
  const mustSea = [lm(38.3380, -0.4800), lm(38.3300, -0.4700)];
  const okLand = mustLand.every((p) => !pip(p, clipped));
  const okSea = mustSea.every((p) => pip(p, clipped));
  const seaInBbox = area(clipRect(clipped, RECT));
  const bboxArea = (RECT.maxX - RECT.minX) * (RECT.maxZ - RECT.minZ);
  const frac = seaInBbox / bboxArea;
  seaNote = `coastline ways chained: ${nodes.length} nodes; land checks ${okLand}, sea checks ${okSea}; sea share of bbox ${(frac * 100).toFixed(1)}%`;
  if (okLand && okSea && frac > 0.02 && frac < 0.5) { sea = clipped; seaSource = 'coastline'; }
  else throw new Error('validation failed: ' + seaNote);
} catch (err) {
  seaNote += ' | fallback: ' + err.message;
  sea = MANUAL_SEA;
}

// ---------- landmarks by OSM name ----------
const nm = (re) => (e) => re.test(nameOf(e.tags || {}));
function center(e) {
  if (e.type === 'node') return proj(e.lat, e.lon);
  if (e.geometry) return centroid(geomToPts(e.geometry));
  const b = e.bounds; return proj((b.minlat + b.maxlat) / 2, (b.minlon + b.maxlon) / 2);
}
const LANDMARKS = {
  mercado: { label: 'Mercado Central', find: (e) => nm(/Mercado Central|Mercat Central/i)(e) && (e.tags.amenity === 'marketplace' || e.tags.building) },
  explanada: { label: 'Explanada de España', find: (e) => nm(/Explanada de España|Esplanada d'Espanya/i)(e) && e.tags.area === 'yes' },
  rambla: { label: 'Rambla de Méndez Núñez', find: (e) => nm(/Rambla de Méndez Núñez/i)(e) && e.tags.highway, many: true },
  luceros: { label: 'Plaza de los Luceros', find: (e) => nm(/Plaza de los Luceros|Plaça dels Estels/i)(e) && e.tags.leisure },
};
const landmarks = {};
for (const [key, L] of Object.entries(LANDMARKS)) {
  const found = E.filter((e) => e.tags && L.find(e));
  if (!found.length) { console.warn('Landmark not found:', key); continue; }
  let pts;
  if (L.many) pts = found.flatMap((e) => geomToPts(e.geometry)); else pts = [center(found[0])];
  const c = L.many ? centroid(pts) : pts[0];
  const [lat, lon] = unproj(c[0], c[1]);
  landmarks[key] = { label: L.label, x: r1(c[0]), z: r1(c[1]), lat: +lat.toFixed(6), lon: +lon.toFixed(6), osm: found.map((e) => `${e.type}/${e.id}`).slice(0, 12) };
  if (key === 'rambla') {
    const south = pts.reduce((a, b) => (b[1] > a[1] ? b : a)), north = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
    landmarks[key].south = [r1(south[0]), r1(south[1])]; landmarks[key].north = [r1(north[0]), r1(north[1])];
  }
}

// start: southern end of the Rambla, a little north, facing north along it
const rs = landmarks.rambla.south, rn = landmarks.rambla.north;
const dirLen = Math.hypot(rn[0] - rs[0], rn[1] - rs[1]);
const dir = [(rn[0] - rs[0]) / dirLen, (rn[1] - rs[1]) / dirLen];
const start = { x: r1(rs[0] + dir[0] * 25), z: r1(rs[1] + dir[1] * 25), heading: +Math.atan2(-dir[0], -dir[1]).toFixed(4) };

const out = {
  meta: {
    attribution: '© OpenStreetMap contributors', license: 'ODbL 1.0', source: 'Overpass API',
    osmTimestamp: raw.osm3s?.timestamp_osm_base, bbox: BBOX, origin: { lat: LAT0, lon: LON0 },
    metresPerDeg: { lat: M_LAT, lon: M_LON }, rect: Object.fromEntries(Object.entries(RECT).map(([k, v]) => [k, r1(v)])),
    seaSource, seaNote,
  },
  palette: PALETTE,
  start,
  landmarks,
  buildings,
  roads,
  plazas,
  parks,
  palms: flat(palms),
  sea: flat(sea),
  mount: { foot: flat(MOUNT_FOOT), peak: flat([proj(peakNode.lat, peakNode.lon)]), peakName: peakNode.tags.name, height: 166, castle: flat(castleHull), castleName: castleWay.tags['name:es'] || castleWay.tags.name },
};
const json = JSON.stringify(out);
await writeFile('data/city.json', json);

console.log(`buildings: ${buildings.length}  (height sources ${JSON.stringify(stats.heightSrc)})`);
console.log(`skipped: ${JSON.stringify(stats.skipped)}  excluded names: ${stats.excludedNames.filter(Boolean).join('; ')}`);
console.log(`roads: ${roads.length} polylines ${JSON.stringify(roadCount)}; plazas: ${plazas.length}; parks: ${parks.length}; palms: ${palms.length}`);
console.log(`sea: ${seaSource} (${sea.length} vertices) — ${seaNote}`);
for (const [k, v] of Object.entries(landmarks)) console.log(`landmark ${k}: ${v.lat}, ${v.lon}  local (${v.x}, ${v.z})  ${v.osm.slice(0, 3).join(' ')}`);
console.log(`start: ${JSON.stringify(start)}`);
console.log(`city.json: ${(json.length / 1024).toFixed(0)} KB`);
