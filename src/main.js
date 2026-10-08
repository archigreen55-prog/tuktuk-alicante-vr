import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { VERSION } from './version.js';
import { buildCity } from './city/buildCity.js';
import { Terrain } from './city/terrain.js';
import { buildTiles, showTilesPage } from './city/tiles.js';
import { loadPhotoFacades, creditLine } from './city/landmarks.js';
import { loadModels, modelCreditLine } from './city/models.js';
import { CollisionWorld } from './vehicle/collision.js';
import { TukTukPhysics, TUNING, ARCADE } from './vehicle/physics.js';
import { Arcade } from './game/arcade.js';
import { ArcadeCam } from './game/arcadeCam.js';
import { ArcadeFx } from './game/arcadeFx.js';
import { ArcadeSound } from './audio/arcadeSound.js';
import { createArcadeHud } from './ui/arcadeHud.js';
import { bookingLink } from './config.js';
import { createTukTuk, SEATS } from './vehicle/tuktuk.js';
import { Horn, shout } from './vehicle/horn.js';
import { KeyboardInput } from './input/keyboard.js';
import { XRInput } from './input/xrInput.js';
import { HandlebarControl } from './input/handlebarInput.js';
import { GpuTimer } from './perf/gpuTimer.js';
import { loadSetting, saveSetting } from './settings.js';
import { createFullMap } from './ui/fullMap.js';
import { XRRig } from './xr/xrRig.js';
import { ComfortOverlay, VIGNETTE_LEVELS } from './comfort/vignette.js';
import { RoadGraph } from './game/route.js';
import { Tour } from './game/tour.js';
import { StopMarker } from './game/markers.js';
import { Tourists } from './game/tourists.js';
import { Minimap } from './ui/minimap.js';
import { DesktopHud } from './ui/hud.js';
import { clock as fmtClock, euro, euroWhole } from './ui/dashboard.js';
import { IS_PHONE, UI, installRotateGuard } from './diag/device.js';
import { FrameCap } from './perf/frameCap.js';
import { FrameStats } from './diag/frameStats.js';
import { Bench, buildStations } from './diag/bench.js';
import { buildReport } from './diag/report.js';
import { createDiagUI } from './diag/ui.js';
import { TouchControls } from './input/touchControls.js';
import { verticalFov } from './input/touchMath.js';
import { createPhoneUi } from './ui/phoneUi.js';
import { screenReport } from './ui/screenMode.js';

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
// ?terrain=0: flat city (every height 0), for A/B comparison of FPS and driving
const terrainMode = !['0', 'off', 'no'].includes(params.get('terrain'));
// cab tilt with the road (plan-terrain.md 6): full / half / off, remembered
const TILT_LEVELS = [{ id: 'full', label: 'повний', k: 1 }, { id: 'half', label: 'половина', k: 0.5 }, { id: 'off', label: 'вимкнено', k: 0 }];
let tilt = TILT_LEVELS.find((l) => l.id === loadSetting('tilt', 'full')) || TILT_LEVELS[0];
const cab = { pitch: 0, roll: 0, pitchRate: 0, snap: false }; // smoothed cab attitude (snap: jump to the ground after a teleport)
let chaseInit = false;  // chase camera placed (reset after teleports)
// phone stage F0 (docs/plan-phone.md): ?bench[=N] runs the automatic FPS measurement (N rounds), ?diag shows
// the FPS widget on any device, ?cap=N limits the frame rate (default 60 on a phone, none elsewhere; not in VR),
// ?dpr=N sets the pixel ratio (default min(devicePixelRatio, 1.5)); ?ui=phone|desktop is handled in index.html
const benchOn = params.has('bench');
const benchPasses = Math.max(1, Math.min(20, Math.round(+params.get('bench') || 1)));
const capFps = params.has('cap') ? Math.max(0, +params.get('cap') || 0) : IS_PHONE ? 60 : 0;
const benchTime = (() => { const [w, m] = String(params.get('benchTime') || '').split(',').map(Number); return w >= 0 && m > 0 ? { warmup: w, measure: m } : {}; })(); // tests only: ?benchTime=0.5,2
const frameCap = new FrameCap(capFps);
const frameStats = new FrameStats();
// ?nitro=80: nitro top speed in km/h for tests (TUNING.nitroMaxKmh, default 60)
if (+params.get('nitro') > 0) TUNING.nitroMaxKmh = Math.min(160, +params.get('nitro'));

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };
$('version').textContent = `версія ${VERSION}`;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); // antialias = MSAA 4x in XR too
// Pixel ratio. PC / VR: min(devicePixelRatio, 1.5) as before. Phone: also a budget of pixels per frame (the GPU is the
// limit there: 0.82 Mp in full screen cost ~20 % of the FPS on the castle climb that 0.63 Mp did not), "стандартна" 0.65 Mp;
// ?mp=N sets the budget in megapixels, ?dpr=N the ratio itself.
const RES_BUDGET = { std: 0.65, high: 0.85, eco: 0.42 };   // Mp
function wantedPixelRatio(w, h) {
  if (params.has('dpr')) return Math.min(3, Math.max(0.5, +params.get('dpr') || 1));
  let r = Math.min(window.devicePixelRatio, 1.5);
  if (IS_PHONE) {
    const mp = params.has('mp') ? Math.max(0.1, +params.get('mp') || 0.65) : RES_BUDGET[loadSetting('phone.res', 'std')] || 0.65;
    r = Math.min(r, Math.sqrt(mp * 1e6 / (w * h)));
  }
  return Math.max(0.5, r);
}
renderer.setPixelRatio(wantedPixelRatio(window.innerWidth, window.innerHeight));
renderer.setSize(window.innerWidth, window.innerHeight);
function applyRes() {
  if (renderer.xr.isPresenting) return;
  renderer.setPixelRatio(wantedPixelRatio(innerWidth, innerHeight));
  renderer.setSize(innerWidth, innerHeight);
}
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(params.has('fov') ? +params.get('fov') : 1);           // three.js scale 0..1
renderer.xr.setFramebufferScaleFactor(params.has('fbs') ? +params.get('fbs') : 1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 300, 1150);
const CULL_DIST = 1150;          // m: city chunks farther than this from the camera are not drawn (inside the fog)

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 3000);

scene.add(new THREE.HemisphereLight(0xe8f4ff, 0xb59c74, 1.6));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.position.set(-0.45, 0.8, 0.4).multiplyScalar(100); // Mediterranean sun from the south-west
scene.add(sun);

