// Crazy Tuk (docs/plan-arcade.md): a run through the gates of a tour at 60-150 km/h. No stops: every place of the
// tour is a gate across the road (the finish is the pickup place). Tips are earned on the way ("at stake") and
// banked at every gate; a wall hit burns part of the stake; the clock counts down and every gate adds time.
// No three.js here: tools/sim-arcade.mjs drives the same class in Node.
import { sideNormal } from './tour.js';

export const RUSH = {
  minSpeed: 60 / 3.6,                 // m/s: below this nothing is earned (the auto-throttle keeps it unless braking)
  tipEvery: 20,                       // m: a "fare" every 20 m of road
  tipBase: 1.0,                       // € per fare at speed factor 1 and combo 1
  speedFactor: [[60, 1], [90, 1.6], [120, 2.5]],   // [km/h from, factor]
  gateExact: 3, gateGood: 8, gateMiss: 20,   // m from the gate's point at the closest approach: exact / good / ok
  gateNear: 60, gateFar: 50,                 // m: came within gateNear and left beyond gateFar without crossing = missed
  viaReach: 16, viaSkip: 70,                 // m: a via point counts when this close; within viaSkip of its gate the rest are dropped
  gateLeave: [1.0, 2.5],                     // m the tuk-tuk may recede from its closest approach before the gate counts: [exact, good / ok]; this close (gateCentre) = at once
  gateCentre: 1.5,
  gateTips: { exact: 25, good: 10, ok: 0 },          // € (× combo)
  gateTime: { exact: 1.3, good: 1.0, ok: 0.6 },      // × the gate's share of the time
  gateNitro: { exact: 0.25, good: 0.1, ok: 0 },      // tank refill
  parPerMetre: 0.06,                  // s of par per metre of the way, when a tour has no measured par (the short tour: 250 s / 4.4 km)
  startShare: 0.35,                   // the clock starts with this share of par; the rest is spread over the gates
  finishBonus: 1.5,                   // € per second left on the clock
  hitMin: 15 / 3.6,                   // m/s: slower wall touches cost nothing
  hitBurn: 0.3,                       // share of the stake burnt by a hit
  nextGateSkip: 25,                   // m: this close to the NEXT gate without crossing the active one = the active one is missed
  stuckSpeed: 5 / 3.6, stuckFor: 2, stuckPenalty: 3, // m/s, s, s: standing in a wall this long = back onto the road, minus time
  comboMax: 5, comboHold: 4,          // multiplier cap, s without an event before it drops by one (events: exact gate, near miss, drift, smash)
  // near miss (0.14.0): past a wall at speed within `gap` m of the body (not touching) for `minTime` s = a bonus (× combo), the combo grows
  nearMiss: { speed: 80 / 3.6, gap: 1.1, release: 1.7, minTime: 0.2, tips: 2, cooldown: 0.8 },
  // drift (0.14.0): a slide of at least `minSlide` s at `minKmh`+ pays `tipsPerSec` per second (× speed factor × combo) when it ends, the combo grows
  // smash (0.15.0): tips per smashed thing by type (× combo); every 3rd smash within the combo's hold time raises the combo
  smash: { c: 1, b: 2, t: 3, u: 2, every: 3 },
  drift: { minSlide: 1.0, minKmh: 40, tipsPerSec: 1.5, gapOk: 0.35 },
  cardTime: 4,                        // s the landmark card stays after its gate is passed (the HUD fades it out)
  stars: [0, 220, 360, 480, 650],     // € thresholds for 1..5 stars on the short tour (par starsPar); other tours scale them by par / starsPar
  starsPar: 309,                      // s: the par of the short tour, the thresholds above belong to it
};

const speedFactor = (kmh) => { let f = 0; for (const [from, k] of RUSH.speedFactor) if (kmh >= from) f = k; return f; };

