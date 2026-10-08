# Tuk-Tuk Alicante VR

Ride a tuk-tuk through the real centre of Alicante (Explanada de España, Rambla de Méndez Núñez,
Mercado Central, the port) in the browser — on Meta Quest 3 via WebXR, or on a laptop with the keyboard.

**Play:** https://archigreen55-prog.github.io/tuktuk-alicante-vr/

Status: prototype (stages 0–5 and 6a of [docs/plan.md](docs/plan.md), [docs/plan-stage-6.md](docs/plan-stage-6.md)): city
from OpenStreetMap, keyboard driving, collisions, WebXR on Quest 3 with controllers, hands-on-handlebar steering, a comfort
vignette, code-drawn textures (facades, roads, sidewalks, the Explanada mosaic), the **tour mission** and
the first **photo landmark** (Mercado Central).
The build version is shown small on the dashboard and on the start screen.

## Terrain (plan-terrain.md, T1)

The city stands on real ground: the 5 m digital terrain model of the Spanish IGN (MDT05, PNOA LiDAR,
© Instituto Geográfico Nacional (CNIG), CC BY 4.0) fetched once through the INSPIRE WCS service. The
Benacantil is real terrain with the castle's walls from OSM, the road up to the castle gate is drivable,
the old town climbs its slope, the Mercado stands 15 m and the Luceros 21 m above the Explanada.

- `node tools/fetch-dem.mjs` downloads `data/raw/dem5.asc` for the area in `tools/area.mjs` (the bbox of
  `fetch-osm.mjs` and `build-city.mjs` too; the local origin never moves, so hand-tuned coordinates keep
  their meaning). `build-city` carves the streets into the grid (profile along the axis, smoothed, agreed
  at junctions, flat across the carriageway and sidewalk), flattens the sea and writes `data/terrain.bin`
  (Int16 cm, header in `city.json` → `meta.terrain`); every building gets its base height `y`.
- In the game one grid (`src/city/terrain.js`) serves the ground mesh (`src/city/ground.js`: RTIN with an
  error bound, 16 chunks + a skirt), the draped roads / plazas / parks, the buildings, the photo facades and
  scans, the tourists, the markers and the physics.
- Physics on slopes (`src/vehicle/physics.js`): gravity along the heading; on climbs the motor holds at most
  the owner's real speeds (`TUNING.climbSpeed`: ~30 km/h on 8–10 %, 25 on 14 %), power-limited when pulling
  away; downhill electric braking and a 30 km/h governor on every descent from 4 %; a parking hold at
  standstill; steep ground (> 33 %) acts as a wall. Collisions are unchanged (2D, plus the walls), the move
  is sub-stepped (≤ 0.2 m) for nitro speeds; a wall hit above 50 km/h fades out for 0.3 s and puts the
  tuk-tuk back on the road.
- VR comfort: the cab tilts with the road (pitch up to 12°, roll limited to 5°, smoothed); the start
  screen and the K key switch the tilt between full / half / off; the vignette also reacts to crests and dips.
- `?terrain=0` — flat city (every height 0) for A/B comparison. The tour graph leaves out lanes steeper
  than 20 %; steeper edges slow the target time (`route.js` classes).

## Tour mission (stage 6a)

Pick up 2–4 tourists at the Meliá hotel, drive them along a real guide's route and bring them back. Photo stops
(Explanada and Casa Carbonell, Ayuntamiento, Basílica de Santa María, Postiguet with the castle view, Mercado Central)
light up as a zone on the road with a light pillar; the other sights are "on the way" facts shown on the dashboard
when you pass them (full tour). A compass arrow on the dashboard and a heading-up minimap with the route (drivable,
one-way-aware streets only) guide you. Smooth driving matters: hard braking, fast turns and wall hits upset the
tourists; at the end you get tips, 1–5 stars, a review line and your best result.

