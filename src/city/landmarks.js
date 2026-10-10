// Photo facades of landmarks (plan-stage-5 §2.7, docs/report-mercado.md). The walls a photo covers leave
// the procedural chunk meshes and go into ONE extra mesh with their own UVs; every photo of every
// landmark lives in one atlas texture, so all landmarks together cost +1 draw call. A photo's sky is cut
// out with its mask (alpha test + alpha to coverage), domes are bodies of revolution ("lathe").
// Which walls, spans, domes: src/city/photoFacades.js (shared with tools/prepare-facade.mjs).
import * as THREE from 'three';
import { ringOf, photoPlacement, edgeOf, JOG_INSET } from './photoFacades.js';
import { t as tr } from '../i18n.js';

const PAD = 8;           // px of repeated border around every photo in the atlas (mip levels, filtering)
const LATHE_SEG = 32;    // segments around a dome
const LATHE_INSET = 0.92; // a dome samples its photo this much closer to the axis
const JOG_WRAP = 3;      // m of the neighbouring face a jog shows at most (the facade wraps round the corner)
const MODE = { PHOTO: 0, TILE: 1, SOLID: 2 }; // aPh.z: photo with its sky mask, repeating wall tile, photo without mask (domes)

// Loads the photos of the buildings present in city.json (spec = data/facades.json) into one atlas.
// Returns null when there is nothing to show; a photo that fails to load is skipped (procedural walls).
export async function loadPhotoFacades(city, spec, { version = '', anisotropy = 8 } = {}) {
  const present = new Set(city.buildings.map((b) => b.id));
  const items = [];
  for (const [osmId, s] of Object.entries(spec || {})) {
    if (!present.has(osmId) || !Array.isArray(s.photos)) continue;
    for (const entry of s.photos) if (entry.src && (entry.wall || entry.edges)) items.push({ osmId, entry });
  }
  if (!items.length) return null;
  const t0 = performance.now();
  const q = version ? `?v=${version}` : '';
  await Promise.all(items.map(async (it) => {
    const mask = it.entry.outline && !it.entry.wall ? loadImage(it.entry.src.replace(/\.[^.]+$/, '') + '.mask.png' + q).catch(() => null) : null;
    try {
      [it.img, it.mask] = await Promise.all([loadImage(it.entry.src + q), mask]); // photo and mask in parallel
    } catch (e) { console.warn(`photo facade ${it.entry.id}: ${e.message}`); }
  }));
  const ok = items.filter((it) => it.img);
  if (!ok.length) return null;
  const atlas = packAtlas(ok);
  const texture = new THREE.DataTexture(atlas.data, atlas.w, atlas.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = anisotropy;
  texture.flipY = false;
  texture.needsUpdate = true;
  const byBuilding = new Map(), credits = new Map();
  for (const it of ok) {
    if (!byBuilding.has(it.osmId)) byBuilding.set(it.osmId, []);
    byBuilding.get(it.osmId).push(it);
    const c = it.entry.credit;
    if (c && c.author) {
      const list = credits.get(it.osmId) || [];
      const text = `${c.author} (${c.license || '?'})`;
      if (!list.includes(text)) list.push(text);
      credits.set(it.osmId, list);
    }
  }
  return {
    texture, byBuilding, credits,
    stats: { photos: ok.length, atlas: `${atlas.w}×${atlas.h}`, mb: +((atlas.w * atlas.h * 4 * 4) / 3 / 1048576).toFixed(1), ms: Math.round(performance.now() - t0) },
  };
}

// "Фото фасаду: A (CC BY-SA 4.0), B (CC BY 3.0) · Wikimedia Commons" for the tour card of a place
export function creditLine(photos, osmIds) {
  if (!photos) return '';
  const all = [];
  for (const id of osmIds || []) for (const c of photos.credits.get(id) || []) if (!all.includes(c)) all.push(c);
  return all.length ? `${tr('credit.photo')} ${all.join(', ')} · Wikimedia Commons` : '';
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`${url} не завантажився`));
    img.src = url;
  });
}