// the phone has a wide screen (20:9): the field of view is set HORIZONTALLY (100 deg by default), the vertical one follows
function applyFov() {
  if (!IS_PHONE || renderer.xr.isPresenting) return;
  camera.fov = verticalFov(loadSetting('phone.fov', 100), camera.aspect);
  camera.updateProjectionMatrix();
}
addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  applyFov();
  applyRes();
});
applyFov();

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
// Crazy Tuk: the one-line facts (edited by hand) and the par times (tools/sim-arcade.mjs --write); both optional
let arcadeFacts = null, arcadePar = {}, arcadeVia = {};
try { arcadeFacts = await (await fetch(`data/arcade-facts.json?t=${Date.now()}`, { cache: 'no-store' })).json(); } catch (e) { console.warn(`data/arcade-facts.json: ${e.message}`); }
try { arcadeVia = await (await fetch(`data/arcade-via.json?v=${VERSION}`)).json(); } catch (e) { console.warn(`data/arcade-via.json: ${e.message}`); }
try { arcadePar = await (await fetch(`data/arcade-par.json?v=${VERSION}`)).json(); } catch (e) { console.warn(`data/arcade-par.json: ${e.message}`); }
if (tourError) console.warn(tourError);
// terrain heights (data/terrain.bin, IGN MDT05): the ground, the roads and the physics read one grid
let terrain = null;
if (city.meta.terrain) {
  status('Рельєф…');
  try {
    const buf = await (await fetch(`${city.meta.terrain.file}?v=${VERSION}`)).arrayBuffer();
    terrain = Terrain.fromBin(city.meta.terrain, buf);
    if (!terrainMode) terrain = Terrain.flat(terrain);
  } catch (e) { console.warn(`terrain: ${e.message}`); }
}
const groundY = (x, z) => (terrain ? terrain.height(x, z) : 0);
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
    models = await loadModels(city, facadeSpec, { renderer, version: VERSION, groundY });
    if (models) console.log(`Landmark models: ${models.stats.models} models, ${models.stats.tris} triangles, ${models.stats.ms} ms`);
  } catch (e) { console.warn(`landmark models: ${e.message}`); }
}
// the tour card of a place shows who took the photos / made the scans of its building
if (city.tour) for (const pl of Object.values(city.tour.places)) pl.credit = [creditLine(photos, pl.osm), modelCreditLine(models, pl.osm)].filter(Boolean).join(' · ');
status(`Будую ${city.buildings.length} будинків…`);
await new Promise((r) => setTimeout(r, 0));
const t0 = performance.now();
// ?mask=0: ground drawn under the roads too (the 0.10.2 look), for A/B comparison
const { group: cityGroup, stats: cityStats } = buildCity(city, { texMode, tiles, sky: SKY, photos, cuts: models && models.cuts, terrain, footprint: !['0', 'off', 'no'].includes(params.get('mask')), skin: !['0', 'off', 'no'].includes(params.get('skin')) });
scene.add(cityGroup);
// distance culling of the chunked meshes (buildings, ground): from the castle the whole city is in view
const cullable = cityGroup.children.filter((m) => /^(buildings|ground) /.test(m.name)).map((m) => ({ m, c: m.geometry.boundingSphere.center, r: m.geometry.boundingSphere.radius }));
if (models) { scene.add(models.group); Object.assign(cityStats, { models: models.stats.models, modelTris: models.stats.tris }); }

// ---------- collision world ----------
const R = city.meta.rect;
const world = new CollisionWorld(R);
for (const b of city.buildings) {
  world.addPolygon(b.p);
  for (const h of b.holes || []) world.addPolygon(h);
}
for (const f of models ? models.footprints : []) world.addPolygon(f); // parts of 3D models standing out of a wall
for (const w of city.walls || []) world.addPolygon(w.p, !!w.closed); // castle and city walls
world.addPolygon(city.sea);
const M = 5; // play-area bounds, a few metres inside the data bbox
const bounds = { minX: R.minX + M, maxX: R.maxX - M, minZ: R.minZ + M, maxZ: R.maxZ - M };
// hard wall as a last resort only: the soft edge in physics stops the tuk-tuk before it
world.addPolygon([bounds.minX, bounds.minZ, bounds.maxX, bounds.minZ, bounds.maxX, bounds.maxZ, bounds.minX, bounds.maxZ]);
world.finalize();

// ---------- tuk-tuk ----------
const tuk = createTukTuk({ version: VERSION });
scene.add(tuk.group);
const phys = new TukTukPhysics(world, city.start, bounds, terrain);
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
// on a phone the interface is HTML (src/ui/phoneUi.js): the 3D panel and minimap are not drawn, which also saves a
// 768 x 384 canvas upload with mipmap generation several times a second
const hudIn3D = !IS_PHONE;
tuk.dashboard.mesh.visible = hudIn3D;
const marker = new StopMarker(scene);
const tourists = new Tourists(scene, tuk.group, SEATS, groundY);
const hud = new DesktopHud(minimap);
let mapOn = loadSetting('minimap', true) !== false;
let gameMode = benchOn ? 'free' : ['free', 'tour', 'arcade'].includes(params.get('mode')) ? params.get('mode') : loadSetting('mode', 'tour');
let tourId = params.get('tour') || loadSetting('tourId', 'short');
if (tourSpec && !tourSpec.tours.some((t) => t.id === tourId)) tourId = tourSpec.tours[0]?.id;
let tour = null, freeConfirm = -1e9;
// Crazy Tuk (docs/plan-arcade.md): the run, its countdown before the start, the sounds and the HTML interface
let run = null, runCountdown = 0, runRestartAt = -1e9;
let frameTag = '';   // what happened in this frame (gate, hit, drift...), for the slow-frame list of the diagnostics
const arcadeSound = new ArcadeSound(horn);
const arcadeHud = createArcadeHud({ onAgain: () => startArcade(), onTour: () => setGameMode('tour'), bookLink: bookingLink('uk'), showSpeed: !IS_PHONE,
  onBookMissing: () => flash('Номер WhatsApp ще не вписано (src/config.js)', 4, '#ff9f43') });
const trail = []; let trailLast = null;   // where the tuk-tuk has been during the tour (grey line on the full map)

const buildMs = performance.now() - t0;
console.log(`City built in ${buildMs.toFixed(0)} ms`, cityStats, `collision edges: ${world.edgeCount}`);
// compile the shaders now (loading screen), not in the first frame
status('Компілюю шейдери…');
await new Promise((r) => setTimeout(r, 0));
const tc0 = performance.now();
renderer.compile(scene, camera);
const compileMs = performance.now() - tc0;
console.log(`Shaders compiled in ${compileMs.toFixed(0)} ms`);
// One throw-away draw of everything (frustum culling off, a 1 x 1 px scissor): the GPU buffers and textures of every
// mesh are uploaded NOW, behind the loading screen, not in the first frame in which the mesh comes into view
// (that was a hitch of several ms on a phone each time a new chunk of the city appeared).
const warmStart = performance.now();
{
  const saved = [];
  scene.traverse((o) => { if (o.isMesh || o.isPoints || o.isLine) { saved.push([o, o.frustumCulled]); o.frustumCulled = false; } });
  renderer.setScissorTest(true); renderer.setScissor(0, 0, 1, 1);
  try { renderer.render(scene, camera); } catch (e) { console.warn(`warm-up draw: ${e.message}`); }
  renderer.setScissorTest(false);
  for (const [o, f] of saved) o.frustumCulled = f;
}
const warmMs = performance.now() - warmStart;
console.log(`Warm-up draw in ${warmMs.toFixed(0)} ms`);

