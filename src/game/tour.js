// The tour mission (stage 6): pick the tourists up at the start place, drive the route of stops
// (photo stops) and "on the way" facts, bring them back, get tips and stars. Pure logic, no three.js:
// main.js feeds it the tuk-tuk state every frame and renders what it exposes; tools/sim-tour.mjs
// drives it with an autopilot in Node.
import { ComfortScore, MOOD_DELTA } from './scoring.js';
import { polylineDistance, flatDistance } from './route.js';

export const TOUR = {
  zoneLen: 14, zoneMinW: 6, zoneTol: 1,  // m, stop zone along the road x width, tolerance
  boardSpeed: 3 / 3.6, boardHold: 0.6,   // stand this slow this long in the pickup zone
  boardTime: 2.5, dropTime: 3,           // s
  stopSpeed: 0.3, stopHold: 0.5,         // m/s, s to register a stop
  leaveSpeed: 3 / 3.6,                   // m/s: moving off (ends a stop, aborts boarding / photos)
  photoTime: 6,                          // s
  zoneFast: 15 / 3.6,                    // m/s entering a zone: "slow down"
  passAnchor: 30, passShape: 25, passStreet: 20, // m, "on the way" triggers
  factMin: 8, factPerChar: 0.05,         // s a passing fact stays on the panel
  introTime: 10,
  offRoute: 20, offRouteFor: 1, rerouteEvery: 2, // m, s, s: a wrong turn one block away must redraw the route (was 60 m / 3 s / 5 s)
  spawnBack: [45, 35, 25, 15],           // m before the pickup point, first that fits
  nearPeople: 8, nearPeopleSpeed: 15 / 3.6,
  confirm: 2,                            // s for the second press of the tour button
};

const TEXT_MIN = 5; // s a fact stays before the next queued one replaces it

export class Tour {
  // spec: data/tour.json; cityTour: city.json "tour" ({ places, graph }); graph: RoadGraph
  constructor(spec, cityTour, graph, tourId) {
    this.spec = spec;
    this.graph = graph;
    this.def = spec.tours.find((t) => t.id === tourId) || spec.tours[0];
    const place = (id) => {
      const c = cityTour.places[id], s = spec.places[id];
      if (!c || !s) throw new Error(`місце "${id}" не знайдено${c ? '' : ' в city.json (запусти node tools/build-city.mjs)'}`);
      const fact = Array.isArray(s.fact) ? s.fact.join('\n') : s.fact || '';
      return { id, ...c, title: s.title || id, fact };
    };
    this.start = place(this.def.start);
    this.items = this.def.route.map((r) => ({ kind: r.stop ? 'stop' : 'pass', place: place(r.stop || r.pass) }));
    this.items.push({ kind: 'finish', place: this.start });
    this.stopCount = this.items.filter((i) => i.kind === 'stop').length;
    this.score = new ComfortScore();
    this.reset();
  }

  reset() {
    this.state = 'waiting';
    this.t = 0; this.clock = 0; this.stateT = 0; this.holdT = 0;
    this.next = 0;                 // index of the next pending item
    this.done = this.items.map(() => null); // 'done' | 'missed'
    this.stopsDone = 0;
    this.score.reset();
    this.events = [];
    this.text = null;              // { title, body, until } passing fact / intro on the panel
    this.queue = [];               // facts waiting for the panel
    this.card = null;              // { title, body, footer, credit } at a stop
    this.result = null;
    this.route = null; this.routeVersion = (this.routeVersion || 0) + 1;
    this.offT = 0; this.lastRoute = -1e9;
    this.confirmAt = -1e9;
    this.flashAt = -1e9;
    this.holdBrake = false;
    const g = this.def.group || [2, 4];
    this.group = g[0] + Math.floor(Math.random() * (g[1] - g[0] + 1));
    // the group waits beside the road on the start place's side
    const p = this.start;
    const n = sideNormal(p);
    this.groupPos = [p.p[0] + n[0] * (p.w / 2 + 2.2), p.p[1] + n[1] * (p.w / 2 + 2.2)];
    this.groupFacing = [-n[0], -n[1]];
    // target time: the whole planned route
    const pts = [p.p, ...this.items.map((i) => i.place.p)];
    const plan = this.graph.routeVia(pts);
    this.plannedLen = plan ? plan.len : 0;
    this.targetTime = this.def.targetMin ? this.def.targetMin * 60 : plan ? plan.time : 600;
  }

