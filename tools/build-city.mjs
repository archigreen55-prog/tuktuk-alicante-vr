// Converts data/raw/alicante.osm.json -> data/city.json (game format, local metres).
// Usage: node tools/build-city.mjs
// Axes: x = east, z = south (three.js convention, y up). Origin = bbox centre.
// Data © OpenStreetMap contributors, ODbL.
import { readFile, writeFile } from 'node:fs/promises';
import { RoadGraph } from '../src/game/route.js';

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
// Facade vertical layout (metres), shared with src/city/facades.js: ground floor (Spanish "bajo
// comercial"), upper floors, parapet/cornice band on top. h = GROUND + (levels - 1) * FLOOR + PARAPET.
const GROUND_H = 4.0, FLOOR_H = 3.0, PARAPET_H = 0.9;
const num = (s) => { const v = parseFloat(String(s).replace(',', '.')); return Number.isFinite(v) ? v : null; };
function heightOf(t, id) {
  const lvTag = t['building:levels'] != null ? num(t['building:levels']) : null;
  const lv = lvTag != null && lvTag >= 1 ? Math.round(lvTag) : null;
  if (t.height && num(t.height)) return { h: num(t.height), lv, src: 'height' };
  if (lv != null) return { h: GROUND_H + (lv - 1) * FLOOR_H + PARAPET_H, lv, src: 'levels' };
  const r = hash(id);
  const byType = { church: 18, cathedral: 24, retail: 7, kiosk: 3, garage: 4, shed: 3, hut: 3, service: 4, commercial: 16, office: 20, hotel: 22, public: 14, civic: 14 };
  if (byType[t.building]) return { h: byType[t.building] * (0.9 + 0.2 * r), lv: null, src: 'type' };
  return { h: 10 + r * 9, lv: null, src: 'default' };
}
// Facade styles (index = code in city.json): see docs/plan-stage-5.md 2.3
const STYLES = ['ensanche', 'classic', 'old', 'tower', 'office', 'civic'];
const STYLE_ALIASES = { residential: 'ensanche', apartments: 'ensanche', modern: 'ensanche', historic: 'classic', hotel: 'tower', commercial: 'office', retail: 'office', church: 'civic', public: 'civic' };
const CIVIC = /^(church|cathedral|chapel|public|civic|government|school|university|college|hospital|train_station|townhall|museum|library|fire_station|police)$/;
const OFFICE = /^(commercial|retail|office|supermarket|department_store|kiosk|parking|industrial|warehouse)$/;
// Rambla line (south -> north): east of it lies the old town under the Benacantil
const RAMBLA_S = [279.1, 240], RAMBLA_N = [98.1, -270];
const eastOfRambla = ([x, z]) => ((RAMBLA_N[0] - RAMBLA_S[0]) * (z - RAMBLA_S[1]) - (RAMBLA_N[1] - RAMBLA_S[1]) * (x - RAMBLA_S[0])) < 0;
const near = (p, q, d) => Math.hypot(p[0] - q[0], p[1] - q[1]) < d;
function styleOf(t, lv, h, c) {
  if (CIVIC.test(t.building) || t.amenity === 'place_of_worship' || /^(townhall|courthouse|library|police|fire_station|university|school|museum|marketplace|post_office)$/.test(t.amenity || '') || t.tourism === 'museum' || t.office === 'government') return 'civic';
  if (OFFICE.test(t.building) || t.shop === 'department_store' || t.shop === 'supermarket' || t.amenity === 'bank') return 'office';
  if ((lv != null && lv >= 12) || h > 38 || t.tourism === 'hotel' || t.building === 'hotel') return 'tower';
  const levels = lv != null ? lv : Math.max(1, Math.round((h - 1.9) / 3));
  if (levels <= 3 && eastOfRambla(c) && c[1] < 300) return 'old';
  if (levels <= 6 && (near(c, [233.7, 291.2], 260) || near(c, [190, 0], 220))) return 'classic'; // Explanada / Rambla centre
  if (levels <= 2 && hash(Math.round(c[0] * 7 + c[1] * 13) + 11) < 0.5) return 'old';
  return 'ensanche';
}
// manual overrides: data/facades.json { "way/123": { "style": "civic", "h": 10, "photos": [...] } }
// (style and height are merged here; photos are read by the game itself, see src/city/photoFacades.js)
let facadeOverrides = {};
try { facadeOverrides = JSON.parse(await readFile('data/facades.json', 'utf8')); } catch { /* optional */ }
const overridesUsed = [];
const buildings = [];
const stats = { heightSrc: {}, styles: {}, skipped: { mount: 0, fort: 0, roof: 0, underground: 0, tiny: 0 }, excludedNames: [] };
function addBuilding(outer, holes, t, id, osmId) {
  if (t.building === 'roof' || t.building === 'canopy') { stats.skipped.roof++; return; }
  if (t.location === 'underground' || (t.layer && parseInt(t.layer) < 0)) { stats.skipped.underground++; return; }
  if (t.historic === 'fort') { stats.skipped.fort++; stats.excludedNames.push(t.name); return; }
  outer = cleanRing(outer);
  if (outer.length < 3 || area(outer) < 6) { stats.skipped.tiny++; return; }
  const c = centroid(outer);
  if (inMount(c)) { stats.skipped.mount++; if (t.name) stats.excludedNames.push(t.name); return; }
  if (signedArea(outer) < 0) outer.reverse(); // consistent orientation
  holes = holes.map(cleanRing).filter((h) => h.length >= 3 && area(h) > 4).map((h) => (signedArea(h) > 0 ? h.reverse() : h));
  const { h: h0, lv, src } = heightOf(t, id);
  let h = r1(Math.min(Math.max(h0, 3), 120));
  stats.heightSrc[src] = (stats.heightSrc[src] || 0) + 1;
  let style = styleOf(t, lv, h, c);
  const ov = facadeOverrides[osmId];
  if (ov && ov.h > 0) h = ov.h; // measured by hand (photo facades: the roof height)
  if (ov && ov.style) { const s = STYLE_ALIASES[ov.style] || ov.style; if (STYLES.includes(s)) { style = s; overridesUsed.push(osmId); } else console.warn(`facades.json ${osmId}: unknown style "${ov.style}"`); }
  stats.styles[style] = (stats.styles[style] || 0) + 1;
  const b = { id: osmId, p: flat(outer), h, c: Math.floor(hash(id * 7 + 3) * PALETTE.length), s: STYLES.indexOf(style) };
  if (lv != null) b.lv = lv;
  if (holes.length) b.holes = holes.map(flat);
  if (t.name) b.n = t.name;
  buildings.push(b);
}
for (const e of E) {
  const t = e.tags || {};
  if (!t.building) continue;
  if (e.type === 'way') addBuilding(geomToPts(e.geometry), [], t, e.id, 'way/' + e.id);
  else if (e.type === 'relation') {
    const seg = (role) => e.members.filter((m) => m.type === 'way' && m.role === role && m.geometry)
      .map((m) => m.geometry.map((g, i) => ({ ...g, id: (i === 0 || i === m.geometry.length - 1) ? `${g.lat.toFixed(7)},${g.lon.toFixed(7)}` : `${m.ref}:${i}` })));
    const outers = joinRings(seg('outer')), inners = joinRings(seg('inner'));
    for (const o of outers) {
      const op = geomToPts(o);
      const hs = inners.map(geomToPts).filter((h) => pip(centroid(h), op));
      addBuilding(op, hs, t, e.id, 'relation/' + e.id);
    }
  }
}

