// Crazy Tuk in Node (docs/plan-arcade.md, stage A0): three autopilots (beginner / normal / pro) run the gates of a tour
// at 60-150 km/h with the ARCADE physics profile, the same collisions and terrain as the game, and the same Arcade
// class. Prints: the corners of the route with the largest arc that fits between the buildings (-> the top speed in
// that corner), each driver's run (time, speeds, hits, gates), and the par time the game uses for its clock.
//   node tools/sim-arcade.mjs [tourId] [driver]     (default: short, all three)
//   node tools/sim-arcade.mjs short --par           recomputes the par (the normal driver × margin); --write stores it in data/arcade-par.json
import { readFile } from 'node:fs/promises';
import { TukTukPhysics, ARCADE } from '../src/vehicle/physics.js';
import { RoadGraph, polylineDistance } from '../src/game/route.js';
import { Arcade, RUSH } from '../src/game/arcade.js';
import { buildWorld } from './sim-tour.mjs';

// Pursuit with memory: the progress along the line only moves forward (a window around the last position), so a route
// that passes the same street twice (out to a gate and back) does not snap the target to the later pass.
function makePursuit(pts) {
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const pointAt = (s) => { s = Math.max(0, Math.min(total, s)); let i = 1; while (i < pts.length - 1 && cum[i] < s) i++; const L = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / L; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; };
  let at = 0, first = true;
  return (x, z, ahead) => {
    const lo = first ? 0 : Math.max(0, at - 15), hi = first ? Math.min(total, 200) : Math.min(total, at + 80);
    first = false;
    let best = Infinity, bestAt = at;
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] < lo || cum[i - 1] > hi) continue;
      const a = pts[i - 1], b = pts[i], ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1;
      let t = ((x - a[0]) * ex + (z - a[1]) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t);
      if (d < best) { best = d; bestAt = cum[i - 1] + (cum[i] - cum[i - 1]) * t; }
    }
    at = bestAt;
    return { target: pointAt(at + ahead), at, total, pointAt, off: best };
  };
}
import { Terrain } from '../src/city/terrain.js';

const city = JSON.parse(await readFile('data/city.json', 'utf8'));
const terrain = city.meta.terrain ? Terrain.fromBin(city.meta.terrain, (await readFile(city.meta.terrain.file)).buffer.slice(0)) : null;
const spec = JSON.parse(await readFile('data/tour.json', 'utf8'));
// levels: by id from data/levels/index.json, or a path to a level file (node tools/sim-arcade.mjs data/levels-submitted/x.json)
const LEVELS = {};
for (const row of JSON.parse(await readFile('data/levels/index.json', 'utf8')).levels) LEVELS[row.id] = JSON.parse(await readFile(`data/levels/${row.file}`, 'utf8'));
export async function loadLevelFile(path) { const lv = JSON.parse(await readFile(path, 'utf8')); LEVELS[lv.id] = lv; return lv.id; }
const WORLD = { places: city.tour.places, spec };
let parFile = {}; try { parFile = JSON.parse(await readFile('data/arcade-par.json', 'utf8')); } catch { /* none yet */ }
const DT = 1 / 72;
const PAR_MARGIN = 1.3;   // par = the normal autopilot's time × this (a person brakes more and hits more than the autopilot)