  // Spawn candidates before the pickup point, facing it: [{ x, z, heading }]; main keeps the first that fits
  spawnCandidates() {
    const p = this.start, d = p.d;
    if (p.back && p.back.length) return p.back.map(([x, z, heading]) => ({ x, z, heading })); // along the street (build-city)
    return TOUR.spawnBack.map((b) => ({ x: p.p[0] - d[0] * b, z: p.p[1] - d[1] * b, heading: Math.atan2(-d[0], -d[1]) }));
  }

  get zoneItem() {
    if (this.state === 'waiting' || this.state === 'boarding') return { kind: 'pickup', place: this.start };
    const it = this.nextStopItem();
    return it && (this.state === 'driving' || this.state === 'photo' || this.state === 'afterPhoto' || this.state === 'dropoff') ? it : null;
  }
  // current zone for the marker: { x, z, d, len, w, kind } or null
  get zone() {
    const it = this.zoneItem;
    if (!it) return null;
    return zoneOf(it.place, it.kind);
  }
  // compass / minimap target: the next pending item (pass or stop), or the pickup
  get target() {
    if (this.state === 'waiting' || this.state === 'boarding') return { x: this.start.p[0], z: this.start.p[1], title: this.start.title, kind: 'pickup' };
    if (this.state === 'summary' || this.state === 'dropoff') return null;
    const it = this.items[this.next];
    return it ? { x: it.place.p[0], z: it.place.p[1], title: it.place.title, kind: it.kind } : null;
  }
  nextStopItem() {
    for (let i = this.next; i < this.items.length; i++) if (this.items[i].kind !== 'pass') return this.items[i];
    return null;
  }
  get stopIndex() { return Math.min(this.stopCount, this.stopsDone + 1); }
  get passCount() { return this.items.filter((i) => i.kind === 'pass').length; }
  get passesDone() { return this.items.filter((i, k) => i.kind === 'pass' && this.done[k] === 'done').length; }

  // ctx: { dt, x, z, speed (forward m/s), accel, yawRate, brake, reversing, impact, contact, handbrake, grade }
  update(ctx) {
    const dt = ctx.dt, v = Math.abs(ctx.speed);
    this.t += dt; this.stateT += dt;
    this.events = [];
    this.holdBrake = false;
    const active = this.state === 'driving' || this.state === 'photo' || this.state === 'afterPhoto';
    if (active) for (const ev of this.score.update(ctx)) this.emitScore(ev);
    if (this.text && this.t > this.text.until) this.text = this.queue.length ? this.startText(this.queue.shift()) : null;

    switch (this.state) {
      case 'waiting': {
        const z = zoneOf(this.start, 'pickup');
        const inside = inZone(z, ctx.x, ctx.z);
        this.holdBrake = inside && v < 1;
        const dg = Math.hypot(ctx.x - this.groupPos[0], ctx.z - this.groupPos[1]);
        if (dg < TOUR.nearPeople && v > TOUR.nearPeopleSpeed && this.score.ready('nearPeople')) {
          this.score.last.nearPeople = this.score.t;
          this.emitScore(this.score.add('nearPeople'));
          this.events.push({ type: 'startle' });
        }
        this.holdT = inside && v < TOUR.boardSpeed ? this.holdT + dt : 0;
        if (this.holdT >= TOUR.boardHold) this.setState('boarding'), this.events.push({ type: 'board' });
        break;
      }
      case 'boarding':
        this.holdBrake = true;
        if (v > TOUR.leaveSpeed) {
          this.setState('waiting');
          this.events.push({ type: 'boardAbort' });
          this.flash('Зачекай, поки всі сядуть', '#ffd166');
        } else if (this.stateT >= TOUR.boardTime) {
          this.setState('driving');
          this.events.push({ type: 'seated' });
          if (this.def.intro) this.showText(this.def.title, this.def.intro, TOUR.introTime);
          this.newRoute(ctx);
        }
        break;
      case 'driving': this.driving(ctx, v); break;
      case 'photo':
        this.holdBrake = true;
        if (v > TOUR.leaveSpeed) {
          this.emitScore(this.score.add('leftEarly'));
          this.card = null;
          this.setState('driving');
        } else if (this.stateT >= TOUR.photoTime) {
          this.stopsDone++;
          this.done[this.next] = 'done';
          this.next++;
          this.setState('afterPhoto');
          this.events.push({ type: 'photoDone' });
          const it = this.items[this.next];
          this.card.footer = it ? `Можна рушати · Далі: ${it.place.title}` : 'Можна рушати';
          this.newRoute(ctx);
        }
        break;
      case 'afterPhoto':
        this.holdBrake = v < 1;
        if (v > TOUR.leaveSpeed || this.stateT > 45) { this.card = null; this.setState('driving'); }
        break;
      case 'dropoff':
        this.holdBrake = true;
        if (this.stateT >= TOUR.dropTime) this.finish();
        break;
      default: break;
    }
    // the tour clock: runs while driving, stops while standing in the target zone
    if (this.state === 'driving') {
      const z = this.zone;
      if (!(z && inZone(z, ctx.x, ctx.z) && v < TOUR.stopSpeed)) this.clock += dt;
    }
  }

