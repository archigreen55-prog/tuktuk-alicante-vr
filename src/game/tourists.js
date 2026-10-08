// Tourists (stage 6): 2-4 low-poly figures in one SkinnedMesh (1 draw call), ~11 bones each, posed
// by code (no animation files). They wait standing beside the road, walk to the tuk-tuk and take the
// passenger seats, and at the finish get off and walk away. A figure's root bone hangs under the
// world (standing / walking) or under the tuk-tuk group (seated), so seated tourists ride along.
// Stage 6a: poses only; the living reactions (sway, looks, photos, claps) come in 6b.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xf3d2b3];
const SHIRT = [0xe63946, 0x2a9d8f, 0xf4a261, 0x457b9d, 0xf8f8f2, 0xf72585, 0x90be6d, 0xffd166, 0x6d597a];
const LEGS = [0x264653, 0xe9c46a, 0x6c757d, 0x1d3557, 0xa8dadc, 0xf1faee, 0x3d405b];
const HAIR = [0x2b1d14, 0x4a3222, 0x8c6239, 0xd8b36a, 0x9a9a9a, 0x1a1a1a];
const HAT = [0xe9d8a6, 0xf8f8f2, 0x1d3557, 0xe63946, 0x2a9d8f];
const SHOES = [0xf8f8f2, 0x3a2a20, 0x1a1a1a, 0x457b9d];
const WALK_SPEED = 1.2;          // m/s
const HOP_TIME = 0.4;            // s from the door onto the seat
// bones of one figure (index within the figure)
const B = { root: 0, hips: 1, spine: 2, head: 3, lArm: 4, lFore: 5, rArm: 6, rFore: 7, lThigh: 8, lShin: 9, rThigh: 10, rShin: 11 };
const NB = 12;

function pick(arr, r) { return arr[Math.floor(r * arr.length) % arr.length]; }

// one figure's geometry (bind pose: standing, facing -z, feet at y = 0) with skinIndex = base + bone
function figureGeometry(s, look, base) {
  const parts = [];
  const add = (geo, color, bone, x, y, z) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    g.translate(x * s, y * s, z * s);
    const n = g.attributes.position.count, col = new THREE.Color(color);
    const c = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; si[i * 4] = base + bone; sw[i * 4] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    parts.push(g);
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w * s, h * s, d * s);
  const cyl = (r0, r1, h, n = 7) => new THREE.CylinderGeometry(r1 * s, r0 * s, h * s, n);
  // legs (thigh 0.92 -> 0.5, shin 0.5 -> 0.08), shoes
  for (const [side, thigh, shin] of [[-1, B.lThigh, B.lShin], [1, B.rThigh, B.rShin]]) {
    add(cyl(0.075, 0.065, 0.42), look.legs, thigh, side * 0.1, 0.71, 0);
    const shinGeo = cyl(0.06, 0.05, 0.42);
    add(shinGeo, look.shorts ? look.skin : look.legs, shin, side * 0.1, 0.29, 0);
    add(box(0.1, 0.07, 0.24), look.shoes, shin, side * 0.1, 0.035, -0.04);
  }
  add(box(0.34, 0.18, 0.21), look.legs, B.hips, 0, 0.95, 0);            // pelvis
  add(box(0.37, 0.5, 0.22), look.shirt, B.spine, 0, 1.28, 0);            // torso
  if (look.bag) add(box(0.26, 0.3, 0.1), look.bag, B.spine, 0, 1.3, 0.16); // backpack
  add(cyl(0.05, 0.05, 0.08, 6), look.skin, B.head, 0, 1.56, 0);           // neck
  add(new THREE.IcosahedronGeometry(0.115 * s, 1), look.skin, B.head, 0, 1.69, 0);
  add(new THREE.SphereGeometry(0.12 * s, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.2), look.hair, B.head, 0, 1.7, 0.012);
  if (look.hat === 'sun') { add(cyl(0.2, 0.2, 0.015, 12), look.hatColor, B.head, 0, 1.79, 0); add(cyl(0.1, 0.12, 0.09, 10), look.hatColor, B.head, 0, 1.83, 0); }
  else if (look.hat === 'cap') { add(cyl(0.12, 0.12, 0.07, 10), look.hatColor, B.head, 0, 1.8, 0); add(box(0.14, 0.015, 0.12), look.hatColor, B.head, 0, 1.775, -0.12); }
  if (look.glasses) add(box(0.2, 0.035, 0.03), 0x111111, B.head, 0, 1.71, -0.105);
  // arms: upper 1.45 -> 1.16, forearm 1.16 -> 0.9, hand
  for (const [side, arm, fore] of [[-1, B.lArm, B.lFore], [1, B.rArm, B.rFore]]) {
    add(cyl(0.05, 0.045, 0.3), look.sleeves ? look.shirt : look.skin, arm, side * 0.235, 1.3, 0);
    add(cyl(0.043, 0.038, 0.26), look.skin, fore, side * 0.235, 1.03, 0);
    add(box(0.07, 0.09, 0.05), look.skin, fore, side * 0.235, 0.86, 0);
  }
  if (look.camera) add(box(0.1, 0.07, 0.05), 0x222222, B.spine, 0.05, 1.18, -0.13);
  return parts;
}

