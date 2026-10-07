// ?bench: the tuk-tuk drives (or stands) through the heaviest places of the city by itself and the frame
// statistics of each place are collected. A phone owner only starts it and pastes the report into the chat.
// ?bench=N repeats the whole round N times: a slow fall of FPS from round to round means overheating.
import { summarize } from './frameStats.js';

export const WARMUP = 2.5;    // s after the jump to a place: chunks, caches and the GPU settle (not measured)
export const MEASURE = 8;     // s measured per place (defaults; ?benchTime=warmup,measure overrides them for tests)
const CRUISE = 7;             // m/s (25 km/h) while driving

// ---- a polyline with cumulative lengths ----
function makePath(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, total: cum[cum.length - 1] };
}
function pointAt(path, s) {
  const { pts, cum } = path;
  if (s <= 0) return pts[0];
  if (s >= path.total) return pts[pts.length - 1];
  let i = 1;
  while (cum[i] < s) i++;
  const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
}
// distance along the path of the point nearest to (x, z), searching from segment `hint` on
function project(path, x, z, hint) {
  const { pts, cum } = path;
  let best = Infinity, at = 0, seg = hint;
  for (let i = Math.max(1, hint); i < Math.min(pts.length, hint + 40); i++) {
    const ax = pts[i - 1][0], az = pts[i - 1][1], bx = pts[i][0], bz = pts[i][1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const d = (ax + dx * t - x) ** 2 + (az + dz * t - z) ** 2;
    if (d < best) { best = d; at = cum[i - 1] + Math.sqrt(L2) * t; seg = i; }
  }
  return { at, seg };
}
const headingOf = (a, b) => Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));   // forward = (-sin h, -cos h)

// ---- the places ----
// Drive stations follow the real street graph; the two static ones show the heaviest views.
export function buildStations(city, graph, groundY) {
  const P = (city.tour && city.tour.places) || {};
  const out = [];
  const drive = (id, label, from, to, fraction = 0) => {
    if (!from || !to) return null;
    const r = graph.route(from, to);
    if (!r || r.pts.length < 3) return null;
    const full = makePath(r.pts);
    const s0 = full.total * fraction;
    const rest = [pointAt(full, s0)];
    for (let i = 1; i < full.pts.length; i++) if (full.cum[i] > s0 + 0.5) rest.push(full.pts[i]);
    if (rest.length < 2) return null;
    const path = makePath(rest);
    const st = { id, label, kind: 'drive', x: rest[0][0], z: rest[0][1], heading: headingOf(rest[0], pointAt(path, 12)), path, end: full.pts[full.pts.length - 1] };
    out.push(st);
    return st;
  };
  const p = (id) => (P[id] ? P[id].p : null);
  drive('start', 'Старт біля Meliá, їзда', p('melia'), p('rambla'));
  drive('rambla', 'Rambla, їзда', p('rambla'), p('townHall'));
  drive('santaMaria', 'Santa María (3D-скан), їзда', p('santaMaria'), p('postiguet'));
  drive('mercado', 'Mercado Central (фото-фасад), їзда', p('mercado'), p('luceros'));
  const climb = drive('climb', 'Підйом до замку (середина), їзда', p('marq'), p('castle'), 0.5);
  if (climb) {
    // the gate: the end of the road to the castle, looking back over the whole city
    const gate = climb.end, back = pointAt(climb.path, Math.max(0, climb.path.total - 12));
    const city0 = p('melia') || [0, 0];
    out.push({ id: 'gate', label: 'Ворота замку, погляд на місто', kind: 'still', x: gate[0], z: gate[1], heading: headingOf(back, gate), faceTo: city0, pitch: -0.12 });
    out.push({ id: 'air', label: 'З висоти 90 м над воротами, вид на все місто', kind: 'air', x: gate[0], z: gate[1], heading: headingOf(back, gate), faceTo: city0, height: 90 });
  }
  return out;
}

export class Bench {
  // api: { place(x, z, heading), look(yaw, pitch), air(x, y, z, tx, ty, tz), cockpit(), groundY(x, z) }
  constructor({ stations, stats, api, passes = 1, warmup = WARMUP, measure = MEASURE }) {
    this.warmup = warmup; this.measure = measure;
    this.stations = stations; this.stats = stats; this.api = api; this.passes = Math.max(1, passes);
    this.state = 'idle';           // idle | running | done
    this.results = [];             // [{ stations: [summary + { id, label }] }]
    this.pass = 0; this.index = 0; this.phase = 'setup'; this.t = 0; this.seg = 0;
    this.current = [];
    this.onDone = null;
    this.startedAt = 0;
  }

  start() {
    this.state = 'running'; this.results = []; this.pass = 0; this.index = 0; this.phase = 'setup'; this.current = [];
    this.startedAt = performance.now();
  }
  stop() { this.stats.stopSegment(); this.api.cockpit(); this.state = 'done'; }

