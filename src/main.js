import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { VERSION } from './version.js';
import { buildCity } from './city/buildCity.js';
import { buildTiles, showTilesPage } from './city/tiles.js';
import { loadPhotoFacades, creditLine } from './city/landmarks.js';
import { loadModels, modelCreditLine } from './city/models.js';
import { CollisionWorld } from './vehicle/collision.js';
import { TukTukPhysics, TUNING } from './vehicle/physics.js';
import { createTukTuk, SEATS } from './vehicle/tuktuk.js';
import { Horn } from './vehicle/horn.js';
import { KeyboardInput } from './input/keyboard.js';
import { XRInput } from './input/xrInput.js';
import { HandlebarControl } from './input/handlebarInput.js';
import { GpuTimer } from './perf/gpuTimer.js';
import { loadSetting, saveSetting } from './settings.js';
import { XRRig } from './xr/xrRig.js';
import { ComfortOverlay, VIGNETTE_LEVELS } from './comfort/vignette.js';
import { RoadGraph } from './game/route.js';
import { Tour } from './game/tour.js';
import { StopMarker } from './game/markers.js';
import { Tourists } from './game/tourists.js';
import { Minimap } from './ui/minimap.js';
import { DesktopHud } from './ui/hud.js';
import { clock as fmtClock, euro } from './ui/dashboard.js';

const DT = 1 / 72;                 // fixed physics step
const EYE_HEIGHT = 1.42;           // eye height above the cab floor (desktop camera, VR recentre target)
const SKY = 0xbfe3f5;
const params = new URLSearchParams(location.search);
const STRESS_LEVELS = [1, 2, 3, 4, 6, 8];  // ?stress=N: the scene is rendered N times per frame
let stress = Math.max(1, Math.round(+params.get('stress') || 1));
// ?tex=0 plain vertex colours (0.5.0 look), ?tex=low facades only, default: everything textured
const texMode = ['0', 'off', 'no'].includes(params.get('tex')) ? 'off' : params.get('tex') === 'low' ? 'low' : 'full';
// ?photo=0: landmarks without photo facades (procedural walls, as in 0.7.0), for A/B FPS checks
const photoMode = !['0', 'off', 'no'].includes(params.get('photo'));
// ?model=0: without the 3D models (scans) of landmarks, for A/B FPS checks
const modelMode = !['0', 'off', 'no'].includes(params.get('model'));

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

// ---------- textures (drawn by code) ----------
const ANISOTROPY = Math.min(8, renderer.capabilities.getMaxAnisotropy());
status('Малюю текстури…');
const tiles = texMode === 'off' ? null : buildTiles(ANISOTROPY);
if (params.has('tiles')) { showTilesPage(tiles || buildTiles(ANISOTROPY)); $('overlay').style.display = 'none'; }
if (tiles) console.log(`Tiles drawn in ${tiles.ms.toFixed(0)} ms, ${(tiles.bytes / 1048576).toFixed(1)} MB (+mips), anisotropy ${ANISOTROPY}`);

