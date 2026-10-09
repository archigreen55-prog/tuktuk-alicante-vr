// The sound lab («Звуки», 0.18.0): a hidden page of the owner's device (the one with the editor key): menu ≡ -> «Звуки» (PC: the L key). For every slot it lists the
// candidates (assets/audio-cand/manifest.json, made by tools/build-sounds.mjs: effects trimmed and levelled, loops already cut seamless) with ▶, the name, the
// author, the licence and «Вибрати». Loops (engine, tyre squeal, nitro) follow the sliders exactly as in the game (engineParams / squealParams of
// src/audio/arcadeSound.js): speed 0-150 km/h (pitch and level of the engine), sideways slip for the squeal; the squeal and the nitro can be heard together with the
// chosen engine ("Мікс з двигуном") to hear that they do not drown each other. The choice is kept on the device; «Копіювати вибір» gives the short text to paste into the chat.
import { engineParams, squealParams, nitroGain } from '../audio/arcadeSound.js';
import { loadSetting, saveSetting } from '../settings.js';

const CSS = `
.sl { position: fixed; inset: 0; z-index: 96; display: none; flex-direction: column; background: #f4efe4; color: #10161c; font-family: system-ui, sans-serif; }
.sl.on { display: flex; }
.sl-top { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; padding: max(6px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) 6px max(10px, env(safe-area-inset-left)); background: #1b2733; color: #fff; }
.sl-top .brk { flex-basis: 100%; height: 0; }
.sl-top h2 { flex: 1; margin: 0; font: 800 17px system-ui, sans-serif; }
.sl-top label { font: 600 13px system-ui, sans-serif; display: flex; align-items: center; gap: 8px; }
.sl-top input[type=range] { width: min(20vw, 150px); height: 30px; }
.sl-top b { min-width: 3.4em; display: inline-block; font-variant-numeric: tabular-nums; }
.sl button { font: 700 15px system-ui, sans-serif; min-height: 44px; min-width: 44px; padding: 0 12px; border-radius: 10px; border: 2px solid #10161c; background: #fff; color: #10161c; touch-action: manipulation; }
.sl button:active { background: #ffd166; }
.sl button.on { background: #ffd84a; } .sl button.sel { background: #2e9e57; color: #fff; border-color: #1f7a3d; }
.sl-top button { border-color: #fff; min-height: 38px; }
.sl-list { flex: 1; overflow-y: auto; padding: 4px max(10px, env(safe-area-inset-right)) 14px max(10px, env(safe-area-inset-left)); -webkit-overflow-scrolling: touch; }
.sl h3 { margin: 16px 0 4px; font: 800 15px system-ui, sans-serif; display: flex; justify-content: space-between; gap: 10px; border-bottom: 2px solid #c9bfa8; padding-bottom: 3px; }
.sl h3 small { font: 600 12px system-ui, sans-serif; color: #5a6672; text-align: right; }
.sl-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid #ddd5c2; }
.sl-row .nm { flex: 1; min-width: 0; font: 600 14px system-ui, sans-serif; } .sl-row .nm small { display: block; font: 500 12px system-ui, sans-serif; color: #5a6672; }
.sl-row .nm a { color: #1a5fb4; }
.sl-bot { flex: none; display: flex; gap: 10px; align-items: center; padding: 8px max(10px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left)); background: #1b2733; color: #fff; }
.sl-bot button { border-color: #fff; } .sl-bot span { font: 500 12px system-ui, sans-serif; opacity: .85; flex: 1; }
.sl-out { position: absolute; left: 10px; right: 10px; bottom: 70px; padding: 10px; background: #fff; border: 2px solid #10161c; border-radius: 12px; display: none; }
.sl-out textarea { width: 100%; height: 130px; box-sizing: border-box; font: 12px ui-monospace, monospace; }
.sl-empty { padding: 20px 4px; font: 600 15px system-ui, sans-serif; color: #b3261e; }
`;
const el = (tag, cls, text, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };
const KEY = 'soundlab.v1';