// ---------- roads ----------
const ROAD_W = { primary: 12, primary_link: 7, secondary: 10, secondary_link: 7, tertiary: 8, tertiary_link: 6, residential: 6.5, unclassified: 6, living_street: 5, service: 4, pedestrian: 5, busway: 7 };
const roads = [], plazas = [];
const roadCount = {};
// junction nodes: shared by >= 3 road ways, or by 2 where one passes through (not an end-to-end chain)
const nodeUse = new Map();
for (const e of E) {
  const t = e.tags || {};
  if (e.type !== 'way' || !t.highway || !ROAD_W[t.highway] || t.area === 'yes' || !e.nodes) continue;
  e.nodes.forEach((n, i) => {
    const u = nodeUse.get(n) || { count: 0, interior: false, widths: [] };
    u.count++; if (i > 0 && i < e.nodes.length - 1) u.interior = true;
    u.widths.push(ROAD_W[t.highway]);
    nodeUse.set(n, u);
  });
}
const isJunction = (n) => { const u = nodeUse.get(n); return !!u && (u.count >= 3 || (u.count >= 2 && u.interior)); };
// widest OTHER road at the node (for the marking fade / zebra distance); own width if alone
const otherWidth = (n, own) => { const w = nodeUse.get(n).widths.slice(); const i = w.indexOf(own); if (i >= 0 && w.length > 1) w.splice(i, 1); return Math.max(...w); };
let junctionCount = 0;
const EXPLANADA_WAY = 20490190;
for (const e of E) {
  const t = e.tags || {};
  if (e.type !== 'way' || !t.highway || !ROAD_W[t.highway]) continue;
  const pts = geomToPts(e.geometry);
  if (t.area === 'yes') {
    const ring = cleanRing(pts);
    if (ring.length < 3 || inMount(centroid(ring))) continue;
    const pl = { p: flat(ring), k: e.id === EXPLANADA_WAY ? 'explanada' : t.surface === 'wood' ? 'wood' : 'paving' };
    if (e.id === EXPLANADA_WAY) {
      // principal axis of the polygon = direction along the promenade (for the wave mosaic)
      const c = centroid(ring);
      let sxx = 0, szz = 0, sxz = 0;
      for (const [x, z] of ring) { sxx += (x - c[0]) ** 2; szz += (z - c[1]) ** 2; sxz += (x - c[0]) * (z - c[1]); }
      pl.axis = +(0.5 * Math.atan2(2 * sxz, sxx - szz)).toFixed(4);
      pl.centre = [r1(c[0]), r1(c[1])];
    }
    if (t.name) pl.n = t.name;
    plazas.push(pl);
    continue;
  }
  const lanes = t.lanes ? parseInt(t.lanes) : null;
  const oneway = t.oneway === 'yes' || t.oneway === '-1' || t.oneway === '1';
  // split polyline where it enters the mount
  let run = [], runJ = [];
  const flush = () => {
    if (run.length >= 2) {
      const r = { p: flat(run), w: ROAD_W[t.highway], k: t.highway };
      if (t.name) r.n = t.name;
      if (lanes) r.l = lanes;
      if (oneway) r.o = 1;
      if (runJ.length) { r.j = runJ; junctionCount += runJ.length; }
      roads.push(r);
      roadCount[t.highway] = (roadCount[t.highway] || 0) + 1;
    }
    run = []; runJ = [];
  };
  pts.forEach((p, i) => {
    if (inMount(p)) flush();
    else { if (e.nodes && isJunction(e.nodes[i])) runJ.push([run.length, otherWidth(e.nodes[i], ROAD_W[t.highway])]); run.push(p); }
  });
  flush();
}

