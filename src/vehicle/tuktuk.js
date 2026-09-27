// Tuk-tuk built from primitives, merged into a single vertex-coloured mesh (1 draw call),
// plus the turning handlebar, the dashboard panel (canvas texture) and a seat anchor for the camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const C = {
  body: 0xf2c230, bodyDark: 0xd9a51f, roof: 0x1f6b45, frame: 0x2a2a2a, seat: 0x5a3422,
  chrome: 0xc8c8c8, tire: 0x161616, grip: 0x111111, light: 0xfff4c0, floor: 0x3b3b3b,
  rubber: 0x1b1b1b, glove: 0x3a2a20, gloveCuff: 0x2a1e17,
  trousers: 0x3a4250, shoe: 0x2a1f18, sole: 0x111111,
};

function colorize(g, color) {
  const col = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
function part(geo, color, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
  g.translate(x, y, z);
  return colorize(g, color);
}
// geometry placed with a transform matrix
function placed(geo, color, m) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.applyMatrix4(m);
  return colorize(g, color);
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r, l, s = 10) => new THREE.CylinderGeometry(r, r, l, s);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Brake pedal: part of the body mesh, pressed in the vertex shader (no extra draw call).
const PEDAL_HINGE = V(0.14, 0.42, -0.56);
const PEDAL_MAX = 0.42; // rad at full brake (pad ends up flat)
// Driver's legs (stage 5b): low-poly, part of the body mesh. The right foot rests with the heel on
// the floor and the toe on the pedal pad; each vertex carries a weight aPedal (heel 0 .. pad 1) and
// turns about the pedal hinge by weight x pedal angle, so the toe follows the pad and the heel stays.
const HEEL_Z = -0.28, PAD_Z = -0.47;      // right foot: heel on the floor, sole meets the pad here
const FLOOR_Y = 0.41;                     // top of the cab floor
const SHOE_TILT = Math.atan2(0.47 - FLOOR_Y, HEEL_Z - PAD_Z); // sole rises from the heel to the pad
// tube between two points (for limbs)
function limb(a, b, r0, r1, color, sides = 8) {
  const d = b.clone().sub(a);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize());
  const m = new THREE.Matrix4().compose(a.clone().addScaledVector(d, 0.5), q, V(1, 1, 1));
  return placed(new THREE.CylinderGeometry(r1, r0, d.length(), sides), color, m);
}

