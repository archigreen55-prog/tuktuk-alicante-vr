// The driver (0.19.0): a low-poly figure on the driver's seat, built from the same blocks as the tourists (src/game/tourists.js) in one
// SkinnedMesh with 8 bones (root, hips, spine, head, two upper arms, two forearms), posed by code every frame:
//   hands on the bar: the fists are the handlebar's own gloves (they turn with the bar); the forearms and upper arms reach them with a
//   two-bone IK, so steering shows in the arms;  corners and drifts: the body leans out, the head looks into the slide;
//   nitro: pressed back into the seat;  events: cheer (fist up), nod, hit (thrown forward), shake (head), point (the guide's hand to a landmark);
//   at rest: breathing.  In VR and in the cockpit view the body is hidden (the player sits there); the legs and the pedal stay the tuk-tuk's.
// Two looks: 'racer' (Crazy Tuk) and 'taxi' (the real tour); ~500 triangles, one draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const LOOKS = {
  racer: { skin: 0xf1c27d, shirt: 0x1f6b45, vest: 0xf2c230, trousers: 0x3a4250, hair: 0x1a1a1a, hat: 'helmet', hatColor: 0xf8f8f2, longSleeves: true },
  taxi: { skin: 0xc68642, shirt: 0xf8f8f2, trousers: 0x3a4250, hair: 0x2b1d14, hat: 'cap', hatColor: 0x1d3557, glasses: true, moustache: true },
};
const B = { root: 0, hips: 1, spine: 2, head: 3, lArm: 4, lFore: 5, rArm: 6, rFore: 7 };
const NB = 8;
// the seat and the body (tuk-tuk frame, metres): the hip point, the shoulders, the arm lengths
const HIP = new THREE.Vector3(0, 0.8, -0.02);
const SHOULDER = { x: 0.24, y: 0.5, z: -0.03 };    // from the hips
const UPPER = 0.29, FORE = 0.26;
const LEAN = -0.12;                                // rad: the torso leans forward (the figure faces -z; negative x = forward)

// bone positions of the bind pose in the tuk-tuk frame (the seated figure, arms hanging); the geometry is built in the same frame
const BIND = (() => {
  const P = {}; P[B.root] = HIP.clone(); P[B.hips] = HIP.clone(); P[B.spine] = HIP.clone().add(new THREE.Vector3(0, 0.04, 0));
  P[B.head] = P[B.spine].clone().add(new THREE.Vector3(0, 0.5, -0.03));
  P[B.lArm] = P[B.spine].clone().add(new THREE.Vector3(-SHOULDER.x, SHOULDER.y - 0.04, SHOULDER.z)); P[B.lFore] = P[B.lArm].clone().add(new THREE.Vector3(0, -UPPER, 0));
  P[B.rArm] = P[B.spine].clone().add(new THREE.Vector3(SHOULDER.x, SHOULDER.y - 0.04, SHOULDER.z)); P[B.rFore] = P[B.rArm].clone().add(new THREE.Vector3(0, -UPPER, 0));
  return P;
})();