// ---------- load city ----------
status('Завантаження міста…');
const city = await (await fetch(`data/city.json?v=${VERSION}`)).json();
// tour texts and routes: edited by hand, so always fresh (no cache) and never fatal
let tourSpec = null, tourError = '';
try {
  const res = await fetch(`data/tour.json?t=${Date.now()}`, { cache: 'no-store' });
  const text = await res.text();
  try { tourSpec = JSON.parse(text); } catch (e) { tourError = `помилка в data/tour.json: ${e.message}`; }
  if (tourSpec && (!Array.isArray(tourSpec.tours) || !tourSpec.places)) { tourError = 'data/tour.json: немає "tours" або "places"'; tourSpec = null; }
} catch (e) { tourError = `data/tour.json не завантажився: ${e.message}`; }
if (!city.tour) tourError = tourError || 'city.json без даних туру (node tools/build-city.mjs)';
if (tourError) console.warn(tourError);
// photo facades and 3D models of landmarks (data/facades.json is edited by hand: always fresh, never fatal)
let photos = null, models = null, facadeSpec = null;
if (photoMode || modelMode) {
  try { facadeSpec = await (await fetch(`data/facades.json?t=${Date.now()}`, { cache: 'no-store' })).json(); } catch (e) { console.warn(`data/facades.json: ${e.message}`); }
}
if (photoMode && facadeSpec) {
  status('Фото фасадів…');
  try {
    photos = await loadPhotoFacades(city, facadeSpec, { version: VERSION, anisotropy: ANISOTROPY });
    if (photos) console.log(`Photo facades: ${photos.stats.photos} photos, atlas ${photos.stats.atlas} (${photos.stats.mb} MB with mips), ${photos.stats.ms} ms`);
  } catch (e) { console.warn(`photo facades: ${e.message}`); }
}
if (modelMode && facadeSpec) {
  status('3D-моделі пам\'яток…');
  try {
    models = await loadModels(city, facadeSpec, { renderer, version: VERSION });
    if (models) console.log(`Landmark models: ${models.stats.models} models, ${models.stats.tris} triangles, ${models.stats.ms} ms`);
  } catch (e) { console.warn(`landmark models: ${e.message}`); }
}
// the tour card of a place shows who took the photos / made the scans of its building
if (city.tour) for (const pl of Object.values(city.tour.places)) pl.credit = [creditLine(photos, pl.osm), modelCreditLine(models, pl.osm)].filter(Boolean).join(' · ');
status(`Будую ${city.buildings.length} будинків…`);
await new Promise((r) => setTimeout(r, 0));
const t0 = performance.now();
const { group: cityGroup, stats: cityStats } = buildCity(city, { texMode, tiles, sky: SKY, photos, cuts: models && models.cuts });
scene.add(cityGroup);
if (models) { scene.add(models.group); Object.assign(cityStats, { models: models.stats.models, modelTris: models.stats.tris }); }

// ---------- collision world ----------
const R = city.meta.rect;
const world = new CollisionWorld(R);
for (const b of city.buildings) {
  world.addPolygon(b.p);
  for (const h of b.holes || []) world.addPolygon(h);
}
for (const f of models ? models.footprints : []) world.addPolygon(f); // parts of 3D models standing out of a wall
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
const bars = new HandlebarControl(tuk.handlebar);
let steeringMode = loadSetting('steering', 'stick') === 'hands' ? 'hands' : 'stick';
// Engine vibration is off by default since 0.6.0 (it got in the way in the headset). A value saved by
// an earlier version is reset to "off" once; after that the checkbox on the start screen decides.
if (loadSetting('engineVibrationReset', 0) < 1) { saveSetting('engineVibration', false); saveSetting('engineVibrationReset', 1); }
bars.engineVibration = loadSetting('engineVibration', false) === true;
let pedal = 0;

// ---------- tour (stage 6) ----------
const graph = city.tour ? new RoadGraph(city.tour.graph) : null;
const minimap = new Minimap(city);
minimap.mesh.position.set(-0.375, 1.134, -0.875);
minimap.mesh.rotation.x = -0.45;
tuk.group.add(minimap.mesh);
const marker = new StopMarker(scene);
const tourists = new Tourists(scene, tuk.group, SEATS);
const hud = new DesktopHud(minimap);
let mapOn = loadSetting('minimap', true) !== false;
let gameMode = params.get('mode') === 'free' || params.get('mode') === 'tour' ? params.get('mode') : loadSetting('mode', 'tour');
let tourId = params.get('tour') || loadSetting('tourId', 'short');
if (tourSpec && !tourSpec.tours.some((t) => t.id === tourId)) tourId = tourSpec.tours[0]?.id;
let tour = null, freeConfirm = -1e9;

const buildMs = performance.now() - t0;
console.log(`City built in ${buildMs.toFixed(0)} ms`, cityStats, `collision edges: ${world.edgeCount}`);
// compile the shaders now (loading screen), not in the first frame
status('Компілюю шейдери…');
await new Promise((r) => setTimeout(r, 0));
const tc0 = performance.now();
renderer.compile(scene, camera);
console.log(`Shaders compiled in ${(performance.now() - tc0).toFixed(0)} ms`);

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
  lookYaw = THREE.MathUtils.clamp(lookYaw - e.movementX * 0.004, -2.9, 2.9); // far enough to see the passengers
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
  if (tour) tour.onReset();
}