// bones of one figure in bind pose (root on the ground under the figure)
function figureBones(s) {
  const b = [];
  for (let i = 0; i < NB; i++) b.push(new THREE.Bone());
  const set = (i, parent, x, y, z) => { b[i].position.set(x * s, y * s, z * s); if (parent !== null) b[parent].add(b[i]); };
  set(B.root, null, 0, 0, 0);
  set(B.hips, B.root, 0, 0.95, 0);
  set(B.spine, B.hips, 0, 0.05, 0);
  set(B.head, B.spine, 0, 0.5, 0);
  set(B.lArm, B.spine, -0.235, 0.45, 0); set(B.lFore, B.lArm, 0, -0.29, 0);
  set(B.rArm, B.spine, 0.235, 0.45, 0); set(B.rFore, B.rArm, 0, -0.29, 0);
  set(B.lThigh, B.hips, -0.1, -0.03, 0); set(B.lShin, B.lThigh, 0, -0.42, 0);
  set(B.rThigh, B.hips, 0.1, -0.03, 0); set(B.rShin, B.rThigh, 0, -0.42, 0);
  return b;
}

export class Tourists {
  // world: Object3D for standing figures (the scene); vehicle: the tuk-tuk group; seats: SEATS (tuk-tuk frame)
  // groundY(x, z): ground height for standing / walking figures
  constructor(world, vehicle, seats, groundY = () => 0) {
    this.world = world; this.vehicle = vehicle; this.seats = seats; this.groundY = groundY;
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = null; this.figs = [];
    this.ride = { lat: 0, lon: 0, kmh: 0 }; this.latS = 0; this.lonS = 0;   // the ride the seated ones feel (set by the game every frame)
    this.live = false;  // Crazy Tuk only: the seated ones follow the ride and react (the real tour keeps its still poses)
    this.mood = null;   // { kind, t, dur }: a reaction of the passengers (Crazy Tuk)
    this.tmpV = new THREE.Vector3(); this.tmpQ = new THREE.Quaternion();
  }

  // New group of `count` tourists standing at pos [x, z] (row along the road), facing [fx, fz]
  setup(count, pos, facing) {
    this.dispose();
    const figs = [], geos = [], bones = [];
    const along = [-facing[1], facing[0]];
    for (let i = 0; i < count; i++) {
      const r = Math.random;
      const s = 0.92 + Math.random() * 0.16;
      const look = {
        skin: pick(SKIN, r()), shirt: pick(SHIRT, r()), legs: pick(LEGS, r()), hair: pick(HAIR, r()), shoes: pick(SHOES, r()),
        shorts: r() < 0.55, sleeves: r() < 0.35, glasses: r() < 0.5, camera: r() < 0.35, bag: r() < 0.3 ? pick([0x3d405b, 0xe07a5f, 0x81b29a], r()) : 0,
        hat: r() < 0.35 ? 'sun' : r() < 0.55 ? 'cap' : '', hatColor: pick(HAT, r()),
      };
      const fb = figureBones(s);
      fb[0].updateMatrixWorld(true);
      geos.push(...figureGeometry(s, look, i * NB));
      bones.push(...fb);
      const off = (i - (count - 1) / 2) * 0.85;
      const stand = [pos[0] + along[0] * off, pos[1] + along[1] * off];
      figs.push({ bones: fb, root: fb[0], s, stand, state: 'stand', t: 0, seat: this.seats[i], path: null });
    }
    const geo = mergeGeometries(geos);
    const skeleton = new THREE.Skeleton(bones);
    this.mesh = new THREE.SkinnedMesh(geo, this.mat);
    this.mesh.name = 'tourists';
    this.mesh.frustumCulled = false;
    this.mesh.bind(skeleton, new THREE.Matrix4());
    this.world.add(this.mesh);
    this.facing = facing;
    this.figs = figs;
    for (const f of figs) this.standAt(f);
  }

  dispose() {
    if (this.mesh) { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.skeleton.dispose(); this.mesh = null; }
    for (const f of this.figs) f.root.removeFromParent();
    this.figs = [];
  }
  set visible(v) { if (this.mesh) this.mesh.visible = v; }

