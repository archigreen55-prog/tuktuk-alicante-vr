// Smashable street things of Crazy Tuk (0.15.0): traffic cones, terrace tables, bins, beach umbrellas stand along the route
// (data/smashables.json from tools/place-smashables.mjs). Driving through one smashes it: a few euros, a puff of debris, a little speed lost,
// no wall hit (the tuk-tuk is never stopped). Four instanced meshes (one draw call per type) + one for the debris (a pool of 56 pieces
// flying on a simple arc); the test of a hit is a distance to the tuk-tuk's axis in a 10 m grid. Everything respawns at a new run.
import * as THREE from 'three';

const TYPES = {
  c: { name: 'конус', radius: 0.28, tips: 1, slow: 0.992, pieces: 4, color: 0xff6a1a },
  b: { name: 'смітник', radius: 0.38, tips: 2, slow: 0.97, pieces: 6, color: 0x2e7d4f },
  t: { name: 'столик', radius: 1.0, tips: 3, slow: 0.965, pieces: 9, color: 0xe9d8b8 },
  u: { name: 'парасоля', radius: 0.55, tips: 2, slow: 0.98, pieces: 6, color: 0xe63946 },
};
const MAX_DEBRIS = 56, MIN_SPEED = 3, BODY_R = 0.72, CELL = 10;

// low-poly models (metres), coloured by vertex colours, merged into one geometry per type
function merge(parts) {
  const pos = [], col = [], idx = [];
  let base = 0;
  for (const { geo, color, x = 0, y = 0, z = 0 } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo; g.translate(x, y, z);
    const p = g.attributes.position, c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); col.push(c.r, c.g, c.b); idx.push(base + i); }
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}
const cyl = (r0, r1, h, n = 8) => new THREE.CylinderGeometry(r1, r0, h, n);
function models() {
  const cone = merge([
    { geo: new THREE.BoxGeometry(0.4, 0.04, 0.4), color: 0x333333, y: 0.02 },
    { geo: cyl(0.16, 0.04, 0.62), color: 0xff6a1a, y: 0.35 },
    { geo: cyl(0.115, 0.085, 0.1), color: 0xffffff, y: 0.3 },
  ]);
  const bin = merge([
    { geo: cyl(0.3, 0.27, 0.9, 10), color: 0x2e7d4f, y: 0.45 },
    { geo: cyl(0.31, 0.31, 0.06, 10), color: 0x1b4d30, y: 0.93 },
  ]);
  const chair = (x, z, a) => [
    { geo: new THREE.BoxGeometry(0.42, 0.05, 0.42), color: 0xb5532f, x, y: 0.45, z },
    { geo: new THREE.BoxGeometry(0.42, 0.45, 0.05), color: 0xb5532f, x: x + Math.sin(a) * 0.19, y: 0.7, z: z + Math.cos(a) * 0.19 },
    { geo: new THREE.BoxGeometry(0.05, 0.45, 0.05), color: 0x333333, x, y: 0.22, z },
  ];
  const table = merge([
    { geo: cyl(0.5, 0.5, 0.05, 14), color: 0xf2e6d0, y: 0.73 },
    { geo: cyl(0.04, 0.04, 0.72), color: 0x333333, y: 0.36 },
    { geo: cyl(0.25, 0.25, 0.03, 10), color: 0x333333, y: 0.015 },
    ...chair(0.78, 0, Math.PI / 2), ...chair(-0.78, 0, -Math.PI / 2), ...chair(0, 0.78, 0),
  ]);
  const canopy = new THREE.ConeGeometry(1.15, 0.42, 12, 1, true).toNonIndexed();
  const cc = []; for (let i = 0; i < canopy.attributes.position.count / 3; i++) { const c = new THREE.Color(i % 2 ? 0xffffff : 0xe63946); for (let k = 0; k < 3; k++) cc.push(c.r, c.g, c.b); }
  canopy.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3)); canopy.translate(0, 2.05, 0);
  const pole = merge([{ geo: cyl(0.03, 0.03, 2.1, 6), color: 0xdddddd, y: 1.05 }, { geo: new THREE.BoxGeometry(1.4, 0.04, 0.6), color: 0x3a86ff, x: 0.9, y: 0.03, z: 0.2 }]);
  // the umbrella = the pole + a towel (merged) and the canopy: one geometry
  const um = new THREE.BufferGeometry();
  const pa = pole.attributes, ca = canopy.attributes, n1 = pa.position.count, n2 = ca.position.count;
  const P = new Float32Array((n1 + n2) * 3), C = new Float32Array((n1 + n2) * 3);
  P.set(pa.position.array, 0); P.set(ca.position.array, n1 * 3); C.set(pa.color.array, 0); C.set(ca.color.array, n1 * 3);
  um.setAttribute('position', new THREE.BufferAttribute(P, 3)); um.setAttribute('color', new THREE.BufferAttribute(C, 3)); um.computeVertexNormals();
  return { c: cone, b: bin, t: table, u: um };
}

