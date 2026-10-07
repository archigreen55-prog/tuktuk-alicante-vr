// Builds the three.js scene content from data/city.json.
// Flat ground layers (ground, sea, parks, plazas, roads) are drawn first with depthWrite off and
// explicit renderOrder, so they layer like paint with no z-fighting; everything that stands up
// (buildings, mount, palms, the tuk-tuk) is drawn afterwards with normal depth.
// Textures (stage 5b): facades, roads/sidewalks and plazas get textured materials (facades.js) fed by
// per-vertex attributes built here; ?tex=0 keeps the plain vertex-colour look.
import * as THREE from 'three';
import { GeoBuilder, pairs, orient, rand } from './geo.js';
import { ZEBRA_DEPTH, BAY_W } from './tiles.js';
import { facadeMaterial, roadMaterial, plazaMaterial, buildBuildingTable, buildingLayout, TPL, MARK_TEMPLATES, SHUTTER_COLORS } from './facades.js';
import { PhotoBuilder, addPhotoBuilding, photoMaterial } from './landmarks.js';
import { buildGround } from './ground.js';
import { buildFootprintMask } from './footprint.js';

const COLORS = {
  ground: 0xd9ccb0,
  sea: 0x2f86b8,
  park: 0x8fbf6a,
  plaza: 0xe4d6bc,
  sidewalk: 0xd8d2c4,
  road: { primary: 0x55585d, primary_link: 0x55585d, secondary: 0x5c5f64, tertiary: 0x63666b, residential: 0x6c6f74, unclassified: 0x6c6f74, living_street: 0x8a8580, service: 0x77797d, busway: 0x6a4a44, pedestrian: 0xcdbd9f },
  wall: 0xcbb896,
  trunk: 0x8a6a45, frond: 0x3f8f3a,
  balconyRail: 0x596068,
};
// Draw order among roads: paths first, big roads on top.
const ROAD_RANK = ['pedestrian', 'service', 'living_street', 'busway', 'residential', 'unclassified', 'tertiary', 'secondary', 'primary_link', 'primary'];
// Sidewalk width per road kind (m); none = no sidewalk strip
const SIDEWALK = { primary: 3.5, primary_link: 2, secondary: 3, secondary_link: 2, tertiary: 2.5, tertiary_link: 2, residential: 2, unclassified: 2, busway: 2.5 };
const MARKED = /^(primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$/;
const RUN_TURN = 25 * Math.PI / 180;   // adjacent edges turning less than this form one facade
const MIN_FACADE = 2.0;                // m, shorter facades are plain plaster
const BALCONY_CAP = 4500;              // instances (18 triangles each)

// Flat layers lie on the ground mesh: depth-tested with a polygon offset per layer (later layers win
// where they overlap), no depth write, drawn in renderOrder after the ground.
const LAYER_OFFSET = { parks: 1, plazas: 2, roads: 3 };
function flatMesh(geo, order, name, material, layer) {
  const mat = material || new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false });
  if (layer) { mat.polygonOffset = true; mat.polygonOffsetFactor = -LAYER_OFFSET[layer]; mat.polygonOffsetUnits = -LAYER_OFFSET[layer] * 2; }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = order;
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
// heights of the flat layers above the ground grid (the polygon offset does the rest)
const LIFT = { parks: 0.03, plazas: 0.04, sidewalk: 0.05, road: 0.06, zebra: 0.07 };
const DRAPE_CELL = 8; // m, polygons are cut into cells of this size so they follow the ground