// ---------- facade edge codes ----------
// One digit per outer edge of every building: bit0 = wall shared with a neighbour (blank
// "medianera"), bits 1-2 = street class of the nearest road (0 none/back, 1 residential, 2 main).
const MAIN = /^(primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|pedestrian|living_street|busway)$/;
{
  const CELL = 20;
  const gridKey = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
  const edgeGrid = new Map();
  const allEdges = [];
  buildings.forEach((b, bi) => {
    const n = b.p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const e = { b: bi, ax: b.p[i * 2], az: b.p[i * 2 + 1], bx: b.p[j * 2], bz: b.p[j * 2 + 1] };
      const id = allEdges.push(e) - 1;
      const x0 = Math.floor(Math.min(e.ax, e.bx) / CELL), x1 = Math.floor(Math.max(e.ax, e.bx) / CELL);
      const z0 = Math.floor(Math.min(e.az, e.bz) / CELL), z1 = Math.floor(Math.max(e.az, e.bz) / CELL);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const k = gx + ',' + gz; (edgeGrid.get(k) || edgeGrid.set(k, []).get(k)).push(id); }
    }
  });
  const segDist = (px, pz, ax, az, bx, bz) => {
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / l2));
    return Math.hypot(px - ax - ex * t, pz - az - ez * t);
  };
  // shared: the other edge runs along this one within 0.5 m over at least 2 m (or half of it)
  function isShared(e) {
    const len = Math.hypot(e.bx - e.ax, e.bz - e.az);
    if (len < 0.5) return false;
    const ux = (e.bx - e.ax) / len, uz = (e.bz - e.az) / len;
    const seen = new Set();
    const x0 = Math.floor(Math.min(e.ax, e.bx) / CELL), x1 = Math.floor(Math.max(e.ax, e.bx) / CELL);
    const z0 = Math.floor(Math.min(e.az, e.bz) / CELL), z1 = Math.floor(Math.max(e.az, e.bz) / CELL);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      for (const id of edgeGrid.get(gx + ',' + gz) || []) {
        const o = allEdges[id];
        if (o.b === e.b || seen.has(id)) continue;
        seen.add(id);
        // project the other edge on this one
        const tc = ((o.ax - e.ax) * ux + (o.az - e.az) * uz), td = ((o.bx - e.ax) * ux + (o.bz - e.az) * uz);
        const t0 = Math.max(0, Math.min(tc, td)), t1 = Math.min(len, Math.max(tc, td));
        const overlap = t1 - t0;
        if (overlap < Math.min(2, len * 0.5)) continue;
        // perpendicular distance of the other edge at both ends of the overlap
        const dc = (o.ax - e.ax) * -uz + (o.az - e.az) * ux, dd = (o.bx - e.ax) * -uz + (o.bz - e.az) * ux;
        const at = (t) => (tc === td ? dc : dc + (dd - dc) * (t - tc) / (td - tc));
        if (Math.abs(at(t0)) < 0.5 && Math.abs(at(t1)) < 0.5) return true;
      }
    }
    return false;
  }
  // nearest road to an edge midpoint (grid over road segments)
  const roadGrid = new Map();
  const RCELL = 40;
  roads.forEach((r, ri) => {
    for (let i = 0; i + 1 < r.p.length / 2; i++) {
      const ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[i * 2 + 2], bz = r.p[i * 2 + 3];
      const x0 = Math.floor((Math.min(ax, bx) - 20) / RCELL), x1 = Math.floor((Math.max(ax, bx) + 20) / RCELL);
      const z0 = Math.floor((Math.min(az, bz) - 20) / RCELL), z1 = Math.floor((Math.max(az, bz) + 20) / RCELL);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const k = gx + ',' + gz; (roadGrid.get(k) || roadGrid.set(k, []).get(k)).push([ri, i]); }
    }
  });
  const explanada = plazas.find((p) => p.k === 'explanada');
  const explRing = explanada ? [] : null;
  if (explanada) for (let i = 0; i < explanada.p.length; i += 2) explRing.push([explanada.p[i], explanada.p[i + 1]]);
  function streetClass(mx, mz, nx, nz) {
    // look a little in front of the wall, so a road behind the building does not count
    const px = mx + nx * 3, pz = mz + nz * 3;
    let best = Infinity, cls = 0;
    for (const [ri, i] of roadGrid.get(Math.floor(px / RCELL) + ',' + Math.floor(pz / RCELL)) || []) {
      const r = roads[ri];
      const d = segDist(px, pz, r.p[i * 2], r.p[i * 2 + 1], r.p[i * 2 + 2], r.p[i * 2 + 3]) - r.w / 2;
      if (d < best) { best = d; cls = MAIN.test(r.k) ? 2 : 1; }
    }
    if (explRing && (pip([px, pz], explRing) || segDist(px, pz, ...explRing[0], ...explRing[1]) < 8)) return 2;
    return best < 8 ? cls : 0;
  }
  let shared = 0, byClass = [0, 0, 0];
  for (const b of buildings) {
    const n = b.p.length / 2;
    let code = '';
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = b.p[i * 2], az = b.p[i * 2 + 1], bx = b.p[j * 2], bz = b.p[j * 2 + 1];
      const e = { b: buildings.indexOf(b), ax, az, bx, bz };
      const len = Math.hypot(bx - ax, bz - az) || 1;
      // outward normal of a counter-clockwise ring in (x, z) with z pointing south: (dz, -dx)
      const nx = (bz - az) / len, nz = -(bx - ax) / len;
      const sh = isShared(e) ? 1 : 0;
      const cls = sh ? 0 : streetClass((ax + bx) / 2, (az + bz) / 2, nx, nz);
      shared += sh; byClass[cls]++;
      code += String(sh | (cls << 1));
    }
    b.e = code;
  }
  stats.edges = { shared, byClass };
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

