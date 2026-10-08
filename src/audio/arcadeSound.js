// Crazy Tuk sounds, all synthesized (no recordings): wind that rises with the speed, the nitro's hiss, a thump on a
// wall hit. Shares the horn's AudioContext (unlocked by the first tap / key). Nothing runs while the mode is off.
export class ArcadeSound {
  constructor(horn) { this.horn = horn; this.nodes = null; this.on = false; }

  build() {
    const ctx = this.horn.ctx; if (!ctx || this.nodes) return;
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise.buffer = buf; noise.loop = true;
    const wind = ctx.createBiquadFilter(); wind.type = 'lowpass'; wind.frequency.value = 300; wind.Q.value = 0.7;
    const windGain = ctx.createGain(); windGain.gain.value = 0;
    noise.connect(wind).connect(windGain).connect(ctx.destination);
    // nitro: a hiss (band-passed noise) plus a rising saw
    const hiss = ctx.createBiquadFilter(); hiss.type = 'bandpass'; hiss.frequency.value = 2400; hiss.Q.value = 1.2;
    const nitroGain = ctx.createGain(); nitroGain.gain.value = 0;
    noise.connect(hiss).connect(nitroGain).connect(ctx.destination);
    const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 90;
    const sawLp = ctx.createBiquadFilter(); sawLp.type = 'lowpass'; sawLp.frequency.value = 500;
    const sawGain = ctx.createGain(); sawGain.gain.value = 0;
    saw.connect(sawLp).connect(sawGain).connect(ctx.destination);
    noise.start(); saw.start();
    this.nodes = { noise, wind, windGain, nitroGain, saw, sawGain };
  }

  // kmh: speed; nitro: burning; dt: s
  update(kmh, nitro) {
    const ctx = this.horn.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.nodes) this.build();
    const N = this.nodes, t = ctx.currentTime;
    const k = Math.max(0, Math.min(1, (kmh - 30) / 120));
    N.windGain.gain.setTargetAtTime(this.on ? 0.02 + 0.22 * k * k : 0, t, 0.15);
    N.wind.frequency.setTargetAtTime(250 + 1800 * k, t, 0.2);
    N.nitroGain.gain.setTargetAtTime(this.on && nitro ? 0.12 : 0, t, 0.08);
    N.sawGain.gain.setTargetAtTime(this.on && nitro ? 0.05 : 0, t, 0.08);
    N.saw.frequency.setTargetAtTime(nitro ? 140 + kmh : 90, t, 0.3);
  }

  // a wall hit: a short low thump plus a noise burst, louder with the speed into the wall (m/s)
  hit(into) {
    const ctx = this.horn.ctx;
    if (!ctx || ctx.state !== 'running' || !this.on) return;
    const t0 = ctx.currentTime, a = Math.min(1, 0.3 + into / 12);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t0); o.frequency.exponentialRampToValueAtTime(35, t0 + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5 * a, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + 0.32);
    const n = ctx.createBufferSource(); n.buffer = this.nodes ? this.nodes.noise.buffer : null;
    if (n.buffer) { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8; const ng = ctx.createGain(); ng.gain.setValueAtTime(0.35 * a, t0); ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18); n.connect(bp).connect(ng).connect(ctx.destination); n.start(t0); n.stop(t0 + 0.2); }
  }

  // a gate: two quick rising notes (exact = higher)
  gate(kind) {
    const ctx = this.horn.ctx;
    if (!ctx || ctx.state !== 'running' || !this.on || kind === 'missed') return;
    const t0 = ctx.currentTime, base = kind === 'exact' ? 660 : kind === 'good' ? 520 : 400;
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = base * (i ? 1.5 : 1);
      const g = ctx.createGain(); const t = t0 + i * 0.09;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.2);
    }
  }

  setOn(on) { this.on = on; if (!on && this.nodes && this.horn.ctx) { const t = this.horn.ctx.currentTime; this.nodes.windGain.gain.setTargetAtTime(0, t, 0.1); this.nodes.nitroGain.gain.setTargetAtTime(0, t, 0.1); this.nodes.sawGain.gain.setTargetAtTime(0, t, 0.1); } }
}