// options: { texMode: 'full' | 'low' | 'off', tiles (from buildTiles), sky, photos (from loadPhotoFacades),
//   cuts (Map osmId -> niches behind 3D models, from loadModels), terrain (Terrain, src/city/terrain.js),
//   footprint (default true): the ground is not drawn under roads, plazas and parks (src/city/footprint.js) }
export function buildCity(city, options = {}) {
  const { texMode = 'off', tiles = null, sky = 0xbfe3f5, photos = null, cuts = null, terrain = null, footprint = true } = options;
  const texFacades = texMode !== 'off' && tiles;
  const texGround = texMode === 'full' && tiles;
  const group = new THREE.Group();
  group.name = 'city';
  const c = (hex) => new THREE.Color(hex);
  const stats = { texMode };
  const H = terrain ? (x, z) => terrain.height(x, z) : () => 0;

  // ---------- ground ----------
  if (terrain) {
    const mask = footprint ? buildFootprintMask(city, terrain) : null;
    const g = buildGround(terrain, { mask });
    if (mask) Object.assign(stats, mask.stats);
    g.group.renderOrder = -21;
    for (const m of g.group.children) m.renderOrder = -21;
    group.add(g.group);
    Object.assign(stats, g.stats);
  } else {
    const gb = new GeoBuilder();
    const S = 6000;
    gb.polygon([[-S, -S], [S, -S], [S, S], [-S, S]], null, 0, c(COLORS.ground));
    group.add(flatMesh(gb.build(), -20, 'ground'));
  }
  // ---------- sea ----------
  {
    const gb = new GeoBuilder();
    gb.polygon(pairs(city.sea), null, 0, c(COLORS.sea));
    const sea = flatMesh(gb.build(), -19, 'sea');
    sea.material.depthWrite = true;
    group.add(sea);
  }
  // ---------- parks & plazas ----------
  {
    const gb = new GeoBuilder();
    for (const p of city.parks) drapePolygon(gb, pairs(p), H, LIFT.parks, c(COLORS.park));
    group.add(flatMesh(gb.build(), -18, 'parks', null, 'parks'));
    const gp = new GeoBuilder({ aKind: 1 });
    const plazaCol = c(COLORS.plaza), mosaicCol = c(0xb8a48e);
    let explanada = null;
    for (const pl of city.plazas) {
      const ring = pairs(Array.isArray(pl) ? pl : pl.p);
      const isExpl = pl.k === 'explanada';
      if (isExpl) explanada = pl;
      drapePolygon(gp, ring, H, LIFT.plazas, isExpl && !texGround ? mosaicCol : plazaCol, { aKind: [isExpl ? 1 : 0] });
    }
    group.add(flatMesh(gp.build(), -17, 'plazas', texGround ? plazaMaterial(tiles, explanada) : null, 'plazas'));
    stats.plazaTris = gp.triangles + gb.triangles;
  }
  // ---------- roads: sidewalks, ribbons with markings, zebras (one mesh, draw order inside) ----------
  {
    const gb = new GeoBuilder({ aRoad: 4, aTpl: 1 });
    const sorted = city.roads.slice().sort((a, b) => ROAD_RANK.indexOf(a.k) - ROAD_RANK.indexOf(b.k));
    const colCache = {};
    const sidewalkCol = c(COLORS.sidewalk);
    let zebras = 0;
    for (const r of sorted) {
      const sw = SIDEWALK[r.k];
      if (sw) addRibbon(gb, pairs(r.p), r.w + 2 * sw, sidewalkCol, { tpl: TPL.SIDEWALK, roadHalf: r.w / 2, H, lift: LIFT.sidewalk });
    }
    const zebraJobs = [];
    for (const r of sorted) {
      const col = colCache[r.k] || (colCache[r.k] = c(COLORS.road[r.k] ?? 0x6c6f74));
      const pts = pairs(r.p);
      const tpl = templateOf(r);
      const junctions = (r.j || []).map((j) => (Array.isArray(j) ? j : [j, r.w]));
      addRibbon(gb, pts, r.w, col, { tpl, roadHalf: r.w / 2, junctions: tpl >= 1 && tpl <= 6 ? junctions : null, H, lift: LIFT.road });
      if (MARKED.test(r.k)) for (const [ji, ow] of junctions) zebraJobs.push({ pts, i: ji, hw: r.w / 2, D: fadeDistance(ow), col, H });
    }
    for (const z of zebraJobs) zebras += addZebras(gb, z);
    group.add(flatMesh(gb.build(), -16, 'roads', texGround ? roadMaterial(tiles) : null, 'roads'));
    stats.roadTris = gb.triangles;
    stats.zebras = zebras;
  }
  // ---------- buildings (chunked for frustum culling) ----------
  {
    const CH = 400;
    const chunks = new Map();
    const palette = city.palette.map((h) => c(h));
    const styles = city.styles || ['ensanche', 'classic', 'old', 'tower', 'office', 'civic'];
    const tmp = new THREE.Color();
    let tris = 0, facades = 0, plainFacades = 0;
    const layouts = [];
    const balconyCandidates = [];
    const pb = new PhotoBuilder(); // walls of landmarks with photo facades (landmarks.js), one mesh
    let photoBuildings = 0;
    const ramblaS = city.landmarks?.rambla?.south || [279, 240], ramblaN = city.landmarks?.rambla?.north || [98, -270];
    const explC = city.landmarks?.explanada ? [city.landmarks.explanada.x, city.landmarks.explanada.z] : [234, 291];
    city.buildings.forEach((b, idx) => {
      const ring = pairs(b.p);
      let cx = 0, cz = 0;
      for (const [x, z] of ring) { cx += x; cz += z; }
      cx /= ring.length; cz /= ring.length;
      const key = Math.floor(cx / CH) + ',' + Math.floor(cz / CH);
      let gb = chunks.get(key);
      if (!gb) chunks.set(key, (gb = new GeoBuilder({ aBld: 1, aWall: 4, aBase: 1 })));
      const styleName = styles[b.s || 0];
      const L = buildingLayout(b, styleName);
      L.shutter = Math.floor(rand(idx * 13 + 5) * SHUTTER_COLORS.length);
      if (styleName === 'classic') L.shutter = [0, 1, 4][Math.floor(rand(idx * 13 + 5) * 3)];      // wooden shutters: greens / brown
      if (styleName === 'old') L.shutter = [0, 1, 4, 5][Math.floor(rand(idx * 13 + 5) * 4)];
      if (styleName === 'ensanche') L.shutter = [2, 2, 3, 0, 1, 5][Math.floor(rand(idx * 13 + 5) * 6)]; // blinds: mostly white/grey
      layouts.push(L);
      const base = palette[b.c];
      const top = base.clone().multiplyScalar(0.96 + rand(idx) * 0.08);
      if (styleName === 'civic') top.set(0xd9cbb2).multiplyScalar(0.94 + rand(idx) * 0.1);       // stone
      if (styleName === 'old' && rand(idx + 3) < 0.5) top.set(0xf4efe4);                          // whitewash
      if (styleName === 'office' || styleName === 'tower') top.multiplyScalar(0.9);
      const bottom = top.clone().multiplyScalar(texFacades ? 0.82 : 0.72); // cheap ambient occlusion at street level
      const roof = tmp.copy(top).multiplyScalar(0.82).clone();
      const holes = (b.holes || []).map(pairs);
      const runs = facadeRuns(ring);
      const codes = b.e || '';
      const baseY = b.y || 0;
      const info = { idx, b, L, runs, ring, top, bottom, codes, styleName, base: baseY };
      facades += runs.length;
      for (const run of runs) if (run.L < MIN_FACADE) plainFacades++;
      // photo facade: its walls go to the photo mesh, the procedural builder skips them
      const photoItems = photos && photos.byBuilding.get(b.id);
      if (photoItems) { info.skip = addPhotoBuilding(pb, b, photoItems, baseY); photoBuildings++; }
      if (cuts && cuts.has(b.id)) info.cuts = cuts.get(b.id);
      // 3D balcony candidates: ensanche / classic along main streets
      if (!photoItems && !info.cuts && texFacades && (styleName === 'ensanche' || styleName === 'classic') && L.floors >= 2) {
        for (const run of runs) {
          if (run.L < 4 || run.bw < 2.2) continue;
          if (!run.edges.some((ei) => kindOf(codes, ei) === 3)) continue;
          const mid = runMidpoint(ring, run);
          const d = Math.min(segDist(mid, ramblaS, ramblaN), Math.hypot(mid[0] - explC[0], mid[1] - explC[1]) - 60);
          balconyCandidates.push({ info, run, d, count: run.bays * L.floors });
        }
      }
      addWalls(gb, ring, b.h, false, top, bottom, info);
      for (const h of holes) addWalls(gb, h, b.h, true, top, bottom, info);
      gb.polygon(ring, holes, baseY + b.h, roof, { aBld: [idx], aWall: [0, 0, -1, b.h], aBase: [baseY] });
    });
    // choose balcony facades nearest to the Rambla / Explanada until the cap; flag their runs
    // (aWall.z += 8 on main-street edges: the shader then draws door tiles without a painted rail)
    let balconies = 0;
    const chosen = [];
    if (texFacades) {
      balconyCandidates.sort((a, b) => a.d - b.d);
      for (const cand of balconyCandidates) {
        if (balconies + cand.count > BALCONY_CAP) continue;
        balconies += cand.count; cand.run.bal3d = true; chosen.push(cand);
        markBalconyRun(cand);
      }
    }
    const mat = texFacades ? facadeMaterial(tiles, buildBuildingTable(city.buildings, layouts), sky) : new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const [key, gb] of chunks) {
      tris += gb.triangles;
      const mesh = new THREE.Mesh(gb.build(), mat);
      mesh.name = 'buildings ' + key;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    let balconyMesh = null;
    if (chosen.length) { balconyMesh = buildBalconies(chosen, palette); group.add(balconyMesh); balconies = balconyMesh.count; }
    if (pb.triangles) {
      const mesh = new THREE.Mesh(pb.build(), photoMaterial(photos.texture));
      mesh.name = 'photo facades';
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      stats.photoTris = pb.triangles;
      stats.photoBuildings = photoBuildings;
      Object.assign(stats, { photoAtlas: photos.stats.atlas, photoMB: photos.stats.mb, photos: photos.stats.photos });
    }
    stats.buildingTris = tris;
    stats.buildingChunks = chunks.size;
    stats.facades = facades;
    stats.plainFacades = plainFacades;
    stats.balconies = balconies;
    stats.balconyFacades = chosen.length;
  }
  // ---------- walls (castle, city walls, the San Fernando fort) on the ground ----------
  if (city.walls && city.walls.length) { const w = buildWalls(city.walls, H); group.add(w); stats.wallTris = w.geometry.attributes.position.count / 3; }
  // ---------- palms ----------
  group.add(...buildPalms(city.palms, H));

  group.updateMatrixWorld(true);
  return { group, stats };
}