// ---------- tour (stage 6): places from data/tour.json + drivable street graph ----------
// A place is found in OSM by name (name, name:es/ca/en, official/alt name, wikipedia, wikimedia
// commons: the Meliá hotel and Casa de les Bruixes have no usable `name`) or by exact id. Its road
// point is the nearest point of a drivable street (optionally the one named in `road`, near `at`),
// never on pedestrian streets and at least EDGE_MARGIN inside the play area.
const TOUR_CLASS = { primary: 0, primary_link: 1, secondary: 0, secondary_link: 1, tertiary: 2, tertiary_link: 2, residential: 3, unclassified: 3, living_street: 4, service: 1 };
const EDGE_MARGIN = 30;
const normName = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const searchNames = (t) => [t.name, t['name:es'], t['name:ca'], t['name:en'], t.official_name, t.alt_name,
  t.wikipedia && t.wikipedia.replace(/^\w+:/, ''), t.wikimedia_commons && t.wikimedia_commons.replace(/^Category:/, '')].filter(Boolean).map(normName);
const drivable = (t) => TOUR_CLASS[t.highway] !== undefined && t.area !== 'yes' && !/^(private|no)$/.test(t.access || '') && t.motor_vehicle !== 'no';
const inPlay = (p, m = EDGE_MARGIN) => p[0] >= RECT.minX + m && p[0] <= RECT.maxX - m && p[1] >= RECT.minZ + m && p[1] <= RECT.maxZ - m;
let tourSpec = null;
try { tourSpec = JSON.parse(await readFile('data/tour.json', 'utf8')); } catch (err) { console.warn('data/tour.json:', err.message); }

