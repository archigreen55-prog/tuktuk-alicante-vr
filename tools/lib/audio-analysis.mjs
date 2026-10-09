// Small audio analysis for the sound tools (no dependencies; ffmpeg only decodes): where a recording is steady (engine revs: a loop can be cut there),
// and where its loudest bursts are (laughs, shouts: short pieces to cut out). Pure JS, run in Node.
import { spawnSync } from 'node:child_process';

// the file as mono float samples at `sr`
export function decodePcm(file, sr = 22050) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  const b = r.stdout; return new Float32Array(b.buffer, b.byteOffset, b.length >> 2).slice();
}

// in-place radix-2 FFT
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
  }
}

// per hop: { t, db (RMS, dB), cen (spectral centroid, Hz), peak (dominant frequency, Hz) }
export function frames(x, sr, hop = 0.1, win = 2048) {
  const out = [], H = Math.round(hop * sr), hann = new Float32Array(win).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (win - 1)));
  const re = new Float32Array(win), im = new Float32Array(win);
  for (let s = 0; s + win <= x.length; s += H) {
    let e = 0; for (let i = 0; i < win; i++) { const v = x[s + i]; e += v * v; re[i] = v * hann[i]; im[i] = 0; }
    fft(re, im);
    let num = 0, den = 0, pk = 0, pv = 0;
    for (let k = 1; k < win / 2; k++) { const m = Math.hypot(re[k], im[k]); num += k * m; den += m; if (m > pv) { pv = m; pk = k; } }
    out.push({ t: s / sr, db: 10 * Math.log10(e / win + 1e-12), cen: den ? num / den * sr / win : 0, peak: pk * sr / win });
  }
  return out;
}

const std = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// the steadiest stretch of `min`..`max` seconds: a loud, even level and an even pitch / timbre (the lowest variation of level and of the spectral
// centroid, relative to its mean); returns { from, to, score } in seconds or null. Quiet stretches (more than 12 dB under the loudest) are skipped.
export function findSteady(x, sr, { min = 2.5, max = 5, hop = 0.1 } = {}) {
  const f = frames(x, sr, hop); if (f.length < min / hop) return null;
  const loud = Math.max(...f.map((v) => v.db));
  let best = null;
  for (const len of [max, (min + max) / 2, min]) {
    const n = Math.round(len / hop);
    for (let i = 0; i + n <= f.length; i++) {
      const w = f.slice(i, i + n); if (mean(w.map((v) => v.db)) < loud - 12) continue;
      const score = std(w.map((v) => v.db)) / 3 + std(w.map((v) => v.cen)) / (mean(w.map((v) => v.cen)) || 1) * 10 - len * 0.05;   // lower is better, a longer stretch is a little better
      if (!best || score < best.score) best = { from: f[i].t, to: f[i].t + len, score };
    }
  }
  return best;
}

// the n loudest separate bursts of min..max seconds (a burst = the level stays within `drop` dB of its peak); pieces get 60 ms of lead-in
export function findBursts(x, sr, { n = 3, min = 0.6, max = 2.5, drop = 14, hop = 0.05 } = {}) {
  const f = frames(x, sr, hop, 1024), used = new Uint8Array(f.length), out = [];
  for (let k = 0; k < n; k++) {
    let pi = -1, pv = -Infinity; f.forEach((v, i) => { if (!used[i] && v.db > pv) { pv = v.db; pi = i; } });
    if (pi < 0 || pv < -50) break;
    let a = pi, b = pi; while (a > 0 && !used[a - 1] && f[a - 1].db > pv - drop && (pi - a) * hop < max / 2) a--; while (b < f.length - 1 && !used[b + 1] && f[b + 1].db > pv - drop && (b - pi) * hop < max) b++;
    for (let i = Math.max(0, a - 2); i <= Math.min(f.length - 1, b + 2); i++) used[i] = 1;
    let from = Math.max(0, f[a].t - 0.06), to = Math.max(f[b].t + 0.15, from + min); if (to - from > max) to = from + max;
    out.push({ from: +from.toFixed(2), to: +to.toFixed(2), db: +pv.toFixed(1) });
  }
  return out;
}