// ---------- facades ----------
// Edge code from build-city: bit0 shared wall, bits1-2 street class (0 back, 1 residential, 2 main).
// Wall kind for the shader: 0 plain, 1 back/courtyard, 2 residential street, 3 main street.
function kindOf(codes, ei) {
  const code = codes.charCodeAt(ei) - 48;
  if (!(code >= 0)) return 2;
  return code & 1 ? 0 : 1 + (code >> 1);
}
// Splits a ring into facade runs: consecutive edges turning less than RUN_TURN. Each run gets its
// length, bay count and bay width, so windows are whole and centred on any facade length.
export function facadeRuns(ring) {
  const n = ring.length;
  const dir = [], len = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1e-6;
    dir.push([dx / l, dz / l]); len.push(l);
  }
  const turns = (i) => { // turn at the start vertex of edge i
    const p = dir[(i + n - 1) % n], q = dir[i];
    return Math.abs(Math.atan2(p[0] * q[1] - p[1] * q[0], p[0] * q[0] + p[1] * q[1]));
  };
  let start = 0;
  for (let i = 0; i < n; i++) if (turns(i) > RUN_TURN) { start = i; break; }
  const runs = [];
  let cur = null;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (!cur || (k > 0 && turns(i) > RUN_TURN)) { cur = { edges: [], u0: [], L: 0 }; runs.push(cur); }
    cur.u0.push(cur.L);
    cur.edges.push(i);
    cur.L += len[i];
  }
  for (const r of runs) { r.bays = Math.max(1, Math.round(r.L / BAY_W)); r.bw = r.L / r.bays; r.len = len; r.dir = dir; }
  return runs;
}
function runMidpoint(ring, run) {
  let target = run.L / 2;
  for (let k = 0; k < run.edges.length; k++) {
    const ei = run.edges[k];
    if (target <= run.len[ei] || k === run.edges.length - 1) { const a = ring[ei]; return [a[0] + run.dir[ei][0] * target, a[1] + run.dir[ei][1] * target]; }
    target -= run.len[ei];
  }
  return ring[run.edges[0]];
}
function segDist(p, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2));
  return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ez * t);
}

