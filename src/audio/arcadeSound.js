// Crazy Tuk sound: real recordings from assets/audio (src/audio/soundBank.js, manifest.json) and the music (src/audio/music.js).
// The synthesized engine / wind / squeal / chimes of 0.12-0.13 are gone (owner's decision, 2026-10-08); a sound without a file in the
// manifest is silent. Slots the game uses (name -> where it is played):
//   loops:  engine (kmh -> pitch and level), wind (kmh -> level, with gusts), squeal (sideways speed -> level), nitro (burning)
//   sfx:    hit.light / hit.medium / hit.heavy (or hit), gate.exact / gate.good / gate.ok, nitro.start, horn, nearmiss, drift.end, combo,
//           landing, smash (0.15.0), tourist.cheer / tourist.laugh / tourist.scream / tourist.gasp (the passengers)
// "Звук" (setSound) mutes all of it, "Музика" (setMusic) the music only; setOn is the mode (a run on / off).
import { SoundBank } from './soundBank.js';
import { MusicPlayer } from './music.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

export class ArcadeSound {
  constructor(horn) {
    this.horn = horn; this.bank = new SoundBank(horn); this.musicPlayer = new MusicPlayer();
    this.on = false; this.sound = true; this.music = true; this.loops = null; this.ready = false; this.gust = 1; this.gustT = 0; this.gustTo = 1;
    this.last = new Map();
  }
  async init(version = '') {
    const m = await this.bank.init(version);
    this.musicPlayer.configure(m.music, this.bank.base);
    this.musicPlayer.setOn(this.music);
    this.inited = true;
    const k = this.musicPlayer.kind; if (k) { this.musicPlayer.kind = null; this.musicPlayer.set(k); }   // a section asked for before the manifest arrived
  }
  get credits() { return this.bank.credits; }
  has(name) { return this.bank.has(name); }

  // the loops are made once the context runs and the files are decoded
  build() {
    const ctx = this.horn.ctx; if (!this.inited || !ctx || ctx.state !== 'running' || this.loops) return;
    if (!this.bank.loading) { this.bank.prepare().then(() => { this.loops = {}; for (const n of ['engine', 'wind', 'squeal', 'nitro']) this.loops[n] = this.bank.loop(n); this.ready = true; }); }
  }

  // kmh: speed; nitro: burning; throttle 0..1; slip: sideways speed (m/s); dt: s (frame)
  update(kmh, nitro, throttle = 0, slip = 0, dt = 0.016) {
    this.build();
    if (!this.ready) return;
    const L = this.loops, run = this.on && this.sound;
    this.gustT -= dt;
    if (this.gustT <= 0) { this.gustT = 0.6 + Math.random() * 1.4; this.gustTo = 0.5 + Math.random() * 0.7; }
    this.gust += (this.gustTo - this.gust) * (1 - Math.exp(-dt / 0.5));
    if (L.engine) {
      const c = L.engine.cfg, t = clamp01((kmh - (c.kmh ? c.kmh[0] : 0)) / ((c.kmh ? c.kmh[1] : 150) - (c.kmh ? c.kmh[0] : 0)));
      L.engine.setRate(lerp(c.rate ? c.rate[0] : 0.7, c.rate ? c.rate[1] : 1.9, t));
      L.engine.setGain(run ? lerp(c.gain ? c.gain[0] : 0.35, c.gain ? c.gain[1] : 0.7, t) * (0.85 + 0.15 * throttle) : 0);
    }
    if (L.wind) {
      const c = L.wind.cfg, k0 = c.kmh ? c.kmh[0] : 50, k1 = c.kmh ? c.kmh[1] : 150, t = clamp01((kmh - k0) / (k1 - k0));
      L.wind.setGain(run ? (c.gain ? c.gain[1] : 0.5) * t * t * this.gust : 0, 0.25);
    }
    if (L.squeal) {
      const c = L.squeal.cfg, s = clamp01((slip - (c.slip ? c.slip[0] : 2.5)) / ((c.slip ? c.slip[1] : 9) - (c.slip ? c.slip[0] : 2.5)));
      L.squeal.setGain(run ? s * (c.gain ? c.gain[1] : 0.8) : 0, 0.06); L.squeal.setRate(1 + 0.15 * s);
    }
    if (L.nitro) L.nitro.setGain(run && nitro ? (L.nitro.cfg.gain ? L.nitro.cfg.gain[1] : 0.6) : 0, 0.08);
  }

  // a one-shot with a cooldown per name (s), so a flurry of events is not a wall of sound
  play(name, opts = {}, cooldown = 0) {
    if (!this.on || !this.sound) return null;
    const now = performance.now() / 1000;
    if (cooldown && now - (this.last.get(name) || -9) < cooldown) return null;
    const src = this.bank.play(name, opts);
    if (src) this.last.set(name, now);
    return src;
  }
  hit(into) { return this.play(into < 5 && this.has('hit.light') ? 'hit.light' : into < 10 && this.has('hit.medium') ? 'hit.medium' : this.has('hit.heavy') ? 'hit.heavy' : 'hit', { gain: Math.min(1, 0.5 + into / 14) }); }
  gate(kind) { if (kind !== 'missed') this.play(this.has('gate.' + kind) ? 'gate.' + kind : 'gate'); }

  setOn(on) { this.on = on; if (!on) { this.silence(); this.musicPlayer.set(null); } }
  setSound(on) { this.sound = !!on; this.bank.setMuted(!this.sound); }
  setMusic(on) { this.music = !!on; this.musicPlayer.setOn(this.music); }
  // 'menu' | 'drive' | null; duck: the pause menu lowers the music
  setSection(kind) { this.musicPlayer.set(kind); }
  duck(on) { this.musicPlayer.setDuck(on ? 0.35 : 1); }
  silence() { if (!this.loops) return; for (const l of Object.values(this.loops)) if (l) l.setGain(0, 0.1); }
}