// ---------- dashboard messages ----------
let flashText = '', flashT = 0, flashColor = '#ffd166';
function flash(text, seconds = 2, color = '#ffd166') { flashText = text; flashT = seconds; flashColor = color; dashTimer = 0; }

// ---------- tour control ----------
function startTour() {
  if (!tourSpec || !graph) { tour = null; flash(tourError || 'Тур недоступний', 5, '#ff7a5c'); return false; }
  try { tour = new Tour(tourSpec, city.tour, graph, tourId); } catch (e) {
    tour = null; tourError = `Тур: ${e.message}`; flash(tourError, 6, '#ff7a5c'); console.warn(tourError); return false;
  }
  const cands = tour.spawnCandidates();
  const spawn = cands.find((c) => phys.fits(c.x, c.z, c.heading)) || cands[0];
  phys.teleport(spawn.x, spawn.z, spawn.heading);
  tourists.setup(tour.group, tour.groupPos, tour.groupFacing);
  tourists.visible = true;
  lookYaw = 0; lookPitch = 0;
  return true;
}
function setGameMode(mode) {
  gameMode = mode;
  saveSetting('mode', mode);
  $('mode').value = mode;
  if (mode === 'tour') { if (inVR) comfort.fadeIn(0.35); startTour(); }
  else {
    tour = null; tourists.dispose();
    phys.teleport(city.start.x, city.start.z, city.start.heading);
    if (!phys.fits(phys.x, phys.z, phys.heading)) resetToRoad();
  }
  updateBestLabel();
}
// Y (VR) / T: new tour after the summary; restart / start from free ride needs a second press
function tourButton() {
  if (!tour) {
    if (clock.t - freeConfirm < 2) setGameMode('tour');
    else { freeConfirm = clock.t; flash('Натисни ще раз — почати тур', 2); }
    return;
  }
  if (tour.action()) { if (inVR) comfort.fadeIn(0.35); startTour(); }
  else handleTourEvents();
}
function handleTourEvents() {
  for (const ev of tour.events) {
    if (ev.type === 'flash') flash(ev.text, ev.seconds || 2, ev.color);
    else if (ev.type === 'board') tourists.board();
    else if (ev.type === 'boardAbort') tourists.abortBoard();
    else if (ev.type === 'seated') tourists.seatAll();
    else if (ev.type === 'dropoff') tourists.dropOff(tour.start.look);
    else if (ev.type === 'summary') saveBest(tour.result);
  }
  tour.events = [];
}
const bestKey = () => `best.${tourId}`;
function saveBest(r) {
  const b = loadSetting(bestKey(), null);
  const better = !b || r.stars > b.stars || (r.stars === b.stars && r.tips > b.tips);
  tour.result.prevBest = b;
  if (better) saveSetting(bestKey(), { stars: r.stars, tips: r.tips, time: Math.round(r.time) });
  updateBestLabel();
}
function bestText(b) { return b ? `Найкраще: ${'★'.repeat(b.stars)}${'☆'.repeat(5 - b.stars)} · ${euro(b.tips)} · ${fmtClock(b.time)}` : ''; }
function updateBestLabel() { const el = $('best'); if (el) el.textContent = gameMode === 'tour' ? bestText(loadSetting(bestKey(), null)) : ''; }
const fmtDist = (d) => (d < 1000 ? `${Math.round(d / 10) * 10} м` : `${(d / 1000).toFixed(1)} км`);
const EVENT_NAMES = { brake: 'різке гальмування', emergency: 'екстрене гальмування', turn: 'швидкий поворот', danger: 'небезпечний поворот', touch: 'дотик до стіни', hit: 'удар', hitHard: 'сильний удар', scrape: 'шкрябання', nearPeople: 'швидко біля людей', reset: 'повернення на дорогу', leftEarly: 'поїхав під час фото' };
// what the dashboard and the desktop HUD show for the tour (null in free ride)
function tourPanel() {
  if (!tour) return null;
  const T = tour, st = T.state, btn = inVR ? 'Y' : 'T';
  if (st === 'summary') {
    const r = T.result;
    const ev = Object.entries(r.counts).filter(([, n]) => n > 0).map(([k, n]) => `${EVENT_NAMES[k] || k} ×${n}`).join(', ');
    return {
      mode: 'summary', stars: r.stars, tips: r.tips, time: r.time, target: r.target, onTime: r.onTime,
      events: `Настрій ${r.mood} %${ev ? ': ' + ev : ' — жодної різкої події!'}${r.passCount ? ` · факти на ходу ${r.passes}/${r.passCount}` : ''}`,
      review: r.reviewText, best: r.prevBest ? `Було найкраще: ${bestText(r.prevBest).replace('Найкраще: ', '')}` : 'Перший результат збережено',
      footer: `${btn} — новий тур`,
    };
  }
  if (T.card && (st === 'photo' || st === 'afterPhoto')) {
    return { mode: 'card', title: T.card.title, body: T.card.body, footer: T.card.footer, credit: T.card.credit, counter: `${T.stopsDone + (st === 'photo' ? 1 : 0)}/${T.stopCount}` };
  }
  const tg = T.target;
  const d = tg ? Math.hypot(tg.x - phys.x, tg.z - phys.z) : 0;
  if (st === 'waiting' || st === 'boarding') {
    return { mode: 'drive', line1: `Посадка · ${T.def.title}`, title: `Туристи чекають: ${T.start.title}`, line3: fmtDist(d), dial: true, group: T.group,
      hint: st === 'boarding' ? 'Туристи сідають…' : 'Під\x27їдь повільно й зупинись у жовтій зоні', text: T.text };
  }
  if (!tg) return { mode: 'drive', line1: T.def.title, title: 'Туристи виходять…', line3: '', mood: T.mood, tips: T.tipsEstimate, group: T.group, text: T.text };
  const line1 = tg.kind === 'pass' ? `Факт на ходу · зупинка ${T.stopIndex}/${T.stopCount} далі` : tg.kind === 'finish' ? 'Фініш — назад до готелю' : `Зупинка ${T.stopIndex}/${T.stopCount}`;
  return { mode: 'drive', line1, title: tg.title, line3: `${fmtDist(d)} · ⏱ ${fmtClock(T.clock)} / ${fmtClock(T.targetTime)}`,
    mood: T.mood, tips: T.tipsEstimate, group: T.group, dial: true, text: T.text };
}