function addWalls(gb, ring, h, isHole, top, bottom, info) {
  const sgn = (orient(ring) > 0 ? 1 : -1) * (isHole ? -1 : 1);
  const n = ring.length;
  const runs = isHole ? facadeRuns(ring) : info.runs;
  const tint = new THREE.Color();
  runs.forEach((run, ri) => {
    const plain = run.L < MIN_FACADE;
    const t = 0.95 + 0.1 * rand(info.idx * 31 + ri * 7);
    const topT = tint.copy(top).multiplyScalar(t).clone(), botT = tint.copy(bottom).multiplyScalar(t).clone();
    run.edges.forEach((i, k) => {
      if (!isHole && info.skip && info.skip.has(i)) return; // covered by a photo facade
      const a = ring[i], b = ring[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      const nn = [(sgn * dz) / len, 0, (-sgn * dx) / len];
      const kind = plain ? 0 : isHole ? 1 : kindOf(info.codes, i);
      const u0 = run.u0[k], u1 = u0 + len;
      const y0 = info.base, y1 = info.base + h;
      const a0 = [a[0], y0, a[1]], b0 = [b[0], y0, b[1]], b1 = [b[0], y1, b[1]], a1 = [a[0], y1, a[1]];
      const wa = [u0, run.bw, kind, h], wb = [u1, run.bw, kind, h];
      const aux = { aBld: [info.idx], aBase: [info.base] };
      const cut = !isHole && info.cuts && info.cuts.find((c) => c.edge === i);
      if (cut) { addNicheWall(gb, a, [dx / len, dz / len], len, nn, h, u0, run.bw, kind, botT, topT, info.idx, cut, info.base); return; }
      gb.tri(a0, b0, b1, nn, botT, botT, topT, { ...aux, aWall: [wa, wb, wb] });
      gb.tri(a0, b1, a1, nn, botT, topT, topT, { ...aux, aWall: [wa, wb, wa] });
      // remember where this run's wall vertices went (for the balcony flag patch)
      if (!isHole) { run.chunk = gb; (run.vertexStart ||= []).push(gb.pos.length / 3 - 6); }
    });
  });
}
// A wall with a 3D model in front of it (models.js): the wall around the cut [t0, t1] x [0, top] as usual,
// the cut itself a plain niche `depth` deep (back, two sides, ceiling), so the model's doors and recesses
// show instead of the wall. aWall keeps the wall's u so windows around the niche stay in place.
function addNicheWall(gb, a, d, len, nn, h, u0, bw, kind, bot, top, idx, cut, base = 0) {
  const col = (y) => bot.clone().lerp(top, Math.min(1, y / h));
  const P = (t, y, depth = 0) => [a[0] + d[0] * t - nn[0] * depth, base + y, a[1] + d[1] * t - nn[2] * depth];
  const W = (t, k) => [u0 + t, bw, k, h];
  const aux = (w) => ({ aBld: [idx], aWall: w, aBase: [base] });
  const face = (t0, t1, y0, y1, k, depth = 0) => { // a piece of wall parallel to the facade
    if (t1 - t0 < 0.01 || y1 - y0 < 0.01) return;
    const p00 = P(t0, y0, depth), p10 = P(t1, y0, depth), p11 = P(t1, y1, depth), p01 = P(t0, y1, depth);
    gb.tri(p00, p10, p11, nn, col(y0), col(y0), col(y1), aux([W(t0, k), W(t1, k), W(t1, k)]));
    gb.tri(p00, p11, p01, nn, col(y0), col(y1), col(y1), aux([W(t0, k), W(t1, k), W(t0, k)]));
  };
  const { t0, t1, top: yt, depth: D } = cut;
  face(0, t0, 0, h, kind);
  face(t1, len, 0, h, kind);
  face(t0, t1, yt, h, kind);
  face(t0, t1, 0, yt, 0, D);                                       // back of the niche
  for (const [t, sgn] of [[t0, 1], [t1, -1]]) {                    // sides, facing into the niche
    const n = [d[0] * sgn, 0, d[1] * sgn];
    const q0 = P(t, 0), q1 = P(t, 0, D), q2 = P(t, yt, D), q3 = P(t, yt);
    gb.tri(q0, q1, q2, n, col(0), col(0), col(yt), aux([W(t, 0), W(t + D, 0), W(t + D, 0)]));
    gb.tri(q0, q2, q3, n, col(0), col(yt), col(yt), aux([W(t, 0), W(t + D, 0), W(t, 0)]));
  }
  const c0 = P(t0, yt), c1 = P(t1, yt), c2 = P(t1, yt, D), c3 = P(t0, yt, D); // ceiling
  gb.tri(c0, c1, c2, [0, -1, 0], col(yt), col(yt), col(yt), aux([W(t0, 0), W(t1, 0), W(t1, 0)]));
  gb.tri(c0, c2, c3, [0, -1, 0], col(yt), col(yt), col(yt), aux([W(t0, 0), W(t1, 0), W(t0, 0)]));
}
// The chosen balcony runs were built before the selection: add 8 to aWall.z of their main-street edges.
function markBalconyRun(cand) {
  const { run, info } = cand;
  const gb = run.chunk;
  if (!gb || !run.vertexStart) return;
  run.edges.forEach((ei, k) => {
    if (kindOf(info.codes, ei) !== 3) return;
    const v0 = run.vertexStart[k];
    for (let v = v0; v < v0 + 6; v++) gb.aux.aWall[v * 4 + 2] += 8;
  });
}

// One InstancedMesh with all balconies (slab + rail panels, 18 triangles each), +1 draw call.
function buildBalconies(chosen, palette) {
  const slab = new THREE.BoxGeometry(1, 0.14, 0.85).translate(0, 0.07, 0.425);
  const RAIL = 0.78;
  const front = new THREE.PlaneGeometry(1, RAIL).translate(0, 0.14 + RAIL / 2, 0.83);
  const sideL = new THREE.PlaneGeometry(0.83, RAIL).rotateY(-Math.PI / 2).translate(-0.5, 0.14 + RAIL / 2, 0.415);
  const sideR = new THREE.PlaneGeometry(0.83, RAIL).rotateY(Math.PI / 2).translate(0.5, 0.14 + RAIL / 2, 0.415);
  const parts = [slab, front, sideL, sideR].map((g) => g.toNonIndexed());
  const pos = [], nor = [], col = [];
  const rail = new THREE.Color(COLORS.balconyRail);
  parts.forEach((g, pi) => {
    const p = g.attributes.position.array, nr = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) { pos.push(p[i], p[i + 1], p[i + 2]); nor.push(nr[i], nr[i + 1], nr[i + 2]); col.push(...(pi === 0 ? [1, 1, 1] : [rail.r, rail.g, rail.b])); }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // placements first, then an InstancedMesh of exactly that size
  const place = [];
  const x = new THREE.Vector3(), y = new THREE.Vector3(0, 1, 0), z = new THREE.Vector3(), rot = new THREE.Matrix4();
  for (const cd of chosen) {
    const { info, run } = cd;
    const { ring, L, b } = info;
    const sgn = orient(ring) > 0 ? 1 : -1;
    const width = Math.min(run.bw - 0.6, 2.6);
    const colour = palette[b.c].clone().multiplyScalar(0.96);
    for (let j = 0; j < run.bays; j++) {
      const uc = (j + 0.5) * run.bw;
      let k = 0; // edge containing uc
      while (k < run.edges.length - 1 && uc > run.u0[k] + run.len[run.edges[k]]) k++;
      const ei = run.edges[k];
      if (kindOf(info.codes, ei) !== 3) continue;
      const a = ring[ei], d = run.dir[ei], t = uc - run.u0[k];
      z.set(sgn * d[1], 0, -sgn * d[0]);                // outward normal
      x.crossVectors(z, y).normalize();                 // along the facade, right-handed with y up and z out
      rot.makeBasis(x, y, z);
      const q = new THREE.Quaternion().setFromRotationMatrix(rot);
      for (let f = 0; f < L.floors; f++) {
        const p = new THREE.Vector3(a[0] + d[0] * t, (info.base || 0) + L.gH + f * L.fH, a[1] + d[1] * t).addScaledVector(z, 0.02);
        place.push({ p, q, width, colour });
      }
    }
  }
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), place.length);
  const m = new THREE.Matrix4(), s = new THREE.Vector3();
  place.forEach((pl, i) => { m.compose(pl.p, pl.q, s.set(pl.width, 1, 1)); mesh.setMatrixAt(i, m); mesh.setColorAt(i, pl.colour); });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'balconies';
  return mesh;
}