// ---------- input & camera modes ----------
const keys = new KeyboardInput();
const xrIn = new XRInput();
const input = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false, nitro: false, reverseDelay: undefined };
let nitroUses = 0, nitroHeld = false; // nitro bursts already handled, the button's last state
// phone, mode "За столом" (docs/plan-phone.md): on-screen controls; none in ?bench (the autopilot drives)
let paused = false, phone = null;
const touch = IS_PHONE && !benchOn ? new TouchControls({
  steer: loadSetting('phone.steer', 'buttons'), gas: loadSetting('phone.gas', 'analog'),
  lookReturn: loadSetting('phone.lookReturn', true) !== false, vibrate: loadSetting('phone.vibrate', true) !== false,
}) : null;
const buzz = (ms) => { if (touch) touch.buzz(ms); };
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
  const edge = phys.T.edgeZone + 5;
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
      let h = Math.atan2(-dx, -dz);
      // a two-way street: face the way the tuk-tuk was going (a crash reset keeps the direction of travel)
      if (!r.o && Math.cos(h - phys.heading) < 0) h += Math.PI;
      if (phys.fits(x, z, h)) { best = { x, z, h }; bestD = d; }
    }
  }
  if (best) phys.teleport(best.x, best.z, best.h);
  cab.snap = true; chaseInit = false; // no swing of the cab or the chase camera after the jump
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
  trail.length = 0; trailLast = null;
  tourists.setup(tour.group, tour.groupPos, tour.groupFacing);
  tourists.visible = true;
  lookYaw = 0; lookPitch = 0;
  if (touch) touch.resetLook();
  return true;
}
// ---------- Crazy Tuk ----------
const arcadeBestKey = () => `arcade.best.${tourId}`;
function startArcade() {
  if (!tourSpec || !graph) { flash(tourError || 'Тур недоступний', 5, '#ff7a5c'); return false; }
  try { run = new Arcade(tourSpec, city.tour, graph, tourId, { par: arcadePar[tourId] || null, facts: arcadeFacts && arcadeFacts.uk, useRoute: false, vias: arcadeVia[tourId] || null }); run.estimatePar(); } catch (e) {
    run = null; flash(`Crazy Tuk: ${e.message}`, 6, '#ff7a5c'); console.warn(e); return false;
  }
  tour = null; tourists.dispose();
  phys.T = ARCADE;
  const back = run.start.back && run.start.back.length ? run.start.back.map(([x, z, heading]) => ({ x, z, heading })) : [{ x: city.start.x, z: city.start.z, heading: city.start.heading }];
  const spawn = back.find((c) => phys.fits(c.x, c.z, c.heading)) || back[0];
  phys.teleport(spawn.x, spawn.z, spawn.heading);
  phys.nitro.charge = 0.5; phys.hit = null;
  trail.length = 0; trailLast = null;
  cab.snap = true; chaseInit = false;
  if (camMode !== 'chase' && !inVR) setCamMode('chase');
  lookYaw = 0; lookPitch = 0; if (touch) { touch.resetLook(); touch.setArcade(true); touch.setAutoGas(!manualGas()); }
  runCountdown = 3.2;
  arcadeHud.hideSummary(); arcadeHud.show(true); arcadeHud.setCountdown(3);
  arcadeSound.setOn(true);
  if (!arcadeFx) { arcadeFx = new ArcadeFx(scene); arcadeFx.precompile(renderer, scene, camera); }   // compile the shaders now, not in the middle of the first drift
  arcadeFx.enable(true); arcadeFx.setGate(run, groundY);
  updateBestLabel();
  return true;
}
function leaveArcade() {
  if (!run && phys.T === TUNING) return;
  run = null; phys.T = TUNING; phys.hit = null; phys.nitro.charge = 1; phys.nitro.active = false;
  arcadeHud.show(false); arcadeSound.setOn(false);
  if (arcadeFx) arcadeFx.enable(false);
  if (touch) touch.setArcade(false);
  if (camMode === 'chase' && !IS_PHONE) setCamMode('cockpit');
  chaseInit = false; cab.snap = true;
}
const manualGas = () => loadSetting('arcade.manualGas', false) === true;
// what the full-screen map and the trail need from a run, in the tour's shape
function arcadeAsTour() {
  if (!run) return null;
  return { items: run.gates.map((g) => ({ kind: g.finish ? 'finish' : 'stop', place: { id: g.id, p: g.p, title: g.title } })),
    done: run.results.map((r) => (r === 'missed' ? 'missed' : r ? 'done' : null)), state: run.done ? 'summary' : 'driving',
    start: run.start, target: run.target, route: null, routeVersion: 0, next: run.next, spec: tourSpec };
}
function handleRunEvents() {
  for (const ev of run.events) {
    frameTag += `${ev.type}${ev.kind ? ':' + ev.kind : ''} `;
    if (ev.type === 'gate') { if (arcadeFx) { arcadeFx.beacon.flash(run.gates[ev.index], ev.kind, groundY(run.gates[ev.index].p[0], run.gates[ev.index].p[1])); arcadeHud.flashScreen(); } arcadeHud.flashGate(ev); arcadeHud.bonusTime(ev.time); arcadeSound.gate(ev.kind); if (ev.kind !== 'missed') buzz(40); }
    else if (ev.type === 'hit') { arcadeHud.flashText(ev.burnt > 0.5 ? `Удар! −${euroWhole(ev.burnt)}` : 'Удар!'); }
    else if (ev.type === 'stuck') { resetToRoad(); comfort.flashBlack(0.25); arcadeHud.flashText('Назад на дорогу −3 с'); arcadeHud.bonusTime(-3); }
    else if (ev.type === 'finish') {
      const r = ev.result, b = loadSetting(arcadeBestKey(), null);
      const isRecord = !b || r.tips > b.tips;
      if (isRecord) saveSetting(arcadeBestKey(), { tips: r.tips, stars: r.stars, time: Math.round(r.time) });
      updateBestLabel();
      arcadeHud.summary(r, { gates: run.gates.map((g, i) => ({ title: g.title, text: g.short, kind: run.results[i] })), best: b, isRecord, tourTitle: run.def.title || tourId });
      if (window.__onArcadeFinish) window.__onArcadeFinish(r);
    }
  }
  run.events = [];
}

