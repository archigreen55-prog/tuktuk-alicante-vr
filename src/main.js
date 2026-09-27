import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { VERSION } from './version.js';
import { buildCity } from './city/buildCity.js';
import { CollisionWorld } from './vehicle/collision.js';
import { TukTukPhysics, TUNING } from './vehicle/physics.js';
import { createTukTuk } from './vehicle/tuktuk.js';
import { Horn } from './vehicle/horn.js';
import { KeyboardInput } from './input/keyboard.js';
import { XRInput } from './input/xrInput.js';
import { XRRig } from './xr/xrRig.js';
import { ComfortOverlay, VIGNETTE_LEVELS } from './comfort/vignette.js';

const DT = 1 / 72;                 // fixed physics step
const EYE_HEIGHT = 1.42;           // eye height above the cab floor (desktop camera, VR recentre target)
const SKY = 0xbfe3f5;
const params = new URLSearchParams(location.search);

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };
$('version').textContent = `версія ${VERSION}`;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); // antialias = MSAA 4x in XR too
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(params.has('fov') ? +params.get('fov') : 1);           // three.js scale 0..1
renderer.xr.setFramebufferScaleFactor(params.has('fbs') ? +params.get('fbs') : 1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 250, 1500);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 3000);

scene.add(new THREE.HemisphereLight(0xe8f4ff, 0xb59c74, 1.6));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.position.set(-0.45, 0.8, 0.4).multiplyScalar(100); // Mediterranean sun from the south-west
scene.add(sun);

addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- load city ----------
status('Завантаження міста…');
const city = await (await fetch(`data/city.json?v=${VERSION}`)).json();
status(`Будую ${city.buildings.length} будинків…`);
await new Promise((r) => setTimeout(r, 0));
const t0 = performance.now();
const { group: cityGroup, stats: cityStats } = buildCity(city);
scene.add(cityGroup);

// ---------- collision world ----------
const R = city.meta.rect;
const world = new CollisionWorld(R);
for (const b of city.buildings) {
  world.addPolygon(b.p);
  for (const h of b.holes || []) world.addPolygon(h);
}
world.addPolygon(city.mount.foot);
world.addPolygon(city.sea);
const M = 5; // play-area bounds, a few metres inside the data bbox
const bounds = { minX: R.minX + M, maxX: R.maxX - M, minZ: R.minZ + M, maxZ: R.maxZ - M };
// hard wall as a last resort only: the soft edge in physics stops the tuk-tuk before it
world.addPolygon([bounds.minX, bounds.minZ, bounds.maxX, bounds.minZ, bounds.maxX, bounds.maxZ, bounds.minX, bounds.maxZ]);
world.finalize();

// ---------- tuk-tuk ----------
const tuk = createTukTuk({ version: VERSION });
scene.add(tuk.group);
const phys = new TukTukPhysics(world, city.start, bounds);
if (!phys.fits(phys.x, phys.z, phys.heading)) resetToRoad();

const cameraHolder = new THREE.Group(); // mouse-look yaw/pitch inside the cab
tuk.seat.add(cameraHolder);
cameraHolder.position.y = EYE_HEIGHT;
cameraHolder.add(camera);

const xrRig = new XRRig(renderer, tuk.seat, EYE_HEIGHT);
const comfort = new ComfortOverlay();
scene.add(comfort.mesh);
const horn = new Horn();

const buildMs = performance.now() - t0;
console.log(`City built in ${buildMs.toFixed(0)} ms`, cityStats, `collision edges: ${world.edgeCount}`);

// ---------- input & camera modes ----------
const keys = new KeyboardInput();
const xrIn = new XRInput();
const input = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false, reverseDelay: undefined };
let camMode = params.get('cam') === 'chase' ? 'chase' : 'cockpit';
let lookYaw = 0, lookPitch = 0, dragging = false;
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => { if (e.button === 2) dragging = true; });
addEventListener('mouseup', (e) => { if (e.button === 2) dragging = false; });
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  lookYaw = THREE.MathUtils.clamp(lookYaw - e.movementX * 0.004, -2.2, 2.2);
  lookPitch = THREE.MathUtils.clamp(lookPitch - e.movementY * 0.004, -1.0, 0.9);
});
renderer.domElement.addEventListener('dblclick', () => { lookYaw = 0; lookPitch = 0; });
addEventListener('keydown', () => horn.unlock(), { once: true });