// ---------- roads ----------
function templateOf(r) {
  if (r.k === 'pedestrian') return TPL.PED;
  if (r.k === 'living_street') return TPL.COBBLE;
  if (!MARKED.test(r.k)) return TPL.ASPHALT;
  const oneway = !!r.o;
  const lanes = r.l || (oneway ? (r.k === 'primary' ? 3 : /link/.test(r.k) ? 1 : 2) : 2);
  if (oneway) return lanes <= 1 ? MARK_TEMPLATES.M1W1 : lanes === 2 ? MARK_TEMPLATES.M1W2 : lanes === 3 ? MARK_TEMPLATES.M1W3 : MARK_TEMPLATES.M1W4;
  return lanes <= 2 ? MARK_TEMPLATES.M2W2 : lanes === 3 ? MARK_TEMPLATES.M1W3 : MARK_TEMPLATES.M2W4;
}
// distance from a junction node over which markings fade: half of the crossing road + its sidewalk + a metre
const fadeDistance = (otherW) => otherW / 2 + 3.5;

// Road polyline -> ribbon with mitred joints and round-ish end caps.
// opts: { tpl, roadHalf, junctions: [[index, otherWidth]] } -> aRoad = (along m, across m, road half width, marking fade)
function addRibbon(gb, ptsIn, w, col, opts = {}) {
  const { tpl = 0, roadHalf = w / 2, junctions = null, H = () => 0, lift = 0 } = opts;
  const faded = junctions && junctions.length ? insertFades(ptsIn, junctions) : { pts: ptsIn, fade: ptsIn.map(() => 1) };
  const { pts, fade } = subdivide(faded.pts, faded.fade, RIBBON_STEP, H);
  const hw = w / 2, n = pts.length, up = [0, 1, 0];
  const L = [], R = [], along = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    let nx = 0, nz = 0;
    const seg = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
    let n0 = null, n1 = null;
    if (i > 0) { n0 = seg(pts[i - 1], pts[i]); s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); }
    if (i < n - 1) n1 = seg(pts[i], pts[i + 1]);
    const m = n0 && n1 ? [n0[0] + n1[0], n0[1] + n1[1]] : (n0 || n1);
    const ml = Math.hypot(m[0], m[1]) || 1;
    nx = m[0] / ml; nz = m[1] / ml;
    const ref = n1 || n0;
    const scale = hw / Math.max(0.5, nx * ref[0] + nz * ref[1]);
    const lx = pts[i][0] + nx * scale, lz = pts[i][1] + nz * scale, rx = pts[i][0] - nx * scale, rz = pts[i][1] - nz * scale;
    L.push([lx, H(lx, lz) + lift, lz]);
    R.push([rx, H(rx, rz) + lift, rz]);
    along.push(s);
  }
  const A = (i, side) => [along[i], side * hw, roadHalf, fade[i]];
  const T = [tpl];
  for (let i = 0; i < n - 1; i++) {
    gb.tri(L[i], R[i], R[i + 1], up, col, col, col, { aRoad: [A(i, 1), A(i, -1), A(i + 1, -1)], aTpl: T });
    gb.tri(L[i], R[i + 1], L[i + 1], up, col, col, col, { aRoad: [A(i, 1), A(i + 1, -1), A(i + 1, 1)], aTpl: T });
  }
  const capTpl = [tpl >= 1 && tpl <= 6 ? TPL.ASPHALT : tpl];
  for (const p of [pts[0], pts[n - 1]]) {
    const seg = 8;
    const y = H(p[0], p[1]) + lift;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const q0 = [p[0] + Math.cos(a0) * hw, p[1] + Math.sin(a0) * hw], q1 = [p[0] + Math.cos(a1) * hw, p[1] + Math.sin(a1) * hw];
      gb.tri([p[0], y, p[1]], [q0[0], H(q0[0], q0[1]) + lift, q0[1]], [q1[0], H(q1[0], q1[1]) + lift, q1[1]], up, col, col, col, { aRoad: [0, 0, roadHalf, 0], aTpl: capTpl });
    }
  }
}
const RIBBON_STEP = 6;    // m between ribbon vertices where the ground is not straight along the segment
const RIBBON_FLAT = 0.05; // m: a segment whose ground stays this close to a straight line is not subdivided
// Extra vertices along segments where the ground bends; the marking fade is interpolated
function subdivide(pts, fade, step, H) {
  const out = [pts[0]], f = [fade[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let n = Math.max(1, Math.round(L / step));
    if (n > 1) { // straight ground along the segment? then one piece is enough
      const ya = H(a[0], a[1]), yb = H(b[0], b[1]);
      let dev = 0;
      for (let k = 1; k < n; k++) { const t = k / n; dev = Math.max(dev, Math.abs(H(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) - (ya + (yb - ya) * t))); }
      if (dev < RIBBON_FLAT) n = 1;
    }
    for (let k = 1; k < n; k++) { const t = k / n; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); f.push(fade[i - 1] + (fade[i] - fade[i - 1]) * t); }
    out.push(b); f.push(fade[i]);
  }
  return { pts: out, fade: f };
}
// A polygon cut into DRAPE_CELL squares, each piece triangulated with its vertices on the ground
export function drapePolygon(gb, ring, H, lift, col, aux = null) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const up = [0, 1, 0];
  const put = (piece) => {
    if (piece.length < 3) return;
    const contour = piece.map(([x, z]) => new THREE.Vector2(x, z));
    const faces = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [i, j, k] of faces) {
      const P = (m) => [piece[m][0], H(piece[m][0], piece[m][1]) + lift, piece[m][1]];
      gb.tri(P(i), P(j), P(k), up, col, col, col, aux);
    }
  };
  if (maxX - minX < DRAPE_CELL * 1.5 && maxZ - minZ < DRAPE_CELL * 1.5) { put(ring); return; }
  const i0 = Math.floor(minX / DRAPE_CELL), i1 = Math.floor(maxX / DRAPE_CELL), j0 = Math.floor(minZ / DRAPE_CELL), j1 = Math.floor(maxZ / DRAPE_CELL);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const R = { minX: i * DRAPE_CELL, maxX: (i + 1) * DRAPE_CELL, minZ: j * DRAPE_CELL, maxZ: (j + 1) * DRAPE_CELL };
    put(clipRect(ring, R));
  }
}
// Sutherland–Hodgman clip of a polygon against an axis-aligned rectangle
function clipRect(poly, R) {
  const edges = [(p) => p[0] >= R.minX, (p) => p[0] <= R.maxX, (p) => p[1] >= R.minZ, (p) => p[1] <= R.maxZ];
  const inter = [
    (a, b) => { const t = (R.minX - a[0]) / (b[0] - a[0]); return [R.minX, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (R.maxX - a[0]) / (b[0] - a[0]); return [R.maxX, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (R.minZ - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), R.minZ]; },
    (a, b) => { const t = (R.maxZ - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), R.maxZ]; },
  ];
  let out = poly;
  for (let k = 0; k < 4 && out.length; k++) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      const ia = edges[k](a), ib = edges[k](b);
      if (ib) { if (!ia) out.push(inter[k](a, b)); out.push(b); } else if (ia) out.push(inter[k](a, b));
    }
  }
  // drop duplicate points (clipping can leave a repeated vertex, which earcut dislikes)
  const clean = [];
  for (const p of out) { const q = clean[clean.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.02) clean.push(p); }
  if (clean.length > 1 && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) <= 0.02) clean.pop();
  return clean;
}
// Inserts vertices at the fade distance from junction vertices: markings are 0 at the junction and
// 1 from the inserted vertex on, so centre lines never cross a junction.
function insertFades(pts, junctions) {
  const J = new Map(junctions.map(([i, ow]) => [i, fadeDistance(ow)]));
  const out = [], fade = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const isJ = J.has(i);
    out.push(pts[i]); fade.push(isJ ? 0 : 1);
    if (i === n - 1) break;
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const d0 = isJ ? J.get(i) : 0, d1 = J.has(i + 1) ? J.get(i + 1) : 0;
    if (d0 + d1 >= len - 0.5) { if (isJ || d1) fade[fade.length - 1] = 0; continue; } // too short: no markings on this segment
    if (d0 > 0) { out.push([a[0] + ux * d0, a[1] + uz * d0]); fade.push(1); }
    if (d1 > 0) { out.push([b[0] - ux * d1, b[1] - uz * d1]); fade.push(1); }
  }
  // a segment with a junction at the far end only: the far vertex is 0 and the inserted one 1 (handled above)
  return { pts: out, fade };
}
// Zebra crossings on both arms next to a junction vertex, just outside the marking fade zone.
function addZebras(gb, { pts, i, hw, D, col, H = () => 0 }) {
  let count = 0;
  const up = [0, 1, 0];
  for (const j of [i - 1, i + 1]) {
    if (j < 0 || j >= pts.length) continue;
    const a = pts[i], b = pts[j];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    if (len < D + ZEBRA_DEPTH + 4) continue;
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
    const s0 = D + 1.0, s1 = s0 + ZEBRA_DEPTH;
    const P = (s, side) => { const x = a[0] + ux * s + nx * side * hw, z = a[1] + uz * s + nz * side * hw; return [x, H(x, z) + LIFT.zebra, z]; };
    const A = (t, side) => [t, side * hw, hw, 1];
    const T = [TPL.ZEBRA];
    gb.tri(P(s0, 1), P(s0, -1), P(s1, -1), up, col, col, col, { aRoad: [A(0, 1), A(0, -1), A(1, -1)], aTpl: T });
    gb.tri(P(s0, 1), P(s1, -1), P(s1, 1), up, col, col, col, { aRoad: [A(0, 1), A(1, -1), A(1, 1)], aTpl: T });
    count++;
  }
  return count;
}