  // text for the on-screen pill
  status() {
    if (this.state !== 'running') return null;
    const st = this.stations[this.index];
    const left = Math.ceil(Math.max(0, (this.phase === 'warm' ? this.warmup + this.measure - this.t : this.measure - this.t)));
    return { text: `Замір ${this.pass + 1}/${this.passes} · ${this.index + 1}/${this.stations.length}: ${st.label} · ${left} с`, progress: ((this.pass * this.stations.length + this.index) * (this.warmup + this.measure) + (this.phase === 'warm' ? this.t : this.warmup + this.t)) / (this.passes * this.stations.length * (this.warmup + this.measure)) };
  }

  // each frame while running; dt = 0 while the game is paused. Writes the controls into `input`.
  update(dt, input, phys) {
    if (this.state !== 'running') return;
    const st = this.stations[this.index];
    if (this.phase === 'setup') {
      this.api.cockpit();
      this.api.place(st.x, st.z, st.heading);
      this.seg = 1;
      if (st.kind === 'still') {
        const want = headingOf([st.x, st.z], st.faceTo) - st.heading;
        this.api.look(Math.atan2(Math.sin(want), Math.cos(want)), st.pitch || 0);
      } else if (st.kind === 'air') {
        const y = this.api.groundY(st.x, st.z) + st.height;
        this.api.air(st.x, y, st.z, st.faceTo[0], this.api.groundY(st.faceTo[0], st.faceTo[1]), st.faceTo[1]);
      } else this.api.look(0, 0);
      this.phase = 'warm'; this.t = 0;
    }
    this.control(st, input, phys);
    this.t += dt;
    if (this.phase === 'warm' && this.t >= this.warmup) { this.phase = 'measure'; this.t = 0; this.stats.startSegment(); }
    else if (this.phase === 'measure' && this.t >= this.measure) {
      const sum = this.stats.stopSegment();
      this.current.push({ id: st.id, label: st.label, ...sum });
      this.index++; this.phase = 'setup'; this.t = 0;
      if (this.index >= this.stations.length) {
        this.results.push({ stations: this.current }); this.current = []; this.index = 0; this.pass++;
        if (this.pass >= this.passes) { this.api.cockpit(); this.state = 'done'; if (this.onDone) this.onDone(); }
      }
    }
  }

  control(st, input, phys) {
    input.throttle = input.brake = input.steer = 0;
    input.handbrake = input.horn = input.nitro = false;
    input.reverseDelay = Infinity;
    const v = phys.forwardSpeed;
    if (st.kind !== 'drive') { input.brake = v > 0.05 ? 1 : 0.3; return; }
    const path = st.path, pr = project(path, phys.x, phys.z, this.seg);
    this.seg = Math.max(1, pr.seg - 1);
    const left = path.total - pr.at;
    if (left < 6) { input.brake = v > 0.05 ? 0.6 : 0; return; }
    const look = 4 + 0.6 * Math.abs(v);
    const tgt = pointAt(path, pr.at + look);
    const fx = -Math.sin(phys.heading), fz = -Math.cos(phys.heading), rx = Math.cos(phys.heading), rz = -Math.sin(phys.heading);
    const tx = tgt[0] - phys.x, tz = tgt[1] - phys.z;
    const alpha = Math.atan2(tx * rx + tz * rz, tx * fx + tz * fz);
    input.steer = Math.max(-1, Math.min(1, alpha * 2.2));
    const vt = Math.min(CRUISE, Math.max(2, CRUISE - Math.abs(alpha) * 6), Math.sqrt(2 * 2 * Math.max(0, left - 4)) + 1);
    if (v < vt - 0.3) input.throttle = Math.min(1, Math.max(0.2, (vt - v) * 0.5));
    else if (v > vt + 0.5) input.brake = Math.min(0.5, (v - vt) * 0.3);
  }

