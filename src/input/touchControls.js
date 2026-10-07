// On-screen controls of the "За столом" mode (docs/plan-phone.md 1.2-1.5): steering buttons or slider on the left,
// pedals on the right, handbrake / nitro above them, horn and "look back" in the middle, free area = look around.
// Pointer Events with pointer capture: a finger that started on a pedal stays that pedal wherever it slides, and
// several fingers work at once. The numbers (ramps, curves) live in touchMath.js, shared with tools/test-touch.mjs.
import { steerRamp, sliderSteer, gasFromY, brakeRamp, lookDrag, lookReturn, approach, BACK_YAW } from './touchMath.js';

const CSS = /* css */ `
.tc-root { position: fixed; inset: 0; z-index: 40; pointer-events: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  font-family: system-ui, sans-serif; --k: 1; --edge: max(24px, calc(env(safe-area-inset-right) + 12px)); --edgeL: max(24px, calc(env(safe-area-inset-left) + 12px)); }
.tc-root *, .tc-look { box-sizing: border-box; -webkit-tap-highlight-color: transparent; touch-action: none; -webkit-user-select: none; user-select: none; }
.tc-look { position: fixed; inset: 0; z-index: 38; pointer-events: auto; }
.tc-btn, .tc-pedal, .tc-zone { position: absolute; pointer-events: auto; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; text-align: center; }
.tc-btn, .tc-pedal { background: rgba(16, 22, 28, .5); border: 2px solid rgba(255, 255, 255, .5); border-radius: 16px; overflow: hidden; }
.tc-btn.on, .tc-pedal.on { background: rgba(255, 209, 102, .5); border-color: #ffd166; }
.tc-fill { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: rgba(255, 209, 102, .55); pointer-events: none; }
.tc-lab { position: relative; font-size: clamp(10px, calc(var(--k) * 14px), 14px); letter-spacing: 0; text-shadow: 0 1px 2px #000; pointer-events: none; }
.tc-gas { right: var(--edge); bottom: 18px; width: calc(var(--k) * 100px); height: calc(var(--k) * 150px); }
.tc-brake { right: calc(var(--edge) + var(--k) * 114px); bottom: 18px; width: calc(var(--k) * 84px); height: calc(var(--k) * 120px); }
.tc-hand { right: calc(var(--edge) + var(--k) * 114px); bottom: calc(18px + var(--k) * 130px); width: calc(var(--k) * 84px); height: calc(var(--k) * 50px); }
.tc-nitro { right: calc(var(--edge) + var(--k) * 14px); bottom: calc(18px + var(--k) * 160px); width: calc(var(--k) * 72px); height: calc(var(--k) * 72px); border-radius: 50%; border-width: 0; background: conic-gradient(var(--ring, #4cc36b) calc(var(--p, 100) * 1%), rgba(16, 22, 28, .55) 0); }
.tc-nitro::after { content: ''; position: absolute; inset: 5px; border-radius: 50%; background: rgba(16, 22, 28, .75); }
.tc-nitro.on::after { background: rgba(255, 140, 40, .6); }
.tc-nitro .tc-lab { z-index: 1; font-size: 13px; }
.tc-zone { left: var(--edgeL); bottom: 18px; width: calc(var(--k) * 204px); height: calc(var(--k) * 96px); gap: 8px; }
.tc-zone .tc-btn { position: static; flex: 1; height: 100%; font-size: 34px; pointer-events: none; }
.tc-zone.slider { width: calc(var(--k) * 230px); height: calc(var(--k) * 64px); background: rgba(16, 22, 28, .5); border: 2px solid rgba(255, 255, 255, .5); border-radius: 32px; }
.tc-track { position: absolute; left: 14%; right: 14%; top: 50%; height: 4px; margin-top: -2px; border-radius: 2px; background: rgba(255, 255, 255, .5); pointer-events: none; }
.tc-knob { position: absolute; left: 50%; top: 50%; width: calc(var(--k) * 44px); height: calc(var(--k) * 44px); margin: calc(var(--k) * -22px) 0 0 calc(var(--k) * -22px); border-radius: 50%; background: #ffd166; box-shadow: 0 1px 4px #000; pointer-events: none; transition: transform .12s ease-out; }
.tc-knob.drag { transition: none; }
.tc-horn { left: calc(50% - var(--k) * 132px); bottom: 20px; width: calc(var(--k) * 54px); height: calc(var(--k) * 54px); border-radius: 50%; font-size: 24px; }
.tc-back { left: calc(50% + var(--k) * 78px); bottom: 20px; width: calc(var(--k) * 54px); height: calc(var(--k) * 54px); border-radius: 50%; font-size: 30px; }
.tc-speed { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); text-align: center; color: #fff; text-shadow: 0 1px 4px #000, 0 0 2px #000; pointer-events: none; line-height: 1; }
.tc-speed b { display: block; font-size: calc(var(--k) * 44px); font-variant-numeric: tabular-nums; }
.tc-speed span { font-size: 13px; opacity: .85; }
.tc-sm { width: 46px; height: 46px; font-size: 20px; border-radius: 14px; }
.tc-menu { left: max(8px, env(safe-area-inset-left)); top: 8px; }
.tc-fs { right: max(8px, env(safe-area-inset-right)); top: 8px; }
.tc-cam { right: calc(max(8px, env(safe-area-inset-right)) + 52px); top: 8px; }
.tc-map { right: calc(max(8px, env(safe-area-inset-right)) + 104px); top: 8px; }
`;