function figure(look) {
  const parts = [];
  // a part at an offset from its bone's bind position (tuk-tuk frame), coloured, weighted to that bone
  const add = (geo, color, bone, x, y, z) => {
    const g = geo.index ? geo.toNonIndexed() : geo; g.deleteAttribute('uv');
    const o = BIND[bone]; g.translate(o.x + x, o.y + y, o.z + z);
    const n = g.attributes.position.count, col = new THREE.Color(color);
    const c = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; si[i * 4] = bone; sw[i * 4] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    parts.push(g);
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d), cyl = (r0, r1, h, n = 7) => new THREE.CylinderGeometry(r1, r0, h, n);
  add(box(0.34, 0.16, 0.22), look.trousers, B.hips, 0, 0, 0);                                 // pelvis
  add(box(0.38, 0.5, 0.22), look.shirt, B.spine, 0, 0.25, -0.03);                             // torso
  if (look.vest) add(box(0.4, 0.3, 0.24), look.vest, B.spine, 0, 0.23, -0.03);                // vest
  add(cyl(0.05, 0.05, 0.08, 6), look.skin, B.head, 0, 0.02, 0);                               // neck
  add(new THREE.IcosahedronGeometry(0.115, 1), look.skin, B.head, 0, 0.15, 0);               // head
  add(new THREE.SphereGeometry(0.12, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.2), look.hair, B.head, 0, 0.16, 0.012);
  if (look.hat === 'cap') { add(cyl(0.12, 0.12, 0.07, 10), look.hatColor, B.head, 0, 0.26, 0); add(box(0.14, 0.015, 0.12), look.hatColor, B.head, 0, 0.235, -0.12); }
  if (look.hat === 'helmet') { add(new THREE.SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI / 1.9), look.hatColor, B.head, 0, 0.16, 0); add(box(0.24, 0.07, 0.03), 0x111111, B.head, 0, 0.13, -0.125); }
  if (look.hat === 'sun') { add(cyl(0.2, 0.2, 0.015, 12), look.hatColor, B.head, 0, 0.25, 0); add(cyl(0.1, 0.12, 0.09, 10), look.hatColor, B.head, 0, 0.29, 0); }
  if (look.glasses) add(box(0.2, 0.035, 0.03), 0x111111, B.head, 0, 0.17, -0.105);
  if (look.moustache) add(box(0.09, 0.025, 0.03), look.hair, B.head, 0, 0.1, -0.105);
  // arms hang down in the bind pose: the upper arm from the shoulder, the forearm from the elbow, a small hand at the wrist (inside the glove)
  for (const [bArm, bFore] of [[B.lArm, B.lFore], [B.rArm, B.rFore]]) {
    add(cyl(0.055, 0.048, UPPER), look.shirt, bArm, 0, -UPPER / 2, 0);
    add(new THREE.SphereGeometry(0.05, 7, 5), look.shirt, bArm, 0, -UPPER, 0);
    add(cyl(0.045, 0.04, FORE), look.longSleeves ? look.shirt : look.skin, bFore, 0, -FORE / 2, 0);
    add(box(0.07, 0.08, 0.05), look.skin, bFore, 0, -FORE - 0.03, 0);
  }
  return mergeGeometries(parts);
}

