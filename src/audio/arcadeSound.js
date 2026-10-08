// Crazy Tuk sounds, all synthesized (no recordings): the engine (a rattle whose pitch rises with the speed), a soft wind
// that follows the speed and the gusts (no steady hiss), the nitro, tyre squeal on a drift, a thump on a wall hit, the
// gate chime. Shares the horn's AudioContext (unlocked by the first tap / key). "Звук" (sound) and "Музика" (music) are
// separate switches (settings sound.on / music.on, main.js); the music itself arrives in the next stage, the switch is
// kept and read here already. Nothing runs while the mode is off.
export class ArcadeSound {
  constructor(horn) { this.horn = horn; this.nodes = null; this.on = false; this.sound = true; this.music = true; this.gust = 1; this.gustT = 0; this.gustTo = 1; }

  build() {
    const ctx = this.horn.ctx; if (!ctx || this.nodes) return;
    const master = ctx.createGain(); master.gain.value = this.sound ? 1 : 0; master.connect(ctx.destination);
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise.buffer = buf; noise.loop = true;
    // wind: low rumble (low-pass only: nothing above ~1 kHz, so no hiss), gains stay small
    const wind = ctx.createBiquadFilter(); wind.type = 'lowpass'; wind.frequency.value = 200; wind.Q.value = 0.5;
    const windGain = ctx.createGain(); windGain.gain.value = 0;
    noise.connect(wind).connect(windGain).connect(master);
    // nitro: a band-passed whoosh plus a rising saw
    const hiss = ctx.createBiquadFilter(); hiss.type = 'bandpass'; hiss.frequency.value = 1500; hiss.Q.value = 0.9;
    const nitroGain = ctx.createGain(); nitroGain.gain.value = 0;
    noise.connect(hiss).connect(nitroGain).connect(master);
    const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 90;
    const sawLp = ctx.createBiquadFilter(); sawLp.type = 'lowpass'; sawLp.frequency.value = 500;
    const sawGain = ctx.createGain(); sawGain.gain.value = 0;
    saw.connect(sawLp).connect(sawGain).connect(master);
    // engine: a pulse train at the firing rate (a put-put rattle) + a saw an octave up through a low-pass, both chopped by a
    // square LFO at the firing rate; the pitch follows the speed
    const eng = ctx.createOscillator(); eng.type = 'square'; eng.frequency.value = 30;
    const eng2 = ctx.createOscillator(); eng2.type = 'sawtooth'; eng2.frequency.value = 61;
    const engLp = ctx.createBiquadFilter(); engLp.type = 'lowpass'; engLp.frequency.value = 520; engLp.Q.value = 2;
    const chop = ctx.createGain(); chop.gain.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 15;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.4;
    lfo.connect(lfoDepth).connect(chop.gain);
    const engGain = ctx.createGain(); engGain.gain.value = 0;
    eng.connect(engLp); eng2.connect(engLp); engLp.connect(chop).connect(engGain).connect(master);
    // tyre squeal: a wobbling saw through a band-pass + a little hissing noise, only on a slide
    const sq = ctx.createOscillator(); sq.type = 'sawtooth'; sq.frequency.value = 1000;
    const sqLfo = ctx.createOscillator(); sqLfo.type = 'sine'; sqLfo.frequency.value = 9;
    const sqDepth = ctx.createGain(); sqDepth.gain.value = 70; sqLfo.connect(sqDepth).connect(sq.frequency);
    const sqBp = ctx.createBiquadFilter(); sqBp.type = 'bandpass'; sqBp.frequency.value = 1250; sqBp.Q.value = 4;
    const sqGain = ctx.createGain(); sqGain.gain.value = 0;
    sq.connect(sqBp).connect(sqGain).connect(master);
    const sqN = ctx.createBiquadFilter(); sqN.type = 'bandpass'; sqN.frequency.value = 2800; sqN.Q.value = 2;
    const sqNGain = ctx.createGain(); sqNGain.gain.value = 0;
    noise.connect(sqN).connect(sqNGain).connect(master);
    noise.start(); saw.start(); eng.start(); eng2.start(); lfo.start(); sq.start(); sqLfo.start();
    this.nodes = { master, noise, wind, windGain, nitroGain, saw, sawGain, eng, eng2, engLp, engGain, lfo, lfoDepth, sq, sqGain, sqNGain };
  }