// ---------- VR session ----------
let inVR = false, firstRecenter = false, vrStart = 0, autoHzDone = false;
const fpsWindow = { frames: 0, since: 0 }; // 3 s window for the automatic 72 Hz fallback
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
  const session = renderer.xr.getSession();
  vrStart = performance.now();
  fpsWindow.frames = 0; fpsWindow.since = vrStart;
  if (params.has('hz') && session.updateTargetFrameRate) session.updateTargetFrameRate(+params.get('hz')).catch(() => {});
  session.addEventListener('inputsourceschange', (e) => {
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
const gpu = new GpuTimer(renderer.getContext());
const cpu = { sum: 0, n: 0, ms: null };
if (stress > 1) showStats = tuk.dashboard.showFps = true;

// ---------- loop ----------
let acc = 0, last = performance.now(), mapTimer = 0;
const clock = { t: 0 };
const chasePos = new THREE.Vector3(), chaseLook = new THREE.Vector3(), tmpV = new THREE.Vector3();
let chaseInit = false;

function toggleStats() { showStats = !showStats; tuk.dashboard.showFps = showStats; dashTimer = 0; }
function nextStress() {
  stress = STRESS_LEVELS[(STRESS_LEVELS.indexOf(stress) + 1) % STRESS_LEVELS.length] || 1;
  showStats = tuk.dashboard.showFps = true;
  flash(stress > 1 ? `Навантаження ×${stress}` : 'Навантаження вимкнено');
}
function setSteeringMode(mode) {
  steeringMode = mode;
  saveSetting('steering', mode);
  $('steering').value = mode;
}
const modeHint = () => (steeringMode === 'hands'
  ? 'Затисни обидва grip — кермо, крути праву ручку — газ'
  : 'Газ — правий тригер, гальмо — лівий');
// Drop to 72 Hz once if the headset cannot hold its current rate (plan: steady 72 beats jittery 80-90).
function autoFrameRate(now) {
  fpsWindow.frames++;
  if (autoHzDone || stress > 1 || params.has('hz') || now - vrStart < 6000) { if (now - fpsWindow.since > 3000) { fpsWindow.frames = 0; fpsWindow.since = now; } return; }
  if (now - fpsWindow.since < 3000) return;
  const fps = fpsWindow.frames * 1000 / (now - fpsWindow.since);
  fpsWindow.frames = 0; fpsWindow.since = now;
  const s = renderer.xr.getSession();
  const rates = s && s.supportedFrameRates;
  if (!s || !s.updateTargetFrameRate || !rates || !Array.from(rates).includes(72) || !(s.frameRate > 73)) return;
  if (fps < 86) {
    autoHzDone = true;
    s.updateTargetFrameRate(72).then(() => flash(`Частота 72 Гц (було ${fps.toFixed(0)} FPS)`, 4)).catch(() => {});
  }
}
function cycleVignette() {
  const level = comfort.cycleLevel();
  $('vignette').value = level.id;
  flash(`Віньєтка: ${level.label}`);
}

function frame(now, xrFrame) {
  const cpuStart = performance.now();
  const frameDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  clock.t += frameDt;

  // one-shot keys
  if (keys.take('KeyR')) resetToRoad();
  if (keys.take('KeyC') && !inVR) { setCamMode(camMode === 'cockpit' ? 'chase' : 'cockpit'); chaseInit = false; }
  if (keys.take('KeyF')) toggleStats();
  if (keys.take('KeyG')) nextStress();
  if (keys.take('KeyT')) tourButton();
  if (keys.take('KeyM')) { mapOn = !mapOn; saveSetting('minimap', mapOn); }
  input.reverseDelay = undefined;
  keys.read(frameDt, input);

  if (inVR) {
    if (xrRig.update(xrFrame)) {
      comfort.fadeIn(firstRecenter ? 0.5 : 0.25);
      if (!firstRecenter) flash('Сидіння відцентровано');
      else flash(modeHint(), 5);
      firstRecenter = false;
    }
    const act = xrIn.read(renderer.xr.getSession(), frameDt, input, steeringMode);
    if (act.fps) toggleStats();
    if (act.stress) nextStress();
    if (act.vignette) cycleVignette();
    if (act.recenter) xrRig.recenter();
    if (act.tour) tourButton();
    if (act.reset) { resetToRoad(); comfort.fadeIn(0.3); }
    if (act.mode) {
      setSteeringMode(steeringMode === 'hands' ? 'stick' : 'hands');
      flash(steeringMode === 'hands' ? 'Кермо: руки (затисни обидва grip)' : 'Кермо: стік');
    }
    autoFrameRate(now);
  }
  bars.update(frameDt, {
    vr: inVR, mode: steeringMode, xrFrame, refSpace: inVR ? renderer.xr.getReferenceSpace() : null,
    rig: xrRig.group, xrIn, speed: phys.forwardSpeed, now,
  }, input);
  if (inVR) {
    xrRig.showController('left', !bars.leftHeld);
    xrRig.showController('right', !bars.rightHeld);
  }
  pedal += (input.brake - pedal) * (1 - Math.exp(-frameDt / 0.06));
  tuk.setPedal(pedal);
  horn.set(input.horn);
  if (window.__autopilot) window.__autopilot(input, phys, clock.t);
  // tour: while boarding / taking photos, holding the brake keeps the tuk-tuk still (no reversing)
  if (tour && tour.holdBrake) input.reverseDelay = Infinity;

  acc += frameDt;
  let steps = 0, impact = 0;
  while (acc >= DT && steps < 8) {
    phys.step(DT, input);
    impact = Math.max(impact, phys.lastImpact);
    acc -= DT; steps++;
  }
  if (steps === 8) acc = 0;
  if (inVR && impact > 1.5) {
    xrIn.pulse('both', Math.min(1, impact / 6), 40 + Math.min(80, impact * 15));
    bars.quietUntil = now + 150;
  }

  // interpolate between the last two physics states for smooth motion at any refresh rate
  const a = acc / DT;
  const x = phys.prev.x + (phys.x - phys.prev.x) * a;
  const z = phys.prev.z + (phys.z - phys.prev.z) * a;
  let dh = phys.heading - phys.prev.heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  tuk.group.position.set(x, 0, z);
  tuk.group.rotation.y = phys.prev.heading + dh * a;
  tuk.group.updateMatrixWorld();

  // ---------- tour ----------
  if (tour) {
    tour.update({ dt: frameDt, x: phys.x, z: phys.z, speed: phys.forwardSpeed, accel: phys.accel, yawRate: phys.yawRate,
      brake: input.brake, reversing: phys.reversing, impact, contact: phys.contactTimer > 0, handbrake: input.handbrake });
    handleTourEvents();
  }
  tourists.update(frameDt);
  camera.getWorldPosition(tmpV);
  marker.update(frameDt, tour ? tour.zone : null, tmpV, !!(tour && tour.holdBrake));
  const target = tour ? tour.target : null;
  const h = tuk.group.rotation.y;
  minimap.mesh.visible = mapOn || inVR;
  minimap.setRoute(tour ? tour.route : null, tour ? tour.routeVersion : -1);
  minimap.update(frameDt, x, z, h, phys.forwardSpeed, target);
  const tvx = target ? target.x - x : 0, tvz = target ? target.z - z : 0;
  if (target && Math.hypot(tvx, tvz) > 10 && tour.state !== 'boarding' && tour.state !== 'photo' && tour.state !== 'afterPhoto') {
    const vx = tvx, vz = tvz, dist = Math.hypot(vx, vz);
    const ang = Math.atan2(vx * Math.cos(h) - vz * Math.sin(h), -vx * Math.sin(h) - vz * Math.cos(h));
    tuk.dashboard.setArrow(ang, Math.abs(ang) > 2.1 ? 0xff9f43 : dist < 50 ? 0x55ee77 : 0xffcc33);
  } else tuk.dashboard.setArrow(null);
  mapTimer -= frameDt;
  if (mapTimer <= 0) { mapTimer = 0.1; hud.drawMap(!inVR && mapOn, x, z, h, target, tour ? tour.route : null); }

  if (inVR) {
    // head pose comes from the headset, under xrRig
  } else if (camMode === 'cockpit') {
    cameraHolder.rotation.set(lookPitch, lookYaw, 0, 'YXZ');
  } else if (camMode === 'chase') {
    const h = tuk.group.rotation.y;
    tmpV.set(Math.sin(h) * 7 + x, 3.2, Math.cos(h) * 7 + z);
    if (!chaseInit) { chasePos.copy(tmpV); chaseInit = true; }
    chasePos.lerp(tmpV, 1 - Math.exp(-frameDt * 4));
    camera.position.copy(chasePos);
    chaseLook.set(x, 1.2, z);
    camera.lookAt(chaseLook);
  }
  comfort.update(frameDt, phys, impact, (inVR || vignetteOnDesktop) && camMode === 'cockpit');

  gpu.poll();
  gpu.begin();
  for (let i = 0; i < stress; i++) renderer.render(scene, camera);
  gpu.end();
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
    else if (bars.invalid) msg = 'Тримай руки по боках';
    else if (steeringMode === 'hands' && inVR && bars.releasedFor > 1.5 && Math.abs(phys.forwardSpeed) > 1 && !xrIn.stickActive) msg = 'Візьмись за кермо (grip)';
    const session = inVR && renderer.xr.getSession();
    const gpuMs = gpu.take(), cpuMs = cpu.n ? (cpu.ms = cpu.sum / cpu.n, cpu.sum = cpu.n = 0, cpu.ms) : cpu.ms;
    const panel = tourPanel();
    tuk.dashboard.draw({
      speed: phys.forwardSpeed, msg, msgColor, tour: panel,
      stats: showStats ? { fps: Math.round(perf.fps), calls: perf.calls, tris: perf.tris, hz: session && session.frameRate ? Math.round(session.frameRate) : 0,
        gpuMs: gpuMs == null ? null : Math.round(gpuMs * 10) / 10, cpuMs: cpuMs == null ? null : Math.round(cpuMs * 10) / 10, stress } : null,
    });
    hud.update(!inVR, panel);
    debugEl.style.display = showStats && !inVR ? 'block' : 'none';
    if (showStats) {
      debugEl.textContent = `${perf.fps.toFixed(0)} FPS\ncalls ${perf.calls}  tris ${perf.tris}\n` +
        `speed ${(phys.forwardSpeed * 3.6).toFixed(1)} km/h  pos ${phys.x.toFixed(0)}, ${phys.z.toFixed(0)}`;
    }
  }
  keys.endFrame();
  cpu.sum += performance.now() - cpuStart; cpu.n++;
}
renderer.setAnimationLoop(frame);

// ---------- start overlay ----------
const startBtn = $('start');
startBtn.disabled = false;
startBtn.textContent = 'Грати (клавіатура)';
status(`${city.buildings.length} будинків · ${city.roads.length} вулиць · зібрано за ${buildMs.toFixed(0)} мс${tiles ? ` · ${tiles.preview.facade.length + tiles.preview.ground.length + 1} плиток за ${tiles.ms.toFixed(0)} мс` : ' · без текстур'}${photos ? ` · ${photos.stats.photos} фото фасадів за ${photos.stats.ms} мс` : ''}${models ? ` · ${models.stats.models} 3D-модел${models.stats.models === 1 ? 'ь' : 'і'} за ${models.stats.ms} мс` : ''}`);
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
$('steering').value = steeringMode;
$('steering').addEventListener('change', () => setSteeringMode($('steering').value));
// game mode and tour (stage 6)
const modeSel = $('mode'), tourSel = $('tourSel');
for (const t of tourSpec?.tours || []) tourSel.add(new Option(t.title || t.id, t.id));
tourSel.value = tourId;
modeSel.value = gameMode;
modeSel.addEventListener('change', () => setGameMode(modeSel.value));
tourSel.addEventListener('change', () => { tourId = tourSel.value; saveSetting('tourId', tourId); if (gameMode === 'tour') startTour(); updateBestLabel(); });
if (tourError) { $('tourError').textContent = tourError; $('tourError').style.display = 'block'; }
if (!tourSpec || !graph) { modeSel.value = 'free'; modeSel.disabled = tourSel.disabled = true; if (gameMode === 'tour') gameMode = 'free'; }
if (gameMode === 'tour' && !startTour()) gameMode = 'free';
updateBestLabel();
$('vibration').checked = bars.engineVibration;
$('vibration').addEventListener('change', () => { bars.engineVibration = $('vibration').checked; saveSetting('engineVibration', bars.engineVibration); });

// test / debugging hook
window.__game = { photos, models, get tour() { return tour; }, startTour, setGameMode, tourists, minimap, marker, graph, tourSpec, hud, tourPanel, THREE, renderer, scene, camera, phys, world, city, cityStats, perf, input, resetToRoad, setCamMode, tuk, xrRig, xrIn, comfort, bars, gpu, VERSION, tiles, texMode, look: (y, p) => { lookYaw = y; lookPitch = p; }, freeCam: (x, y, z, tx, ty, tz) => { setCamMode('free'); camera.position.set(x, y, z); camera.lookAt(tx, ty, tz); }, get stress() { return stress; }, get steeringMode() { return steeringMode; } };