  driving(ctx, v) {
    // "on the way" facts: the next pending pass triggers near it; a later one only at its own road
    // point (the driver went another way), and the skipped ones count as missed
    for (let i = this.next; i < this.items.length && this.items[i].kind === 'pass'; i++) {
      if (!passTriggered(this.items[i].place, ctx.x, ctx.z, i === this.next)) continue;
      for (let k = this.next; k < i; k++) this.done[k] = 'missed';
      this.done[i] = 'done';
      this.next = i + 1;
      const pl = this.items[i].place;
      this.showText(pl.title, pl.fact, Math.max(TOUR.factMin, 3 + pl.fact.length * TOUR.factPerChar));
      this.events.push({ type: 'pass', id: pl.id });
      this.newRoute(ctx);
      break;
    }
    const it = this.nextStopItem();
    if (!it) return;
    const z = zoneOf(it.place, it.kind);
    const inside = inZone(z, ctx.x, ctx.z);
    this.holdBrake = inside && v < 1;
    if (inside && v > TOUR.zoneFast && this.t - this.flashAt > 3) this.flash('Пригальмуй — зупинка тут', '#ffd166');
    this.holdT = inside && v < TOUR.stopSpeed ? this.holdT + ctx.dt : 0;
    if (this.holdT >= TOUR.stopHold) {
      const idx = this.items.indexOf(it);
      for (let k = this.next; k < idx; k++) this.done[k] = 'missed';
      this.next = idx;
      const bonus = this.score.softStop();
      if (bonus) this.emitScore(bonus);
      if (it.kind === 'finish') {
        this.setState('dropoff');
        this.events.push({ type: 'dropoff' });
        if (this.def.outro) this.showText(this.start.title, this.def.outro, TOUR.introTime);
      } else {
        this.card = { title: it.place.title, body: it.place.fact, footer: 'Фото…', credit: it.place.credit || '' };
        this.setState('photo');
        this.events.push({ type: 'stop', id: it.place.id });
      }
      return;
    }
    // off the route for a while: recompute from here
    if (this.route) {
      const off = polylineDistance(this.route, ctx.x, ctx.z).d > TOUR.offRoute;
      this.offT = off ? this.offT + ctx.dt : 0;
      if (this.offT > TOUR.offRouteFor && this.t - this.lastRoute > TOUR.rerouteEvery) { this.newRoute(ctx); this.flash('Маршрут перераховано', '#9fd3ff', 2); }
    }
  }

  // route from the tuk-tuk through the pending passes to the next stop / finish
  newRoute(ctx) {
    const pts = [[ctx.x, ctx.z]];
    for (let i = this.next; i < this.items.length; i++) {
      pts.push(this.items[i].place.p);
      if (this.items[i].kind !== 'pass') break;
    }
    const r = pts.length > 1 ? this.graph.routeVia(pts) : null;
    this.route = r ? r.pts : null;
    this.routeVersion++;
    this.lastRoute = this.t; this.offT = 0;
  }

