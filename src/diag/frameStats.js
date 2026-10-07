// Frame statistics for the phone (stage F0): average FPS, frame time percentiles, "1 % lows", a
// 10-minute history (5 s buckets) for the graph, and measuring segments for ?bench. No DOM, no three.js.
const WINDOW = 300;        // frames in the live statistics (~5 s at 60 FPS)
const BUCKET_MS = 5000;    // graph step
const BUCKETS = 120;       // 10 minutes
const LONG_MS = 33.4;      // a frame longer than this is "a hitch" at a 60 FPS target
const SLOW_MS = 25;        // frames longer than this get a breakdown in the bench report

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

// statistics of frame times (ms): average FPS, percentiles, the average of the worst 1 % as FPS
export function summarize(times) {
  const n = times.length;
  if (!n) return { frames: 0, fps: 0, avgMs: 0, p95: 0, p99: 0, worst: 0, low1: 0, long: 0 };
  const sorted = Float64Array.from(times).sort();
  const total = sorted.reduce((s, v) => s + v, 0);
  const k = Math.max(1, Math.ceil(n * 0.01));
  let worstSum = 0;
  for (let i = n - k; i < n; i++) worstSum += sorted[i];
  let long = 0;
  for (const t of sorted) if (t > LONG_MS) long++;
  return {
    frames: n, fps: n * 1000 / total, avgMs: total / n,
    p95: sorted[Math.min(n - 1, Math.floor(n * 0.95))], p99: sorted[Math.min(n - 1, Math.floor(n * 0.99))],
    worst: sorted[n - 1], low1: 1000 / (worstSum / k), long,
  };
}

export class FrameStats {
  constructor() {
    this.ring = new Float32Array(WINDOW);
    this.count = 0;           // frames recorded in total
    this.last = 0;            // timestamp of the previous recorded frame (0 = none)
    this.extra = { calls: 0, tris: 0, cpuMs: 0, gpuMs: null, renderMs: 0, dashMs: 0 };
    this.history = [];        // [{ fps, low }] per 5 s bucket, oldest first
    this.bucket = { t: 0, frames: 0, worst: 0 };
    this.segment = null;
    this.rafLast = 0; this.rafDeltas = [];
    this.startedAt = performance.now();
  }

  // raw requestAnimationFrame timestamps (even for frames the limiter skips): the screen's refresh rate
  raf(now) {
    if (this.rafLast) {
      const d = now - this.rafLast;
      if (d > 2 && d < 100) { this.rafDeltas.push(d); if (this.rafDeltas.length > 240) this.rafDeltas.shift(); }
    }
    this.rafLast = now;
  }
  get refreshHz() {
    if (this.rafDeltas.length < 20) return 0;
    const s = Float64Array.from(this.rafDeltas).sort();
    return 1000 / s[Math.floor(s.length / 2)];
  }

  // the game was paused / hidden: do not count the gap as one long frame
  pause() { this.last = 0; this.rafLast = 0; }

  // one rendered frame; now = requestAnimationFrame timestamp, e = { calls, tris, cpuMs, gpuMs }
  frame(now, e) {
    Object.assign(this.extra, e);
    const prev = this.last;
    this.last = now;
    if (!prev) return;
    const dt = now - prev;
    if (dt > 1500) return;                          // hidden tab / system pause
    this.ring[this.count % WINDOW] = dt;
    this.count++;
    const b = this.bucket;
    b.frames++; b.t += dt; b.worst = Math.max(b.worst, dt);
    if (b.t >= BUCKET_MS) {
      this.history.push({ fps: b.frames * 1000 / b.t, low: 1000 / b.worst });
      if (this.history.length > BUCKETS) this.history.shift();
      this.bucket = { t: 0, frames: 0, worst: 0 };
    }
    const s = this.segment;
    if (s) {
      s.times.push(dt); s.calls.push(e.calls); s.tris.push(e.tris); s.cpu.push(e.cpuMs); if (e.gpuMs != null) s.gpu.push(e.gpuMs);
      // what did a slow frame look like from the inside? (JS total / submitting the draw calls / the panel part), the first 20
      if (dt > SLOW_MS && s.slow.length < 20) s.slow.push({ dt, cpu: e.cpuMs, render: e.renderMs || 0, dash: e.dashMs || 0, at: s.times.length });
    }
  }

  // live statistics over the last ~300 frames
  snapshot() {
    const n = Math.min(this.count, WINDOW);
    return { ...summarize(Array.from(this.ring.subarray(0, n))), ...this.extra };
  }

  // measuring segment (bench): start, then stop() returns the summary of the frames in between
  startSegment() { this.segment = { times: [], calls: [], tris: [], cpu: [], gpu: [], slow: [] }; }
  stopSegment() {
    const s = this.segment;
    this.segment = null;
    if (!s) return null;
    return { ...summarize(s.times), calls: mean(s.calls), tris: mean(s.tris), cpuMs: mean(s.cpu), cpuMax: s.cpu.reduce((m, v) => Math.max(m, v), 0), gpuMs: s.gpu.length ? mean(s.gpu) : null, slow: s.slow };
  }
}