function setCamMode(mode) {
  camMode = mode;
  if (mode === 'cockpit') {
    cameraHolder.add(camera);
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
  } else {
    scene.add(camera);
  }
}
setCamMode(camMode);

// Nearest road vertex where the tuk-tuk fits (away from the play-area edge); heading along the road.
function resetToRoad() {
  let best = null, bestD = Infinity;
  const edge = TUNING.edgeZone + 5;
  for (const r of city.roads) {
    if (r.k === 'pedestrian' && r.w < 5) continue;
    const p = r.p;
    for (let i = 0; i < p.length / 2; i++) {
      const x = p[i * 2], z = p[i * 2 + 1];
      const d = (x - phys.x) ** 2 + (z - phys.z) ** 2;
      if (d >= bestD) continue;
      if (x < bounds.minX + edge || x > bounds.maxX - edge || z < bounds.minZ + edge || z > bounds.maxZ - edge) continue;
      const j = i < p.length / 2 - 1 ? i + 1 : i - 1;
      let dx = p[j * 2] - x, dz = p[j * 2 + 1] - z;
      if (j < i) { dx = -dx; dz = -dz; }
      const h = Math.atan2(-dx, -dz);
      if (phys.fits(x, z, h)) { best = { x, z, h }; bestD = d; }
    }
  }
  if (best) phys.teleport(best.x, best.z, best.h);
}

// ---------- dashboard messages ----------
let flashText = '', flashT = 0, flashColor = '#ffd166';
function flash(text, seconds = 2, color = '#ffd166') { flashText = text; flashT = seconds; flashColor = color; dashTimer = 0; }

// ---------- VR session ----------
let inVR = false, firstRecenter = false;
renderer.xr.addEventListener('sessionstart', () => {
  inVR = true;
  firstRecenter = true;
  setCamMode('cockpit');
  xrRig.group.add(camera);
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  xrRig.recenter();
  comfort.blackout(); // black until the head pose is known, then fade in
  horn.unlock();
  $('overlay').style.display = 'none';
  // the system recentre (holding the Meta button) resets the reference space: recentre the seat too
  const space = renderer.xr.getReferenceSpace();
  if (space && space.addEventListener) space.addEventListener('reset', () => xrRig.recenter());
  renderer.xr.getSession().addEventListener('inputsourceschange', (e) => {
    for (const i of e.added) console.log(`XR input ${i.handedness}: ${i.profiles[0]}, ${i.gamepad ? i.gamepad.buttons.length + ' buttons, ' + i.gamepad.axes.length + ' axes' : 'no gamepad'}`);
  });
});
renderer.xr.addEventListener('sessionend', () => {
  inVR = false;
  horn.set(false);
  cameraHolder.add(camera);
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
  camera.scale.set(1, 1, 1);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  comfort.fade = 0;
  $('overlay').style.display = 'flex';
});

// ---------- stats / FPS ----------
const perf = { fps: 0, frames: 0, since: performance.now(), calls: 0, tris: 0 };
const debugEl = $('debug');
let showStats = params.has('fps');
tuk.dashboard.showFps = showStats;
let dashTimer = 0;
const vignetteOnDesktop = params.has('vignette'); // debugging: the vignette is a VR comfort feature

// ---------- loop ----------
let acc = 0, last = performance.now();
const clock = { t: 0 };
const chasePos = new THREE.Vector3(), chaseLook = new THREE.Vector3(), tmpV = new THREE.Vector3();
let chaseInit = false;

function toggleStats() { showStats = !showStats; tuk.dashboard.showFps = showStats; dashTimer = 0; }
function cycleVignette() {
  const level = comfort.cycleLevel();
  $('vignette').value = level.id;
  flash(`Віньєтка: ${level.label}`);
}