function setGameMode(mode) {
  gameMode = mode;
  saveSetting('mode', mode);
  $('mode').value = mode;
  if (mode === 'arcade') { if (!startArcade()) { gameMode = 'free'; $('mode').value = 'free'; } }
  else if (mode === 'tour') { leaveArcade(); if (inVR) comfort.fadeIn(0.35); startTour(); }
  else {
    leaveArcade();
    tour = null; tourists.dispose();
    phys.teleport(city.start.x, city.start.z, city.start.heading);
    if (!phys.fits(phys.x, phys.z, phys.heading)) resetToRoad();
  }
  updateBestLabel();
}
// Y (VR) / T: new tour after the summary; restart / start from free ride needs a second press
function tourButton() {
  if (run) {   // T / the menu in Crazy Tuk: once more (a second press within 2 s while the run is on)
    if (run.done || clock.t - runRestartAt < 2) startArcade();
    else { runRestartAt = clock.t; flash('Натисни ще раз — забіг заново', 2); }
    return;
  }
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
    else if (ev.type === 'oy') shout(horn, tour.group);
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
function updateBestLabel() {
  const el = $('best'); if (!el) return;
  if (gameMode === 'arcade') { const b = loadSetting(arcadeBestKey(), null); el.textContent = b ? `Рекорд Crazy Tuk: ${euroWhole(b.tips)} · ${'★'.repeat(b.stars)}${'☆'.repeat(5 - b.stars)} · ${fmtClock(b.time)}` : 'Crazy Tuk: рекорду ще немає'; }
  else el.textContent = gameMode === 'tour' ? bestText(loadSetting(bestKey(), null)) : '';
}
const fmtDist = (d) => (d < 1000 ? `${Math.round(d / 10) * 10} м` : `${(d / 1000).toFixed(1)} км`);
const EVENT_NAMES = { brake: 'різке гальмування', emergency: 'екстрене гальмування', turn: 'швидкий поворот', danger: 'небезпечний поворот', touch: 'дотик до стіни', hit: 'удар', hitHard: 'сильний удар', scrape: 'шкрябання', nearPeople: 'швидко біля людей', reset: 'повернення на дорогу', leftEarly: 'поїхав під час фото' };
// what the dashboard and the desktop HUD show for the tour (null in free ride)
function tourPanel() {
  if (!tour) return null;
  const T = tour, st = T.state, btn = inVR ? 'Y' : touch ? null : 'T';
  if (st === 'summary') {
    const r = T.result;
    const ev = Object.entries(r.counts).filter(([, n]) => n > 0).map(([k, n]) => `${EVENT_NAMES[k] || k} ×${n}`).join(', ');
    return {
      mode: 'summary', stars: r.stars, tips: r.tips, time: r.time, target: r.target, onTime: r.onTime,
      events: `Настрій ${r.mood} %${ev ? ': ' + ev : ' — жодної різкої події!'}${r.passCount ? ` · факти на ходу ${r.passes}/${r.passCount}` : ''}`,
      review: r.reviewText, best: r.prevBest ? `Було найкраще: ${bestText(r.prevBest).replace('Найкраще: ', '')}` : 'Перший результат збережено',
      footer: btn ? `${btn} — новий тур` : 'Новий тур — кнопкою внизу',
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
  if (run) setGameMode('tour');   // Crazy Tuk is a screen mode; VR stays the real tour
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
  applyFov();
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
let acc = 0, last = performance.now(), mapTimer = 0, gpuLatest = null;
// the full-screen map: opened by a tap / click on the minimap (or M); the game stands still while it is open
const fullMap = createFullMap({
  city, graph, getTour: () => tour || arcadeAsTour(), getTrail: () => (tour || run ? trail : null),
  getTuk: () => ({ x: phys.x, z: phys.z, heading: phys.heading }),
  setPaused: (p) => { paused = p; if (p && touch) touch.releaseAll(); if (!p) last = performance.now(); },
  canOpen: () => !renderer.xr.isPresenting && !(rotateGuard && rotateGuard.portrait),
});
{ const mm = $('miniMap'); if (mm) { mm.style.cursor = 'pointer'; mm.addEventListener('click', () => fullMap.open()); } }
const rotateGuard = IS_PHONE ? installRotateGuard() : null;
const clock = { t: 0 };
const arcadeCam = new ArcadeCam();
let arcadeFx = null;   // the beacon, the arrow and the drift effects: built on the first Crazy Tuk run
const chasePos = new THREE.Vector3(), chaseLook = new THREE.Vector3(), tmpV = new THREE.Vector3();
function setTilt(level) { tilt = level; saveSetting('tilt', level.id); $('tilt').value = level.id; }
function cycleTilt() { setTilt(TILT_LEVELS[(TILT_LEVELS.indexOf(tilt) + 1) % TILT_LEVELS.length]); flash(`Нахил кабіни: ${tilt.label}`); }

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
  frameStats.raf(now);
  if (!inVR) {
    // phone held upright: the game waits (and the measuring clocks stop); frame limiter: skipped frames cost nothing
    if ((rotateGuard && rotateGuard.portrait) || paused) { last = now; frameStats.pause(); return; }
    if (!frameCap.allow(now)) return;
  }
  const cpuStart = performance.now();
  let dashMs = 0;   // time spent on the panel / HUD part of this frame (for the slow-frame report)
  const frameDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  clock.t += frameDt;

  // one-shot keys
  if (keys.take('KeyR')) resetToRoad();
  if (keys.take('KeyC') && !inVR) { setCamMode(camMode === 'cockpit' ? 'chase' : 'cockpit'); chaseInit = false; }
  if (keys.take('KeyF')) toggleStats();
  if (keys.take('KeyG')) nextStress();
  if (keys.take('KeyT')) tourButton();
  if (keys.take('KeyN')) { mapOn = !mapOn; saveSetting('minimap', mapOn); }   // M opens the full map (src/ui/fullMap.js)
  if (keys.take('KeyK')) cycleTilt();
  input.reverseDelay = undefined;
  keys.read(frameDt, input);
  if (touch) touch.read(frameDt, input);

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
  if (bench && bench.state === 'running') bench.update(frameDt, input, phys);   // ?bench drives the tuk-tuk itself
  pedal += (input.brake - pedal) * (1 - Math.exp(-frameDt / 0.06));
  tuk.setPedal(pedal);
  horn.set(input.horn);
  if (window.__autopilot) window.__autopilot(input, phys, clock.t);
  input.cruiseKmh = 0; input.slideBoost = false;
  if (run) {
    // Crazy Tuk: the throttle is automatic (the tuk-tuk keeps 60+ km/h unless braking), the countdown holds it still,
    // after the finish it rolls out on the brake
    if (runCountdown > 0) { runCountdown -= frameDt; arcadeHud.setCountdown(Math.ceil(runCountdown - 0.2)); if (runCountdown <= 0) { arcadeHud.setCountdown(null); run.begin(phys.x, phys.z); } }
    if (run.state === 'ready') { input.throttle = 0; input.brake = 1; input.nitro = false; input.reverseDelay = Infinity; }
    else if (run.done) { input.throttle = 0; input.brake = 0.6; input.nitro = false; input.reverseDelay = Infinity; }
    else if (!manualGas()) { input.throttle = input.brake > 0 ? 0 : 1; input.cruiseKmh = ARCADE.autoGasKmh; }   // the auto-gas holds ARCADE.autoGasKmh; the nitro goes past it
  }
  // a slide with the nitro (or, with the pedal, the gas) held keeps its speed: physics.js driftBoost*
  if (run) input.slideBoost = !!input.nitro || (manualGas() && input.throttle > 0.3);
  // tour: while boarding / taking photos, holding the brake keeps the tuk-tuk still (no reversing)
  if (tour && tour.holdBrake) input.reverseDelay = Infinity;

  acc += frameDt;
  let steps = 0, impact = 0;
  let verge = 0;
  while (acc >= DT && steps < 8) {
    phys.step(DT, input);
    impact = Math.max(impact, phys.lastImpact);
    verge = Math.max(verge, phys.slopeHit);
    acc -= DT; steps++;
  }
  if (steps === 8) acc = 0;
  // nitro: a new burst (tour: the tourists shout, −10), or why the button did nothing
  const nitroPress = input.nitro && !nitroHeld;
  nitroHeld = input.nitro;
  let nitroStarted = false;
  if (phys.nitro.uses > nitroUses) {
    nitroUses = phys.nitro.uses; nitroStarted = true;
    if (!tour && !run) flash(`НІТРО! до ${TUNING.nitroMaxKmh} км/год`, 1.5, '#ff9f43');
    if (inVR) xrIn.pulse('right', 0.5, 120); else buzz(70);
  } else if (nitroPress && !phys.nitro.active && !run) {
    if (phys.nitro.charge < 1) flash(`Нітро заряджається: ${Math.ceil((1 - phys.nitro.charge) * TUNING.nitroRecharge)} с`, 1.5, '#9fb3c8');
    else if (phys.forwardSpeed < TUNING.nitroMinSpeed) flash('Нітро — лише коли їдеш уперед', 1.5, '#9fb3c8');
  }
  // a hard wall hit at speed: a short blackout and back onto the road, no camera jolt
  if (phys.crash) {
    phys.crash = false;
    comfort.flashBlack(0.3);
    resetToRoad();
    flash('Удар! Назад на дорогу', 2.5, '#ff7a5c');
    if (inVR) xrIn.pulse('both', 1, 160); else buzz(140);
  }
  if (inVR && Math.max(impact, verge) > 1.5) {
    xrIn.pulse('both', Math.min(1, impact / 6), 40 + Math.min(80, impact * 15));
    bars.quietUntil = now + 150;
  } else if (!inVR && Math.max(impact, verge) > 1.5) buzz(30 + Math.min(70, impact * 10));

  // interpolate between the last two physics states for smooth motion at any refresh rate
  const a = acc / DT;
  const x = phys.prev.x + (phys.x - phys.prev.x) * a;
  const z = phys.prev.z + (phys.z - phys.prev.z) * a;
  let dh = phys.heading - phys.prev.heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  // the cab follows the ground: height under the centre, pitch and roll from the wheels (smoothed,
  // roll limited: the cab as a stable frame matters more than a faithful lean)
  const pitchT = THREE.MathUtils.clamp(phys.pitch, -0.21, 0.21) * tilt.k, rollT = THREE.MathUtils.clamp(phys.roll, -0.087, 0.087) * tilt.k;
  const pitchPrev = cab.snap ? pitchT : cab.pitch;
  if (cab.snap) { cab.pitch = pitchT; cab.roll = rollT; cab.snap = false; }
  cab.pitch += (pitchT - cab.pitch) * (1 - Math.exp(-frameDt / 0.25));
  cab.roll += (rollT - cab.roll) * (1 - Math.exp(-frameDt / 0.35));
  cab.pitchRate = frameDt > 0 ? Math.abs(cab.pitch - pitchPrev) / frameDt : 0;
  tuk.group.position.set(x, groundY(x, z), z);
  tuk.group.rotation.set(cab.pitch, phys.prev.heading + dh * a, -cab.roll, 'YXZ');
  tuk.group.updateMatrixWorld();

  // ---------- Crazy Tuk ----------
  if (run) {
    if (phys.hit) { arcadeSound.hit(phys.hit.into); buzz(60 + Math.min(120, phys.hit.into * 12)); phys.hit = null; }
    if (run.nitroBonus) { phys.nitro.charge = Math.min(1, phys.nitro.charge + run.nitroBonus); run.nitroBonus = 0; }
    run.update({ dt: frameDt, x: phys.x, z: phys.z, speed: phys.forwardSpeed, impact, contact: phys.contactTimer > 0, blocked: verge > 0, nitroActive: phys.nitro.active });
    handleRunEvents();
    if (arcadeFx) arcadeFx.setGate(run, groundY);
    arcadeSound.update(Math.abs(phys.forwardSpeed) * 3.6, phys.nitro.active, input.throttle, phys.slipSpeed * (phys.grip < 0.7 || phys.slipSpeed > 5 ? 1 : 0), frameDt);
  }
  // ---------- tour ----------
  if (tour) {
    tour.update({ dt: frameDt, x: phys.x, z: phys.z, speed: phys.forwardSpeed, accel: phys.accel, yawRate: phys.yawRate,
      brake: input.brake, reversing: phys.reversing, impact, contact: phys.contactTimer > 0, handbrake: input.handbrake, grade: phys.grade });
    if (nitroStarted && !tour.onNitro()) flash(`НІТРО! до ${TUNING.nitroMaxKmh} км/год`, 1.5, '#ff9f43');
    handleTourEvents();
  }
  tourists.update(frameDt);
  camera.getWorldPosition(tmpV);
  for (const { m, c: cc, r } of cullable) m.visible = Math.hypot(cc.x - tmpV.x, cc.z - tmpV.z) - r < CULL_DIST;
  const zone = tour ? tour.zone : null;
  if (zone) zone.y = groundY(zone.x, zone.z);
  marker.update(frameDt, zone, tmpV, !!(tour && tour.holdBrake));
  const target = tour ? tour.target : run ? run.target : null;
  const h = tuk.group.rotation.y;
  const routeNow = tour ? tour.route : null, routeV = tour ? tour.routeVersion : -1;   // Crazy Tuk draws no route: the player picks the streets
  minimap.mesh.visible = hudIn3D && (mapOn || inVR);
  if (hudIn3D) {
    minimap.setRoute(routeNow, routeV);
    minimap.update(frameDt, x, z, h, phys.forwardSpeed, target);
  }
  const tvx = target ? target.x - x : 0, tvz = target ? target.z - z : 0;
  if (target && Math.hypot(tvx, tvz) > 10 && (!tour || (tour.state !== 'boarding' && tour.state !== 'photo' && tour.state !== 'afterPhoto'))) {
    const vx = tvx, vz = tvz, dist = Math.hypot(vx, vz);
    const ang = Math.atan2(vx * Math.cos(h) - vz * Math.sin(h), -vx * Math.sin(h) - vz * Math.cos(h));
    if (hudIn3D) tuk.dashboard.setArrow(ang, Math.abs(ang) > 2.1 ? 0xff9f43 : dist < 50 ? 0x55ee77 : 0xffcc33);
  } else if (hudIn3D) tuk.dashboard.setArrow(null);
  if (((tour && tour.state !== 'summary') || (run && !run.done)) && !inVR) {
    if (!trailLast || Math.hypot(x - trailLast[0], z - trailLast[1]) > 6) {
      trailLast = [x, z]; trail.push(trailLast);
      if (trail.length > 4000) trail.splice(0, 1000);
    }
  }
  mapTimer -= frameDt;
  if (run && !hudIn3D) minimap.radius += (150 + 250 * Math.max(0, Math.min(1, (phys.forwardSpeed - 16.7) / 25)) - minimap.radius) * (1 - Math.exp(-frameDt / 0.8));   // the phone map grows with the speed
  if (mapTimer <= 0) { mapTimer = 0.1; hud.drawMap(!inVR && mapOn, x, z, h, run ? null : target, routeNow, run && !run.done ? { list: run.gates.slice(run.next).map((g) => ({ x: g.p[0], z: g.p[1] })), next: 0, vias: run.gate ? run.gate.vias.slice(run.viaI).map((v) => ({ x: v.p[0], z: v.p[1] })) : [] } : null); }

  if (touch && touch.visible) { const l = touch.update(frameDt); lookYaw = l.yaw; lookPitch = l.pitch; touch.setSpeed(phys.forwardSpeed * 3.6); }
  if (inVR) {
    // head pose comes from the headset, under xrRig
  } else if (camMode === 'cockpit') {
    cameraHolder.rotation.set(lookPitch, lookYaw, 0, 'YXZ');
  } else if (camMode === 'chase') {
    const h = tuk.group.rotation.y;
    const gy = groundY(x, z);
    if (run) {
      // Crazy Tuk (src/game/arcadeCam.js): higher and farther with the speed, a wider view, the nitro shakes it lightly,
      // never inside the tuk-tuk and never behind a wall
      if (!chaseInit) { arcadeCam.reset(); chaseInit = true; }
      const c = arcadeCam.update(frameDt, { x, z, gy, heading: h, vx: phys.vx, vz: phys.vz, kmh: Math.abs(phys.forwardSpeed) * 3.6, nitro: phys.nitro.active }, world, groundY);
      camera.position.set(c.px, c.py, c.pz);
      chaseLook.set(c.lx, c.ly, c.lz);
      camera.lookAt(chaseLook);
      if (c.roll) camera.rotateZ(c.roll);
      const fovV = verticalFov((IS_PHONE ? 100 : 95) + c.fovAdd, camera.aspect);
      if (Math.abs(camera.fov - fovV) > 0.05) { camera.fov = fovV; camera.updateProjectionMatrix(); }
    } else {
      tmpV.set(Math.sin(h) * 7 + x, gy + 3.2, Math.cos(h) * 7 + z);
      tmpV.y = Math.max(tmpV.y, groundY(tmpV.x, tmpV.z) + 1.5);
      if (!chaseInit) { chasePos.copy(tmpV); chaseInit = true; }
      chasePos.lerp(tmpV, 1 - Math.exp(-frameDt * 4));
      camera.position.copy(chasePos);
      chaseLook.set(x, gy + 1.2, z);
      camera.lookAt(chaseLook);
    }
  }
  if (run && arcadeFx) {
    // gate beacon, arrow over the tuk-tuk, drift smoke and tyre marks (src/game/arcadeFx.js), after the camera moved
    const g = run.done ? null : run.gate, sliding = phys.slipSpeed > ARCADE.driftSmoke && phys.grip < 0.8 && Math.abs(phys.forwardSpeed) > 6;
    if (sliding) frameTag += 'drift '; if (phys.nitro.active) frameTag += 'nitro ';
    arcadeFx.beacon.update(frameDt, camera.position.x, camera.position.z);
    arcadeFx.arrow.update(frameDt, x, groundY(x, z), z, g && run.state === 'running' ? run.aim : null, h, camera.position.x, camera.position.y, camera.position.z);
    arcadeFx.drift.update(frameDt, { x, z, heading: h, groundAt: groundY, sliding, amount: Math.min(1, phys.slipSpeed / 9), cam: camera, viewH: renderer.domElement.height });
  }
  comfort.update(frameDt, phys, Math.max(impact, verge), (inVR || vignetteOnDesktop) && camMode === 'cockpit', cab.pitchRate, phys.nitro.active);

  gpu.poll();
  gpu.begin();
  const renderStart = performance.now();
  for (let i = 0; i < stress; i++) renderer.render(scene, camera);
  const renderMs = performance.now() - renderStart;   // CPU time to submit the frame (not the GPU time)
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
    const dashStart = performance.now();
    dashTimer = 0.2;
    let msg = '', msgColor;
    if (flashT > 0) { msg = flashText; msgColor = flashColor; }
    else if (phys.edgeDist < TUNING.edgeZone) msg = 'Повертайся до центру';
    else if (bars.invalid) msg = 'Тримай руки по боках';
    else if (steeringMode === 'hands' && inVR && bars.releasedFor > 1.5 && Math.abs(phys.forwardSpeed) > 1 && !xrIn.stickActive) msg = 'Візьмись за кермо (grip)';
    const session = inVR && renderer.xr.getSession();
    const gpuMs = gpu.take(), cpuMs = cpu.n ? (cpu.ms = cpu.sum / cpu.n, cpu.sum = cpu.n = 0, cpu.ms) : cpu.ms;
    if (gpuMs != null) gpuLatest = gpuMs;
    const panel = tourPanel();
    if (hudIn3D) tuk.dashboard.draw({
      speed: phys.forwardSpeed, msg, msgColor, tour: panel,
      nitro: { state: phys.nitro.active ? 'active' : phys.nitro.charge < 1 ? 'charge' : 'ready', level: phys.nitro.active ? 1 - phys.nitro.t / TUNING.nitroTime : phys.nitro.charge, left: Math.ceil((1 - phys.nitro.charge) * TUNING.nitroRecharge) },
      stats: showStats ? { fps: Math.round(perf.fps), calls: perf.calls, tris: perf.tris, hz: session && session.frameRate ? Math.round(session.frameRate) : 0,
        gpuMs: gpuMs == null ? null : Math.round(gpuMs * 10) / 10, cpuMs: cpuMs == null ? null : Math.round(cpuMs * 10) / 10, stress } : null,
    });
    hud.update(!inVR, panel);
    if (phone) phone.update({ msg, msgColor, panel });
    if (touch && run) touch.setNitro({ state: phys.nitro.active ? 'active' : phys.nitro.charge > 0.05 ? 'ready' : 'charge', level: phys.nitro.charge, left: Math.round(phys.nitro.charge * 100) });
    else if (touch) touch.setNitro({ state: phys.nitro.active ? 'active' : phys.nitro.charge < 1 ? 'charge' : 'ready', level: phys.nitro.active ? 1 - phys.nitro.t / TUNING.nitroTime : phys.nitro.charge, left: Math.ceil((1 - phys.nitro.charge) * TUNING.nitroRecharge) });
    if (run) {
      const g = run.gate;
      arcadeHud.update({ timeLeft: run.timeLeft, pocket: run.pocket, stake: run.stake, combo: run.combo, kmh: phys.forwardSpeed * 3.6, card: run.card,
        gateIndex: run.next, gateCount: run.gates.length, gateTitle: g ? (g.finish ? 'Фініш: ' + g.title : g.title) : '', gateDist: g ? Math.hypot(g.p[0] - phys.x, g.p[1] - phys.z) : null });
    }
    dashMs = performance.now() - dashStart;
    debugEl.style.display = showStats && !inVR ? 'block' : 'none';
    if (showStats) {
      debugEl.textContent = `${perf.fps.toFixed(0)} FPS\ncalls ${perf.calls}  tris ${perf.tris}\n` +
        `speed ${(phys.forwardSpeed * 3.6).toFixed(1)} km/h  pos ${phys.x.toFixed(0)}, ${phys.z.toFixed(0)}  h ${phys.y.toFixed(1)} m  grade ${(phys.grade * 100).toFixed(0)}%  roll ${(phys.roll * 57.3).toFixed(1)}°`;
    }
  }
  keys.endFrame();
  const frameMs = performance.now() - cpuStart;
  cpu.sum += frameMs; cpu.n++;
  frameStats.frame(now, { calls: perf.calls, tris: perf.tris, cpuMs: frameMs, gpuMs: gpuLatest, renderMs, dashMs, tag: frameTag });
frameTag = '';
}
const loadedAt = performance.now();   // since the navigation start: how long the whole loading took
renderer.setAnimationLoop(frame);

// ---------- start overlay ----------
const startBtn = $('start');
startBtn.disabled = false;
startBtn.textContent = IS_PHONE ? 'Грати' : 'Грати (клавіатура)';
status(`${city.buildings.length} будинків · ${city.roads.length} вулиць · зібрано за ${buildMs.toFixed(0)} мс${tiles ? ` · ${tiles.preview.facade.length + tiles.preview.ground.length + 1} плиток за ${tiles.ms.toFixed(0)} мс` : ' · без текстур'}${photos ? ` · ${photos.stats.photos} фото фасадів за ${photos.stats.ms} мс` : ''}${models ? ` · ${models.stats.models} 3D-модел${models.stats.models === 1 ? 'ь' : 'і'} за ${models.stats.ms} мс` : ''}`);
// full screen and the landscape lock must be requested inside the tap itself (phone: phone.onStart)
const start = (e) => { horn.unlock(); if (phone) phone.onStart({ gesture: !!(e && e.isTrusted) }); $('overlay').style.display = 'none'; renderer.domElement.focus(); };
startBtn.addEventListener('click', start);

const vrButton = VRButton.createButton(renderer);
vrButton.id = 'vrbutton';
$('buttons').appendChild(vrButton);

const select = $('vignette');
for (const l of VIGNETTE_LEVELS) select.add(new Option(l.label, l.id));
select.value = comfort.level.id;
select.addEventListener('change', () => comfort.setLevel(VIGNETTE_LEVELS.find((l) => l.id === select.value)));
$('steering').value = steeringMode;
$('steering').addEventListener('change', () => setSteeringMode($('steering').value));
for (const l of TILT_LEVELS) $('tilt').add(new Option(l.label, l.id));
$('tilt').value = tilt.id;
$('tilt').addEventListener('change', () => setTilt(TILT_LEVELS.find((l) => l.id === $('tilt').value) || TILT_LEVELS[0]));
// game mode and tour (stage 6)
const modeSel = $('mode'), tourSel = $('tourSel');
for (const t of tourSpec?.tours || []) tourSel.add(new Option(t.title || t.id, t.id));
tourSel.value = tourId;
modeSel.value = gameMode;
const syncModeUi = () => { vrButton.style.display = gameMode === 'arcade' ? 'none' : ''; $('manualGasRow').style.display = gameMode === 'arcade' && !IS_PHONE ? '' : 'none'; };
modeSel.addEventListener('change', () => { setGameMode(modeSel.value); syncModeUi(); });
// settings kept for every viewer: auto-gas (Crazy Tuk), sound, music (the phone's menu rows and these PC checkboxes use the same keys)
function applyAutoGas() { $('autoGas').checked = !manualGas(); if (touch && run) touch.setAutoGas(!manualGas()); }
function applySound() {
  const sound = loadSetting('sound.on', true) !== false, music = loadSetting('music.on', true) !== false;
  horn.setMuted(!sound); arcadeSound.setSound(sound); arcadeSound.setMusic(music);
  $('soundOn').checked = sound; $('musicOn').checked = music;
}
$('autoGas').addEventListener('change', () => { saveSetting('arcade.manualGas', !$('autoGas').checked); applyAutoGas(); });
$('soundOn').addEventListener('change', () => { saveSetting('sound.on', $('soundOn').checked); applySound(); });
$('musicOn').addEventListener('change', () => { saveSetting('music.on', $('musicOn').checked); applySound(); });
applyAutoGas(); applySound();
tourSel.addEventListener('change', () => { tourId = tourSel.value; saveSetting('tourId', tourId); if (gameMode === 'tour') startTour(); updateBestLabel(); });
if (tourError) { $('tourError').textContent = tourError; $('tourError').style.display = 'block'; }
if (!tourSpec || !graph) { modeSel.value = 'free'; modeSel.disabled = tourSel.disabled = true; if (gameMode === 'tour') gameMode = 'free'; }
if (gameMode === 'tour' && !startTour()) gameMode = 'free';
if (gameMode === 'arcade' && !startArcade()) gameMode = 'free';
modeSel.value = gameMode;
syncModeUi();
updateBestLabel();
$('vibration').checked = bars.engineVibration;
$('vibration').addEventListener('change', () => { bars.engineVibration = $('vibration').checked; saveSetting('engineVibration', bars.engineVibration); });

// ---------- diagnostics UI and ?bench (phone stage F0, docs/plan-phone.md) ----------
let bench = null;
const benchStations = benchOn && graph ? buildStations(city, graph, groundY) : [];
const benchApi = {
  place(x, z, heading) { phys.teleport(x, z, heading); cab.snap = true; chaseInit = false; },
  look(yaw, pitch) { lookYaw = yaw; lookPitch = pitch; },
  air(x, y, z, tx, ty, tz) { setCamMode('free'); camera.position.set(x, y, z); camera.lookAt(tx, ty, tz); },
  cockpit() { if (camMode !== 'cockpit') setCamMode('cockpit'); lookYaw = 0; lookPitch = 0; },
  groundY,
};
const reportCtx = {
  renderer, stats: frameStats, cap: capFps,
  get bench() { return bench; },
  game: () => ({
    version: VERSION,
    info: {
      'інтерфейс': `${UI}${IS_PHONE ? ' (телефон)' : ''}; ?bench ${benchOn ? benchPasses + ' пр.' : 'ні'}`,
      'режим / камера': `${gameMode}${run ? ' (Crazy Tuk, ' + run.state + ')' : ''} / ${camMode}; нахил кабіни: ${tilt.label}`,
      'місто': `${city.buildings.length} будинків, ${city.roads.length} вулиць; terrain=${terrainMode ? 'так' : 'ні'} tex=${texMode} photo=${photoMode} model=${modelMode}`,
      'завантаження': `усього ${(loadedAt / 1000).toFixed(1)} с від відкриття; місто ${buildMs.toFixed(0)} мс, шейдери ${compileMs.toFixed(0)} мс${tiles ? `, плитки ${tiles.ms.toFixed(0)} мс (${(tiles.bytes / 1048576).toFixed(1)} МБ)` : ''}`,
      'побудова міста': JSON.stringify(cityStats).slice(0, 400),
      'позиція': `x ${phys.x.toFixed(0)}, z ${phys.z.toFixed(0)}, висота ${phys.y.toFixed(1)} м, швидкість ${(phys.forwardSpeed * 3.6).toFixed(0)} км/год`,
      'відсікання / туман': `${CULL_DIST} м / 300–1150 м`,
      'підігрів і маска': `warm-up ${warmMs.toFixed(0)} мс; маска слідів: ${cityStats.footMs != null ? cityStats.footMs + ' мс, ' + cityStats.footRoads + ' доріг' : 'вимкнена'}; 3D-панель кабіни: ${hudIn3D ? 'так' : 'ні (HTML-інтерфейс)'}`,
      ...screenReport(),
    },
  }),
};
let diagUI = null;
function runBench() {
  if (!graph || benchStations.length < 3) { flash('Замір недоступний: немає графа доріг або місць', 5, '#ff7a5c'); return; }
  bench = new Bench({ stations: benchStations, stats: frameStats, api: benchApi, passes: benchPasses, ...benchTime });
  bench.onDone = () => { diagUI.setProgress(null); diagUI.open(); };
  $('overlay').style.display = 'none';
  diagUI.close();
  if (IS_PHONE && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  bench.start();
}
function benchUrl() {
  const u = new URL(location.href);
  for (const k of ['mode', 'tour', 'autostart']) u.searchParams.delete(k);
  if (!u.searchParams.has('bench')) u.searchParams.set('bench', '1');
  return u.href;
}
if (IS_PHONE || benchOn || params.has('diag')) {
  diagUI = createDiagUI({ stats: frameStats, cap: capFps, visible: benchOn || (IS_PHONE && !touch), side: touch ? 'right' : 'left', getReport: () => buildReport(reportCtx), onBench: () => (benchOn ? runBench() : (location.href = benchUrl())) });
  setInterval(() => { if (bench) diagUI.setProgress(bench.status()); }, 250);
  if (touch) diagUI.setVisible(false);   // the phone start screen is crowded: the FPS button appears when the game starts
  if (benchOn) {
    $('overlay').style.display = 'none';
    if (benchStations.length < 3) diagUI.open();
    else diagUI.showIntro({ passes: benchPasses, stations: benchStations.length, per: (benchTime.warmup ?? 2.5) + (benchTime.measure ?? 8), onStart: runBench });
  }
}

// ---------- phone interface (docs/plan-phone.md, stage F1) ----------
if (touch) {
  phone = createPhoneUi({
    touch,
    api: {
      setPaused: (p) => { paused = p; if (!p) last = performance.now(); },
      resetToRoad: () => { resetToRoad(); flash('Повернулись на дорогу', 2); },
      restartTour: () => { if (run) startArcade(); else if (gameMode !== 'tour') setGameMode('tour'); else startTour(); },
      startArcade: () => setGameMode('arcade'), applyAutoGas, applySound,
      newTour: () => tourButton(),
      freeRide: () => setGameMode('free'),
      hasTour: () => !!tour || !!run, isArcade: () => !!run, hasTourSpec: () => !!(tourSpec && graph),
      cycleTilt, tiltLabel: () => tilt.label,
      toggleCamera: () => { setCamMode(camMode === 'cockpit' ? 'chase' : 'cockpit'); chaseInit = false; },
      camLabel: () => (camMode === 'cockpit' ? 'кабіна' : 'ззаду'),
      toggleMap: () => { mapOn = !mapOn; saveSetting('minimap', mapOn); },
      openMap: () => fullMap.open(),
      mapOn: () => mapOn,
      openDiagnostics: () => { if (diagUI) diagUI.open(); },
      applyFov, applyRes, version: VERSION, onStarted: () => { if (diagUI) diagUI.setVisible(true); },
      credit: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · рельєф © IGN (CNIG) · фото фасадів: <a href="assets/facades/CREDITS.md" target="_blank" rel="noopener">Wikimedia Commons</a> · 3D-скани: <a href="assets/models/CREDITS.md" target="_blank" rel="noopener">Sketchfab</a>',
    },
  });
  phone.adaptStartScreen();
}
if (params.has('autostart')) start();   // after the phone interface exists (it hides the start screen's parts)

// test / debugging hook
window.__game = { get run() { return run; }, get fx() { return arcadeFx; }, arcadeCam, startArcade, arcadeHud, fullMap, touch, get phone() { return phone; }, get paused() { return paused; }, set paused(v) { paused = v; }, frameStats, frameCap, get bench() { return bench; }, diagUI, benchStations, benchApi, rotateGuard, photos, models, terrain, groundY, get tilt() { return tilt; }, setTilt, get tour() { return tour; }, startTour, setGameMode, tourists, minimap, marker, graph, tourSpec, hud, tourPanel, THREE, renderer, scene, camera, phys, world, city, cityStats, perf, input, resetToRoad, setCamMode, tuk, xrRig, xrIn, comfort, bars, gpu, VERSION, tiles, texMode, look: (y, p) => { lookYaw = y; lookPitch = p; }, freeCam: (x, y, z, tx, ty, tz) => { setCamMode('free'); camera.position.set(x, y, z); camera.lookAt(tx, ty, tz); }, get stress() { return stress; }, get steeringMode() { return steeringMode; } };
