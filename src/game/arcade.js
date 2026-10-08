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
  gateNear: 60, gateFar: 90,                 // m: came within gateNear and left beyond gateFar without crossing = missed
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
  comboMax: 5, comboHold: 4,          // (A2) multiplier cap, s without an event before it drops by one
  cardTime: 4,                        // s the landmark card stays after its gate is passed (the HUD fades it out)
  stars: [0, 220, 360, 480, 650],     // € thresholds for 1..5 stars on the short tour (par starsPar); other tours scale them by par / starsPar
  starsPar: 309,                      // s: the par of the short tour, the thresholds above belong to it
};

const speedFactor = (kmh) => { let f = 0; for (const [from, k] of RUSH.speedFactor) if (kmh >= from) f = k; return f; };

export class Arcade {
  // spec: data/tour.json; cityTour: city.json "tour"; graph: RoadGraph; tourId; par: ideal time (s, from the
  // simulation; null = no clock, used by the simulation itself to measure the par)
  constructor(spec, cityTour, graph, tourId, { par = null, facts = null, useRoute = true } = {}) {
    this.spec = spec; this.graph = graph; this.useRoute = useRoute;   // the game draws no route (the player picks the streets); the simulation's autopilot needs one
    this.def = spec.tours.find((t) => t.id === tourId) || spec.tours[0];
    const place = (id) => {
      const c = cityTour.places[id], s = spec.places[id];
      if (!c || !s) throw new Error(`місце "${id}" не знайдено`);
      return { id, ...c, title: s.title || id, short: facts && facts[id] || '' };
    };
    this.start = place(this.def.start);
    const ids = this.def.route.map((r) => r.stop || r.pass);
    this.gates = ids.map((id) => gateOf(place(id))).concat([gateOf(this.start, true)]);
    this.par = par;
    this.reset();
  }

  reset() {
    this.state = 'ready';          // ready (countdown shown by the UI) -> running -> finished | timeout
    this.t = 0; this.clock = 0;    // run time
    this.next = 0;                 // index of the active gate
    this.results = this.gates.map(() => null);   // 'exact' | 'good' | 'ok' | 'missed'
    this.pocket = 0; this.stake = 0;
    this.combo = 1; this.comboT = 0;
    this.timeLeft = this.par ? this.par * RUSH.startShare : Infinity;
    this.fareAcc = 0; this.near = Infinity; this.lastX = null; this.lastZ = null;
    this.maxSpeed = 0; this.hits = 0; this.stuckT = 0; this.slowT = 0; this.dist = 0;
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
      if (this.near <= RUSH.gateMiss && dist > this.near + 3) this.cross(this.near <= RUSH.gateExact ? 'exact' : this.near <= RUSH.gateGood ? 'good' : 'ok', ctx);
      // missed: came near the gate and drove off again, or reached the next gate
      else if ((this.near < RUSH.gateNear && dist > RUSH.gateFar) || (n && Math.hypot(ctx.x - n.p[0], ctx.z - n.p[1]) < RUSH.nextGateSkip)) this.cross('missed', ctx);
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
    this.next++;
    this.near = Infinity;
    if (this.next >= this.gates.length) this.finish('finished');
    else this.newRoute(g.p[0], g.p[1]);   // from the gate itself: its road is known, the tuk-tuk may stand on a side street that leads the long way round
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
    this.result = { state, tips, bonus: Math.round(bonus), timeLeft: left, time: this.clock, maxKmh: Math.round(this.maxSpeed * 3.6), hits: this.hits,
      exact: count('exact'), good: count('good'), ok: count('ok'), missed: count('missed'), gates: this.gates.length, dist: this.dist, stars };
    this.card = null;
    this.events.push({ type: 'finish', result: this.result });
  }
}

// a gate across the road at a place: p (road point), d (unit direction along the road), n (across), half width
function gateOf(place, finish = false) {
  const d = place.d, l = Math.hypot(d[0], d[1]) || 1;
  const dir = [d[0] / l, d[1] / l];
  return { id: place.id, title: place.title, short: place.short || '', p: place.p, d: dir, n: sideNormal(place), w: place.w || 6, finish };
}
