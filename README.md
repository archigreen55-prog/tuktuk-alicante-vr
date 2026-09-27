# Tuk-Tuk Alicante VR

Ride a tuk-tuk through the real centre of Alicante (Explanada de España, Rambla de Méndez Núñez,
Mercado Central, the port) in the browser — on Meta Quest 3 via WebXR, or on a laptop with the keyboard.

**Play:** https://archigreen55-prog.github.io/tuktuk-alicante-vr/

Status: prototype (stages 0–4 of [docs/plan.md](docs/plan.md)): city from OpenStreetMap,
keyboard driving, collisions, WebXR on Quest 3 with controllers and a comfort vignette.
The build version is shown small on the dashboard and on the start screen.

## Controls (Quest 3, play seated)

| Button | Action |
|---|---|
| Right trigger | Throttle (analog) |
| Left trigger | Brake, hold at standstill 0.4 s to reverse |
| Left stick ← → | Steer |
| A / right stick press | Handbrake (drift) |
| B | Horn |
| X | FPS counter on the dashboard |
| Left stick press | Vignette strength (off / weak / standard / strong) |
| Y (hold 1 s) | Recentre the seat |
| Both grips (hold 1 s) | Reset onto the nearest road |

## Controls (keyboard)

| Key | Action |
|---|---|
| W / ↑ | Throttle |
| S / ↓ | Brake, hold at standstill to reverse |
| A D / ← → | Steer |
| Space | Handbrake (drift) |
| R | Reset onto nearest road |
| C | Cockpit / chase camera |
| F | FPS counter on the dashboard |
| H | Horn |
| Right mouse drag | Look around |

URL parameters for testing: `?fps` (counter on from the start), `?fbs=0.85` (XR framebuffer scale),
`?fov=0.5` (XR foveation 0..1, default 1), `?vignette` (show the VR vignette on desktop too).

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
    node tools/build-city.mjs   # -> data/city.json

Code: MIT. Data: ODbL (see data/LICENSE).