// Drivers: aLat = sideways acceleration they plan corners for (the physics allows 30), aDec = braking they plan with,
// top = the speed they are comfortable with without nitro, nitro = use it on straights, look = pursuit distance
export const DRIVERS = {
  // cruise = the auto-gas speed (km/h; none = the pedal, up to 120), drift = the handbrake in sharp corners instead of the brake
  beginner: { aLat: 9, aDec: 8, top: 95 / 3.6, cruise: ARCADE.autoGasKmh, nitro: false, lookBase: 6, lookGain: 0.5, gain: 1.3, brakeMax: 0.9 },
  normal: { aLat: 15, aDec: 11, top: 120 / 3.6, cruise: ARCADE.autoGasKmh, nitro: true, nitroMinStraight: 120, lookBase: 5, lookGain: 0.45, gain: 1.6, brakeMax: 1 },
  pro: { aLat: 26, aDec: 12, top: 120 / 3.6, nitro: true, nitroMinStraight: 70, lookBase: 4.5, lookGain: 0.42, gain: 1.9, brakeMax: 1 },
  // the same pro driver, with the handbrake (drift) in the sharp corners instead of braking
  proDrift: { aLat: 26, aDec: 12, top: 120 / 3.6, nitro: true, nitroMinStraight: 70, lookBase: 4.5, lookGain: 0.42, gain: 1.9, brakeMax: 1, drift: true },
};

