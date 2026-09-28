// Drives a whole tour in Node with an autopilot (no rendering): the same physics, collisions, route
// graph, tour logic and scoring as the game. For checking the tour data and calibrating the scoring.
// Usage: node tools/sim-tour.mjs [tourId] [careful|rough]    (defaults: every tour, both drivers)
import { readFile } from 'node:fs/promises';
import { CollisionWorld } from '../src/vehicle/collision.js';
import { TukTukPhysics } from '../src/vehicle/physics.js';
import { RoadGraph, polylineDistance } from '../src/game/route.js';
import { Tour } from '../src/game/tour.js';

const city = JSON.parse(await readFile('data/city.json', 'utf8'));
const spec = JSON.parse(await readFile('data/tour.json', 'utf8'));
const DT = 1 / 72;

// driver styles: max sideways acceleration planned in corners, braking, pedal limits
const DRIVERS = {
  careful: { aLat: 0.9, aDec: 1.8, maxBrake: 0.4, maxThrottle: 0.8, lookBase: 4, lookGain: 0.6 },
  rough: { aLat: 6, aDec: 5.5, maxBrake: 1, maxThrottle: 1, lookBase: 3, lookGain: 0.5 },
};

function buildWorld() {
  const R = city.meta.rect;
  const world = new CollisionWorld(R);
  for (const b of city.buildings) { world.addPolygon(b.p); for (const h of b.holes || []) world.addPolygon(h); }
  world.addPolygon(city.mount.foot);
  world.addPolygon(city.sea);
  const M = 5;
  const bounds = { minX: R.minX + M, maxX: R.maxX - M, minZ: R.minZ + M, maxZ: R.maxZ - M };
  world.addPolygon([bounds.minX, bounds.minZ, bounds.maxX, bounds.minZ, bounds.maxX, bounds.maxZ, bounds.minX, bounds.maxZ]);
  world.finalize();
  return { world, bounds };
}

// point on the polyline `ahead` metres past the closest point, and curvature-limited speed ahead
function pursue(pts, x, z, ahead) {
  const { at } = polylineDistance(pts, x, z);
  const pointAt = (s) => {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc + L >= s) { const t = L ? (s - acc) / L : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; }
      acc += L;
    }
    return pts[pts.length - 1];
  };
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return { target: pointAt(at + ahead), at, total, pointAt };
}

