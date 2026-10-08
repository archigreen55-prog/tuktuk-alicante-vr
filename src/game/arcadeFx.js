// Crazy Tuk visuals that are not the city: the gate beacon (a tall pulsing light pillar like the GTA San Andreas marker, a
// ring on the ground, a burst when a gate is passed), the 3D arrow over the tuk-tuk that points at the next gate with the
// distance, and the drift effects (smoke from the rear wheels, tyre marks on the asphalt). Everything is pooled and
// cheap: the beacon is 4-5 transparent draw calls, the arrow 2, the smoke one Points draw, the marks one mesh.
import * as THREE from 'three';

const GATE = 0xffae00, FINISH = 0x22d36b;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const KIND = { exact: 0x6fe06f, good: 0xffd166, ok: 0xcfe3f5 };

// ---------------------------------------------------------------- shaders
const pillarVS = /* glsl */ `
varying float vH; varying vec2 vUv;
void main() { vUv = uv; vH = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const pillarFS = /* glsl */ `
uniform vec3 uColor; uniform float uFade; uniform float uTime; uniform float uStrength;
varying float vH; varying vec2 vUv;
void main() {
  float pulse = 0.75 + 0.25 * sin(uTime * 4.0);
  float stripes = 0.8 + 0.2 * sin(vH * 60.0 - uTime * 7.0 + vUv.x * 12.0);
  float a = pow(1.0 - vH, 0.6) * uStrength * pulse * stripes * uFade;
  gl_FragColor = vec4(uColor, a);   // plain alpha: an additive glow would vanish against the bright sky and sand
  #include <colorspace_fragment>
}`;
const flatVS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ringFS = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha;
void main() {
  gl_FragColor = vec4(uColor, uAlpha);
  #include <colorspace_fragment>
}`;

const additive = (uniforms, vs, fs, side = THREE.DoubleSide) => new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, side, fog: false });

export class GateBeacon {
  constructor(scene) {
    const H = 260;
    this.uOuter = { uColor: { value: new THREE.Color(GATE) }, uFade: { value: 1 }, uTime: { value: 0 }, uStrength: { value: 0.8 } };
    this.uInner = { uColor: { value: new THREE.Color(0xffe27a) }, uFade: { value: 1 }, uTime: { value: 0 }, uStrength: { value: 0.9 } };
    this.outer = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.8, H, 28, 1, true).translate(0, H / 2, 0), additive(this.uOuter, pillarVS, pillarFS));
    this.inner = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.3, H, 14, 1, true).translate(0, H / 2, 0), additive(this.uInner, pillarVS, pillarFS));
    this.uRing = { uColor: { value: new THREE.Color(GATE) }, uAlpha: { value: 0.8 } };
    this.uDisc = { uColor: { value: new THREE.Color(GATE) }, uAlpha: { value: 0.28 } };
    this.uPulse = { uColor: { value: new THREE.Color(GATE) }, uAlpha: { value: 0.5 } };
    this.uBurst = { uColor: { value: new THREE.Color(0xffffff) }, uAlpha: { value: 0 } };   // ring colour: that of the grade
    const flat = (u, geo) => new THREE.Mesh(geo.rotateX(-Math.PI / 2), additive(u, flatVS, ringFS, THREE.DoubleSide));
    this.ring = flat(this.uRing, new THREE.RingGeometry(7.2, 8.2, 56));      // the "good" circle (8 m), as in arcade.js
    this.disc = flat(this.uDisc, new THREE.CircleGeometry(3, 32));            // the "exact" circle (3 m)
    this.pulse = flat(this.uPulse, new THREE.RingGeometry(0.93, 1, 56));      // expands from the middle outwards, over and over
    this.burst = flat(this.uBurst, new THREE.RingGeometry(0.9, 1, 56));       // the flash on passing
    this.group = new THREE.Group();
    this.group.add(this.outer, this.inner, this.ring, this.disc, this.pulse, this.burst);
    for (const m of this.group.children) { m.renderOrder = 6; m.frustumCulled = false; }
    this.group.visible = false; this.burst.visible = false;
    scene.add(this.group);
    this.t = 0; this.burstT = 1e9; this.burstAt = null; this.on = false;
  }

  // gate: { p: [x, z], finish } or null; y: the ground height there
  set(gate, y) {
    this.on = !!gate; this.group.visible = this.on; if (!gate) return;
    this.group.position.set(gate.p[0], y + 0.25, gate.p[1]);
    const c = gate.finish ? FINISH : GATE;
    for (const u of [this.uOuter, this.uRing, this.uDisc, this.uPulse]) u.uColor.value.setHex(c);
    this.uInner.uColor.value.setHex(gate.finish ? 0xb9ffd2 : 0xffe27a);
  }
  // a flash where a gate was passed (kind: exact | good | ok)
  flash(gate, kind, y) {
    if (!gate || kind === 'missed') return;
    this.burstAt = { x: gate.p[0], y: y + 0.3, z: gate.p[1] }; this.burstT = 0; this.uBurst.uColor.value.setHex(KIND[kind] || 0xffffff);
    this.burst.position.set(this.burstAt.x, this.burstAt.y, this.burstAt.z); this.burst.visible = true;
  }
  update(dt, camX, camZ) {
    this.t += dt;
    if (this.on) {
      const g = this.group.position, d = Math.hypot(camX - g.x, camZ - g.z);
      const fade = Math.max(0.35, Math.min(1, (d - 3) / 25));
      this.uOuter.uTime.value = this.uInner.uTime.value = this.t;
      this.uOuter.uFade.value = this.uInner.uFade.value = fade;
      // the beacon is a little thicker the farther away, so it stays a clear line over the roofs
      const s = 1 + Math.min(3, d / 140); this.outer.scale.set(s, 1, s); this.inner.scale.set(s, 1, s);
      const ph = (this.t * 0.9) % 1;
      this.pulse.scale.setScalar(2 + 6.5 * ph); this.uPulse.uAlpha.value = 0.6 * (1 - ph);
      this.uRing.uAlpha.value = 0.75 + 0.2 * Math.sin(this.t * 4);
    }
    if (this.burst.visible) {
      this.burstT += dt;
      const k = this.burstT / 0.55;
      if (k >= 1) { this.burst.visible = false; this.uBurst.uAlpha.value = 0; }
      else { this.burst.scale.setScalar(3 + 20 * k); this.uBurst.uAlpha.value = 0.95 * (1 - k); }
    }
  }
}