  standAt(f) {
    this.world.add(f.root);
    f.root.position.set(f.stand[0], this.groundY(f.stand[0], f.stand[1]), f.stand[1]);
    f.root.rotation.set(0, Math.atan2(-this.facing[0], -this.facing[1]), 0);
    f.state = 'stand';
    pose(f, 'stand', 0);
  }

  // walk to the tuk-tuk side next to the own seat, then hop in
  board() {
    this.side = this.sideOf(this.figs.length ? this.figs[0].stand : [0, 0]);
    for (const f of this.figs) {
      const doorLocal = this.doorLocal(f);
      const door = this.vehicle.localToWorld(this.tmpV.set(doorLocal.x, 0, doorLocal.z)).clone();
      f.path = { from: [f.root.position.x, f.root.position.z], to: [door.x, door.z] };
      f.state = 'walkIn'; f.t = 0;
    }
  }
  abortBoard() { for (const f of this.figs) this.standAt(f); }
  seatAll() { for (const f of this.figs) this.sit(f); }

  // Crazy Tuk: the passengers react ('cheer' | 'laugh' | 'scream' | 'gasp'); the voice is the game's (arcadeSound), this is the body
  react(kind) { const dur = { cheer: 1.8, laugh: 1.6, scream: 1.8, gasp: 1.0 }[kind] || 1.2; this.mood = { kind, t: 0, dur }; }
  // lateral / longitudinal acceleration (m/s², + lateral = to the left of the tuk-tuk) and the speed, from the physics
  setRide(lat, lon, kmh) { this.ride.lat = lat; this.ride.lon = lon; this.ride.kmh = kmh; }
  // seated: the body follows the ride and the mood (arms up, head back, shoulders shaking)
  animateSeated(f, dt, i) {
    const b = f.bones, k = 1 - Math.exp(-dt * 6);
    this.latS += (this.ride.lat - this.latS) * k; this.lonS += (this.ride.lon - this.lonS) * k;
    pose(f, 'sit', 0);
    const ph = i * 1.7, c = (v, a) => Math.max(-a, Math.min(a, v));
    b[B.spine].rotation.z = c(this.latS * 0.018, 0.3);
    b[B.spine].rotation.x = 0.06 + c(this.lonS * 0.02, 0.3);
    b[B.head].rotation.z = -b[B.spine].rotation.z * 0.6;
    b[B.head].rotation.x = -c(this.lonS * 0.012, 0.2) + Math.sin(f.t * 31 + ph) * 0.012 * Math.min(1.5, this.ride.kmh / 100);
    const m = this.mood;
    if (m) {
      const a = Math.min(1, m.t / 0.15, (m.dur - m.t) / 0.3), w = Math.max(0, a);   // quick in, softer out
      if (m.kind === 'cheer' || m.kind === 'scream') {
        const up = m.kind === 'cheer' ? -2.9 : -2.5, wave = Math.sin(f.t * 14 + ph) * 0.25;
        b[B.lArm].rotation.x = b[B.rArm].rotation.x = (b[B.lArm].rotation.x) * (1 - w) + (up + wave) * w;
        b[B.lArm].rotation.z = -0.2 * w; b[B.rArm].rotation.z = 0.2 * w;
        b[B.lFore].rotation.x = b[B.rFore].rotation.x = 0.3 * (1 - w) + 0.15 * w;
        b[B.head].rotation.x -= 0.3 * w; b[B.spine].rotation.x += 0.08 * w;
      } else if (m.kind === 'laugh') {
        b[B.spine].rotation.x += Math.sin(f.t * 20 + ph) * 0.07 * w; b[B.head].rotation.x -= (0.25 + Math.sin(f.t * 20 + ph) * 0.05) * w;
        b[B.lArm].rotation.x = b[B.rArm].rotation.x = 0.35 + 0.5 * w;   // hands to the belly
      } else if (m.kind === 'gasp') {
        b[B.lArm].rotation.x = b[B.rArm].rotation.x = 0.35 - 1.1 * w; b[B.lFore].rotation.x = b[B.rFore].rotation.x = 0.9 + 0.9 * w;
        b[B.head].rotation.x -= 0.18 * w; b[B.spine].rotation.x += 0.12 * w;
      }
    }
  }

  // get off at the finish and walk to `goal` [x, z], then disappear
  dropOff(goal) {
    this.side = this.sideOf(goal);
    for (const f of this.figs) {
      const d = this.doorLocal(f);
      const door = this.vehicle.localToWorld(this.tmpV.set(d.x, 0, d.z)).clone();
      this.world.add(f.root);
      f.root.position.set(door.x, this.groundY(door.x, door.z), door.z);
      const dx = goal[0] - door.x, dz = goal[1] - door.z, L = Math.hypot(dx, dz) || 1;
      const walk = Math.min(8, L);
      f.path = { from: [door.x, door.z], to: [door.x + dx / L * walk + (Math.random() - 0.5), door.z + dz / L * walk + (Math.random() - 0.5)] };
      f.state = 'walkOut'; f.t = -Math.random() * 0.4;
    }
  }