// drivable street graph (OSM nodes, cut like the rendered roads: no mount, inside the play area)
const graphIdx = new Map(), graphN = [], graphE = [];
const driveRoads = [];
for (const e of E) {
  const t = e.tags || {};
  if (e.type !== 'way' || !drivable(t) || !e.nodes || !e.geometry) continue;
  const pts = geomToPts(e.geometry);
  const ow = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.junction === 'roundabout' ? 1 : t.oneway === '-1' ? -1 : 0;
  driveRoads.push({ osm: 'way/' + e.id, names: searchNames(t), k: t.highway, w: ROAD_W[t.highway] || 6, ow, pts });
  const ok = pts.map((p) => !inMount(p) && inPlay(p, 5));
  const idx = (i) => {
    const id = e.nodes[i];
    if (!graphIdx.has(id)) { graphIdx.set(id, graphN.length / 2); graphN.push(r1(pts[i][0]), r1(pts[i][1])); }
    return graphIdx.get(id);
  };
  for (let i = 1; i < pts.length; i++) {
    if (!ok[i - 1] || !ok[i]) continue;
    let a = idx(i - 1), b = idx(i);
    if (ow < 0) [a, b] = [b, a];
    graphE.push(a, b, (ow ? 1 : 0) | (TOUR_CLASS[t.highway] << 1));
  }
}
function resolveOsm(q) {
  const m = /^(way|node|relation)\/(\d+)$/.exec(String(q).trim());
  if (m) { const e = E.find((x) => x.type === m[1] && x.id === +m[2]); return e ? { els: [e], street: false } : null; }
  const nq = normName(q);
  let best = null;
  for (const e of E) {
    const t = e.tags;
    if (!t || t.public_transport || t.highway === 'bus_stop' || t.route || (e.type === 'relation' && t.type !== 'multipolygon')) continue;
    let s = 0;
    for (const n of searchNames(t)) s = Math.max(s, n === nq ? 3 : n.includes(nq) ? 1 : 0);
    if (!s) continue;
    const kind = t.building ? 3 : (e.type !== 'node' && !t.highway) ? 2 : t.highway ? 1 : 0;
    const score = s * 10 + kind;
    if (!best || score > best.score) best = { e, score, kind, exact: s === 3 };
  }
  if (!best) return null;
  if (best.kind === 1) { // a street: every highway way with this name (exact matches if there are any)
    const match = (e) => e.type === 'way' && e.tags?.highway && e.geometry && searchNames(e.tags).some((n) => (best.exact ? n === nq : n.includes(nq)));
    return { els: E.filter(match), street: true };
  }
  return { els: [best.e], street: false };
}
// outline(s) of an element in local metres: rings for areas / buildings, lines for streets, a point for nodes
function shapesOf(e) {
  if (e.type === 'node') return [[proj(e.lat, e.lon)]];
  if (e.type === 'way') return [geomToPts(e.geometry)];
  return e.members.filter((mb) => mb.role === 'outer' && mb.geometry).map((mb) => geomToPts(mb.geometry));
}
// Candidate road points near p: the nearest point of every drivable way (optionally only ways named
// roadName), nearest first. The first one that is connected both ways to the city core wins, so a stop
// never sits on a carriageway that only leads out of the play area (one-way streets at the edge).
const tourGraph = new RoadGraph({ n: graphN, e: graphE });
const HUB = [landmarks.rambla.x, landmarks.rambla.z];
function nearestRoadPoint(p, roadName) {
  let cands = driveRoads;
  if (roadName) {
    const nr = normName(roadName);
    const named = driveRoads.filter((r) => r.names.some((n) => n.includes(nr)));
    if (named.length) cands = named; else console.warn(`tour: road "${roadName}" not found among drivable streets, using the nearest one`);
  }
  const found = [];
  for (const r of cands) {
    let best = null;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      if (inMount(a) || inMount(b) || !inPlay(a) || !inPlay(b)) continue;
      const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez;
      if (l2 < 0.01) continue;
      let t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2;
      t = Math.max(0, Math.min(1, t));
      const q = [a[0] + ex * t, a[1] + ez * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (!best || d < best.d) { const L = Math.sqrt(l2), sg = r.ow < 0 ? -1 : 1; best = { d, q, dir: [sg * ex / L, sg * ez / L], r, i, t }; }
    }
    if (best) found.push(best);
  }
  found.sort((a, b) => a.d - b.d);
  for (const c of found) {
    if (c.d > found[0].d + 80) break;
    if (tourGraph.route(c.q, HUB) && tourGraph.route(HUB, c.q)) return c;
  }
  if (found.length) console.warn(`tour: no connected street near ${p.map(Math.round)}, using a dead end`);
  return found[0] || null;
}
// points `dists` metres back along the street (against the driving direction) from a road point:
// where the tuk-tuk starts before the pickup, on the road even where it bends
function backAlong(rp, dists) {
  const pts = rp.r.ow < 0 ? rp.r.pts.slice().reverse() : rp.r.pts;
  let i = rp.r.ow < 0 ? pts.length - rp.i : rp.i; // segment (i-1, i) holds the point, in driving order
  let cur = rp.q, acc = 0;
  const out = [];
  for (const want of dists) {
    while (i >= 1) {
      const a = pts[i - 1], L = Math.hypot(cur[0] - a[0], cur[1] - a[1]);
      if (acc + L >= want) {
        const k = (want - acc) / (L || 1), p = [cur[0] + (a[0] - cur[0]) * k, cur[1] + (a[1] - cur[1]) * k];
        const b = pts[i], dx = b[0] - a[0], dz = b[1] - a[1];
        if (inPlay(p) && !inMount(p)) out.push([r1(p[0]), r1(p[1]), +Math.atan2(-dx, -dz).toFixed(3)]);
        break;
      }
      acc += L; cur = a; i--;
    }
  }
  return out;
}
const tourPlaces = {};
const tourIssues = [];
for (const [id, spec] of Object.entries(tourSpec?.places || {})) {
  const found = spec.osm ? resolveOsm(spec.osm) : null;
  if (spec.osm && !found) tourIssues.push(`${id}: "${spec.osm}" not found in OSM`);
  let look = null, trig = [], osmIds = [], osmName = '';
  if (found) {
    const shapes = found.els.flatMap(shapesOf);
    look = centroid(shapes.flat());
    trig = shapes.map((s) => flat(s));
    osmIds = found.els.map((e) => `${e.type}/${e.id}`);
    const t = found.els[0].tags;
    osmName = t.name || t['name:es'] || (t.wikimedia_commons || '').replace(/^Category:/, '') || '';
  }
  const at = Array.isArray(spec.at) && spec.at.length === 2 ? proj(spec.at[0], spec.at[1]) : null;
  if (!look && at) look = at;
  if (!look) { tourIssues.push(`${id}: needs "osm" or "at"`); continue; }
  // a drivable street place (the Rambla) snaps to itself unless `road` says otherwise
  const roadName = spec.road || (found?.street && found.els.some((e) => drivable(e.tags)) ? spec.osm : null);
  const rp = nearestRoadPoint(at || look, roadName);
  if (!rp) { tourIssues.push(`${id}: no drivable street nearby`); continue; }
  tourPlaces[id] = {
    name: osmName, osm: osmIds.slice(0, 6), street: found?.street || false,
    look: [r1(look[0]), r1(look[1])], p: [r1(rp.q[0]), r1(rp.q[1])], d: rp.dir.map((v) => +v.toFixed(3)),
    w: rp.r.w, ow: rp.r.ow ? 1 : 0, road: rp.r.names[0] || rp.r.k, dist: Math.round(rp.d),
    back: backAlong(rp, [45, 35, 25, 15]),
    trig,
  };
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
  styles: STYLES,
  facade: { groundH: GROUND_H, floorH: FLOOR_H, parapetH: PARAPET_H },
  start,
  landmarks,
  buildings,
  roads,
  plazas,
  parks,
  palms: flat(palms),
  sea: flat(sea),
  tour: { places: tourPlaces, graph: { n: graphN, e: graphE } },
  mount: { foot: flat(MOUNT_FOOT), peak: flat([proj(peakNode.lat, peakNode.lon)]), peakName: peakNode.tags.name, height: 166, castle: flat(castleHull), castleName: castleWay.tags['name:es'] || castleWay.tags.name },
};
const json = JSON.stringify(out);
await writeFile('data/city.json', json);