// ---------------------------------------------------------------- the arrow over the tuk-tuk
function arrowShape() {
  const s = new THREE.Shape();   // pointing along -Z when laid flat (shape y -> -z); 2.4 m long
  s.moveTo(0, 1.25); s.lineTo(0.95, 0.1); s.lineTo(0.4, 0.1); s.lineTo(0.4, -1.1); s.lineTo(-0.4, -1.1); s.lineTo(-0.4, 0.1); s.lineTo(-0.95, 0.1); s.closePath();
  return s;
}
export class NavArrow {
  constructor(scene) {
    const geo = new THREE.ExtrudeGeometry(arrowShape(), { depth: 0.32, bevelEnabled: false }).translate(0, 0, -0.16);
    // lie flat: shape (x, y) -> (x, z = -y), thickness along y
    geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ color: GATE, transparent: true, opacity: 0.62, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.edge = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x10161c, side: THREE.BackSide, transparent: true, opacity: 0.4, depthWrite: false, fog: false }));
    this.edge.scale.set(1.14, 1.5, 1.14);
    this.yaw = new THREE.Group(); this.yaw.add(this.mesh, this.edge);   // turns the arrow to the aim, in its own plane
    this.tilt = new THREE.Group(); this.tilt.add(this.yaw);             // leans that plane towards the camera: never seen edge-on
    this.group = new THREE.Group(); this.group.add(this.tilt);
    this.group.renderOrder = 11; this.mesh.renderOrder = 11; this.edge.renderOrder = 10;
    this.group.visible = false; scene.add(this.group);
    this.t = 0; this.ang = null; this.q = new THREE.Quaternion(); this.axis = new THREE.Vector3();
  }
  // x, y, z: the tuk-tuk; aim: { x, z, via } or null; heading: the tuk-tuk's rotation.y; cam*: the camera
  update(dt, x, y, z, aim, heading, camX, camY, camZ) {
    if (!aim) { this.group.visible = false; this.ang = null; return; }
    this.t += dt;
    const dx = aim.x - x, dz = aim.z - z, dist = Math.hypot(dx, dz);
    this.group.visible = true;
    // the direction: towards the aim; within ~18 m of a GATE it blends into "straight ahead" (the bearing to a point you drive
    // over spins round: no jumping at the pillar), and a turn to a new aim is a smooth swing, never a snap
    let want = Math.atan2(-dx, -dz);
    if (!aim.via) { const w = Math.max(0, Math.min(1, (18 - dist) / 12)); if (w > 0) want += angDiff(heading, want) * w; }
    if (this.ang == null) this.ang = want;
    const d = angDiff(want, this.ang), step = Math.min(Math.abs(d), (3 + 9 * Math.abs(d) / Math.PI) * dt);   // up to 12 rad/s for a half turn, 3 rad/s for the last bit
    this.ang += Math.sign(d) * step;
    // above the roof, a little below the camera
    const yy = Math.max(y + 3.4, Math.min(y + 4.8, camY - 0.8));
    this.group.position.set(x, yy + 0.1 * Math.sin(this.t * 4), z);
    // lean the arrow's plane about the camera's right axis so that the camera looks at it from ~55 degrees above
    const hx = x - camX, hz = z - camZ, hl = Math.hypot(hx, hz) || 1;
    const elev = Math.atan2(camY - yy, hl), lean = Math.max(0.25, Math.min(1.15, 0.95 - elev));
    this.axis.set(-hz / hl, 0, hx / hl);   // the camera's right, horizontal
    this.tilt.quaternion.setFromAxisAngle(this.axis, lean);
    this.yaw.rotation.y = this.ang;   // the nose (-Z) towards the aim
    this.mat.color.setHex(aim.via ? 0xffe27a : dist < 60 ? 0x22d36b : GATE);
    // about half the size it was, and the same size on the screen whatever the camera distance does
    const cd = Math.hypot(camX - x, camY - yy, camZ - z);
    this.group.scale.setScalar(0.5 * Math.max(0.5, Math.min(1.5, cd / 11)) * (1 + 0.04 * Math.sin(this.t * 6)));
  }
  show(on) { if (!on) this.group.visible = false; }
}