export class Arcade {
  // level: a level of src/game/levels.js (data/levels/<id>.json); world: { places: city.json tour.places (the geometry of the places), spec: data/tour.json
  // (the names of the places), graph: RoadGraph }; par: ideal time (s, from the simulation; null = the level's own, else estimatePar; the simulation itself
  // passes null to measure it); facts: { placeId: one line }; useRoute: the simulation's autopilot needs a route, the game draws none
  constructor(level, world, { par = null, facts = null, useRoute = true } = {}) {
    this.level = level; this.graph = world.graph; this.useRoute = useRoute;   // the game draws no route (the player picks the streets); the simulation's autopilot needs one
    const places = world.places, names = world.spec && world.spec.places || {};
    const place = (id) => {
      const c = places[id], s = names[id];
      if (!c || !s) throw new Error(`місце "${id}" не знайдено`);
      return { id, ...c, title: s.title || id, short: facts && facts[id] || '' };
    };
    const st = level.start || {};
    this.start = st.place ? place(st.place) : freeStart(st);
    this.gates = []; let vias = [];
    level.items.forEach((it) => {
      if (it.k === 'via') { vias.push({ p: [it.p[0], it.p[1]], r: it.r || RUSH.viaReach }); return; }
      if (it.k !== 'gate') return;
      const finish = it.finish === true, g = it.place
        ? gateOf({ ...place(it.place), ...(it.fact ? { short: it.fact } : {}) }, finish)
        : gateOf(freeGate(it, this.gates.length, this.graph, facts), finish);
      g.vias = vias; vias = []; this.gates.push(g);
    });
    if (!this.gates.length) throw new Error('у рівні немає воріт');
    this.par = par || (level.time && level.time.par) || null;
    this.reset();
  }

  reset() {
    this.state = 'ready';          // ready (countdown shown by the UI) -> running -> finished | timeout
    this.t = 0; this.clock = 0;    // run time
    this.next = 0;                 // index of the active gate
    this.viaI = 0;                 // index of the active via point of that gate
    this.results = this.gates.map(() => null);   // 'exact' | 'good' | 'ok' | 'missed'
    this.pocket = 0; this.stake = 0;
    this.combo = 1; this.comboT = 0;
    this.timeLeft = this.par ? this.par * RUSH.startShare : Infinity;
    this.fareAcc = 0; this.near = Infinity; this.lastX = null; this.lastZ = null;
    this.maxSpeed = 0; this.hits = 0; this.stuckT = 0; this.slowT = 0; this.dist = 0;
    this.smashCount = 0; this.smashTips = 0; this.nm = { t: 0, since: 0, count: 0, last: -9 }; this.dr = { t: 0, count: 0, best: 0 }; this.nearMisses = 0; this.driftSecs = 0; this.skillTips = 0;
    this.events = [];
    this.route = null; this.routeVersion = (this.routeVersion || 0) + 1; this.lastRoute = -1e9; this.offT = 0;
    this.card = null;
    this.result = null;
    this.nitroBonus = 0;           // tank refill owed to the physics (main / sim adds it to phys.nitro.charge)
  }

  // no measured par for this tour (data/arcade-par.json): the clock still runs, from the length of the way through the gates
  estimatePar() {
    if (this.par || !this.graph) return;
    const r = this.graph.routeVia([this.start.p, ...this.gates.map((g) => g.p)]);
    if (!r) return;
    let len = 0; for (let i = 1; i < r.pts.length; i++) len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
    this.par = Math.round(len * RUSH.parPerMetre); this.timeLeft = this.par * RUSH.startShare;
  }

  get gate() { return this.gates[this.next] || null; }
  // where the arrow leads: the active via point of the active gate, else the gate itself
  get aim() {
    const g = this.gate; if (!g) return null;
    const v = g.vias[this.viaI];
    return v ? { x: v.p[0], z: v.p[1], via: true } : { x: g.p[0], z: g.p[1], via: false };
  }
  get target() { const g = this.gate; return g ? { x: g.p[0], z: g.p[1], title: g.title, kind: g.finish ? 'finish' : 'gate' } : null; }
  get done() { return this.state === 'finished' || this.state === 'timeout'; }
  get timeShare() { return this.par ? this.par * (1 - RUSH.startShare) / this.gates.length : 0; }

