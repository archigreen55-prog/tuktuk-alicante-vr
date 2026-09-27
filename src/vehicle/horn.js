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