// ---------------------------------------------------------------- drift: smoke and tyre marks
const smokeVS = /* glsl */ `
attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA;
void main() { vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`;
const smokeFS = /* glsl */ `
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float a = vA * (1.0 - r * r);
  gl_FragColor = vec4(vec3(0.93), a);
  #include <colorspace_fragment>
}`;

export class DriftFx {
  constructor(scene, { smoke = 56, marks = 1400 } = {}) {
    // smoke: a ring of puffs in one Points draw
    this.N = smoke; this.i = 0;
    this.pos = new Float32Array(smoke * 3); this.size = new Float32Array(smoke); this.alpha = new Float32Array(smoke);
    this.vel = new Float32Array(smoke * 3); this.age = new Float32Array(smoke).fill(9); this.life = new Float32Array(smoke).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1)); g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.uSmoke = { uScale: { value: 600 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.uSmoke, vertexShader: smokeVS, fragmentShader: smokeFS, transparent: true, depthWrite: false, fog: false }));
    this.points.frustumCulled = false; this.points.renderOrder = 8; scene.add(this.points);
    // marks: a ring buffer of quads (two tracks), one mesh
    this.M = marks; this.mi = 0;
    this.mpos = new Float32Array(marks * 4 * 3);
    const idx = new Uint32Array(marks * 6);
    for (let q = 0; q < marks; q++) { const b = q * 4; idx.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], q * 6); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(this.mpos, 3)); mg.setIndex(new THREE.BufferAttribute(idx, 1));
    this.markAttr = mg.attributes.position;
    this.markMesh = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: 0x15181c, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide, fog: false }));
    this.markMesh.frustumCulled = false; this.markMesh.renderOrder = 2; scene.add(this.markMesh);
    this.last = [null, null]; this.dirty = false; this.acc = 0;
  }
  reset() {
    this.age.fill(9); this.alpha.fill(0); this.mpos.fill(0); this.markAttr.needsUpdate = true; this.last = [null, null]; this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }
  // s: { x, z, heading, groundAt(x, z), sliding (bool), amount 0..1 (how hard), cam (PerspectiveCamera), viewH (px) }
  update(dt, s) {
    const fx = -Math.sin(s.heading), fz = -Math.cos(s.heading), rx = Math.cos(s.heading), rz = -Math.sin(s.heading);
    // tyre marks and smoke from the two rear wheels (1.45 m behind the middle, 0.62 m to each side)
    for (let w = 0; w < 2; w++) {
      const side = w ? 0.62 : -0.62, wx = s.x - fx * 1.45 + rx * side, wz = s.z - fz * 1.45 + rz * side;
      if (s.sliding) {
        const y = s.groundAt(wx, wz) + 0.04;
        const l = this.last[w];
        if (l && Math.hypot(wx - l.x, wz - l.z) > 0.18 && Math.hypot(wx - l.x, wz - l.z) < 8) {
          const dx = wx - l.x, dz = wz - l.z, dl = Math.hypot(dx, dz), nx = -dz / dl * 0.11, nz = dx / dl * 0.11, b = this.mi * 12;
          const p = this.mpos;
          p[b] = l.x + nx; p[b + 1] = l.y; p[b + 2] = l.z + nz; p[b + 3] = l.x - nx; p[b + 4] = l.y; p[b + 5] = l.z - nz;
          p[b + 6] = wx + nx; p[b + 7] = y; p[b + 8] = wz + nz; p[b + 9] = wx - nx; p[b + 10] = y; p[b + 11] = wz - nz;
          this.mi = (this.mi + 1) % this.M; this.dirty = true;
          l.x = wx; l.y = y; l.z = wz;
        } else if (!l || Math.hypot(wx - l.x, wz - l.z) >= 8) this.last[w] = { x: wx, y, z: wz };
        // smoke: ~25 puffs per second per wheel at full slide
        this.acc += dt * 25 * (0.4 + s.amount);
      } else this.last[w] = null;
    }
    while (this.acc >= 1) {
      this.acc -= 1;
      const w = Math.random() < 0.5 ? 0 : 1, side = w ? 0.62 : -0.62, j = this.i; this.i = (this.i + 1) % this.N;
      this.pos[j * 3] = s.x - fx * 1.45 + rx * side; this.pos[j * 3 + 1] = s.groundAt(s.x, s.z) + 0.3; this.pos[j * 3 + 2] = s.z - fz * 1.45 + rz * side;
      this.vel[j * 3] = -fx * 1.5 + (Math.random() - 0.5) * 1.2; this.vel[j * 3 + 1] = 0.7 + Math.random() * 0.6; this.vel[j * 3 + 2] = -fz * 1.5 + (Math.random() - 0.5) * 1.2;
      this.age[j] = 0; this.life[j] = 0.8 + Math.random() * 0.5;
    }
    for (let j = 0; j < this.N; j++) {
      if (this.age[j] >= this.life[j]) { this.alpha[j] = 0; continue; }
      this.age[j] += dt; const k = this.age[j] / this.life[j];
      this.pos[j * 3] += this.vel[j * 3] * dt; this.pos[j * 3 + 1] += this.vel[j * 3 + 1] * dt; this.pos[j * 3 + 2] += this.vel[j * 3 + 2] * dt;
      this.size[j] = 0.9 + 3.2 * k; this.alpha[j] = 0.5 * (1 - k) * (k < 0.12 ? k / 0.12 : 1);
    }
    const a = this.points.geometry.attributes; a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
    this.uSmoke.uScale.value = s.viewH * 0.5 / Math.tan(THREE.MathUtils.degToRad(s.cam.fov) / 2);
    if (this.dirty) { this.markAttr.needsUpdate = true; this.dirty = false; }
  }
}