export class Smashables {
  constructor(scene, groundY) {
    this.scene = scene; this.groundY = groundY; this.group = new THREE.Group(); this.group.name = 'smashables';
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.items = []; this.meshes = {}; this.grid = new Map(); this.on = false;
    // debris: unit boxes, one instanced mesh, a pool
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), MAX_DEBRIS);
    this.debris.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DEBRIS * 3), 3);
    this.debris.frustumCulled = false;
    this.deb = Array.from({ length: MAX_DEBRIS }, () => ({ t: 9, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0.1, rx: 0, ry: 0 }));
    this.dummy = new THREE.Object3D(); this.col = new THREE.Color(); this.di = 0;
    this.group.add(this.debris); scene.add(this.group); this.group.visible = false;
    this.models = null;
  }

  // list: [[type, x, z, rotation], ...]
  load(list) {
    this.dispose();
    this.models ||= models();
    const by = { c: [], b: [], t: [], u: [] };
    list.forEach(([t, x, z, rot]) => { if (by[t]) by[t].push({ t, x, z, rot, alive: true }); });
    for (const t of Object.keys(by)) {
      const arr = by[t]; if (!arr.length) continue;
      const mesh = new THREE.InstancedMesh(this.models[t], this.mat, arr.length); mesh.frustumCulled = false; mesh.name = 'smash ' + TYPES[t].name;
      arr.forEach((it, i) => { it.mesh = mesh; it.i = i; this.place(it, true); this.items.push(it); const k = Math.floor(it.x / CELL) * 100000 + Math.floor(it.z / CELL); let c = this.grid.get(k); if (!c) this.grid.set(k, (c = [])); c.push(it); });
      this.meshes[t] = mesh; this.group.add(mesh);
    }
    this.count = this.items.length;
  }
  place(it, alive) {
    const d = this.dummy; d.position.set(it.x, this.groundY(it.x, it.z), it.z); d.rotation.set(0, it.rot, 0); d.scale.setScalar(alive ? 1 : 0); d.updateMatrix();
    it.mesh.setMatrixAt(it.i, d.matrix); it.mesh.instanceMatrix.needsUpdate = true;
  }
  enable(on) { this.on = on; this.group.visible = on && this.items.length > 0; }
  reset() { for (const it of this.items) if (!it.alive) { it.alive = true; this.place(it, true); } for (const d of this.deb) d.t = 9; this.flushDebris(); this.smashed = 0; }
  dispose() {
    for (const m of Object.values(this.meshes)) { this.group.remove(m); m.dispose(); }
    this.meshes = {}; this.items = []; this.grid.clear(); this.count = 0;
  }

  // x, z: the tuk-tuk; heading; vx, vz: its velocity (m/s); dt. Returns the things smashed this frame: [{ t, x, z }]
  update(dt, x, z, heading, vx, vz) {
    const out = [];
    if (this.on) {
      const sp = Math.hypot(vx, vz);
      if (sp >= MIN_SPEED) {
        const fx = -Math.sin(heading), fz = -Math.cos(heading), x0 = x - fx * 1.6, z0 = z - fz * 1.6, x1 = x + fx * 1.35, z1 = z + fz * 1.35;   // the body's axis: the rear to the nose
        const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
        for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
          const cell = this.grid.get(i * 100000 + j); if (!cell) continue;
          for (const it of cell) {
            if (!it.alive) continue;
            const T = TYPES[it.t], ex = x1 - x0, ez = z1 - z0, l2 = ex * ex + ez * ez;
            let u = ((it.x - x0) * ex + (it.z - z0) * ez) / l2; u = u < 0 ? 0 : u > 1 ? 1 : u;
            if (Math.hypot(it.x - x0 - ex * u, it.z - z0 - ez * u) < BODY_R + T.radius) { it.alive = false; this.place(it, false); this.burst(it, vx, vz); out.push({ t: it.t, x: it.x, z: it.z }); }
          }
        }
      }
    }
    this.stepDebris(dt);
    return out;
  }

  burst(it, vx, vz) {
    const T = TYPES[it.t], y0 = this.groundY(it.x, it.z) + 0.4;
    for (let k = 0; k < T.pieces; k++) {
      const d = this.deb[this.di]; this.di = (this.di + 1) % MAX_DEBRIS;
      const a = Math.random() * 6.28, sp = 1.5 + Math.random() * 3.5;
      d.t = 0; d.life = 1.2 + Math.random() * 0.8; d.x = it.x + (Math.random() - 0.5) * 0.4; d.y = y0 + Math.random() * 0.5; d.z = it.z + (Math.random() - 0.5) * 0.4;
      d.vx = vx * 0.7 + Math.cos(a) * sp; d.vy = 3 + Math.random() * 4; d.vz = vz * 0.7 + Math.sin(a) * sp;
      d.s = 0.08 + Math.random() * (it.t === 't' ? 0.2 : 0.14); d.rx = Math.random() * 6; d.ry = Math.random() * 6;
      this.col.setHex(it.t === 't' && k % 3 === 0 ? 0xb5532f : it.t === 'u' && k % 2 ? 0xffffff : T.color); this.debris.setColorAt(this.deb.indexOf(d), this.col);
    }
    this.debris.instanceColor.needsUpdate = true; this.smashed = (this.smashed || 0) + 1;
  }
  stepDebris(dt) {
    let any = false; const D = this.dummy;
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const d = this.deb[i];
      if (d.t >= d.life) { if (d.s !== 0) { d.s = 0; D.scale.setScalar(0); D.position.set(0, -50, 0); D.updateMatrix(); this.debris.setMatrixAt(i, D.matrix); any = true; } continue; }
      d.t += dt; d.vy -= 12 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const g = this.groundY(d.x, d.z) + d.s * 0.5;
      if (d.y < g) { d.y = g; d.vy = -d.vy * 0.35; d.vx *= 0.6; d.vz *= 0.6; }
      const k = Math.min(1, (d.life - d.t) / 0.4);
      D.position.set(d.x, d.y, d.z); D.rotation.set(d.t * d.rx * 3, d.t * d.ry * 3, 0); D.scale.setScalar(d.s * k); D.updateMatrix(); this.debris.setMatrixAt(i, D.matrix); any = true;
    }
    if (any) this.debris.instanceMatrix.needsUpdate = true;
  }
  flushDebris() { const D = this.dummy; D.scale.setScalar(0); D.updateMatrix(); for (let i = 0; i < MAX_DEBRIS; i++) this.debris.setMatrixAt(i, D.matrix); this.debris.instanceMatrix.needsUpdate = true; }
}
export { TYPES as SMASH_TYPES };