- **`data/tour.json`** holds everything a guide edits: tours (start place + route of `{ "stop": id }` /
  `{ "pass": id }`), places (title, fact text, how to find them in OSM) and review lines. Texts, order and tours work
  after a page reload (the file is never cached). A new place or a changed `osm` / `road` / `at` needs
  `node tools/build-city.mjs`, which finds it in OSM by name (also `wikipedia` / `wikimedia_commons`), snaps it to
  the nearest drivable street connected to the city and prints the route lengths.
- `node tools/sim-tour.mjs [tourId] [careful|rough]` drives the tours with an autopilot in Node (same physics,
  collisions, routes and scoring as the game) to check the data and the scoring.
- Code: `src/game/route.js` (street graph, A*), `tour.js` (states, stops, facts, clock), `scoring.js` (comfort
  events, mood, tips, stars — all thresholds in one table), `tourists.js`, `markers.js`, `src/ui/` (dashboard,
  minimap, desktop HUD).

## Textures (stage 5b)

No image files: every tile (window bays per facade style, shop fronts, cornices, asphalt, paving, road markings,
zebras, the Explanada wave mosaic) is drawn on a canvas at load time (`src/city/tiles.js`) into WebGL2 texture
arrays with mip levels and 8x anisotropic filtering. Facade tiles are material masks (plaster / shutter / glass /
metal weights + shade), so one tile serves every building colour. The shaders (`src/city/facades.js`) extend
`MeshLambertMaterial` via `onBeforeCompile`; the meshes and draw calls stay the same. Facade layout (floors, bays,
shop fronts by street, blank shared walls) comes from `tools/build-city.mjs` + `data/facades.json` (manual style
overrides per OSM id; photo facades for landmarks: see below). Balconies along the main streets are one
`InstancedMesh`.

## Photo facades (landmarks)

The Mercado Central is the first landmark with real photos: the main facade, the round corner pavilion with
its dome, the back facade and a repeating bay of the long side walls, all from free Wikimedia Commons photos
(authors and licences: [assets/facades/CREDITS.md](assets/facades/CREDITS.md), also on the tour card of the
place). The walls a photo covers leave the procedural meshes and go into one extra mesh with its own UVs; all
photos share one atlas texture (+1 draw call for every photo landmark together). The sky around towers and
gables is cut out with a mask (alpha to coverage), the dome is a body of revolution textured by the same photo.

- **`data/facades.json`** says which walls of which building (OSM id) a photo covers, where the photo comes
  from and its 4 corners; the format is described at the top of `src/city/photoFacades.js`.
- **`node tools/prepare-facade.mjs`** (needs `npm install` once, for `sharp`) straightens each source photo by
  its 4 corners, cuts it to the facade, scales it to ≤ 2048 px, writes a JPEG + sky mask into `assets/facades/`.
  `--list way/21410214` prints the building's walls (numbers for `edges`), `--check <id>` draws the corners and
  the outline on the source photo and the OSM wall corners on the result (`assets/facades/.check/`).
- To use your own photo: put it into `assets/facades/`, set `from`, `corners` (and `outline`) of the entry,
  run the tool, reload the page. Code: `src/city/landmarks.js` (atlas, mesh, material).

## 3D models of landmarks (scans)

A scan (GLB) stands in front of its OSM building's wall; the wall behind it gets a niche so doors and deep
recesses show. The first one is the baroque portal of the Basílica de Santa María (CC BY scan from Sketchfab,
authors: [assets/models/CREDITS.md](assets/models/CREDITS.md)).

- `data/facades.json` → `"models"` of a building: which wall, where on it, the real width, the triangle and
  texture budget; the format is at the top of `src/city/models.js`.
- **`node tools/prepare-model.mjs`** (`npm install` once) bakes the source glTF/GLB into one mesh, turns and
  scales it to metres, finds the wall plane, simplifies it and writes KTX2 (Basis) textures + meshopt geometry.
  The `ktx` tool of KTX-Software is downloaded once into `tools/.bin/` if it is not installed.