// opts: { base: 'assets/audio-cand/', version, onOpen(), onClose() }
export function createSoundLab({ base = 'assets/audio-cand/', version = '', onOpen = () => {}, onClose = () => {} } = {}) {
  let root = null, list = null, manifest = null, ctx = null, master = null, open = false;
  const buffers = new Map();            // file -> AudioBuffer
  const voices = new Map();             // slot -> { id, src, g, cfg }  (a running loop)
  let mixEngine = null;                 // the engine loop played under the squeal / nitro (mix)
  const st = { kmh: 60, slip: 6, mix: true, sel: loadSetting(KEY, {}) };
  let rows = new Map();                 // id -> { play, pick } buttons

  const save = () => saveSetting(KEY, st.sel);
  const chosen = (slot) => st.sel[slot] || [];

  async function buffer(file) {
    if (buffers.has(file)) return buffers.get(file);
    const r = await fetch(base + file + (version ? '?v=' + version : '')); if (!r.ok) throw new Error(r.status);
    const b = await ctx.decodeAudioData(await r.arrayBuffer()); buffers.set(file, b); return b;
  }
  function ensureCtx() {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
  }

  // ---- playing
  function startLoop(buf, gain, rate) {
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = 0; src.connect(g).connect(master); src.start(); g.gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
    return { src, g };
  }
  const stopVoice = (v) => { if (!v) return; try { v.g.gain.setTargetAtTime(0, ctx.currentTime, 0.03); v.src.stop(ctx.currentTime + 0.15); } catch (e) { /* stopped */ } };
  // the parameters of a loop of a slot at the sliders (as in the game)
  function loopParams(slot, cfg) {
    if (slot === 'engine') return engineParams(cfg, st.kmh, 1);
    if (slot === 'squeal') return squealParams(cfg, st.slip);
    return { rate: 1, gain: nitroGain(cfg) };
  }
  function engineCfg() { return manifest.slots.engine ? manifest.slots.engine.cfg : { kmh: [0, 150], rate: [0.7, 1.9], gain: [0.1, 0.26] }; }
  function updateVoices() {
    for (const [slot, v] of voices) { const p = loopParams(slot, v.cfg); v.g.gain.setTargetAtTime(p.gain, ctx.currentTime, 0.06); v.src.playbackRate.setTargetAtTime(p.rate, ctx.currentTime, 0.06); }
    if (mixEngine) { const p = engineParams(engineCfg(), st.kmh, 1); mixEngine.g.gain.setTargetAtTime(p.gain, ctx.currentTime, 0.06); mixEngine.src.playbackRate.setTargetAtTime(p.rate, ctx.currentTime, 0.06); }
  }
  async function ensureMix() {
    const want = st.mix && [...voices.keys()].some((s) => s !== 'engine');
    if (!want) { stopVoice(mixEngine); mixEngine = null; return; }
    if (mixEngine || voices.has('engine')) return;
    const e = manifest.slots.engine; if (!e || !e.candidates.length) return;
    const pickId = chosen('engine')[0], c = e.candidates.find((x) => x.id === pickId) || e.candidates[0];
    const buf = await buffer(c.file), p = engineParams(engineCfg(), st.kmh, 1);
    if (!mixEngine) mixEngine = startLoop(buf, p.gain, p.rate);
  }
  async function play(slotId, cand) {
    ensureCtx();
    const slot = manifest.slots[slotId];
    try {
      const buf = await buffer(cand.file);
      if (slot.kind === 'loop') {
        const cur = voices.get(slotId);
        if (cur && cur.id === cand.id) { stopVoice(cur); voices.delete(slotId); refreshButtons(); await ensureMix(); return; }
        stopVoice(cur);
        const cfg = slot.cfg || {}, p = loopParams(slotId, cfg), v = startLoop(buf, p.gain, p.rate);
        voices.set(slotId, { id: cand.id, ...v, cfg });
        if (slotId === 'engine') { stopVoice(mixEngine); mixEngine = null; }
        refreshButtons(); await ensureMix();
      } else {
        const src = ctx.createBufferSource(); src.buffer = buf; const g = ctx.createGain(); g.gain.value = slot.gain ?? 1; src.connect(g).connect(master); src.start();
      }
    } catch (e) { console.warn(`звук ${cand.file}: ${e.message}`); flashOut(`Не вдалося зіграти ${cand.id}: ${e.message}`); }
  }
  function stopAll() { for (const v of voices.values()) stopVoice(v); voices.clear(); stopVoice(mixEngine); mixEngine = null; refreshButtons(); }

  // ---- the page
  function refreshButtons() {
    for (const [id, r] of rows) {
      const slot = r.slot, on = voices.get(slot) && voices.get(slot).id === id;
      r.play.textContent = on ? '■' : '▶'; r.play.classList.toggle('on', !!on);
      const sel = chosen(slot).includes(id); r.pick.textContent = sel ? '✓ Вибрано' : 'Вибрати'; r.pick.classList.toggle('sel', sel);
    }
    for (const [slot, n] of summaries) n.textContent = chosen(slot).length ? `вибрано: ${chosen(slot).join(', ')}` : 'не вибрано';
  }
  let summaries = new Map();
  function toggleChoice(slotId, id) {
    const kind = manifest.slots[slotId].kind, cur = chosen(slotId);
    if (cur.includes(id)) st.sel[slotId] = cur.filter((x) => x !== id);
    else st.sel[slotId] = kind === 'loop' ? [id] : [...cur, id];   // a loop: one; effects: several variants (a random one each time)
    if (!st.sel[slotId].length) delete st.sel[slotId];
    save(); refreshButtons();
  }
  function build() {
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    root = el('div', 'sl', null, document.body);
    const top = el('div', 'sl-top', null, root);
    el('h2', null, 'Звуки: примірочна', top);
    const stop = el('button', null, '■ Стоп усе', top); stop.addEventListener('click', stopAll);
    const x = el('button', null, '✕', top); x.addEventListener('click', close); el('div', 'brk', null, top);
    const l1 = el('label', null, 'Швидкість ', top), r1 = el('input', null, null, l1), v1 = el('b', null, '', l1); r1.type = 'range'; r1.min = 0; r1.max = 150; r1.value = st.kmh;
    const l2 = el('label', null, 'Ковзання (вереск) ', top), r2 = el('input', null, null, l2), v2 = el('b', null, '', l2); r2.type = 'range'; r2.min = 0; r2.max = 9; r2.step = 0.1; r2.value = st.slip;
    const l3 = el('label', null, null, top), c3 = el('input', null, null, l3); c3.type = 'checkbox'; c3.checked = st.mix; l3.append(' Мікс з двигуном');
    const sync = () => { v1.textContent = `${st.kmh} км/г`; v2.textContent = `${st.slip.toFixed(1)} м/с`; };
    r1.addEventListener('input', () => { st.kmh = +r1.value; sync(); updateVoices(); }); r2.addEventListener('input', () => { st.slip = +r2.value; sync(); updateVoices(); });
    c3.addEventListener('change', () => { st.mix = c3.checked; ensureMix(); }); sync();
    list = el('div', 'sl-list', null, root);
    const bot = el('div', 'sl-bot', null, root);
    const copy = el('button', null, '📋 Копіювати вибір', bot); copy.addEventListener('click', copyChoice);
    el('span', null, 'Вибір зберігається на цьому пристрої. Вставиш його мені в чат: я поставлю ці звуки в гру.', bot);
    out = el('div', 'sl-out', null, root); outText = el('textarea', null, null, out); outText.readOnly = true; outText.addEventListener('focus', () => outText.select());
    addEventListener('keydown', (e) => { if (open && e.code === 'Escape') { close(); e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  }
  let out = null, outText = null, outTimer = 0;
  function flashOut(text) { outText.value = text; out.style.display = 'block'; clearTimeout(outTimer); outTimer = setTimeout(() => { out.style.display = 'none'; }, 4000); }

  function fill() {
    list.textContent = ''; rows = new Map(); summaries = new Map();
    if (!manifest || !Object.keys(manifest.slots || {}).length || !Object.values(manifest.slots).some((s) => s.candidates.length)) {
      el('div', 'sl-empty', 'Кандидатів ще нема. Їх готує розробник: node tools/fetch-sounds.mjs, потім node tools/build-sounds.mjs --candidates (потрібен доступ до freesound.org і kenney.nl).', list); return;
    }
    for (const [slotId, slot] of Object.entries(manifest.slots)) {
      if (!slot.candidates.length) continue;
      const h = el('h3', null, slot.title, list), sm = el('small', null, '', h); summaries.set(slotId, sm);
      for (const c of slot.candidates) {
        const row = el('div', 'sl-row', null, list), pb = el('button', null, '▶', row), nm = el('div', 'nm', c.name, row);
        const meta = el('small', null, `${c.author} · ${c.license}${c.attribution ? ' (потрібна подяка)' : ''} · ${c.note || ''} · `, nm), a = el('a', null, c.id, meta); a.href = c.url; a.target = '_blank'; a.rel = 'noopener';
        const pick = el('button', null, 'Вибрати', row);
        pb.addEventListener('click', () => play(slotId, c)); pick.addEventListener('click', () => toggleChoice(slotId, c.id));
        rows.set(c.id, { slot: slotId, play: pb, pick });
      }
    }
    refreshButtons();
  }

  // the text for the chat
  function choiceText() {
    const lines = ['ЗВУКИ: мій вибір з примірочної'];
    const byId = new Map(); for (const s of Object.values(manifest.slots)) for (const c of s.candidates) byId.set(c.id, c);
    const none = [];
    for (const [slotId, slot] of Object.entries(manifest.slots)) {
      const ids = chosen(slotId).filter((id) => byId.has(id));
      if (!ids.length) { if (slot.candidates.length) none.push(slotId); continue; }
      lines.push(`${slotId}: ${ids.join(', ')}   (${ids.map((id) => `${byId.get(id).name}, ${byId.get(id).author}`).join('; ')})`);
    }
    if (none.length) lines.push(`не вибрано: ${none.join(', ')}`);
    lines.push(`швидкість-повзунок: ${st.kmh} км/г`);
    return lines.join('\n');
  }
  async function copyChoice() {
    const text = choiceText(); outText.value = text; out.style.display = 'block'; clearTimeout(outTimer);
    try { await navigator.clipboard.writeText(text); flashOutKeep('Скопійовано. Встав у чат:'); } catch { outText.select(); try { document.execCommand('copy'); } catch (e) { /* the field is there */ } }
  }
  function flashOutKeep() { /* the text stays visible until the lab closes */ }

  async function openLab() {
    if (open) return;
    if (!root) build();
    ensureCtx(); open = true; root.classList.add('on'); onOpen();
    if (!manifest) { try { const r = await fetch(`${base}manifest.json?t=${Date.now()}`, { cache: 'no-store' }); manifest = r.ok ? await r.json() : { slots: {} }; } catch (e) { manifest = { slots: {} }; } }
    fill();
  }
  function close() { if (!open) return; stopAll(); open = false; root.classList.remove('on'); out.style.display = 'none'; onClose(); }
  // for the tests: what plays now and with which rate / level
  const debug = () => ({ voices: Object.fromEntries([...voices].map(([s, v]) => [s, { id: v.id, rate: v.src.playbackRate.value, gain: v.g.gain.value }])), mix: mixEngine ? { rate: mixEngine.src.playbackRate.value, gain: mixEngine.g.gain.value } : null, ctx: ctx ? ctx.state : null });
  return { open: openLab, close, debug, get isOpen() { return open; }, get choice() { return JSON.parse(JSON.stringify(st.sel)); }, choiceText: () => (manifest ? choiceText() : ''), get state() { return st; } };
}