// pointer capture keeps a finger on its control wherever it slides (it can fail for a pointer that is already gone)
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* the pointer ended meanwhile */ } };

export class TouchControls {
  // cfg: { steer: 'buttons' | 'slider', gas: 'analog' | 'full', lookReturn: bool, vibrate: bool }
  // hooks: { menu(), camera(), map(), fullscreen() }
  constructor(cfg, hooks = {}) {
    this.cfg = { steer: 'buttons', gas: 'analog', lookReturn: true, vibrate: true, ...cfg };
    this.hooks = hooks;
    this.visible = false;
    // state read by read()
    this.steerDir = 0; this.steer = 0; this.sliderOn = false; this.sliderValue = 0;
    this.gas = 0; this.brakeHeld = false; this.brakeT = 0; this.hand = false; this.nitro = false; this.horn = false; this.back = false;
    // look
    this.yaw = 0; this.pitch = 0; this.idle = 9; this.drag = null; this.lastTap = { t: 0, x: 0, y: 0 };
    this.build();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  // ---------------------------------------------------------------- DOM
  build() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.look = document.createElement('div'); this.look.className = 'tc-look'; this.look.style.display = 'none';
    this.root = document.createElement('div'); this.root.className = 'tc-root'; this.root.style.display = 'none';
    document.body.appendChild(this.look); document.body.appendChild(this.root);
    this.look.addEventListener('contextmenu', (e) => e.preventDefault());
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    const mk = (cls, text, parent = this.root, tag = 'div') => { const e = document.createElement(tag); e.className = cls; if (text != null) e.textContent = text; parent.appendChild(e); return e; };
    // steering: two buttons (one zone: the finger may slide from one to the other) or a slider
    this.zone = mk('tc-zone');
    this.btnL = mk('tc-btn', '◄', this.zone); this.btnR = mk('tc-btn', '►', this.zone);
    this.track = mk('tc-track', null, this.zone); this.knob = mk('tc-knob', null, this.zone);
    // pedals and buttons
    this.brakeEl = mk('tc-pedal tc-brake'); this.brakeFill = mk('tc-fill', null, this.brakeEl); mk('tc-lab', 'ГАЛЬМО', this.brakeEl);
    this.gasEl = mk('tc-pedal tc-gas'); this.gasFill = mk('tc-fill', null, this.gasEl); mk('tc-lab', 'ГАЗ', this.gasEl);
    this.handEl = mk('tc-btn tc-hand'); mk('tc-lab', 'РУЧНИК', this.handEl);
    this.nitroEl = mk('tc-btn tc-nitro'); this.nitroLab = mk('tc-lab', 'НІТРО', this.nitroEl);
    this.hornEl = mk('tc-btn tc-horn', '📯');
    this.backEl = mk('tc-btn tc-back', '⟲');
    this.speedEl = mk('tc-speed'); this.speedNum = mk('', '0', this.speedEl, 'b'); mk('', 'км/год', this.speedEl, 'span');
    this.menuEl = mk('tc-btn tc-sm tc-menu', '≡'); this.mapEl = mk('tc-btn tc-sm tc-map', '🗺'); this.camEl = mk('tc-btn tc-sm tc-cam', '📷'); this.fsEl = mk('tc-btn tc-sm tc-fs', '⛶');
    this.bindZone(); this.bindHold(this.brakeEl, (on) => { this.brakeHeld = on; }, true); this.bindGas();
    this.bindHold(this.handEl, (on) => { this.hand = on; }); this.bindHold(this.nitroEl, (on) => { this.nitro = on; });
    this.bindHold(this.hornEl, (on) => { this.horn = on; }); this.bindHold(this.backEl, (on) => { this.back = on; if (!on) this.idle = this.cfg.lookReturn ? 1.4 : 0; });
    for (const [el, name] of [[this.menuEl, 'menu'], [this.mapEl, 'map'], [this.camEl, 'camera'], [this.fsEl, 'fullscreen']]) {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
      el.addEventListener('click', (e) => { e.stopPropagation(); this.buzz(8); if (this.hooks[name]) this.hooks[name](); });
    }
    this.bindLook();
    this.applyConfig();
  }