function frame(now, xrFrame) {
  const frameDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  clock.t += frameDt;

  // one-shot keys
  if (keys.take('KeyR')) resetToRoad();
  if (keys.take('KeyC') && !inVR) { setCamMode(camMode === 'cockpit' ? 'chase' : 'cockpit'); chaseInit = false; }
  if (keys.take('KeyF')) toggleStats();
  input.reverseDelay = undefined;
  keys.read(frameDt, input);

  if (inVR) {
    if (xrRig.update(xrFrame)) {
      comfort.fadeIn(firstRecenter ? 0.5 : 0.25);
      if (!firstRecenter) flash('Сидіння відцентровано');
      else flash('Газ — правий тригер, гальмо — лівий', 5);
      firstRecenter = false;
    }
    const act = xrIn.read(renderer.xr.getSession(), frameDt, input);
    if (act.fps) toggleStats();
    if (act.vignette) cycleVignette();
    if (act.recenter) xrRig.recenter();
    if (act.reset) { resetToRoad(); comfort.fadeIn(0.3); }
  }
  horn.set(input.horn);
  if (window.__autopilot) window.__autopilot(input, phys, clock.t);

  acc += frameDt;
  let steps = 0, impact = 0;
  while (acc >= DT && steps < 8) {
    phys.step(DT, input);
    impact = Math.max(impact, phys.lastImpact);
    acc -= DT; steps++;
  }
  if (steps === 8) acc = 0;
  if (inVR && impact > 1.5) xrIn.pulse(Math.min(1, impact / 6), 40 + Math.min(80, impact * 15));

  // interpolate between the last two physics states for smooth motion at any refresh rate
  const a = acc / DT;
  const x = phys.prev.x + (phys.x - phys.prev.x) * a;
  const z = phys.prev.z + (phys.z - phys.prev.z) * a;
  let dh = phys.heading - phys.prev.heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  tuk.group.position.set(x, 0, z);
  tuk.group.rotation.y = phys.prev.heading + dh * a;

  if (inVR) {
    // head pose comes from the headset, under xrRig
  } else if (camMode === 'cockpit') {
    cameraHolder.rotation.set(lookPitch, lookYaw, 0, 'YXZ');
  } else {
    const h = tuk.group.rotation.y;
    tmpV.set(Math.sin(h) * 7 + x, 3.2, Math.cos(h) * 7 + z);
    if (!chaseInit) { chasePos.copy(tmpV); chaseInit = true; }
    chasePos.lerp(tmpV, 1 - Math.exp(-frameDt * 4));
    camera.position.copy(chasePos);
    chaseLook.set(x, 1.2, z);
    camera.lookAt(chaseLook);
  }
  comfort.update(frameDt, phys, impact, (inVR || vignetteOnDesktop) && camMode === 'cockpit');

  renderer.render(scene, camera);
  perf.calls = renderer.info.render.calls;
  perf.tris = renderer.info.render.triangles;

  perf.frames++;
  if (now - perf.since >= 500) {
    perf.fps = (perf.frames * 1000) / (now - perf.since);
    perf.frames = 0; perf.since = now;
  }
  flashT -= frameDt;
  dashTimer -= frameDt;
  if (dashTimer <= 0) {
    dashTimer = 0.2;
    let msg = '', msgColor;
    if (flashT > 0) { msg = flashText; msgColor = flashColor; }
    else if (phys.edgeDist < TUNING.edgeZone) msg = 'Повертайся до центру';
    tuk.dashboard.draw({ speed: phys.forwardSpeed, fps: perf.fps, calls: perf.calls, tris: perf.tris, msg, msgColor });
    debugEl.style.display = showStats && !inVR ? 'block' : 'none';
    if (showStats) {
      debugEl.textContent = `${perf.fps.toFixed(0)} FPS\ncalls ${perf.calls}  tris ${perf.tris}\n` +
        `speed ${(phys.forwardSpeed * 3.6).toFixed(1)} km/h  pos ${phys.x.toFixed(0)}, ${phys.z.toFixed(0)}`;
    }
  }
  keys.endFrame();
}
renderer.setAnimationLoop(frame);

// ---------- start overlay ----------
const startBtn = $('start');
startBtn.disabled = false;
startBtn.textContent = 'Грати (клавіатура)';
status(`${city.buildings.length} будинків · ${city.roads.length} вулиць · зібрано за ${buildMs.toFixed(0)} мс`);
const start = () => { horn.unlock(); $('overlay').style.display = 'none'; renderer.domElement.focus(); };
startBtn.addEventListener('click', start);
if (params.has('autostart')) start();

const vrButton = VRButton.createButton(renderer);
vrButton.id = 'vrbutton';
$('buttons').appendChild(vrButton);

const select = $('vignette');
for (const l of VIGNETTE_LEVELS) select.add(new Option(l.label, l.id));
select.value = comfort.level.id;
select.addEventListener('change', () => comfort.setLevel(VIGNETTE_LEVELS.find((l) => l.id === select.value)));

// test / debugging hook
window.__game = { THREE, renderer, scene, camera, phys, world, city, cityStats, perf, input, resetToRoad, setCamMode, tuk, xrRig, xrIn, comfort, VERSION };