  // kmh: speed; nitro: burning; throttle 0..1: the engine's load; slip: sideways speed (m/s) of a slide; dt: s (frame)
  update(kmh, nitro, throttle = 0, slip = 0, dt = 0.016) {
    const ctx = this.horn.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.nodes) this.build();
    const N = this.nodes, t = ctx.currentTime, run = this.on && this.sound;
    const k = Math.max(0, Math.min(1, kmh / 150));
    // wind: quiet and speed dependent; a slow random gust moves the level so a steady speed does not give a steady hiss
    this.gustT -= dt;
    if (this.gustT <= 0) { this.gustT = 0.6 + Math.random() * 1.4; this.gustTo = 0.45 + Math.random() * 0.75; }
    this.gust += (this.gustTo - this.gust) * (1 - Math.exp(-dt / 0.5));
    N.windGain.gain.setTargetAtTime(run ? (0.004 + 0.07 * k * k * k) * this.gust : 0, t, 0.25);
    N.wind.frequency.setTargetAtTime(110 + 520 * k * this.gust, t, 0.3);
    // engine: firing rate 24 Hz at a standstill to ~110 Hz at 150 km/h; louder under load
    const f = 24 + 0.58 * kmh;
    N.eng.frequency.setTargetAtTime(f, t, 0.08); N.eng2.frequency.setTargetAtTime(f * 2.01, t, 0.08); N.lfo.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    N.engLp.frequency.setTargetAtTime(380 + 14 * kmh + 300 * throttle, t, 0.1);
    N.engGain.gain.setTargetAtTime(run ? 0.05 + 0.05 * throttle + 0.03 * k : 0, t, 0.1);
    N.nitroGain.gain.setTargetAtTime(run && nitro ? 0.07 : 0, t, 0.08);
    N.sawGain.gain.setTargetAtTime(run && nitro ? 0.035 : 0, t, 0.08);
    N.saw.frequency.setTargetAtTime(nitro ? 120 + kmh : 90, t, 0.3);
    // squeal: from ~2.5 m/s of sideways speed, louder and a little higher with more
    const s = Math.max(0, Math.min(1, (slip - 2.5) / 7));
    N.sqGain.gain.setTargetAtTime(run ? 0.10 * s : 0, t, 0.05);
    N.sqNGain.gain.setTargetAtTime(run ? 0.05 * s : 0, t, 0.05);
    N.sq.frequency.setTargetAtTime(900 + 500 * s, t, 0.1);
  }

  // a wall hit: a short low thump plus a noise burst, louder with the speed into the wall (m/s)
  hit(into) {
    const ctx = this.horn.ctx;
    if (!ctx || ctx.state !== 'running' || !this.on || !this.sound || !this.nodes) return;
    const out = this.nodes.master, t0 = ctx.currentTime, a = Math.min(1, 0.3 + into / 12);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t0); o.frequency.exponentialRampToValueAtTime(35, t0 + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5 * a, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    o.connect(g).connect(out); o.start(t0); o.stop(t0 + 0.32);
    const n = ctx.createBufferSource(); n.buffer = this.nodes.noise.buffer;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8; const ng = ctx.createGain(); ng.gain.setValueAtTime(0.35 * a, t0); ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    n.connect(bp).connect(ng).connect(out); n.start(t0); n.stop(t0 + 0.2);
  }

  // a gate: two quick rising notes (exact = higher), a sparkle on top for an exact one
  gate(kind) {
    const ctx = this.horn.ctx;
    if (!ctx || ctx.state !== 'running' || !this.on || !this.sound || !this.nodes || kind === 'missed') return;
    const out = this.nodes.master, t0 = ctx.currentTime, base = kind === 'exact' ? 660 : kind === 'good' ? 520 : 400;
    const notes = kind === 'exact' ? [1, 1.5, 2] : [1, 1.5];
    notes.forEach((m, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = base * m;
      const g = ctx.createGain(); const t = t0 + i * 0.09;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.24);
    });
  }

  // the run is on / off (the mode)
  setOn(on) { this.on = on; if (!on) this.silence(); }
  // the settings: "Звук" and "Музика" (the music will read `music` when it exists)
  setSound(on) { this.sound = !!on; if (this.nodes && this.horn.ctx) this.nodes.master.gain.setTargetAtTime(this.sound ? 1 : 0, this.horn.ctx.currentTime, 0.05); }
  setMusic(on) { this.music = !!on; }
  silence() {
    if (!this.nodes || !this.horn.ctx) return;
    const t = this.horn.ctx.currentTime, N = this.nodes;
    for (const g of [N.windGain, N.nitroGain, N.sawGain, N.engGain, N.sqGain, N.sqNGain]) g.gain.setTargetAtTime(0, t, 0.1);
  }
}
