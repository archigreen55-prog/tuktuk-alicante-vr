# Tuk-Tuk Alicante VR

Ride a tuk-tuk through the real centre of Alicante (Explanada de España, Rambla de Méndez Núñez,
Mercado Central, the port) in the browser — on Meta Quest 3 via WebXR, or on a laptop with the keyboard.

**Play:** https://archigreen55-prog.github.io/tuktuk-alicante-vr/

Status: early prototype (stages 0–3 of [docs/plan.md](docs/plan.md)): city from OpenStreetMap,
keyboard driving, collisions. VR controls come next.

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
| Right mouse drag | Look around |

## Run locally

Any static server works, e.g.

    python3 -m http.server 8080

then open http://localhost:8080.

## City data

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL.
Downloaded once and stored in `data/`; the game makes no API calls at runtime.

    node tools/fetch-osm.mjs    # one-time Overpass download -> data/raw/alicante.osm.json
    node tools/build-city.mjs   # -> data/city.json

Code: MIT. Data: ODbL (see data/LICENSE).