- In the game: GLTFLoader + KTX2Loader + MeshoptDecoder (`src/city/models.js`), Lambert materials like the
  rest of the city, +1 draw call per model; `?model=0` hides them for A/B checks.

## Controls (Quest 3, play seated)

Two steering modes, switched with the right stick press or on the start screen (remembered):
**stick** and **hands on the handlebar**.

| Button | Action |
|---|---|
| Both grips (hands mode) | Hold the V-shaped handlebar; steer by turning the hands like a moped bar |
| Twist the right hand towards you (hands mode) | Throttle, like a real tuk-tuk grip |
| Right trigger | Throttle (analog, both modes) |
| Left trigger | Brake, hold at standstill 0.4 s to reverse |
| Left stick ← → | Steer (hands mode: when the bar is released) |
| A | Handbrake (drift) |
| B (hold) | Nitro: a burst up to 60 km/h (`TUNING.nitroMaxKmh`, `?nitro=80`) for up to 4 s, then a 10 s recharge; in a tour the tourists shout "ой", −10 mood per use |
| Right stick forward | Horn (moved from B in 0.10.1) |
| Right stick press | Steering mode: stick / hands |
| X / hold X 1 s | FPS counter / stress test level (×1…×8) |
| Left stick press | Vignette strength (off / weak / standard / strong) |
| Y (hold 1 s) | Recentre the seat |
| A + B (hold 1 s) | Reset onto the nearest road (stick mode: both grips 1 s too) |
| Y (tap) | Tour: new tour after the summary; tap twice within 2 s to restart / start a tour from free ride |

## Controls (keyboard)

| Key | Action |
|---|---|
| W / ↑ | Throttle |
| S / ↓ | Brake (builds up: a tap brakes gently, holding brakes hard), hold at standstill to reverse |
| A D / ← → | Steer |
| Space | Handbrake (drift) |
| Shift (hold) | Nitro (as B in VR) |
| K | Cab tilt with the road: full / half / off |
| R | Reset onto nearest road |
| C | Cockpit / chase camera |
| F | FPS counter on the dashboard |
| H | Horn |
| G | Stress test level (×1…×8) |
| T | Tour: new tour after the summary; twice within 2 s to restart / start a tour from free ride |
| M | Full-screen map (also a click / tap on the minimap); M or Esc closes it |
| N | Minimap on / off |
| Right mouse drag | Look around |

URL parameters for testing: `?mode=free` / `?mode=tour` (free ride without the tour objects, e.g. for FPS
comparison), `?tour=short|full`, `?fps` (counter on from the start), `?stress=N` (render the scene N times
per frame to find the GPU headroom), `?hz=72` (force the headset refresh rate; otherwise it drops to
72 Hz by itself if 90 cannot be held), `?fbs=0.85` (XR framebuffer scale),
`?fov=0.5` (XR foveation 0..1, default 1), `?vignette` (show the VR vignette on desktop too),
`?tex=0` (no textures, the 0.5.0 look, for A/B comparison), `?tex=low` (facades only, plain roads),
`?tiles` (shows every generated tile on the page), `?photo=0` (landmarks without photo facades),
`?model=0` (without the 3D models of landmarks), `?terrain=0` (flat city), `?nitro=80` (nitro top speed, km/h).
`node tools/test-collisions.mjs` throws the tuk-tuk at walls at 60–130 km/h and fails if it ever goes through one.

## Phone diagnostics and the FPS measurement (0.10.2, stage F0 of [docs/plan-phone.md](docs/plan-phone.md))

The game already runs in Chrome on a phone; this stage only adds what is needed to *measure* it. VR and the
desktop view are unchanged (the phone parts switch on by themselves on a touch screen without hover; `?ui=phone`
/ `?ui=desktop` force one or the other).

