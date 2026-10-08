// Sound files of Crazy Tuk (the owner's decision of 2026-10-08: real recordings instead of synthesis). One manifest,
// assets/audio/manifest.json, says which file is which sound; a sound without a file is simply silent, so the game runs with an
// empty manifest. Effects and loops are decoded into the shared AudioContext (the horn's, unlocked by the first tap); music is
// streamed by music.js. Formats: AAC in .m4a (plays everywhere a phone browser plays); see assets/audio/README.md.
//
// manifest: {
//   "sfx":   { "hit.light": ["sfx/hit1.m4a", "sfx/hit2.m4a"], "tourist.cheer": [...], "horn": [...], ... },   // one-shots, a random variant each time
//   "loops": { "engine": { "file": "loops/engine.m4a", "kmh": [0, 150], "rate": [0.7, 1.9], "gain": [0.35, 0.7] }, ... },   // see arcadeSound.js
//   "music": { "menu": "music/menu.m4a", "drive": ["music/drive-1.m4a", "music/drive-2.m4a"] },
//   "credits": ["Назва: автор, ліцензія, посилання", ...]
// }
export class SoundBank {
  constructor(horn, base = 'assets/audio/') {
    this.horn = horn; this.base = base; this.manifest = { sfx: {}, loops: {}, music: {}, credits: [] };
    this.buffers = new Map(); this.loading = null; this.loaded = false; this.master = null; this.muted = false;
  }

  // reads the manifest (once); decoding starts when the audio context exists
  async init(version = '') {
    try {
      const r = await fetch(`${this.base}manifest.json${version ? '?v=' + version : ''}`, { cache: 'no-store' });
      if (r.ok) this.manifest = { sfx: {}, loops: {}, music: {}, credits: [], ...(await r.json()) };
    } catch (e) { /* no manifest: a silent game */ }
    return this.manifest;
  }
  get ctx() { return this.horn && this.horn.ctx; }
  get credits() { return this.manifest.credits || []; }
  get music() { return this.manifest.music || {}; }
  has(name) { return !!(this.manifest.sfx[name] && this.manifest.sfx[name].length); }
  hasLoop(name) { return !!(this.manifest.loops[name] && this.manifest.loops[name].file); }

  // decode every effect and loop (call when the context runs; safe to call again)
  prepare() {
    const ctx = this.ctx;
    if (!ctx || this.loading) return this.loading;
    const files = new Set();
    for (const list of Object.values(this.manifest.sfx)) for (const f of list) files.add(f);
    for (const l of Object.values(this.manifest.loops)) if (l.file) files.add(l.file);
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 1; this.master.connect(ctx.destination);
    this.loading = Promise.all([...files].map(async (f) => {
      try { const r = await fetch(this.base + f); if (!r.ok) throw new Error(r.status); this.buffers.set(f, await ctx.decodeAudioData(await r.arrayBuffer())); }
      catch (e) { console.warn(`audio ${f}: ${e.message}`); }
    })).then(() => { this.loaded = true; });
    return this.loading;
  }
  setMuted(m) { this.muted = !!m; if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05); }

  // a one-shot: opts { gain, rate }. Returns the source or null (no file / not ready / muted)
  play(name, { gain = 1, rate = 1 } = {}) {
    const ctx = this.ctx, list = this.manifest.sfx[name];
    if (!ctx || ctx.state !== 'running' || !this.master || this.muted || !list || !list.length) return null;
    const buf = this.buffers.get(list[Math.floor(Math.random() * list.length)]);
    if (!buf) return null;
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain; src.connect(g).connect(this.master); src.start();
    return src;
  }

  // a loop that runs all the time at gain 0 and is steered by setGain / setRate; null when the file is missing
  loop(name) {
    const ctx = this.ctx, cfg = this.manifest.loops[name];
    if (!ctx || !this.master || !cfg || !cfg.file) return null;
    const buf = this.buffers.get(cfg.file); if (!buf) return null;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0; src.connect(g).connect(this.master); src.start();
    return { src, g, cfg, setGain: (v, tc = 0.12) => g.gain.setTargetAtTime(v, ctx.currentTime, tc), setRate: (v, tc = 0.08) => src.playbackRate.setTargetAtTime(v, ctx.currentTime, tc), stop: () => { try { src.stop(); } catch (e) { /* stopped */ } } };
  }
}