  finish() {
    this.result = this.score.result({ time: this.clock, target: this.targetTime, group: this.group });
    this.result.time = this.clock; this.result.target = this.targetTime;
    this.result.passes = this.passesDone; this.result.passCount = this.passCount;
    const lines = this.spec.reviews?.[this.result.review] || [];
    this.result.reviewText = lines.length ? lines[Math.floor(Math.random() * lines.length)] : '';
    this.setState('summary');
    this.events.push({ type: 'summary' });
  }

  // The tour button (Y / T). Returns true when the tour should restart now.
  action() {
    if (this.state === 'summary') return true;
    if (this.t - this.confirmAt < TOUR.confirm) return true;
    this.confirmAt = this.t;
    this.flash('Натисни ще раз — тур заново', '#ffd166', TOUR.confirm);
    return false;
  }

  // a nitro burst with the tourists on board: they shout, −10 mood (free ride and before boarding: nothing)
  onNitro() {
    if (this.state !== 'driving' && this.state !== 'afterPhoto') return false;
    this.emitScore(this.score.add('nitro'));
    this.events.push({ type: 'oy' });
    return true;
  }

  // teleport back onto a road during the tour
  onReset() {
    if (this.state === 'driving' || this.state === 'afterPhoto') this.emitScore(this.score.add('reset'));
  }

  // a text on the panel for some seconds; one already showing stays at least TEXT_MIN, the new one waits
  showText(title, body, seconds) {
    const item = { title, body, seconds };
    if (this.text) { this.text.until = Math.max(this.text.start + TEXT_MIN, this.t); this.queue.push(item); } else this.text = this.startText(item);
  }
  startText(item) { return { title: item.title, body: item.body, start: this.t, until: this.t + item.seconds }; }

  setState(s) { this.state = s; this.stateT = 0; this.holdT = 0; }
  flash(text, color, seconds = 2) { this.flashAt = this.t; this.events.push({ type: 'flash', text, color, seconds }); }
  emitScore(ev) {
    if (ev.type === 'calm') return;
    const sign = ev.delta > 0 ? '+' : '−';
    this.flash(`${ev.label} ${sign}${Math.abs(ev.delta)}`, ev.delta > 0 ? '#6fe06f' : '#ff7a5c');
    this.events.push({ type: 'comfort', kind: ev.type, delta: ev.delta });
  }

  get mood() { return this.score.mood; }
  get tipsEstimate() { return this.score.tipsEstimate(this.group); }
}

// ---------- geometry helpers ----------
// unit normal of the road at a place, pointing to the side of the landmark
export function sideNormal(pl) {
  const [dx, dz] = pl.d;
  let n = [-dz, dx];
  const lx = pl.look[0] - pl.p[0], lz = pl.look[1] - pl.p[1];
  if (n[0] * lx + n[1] * lz < 0) n = [dz, -dx];
  return n;
}
export function zoneOf(pl, kind) {
  return { x: pl.p[0], z: pl.p[1], d: pl.d, len: TOUR.zoneLen, w: Math.max(TOUR.zoneMinW, pl.w), kind };
}
export function inZone(z, x, zz) {
  const rx = x - z.x, rz = zz - z.z;
  const along = rx * z.d[0] + rz * z.d[1], across = -rx * z.d[1] + rz * z.d[0];
  return Math.abs(along) <= z.len / 2 + TOUR.zoneTol && Math.abs(across) <= z.w / 2 + TOUR.zoneTol;
}
function passTriggered(pl, x, z, near) {
  if (Math.hypot(x - pl.p[0], z - pl.p[1]) <= TOUR.passAnchor) return true;
  if (!near) return false;
  const r = pl.street ? TOUR.passStreet : TOUR.passShape;
  for (const s of pl.trig || []) if (flatDistance(s, x, z, !pl.street && s.length > 4) <= r) return true;
  return false;
}
export { MOOD_DELTA };