- **Errors on screen.** Any script error (also a failed module / CDN load) shows a red line at the top; a tap
  opens the report. The early script in `index.html` does this even when the modules never start.
- **FPS button (top left).** On a phone: a widget with FPS, frame time, p95, "1 % lows", draw calls, triangles,
  JS time and a 10-minute graph (5 s per bar), plus **Діагностика** and **Замір**. On other devices: `?diag`.
- **Діагностика → Копіювати звіт.** One text with the version, URL, browser, screen, pixel ratio, GPU model,
  WebGL limits, sensors (it listens to `devicemotion` for 1 s), battery, FPS history, errors and the last
  console lines. The button copies it; if the browser refuses, the text stays selectable in the box.
- **`?bench` (or `?bench=N`).** The tuk-tuk drives / stands through 7 heavy places (start at Meliá, Rambla,
  Santa María, Mercado, half-way up to the castle, the castle gate looking at the city, 90 m above the gate):
  2.5 s warm-up + 8 s measured each. A table (FPS, 1 % lows, p95, worst frame, hitches, calls, triangles, CPU,
  GPU) and a verdict are shown at the end and are part of the report. `N` repeats the round: a fall of FPS from
  round to round is overheating. `?benchTime=0.5,2` shortens the times (tests).
- **Frame limiter.** On a phone 60 frames per second (a 120 Hz screen would double the heat for nothing);
  `?cap=N` changes it (`?cap=0` off, also available on desktop). Not used in VR.
- **`?dpr=N`** sets the pixel ratio (default `min(devicePixelRatio, 1.5)`), e.g. `?dpr=1` to see what a lower
  resolution gives.
- **Upright phone** → a "turn the phone" card and the game waits.

Files: `src/diag/` (`frameStats.js`, `report.js`, `ui.js`, `bench.js`, `device.js`), `src/perf/frameCap.js`.

## Phone play: touch controls, full screen, ground mask (0.11.0, stage F1 of [docs/plan-phone.md](docs/plan-phone.md))

On a touch phone (`?ui=phone` forces it) the game is played with the thumbs in landscape; PC and VR are unchanged.

- **Layout ("За столом").** Left: **◄ ►** steering buttons (or a slider, setting "Кермо"). Right: **ГАЗ** pedal
  (analog: the higher the finger on the pedal, the more throttle; or a plain button), **ГАЛЬМО**, **РУЧНИК**
  (handbrake), **НІТРО**. Middle: horn and **⟲** (look back). The free area of the screen turns the head; a
  double tap looks ahead. **≡** opens the menu (resume, back to the road, recentre, restart tour, free ride,
  diagnostics, full screen, settings: control mode, steering, throttle, field of view 100° horizontal,
  vibration, auto-return of the look, camera). The HTML HUD (speed, minimap, tour card) replaces the 3D panel
  on a phone.
- **Full screen.** The start button requests full screen + landscape lock + wake lock from the tap itself;
  the menu and a ⛶ button repeat it; a web manifest (`manifest.webmanifest`, `display: fullscreen`) and a no-op
  service worker (`sw.js`) allow "install as an app" (Chrome ⋮ → Install), which has no address bar at all.
  The diagnostics report shows what the browser answered (`запит повного екрана`).
- **Ground never covers the road.** The terrain mesh is a different surface from the road ribbons, so near
  roads it could cut through them (visible on Mali GPUs). `src/city/footprint.js` rasterises the footprint of all
  roads / sidewalks / plazas / parks into a 2048² mask and the ground fragment shader discards what lies under
  it. `?mask=0` turns it off (comparison only).
- **Hitch warm-up.** After the shaders are compiled one hidden 1×1 draw of the whole scene uploads every
  buffer, so the first frames of a route are not slow.
- Tests: `node tools/test-touch.mjs` (input curves of the touch controls match the keyboard ones).