// ---------- corners of a route: the largest arc that fits between the walls ----------
const CLEAR = ARCADE.circleR + 0.35;   // m: radius the arc samples must keep free (the body is 3 circles of 0.72)
function corners(pts, world) {
  const out = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], v = pts[i], b = pts[i + 1];
    const l1 = Math.hypot(v[0] - a[0], v[1] - a[1]), l2 = Math.hypot(b[0] - v[0], b[1] - v[1]);
    if (l1 < 1 || l2 < 1) continue;
    const u1 = [(v[0] - a[0]) / l1, (v[1] - a[1]) / l1], u2 = [(b[0] - v[0]) / l2, (b[1] - v[1]) / l2];
    const th = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
    if (th < 30 * Math.PI / 180) continue;
    const bis = [u2[0] - u1[0], u2[1] - u1[1]], bl = Math.hypot(bis[0], bis[1]) || 1; bis[0] /= bl; bis[1] /= bl;
    const fits = (R) => {
      const t = R * Math.tan(th / 2);
      if (t > Math.min(l1, l2) * 0.9) return false;
      const cx = v[0] + bis[0] * R / Math.cos(th / 2), cz = v[1] + bis[1] * R / Math.cos(th / 2);
      const ax = v[0] - u1[0] * t, az = v[1] - u1[1] * t, bx = v[0] + u2[0] * t, bz = v[1] + u2[1] * t;
      const a0 = Math.atan2(az - cz, ax - cx); let a1 = Math.atan2(bz - cz, bx - cx);
      // go the short way round from a0 to a1
      let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      const n = Math.max(4, Math.ceil(Math.abs(da) * R / 0.5));
      for (let k = 0; k <= n; k++) { const ang = a0 + da * k / n; if (world.penetration(cx + Math.cos(ang) * R, cz + Math.sin(ang) * R, CLEAR) > 0) return false; }
      return true;
    };
    let lo = 0, hi = 60;
    if (!fits(2)) hi = 0; else { lo = 2; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; } }
    const R = lo;
    const vMax = R > 0 ? Math.min(150, Math.sqrt(Math.min(ARCADE.latAccelMax * R, ARCADE.maxYawRate * ARCADE.maxYawRate * R * R)) * 3.6) : 0;
    out.push({ i, x: v[0], z: v[1], deg: th * 180 / Math.PI, R, vMax });
  }
  return out;
}
// racing line: the route with the corners replaced by arcs of the fitting radius (capped), for the pursuit and the
// curvature-based speed planning
function racingLine(pts, cs, capR = 14) {
  const byI = new Map(cs.map((c) => [c.i, c]));
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const c = byI.get(i);
    if (!c || c.R < 2.5) { out.push(pts[i]); continue; }
    const a = pts[i - 1], v = pts[i], b = pts[i + 1];
    const l1 = Math.hypot(v[0] - a[0], v[1] - a[1]), l2 = Math.hypot(b[0] - v[0], b[1] - v[1]);
    const u1 = [(v[0] - a[0]) / l1, (v[1] - a[1]) / l1], u2 = [(b[0] - v[0]) / l2, (b[1] - v[1]) / l2];
    const th = c.deg * Math.PI / 180, R = Math.min(capR, c.R), t = Math.min(R * Math.tan(th / 2), Math.min(l1, l2) * 0.45);
    const Rr = t / Math.tan(th / 2);
    const bis = [u2[0] - u1[0], u2[1] - u1[1]], bl = Math.hypot(bis[0], bis[1]) || 1;
    const cx = v[0] + bis[0] / bl * Rr / Math.cos(th / 2), cz = v[1] + bis[1] / bl * Rr / Math.cos(th / 2);
    const ax = v[0] - u1[0] * t, az = v[1] - u1[1] * t, bx = v[0] + u2[0] * t, bz = v[1] + u2[1] * t;
    const a0 = Math.atan2(az - cz, ax - cx); let da = Math.atan2(bz - cz, bx - cx) - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    const n = Math.max(3, Math.ceil(Math.abs(da) * Rr / 2));
    for (let k = 0; k <= n; k++) { const ang = a0 + da * k / n; out.push([cx + Math.cos(ang) * Rr, cz + Math.sin(ang) * Rr]); }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function simulate(tourId, style, { par = null, log = false, onStep = null } = {}) {
  const { world, bounds } = buildWorld();
  const phys = new TukTukPhysics(world, city.start, bounds, terrain, ARCADE);
  phys.nitro.charge = 0.5;
  const graph = new RoadGraph(city.tour.graph);
  // par: null = no clock (the run that measures the par); a number = the clock; the level's own par is not used here
  const run = new Arcade({ ...LEVELS[tourId], time: { mode: 'auto', par } }, { ...WORLD, graph });
  // start: the level's spawn place, facing the first gate's road
  const cands = run.start.back && run.start.back.length ? run.start.back.map(([x, z, heading]) => ({ x, z, heading })) : [{ x: city.start.x, z: city.start.z, heading: city.start.heading }];
  const spawn = cands.find((c) => phys.fits(c.x, c.z, c.heading)) || cands[0];
  phys.teleport(spawn.x, spawn.z, spawn.heading);
  run.begin(phys.x, phys.z);
  const D = DRIVERS[style];
  const input = { throttle: 0, brake: 0, steer: 0, handbrake: false, horn: false, nitro: false };
  let t = 0, routeV = -1, line = null, pursueLine = null, cs = null, below60 = 0, hitsHard = 0, minV = Infinity, sumV = 0, nV = 0, stuck = 0;
  const cornerT = new Map();
  let driftOn = false, driftT = 0, driftN = 0;
  const cornerMin = new Map();   // corner index -> min speed within 12 m
  const gatesLog = [];
  while (t < 900 && !run.done) {
    t += DT;
    if (run.routeVersion !== routeV && run.route) {
      routeV = run.routeVersion; cs = corners(run.route, world); line = racingLine(run.route, cs); pursueLine = makePursuit(line);
    }
    const v = phys.forwardSpeed;
    input.throttle = 1; input.brake = 0; input.steer = 0; input.nitro = false; input.handbrake = false; input.cruiseKmh = D.cruise || 0;
    if (line) {
      const look = D.lookBase + D.lookGain * Math.abs(v);
      let { target, at, total, pointAt } = pursueLine(phys.x, phys.z, look);
      // close to the gate a person aims at the arch itself, not at the line (which may loop round a block to it)
      const g = run.gate;
      if (g) {
        const gx = g.p[0] - phys.x, gz = g.p[1] - phys.z, dg = Math.hypot(gx, gz);
        const fx0 = -Math.sin(phys.heading), fz0 = -Math.cos(phys.heading);
        if (dg < 45 && (gx * fx0 + gz * fz0) / dg > 0.7) target = g.p;   // ahead within 45°, less than 45 m
      }
      const fx = -Math.sin(phys.heading), fz = -Math.cos(phys.heading), rx = Math.cos(phys.heading), rz = -Math.sin(phys.heading);
      const tx = target[0] - phys.x, tz = target[1] - phys.z;
      const alpha = Math.atan2(tx * rx + tz * rz, tx * fx + tz * fz);
      input.steer = Math.max(-1, Math.min(1, alpha * D.gain));
      // speed plan: curvature ahead on the racing line (heading change over 6 m), braking distance to it
      let vt = D.top, straight = total - at, sSharp = Infinity;
      const horizon = Math.max(40, v * v / (2 * D.aDec) + 30);
      for (let s = 3; s <= horizon; s += 3) {
        const a = pointAt(at + s - 3), b = pointAt(at + s), c = pointAt(at + s + 3);
        const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]), h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
        const k = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))) / 3;
        if (k > 0.004 && s < straight) straight = s;
        const vTurn = k > 1e-3 ? Math.sqrt(D.aLat / k) : D.top;
        vt = Math.min(vt, Math.sqrt(vTurn * vTurn + 2 * D.aDec * Math.max(0, s - 4)));
        if (k > 0.035 && vTurn < v - 3 && sSharp === Infinity) sSharp = s;   // a sharp corner we are too fast for
      }
      // the drift: instead of braking before a sharp corner, pull the handbrake at its mouth and hold it until the nose points along the way out
      if (D.drift) {
        const kNow = (() => { const a = pointAt(at), b = pointAt(at + 4), c = pointAt(at + 8); const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]), h2 = Math.atan2(c[1] - b[1], c[0] - b[0]); return Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))) / 4; })();
        if (!driftOn && v > 14 && sSharp < v * 0.22 + 2) { driftOn = true; driftT = 0; driftN++; }
        if (driftOn) { driftT += DT; if (driftT > 0.4 && ((kNow < 0.012 && Math.abs(alpha) < 0.3) || driftT > 2.2)) driftOn = false; }
        if (driftOn) input.handbrake = true;
      }
      if (v > vt + 0.5 && !driftOn) { input.throttle = 0; input.brake = Math.min(D.brakeMax, Math.max(0.2, (v - vt) * 0.25)); }
      if (D.nitro && straight > D.nitroMinStraight && v > 14 && vt >= D.top - 0.1 && phys.nitro.charge > 0.05) input.nitro = true;
    }
    phys.step(DT, input);
    if (phys.hit) { hitsHard++; phys.hit = null; }
    if (run.nitroBonus) { phys.nitro.charge = Math.min(1, phys.nitro.charge + run.nitroBonus); run.nitroBonus = 0; }
    const pen = world.penetration(phys.x, phys.z, 1.8);
    run.update({ dt: DT, x: phys.x, z: phys.z, speed: phys.forwardSpeed, impact: phys.lastImpact, contact: phys.contactTimer > 0, blocked: phys.slopeHit > 0, nitroActive: phys.nitro.active,
      clearance: pen > 0 ? 1.8 - pen - 0.72 : null, drifting: phys.grip < 0.8 && phys.slipSpeed > ARCADE.driftSmoke && phys.contactTimer <= 0 });
    for (const ev of run.events) {
      if (ev.type === 'gate') gatesLog.push(`${(run.clock).toFixed(1).padStart(6)}s  ${ev.title.padEnd(32)} ${ev.kind.padEnd(7)} +${ev.tips.toFixed(0)} € +${ev.time.toFixed(0)} s  (${(phys.forwardSpeed * 3.6).toFixed(0)} km/h)`);
      if (ev.type === 'stuck') {   // like the game's "back onto the road": onto the racing line, facing along it
        stuck++;
        const { at, pointAt } = pursueLine(phys.x, phys.z, 0), a = pointAt(at + 8), b = pointAt(at + 14);
        phys.teleport(a[0], a[1], Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])));
      }
    }
    const kmh = phys.forwardSpeed * 3.6;
    if (kmh < 60) below60 += DT;
    if (t > 4) minV = Math.min(minV, kmh);
    sumV += kmh; nV++;
    if (cs) for (const c of cs) {
      if (c.deg < 60) continue;
      const d = Math.hypot(phys.x - c.x, phys.z - c.z), key = `${c.x.toFixed(0)},${c.z.toFixed(0)}`;
      if (d < 35) { const e = cornerT.get(key) || { in: t, out: t, hits: 0, deg: c.deg, R: c.R }; e.out = t; if (phys.lastImpact > 4) e.hits++; cornerT.set(key, e); }
    }
    if (cs) for (const c of cs) { const d = Math.hypot(phys.x - c.x, phys.z - c.z); if (d < 12) { const key = `${c.x.toFixed(0)},${c.z.toFixed(0)}`; cornerMin.set(key, Math.min(cornerMin.get(key) ?? Infinity, kmh)); } }
    if (onStep) onStep(t, phys, run);
  }
  return { run, driftN, cornerT, r: run.result, t, below60, hitsHard, minV, avgV: sumV / Math.max(1, nV), stuck, reverts: phys.reverts || 0, gatesLog, cornerMin, cornersOf: (pts) => corners(pts, world) };
}

