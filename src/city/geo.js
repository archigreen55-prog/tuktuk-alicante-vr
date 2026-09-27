// Small geometry helpers shared by the city builder.
import * as THREE from 'three';

export function pairs(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

// Shoelace area in the (x, z) plane, treating z as the math "y" axis.
export function orient(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// Accumulates flat-shaded, vertex-coloured triangles into one BufferGeometry.
export class GeoBuilder {
  // aux: optional extra per-vertex attributes, e.g. { aWall: 4, aBld: 1 } (name -> item size)
  constructor(aux = null) {
    this.pos = []; this.nor = []; this.col = [];
    this.auxSize = aux; this.aux = {};
    if (aux) for (const k of Object.keys(aux)) this.aux[k] = [];
  }
  get triangles() { return this.pos.length / 9; }

  // a, b, c: [x, y, z]; n: desired face normal. Winding is fixed up to match n.
  // aux: { name: value } where value is one array (same for the 3 vertices) or [va, vb, vc].
  tri(a, b, c, n, ca, cb = ca, cc = ca, aux = null) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const swap = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    if (swap) { const t = b; b = c; c = t; const tc = cb; cb = cc; cc = tc; }
    const P = this.pos, N = this.nor, C = this.col;
    P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    N.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
    C.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
    if (this.auxSize) {
      for (const k of Object.keys(this.auxSize)) {
        const v = aux && aux[k];
        const arr = this.aux[k], size = this.auxSize[k];
        const perVertex = v && Array.isArray(v[0]);
        for (let vi = 0; vi < 3; vi++) {
          let idx = vi;
          if (swap && vi > 0) idx = vi === 1 ? 2 : 1;
          const src = perVertex ? v[idx] : v;
          for (let s = 0; s < size; s++) arr.push(src ? src[s] : 0);
        }
      }
    }
  }

  // Flat polygon (with optional holes) at height y, facing up.
  polygon(ring, holes, y, col, aux = null) {
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const hs = (holes || []).map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
    const all = contour.concat(...hs);
    const faces = THREE.ShapeUtils.triangulateShape(contour, hs);
    const up = [0, 1, 0];
    for (const [i, j, k] of faces) {
      this.tri([all[i].x, y, all[i].y], [all[j].x, y, all[j].y], [all[k].x, y, all[k].y], up, col, col, col, aux);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.auxSize) for (const [k, size] of Object.entries(this.auxSize)) g.setAttribute(k, new THREE.Float32BufferAttribute(this.aux[k], size));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Deterministic pseudo-random in [0, 1) from an integer.
export function rand(i) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