Files: `src/input/touchControls.js`, `touchMath.js`, `src/ui/phoneUi.js`, `screenMode.js`, `src/city/rtin.js`,
`footprint.js`, `manifest.webmanifest`, `sw.js`, `assets/icons/` (`tools/make-icons.mjs` regenerates them).

## Phone: fixes and the full-screen map (0.11.1, stage F1b)

- **Roads never show through.** The ground under roads / plazas / parks is cut away (footprint mask). Three parts keep
  that cut clean: a *depth skin* (the layers' outer ribbons redrawn once without colour so buildings behind a hill
  cannot be drawn over the road), *two-sided ground* with a clear mask frame and a mask that is only applied inside the
  map, and *curb skirts* (short vertical aprons under the outer edge of every layer, fitted to the ground mesh).
  `?mask=0` switches the cut off, `?skin=0` keeps the cut but drops skin + skirts (both for comparisons only).
  The flat layers are now split into 800 m cells (frustum culling).
- **Resolution on a phone.** A budget of pixels per frame: "стандартна" 0.65 Mp (default), "висока" 0.85, "економна" 0.4
  (menu / start screen, "Роздільність картинки"); `?mp=N` sets it in megapixels, `?dpr=N` the ratio.
- **Start screen and menu scroll** on the phone (the layer itself scrolls; a "↓ ще налаштування" button shows when
  there is more below).
- **Route is recomputed after a wrong turn** (more than 20 m off the route for 1 s; was 60 m / 3 s) and the HTML
  minimap redraws it; "Маршрут перераховано" flashes. Test: `node tools/test-reroute.mjs [tour]`.
- **Full-screen map.** Tap the minimap (phone, or the 🗺 button / menu item) or click it / press **M** (PC). The game
  is paused. One finger drags, two fingers pinch (also wheel, + −, double tap), "До мене" goes back to the tuk-tuk,
  ✕ / Back / Esc / M closes it. It shows the streets, the walked trail (grey), the planned rest of the tour with
  direction arrows, the way to the next target (orange) and the named places (names from 0.4 px/m). **N** now toggles
  the corner minimap (was M). Code: `src/ui/fullMap.js`; nothing runs while it is closed.

## Crazy Tuk: the arcade mode (stages A0-A1 + wave 1 of [docs/plan-arcade.md](docs/plan-arcade.md) / [plan-arcade-a2.md](docs/plan-arcade-a2.md))

The second game mode on the start screen (phone first, PC too; not in VR). A run through the gates of a tour,
no stops: the tips come from the speed, every gate (a tour place) banks what is "at stake", a wall hit burns 30 % of
the stake, the clock counts down and every gate adds time. Reports: [a1](docs/report-arcade-a1.md),
[wave 1](docs/report-arcade-a2-wave1.md).