export function createTukTuk({ version = '' } = {}) {
  const P = [];
  // chassis & floor
  P.push(part(box(1.3, 0.1, 2.2), C.floor, 0, 0.36, 0.35));
  // front cowl around the front wheel + dash top
  P.push(part(box(0.78, 0.55, 0.55), C.body, 0, 0.66, -0.98));
  P.push(part(box(1.16, 0.12, 0.36), C.body, 0, 0.94, -0.8));
  P.push(part(box(1.16, 0.5, 0.06), C.bodyDark, 0, 0.66, -0.64));
  // side skirts and rear body
  for (const s of [-1, 1]) {
    P.push(part(box(0.06, 0.42, 1.55), C.body, s * 0.64, 0.6, 0.65));
    P.push(part(box(0.06, 0.12, 0.9), C.bodyDark, s * 0.64, 0.46, -0.55));
  }
  P.push(part(box(1.3, 0.75, 0.08), C.body, 0, 0.78, 1.44));
  // pillars
  for (const s of [-1, 1]) {
    P.push(part(box(0.05, 1.0, 0.05), C.frame, s * 0.58, 1.43, -0.98));
    P.push(part(box(0.05, 1.45, 0.05), C.frame, s * 0.62, 1.2, 1.42));
    P.push(part(box(0.04, 0.04, 2.4), C.frame, s * 0.62, 1.88, 0.22)); // roof rails
  }
  // windscreen frame (top bar) and roof
  P.push(part(box(1.2, 0.05, 0.05), C.frame, 0, 1.9, -0.98));
  P.push(part(box(1.46, 0.07, 2.7), C.roof, 0, 1.95, 0.22));
  P.push(part(box(1.5, 0.12, 0.08), C.roof, 0, 1.9, -1.12)); // visor lip
  // driver seat & passenger bench
  P.push(part(box(0.5, 0.12, 0.42), C.seat, 0, 0.66, -0.02));
  P.push(part(box(0.5, 0.42, 0.08), C.seat, 0, 0.9, 0.22, -0.12));
  P.push(part(box(1.18, 0.16, 0.46), C.seat, 0, 0.66, 0.98));
  P.push(part(box(1.18, 0.5, 0.08), C.seat, 0, 0.98, 1.3, -0.12));
  // steering column along the steering axis (the handlebar on top turns: see createHandlebar)
  P.push(part(cyl(0.025, 0.3, 8), C.chrome, 0, 0.884, -0.723, BAR_TILT));
  // wheels
  P.push(part(cyl(0.26, 0.16, 14), C.tire, 0, 0.26, -1.08, 0, 0, Math.PI / 2));
  for (const s of [-1, 1]) P.push(part(cyl(0.26, 0.16, 14), C.tire, s * 0.62, 0.26, 0.98, 0, 0, Math.PI / 2));
  // headlight
  P.push(part(cyl(0.09, 0.06, 10), C.light, 0, 0.82, -1.27, Math.PI / 2));
  // brake pedal under the driver's right foot: bracket (fixed) + arm and pad (hinged)
  P.push(part(box(0.06, 0.02, 0.04), C.chrome, PEDAL_HINGE.x, 0.42, PEDAL_HINGE.z));
  const pedal = [
    part(box(0.016, 0.016, 0.1), C.chrome, PEDAL_HINGE.x, 0.44, -0.515, -0.45),
    part(box(0.085, 0.016, 0.075), C.rubber, PEDAL_HINGE.x, 0.462, -0.47, -0.45),
  ];
  // driver's legs: thighs from the seat, shins down to the ankles; left foot flat on the floor
  const legs = [];
  for (const s of [1, -1]) {
    const hip = V(s * 0.15, 0.78, -0.04), knee = V(s * 0.15, 0.8, -0.4), ankle = V(s * 0.145, 0.5, HEEL_Z - 0.02);
    legs.push(limb(hip, knee, 0.075, 0.068, C.trousers));
    legs.push(placed(new THREE.SphereGeometry(0.07, 8, 6), C.trousers, new THREE.Matrix4().makeTranslation(knee.x, knee.y, knee.z)));
    legs.push(limb(knee, ankle, 0.062, 0.05, C.trousers));
    if (s < 0) { // left shoe flat on the floor
      legs.push(part(box(0.1, 0.075, 0.27), C.shoe, -0.145, FLOOR_Y + 0.0375 + 0.012, HEEL_Z - 0.135));
      legs.push(part(box(0.1, 0.024, 0.27), C.sole, -0.145, FLOOR_Y + 0.012, HEEL_Z - 0.135));
    }
  }
  // right shoe: sole from the heel on the floor up to the pad; weights heel 0 -> pad 1 (toe rides with the pad)
  const shoeMid = V(0.145, FLOOR_Y + Math.tan(SHOE_TILT) * 0.135, HEEL_Z - 0.135);
  const up = V(0, Math.cos(SHOE_TILT), Math.sin(SHOE_TILT));
  const shoe = [
    part(box(0.1, 0.075, 0.27), C.shoe, 0, 0, 0, SHOE_TILT).translate(shoeMid.x + up.x * 0.0495, shoeMid.y + up.y * 0.0495, shoeMid.z + up.z * 0.0495),
    part(box(0.1, 0.024, 0.27), C.sole, 0, 0, 0, SHOE_TILT).translate(shoeMid.x + up.x * 0.012, shoeMid.y + up.y * 0.012, shoeMid.z + up.z * 0.012),
  ];
  for (const g of shoe) {
    const pos = g.attributes.position, w = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) w[i] = THREE.MathUtils.clamp((HEEL_Z - pos.getZ(i)) / (HEEL_Z - PAD_Z), 0, 1);
    g.setAttribute('aPedal', new THREE.BufferAttribute(w, 1));
  }
  for (const g of P.concat(legs)) g.setAttribute('aPedal', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  for (const g of pedal) g.setAttribute('aPedal', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));

  const geo = mergeGeometries(P.concat(pedal, legs, shoe));
  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const pedalAngle = { value: 0 };
  bodyMat.onBeforeCompile = (sh) => {
    sh.uniforms.uPedal = pedalAngle;
    const h = PEDAL_HINGE;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aPedal;
uniform float uPedal;
// rotation about the pedal hinge axis (X) by the vertex weight x pedal angle
vec3 pedalRot(vec3 v) { float a = aPedal * uPedal; float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
if (aPedal > 0.001) objectNormal = pedalRot(objectNormal);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
if (aPedal > 0.001) transformed = vec3(${h.x}, ${h.y}, ${h.z}) + pedalRot(transformed - vec3(${h.x}, ${h.y}, ${h.z}));`);
  };
  const body = new THREE.Mesh(geo, bodyMat);
  body.name = 'tuktuk body';

  const group = new THREE.Group();
  group.name = 'tuktuk';
  group.add(body);

  const handlebar = createHandlebar();
  group.add(handlebar.pivot);

  const dashboard = new Dashboard(version);
  dashboard.mesh.position.set(0, 1.134, -0.87);
  dashboard.mesh.rotation.x = -0.45;
  group.add(dashboard.mesh);

  // Seat anchor: origin at the driver's seat on the cab floor. Desktop camera sits at eye height;
  // in VR the XR camera is placed under this anchor with local-floor reference space.
  const seat = new THREE.Group();
  seat.name = 'seat';
  seat.position.set(0, 0.0, -0.05);
  group.add(seat);

  // brake: 0..1 -> pedal pressed
  const setPedal = (brake) => { pedalAngle.value = PEDAL_MAX * Math.min(1, Math.max(0, brake)); };

  return { group, dashboard, seat, handlebar, setPedal, triangles: geo.attributes.position.count / 3 };
}

// ---------- handlebar ----------
// Steering axis: through the top of the column, leaning back towards the rider.
export const BAR_PIVOT = V(0, 1.02, -0.66);
export const BAR_TILT = 25 * Math.PI / 180;
export const BAR_LOCK = 35 * Math.PI / 180;  // max turn either way
// V-shaped moped/Ape-style bar (tuk-tuk frame, right half; the left half is mirrored): risers go out
// and slightly up from the clamp, bend and sweep back towards the driver, grips at the ends.
const BAR_BEND1 = V(0.15, 1.05, -0.63);
const BAR_BEND2 = V(0.235, 1.085, -0.545);
const GRIP_DIR = V(0.77, 0.08, 0.64).normalize(); // outward and back towards the driver
const GRIP_LEN = 0.13;
// Grip centre where the driver's right hand rests: ~0.42 m ahead of the seat anchor, ~0.6 m apart.
export const GRIP_RIGHT = BAR_BEND2.clone().addScaledVector(GRIP_DIR, 0.02 + GRIP_LEN / 2);

// tuk-tuk frame -> handlebar (steer group) frame
const TO_BAR = new THREE.Matrix4().makeRotationX(-BAR_TILT).multiply(new THREE.Matrix4().makeTranslation(-BAR_PIVOT.x, -BAR_PIVOT.y, -BAR_PIVOT.z));
const mirror = (v) => V(-v.x, v.y, v.z);

// Grip frame in the tuk-tuk frame. X: along the grip, outward for the right grip and inward for the
// left one (so both frames are right-handed); Z: towards the driver; Y: up. Twisting the throttle
// = rotation about +X, top of the grip rolling towards the driver.
function gripBasis(side) {
  const x = side > 0 ? GRIP_DIR.clone() : V(GRIP_DIR.x, -GRIP_DIR.y, -GRIP_DIR.z); // left: inward = -mirror
  const z = V(0, 0, 1).addScaledVector(x, -x.z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z);
}
// transform of a grip frame (centre + basis) in the steer group
function gripMatrix(side) {
  const c = side > 0 ? GRIP_RIGHT : mirror(GRIP_RIGHT);
  return TO_BAR.clone().multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z)).multiply(gripBasis(side));
}
// tube between two tuk-tuk-frame points, in the steer group
function tube(a, b, r, color) {
  const d = new THREE.Vector3().subVectors(b, a);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize());
  const m = TO_BAR.clone().multiply(new THREE.Matrix4().compose(a.clone().addScaledVector(d, 0.5), q, V(1, 1, 1)));
  return placed(cyl(r, d.length(), 8), color, m);
}

// Handlebar assembly. pivot: at the clamp, local Y = steering axis. steer: turns about it
// (rotation.y > 0 = left turn). rightGrip: twists about its own X = grip axis (rotation.x > 0 =
// throttle). Gloves show while the player holds the grips.
function createHandlebar() {
  const pivot = new THREE.Group();
  pivot.name = 'handlebar pivot';
  pivot.position.copy(BAR_PIVOT);
  pivot.rotation.x = BAR_TILT;
  const steer = new THREE.Group();
  pivot.add(steer);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });

  const P = [part(cyl(0.032, 0.06, 8), C.chrome, 0, -0.01, 0)]; // clamp on the column
  for (const side of [1, -1]) {
    const f = side > 0 ? (v) => v : mirror;
    const b1 = f(BAR_BEND1), b2 = f(BAR_BEND2);
    const gripDir = side > 0 ? GRIP_DIR : mirror(GRIP_DIR);
    P.push(tube(BAR_PIVOT, b1, 0.017, C.chrome));
    P.push(tube(b1, b2, 0.017, C.chrome));
    P.push(tube(b2, b2.clone().addScaledVector(gripDir, 0.03), 0.017, C.chrome));
    for (const j of [b1, b2]) P.push(placed(new THREE.SphereGeometry(0.019, 8, 6), C.chrome, TO_BAR.clone().multiply(new THREE.Matrix4().makeTranslation(j.x, j.y, j.z))));
    // brake lever in front of the grip
    P.push(placed(box(0.11, 0.01, 0.022), C.frame, gripMatrix(side).multiply(new THREE.Matrix4().makeTranslation(0, 0.012, -0.052))));
  }
  // left grip is fixed; the right one twists
  P.push(placed(cyl(0.028, GRIP_LEN, 8).rotateZ(Math.PI / 2), C.grip, gripMatrix(-1)));
  const bar = new THREE.Mesh(mergeGeometries(P), mat);
  bar.name = 'handlebar';
  steer.add(bar);

  const rightGripBase = new THREE.Object3D();
  gripMatrix(1).decompose(rightGripBase.position, rightGripBase.quaternion, rightGripBase.scale);
  steer.add(rightGripBase);
  const rightGrip = new THREE.Mesh(mergeGeometries([
    part(cyl(0.028, GRIP_LEN, 8), C.grip, 0, 0, 0, 0, 0, Math.PI / 2),
    part(box(GRIP_LEN - 0.01, 0.008, 0.012), C.light, 0, 0.028, 0),  // index line, shows the twist
    part(cyl(0.03, 0.015, 8), C.chrome, GRIP_LEN / 2 + 0.006, 0, 0, 0, 0, Math.PI / 2), // bar end
  ]), mat);
  rightGrip.name = 'throttle grip';
  rightGripBase.add(rightGrip);

  // simple fists around the grips (grip frame: X along the grip, Y up, Z towards the driver)
  const glove = (inner) => mergeGeometries([
    part(box(0.1, 0.08, 0.09), C.glove, 0, 0.005, 0.004),
    part(box(0.03, 0.028, 0.06), C.glove, inner * 0.055, 0.032, -0.008), // thumb on the inner side
    part(box(0.075, 0.065, 0.085), C.gloveCuff, 0, -0.035, 0.075),     // wrist, towards the driver
  ]);
  const leftGripFrame = new THREE.Object3D();
  gripMatrix(-1).decompose(leftGripFrame.position, leftGripFrame.quaternion, leftGripFrame.scale);
  steer.add(leftGripFrame);
  const leftGlove = new THREE.Mesh(glove(1), mat);   // left frame X points inward
  leftGlove.visible = false;
  leftGripFrame.add(leftGlove);
  const rightGlove = new THREE.Mesh(glove(-1), mat); // right frame X points outward
  rightGlove.visible = false;
  rightGrip.add(rightGlove);
  return { pivot, steer, rightGripBase, rightGrip, leftGlove, rightGlove };
}

// Dashboard panel: speed, optional FPS counter, message line, OSM attribution, build version.
export class Dashboard {
  constructor(version = '') {
    this.version = version;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512; this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.21), new THREE.MeshBasicMaterial({ map: this.texture }));
    this.mesh.name = 'dashboard';
    this.showFps = false;
    this.draw({ speed: 0, fps: 0, calls: 0, tris: 0 });
  }
  // msg: optional text for the message line (msgColor defaults to orange).
  // Stats (shown with showFps): fps, hz (display rate), calls, tris, gpuMs / cpuMs (null = n/a), stress.
  draw({ speed, fps, calls, tris, hz = 0, gpuMs = null, cpuMs = null, stress = 1, msg = '', msgColor = '#ff9f43' }) {
    const g = this.ctx, W = 512, H = 256;
    g.fillStyle = '#10161c'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#f2c230'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
    g.fillStyle = '#ffffff'; g.font = 'bold 96px system-ui, sans-serif'; g.textBaseline = 'alphabetic';
    g.textAlign = 'right'; g.fillText(String(Math.round(Math.abs(speed) * 3.6)), 190, 118);
    g.textAlign = 'left'; g.font = 'bold 34px system-ui, sans-serif'; g.fillStyle = '#f2c230'; g.fillText('km/h', 200, 116);
    if (speed < -0.1) { g.fillStyle = '#ff8a5c'; g.fillText('R', 290, 116); }
    if (this.showFps) {
      const target = hz || 72;
      const ms = (v) => (v == null ? 'н/д' : v.toFixed(1) + ' мс');
      g.textAlign = 'right';
      g.fillStyle = fps >= target - 2 ? '#6fe06f' : fps >= target * 0.8 ? '#ffd166' : '#ff5c5c';
      g.font = 'bold 40px system-ui, sans-serif'; g.fillText(`${Math.round(fps)} FPS`, W - 20, 50);
      g.font = '22px system-ui, sans-serif'; g.fillStyle = '#9fb3c8';
      g.fillText(`GPU ${ms(gpuMs)}`, W - 20, 80);
      g.fillText(`CPU ${ms(cpuMs)}`, W - 20, 106);
      g.textAlign = 'center'; g.font = '18px system-ui, sans-serif';
      g.fillStyle = stress > 1 ? '#ffd166' : '#9fb3c8';
      g.fillText(`${hz ? hz + ' Гц · ' : ''}${calls} calls · ${(tris / 1000).toFixed(0)}k tris${stress > 1 ? ` · навантаження ×${stress}` : ''}`, W / 2, 140);
    }
    if (msg) {
      g.textAlign = 'center'; g.fillStyle = msgColor;
      let size = 34;
      do { g.font = `bold ${size}px system-ui, sans-serif`; size -= 2; } while (g.measureText(msg).width > W - 40 && size > 16);
      g.fillText(msg, W / 2, 178);
    }
    g.textAlign = 'left'; g.font = '22px system-ui, sans-serif'; g.fillStyle = '#9fb3c8';
    g.fillText('© OpenStreetMap contributors', 20, H - 22);
    if (this.version) {
      g.textAlign = 'right'; g.font = '18px system-ui, sans-serif'; g.fillStyle = '#6f8396';
      g.fillText('v' + this.version, W - 18, H - 22);
    }
    this.texture.needsUpdate = true;
  }
}