function bones() {
  const b = []; for (let i = 0; i < NB; i++) b.push(new THREE.Bone());
  const parent = { [B.hips]: B.root, [B.spine]: B.hips, [B.head]: B.spine, [B.lArm]: B.spine, [B.lFore]: B.lArm, [B.rArm]: B.spine, [B.rFore]: B.rArm };
  b[B.root].position.copy(BIND[B.root]);
  for (const [i, p] of Object.entries(parent)) { b[p].add(b[i]); b[i].position.copy(BIND[i]).sub(BIND[p]); }
  return b;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const clamp = (v, a) => Math.max(-a, Math.min(a, v));

export class Driver {
  // vehicle: the tuk-tuk group; handlebar: createHandlebar()'s result (gloves ride on it)
  constructor(vehicle, handlebar) {
    this.vehicle = vehicle; this.bar = handlebar;
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = null; this.b = null; this.look = null;
    this.bodyVisible = true;       // false in VR / the cockpit view
    this.ride = { lat: 0, lon: 0, kmh: 0, slip: 0, nitro: false }; this.latS = 0; this.lonS = 0; this.slipS = 0; this.nitroS = 0;
    this.t = 0; this.fx = null;    // { kind, t, dur, side }
    this.glance = { t: 0, next: 4, v: 0 };
    this.v = new THREE.Vector3(); this.w = new THREE.Vector3();
    this.sc = { S: new THREE.Vector3(), d: new THREE.Vector3(), h: new THREE.Vector3(), E: new THREE.Vector3(), T: new THREE.Vector3(), u: new THREE.Vector3(), q: new THREE.Quaternion(), qp: new THREE.Quaternion() };   // scratch of reach()
    this.setLook('taxi');   // the taxi driver until a Crazy Tuk run starts (main.js switches the looks)
  }
  setLook(name) {
    if (this.look === name) return;
    this.look = name;
    if (this.mesh) { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.skeleton.dispose(); }
    const b = bones(); b[0].updateMatrixWorld(true);
    const mesh = new THREE.SkinnedMesh(figure(LOOKS[name] || LOOKS.racer), this.mat);
    mesh.name = 'driver'; mesh.frustumCulled = false;
    mesh.add(b[0]); mesh.bind(new THREE.Skeleton(b), new THREE.Matrix4());
    this.vehicle.add(mesh); this.mesh = mesh; this.b = b;
    this.triangles = mesh.geometry.attributes.position.count / 3;
  }
  get visible() { return !!this.mesh && this.mesh.visible; }
  // the body is hidden in VR and in the cockpit camera (the player sits there); the handlebar's gloves follow the body
  setBodyVisible(v) { this.bodyVisible = !!v; }
  // lateral / longitudinal acceleration (m/s², + lateral = to the left), speed (km/h), slip angle (rad, the drift), nitro burning
  setRide(lat, lon, kmh, slip, nitro) { this.ride.lat = lat; this.ride.lon = lon; this.ride.kmh = kmh; this.ride.slip = slip; this.ride.nitro = nitro; }
  // reactions
  cheer() { this.fx = { kind: 'cheer', t: 0, dur: 0.9 }; }
  nod() { this.fx = { kind: 'nod', t: 0, dur: 0.5 }; }
  hit(strength = 1) { this.fx = { kind: 'hit', t: 0, dur: 0.35, k: Math.min(1.5, 0.5 + strength) }; }
  shake() { this.fx = { kind: 'shake', t: 0, dur: 0.9 }; }
  // the guide points to the side (+1 right, -1 left) with the hand on that side for `dur` s
  point(side = 1, dur = 1.4) { this.fx = { kind: 'point', t: 0, dur, side }; }

  update(dt, { held = { left: false, right: false } } = {}) {
    if (!this.mesh) return;
    const show = this.bodyVisible;
    this.mesh.visible = show;
    // the gloves: shown with the body (outside VR nothing else shows them), or when a VR hand holds the grip
    const off = (side) => this.fx && (this.fx.kind === 'cheer' && side === 1 || this.fx.kind === 'point' && this.fx.side === side);   // that hand is off the bar
    this.bar.leftGlove.visible = (show && !off(-1)) || held.left;
    this.bar.rightGlove.visible = (show && !off(1)) || held.right;
    if (!show) return;
    this.t += dt;
    const k = 1 - Math.exp(-dt * 6), R = this.ride;
    this.latS += (R.lat - this.latS) * k; this.lonS += (R.lon - this.lonS) * k; this.slipS += (R.slip - this.slipS) * (1 - Math.exp(-dt * 4)); this.nitroS += ((R.nitro ? 1 : 0) - this.nitroS) * (1 - Math.exp(-dt * 3));
    const b = this.b, fx = this.fx;
    if (fx) { fx.t += dt; if (fx.t >= fx.dur) this.fx = null; }
    const w = fx ? Math.max(0, Math.min(1, fx.t / 0.12, (fx.dur - fx.t) / 0.25)) : 0;   // quick in, softer out
    // --- the torso and the head ---
    const breath = Math.sin(this.t * 1.9) * 0.012;
    const speedK = Math.min(1, R.kmh / 120);
    b[B.spine].rotation.set(LEAN + clamp(this.lonS * 0.02, 0.25) + this.nitroS * 0.12 - speedK * 0.05 + breath, 0, clamp(this.latS * 0.018, 0.21));
    b[B.spine].position.y = 0.04 + breath * 0.3;
    // the head: counter-lean, looks into the slide, glances aside when standing, pulled down a little at speed
    this.glance.t += dt;
    if (R.kmh < 2 && this.glance.t > this.glance.next) { this.glance.t = 0; this.glance.next = 6 + Math.random() * 4; this.glance.v = (Math.random() < 0.5 ? -1 : 1) * 0.5; }
    const glance = R.kmh < 2 && this.glance.t < 1.6 ? this.glance.v * Math.sin(Math.min(1, this.glance.t / 1.6) * Math.PI) : 0;
    b[B.head].rotation.set(-clamp(this.lonS * 0.012, 0.2) - speedK * 0.08 - breath, clamp(this.slipS * 0.8, 0.6) + glance, -b[B.spine].rotation.z * 0.6);
    // --- the arms: reach the gloves on the bar (two-bone IK in the tuk-tuk frame) ---
    this.mesh.updateMatrixWorld(true);
    for (const [side, bArm, bFore, glove] of [[-1, B.lArm, B.lFore, this.bar.leftGlove], [1, B.rArm, B.rFore, this.bar.rightGlove]]) {
      const target = this.v;
      if (fx && fx.kind === 'cheer' && side === 1) { target.set(0.3 + 0.1 * Math.sin(this.t * 14), 1.95 + 0.04 * Math.sin(this.t * 14), -0.1); }                 // the fist up above the roof line
      else if (fx && fx.kind === 'point' && side === fx.side) { target.set(fx.side * 0.62, 1.38, -0.42); }                                                     // the guide's hand (the one on that side) towards the landmark
      else { glove.getWorldPosition(target); this.vehicle.worldToLocal(target); target.z += 0.05; }                                                              // the wrist, a little towards the driver
      if (fx && (fx.kind === 'cheer' && side === 1 || fx.kind === 'point' && side === fx.side)) { glove.getWorldPosition(this.w); this.vehicle.worldToLocal(this.w); target.lerp(this.w, 1 - w); }
      this.reach(bArm, bFore, target, side);
    }
    // --- events on top ---
    if (fx) {
      if (fx.kind === 'hit') { const p = Math.sin(Math.min(1, fx.t / fx.dur) * Math.PI) * fx.k; b[B.spine].rotation.x -= 0.3 * p; b[B.head].rotation.x -= 0.25 * p; }
      else if (fx.kind === 'nod') { b[B.head].rotation.x += Math.sin(Math.min(1, fx.t / fx.dur) * Math.PI * 2) * 0.22; }
      else if (fx.kind === 'shake') { b[B.head].rotation.y += Math.sin(fx.t * 18) * 0.25 * w; }
      else if (fx.kind === 'cheer') { b[B.head].rotation.x -= 0.25 * w; b[B.spine].rotation.x += 0.06 * w; }
    }
  }

  // aims the upper arm (bone bArm, hanging along -Y) and the forearm (bFore) so that the wrist lands on `target` (tuk-tuk frame); the elbow bends down and out
  reach(bArm, bFore, target, side) {
    const b = this.b, arm = b[bArm], fore = b[bFore], sc = this.sc;
    // the shoulder in the tuk-tuk frame (= the mesh's frame) and the parent's (spine's) orientation there
    arm.updateWorldMatrix(true, false);
    const S = sc.S.setFromMatrixPosition(arm.matrixWorld); this.vehicle.worldToLocal(S);
    const qParent = sc.qp.copy(arm.parent.getWorldQuaternion(sc.q)).premultiply(this.vehicle.getWorldQuaternion(sc.q).invert());
    const d = sc.d.copy(target).sub(S), L = Math.max(0.05, Math.min(UPPER + FORE - 0.01, d.length())); d.normalize();
    // elbow: law of cosines along d, the bend out of the line towards "down and out"
    const a = (UPPER * UPPER - FORE * FORE + L * L) / (2 * L), h = Math.sqrt(Math.max(0, UPPER * UPPER - a * a));
    const hint = sc.h.set(side * 0.35, -1, 0.15); hint.addScaledVector(d, -hint.dot(d)); if (hint.lengthSq() < 1e-6) hint.set(0, -1, 0); hint.normalize();
    const E = sc.E.copy(S).addScaledVector(d, a).addScaledVector(hint, h);
    const T = sc.T.copy(S).addScaledVector(d, L);   // the clamped target
    // upper arm: -Y -> (E - S); forearm: -Y -> (T - E); each as a local rotation under its parent
    const qUpperWorld = sc.q.setFromUnitVectors(DOWN, sc.u.copy(E).sub(S).normalize());
    arm.quaternion.copy(qParent).invert().multiply(qUpperWorld);
    const qForeWorld = sc.q.setFromUnitVectors(DOWN, sc.u.copy(T).sub(E).normalize());
    fore.quaternion.copy(qParent).multiply(arm.quaternion).invert().multiply(qForeWorld);
  }
}