console.log(`buildings: ${buildings.length}  (height sources ${JSON.stringify(stats.heightSrc)}; styles ${JSON.stringify(stats.styles)}; facades.json overrides: ${overridesUsed.join(', ') || 'none'})`);
console.log(`facade edges: ${JSON.stringify(stats.edges)} (shared walls, [none, residential, main] street class)`);
console.log(`skipped: ${JSON.stringify(stats.skipped)}  excluded names: ${stats.excludedNames.filter(Boolean).join('; ')}`);
console.log(`roads: ${roads.length} polylines ${JSON.stringify(roadCount)}; junction vertices: ${junctionCount}; lanes tagged: ${roads.filter((r) => r.l).length}; oneway: ${roads.filter((r) => r.o).length}; plazas: ${plazas.length} (${plazas.map((p) => p.k).filter((k, i, a) => a.indexOf(k) === i).join(', ')}); parks: ${parks.length}; palms: ${palms.length}`);
console.log(`sea: ${seaSource} (${sea.length} vertices) — ${seaNote}`);
for (const [k, v] of Object.entries(landmarks)) console.log(`landmark ${k}: ${v.lat}, ${v.lon}  local (${v.x}, ${v.z})  ${v.osm.slice(0, 3).join(' ')}`);
console.log(`start: ${JSON.stringify(start)}`);