// Walls (barrier=* and the forts from OSM): vertical bands `h` above the ground along a polyline,
// one double-sided mesh; a little into the ground so slopes never show a gap under them.
function buildWalls(walls, H) {
  const gb = new GeoBuilder();
  const stone = new THREE.Color(COLORS.wall), dark = stone.clone().multiplyScalar(0.78), top = stone.clone().multiplyScalar(0.9);
  for (const w of walls) {
    const pts = pairs(w.p);
    const n = pts.length, last = w.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      if (l < 0.3) continue;
      const nn = [dz / l, 0, -dx / l];
      const ya = H(a[0], a[1]), yb = H(b[0], b[1]);
      const a0 = [a[0], ya - 1.5, a[1]], b0 = [b[0], yb - 1.5, b[1]], b1 = [b[0], yb + w.h, b[1]], a1 = [a[0], ya + w.h, a[1]];
      gb.tri(a0, b0, b1, nn, dark, dark, stone);
      gb.tri(a0, b1, a1, nn, dark, stone, stone);
      // a thin cap so the wall has a top edge when seen from above
      const t = 0.35;
      const c0 = [a[0] + nn[0] * t, ya + w.h, a[1] + nn[2] * t], c1 = [b[0] + nn[0] * t, yb + w.h, b[1] + nn[2] * t];
      const d0 = [a[0] - nn[0] * t, ya + w.h, a[1] - nn[2] * t], d1 = [b[0] - nn[0] * t, yb + w.h, b[1] - nn[2] * t];
      gb.tri(d0, d1, c1, [0, 1, 0], top, top, top);
      gb.tri(d0, c1, c0, [0, 1, 0], top, top, top);
    }
  }
  const mesh = new THREE.Mesh(gb.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.name = 'walls';
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function buildPalms(flat, H = () => 0) {
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
    m.compose(p.set(flat[i * 2], H(flat[i * 2], flat[i * 2 + 1]), flat[i * 2 + 1]), q, s.set(sc, sc, sc));
    trunk.setMatrixAt(i, m);
    crown.setMatrixAt(i, m);
  }
  trunk.name = 'palm trunks'; crown.name = 'palm crowns';
  trunk.computeBoundingSphere(); crown.computeBoundingSphere();
  return [trunk, crown];
}