  // the way from the tuk-tuk through the remaining gates (for the minimap and the sim's autopilot)
  newRoute(x, z) {
    if (!this.useRoute) return;
    const pts = [[x, z]];
    for (let i = this.next; i < this.gates.length; i++) pts.push(this.gates[i].p);
    const r = pts.length > 1 ? this.graph.routeVia(pts) : null;
    this.route = r ? r.pts : null;
    this.routeVersion++; this.lastRoute = this.t; this.offT = 0;
  }

  begin(x, z) { this.state = 'running'; this.newRoute(x, z); this.near = Infinity; this.events.push({ type: 'start' }); }

  // ctx: { dt, x, z, speed (forward m/s), impact (m/s into a wall this frame), contact (touching a wall), blocked (the
  //   slope wall of the hill stopped the tuk-tuk), nitroActive }
  update(ctx) {
    const dt = ctx.dt, v = Math.abs(ctx.speed), kmh = v * 3.6;
    this.events = [];
    if (this.state !== 'running') return;
    this.t += dt; this.clock += dt;
    this.maxSpeed = Math.max(this.maxSpeed, v);
    if (this.lastX != null) this.dist += Math.hypot(ctx.x - this.lastX, ctx.z - this.lastZ);
    const moved = this.lastX != null ? Math.hypot(ctx.x - this.lastX, ctx.z - this.lastZ) : 0;
    this.lastX = ctx.x; this.lastZ = ctx.z;

    // --- the clock ---
    if (this.par) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.finish('timeout'); return; }
    }
    // --- fares: every tipEvery metres at speed, × combo; below minSpeed nothing, and the combo fades ---
    const f = speedFactor(kmh);
    if (f > 0) {
      this.fareAcc += moved;
      while (this.fareAcc >= RUSH.tipEvery) { this.fareAcc -= RUSH.tipEvery; this.stake += RUSH.tipBase * f * this.combo; }
      this.slowT = 0;
    } else { this.fareAcc = 0; this.slowT += dt; if (this.slowT > 1.5 && this.combo > 1) { this.combo = 1; this.events.push({ type: 'comboLost', why: 'slow' }); } }
    if (this.combo > 1) { this.comboT += dt; if (this.comboT > RUSH.comboHold) { this.combo--; this.comboT = 0; } }
    // --- a wall hit: the stake burns, the combo resets ---
    if (ctx.impact > 4 && v + ctx.impact > RUSH.hitMin) {
      const burnt = this.stake * RUSH.hitBurn;
      this.stake -= burnt; this.hits++; this.combo = 1;
      this.events.push({ type: 'hit', burnt, impact: ctx.impact });
    }
    // --- near miss: close to a wall at speed without touching ---
    const NM = RUSH.nearMiss;
    if (ctx.clearance != null && v >= NM.speed && ctx.clearance < NM.gap && !ctx.contact) this.nm.t += dt;
    else if (this.nm.t > 0 && (ctx.clearance == null || ctx.clearance > NM.release || v < NM.speed || ctx.contact)) {
      if (this.nm.t >= NM.minTime && !ctx.contact && this.t - this.nm.last > NM.cooldown) {
        const tips = NM.tips * this.combo * speedFactor(kmh) || NM.tips;
        this.stake += tips; this.skillTips += tips; this.nearMisses++; this.nm.last = this.t; this.bump('nearMiss');
        this.events.push({ type: 'nearMiss', tips, secs: this.nm.t });
      }
      this.nm.t = 0;
    }
    // --- drift: how long the tuk-tuk slides (the game says `drifting`: grip lost, sideways speed, not scraping) ---
    const DR = RUSH.drift;
    if (ctx.drifting && kmh >= DR.minKmh) this.dr.t += dt;
    else if (this.dr.t > 0 && !ctx.drifting) {
      if (this.dr.t >= DR.minSlide) {
        const tips = DR.tipsPerSec * this.dr.t * Math.max(1, speedFactor(kmh)) * this.combo;
        this.stake += tips; this.skillTips += tips; this.driftSecs += this.dr.t; this.dr.count++; this.dr.best = Math.max(this.dr.best, this.dr.t); this.bump('drift');
        this.events.push({ type: 'drift', tips, secs: this.dr.t });
      }
      this.dr.t = 0;
    }
    // stuck in a wall: back onto the road (the game does the teleport), minus time
    this.stuckT = (ctx.contact || ctx.blocked) && v < RUSH.stuckSpeed ? this.stuckT + dt : 0;
    if (this.stuckT > RUSH.stuckFor) { this.stuckT = 0; this.timeLeft = Math.max(0, this.timeLeft - RUSH.stuckPenalty); this.events.push({ type: 'stuck' }); }
    // --- the active gate ---
    const g = this.gate;
    if (g) {
      // the gate is passed at the closest approach to its point (any direction, any street): graded by that distance
      const dist = Math.hypot(ctx.x - g.p[0], ctx.z - g.p[1]);
      this.near = Math.min(this.near, dist);
      const n = this.gates[this.next + 1];
      // via points: reaching any of the remaining ones (a later one too: the player took a shortcut) drops it and all before it;
      // close to the gate the rest is dropped (the gate is in sight)
      if (dist < RUSH.viaSkip) this.viaI = g.vias.length;
      else for (let j = g.vias.length - 1; j >= this.viaI; j--) {
        const v = g.vias[j];
        if (Math.hypot(ctx.x - v.p[0], ctx.z - v.p[1]) < v.r) { this.viaI = j + 1; this.events.push({ type: 'via', index: this.viaI }); break; }
      }
      const leave = this.near <= RUSH.gateExact ? RUSH.gateLeave[0] : RUSH.gateLeave[1];
      if (this.near <= RUSH.gateMiss && (dist > this.near + leave || dist < RUSH.gateCentre)) this.cross(this.near <= RUSH.gateExact ? 'exact' : this.near <= RUSH.gateGood ? 'good' : 'ok', ctx);
      // missed: came near the gate and drove off again, or reached the next gate
      else if ((this.near < RUSH.gateNear && dist > Math.max(RUSH.gateFar, this.near + 30)) || (n && Math.hypot(ctx.x - n.p[0], ctx.z - n.p[1]) < RUSH.nextGateSkip)) this.cross('missed', ctx);
    }
    if (this.card && this.card.until < this.t) this.card = null;
    // off the planned route: recompute (no message, the line just changes)
    if (this.route && this.t - this.lastRoute > 2) {
      let best = Infinity;
      for (let i = 1; i < this.route.length; i++) { const a = this.route[i - 1], b = this.route[i], ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1; let tt = ((ctx.x - a[0]) * ex + (ctx.z - a[1]) * ez) / l2; tt = tt < 0 ? 0 : tt > 1 ? 1 : tt; best = Math.min(best, Math.hypot(ctx.x - a[0] - ex * tt, ctx.z - a[1] - ez * tt)); if (best < 20) break; }
      this.offT = best > 20 ? this.offT + dt : 0;
      if (this.offT > 2) this.newRoute(ctx.x, ctx.z);
    }
  }

  cross(kind, ctx) {
    const i = this.next, g = this.gates[i];
    this.results[i] = kind;
    let tips = 0, time = 0;
    if (kind !== 'missed') {
      tips = RUSH.gateTips[kind] * this.combo;
      time = this.timeShare * RUSH.gateTime[kind];
      this.nitroBonus += RUSH.gateNitro[kind];
      if (kind === 'exact') this.bump('exact');
    }
    // the stake is banked here, whatever the precision
    this.pocket += this.stake + tips; this.stake = 0;
    if (this.par) this.timeLeft += time;
    if (kind !== 'missed' && !g.finish) this.card = { id: g.id, title: g.title, text: g.short, until: this.t + RUSH.cardTime };   // the card of the place just passed
    this.events.push({ type: 'gate', index: i, kind, tips, time, title: g.title, finish: !!g.finish });
    this.next++; this.viaI = 0;
    this.near = Infinity;
    if (this.next >= this.gates.length) this.finish('finished');
    else this.newRoute(g.p[0], g.p[1]);   // from the gate itself: its road is known, the tuk-tuk may stand on a side street that leads the long way round
  }

  // things smashed this frame (types 'c' | 'b' | 't' | 'u'): the tips go to the stake; returns the euros
  smashed(types) {
    let tips = 0;
    for (const t of types) { tips += (RUSH.smash[t] || 1) * this.combo; this.smashCount = (this.smashCount || 0) + 1; if (this.smashCount % RUSH.smash.every === 0) this.bump('smash'); }
    this.stake += tips; this.skillTips += tips; this.smashTips = (this.smashTips || 0) + tips;
    this.events.push({ type: 'smash', n: types.length, tips });
    return tips;
  }
  bump(why) { if (this.combo < RUSH.comboMax) this.combo++; this.comboT = 0; this.events.push({ type: 'combo', combo: this.combo, why }); }

  finish(state) {
    this.state = state;
    const left = state === 'finished' && this.par ? this.timeLeft : 0;
    const bonus = left * RUSH.finishBonus;
    this.pocket += bonus;
    if (state === 'timeout') this.stake = 0;   // the unbanked stake is lost
    const tips = Math.round(this.pocket);
    let stars = 1; const scale = this.par ? this.par / RUSH.starsPar : 1;
    for (let k = 1; k < RUSH.stars.length; k++) if (tips >= RUSH.stars[k] * scale) stars = k + 1;
    const count = (kind) => this.results.filter((r) => r === kind).length;
    this.result = { state, tips, bonus: Math.round(bonus), nearMisses: this.nearMisses, smashed: this.smashCount, smashTips: Math.round(this.smashTips), driftSecs: Math.round(this.driftSecs * 10) / 10, skillTips: Math.round(this.skillTips), timeLeft: left, time: this.clock, maxKmh: Math.round(this.maxSpeed * 3.6), hits: this.hits,
      exact: count('exact'), good: count('good'), ok: count('ok'), missed: count('missed'), gates: this.gates.length, dist: this.dist, stars };
    this.card = null;
    this.events.push({ type: 'finish', result: this.result });
  }
}