- **Physics profile** `ARCADE` in `src/vehicle/physics.js` (the real tuk-tuk's `TUNING` is untouched). The speeds are
  parameters there: `autoGasKmh` 70 (what the auto-gas holds), `maxForward` 120 (the pedal), `nitroMaxKmh` 150 (the nitro is
  a tank: burns 25 %/s, refills 3 %/s and at the gates). A motor that ignores the slope tables, brakes of 12 m/s², a turn
  rate bounded by 30 m/s² sideways, a rebound instead of a crash reset, a 120 m soft edge.
  **Drift:** the handbrake at speed (> 30 km/h) lets the rear grip go (`grip` 1 -> 0): the nose turns 2x faster than the path,
  the tuk-tuk slides sideways (side force bounded by `driftFriction`), steering against it catches the slide, releasing the
  handbrake brings the grip back in 0.4 s and the slide turns into forward speed. It never spins past 70 degrees and never flips.
- **The run** (`src/game/arcade.js`, no three.js): gates by the closest approach (exact ≤ 3 m, good ≤ 8, ok ≤ 20),
  fares every 20 m at speed, stake / pocket, whole euros, the clock (35 % of par at the start, the rest spread over the
  gates x 1.3 / 1.0 / 0.6; a tour without a measured par gets one from the route length), stuck -> back onto the road -3 s.
  Par times come from `data/arcade-par.json` (`node tools/sim-arcade.mjs <tour> --write`).
- **Simulation** `node tools/sim-arcade.mjs [tour] [beginner|normal|pro|proDrift]`: autopilots on the same physics (beginner /
  normal on the auto-gas, pro on the pedal), the corners of the planned route with the largest arc that fits between the
  walls, the par; `--drift`: the same pro driver with the brake against the handbrake, corner by corner.
  `PROFILE=arcade node tools/test-collisions.mjs`: throws at walls up to 170 km/h. `node tools/test-camera.mjs`: the chase
  camera along a whole run (never inside the cab, never inside a wall).
- **Via points** (`data/arcade-via.json`, 0.13.1): intermediate points before a gate where the straight arrow leads into a dead end (e.g. from the
  Postiguet beach to MARQ the arrow leads up the steep old-town steps); no grade, the arrow leads through them, the minimap shows them as small white
  dots. `node tools/arcade-vias.mjs [--write]` computes them from the drivable street graph (edges that are walls or steeper than 33 % are dropped).
  Slide with the nitro (or the gas pedal) held keeps its speed (`driftBoost*` in `ARCADE`); reversing 30 km/h; nitro works from a standstill.
- **Game:** `?mode=arcade`; auto-gas (a switch in the menu / on the start screen, remembered), chase camera
  (`src/game/arcadeCam.js`: higher and farther with the speed, a wider view, a light shake on the nitro, pulled in by walls),
  clock (+ the seconds a gate gives) / tips / gate line on top, a compact landmark card after each gate (name + one line from
  `data/arcade-facts.json`, uk/en/es, ≤ 70 characters; 4 s, fades), the minimap shows only the gates (the next one big and blinking,
  an arrow on the rim when it is out of the disc), a light pillar + ring on the next gate (pulses; a flash on passing), a 3D arrow over
  the tuk-tuk (half size, translucent, swings smoothly, never flips at a gate; `src/game/arcadeFx.js`), drift smoke and tyre marks, a summary with the record (localStorage),
  "Ще раз", "Справжній тур" and "Забронювати" (WhatsApp, number in `src/config.js`). Sound is synthesized
  (`src/audio/arcadeSound.js`): engine (pitch follows the speed), soft wind, nitro, tyre squeal, hit, gate; "Звук" and "Музика" are separate
  switches in the menu / start screen (the music itself comes in wave 2). T: run again (twice).

## Run locally

Any static server works, e.g.

    python3 -m http.server 8080

then open http://localhost:8080.

## Deploying (cache-busting)

The Quest browser caches aggressively. Every module, `city.json` and `main.js` is loaded with
`?v=<version>` (import map in `index.html`), and a tiny guard in `index.html` reloads the page
with `?v=<new>` if `version.json` says a newer build is deployed. Before every push:

    node tools/bump-version.mjs          # 0.4.0 -> 0.4.1 (or pass an explicit version)

## City data

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL.
Downloaded once and stored in `data/`; the game makes no API calls at runtime.

    node tools/fetch-osm.mjs    # one-time Overpass download -> data/raw/alicante.osm.json
    node tools/fetch-dem.mjs    # one-time IGN terrain download -> data/raw/dem5.asc
    node tools/build-city.mjs   # -> data/city.json (levels, facade styles, shared walls, street classes,
                                #    lanes / oneway / junctions, plaza kinds; merges style / h from data/facades.json;
                                #    tour places from data/tour.json + the drivable street graph)

Terrain: MDT05 © Instituto Geográfico Nacional (CNIG), CC BY 4.0 (see data/LICENSE).

Code: MIT. Data: ODbL (see data/LICENSE). Facade photos: their authors' licences (CC BY-SA / CC BY / public
domain, see assets/facades/CREDITS.md).
