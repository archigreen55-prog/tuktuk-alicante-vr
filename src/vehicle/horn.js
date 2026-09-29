// Tuk-tuk horn: two detuned saw oscillators through a low-pass, gated while the button is held.
export class Horn {
  constructor() {
    this.ctx = null;
    this.gain = null;
    this.on = false;
  }

  // Needs a user gesture (click / Enter VR) before sound can play.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1700;
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      lp.connect(this.gain).connect(ctx.destination);
      for (const f of [392, 494]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = f;
        o.connect(lp); o.start();
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  set(on) {
    if (!this.ctx || on === this.on) return;
    this.on = on;
    this.gain.gain.setTargetAtTime(on ? 0.16 : 0, this.ctx.currentTime, 0.015);
  }
}

// Tourists' "ой!" (tour + nitro): short synthesized voices, one per tourist, staggered a little. Each is a
// buzz (sawtooth at the voice's pitch, jumping up in surprise) through two formant band-passes gliding
// from "o" to "i", with a quick attack and decay. Uses the horn's audio context (unlocked by a gesture).
export function shout(horn, count = 2) {
  const ctx = horn && horn.ctx;
  if (!ctx || ctx.state !== 'running') return;
  const out = ctx.createGain();
  out.gain.value = 0.5;
  out.connect(ctx.destination);
  for (let i = 0; i < count; i++) {
    const t0 = ctx.currentTime + 0.02 + i * (0.05 + Math.random() * 0.07);
    const f0 = (i % 2 ? 180 : 250) * (0.9 + Math.random() * 0.25); // a lower and a higher voice per pair
    const dur = 0.38 + Math.random() * 0.12;
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0, t0);
    src.frequency.linearRampToValueAtTime(f0 * 1.45, t0 + 0.08);          // the surprised jump
    src.frequency.exponentialRampToValueAtTime(f0 * 0.9, t0 + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.35, t0 + 0.03);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    for (const [fa, fb, q, g] of [[520, 320, 6, 1], [900, 2200, 8, 0.6]]) { // F1, F2: "o" -> "i"
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = q;
      bp.frequency.setValueAtTime(fa, t0);
      bp.frequency.linearRampToValueAtTime(fb, t0 + dur * 0.7);
      const fg = ctx.createGain(); fg.gain.value = g;
      src.connect(bp).connect(fg).connect(env);
    }
    env.connect(out);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }
  setTimeout(() => out.disconnect(), 1500);
}