// a gate across the road at a place: p (road point), d (unit direction along the road), n (across), half width
// a start given by a point: x, z, heading (the tuk-tuk looks along -sin, -cos)
function freeStart({ x, z, heading }) {
  return { id: 'start', title: 'Старт', short: '', p: [x, z], d: [-Math.sin(heading), -Math.cos(heading)], w: 6, look: [x - Math.sin(heading) * 20, z - Math.cos(heading) * 20], back: [[x, z, heading]] };
}
// a gate given by a point: across the road there (the direction of the nearest road, unless the level says it)
function freeGate(it, i, graph, facts) {
  let d = it.d;
  if (!d && graph) {
    const e = graph.nearestEdge(it.p[0], it.p[1], 60);
    if (e) { const a = graph.ea[e.e], b = graph.eb[e.e], dx = graph.x[b] - graph.x[a], dz = graph.z[b] - graph.z[a], l = Math.hypot(dx, dz) || 1; d = [dx / l, dz / l]; }
  }
  d = d || [1, 0];
  return { id: it.id || `g${i + 1}`, title: it.title || `Ворота ${i + 1}`, short: it.fact || '', p: [it.p[0], it.p[1]], d, w: it.w || 8, look: [it.p[0] - d[1] * 10, it.p[1] + d[0] * 10] };
}
function gateOf(place, finish = false) {
  const d = place.d, l = Math.hypot(d[0], d[1]) || 1;
  const dir = [d[0] / l, d[1] / l];
  return { id: place.id, title: place.title, short: place.short || '', p: place.p, d: dir, n: sideNormal(place), w: place.w || 6, finish };
}