// Shelf packing: tallest first, the width that gives the smallest atlas. The pixels are copied into a
// plain RGBA array (not a canvas texture: a canvas would premultiply and lose the colour under the mask).
function packAtlas(items) {
  const boxes = items.map((it) => ({ it, w: it.img.naturalWidth + 2 * PAD, h: it.img.naturalHeight + 2 * PAD })).sort((a, b) => b.h - a.h);
  const maxW = Math.max(...boxes.map((b) => b.w));
  let best = null;
  for (const W of [maxW, 2048, 4096].filter((w) => w >= maxW)) {
    let x = 0, y = 0, rowH = 0;
    const place = [];
    for (const b of boxes) {
      if (x + b.w > W) { y += rowH; x = 0; rowH = 0; }
      place.push({ b, x, y });
      x += b.w; rowH = Math.max(rowH, b.h);
    }
    const H = y + rowH;
    if (!best || W * H < best.W * best.H) best = { W, H, place };
  }
  const { W, H } = best;
  const data = new Uint8Array(W * H * 4);
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = (img) => {
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  for (const { b, x, y } of best.place) {
    const { it } = b;
    const w = it.img.naturalWidth, h = it.img.naturalHeight;
    const rgb = pixels(it.img), mask = it.mask ? pixels(it.mask) : null;
    const repeat = !!it.entry.wall;
    for (let py = -PAD; py < h + PAD; py++) {
      const sy = Math.min(h - 1, Math.max(0, py));
      for (let px = -PAD; px < w + PAD; px++) {
        const sx = repeat ? ((px % w) + w) % w : Math.min(w - 1, Math.max(0, px));
        const s = (sy * w + sx) * 4, d = ((y + PAD + py) * W + (x + PAD + px)) * 4;
        data[d] = rgb[s]; data[d + 1] = rgb[s + 1]; data[d + 2] = rgb[s + 2];
        data[d + 3] = mask ? mask[s] : 255;
      }
    }
    it.w = w; it.h = h;
    it.rect = [(x + PAD) / W, (y + PAD) / H, w / W, h / H];
  }
  return { data, w: W, h: H };
}

// ---------- geometry ----------
// Plain arrays: position, normal, aPh (u, v, MODE), aRect (atlas rect). Winding follows the normal.
export class PhotoBuilder {
  constructor() { this.pos = []; this.nor = []; this.ph = []; this.rect = []; }
  get triangles() { return this.pos.length / 9; }
  tri(p, n, t, rect, mode) { // p: 3 points [x, y, z], n: 3 normals, t: 3 [u, v]
    const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
    const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const sn = n[0][0] + n[1][0] + n[2][0], sy = n[0][1] + n[1][1] + n[2][1], sz = n[0][2] + n[1][2] + n[2][2];
    const order = cx * sn + cy * sy + cz * sz < 0 ? [0, 2, 1] : [0, 1, 2];
    for (const k of order) {
      this.pos.push(...p[k]); this.nor.push(...n[k]);
      this.ph.push(t[k][0], t[k][1], mode); this.rect.push(...rect);
    }
  }
  quad(a0, b0, b1, a1, n, ta0, tb0, tb1, ta1, rect, mode) {
    this.tri([a0, b0, b1], [n, n, n], [ta0, tb0, tb1], rect, mode);
    this.tri([a0, b1, a1], [n, n, n], [ta0, tb1, ta1], rect, mode);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aPh', new THREE.Float32BufferAttribute(this.ph, 3));
    g.setAttribute('aRect', new THREE.Float32BufferAttribute(this.rect, 4));
    g.computeBoundingSphere();
    return g;
  }
}

// Adds the photo walls (and domes) of one building; returns the set of outer-ring edges it covered, which
// the procedural wall builder then skips. items: this building's entries from loadPhotoFacades().
export function addPhotoBuilding(pb, b, items, base = 0) {
  const ring = ringOf(b.p);
  const n = ring.length;
  const handled = new Set();
  const wall = items.find((it) => it.entry.wall);
  const tileW = wall ? wall.entry.wall : 1;
  const tileH = wall ? (tileW * wall.h) / wall.w : 1;
  const wallTop = wall ? wall.entry.top || tileH : b.h;
  // arc length along the ring: a continuous u for the repeating wall tile
  const S = [0];
  for (let i = 0; i < n; i++) S.push(S[i] + edgeOf(ring, i).len);
  const tilePiece = (e, t0, t1) => {
    if (!wall) return false;
    const p0 = at(e, t0), p1 = at(e, t1);
    const u0 = (S[e.i] + t0) / tileW, u1 = (S[e.i] + t1) / tileW, v = wallTop / tileH;
    pb.quad([p0[0], base, p0[1]], [p1[0], base, p1[1]], [p1[0], base + wallTop, p1[1]], [p0[0], base + wallTop, p0[1]], [e.n[0], 0, e.n[1]],
      [u0, 0], [u1, 0], [u1, v], [u0, v], wall.rect, MODE.TILE);
    return true;
  };
  for (const it of items) {
    if (it.entry.wall) continue;
    const pl = photoPlacement(ring, it.entry);
    const top = (pl.width * it.h) / it.w;                      // the image's top edge, metres above ground
    const lathe = it.entry.lathe && it.entry.lathe.length > 1 ? it.entry.lathe : null;
    const h = lathe ? lathe[0][0] : top;
    const vTop = h / top;
    const clampU = (u) => Math.min(pl.s1, Math.max(pl.s0, u));
    for (const e of pl.edges) {
      const ua = pl.u(e.a[0], e.a[1]), ub = pl.u(e.b[0], e.b[1]);
      if (!e.face) {
        // a jog across the photo plane (the side of a projecting block): the facade of that block wraps
        // round the corner — from its edge at the front corner, deeper into it towards the back corner
        const s = Math.sign(e.n[0] * pl.right[0] + e.n[1] * pl.right[1]);
        const uc = (ua + ub) / 2;
        handled.add(e.i);
        if ((uc - s * JOG_INSET < pl.s0 || uc - s * JOG_INSET > pl.s1) && tilePiece(e, 0, e.len)) continue;
        const fOuter = pl.frac(clampU(uc - s * JOG_INSET)), fInner = pl.frac(clampU(uc - s * (JOG_INSET + Math.min(e.len, JOG_WRAP))));
        const toCam = (p) => -(p[0] * pl.view[0] + p[1] * pl.view[1]);
        const [fa, fb] = toCam(e.a) >= toCam(e.b) ? [fOuter, fInner] : [fInner, fOuter];
        pb.quad([e.a[0], base, e.a[1]], [e.b[0], base, e.b[1]], [e.b[0], base + h, e.b[1]], [e.a[0], base + h, e.a[1]], [e.n[0], 0, e.n[1]],
          [fa, 0], [fb, 0], [fb, vTop], [fa, vTop], it.rect, MODE.PHOTO);
        continue;
      }
      // a face: split where the span ends and at the "align" knots, photo inside the span, tile outside
      // (no tile: the photo's edge column, so the procedural wall never overlaps the photo)
      handled.add(e.i);
      const cuts = [0, e.len];
      for (const uk of [pl.s0, pl.s1, ...pl.knots]) {
        const t = ((uk - ua) / (ub - ua)) * e.len;
        if (t > 0.01 && t < e.len - 0.01) cuts.push(t);
      }
      cuts.sort((p, q) => p - q);
      for (let k = 0; k < cuts.length - 1; k++) {
        const t0 = cuts[k], t1 = cuts[k + 1];
        const u0 = ua + ((ub - ua) * t0) / e.len, u1 = ua + ((ub - ua) * t1) / e.len, um = (u0 + u1) / 2;
        if ((um < pl.s0 || um > pl.s1) && tilePiece(e, t0, t1)) continue;
        const p0 = at(e, t0), p1 = at(e, t1), f0 = pl.frac(clampU(u0)), f1 = pl.frac(clampU(u1));
        pb.quad([p0[0], base, p0[1]], [p1[0], base, p1[1]], [p1[0], base + h, p1[1]], [p0[0], base + h, p0[1]], [e.n[0], 0, e.n[1]],
          [f0, 0], [f1, 0], [f1, vTop], [f0, vTop], it.rect, MODE.PHOTO);
      }
    }
    if (lathe) addLathe(pb, pl, lathe, top, it.rect, it.entry.mirror, base);
  }
  if (wall) for (let i = 0; i < n; i++) if (!handled.has(i)) { const e = edgeOf(ring, i); tilePiece(e, 0, e.len); handled.add(i); }
  return handled;
}
const at = (e, t) => [e.a[0] + e.dir[0] * t, e.a[1] + e.dir[1] * t];

// A dome: the profile [[y, r], ...] turned around the walls' circle, textured by the same photo projected
// along the camera's view (like the walls below it). No sky mask: the geometry is the shape. With
// "mirror": x (0..1, the dome's axis in the photo) only the photo's left half is used, mirrored.
function addLathe(pb, pl, profile, top, rect, mirror, base = 0) {
  const { c, r } = pl.circle;
  const s = r / profile[0][1];
  const P = profile.map(([y, pr]) => [y, pr * s]);
  const ring = (k, j) => {
    const a = (j / LATHE_SEG) * Math.PI * 2, [y, pr] = P[k];
    return [c[0] + Math.cos(a) * pr, base + y, c[1] + Math.sin(a) * pr];
  };
  const axis = mirror ?? pl.frac((pl.u(c[0] + r * pl.right[0], c[1] + r * pl.right[1]) + pl.u(c[0] - r * pl.right[0], c[1] - r * pl.right[1])) / 2);
  const uv = (p) => {
    const f = axis + (pl.frac(pl.u(p[0], p[2])) - axis) * LATHE_INSET; // a little inside the silhouette: no sky
    return [mirror ? mirror - Math.abs(f - mirror) : f, (p[1] - base) / top];
  };
  for (let k = 0; k < P.length - 1; k++) {
    const dy = P[k + 1][0] - P[k][0], dr = P[k + 1][1] - P[k][1], l = Math.hypot(dy, dr) || 1;
    const nr = dy / l, ny = -dr / l;                        // profile normal: outwards and up
    for (let j = 0; j < LATHE_SEG; j++) {
      const a0 = (j / LATHE_SEG) * Math.PI * 2, a1 = ((j + 1) / LATHE_SEG) * Math.PI * 2;
      const n0 = [Math.cos(a0) * nr, ny, Math.sin(a0) * nr], n1 = [Math.cos(a1) * nr, ny, Math.sin(a1) * nr];
      const p00 = ring(k, j), p01 = ring(k, j + 1), p10 = ring(k + 1, j), p11 = ring(k + 1, j + 1);
      if (P[k][1] > 0.01) pb.tri([p00, p01, p11], [n0, n1, n1], [uv(p00), uv(p01), uv(p11)], rect, MODE.SOLID);
      if (P[k + 1][1] > 0.01 || P[k][1] > 0.01) pb.tri([p00, p11, p10], [n0, n1, n0], [uv(p00), uv(p11), uv(p10)], rect, MODE.SOLID);
    }
  }
}

// ---------- material ----------
// MeshLambertMaterial (same lighting and fog as the city) that takes its colour from the atlas.
// Walls stick out above the roof (towers, gables): double-sided, the back a little darker.
export function photoMaterial(texture) {
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uAtlas = { value: texture };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aPh;\nattribute vec4 aRect;\nvarying vec3 vPh;\nflat varying vec4 vRect;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPh = aPh; vRect = aRect;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uAtlas;\nvarying vec3 vPh;\nflat varying vec4 vRect;')
      .replace('#include <map_fragment>', /* glsl */ `
        // u repeats for wall tiles (gradients of the unwrapped u: no seam in the mip level), v is clamped
        vec2 t = vPh.xy;
        float u = abs(vPh.z - 1.0) < 0.5 ? fract(t.x) : clamp(t.x, 0.0, 1.0);
        vec2 uv = vRect.xy + vec2(u, 1.0 - clamp(t.y, 0.0, 1.0)) * vRect.zw;
        vec2 gx = vec2(dFdx(t.x), -dFdx(t.y)) * vRect.zw, gy = vec2(dFdy(t.x), -dFdy(t.y)) * vRect.zw;
        vec4 ph = textureGrad(uAtlas, uv, gx, gy);
        if (vPh.z > 1.5) ph.a = 1.0;   // domes: no sky mask
        diffuseColor *= ph;
        if (!gl_FrontFacing) diffuseColor.rgb *= 0.6;`);
  };
  mat.customProgramCacheKey = () => 'photoFacade';
  return mat;
}
