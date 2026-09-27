# Tuk-Tuk Alicante VR

Ride a tuk-tuk through the real centre of Alicante (Explanada de España, Rambla de Méndez Núñez,
Mercado Central, the port) in the browser — on Meta Quest 3 via WebXR, or on a laptop with the keyboard.

**Play:** https://archigreen55-prog.github.io/tuktuk-alicante-vr/

Status: prototype (stages 0–4 and 5a of [docs/plan.md](docs/plan.md)): city from OpenStreetMap,
keyboard driving, collisions, WebXR on Quest 3 with controllers, hands-on-handlebar steering and a comfort vignette.
The build version is shown small on the dashboard and on the start screen.

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
| G | Stress test level (×1…×8) |
| Right mouse drag | Look around |

URL parameters for testing: `?fps` (counter on from the start), `?stress=N` (render the scene N times
per frame to find the GPU headroom), `?hz=72` (force the headset refresh rate; otherwise it drops to
72 Hz by itself if 90 cannot be held), `?fbs=0.85` (XR framebuffer scale),
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
