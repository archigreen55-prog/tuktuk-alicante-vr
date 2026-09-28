# Tuk-Tuk Alicante VR

Ride a tuk-tuk through the real centre of Alicante (Explanada de España, Rambla de Méndez Núñez,
Mercado Central, the port) in the browser — on Meta Quest 3 via WebXR, or on a laptop with the keyboard.

**Play:** https://archigreen55-prog.github.io/tuktuk-alicante-vr/

Status: prototype (stages 0–5 and 6a of [docs/plan.md](docs/plan.md), [docs/plan-stage-6.md](docs/plan-stage-6.md)): city
from OpenStreetMap, keyboard driving, collisions, WebXR on Quest 3 with controllers, hands-on-handlebar steering, a comfort
vignette, code-drawn textures (facades, roads, sidewalks, the Explanada mosaic) and the **tour mission**.
The build version is shown small on the dashboard and on the start screen.

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
overrides per OSM id; photo facades are reserved for later). Balconies along the main streets are one
`InstancedMesh`.

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
| B | Horn |
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
| R | Reset onto nearest road |
| C | Cockpit / chase camera |
| F | FPS counter on the dashboard |
| H | Horn |
| G | Stress test level (×1…×8) |
| T | Tour: new tour after the summary; twice within 2 s to restart / start a tour from free ride |
| M | Minimap on / off |
| Right mouse drag | Look around |

URL parameters for testing: `?mode=free` / `?mode=tour` (free ride without the tour objects, e.g. for FPS
comparison), `?tour=short|full`, `?fps` (counter on from the start), `?stress=N` (render the scene N times
per frame to find the GPU headroom), `?hz=72` (force the headset refresh rate; otherwise it drops to
72 Hz by itself if 90 cannot be held), `?fbs=0.85` (XR framebuffer scale),
`?fov=0.5` (XR foveation 0..1, default 1), `?vignette` (show the VR vignette on desktop too),
`?tex=0` (no textures, the 0.5.0 look, for A/B comparison), `?tex=low` (facades only, plain roads),
`?tiles` (shows every generated tile on the page).

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
    node tools/build-city.mjs   # -> data/city.json (levels, facade styles, shared walls, street classes,
                                #    lanes / oneway / junctions, plaza kinds; merges data/facades.json;
                                #    tour places from data/tour.json + the drivable street graph)

Code: MIT. Data: ODbL (see data/LICENSE).
