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

const COLORS = {
  ground: 0xd9ccb0,
  sea: 0x2f86b8,
  park: 0x8fbf6a,
  plaza: 0xe4d6bc,
  sidewalk: 0xd8d2c4,
  road: { primary: 0x55585d, primary_link: 0x55585d, secondary: 0x5c5f64, tertiary: 0x63666b, residential: 0x6c6f74, unclassified: 0x6c6f74, living_street: 0x8a8580, service: 0x77797d, busway: 0x6a4a44, pedestrian: 0xcdbd9f },
  mountLow: 0x9a9a5c, mountHigh: 0xc8a878, castle: 0xd8c29a,
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

function flatMesh(geo, order, name, material) {
  const mesh = new THREE.Mesh(geo, material || new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false }));
  mesh.renderOrder = order;
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// options: { texMode: 'full' | 'low' | 'off', tiles (from buildTiles), sky, photos (from loadPhotoFacades) }
export function buildCity(city, options = {}) {
  const { texMode = 'off', tiles = null, sky = 0xbfe3f5, photos = null } = options;
  const texFacades = texMode !== 'off' && tiles;
  const texGround = texMode === 'full' && tiles;
  const group = new THREE.Group();
  group.name = 'city';
  const c = (hex) => new THREE.Color(hex);
  const stats = { texMode };

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
    const gp = new GeoBuilder({ aKind: 1 });
    const plazaCol = c(COLORS.plaza), mosaicCol = c(0xb8a48e);
    let explanada = null;
    for (const pl of city.plazas) {
      const ring = pairs(Array.isArray(pl) ? pl : pl.p);
      const isExpl = pl.k === 'explanada';
      if (isExpl) explanada = pl;
      gp.polygon(ring, null, 0, isExpl && !texGround ? mosaicCol : plazaCol, { aKind: [isExpl ? 1 : 0] });
    }
    group.add(flatMesh(gp.build(), -17, 'plazas', texGround ? plazaMaterial(tiles, explanada) : null));
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
      if (sw) addRibbon(gb, pairs(r.p), r.w + 2 * sw, sidewalkCol, { tpl: TPL.SIDEWALK, roadHalf: r.w / 2 });
    }
    const zebraJobs = [];
    for (const r of sorted) {
      const col = colCache[r.k] || (colCache[r.k] = c(COLORS.road[r.k] ?? 0x6c6f74));
      const pts = pairs(r.p);
      const tpl = templateOf(r);
      const junctions = (r.j || []).map((j) => (Array.isArray(j) ? j : [j, r.w]));
      addRibbon(gb, pts, r.w, col, { tpl, roadHalf: r.w / 2, junctions: tpl >= 1 && tpl <= 6 ? junctions : null });
      if (MARKED.test(r.k)) for (const [ji, ow] of junctions) zebraJobs.push({ pts, i: ji, hw: r.w / 2, D: fadeDistance(ow), col });
    }
    for (const z of zebraJobs) zebras += addZebras(gb, z);
    group.add(flatMesh(gb.build(), -16, 'roads', texGround ? roadMaterial(tiles) : null));
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
      if (!gb) chunks.set(key, (gb = new GeoBuilder({ aBld: 1, aWall: 4 })));
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
      const info = { idx, b, L, runs, ring, top, bottom, codes, styleName };
      facades += runs.length;
      for (const run of runs) if (run.L < MIN_FACADE) plainFacades++;
      // photo facade: its walls go to the photo mesh, the procedural builder skips them
      const photoItems = photos && photos.byBuilding.get(b.id);
      if (photoItems) { info.skip = addPhotoBuilding(pb, b, photoItems); photoBuildings++; }
      // 3D balcony candidates: ensanche / classic along main streets
      if (!photoItems && texFacades && (styleName === 'ensanche' || styleName === 'classic') && L.floors >= 2) {
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
      gb.polygon(ring, holes, b.h, roof, { aBld: [idx], aWall: [0, 0, -1, b.h] });
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
  // ---------- Benacantil + castle (decor) ----------
  group.add(buildMount(city.mount));
  // ---------- palms ----------
  group.add(...buildPalms(city.palms));

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
      const a0 = [a[0], 0, a[1]], b0 = [b[0], 0, b[1]], b1 = [b[0], h, b[1]], a1 = [a[0], h, a[1]];
      const wa = [u0, run.bw, kind, h], wb = [u1, run.bw, kind, h];
      const aux = { aBld: [info.idx] };
      gb.tri(a0, b0, b1, nn, botT, botT, topT, { ...aux, aWall: [wa, wb, wb] });
      gb.tri(a0, b1, a1, nn, botT, topT, topT, { ...aux, aWall: [wa, wb, wa] });
      // remember where this run's wall vertices went (for the balcony flag patch)
      if (!isHole) { run.chunk = gb; (run.vertexStart ||= []).push(gb.pos.length / 3 - 6); }
    });
  });
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
        const p = new THREE.Vector3(a[0] + d[0] * t, L.gH + f * L.fH, a[1] + d[1] * t).addScaledVector(z, 0.02);
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
  const { tpl = 0, roadHalf = w / 2, junctions = null } = opts;
  const { pts, fade } = junctions && junctions.length ? insertFades(ptsIn, junctions) : { pts: ptsIn, fade: ptsIn.map(() => 1) };
  const hw = w / 2, n = pts.length, up = [0, 1, 0], y = 0;
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
    L.push([pts[i][0] + nx * scale, y, pts[i][1] + nz * scale]);
    R.push([pts[i][0] - nx * scale, y, pts[i][1] - nz * scale]);
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
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      gb.tri([p[0], y, p[1]], [p[0] + Math.cos(a0) * hw, y, p[1] + Math.sin(a0) * hw], [p[0] + Math.cos(a1) * hw, y, p[1] + Math.sin(a1) * hw], up, col, col, col, { aRoad: [0, 0, roadHalf, 0], aTpl: capTpl });
    }
  }
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
function addZebras(gb, { pts, i, hw, D, col }) {
  let count = 0;
  const up = [0, 1, 0];
  for (const j of [i - 1, i + 1]) {
    if (j < 0 || j >= pts.length) continue;
    const a = pts[i], b = pts[j];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    if (len < D + ZEBRA_DEPTH + 4) continue;
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
    const s0 = D + 1.0, s1 = s0 + ZEBRA_DEPTH;
    const P = (s, side) => [a[0] + ux * s + nx * side * hw, 0.0, a[1] + uz * s + nz * side * hw];
    const A = (t, side) => [t, side * hw, hw, 1];
    const T = [TPL.ZEBRA];
    gb.tri(P(s0, 1), P(s0, -1), P(s1, -1), up, col, col, col, { aRoad: [A(0, 1), A(0, -1), A(1, -1)], aTpl: T });
    gb.tri(P(s0, 1), P(s1, -1), P(s1, 1), up, col, col, col, { aRoad: [A(0, 1), A(1, -1), A(1, 1)], aTpl: T });
    count++;
  }
  return count;
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