  // the tuk-tuk side (-1 left, +1 right) a world point [x, z] is on
  sideOf(p) { return this.vehicle.worldToLocal(this.tmpV.set(p[0], 0, p[1])).x < 0 ? -1 : 1; }
  doorLocal(f) { return { x: (this.side || 1) * 1.05, z: f.seat.z }; }

  sit(f) {
    this.vehicle.add(f.root);
    f.root.position.set(f.seat.x, f.seat.y - 0.95 * f.s + 0.03, f.seat.z);
    f.root.rotation.set(0, 0, 0);
    f.state = 'seated';
    pose(f, 'sit', 0);
  }

  update(dt) {
    if (this.mood) { this.mood.t += dt; if (this.mood.t >= this.mood.dur) this.mood = null; }
    for (const f of this.figs) {
      f.t += dt;
      if (f.state === 'walkIn' || f.state === 'walkOut') {
        if (f.t < 0) continue;
        const [x0, z0] = f.path.from, [x1, z1] = f.path.to;
        const L = Math.hypot(x1 - x0, z1 - z0), T = Math.max(0.3, L / WALK_SPEED);
        const k = Math.min(1, f.t / T);
        const wx = x0 + (x1 - x0) * k, wz = z0 + (z1 - z0) * k;
        f.root.position.set(wx, this.groundY(wx, wz), wz);
        if (L > 0.05) f.root.rotation.set(0, Math.atan2(-(x1 - x0), -(z1 - z0)), 0);
        pose(f, 'walk', f.t * 7);
        if (k >= 1) {
          if (f.state === 'walkIn') { f.state = 'hop'; f.t = 0; this.vehicle.add(f.root); const d = this.doorLocal(f); f.root.position.set(d.x, 0, d.z); }
          else { f.state = 'gone'; f.root.visible = false; }
        }
      } else if (f.state === 'seated' && this.live) {
        this.animateSeated(f, dt, this.figs.indexOf(f));
      } else if (f.state === 'hop') {
        const k = Math.min(1, f.t / HOP_TIME), d = this.doorLocal(f);
        const y = f.seat.y - 0.95 * f.s + 0.03;
        f.root.position.set(d.x + (f.seat.x - d.x) * k, y * k + Math.sin(k * Math.PI) * 0.25, d.z + (f.seat.z - d.z) * k);
        f.root.rotation.set(0, (1 - k) * (this.side || 1) * Math.PI / 2, 0);
        pose(f, k < 0.5 ? 'walk' : 'sit', 0);
        if (k >= 1) this.sit(f);
      }
    }
    if (this.mesh && this.figs.every((f) => f.state === 'gone')) this.mesh.visible = false;
  }
}

// set bone rotations for a pose ('stand' | 'sit' | 'walk' with phase)
function pose(f, kind, phase) {
  const b = f.bones;
  for (let i = 1; i < NB; i++) b[i].rotation.set(0, 0, 0);
  b[B.lArm].rotation.z = -0.1; b[B.rArm].rotation.z = 0.1;
  if (kind === 'sit') {
    b[B.lThigh].rotation.x = b[B.rThigh].rotation.x = Math.PI / 2;     // thighs forward
    b[B.lShin].rotation.x = b[B.rShin].rotation.x = -Math.PI / 2 + 0.12; // shins down
    b[B.lThigh].rotation.z = -0.06; b[B.rThigh].rotation.z = 0.06;
    b[B.lArm].rotation.x = b[B.rArm].rotation.x = 0.35;                 // hands on the lap
    b[B.lFore].rotation.x = b[B.rFore].rotation.x = 0.9;
    b[B.spine].rotation.x = 0.06;                                        // leaning back a little
  } else if (kind === 'walk') {
    const a = Math.sin(phase) * 0.45;
    b[B.lThigh].rotation.x = a; b[B.rThigh].rotation.x = -a;
    b[B.lShin].rotation.x = -Math.max(0, -Math.sin(phase)) * 0.6; b[B.rShin].rotation.x = -Math.max(0, Math.sin(phase)) * 0.6;
    b[B.lArm].rotation.x = -a * 0.7; b[B.rArm].rotation.x = a * 0.7;
    b[B.lFore].rotation.x = b[B.rFore].rotation.x = 0.25;
  }
}