export function simulate(tourId, style, { log = false } = {}) {
  const { world, bounds } = buildWorld();
  const phys = new TukTukPhysics(world, city.start, bounds);
  const graph = new RoadGraph(city.tour.graph);
  const tour = new Tour(spec, city.tour, graph, tourId);
  const spawn = tour.spawnCandidates().find((c) => phys.fits(c.x, c.z, c.heading));
  if (!spawn) throw new Error('no spawn fits');
  phys.teleport(spawn.x, spawn.z, spawn.heading);
  const D = DRIVERS[style];
  const input = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false };
  let t = 0, pickupRoute = null, hits = 0, lastState = '';
  const eventsLog = [];
  while (t < 3600) {
    t += DT;
    tour.update({ dt: DT, x: phys.x, z: phys.z, speed: phys.forwardSpeed, accel: phys.accel, yawRate: phys.yawRate, brake: input.brake, reversing: phys.reversing, impact: phys.lastImpact, contact: phys.contactTimer > 0, handbrake: input.handbrake });
    for (const ev of tour.events) {
      if (ev.type === 'comfort' || ev.type === 'pass' || ev.type === 'stop' || ev.type === 'summary' || ev.type === 'seated' || ev.type === 'dropoff') eventsLog.push(`${t.toFixed(1).padStart(6)}s ${ev.type}${ev.kind ? ' ' + ev.kind + ' ' + ev.delta : ''}${ev.id ? ' ' + ev.id : ''}`);
    }
    if (tour.state !== lastState) { lastState = tour.state; }
    if (tour.state === 'summary') break;
    // autopilot
    let path = null;
    if (tour.state === 'waiting') {
      if (!pickupRoute) pickupRoute = graph.route([phys.x, phys.z], tour.start.p)?.pts;
      path = pickupRoute;
    } else if (tour.state === 'driving' || tour.state === 'afterPhoto') path = tour.route;
    const v = phys.forwardSpeed;
    input.throttle = 0; input.brake = 0; input.steer = 0;
    input.reverseDelay = tour.holdBrake ? Infinity : undefined;
    if (!path || tour.state === 'boarding' || tour.state === 'photo' || tour.state === 'dropoff') {
      input.brake = v > 0.05 ? D.maxBrake : 0.3;
    } else {
      const look = D.lookBase + D.lookGain * Math.abs(v);
      const { target, at, total, pointAt } = pursue(path, phys.x, phys.z, look);
      const fx = -Math.sin(phys.heading), fz = -Math.cos(phys.heading), rx = Math.cos(phys.heading), rz = -Math.sin(phys.heading);
      const tx = target[0] - phys.x, tz = target[1] - phys.z;
      const alpha = Math.atan2(tx * rx + tz * rz, tx * fx + tz * fz);
      input.steer = Math.max(-1, Math.min(1, alpha * 2.2));
      // speed: curvature ahead and the end of the path (stop point)
      let vt = 40 / 3.6;
      for (let s = 4; s <= 40; s += 4) {
        const a = pointAt(at + s - 4), b = pointAt(at + s), c = pointAt(at + s + 4);
        const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]), h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
        const k = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))) / 4;
        const vTurn = k > 1e-3 ? Math.sqrt(D.aLat / k) : 40 / 3.6;
        vt = Math.min(vt, Math.sqrt(vTurn * vTurn + 2 * D.aDec * Math.max(0, s - 6)));
      }
      const endDist = total - at;
      const stopping = tour.state === 'driving' && tour.zone && endDist < 60;
      if (stopping || tour.state === 'waiting') vt = Math.min(vt, Math.sqrt(2 * D.aDec * Math.max(0, endDist - 1.5)));
      vt = Math.min(vt, Math.max(1.5, 11 - Math.abs(alpha) * 8));
      if (v < vt - 0.3) input.throttle = Math.min(D.maxThrottle, Math.max(0.15, (vt - v) * 0.4));
      else if (v > vt + 0.3) input.brake = Math.min(D.maxBrake, Math.max(0.1, (v - vt) * 0.35));
      if (endDist < 1.5 && (stopping || tour.state === 'waiting')) input.brake = Math.max(input.brake, v > 0.05 ? D.maxBrake : 0);
    }
    phys.step(DT, input);
    if (phys.lastImpact > 0.5) hits++;
  }
  const r = tour.result;
  return { tour, r, t, eventsLog, hits, reverts: phys.reverts || 0 };
}

const [argTour, argStyle] = process.argv.slice(2);
if (process.argv[1] && process.argv[1].endsWith('sim-tour.mjs')) {
  for (const t of spec.tours) {
    if (argTour && t.id !== argTour) continue;
    for (const style of Object.keys(DRIVERS)) {
      if (argStyle && style !== argStyle) continue;
      const { tour, r, t: simT, eventsLog, hits, reverts } = simulate(t.id, style);
      console.log(`\n=== tour ${t.id}, ${style} driver: ${tour.state} after ${(simT / 60).toFixed(1)} min sim time ===`);
      if (!r) { console.log(`NOT FINISHED: state ${tour.state}, next item ${tour.next}/${tour.items.length}, clock ${tour.clock.toFixed(0)} s`); console.log(eventsLog.slice(-15).join('\n')); continue; }
      const counts = Object.entries(r.counts).filter(([, n]) => n).map(([k, n]) => `${k}×${n}`).join(', ') || 'none';
      console.log(`stars ${r.stars}, mood ${r.mood}, tips ${r.tips} € (group ${tour.group}), time ${(r.time / 60).toFixed(1)} / target ${(r.target / 60).toFixed(1)} min (${r.onTime}), stops ${tour.stopsDone}/${tour.stopCount}, passes ${r.passes}/${r.passCount}, wall contacts ${hits}, anti-stuck ${reverts}`);
      console.log(`events: ${counts}; review: ${r.review} "${r.reviewText}"`);
      if (process.env.LOG) console.log(eventsLog.join('\n'));
    }
  }
}
