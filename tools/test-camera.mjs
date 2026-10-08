// The Crazy Tuk chase camera on a whole run of the autopilot (docs/plan-arcade-a2.md wave 1, item 4): at every physics step
// the camera is placed as the game does and checked: never inside the cab (a box 2 m wide, 3.6 m long, 2.4 m high), never
// inside a wall, always above the ground, and higher / farther at speed.   node tools/test-camera.mjs [tour] [driver]
import { simulate } from './sim-arcade.mjs';
import { buildWorld } from './sim-tour.mjs';
import { ArcadeCam, CAM } from '../src/game/arcadeCam.js';
import { readFile } from 'node:fs/promises';
import { Terrain } from '../src/city/terrain.js';

const city = JSON.parse(await readFile('data/city.json', 'utf8'));
const terrain = city.meta.terrain ? Terrain.fromBin(city.meta.terrain, (await readFile(city.meta.terrain.file)).buffer.slice(0)) : null;
const groundAt = (x, z) => (terrain ? terrain.height(x, z) : 0);
const { world } = buildWorld();
const [tour = 'short', driver = 'pro'] = process.argv.slice(2);
const cam = new ArcadeCam();
let inCabN = 0, n = 0, minD = Infinity, inWall = 0, underGround = 0, maxD = 0, minH = Infinity, maxH = 0, pushed = 0, lowSpeedD = 0, ls = 0, hiSpeedD = 0, hs = 0;
const DT = 1 / 72;
// stress: the tuk-tuk facing back into the street it came from / turned sideways to a wall (a U-turn, a dead end, parked at a wall)
let sN = 0, sPulled = 0, sMin = Infinity, sWall = 0, sCab = 0;
// the cab as a box in the tuk-tuk's frame: 1 m to each side, from 1.2 m ahead to 2.4 m behind the centre, up to 2.4 m above the ground
const inCab = (c, x, z, h, gy) => { const fx = -Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h), dx = c.px - x, dz = c.pz - z, a = dx * fx + dz * fz, b = dx * rx + dz * rz; return a < 1.2 && a > -2.4 && Math.abs(b) < 1 && c.py < gy + 2.4; };
const stress = (phys) => {
  for (const turn of [Math.PI, Math.PI / 2, -Math.PI / 2]) {
    const c2 = new ArcadeCam(), gy = groundAt(phys.x, phys.z), h = phys.heading + turn;
    let c;
    for (let i = 0; i < 4; i++) c = c2.update(DT, { x: phys.x, z: phys.z, gy, heading: h, vx: 0, vz: 0, kmh: 0, nitro: false }, world, groundAt);
    sN++; const d = Math.hypot(c.px - phys.x, c.pz - phys.z); sMin = Math.min(sMin, d);
    if (d < CAM.dist[0] - 0.3) sPulled++;
    if (world.penetration(c.px, c.pz, 0.2) > 0) sWall++;
    if (inCab(c, phys.x, phys.z, h, gy)) sCab++;
  }
};
let stepN = 0;
simulate(tour, driver, { onStep: (t, phys) => {
  if (++stepN % 120 === 0) stress(phys);
  const gy = groundAt(phys.x, phys.z), kmh = Math.abs(phys.forwardSpeed) * 3.6;
  const c = cam.update(DT, { x: phys.x, z: phys.z, gy, heading: phys.heading, vx: phys.vx, vz: phys.vz, kmh, nitro: phys.nitro.active }, world, groundAt);
  n++;
  const d = Math.hypot(c.px - phys.x, c.pz - phys.z);
  minD = Math.min(minD, d); maxD = Math.max(maxD, d);
  const h = c.py - gy; minH = Math.min(minH, h); maxH = Math.max(maxH, h);
  if (world.penetration(c.px, c.pz, 0.2) > 0) inWall++;
  if (c.py < groundAt(c.px, c.pz) + 1.0) underGround++;
  if (d < CAM.dist[0] - 0.5) pushed++;
  if (inCab(c, phys.x, phys.z, phys.heading, gy)) inCabN++;
  if (kmh < 40) { lowSpeedD += d; ls++; } else if (kmh > 100) { hiSpeedD += d; hs++; }
} });
console.log(`${n} steps of ${tour}/${driver}`);
console.log(`camera distance to the tuk-tuk: min ${minD.toFixed(2)} m, max ${maxD.toFixed(1)} m; height above the ground ${minH.toFixed(1)}..${maxH.toFixed(1)} m`);
console.log(`avg distance: below 40 km/h ${(lowSpeedD / Math.max(1, ls)).toFixed(1)} m, above 100 km/h ${(hiSpeedD / Math.max(1, hs)).toFixed(1)} m`);
console.log(`steps with the camera inside a wall: ${inWall}; below the ground: ${underGround}; pulled in by a wall: ${pushed} (${(pushed / n * 100).toFixed(1)} %)`);
console.log(`stress (${sN} placements facing back / sideways to a wall): camera pulled in by a wall in ${sPulled} (${(sPulled / sN * 100).toFixed(0)} %), nearest ${sMin.toFixed(2)} m, inside a wall: ${sWall}, inside the cab: ${sCab}`);
const ok = sWall === 0 && sCab === 0 && inCabN === 0 && inWall === 0 && underGround === 0;
console.log(ok ? 'OK' : 'FAIL');
process.exit(ok ? 0 : 1);
