import * as THREE from 'three';
import { buildCity } from './city/buildCity.js';
import { CollisionWorld } from './vehicle/collision.js';
import { TukTukPhysics } from './vehicle/physics.js';
import { createTukTuk } from './vehicle/tuktuk.js';
import { KeyboardInput } from './input/keyboard.js';

const DT = 1 / 72;                 // fixed physics step
const EYE_HEIGHT = 1.42;           // desktop eye height above the cab floor
const SKY = 0xbfe3f5;
const params = new URLSearchParams(location.search);

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
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
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- load city ----------
status('Завантаження міста…');
const city = await (await fetch('data/city.json')).json();
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
world.addPolygon([R.minX + M, R.minZ + M, R.maxX - M, R.minZ + M, R.maxX - M, R.maxZ - M, R.minX + M, R.maxZ - M]);
world.finalize();

// ---------- tuk-tuk ----------
const tuk = createTukTuk();
scene.add(tuk.group);
const phys = new TukTukPhysics(world, city.start);
if (!phys.fits(phys.x, phys.z, phys.heading)) resetToRoad();

const cameraHolder = new THREE.Group(); // mouse-look yaw/pitch inside the cab
tuk.seat.add(cameraHolder);
cameraHolder.position.y = EYE_HEIGHT;
cameraHolder.add(camera);
scene.add(tuk.group);

const buildMs = performance.now() - t0;
console.log(`City built in ${buildMs.toFixed(0)} ms`, cityStats, `collision edges: ${world.edgeCount}`);

// ---------- input & camera modes ----------
const keys = new KeyboardInput();
const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
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

// Nearest road vertex where the tuk-tuk fits; heading along the road.
function resetToRoad() {
  let best = null, bestD = Infinity;
  for (const r of city.roads) {
    if (r.k === 'pedestrian' && r.w < 5) continue;
    const p = r.p;
    for (let i = 0; i < p.length / 2; i++) {
      const x = p[i * 2], z = p[i * 2 + 1];
      const d = (x - phys.x) ** 2 + (z - phys.z) ** 2;
      if (d >= bestD) continue;
      const j = i < p.length / 2 - 1 ? i + 1 : i - 1;
      let dx = p[j * 2] - x, dz = p[j * 2 + 1] - z;
      if (j < i) { dx = -dx; dz = -dz; }
      const h = Math.atan2(-dx, -dz);
      if (phys.fits(x, z, h)) { best = { x, z, h }; bestD = d; }
    }
  }
  if (best) phys.teleport(best.x, best.z, best.h);
}

// ---------- stats / FPS ----------
const perf = { fps: 0, frames: 0, since: performance.now(), calls: 0, tris: 0 };
const debugEl = $('debug');
let showStats = params.has('fps');
tuk.dashboard.showFps = showStats;
let dashTimer = 0;

// ---------- loop ----------
let acc = 0, last = performance.now();
const clock = { t: 0 };
const chasePos = new THREE.Vector3(), chaseLook = new THREE.Vector3(), tmpV = new THREE.Vector3();
let chaseInit = false;

function frame(now) {
  let frameDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock.t += frameDt;

  // one-shot keys
  if (keys.take('KeyR')) resetToRoad();
  if (keys.take('KeyC')) { setCamMode(camMode === 'cockpit' ? 'chase' : 'cockpit'); chaseInit = false; }
  if (keys.take('KeyF')) { showStats = !showStats; tuk.dashboard.showFps = showStats; }
  keys.read(frameDt, input);
  if (window.__autopilot) window.__autopilot(input, phys, clock.t);

  acc += frameDt;
  let steps = 0;
  while (acc >= DT && steps < 8) { phys.step(DT, input); acc -= DT; steps++; }
  if (steps === 8) acc = 0;

  // interpolate between the last two physics states for smooth motion at any refresh rate
  const a = acc / DT;
  const x = phys.prev.x + (phys.x - phys.prev.x) * a;
  const z = phys.prev.z + (phys.z - phys.prev.z) * a;
  let dh = phys.heading - phys.prev.heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  tuk.group.position.set(x, 0, z);
  tuk.group.rotation.y = phys.prev.heading + dh * a;

  if (camMode === 'cockpit') {
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

  renderer.render(scene, camera);
  perf.calls = renderer.info.render.calls;
  perf.tris = renderer.info.render.triangles;

  perf.frames++;
  if (now - perf.since >= 500) {
    perf.fps = (perf.frames * 1000) / (now - perf.since);
    perf.frames = 0; perf.since = now;
  }
  dashTimer -= frameDt;
  if (dashTimer <= 0) {
    dashTimer = 0.2;
    tuk.dashboard.draw({ speed: phys.forwardSpeed, fps: perf.fps, calls: perf.calls, tris: perf.tris });
    debugEl.style.display = showStats ? 'block' : 'none';
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
const start = () => { $('overlay').style.display = 'none'; renderer.domElement.focus(); };
startBtn.addEventListener('click', start);
if (params.has('autostart')) start();

// test / debugging hook
window.__game = { THREE, renderer, scene, camera, phys, world, city, cityStats, perf, input, resetToRoad, setCamMode, tuk };