// tour report: places and route lengths (the same A* as the game, src/game/route.js)
{
  const g = tourGraph;
  console.log(`tour graph: ${g.nodeCount} nodes, ${g.edgeCount} edges`);
  for (const [id, p] of Object.entries(tourPlaces)) {
    const [lat, lon] = unproj(p.p[0], p.p[1]);
    console.log(`place ${id.padEnd(13)} ${(p.osm[0] || '(at)').padEnd(18)} ${(p.name || '').slice(0, 34).padEnd(34)} road point ${p.p.join(', ').padEnd(14)} (${lat.toFixed(5)}, ${lon.toFixed(5)}) ${p.dist} m from target, ${p.road}${p.ow ? ' (one-way)' : ''}`);
  }
  for (const t of tourSpec?.tours || []) {
    const ids = [t.start, ...t.route.map((r) => r.stop || r.pass), t.start];
    const pts = ids.map((id) => tourPlaces[id]?.p);
    if (pts.some((p) => !p)) { console.warn(`tour ${t.id}: unknown place`); continue; }
    const legs = [];
    let L = 0, T = 0;
    for (let i = 1; i < pts.length; i++) {
      const r = g.route(pts[i - 1], pts[i]);
      if (!r) { legs.push(`${ids[i]}: NO ROUTE`); continue; }
      L += r.len; T += r.time; legs.push(`${ids[i]} ${Math.round(r.len)} m`);
    }
    console.log(`tour ${t.id}: ${(L / 1000).toFixed(2)} km, estimate ${(T / 60).toFixed(1)} min | ${legs.join(', ')}`);
  }
  for (const issue of tourIssues) console.warn('tour:', issue);
}
console.log(`city.json: ${(json.length / 1024).toFixed(0)} KB`);