// ---------------------------------------------------------------- all together (main.js builds it on the first Crazy Tuk run)
export class ArcadeFx {
  constructor(scene) {
    this.beacon = new GateBeacon(scene); this.arrow = new NavArrow(scene); this.drift = new DriftFx(scene);
    this.on = false; this.gateIdx = -1; this.enable(false);
  }
  // the beacon, the arrow and the smoke use their own shaders: compile them once at the start instead of on the first frame they are seen
  precompile(renderer, scene, camera) {
    const objs = [this.beacon.group, this.arrow.group, this.drift.points, this.drift.markMesh, this.beacon.burst];
    const was = objs.map((o) => o.visible);
    objs.forEach((o) => { o.visible = true; });
    try { renderer.compile(scene, camera); } catch (e) { /* compiled on first use then */ }
    objs.forEach((o, i) => { o.visible = was[i]; });
  }
  enable(on) {
    this.on = on;
    this.drift.points.visible = this.drift.markMesh.visible = on;
    if (!on) { this.beacon.group.visible = false; this.arrow.group.visible = false; this.beacon.set(null); this.gateIdx = -1; }
    else this.drift.reset();
  }
  // the active gate (arcade.js `gate`) changed: move the beacon
  setGate(run, groundAt) {
    const g = run && !run.done ? run.gate : null, idx = g ? run.next : -1;
    if (idx === this.gateIdx) return;
    this.gateIdx = idx; this.beacon.set(g, g ? groundAt(g.p[0], g.p[1]) : 0);
  }
}
