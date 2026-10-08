// Music of Crazy Tuk: a menu / results track and the driving tracks (the owner's Suno tracks, TEST ones: they are replaced before a
// release, see README "Credits and licences"). Plain <audio> elements with a cross-fade (two at a time), a track list that goes round
// by itself, a "duck" for the pause menu, and the "Музика" switch. No file in the manifest = silence. Starts only after a tap.
const FADE = 3;          // s of cross-fade between tracks / when the section changes
const VOLUME = 0.55;     // the music's own level (the effects are not touched)

export class MusicPlayer {
  constructor() { this.tracks = {}; this.kind = null; this.cur = null; this.on = true; this.duck = 1; this.timer = 0; this.i = { drive: 0 }; this.fading = []; }
  // music: { menu: "file", drive: ["file", ...] } (paths relative to base)
  configure(music, base) { this.tracks = {}; for (const [k, v] of Object.entries(music || {})) this.tracks[k] = (Array.isArray(v) ? v : [v]).map((f) => base + f); }
  setOn(on) { this.on = !!on; if (!on) this.stopAll(); else if (this.kind) { const k = this.kind; this.kind = null; this.set(k); } }
  setDuck(d) { this.duck = d; this.apply(); }
  // the section: 'menu' | 'drive' | null (silence)
  set(kind) {
    if (kind === this.kind) return;
    this.kind = kind;
    if (!this.on || !kind || !this.tracks[kind] || !this.tracks[kind].length) { this.fadeOut(); return; }
    this.startNext(kind);
  }
  startNext(kind) {
    const list = this.tracks[kind]; if (!list || !list.length) return;
    const idx = (this.i[kind] = ((this.i[kind] ?? -1) + 1) % list.length);
    this.fadeOut();
    const el = new Audio(list[idx]); el.preload = 'auto'; el.loop = false;
    el.volume = 0; this.cur = { el, kind, vol: 0, target: 1, done: false };
    const p = el.play(); if (p && p.catch) p.catch(() => { /* no tap yet: it starts on the next call */ if (this.cur && this.cur.el === el) this.cur = null; });
    this.fading.push(this.cur);
    this.tick();
  }
  fadeOut() { for (const t of this.fading) if (t !== this.cur) t.target = 0; if (this.cur) { this.cur.target = 0; this.cur = null; } this.tick(); }
  stopAll() { for (const t of this.fading) { t.el.pause(); t.el.src = ''; } this.fading = []; this.cur = null; clearInterval(this.timer); this.timer = 0; }
  apply() { for (const t of this.fading) t.el.volume = Math.max(0, Math.min(1, t.vol * VOLUME * this.duck)); }
  tick() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const dt = 0.1;
      for (const t of this.fading) {
        t.vol += Math.sign(t.target - t.vol) * Math.min(Math.abs(t.target - t.vol), dt / FADE);
        // the end of a track: the next one of this section comes in while this one goes out
        if (t === this.cur && t.el.duration && t.el.duration - t.el.currentTime < FADE + 0.2 && !t.done) { t.done = true; this.startNext(t.kind); }
      }
      this.apply();
      this.fading = this.fading.filter((t) => { const gone = t.target === 0 && t.vol <= 0.001; if (gone) { t.el.pause(); t.el.src = ''; } return !gone && !(t.el.ended && t !== this.cur); });
      if (!this.fading.length) { clearInterval(this.timer); this.timer = 0; }
    }, 100);
  }
}