let [argTour = 'short', argStyle] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (argTour.endsWith('.json') && process.argv[1] && process.argv[1].endsWith('sim-arcade.mjs')) argTour = await loadLevelFile(argTour);
const wantPar = process.argv.includes('--par') || process.argv.includes('--write');
const writePar = process.argv.includes('--write');
if (process.argv[1] && process.argv[1].endsWith('sim-arcade.mjs') && process.argv.includes('--drift')) {
  // the handbrake against the brake: the same pro driver, per corner of 60°+ (35 m before to 35 m after the corner point)
  const par = parFile[argTour] || (LEVELS[argTour].time && LEVELS[argTour].time.par) || null;
  const a = simulate(argTour, 'pro', { par }), b = simulate(argTour, 'proDrift', { par });
  let ta = 0, tb = 0, n = 0, faster = 0; const rows = [];
  for (const [k, ea] of a.cornerT) { const eb = b.cornerT.get(k); if (!eb) continue; const da = ea.out - ea.in, db = eb.out - eb.in; ta += da; tb += db; n++; if (db < da - 0.05) faster++; rows.push(`${k.padEnd(10)} ${ea.deg.toFixed(0).padStart(3)}° R${ea.R.toFixed(1).padStart(5)}  brake ${da.toFixed(2)} s (${ea.hits} hits)   drift ${db.toFixed(2)} s (${eb.hits} hits)   ${(da - db >= 0 ? '-' : '+') + Math.abs(da - db).toFixed(2)} s`); }
  console.log(rows.join('\n'));
  console.log(`\ncorners ${n}: brake ${ta.toFixed(1)} s, drift ${tb.toFixed(1)} s (${((tb - ta) / ta * 100).toFixed(1)} %), drift faster in ${faster} of ${n}`);
  console.log(`whole run: brake ${a.run.clock.toFixed(1)} s, ${a.run.hits} hits | drift ${b.run.clock.toFixed(1)} s, ${b.run.hits} hits, ${b.driftN} drifts`);
  process.exit(0);
}
if (process.argv[1] && process.argv[1].endsWith('sim-arcade.mjs')) {
  const styles = argStyle ? [argStyle] : Object.keys(DRIVERS).filter((k) => k !== 'proDrift');
  // 1. the corners of the planned route (through all gates) and what the walls allow
  {
    const { world } = buildWorld();
    const graph = new RoadGraph(city.tour.graph);
    const run = new Arcade(LEVELS[argTour], { ...WORLD, graph });
    run.newRoute(run.start.p[0], run.start.p[1]);
    const cs = corners(run.route, world);
    let len = 0; for (let i = 1; i < run.route.length; i++) len += Math.hypot(run.route[i][0] - run.route[i - 1][0], run.route[i][1] - run.route[i - 1][1]);
    console.log(`=== tour ${argTour}: ${run.gates.length} gates, planned route ${(len / 1000).toFixed(2)} km, ${cs.length} corners of 30°+ ===`);
    console.log('corner   x      z    turn   R fits  v max   (R: the largest arc between the walls with ' + CLEAR.toFixed(2) + ' m clearance; v max from ' + ARCADE.latAccelMax + ' m/s² sideways)');
    for (const c of cs) console.log(`${String(c.i).padStart(4)}  ${c.x.toFixed(0).padStart(5)} ${c.z.toFixed(0).padStart(6)}  ${c.deg.toFixed(0).padStart(4)}°  ${c.R.toFixed(1).padStart(5)} m  ${c.vMax.toFixed(0).padStart(4)} km/h`);
    const under = cs.filter((c) => c.vMax < 60), blocked = cs.filter((c) => c.R < 2.5);
    console.log(`corners under 60 km/h: ${under.length} of ${cs.length}; too tight for the tuk-tuk at any speed (R < 2.5 m): ${blocked.length}`);
    if (under.length) console.log('slowest: ' + cs.slice().sort((a, b) => a.vMax - b.vMax).slice(0, 5).map((c) => `#${c.i} ${c.vMax.toFixed(0)} km/h (R ${c.R.toFixed(1)}, ${c.deg.toFixed(0)}°)`).join(', '));
  }
  // 2. the runs; the par is the normal driver's time × PAR_MARGIN unless data/arcade-par.json has it
  let par = parFile[argTour] || (LEVELS[argTour].time && LEVELS[argTour].time.par) || null;
  if (!par || wantPar) {
    const n = simulate(argTour, 'normal'); par = Math.round(n.run.clock * PAR_MARGIN);
    console.log(`\npar: normal driver ${n.run.clock.toFixed(1)} s × ${PAR_MARGIN} = ${par} s  ->  data/arcade-par.json  {"${argTour}": ${par}}`);
    if (writePar) { parFile[argTour] = par; (await import('node:fs')).writeFileSync('data/arcade-par.json', JSON.stringify(parFile, null, 2) + '\n'); console.log('written to data/arcade-par.json'); }
  }
  else console.log(`\npar from data/arcade-par.json: ${par} s`);
  for (const style of styles) {
    const s = simulate(argTour, style, { par });
    const r = s.r, run = s.run;
    console.log(`\n--- ${style}: ${run.state} after ${run.clock.toFixed(1)} s (sim ${(s.t).toFixed(0)} s) ---`);
    if (r) console.log(`tips ${r.tips} € (finish bonus ${r.bonus}, ${r.stars}★), time left ${r.timeLeft.toFixed(1)} s, gates exact ${r.exact} / good ${r.good} / ok ${r.ok} / missed ${r.missed} of ${r.gates}, max ${r.maxKmh} km/h`);
    if (s.driftN) console.log(`drifts: ${s.driftN}`);
    console.log(`skill: near misses ${run.nearMisses}, drift ${run.driftSecs.toFixed(1)} s in ${run.dr.count} slides (best ${run.dr.best.toFixed(1)} s), ${run.skillTips.toFixed(0)} € of the tips`);
    console.log(`speed: avg ${s.avgV.toFixed(0)} km/h, min after start ${s.minV.toFixed(0)}, below 60 km/h ${s.below60.toFixed(1)} s; wall hits ${s.hitsHard} (run counted ${run.hits}), stuck resets ${s.stuck}, anti-stuck ${s.reverts}, distance ${(run.dist / 1000).toFixed(2)} km`);
    console.log(s.gatesLog.join('\n'));
    if (process.env.CORNERS) console.log('min speed at corners: ' + [...s.cornerMin.entries()].map(([k, v]) => `${k}: ${v.toFixed(0)}`).join(' | '));
  }
}