  applyConfig() {
    const slider = this.cfg.steer === 'slider';
    this.zone.classList.toggle('slider', slider);
    this.btnL.style.display = this.btnR.style.display = slider ? 'none' : '';
    this.track.style.display = this.knob.style.display = slider ? '' : 'none';
    this.steerDir = 0; this.sliderOn = false; this.sliderValue = 0; this.steer = 0; this.moveKnob(0);
  }
  setConfig(patch) { Object.assign(this.cfg, patch); this.applyConfig(); }

  resize() {
    // everything scales with the screen height (412 px in full screen on an S20 Ultra, ~316 with the address bar)
    const k = Math.max(0.68, Math.min(1.12, innerHeight / 412));
    this.root.style.setProperty('--k', k.toFixed(3));
    this.rects = null;
  }
  setVisible(v) { this.visible = v; this.root.style.display = v ? '' : 'none'; this.look.style.display = v ? '' : 'none'; if (!v) this.releaseAll(); }

  // ---------------------------------------------------------------- pointers
  bindZone() {
    const z = this.zone;
    const apply = (e) => {
      const r = z.getBoundingClientRect();
      if (this.cfg.steer === 'slider') {
        this.sliderOn = true; this.sliderValue = sliderSteer(e.clientX, r.left, r.right, r.height * 0.34);
        this.moveKnob(this.sliderValue);
      } else {
        this.steerDir = e.clientX < r.left + r.width / 2 ? -1 : 1;
        this.btnL.classList.toggle('on', this.steerDir < 0); this.btnR.classList.toggle('on', this.steerDir > 0);
      }
    };
    const end = () => { this.steerDir = 0; this.sliderOn = false; this.sliderValue = 0; this.btnL.classList.remove('on'); this.btnR.classList.remove('on'); this.knob.classList.remove('drag'); this.moveKnob(0); this.zonePtr = null; };
    z.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); capture(z, e.pointerId); this.zonePtr = e.pointerId; this.knob.classList.add('drag'); this.buzz(6); apply(e); });
    z.addEventListener('pointermove', (e) => { if (this.zonePtr === e.pointerId) apply(e); });
    z.addEventListener('pointerup', (e) => { if (this.zonePtr === e.pointerId) end(); });
    z.addEventListener('pointercancel', (e) => { if (this.zonePtr === e.pointerId) end(); });
    z.addEventListener('lostpointercapture', (e) => { if (this.zonePtr === e.pointerId) end(); });
  }
  moveKnob(v) {
    const r = this.zone.getBoundingClientRect();
    const half = Math.max(0, r.width / 2 - r.height * 0.34);
    this.knob.style.transform = `translateX(${(v * half).toFixed(1)}px)`;
  }
  bindGas() {
    const el = this.gasEl; let id = null;
    const apply = (e) => { const r = el.getBoundingClientRect(); this.gas = gasFromY(e.clientY, r.top, r.bottom, this.cfg.gas); this.gasFill.style.height = `${Math.round(this.gas * 100)}%`; };
    const end = () => { this.gas = 0; id = null; el.classList.remove('on'); this.gasFill.style.height = '0'; };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); capture(el, e.pointerId); id = e.pointerId; el.classList.add('on'); apply(e); });
    el.addEventListener('pointermove', (e) => { if (id === e.pointerId) apply(e); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, (e) => { if (id === e.pointerId) end(); });
  }
  // a button that is active while a finger holds it
  bindHold(el, set, fill = false) {
    let id = null;
    const end = () => { id = null; el.classList.remove('on'); set(false); if (fill) this.brakeFill.style.height = '0'; };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); capture(el, e.pointerId); id = e.pointerId; el.classList.add('on'); this.buzz(8); set(true); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, (e) => { if (id === e.pointerId) end(); });
  }
  bindLook() {
    const L = this.look;
    L.addEventListener('pointerdown', (e) => {
      if (this.drag) return;
      capture(L, e.pointerId);
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: e.timeStamp };   // timeStamp: when the finger touched, not when a busy frame got round to the event
      this.idle = 0;
    });
    L.addEventListener('pointermove', (e) => {
      const d = this.drag; if (!d || d.id !== e.pointerId || this.back) return;
      [this.yaw, this.pitch] = lookDrag(this.yaw, this.pitch, e.clientX - d.x, e.clientY - d.y);
      d.x = e.clientX; d.y = e.clientY; this.idle = 0;
    });
    const up = (e) => {
      const d = this.drag; if (!d || d.id !== e.pointerId) return;
      this.drag = null; this.idle = 0;
      // a double tap = look straight ahead
      const now = e.timeStamp, moved = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
      if (e.type === 'pointerup' && now - d.t0 < 250 && moved < 12) {
        const t = this.lastTap;
        if (now - t.t < 320 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 40) { this.yaw = 0; this.pitch = 0; this.lastTap = { t: 0, x: 0, y: 0 }; this.buzz(8); }
        else this.lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    };
    L.addEventListener('pointerup', up); L.addEventListener('pointercancel', up); L.addEventListener('lostpointercapture', up);
  }

  // all fingers up (pause, window hidden): nothing may stay pressed
  releaseAll() {
    this.steerDir = 0; this.steer = 0; this.sliderOn = false; this.sliderValue = 0; this.gas = 0; this.brakeHeld = false; this.brakeT = 0;
    this.hand = this.nitro = this.horn = this.back = false; this.drag = null; this.zonePtr = null;
    if (this.root) for (const e of this.root.querySelectorAll('.on')) e.classList.remove('on');
    if (this.gasFill) this.gasFill.style.height = '0';
    if (this.knob) this.moveKnob(0);
  }

  // ---------------------------------------------------------------- per frame
  // merges the touch state into the common input { throttle, brake, steer, handbrake, nitro, horn } (on top of the keyboard)
  read(dt, out) {
    if (!this.visible) return out;
    if (this.cfg.steer === 'slider') { if (this.sliderOn) out.steer = this.sliderValue; }
    else {
      this.steer = steerRamp(this.steer, this.steerDir, dt);
      if (this.steerDir !== 0 || this.steer !== 0) out.steer = this.steer;
    }
    out.throttle = Math.max(out.throttle, this.gas);
    this.brakeT = this.brakeHeld ? this.brakeT + dt : 0;
    const br = brakeRamp(this.brakeT);
    out.brake = Math.max(out.brake, br);
    this.brakeFill.style.height = br ? `${Math.round(br * 100)}%` : '0';
    if (this.hand) out.handbrake = true;
    if (this.nitro) out.nitro = true;
    if (this.horn) out.horn = true;
    return out;
  }
  // the head: returns { yaw, pitch } for the cab camera
  update(dt) {
    if (!this.drag) this.idle += dt;
    if (this.back) { this.yaw = approach(this.yaw, BACK_YAW, dt); this.pitch = approach(this.pitch, 0, dt); }
    else if (!this.drag && this.cfg.lookReturn) { this.yaw = lookReturn(this.yaw, this.idle, dt); this.pitch = lookReturn(this.pitch, this.idle, dt); }
    return { yaw: this.yaw, pitch: this.pitch };
  }
  resetLook() { this.yaw = 0; this.pitch = 0; this.idle = 9; }

  // speed (km/h) in the middle; nitro ring: { state: 'ready' | 'active' | 'charge', level 0..1, left s }
  setSpeed(kmh) { const t = String(Math.round(Math.abs(kmh))); if (this.speedNum.textContent !== t) this.speedNum.textContent = t; }
  setNitro(n) {
    if (!n) return;
    const key = `${n.state}:${Math.round(n.level * 50)}:${n.left}`;
    if (key === this.nitroKey) return;
    this.nitroKey = key;
    this.nitroEl.style.setProperty('--p', String(Math.round(n.level * 100)));
    this.nitroEl.style.setProperty('--ring', n.state === 'active' ? '#ff9f43' : n.state === 'ready' ? '#4cc36b' : '#6f8fa8');
    this.nitroLab.textContent = n.state === 'charge' ? `${n.left} с` : n.state === 'active' ? 'НІТРО!' : 'НІТРО';
  }
  buzz(ms) { if (this.cfg.vibrate && navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* ignored */ } } }
}
