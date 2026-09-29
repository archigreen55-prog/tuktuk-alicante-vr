// Collision check at nitro speeds (report-terrain-1b.md): the tuk-tuk is thrown at building walls, the
// castle / city walls and the coast from outside, at 60–130 km/h and 0–70° off the wall normal, with the
// nitro held. A failure = a collision circle's centre crossed a wall edge (tunnelling). Same world as the
// game (buildings, walls, sea, bounds), same physics and terrain.
// Usage: node tools/test-collisions.mjs [trials per speed]      (NOSUB=1: without the sub-steps, for comparison)
import { readFile } from 'node:fs/promises';
import { CollisionWorld } from '../src/vehicle/collision.js';
import { TukTukPhysics, TUNING } from '../src/vehicle/physics.js';
import { Terrain } from '../src/city/terrain.js';

const city = JSON.parse(await readFile('data/city.json', 'utf8'));
const terrain = Terrain.fromBin(city.meta.terrain, (await readFile(city.meta.terrain.file)).buffer.slice(0));
const TRIALS = +process.argv[2] || 400;
if (process.env.NOSUB) TUNING.maxStep = Infinity;
const DT = 1 / 72;

const R = city.meta.rect;
const world = new CollisionWorld(R);
const targets = []; // [ax, az, bx, bz, kind] segments to aim at
for (const b of city.buildings) {
  world.addPolygon(b.p);
  for (const h of b.holes || []) world.addPolygon(h);
  for (let i = 0; i < b.p.length; i += 2) {
    const j = (i + 2) % b.p.length;
    targets.push([b.p[i], b.p[i + 1], b.p[j], b.p[j + 1], 'building']);
  }
}
for (const w of city.walls || []) {
  world.addPolygon(w.p, !!w.closed);
  const n = w.p.length / 2, last = w.closed ? n : n - 1;
  for (let i = 0; i < last; i++) { const j = (i + 1) % n; targets.push([w.p[i * 2], w.p[i * 2 + 1], w.p[j * 2], w.p[j * 2 + 1], 'wall']); }
}
world.addPolygon(city.sea);
for (let i = 0; i < city.sea.length; i += 2) { const j = (i + 2) % city.sea.length; targets.push([city.sea[i], city.sea[i + 1], city.sea[j], city.sea[j + 1], 'coast']); }
const M = 5;
const bounds = { minX: R.minX + M, maxX: R.maxX - M, minZ: R.minZ + M, maxZ: R.maxZ - M };
world.addPolygon([bounds.minX, bounds.minZ, bounds.maxX, bounds.minZ, bounds.maxX, bounds.maxZ, bounds.minX, bounds.maxZ]);
world.finalize();

// does the segment p->q cross any collision edge? (grid of the collision world)
function crosses(px, pz, qx, qz) {
  const c = world.cell, E = world.E;
  const i0 = Math.max(0, Math.floor((Math.min(px, qx) - world.ox) / c)), i1 = Math.min(world.nx - 1, Math.floor((Math.max(px, qx) - world.ox) / c));
  const j0 = Math.max(0, Math.floor((Math.min(pz, qz) - world.oz) / c)), j1 = Math.min(world.nz - 1, Math.floor((Math.max(pz, qz) - world.oz) / c));
  const side = (ax, az, bx, bz, x, z) => (bx - ax) * (z - az) - (bz - az) * (x - ax);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    for (const e of world.cells[j * world.nx + i]) {
      const ax = E[e * 4], az = E[e * 4 + 1], bx = E[e * 4 + 2], bz = E[e * 4 + 3];
      const d1 = side(ax, az, bx, bz, px, pz), d2 = side(ax, az, bx, bz, qx, qz);
      const d3 = side(px, pz, qx, qz, ax, az), d4 = side(px, pz, qx, qz, bx, bz);
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
  }
  return false;
}
const centres = (ph) => { const fx = -Math.sin(ph.heading), fz = -Math.cos(ph.heading); return TUNING.circles.map((o) => [ph.x + fx * o, ph.z + fz * o]); };

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const kinds = ['building', 'wall', 'coast'];
const byKind = Object.fromEntries(kinds.map((k) => [k, targets.filter((t) => t[4] === k && Math.hypot(t[2] - t[0], t[3] - t[1]) > 3)]));

console.log(`collision edges ${world.edgeCount}; sub-steps ${process.env.NOSUB ? 'OFF' : `on (≤ ${TUNING.maxStep} m)`}; ${TRIALS} throws per speed and target kind`);
let failedTotal = 0;
for (const kmh of [60, 80, 100, 130]) {
  TUNING.nitroMaxKmh = kmh;
  for (const kind of kinds) {
    const list = byKind[kind];
    let runs = 0, tunnels = 0, crashes = 0, reverts = 0, hits = 0;
    for (let trial = 0, guard = 0; trial < TRIALS && guard < TRIALS * 20; guard++) {
      const [ax, az, bx, bz] = list[Math.floor(rnd() * list.length)];
      const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
      const t = 0.2 + rnd() * 0.6, mx = ax + ux * L * t, mz = az + uz * L * t;
      const s = rnd() < 0.5 ? 1 : -1;                 // either side (outer rings: one side is inside the building)
      const nx = -uz * s, nz = ux * s;
      const dist = 12 + rnd() * 10, off = (rnd() - 0.5) * 2 * 70 * Math.PI / 180;
      const sx = mx + nx * dist, sz = mz + nz * dist;
      if (sx < bounds.minX + 30 || sx > bounds.maxX - 30 || sz < bounds.minZ + 30 || sz > bounds.maxZ - 30) continue;
      // drive direction: towards the wall (-n), turned by off
      const dx = -nx * Math.cos(off) + nz * Math.sin(off), dz = -nz * Math.cos(off) - nx * Math.sin(off);
      const heading = Math.atan2(-dx, -dz);
      const ph = new TukTukPhysics(world, { x: sx, z: sz, heading }, bounds, terrain);
      if (!ph.fits(sx, sz, heading) || crosses(sx, sz, mx, mz)) continue; // start must be free and see the wall
      trial++; runs++;
      ph.vx = dx * kmh / 3.6; ph.vz = dz * kmh / 3.6;
      ph.nitro.active = true; ph.nitro.t = 0; ph.nitro.held = true;
      let prev = centres(ph), tunnelled = false, hit = false;
      for (let k = 0; k < 2 * 72; k++) {
        ph.step(DT, { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: true });
        if (ph.lastImpact > 0.5) hit = true;
        const cur = centres(ph);
        if (!ph.reverts && cur.some((c, i) => crosses(prev[i][0], prev[i][1], c[0], c[1]))) tunnelled = true;
        if (ph.crash) { crashes++; ph.crash = false; }
        prev = cur;
      }
      if (hit) hits++;
      if (tunnelled) tunnels++;
      reverts += ph.reverts ? 1 : 0;
    }
    failedTotal += tunnels;
    console.log(`${String(kmh).padStart(4)} km/h  ${kind.padEnd(8)} throws ${String(runs).padStart(4)}  hit ${String(hits).padStart(4)}  crash-reset ${String(crashes).padStart(4)}  through the wall ${String(tunnels).padStart(3)}  anti-stuck ${reverts}`);
  }
}
console.log(failedTotal ? `FAIL: ${failedTotal} throws went through a wall` : 'OK: no throw went through a wall');
process.exit(failedTotal ? 1 : 0);