  // ---- results ----
  // per station: average over the rounds
  averages() {
    if (!this.results.length) return [];
    const n = this.stations.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const rows = this.results.map((r) => r.stations[i]).filter(Boolean);
      if (!rows.length) continue;
      const avg = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0) / rows.length;
      const gpu = rows.filter((r) => r.gpuMs != null);
      out.push({ slow: rows.flatMap((r) => r.slow || []), cpuMax: Math.max(...rows.map((r) => r.cpuMax || 0)), id: rows[0].id, label: rows[0].label, frames: rows.reduce((s, r) => s + r.frames, 0), fps: avg('fps'), low1: Math.min(...rows.map((r) => r.low1)), p95: avg('p95'), worst: Math.max(...rows.map((r) => r.worst)), long: rows.reduce((s, r) => s + r.long, 0), calls: avg('calls'), tris: avg('tris'), cpuMs: avg('cpuMs'), gpuMs: gpu.length ? gpu.reduce((s, r) => s + r.gpuMs, 0) / gpu.length : null });
    }
    return out;
  }
  roundFps(r) {
    const ok = r.stations.filter((s) => s.frames > 0);
    return ok.length ? ok.reduce((s, x) => s + x.fps, 0) / ok.length : 0;
  }

  verdict(cap) {
    const rows = this.averages();
    if (!rows.length) return ['Замір не завершено — висновку немає.'];
    const L = [];
    const target = cap > 0 ? Math.min(cap, 60) : 60;
    const worst = rows.reduce((a, b) => (b.fps < a.fps ? b : a));
    const worstLow = rows.reduce((a, b) => (b.low1 < a.low1 ? b : a));
    const okAvg = worst.fps >= target * 0.92, okLow = worstLow.low1 >= target * 0.65;
    if (okAvg && okLow) L.push(`Висновок: запас є — у всіх місцях ≥ ${Math.round(target * 0.92)} FPS у середньому (найгірше: «${worst.label}», ${worst.fps.toFixed(0)}), провалів майже немає (1 % найгірших ≥ ${worstLow.low1.toFixed(0)}).`);
    else if (worst.fps >= 40) L.push(`Висновок: тримається не скрізь — найважче «${worst.label}»: ${worst.fps.toFixed(0)} FPS у середньому, 1 % найгірших «${worstLow.label}»: ${worstLow.low1.toFixed(0)}. Потрібні перші кроки плану відступу (Ф4: роздільність, дальність відсікання).`);
    else L.push(`Висновок: не тягне — «${worst.label}»: ${worst.fps.toFixed(0)} FPS. Потрібен план відступу (Ф4) до керування, а не після.`);
    if (this.results.length > 1) {
      const a = this.roundFps(this.results[0]), b = this.roundFps(this.results[this.results.length - 1]);
      const drop = a > 0 ? (1 - b / a) * 100 : 0;
      L.push(`Перегрів: середній FPS по колу ${a.toFixed(1)} → ${b.toFixed(1)} (${drop >= 0 ? '−' : '+'}${Math.abs(drop).toFixed(0)} %) за ${this.results.length} проходи. ${drop > 15 ? 'Помітне падіння — телефон гріється й знижує частоти.' : 'Падіння немає або воно мале.'}`);
    } else L.push('Перегрів цим заміром не видно (один прохід). Для перевірки: ?bench=5 — п\'ять проходів поспіль (~7 хв).');
    return L;
  }

  formatResults(cap) {
    const rows = this.averages();
    if (!rows.length) return ['(замір не запускався)'];
    const L = [];
    const fmt = (r) => `${r.label.padEnd(46)}${r.fps.toFixed(0).padStart(4)}${r.low1.toFixed(0).padStart(5)}${r.p95.toFixed(1).padStart(7)}${r.worst.toFixed(0).padStart(7)}${String(r.long).padStart(6)}${r.calls.toFixed(0).padStart(6)}${(r.tris / 1000).toFixed(0).padStart(6)}k${r.cpuMs.toFixed(1).padStart(7)}${(r.gpuMs == null ? 'н/д' : r.gpuMs.toFixed(1)).padStart(7)}`;
    L.push(`Проходів: ${this.results.length} з ${this.passes}; на місце: ${this.warmup} с розігріву + ${this.measure} с виміру. У таблиці — середнє по проходах (1 % найгірших і найгірший кадр — найгірші).`);
    L.push(`${'Місце'.padEnd(46)}${'FPS'.padStart(4)}${'1%'.padStart(5)}${'p95мс'.padStart(7)}${'макс'.padStart(7)}${'>33'.padStart(6)}${'calls'.padStart(6)}${'трик.'.padStart(7)}${'CPUмс'.padStart(7)}${'GPUмс'.padStart(7)}`);
    for (const r of rows) L.push(fmt(r));
    if (this.results.length > 1) {
      L.push('', 'Середній FPS по колу, прохід за проходом: ' + this.results.map((r, i) => `${i + 1}: ${this.roundFps(r).toFixed(1)}`).join(' · '));
    }
    // slow frames from the inside: JS total, submitting the draw calls, the panel part. A slow frame with small JS and
    // render-submit times was waiting for the GPU or the compositor; a big JS time points at the code.
    const withSlow = rows.filter((r) => r.slow && r.slow.length);
    L.push('', `Повільні кадри (>25 мс): ${withSlow.length ? '' : 'немає'}`);
    for (const r of withSlow) L.push(`  ${r.label}: ${r.slow.length} шт.; найдовший JS кадру ${r.cpuMax.toFixed(1)} мс; перші: ` + r.slow.slice(0, 5).map((q) => `${q.dt.toFixed(0)} мс (JS ${q.cpu.toFixed(1)}, submit ${q.render.toFixed(1)}, панель ${q.dash.toFixed(1)})`).join('; '));
    L.push('', ...this.verdict(cap));
    return L;
  }
}
