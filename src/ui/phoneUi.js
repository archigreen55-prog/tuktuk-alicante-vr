// The phone interface of stage F1 (docs/plan-phone.md sections 3, 6): a compact start screen, the HTML HUD
// (the desktop HUD of hud.js, restyled for 915 x 412 px), the pause menu with the settings, the tour summary
// buttons, the message toast, full screen / landscape / wake lock, the Android "back" button as pause.
// Controls themselves are in input/touchControls.js. This module never touches physics: it talks to main.js
// through `api`.
import { levelOptions, unfoldIfHardRow } from './levelList.js';
import { loadSetting, saveSetting } from '../settings.js';
import { enterFullscreen, lockLandscape, keepAwake, fullscreenBlocker, hintFor, isFullscreen, canInstall, install, onInstallChange, screenReport } from './screenMode.js';
import { t, setLang, getLang, otherLang, LANGS } from '../i18n.js';

const CSS = /* css */ `
html.ui-phone { touch-action: manipulation; overscroll-behavior: none; }
html.ui-phone #attr, html.ui-phone #debug, html.ui-phone #vrbutton { display: none !important; }
/* start screen: two columns, no tables of keys */
/* the desktop HUD, restyled */
html.ui-phone #tourHud { left: 50%; right: auto; top: 6px; transform: translateX(-50%); min-width: 0; width: max-content; max-width: min(44vw, 340px); padding: 5px 10px; font-size: 13px; text-align: center; pointer-events: none; }
html.ui-phone #placeChip { top: 100px; max-width: min(52vw, 400px); padding: 7px 14px; font-size: 13px; }
html.ui-phone #tourHud .l1 { font-size: 12px; } html.ui-phone #tourHud .l2 { font-size: 16px; } html.ui-phone #tourHud .l3, html.ui-phone #tourHud .l4 { font-size: 13px; }
html.ui-phone #tourCard { left: 50%; bottom: auto; top: 54px; transform: translateX(-50%); width: min(58vw, 540px); max-height: calc(100vh - 150px); overflow-y: auto; font-size: 15px; z-index: 8; background: rgba(10, 14, 20, .88); pointer-events: none; }
html.ui-phone #tourCard.mode-card, html.ui-phone #tourCard.mode-summary { pointer-events: auto; touch-action: pan-y; }
html.ui-phone #tourCard.mode-card .b { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
html.ui-phone #tourCard.mode-text { width: min(52vw, 480px); top: 58px; font-size: 14px; padding: 8px 12px; }
html.ui-phone #tourCard .t { font-size: 18px; } html.ui-phone #tourCard .c { font-size: 13px; }
html.ui-phone #miniMap { left: max(10px, env(safe-area-inset-left)); top: 62px; bottom: auto; width: 110px; height: 110px; z-index: 8; pointer-events: auto; transition: width .15s, height .15s; }
/* toast, summary buttons, menu */
.ph-toast { position: fixed; left: 50%; top: 31%; transform: translateX(-50%); z-index: 45; max-width: 60vw; padding: 8px 16px; border-radius: 12px; background: rgba(10, 14, 20, .78); color: #ffd166; font: 700 20px/1.25 system-ui, sans-serif; text-align: center; pointer-events: none; display: none; }
.ph-sum { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 45; display: none; gap: 14px; }
.ph-btn { font: 700 16px system-ui, sans-serif; min-height: 48px; padding: 10px 20px; border-radius: 12px; border: 2px solid #ffd166; background: rgba(16, 22, 28, .9); color: #ffd166; touch-action: manipulation; }
.ph-more { position: fixed; right: 12px; bottom: 10px; z-index: 95; display: none; width: 42px; height: 42px; padding: 0; border-radius: 50%; border: 2px solid #ffd166; background: rgba(16, 22, 28, .92); color: #ffd166; font: 700 20px system-ui, sans-serif; box-shadow: 0 2px 10px rgba(0, 0, 0, .5); }
.ph-menu .card { padding-bottom: 60px; }
.ph-btn.main { background: #ffd166; color: #222; }
.ph-btn.danger.armed { background: #ff7a5c; border-color: #ff7a5c; color: #222; }
.ph-menu { position: fixed; inset: 0; z-index: 90; display: none; align-items: flex-start; justify-content: center; overflow-y: auto; overscroll-behavior: contain; background: rgba(10, 14, 20, .82); color: #fff; font-family: system-ui, sans-serif; touch-action: pan-y; }
.ph-menu .card { margin: 6px; width: min(96vw, 880px); max-height: none; overflow: visible; box-sizing: border-box; padding: 10px 16px 12px; border-radius: 14px; background: rgba(15, 30, 45, .96); display: grid; grid-template-columns: 1fr 1.1fr; gap: 8px 22px; touch-action: pan-y; }
.ph-menu h2 { grid-column: 1 / -1; font-size: 18px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 3; margin: -10px -16px 0; padding: 10px 16px; background: rgba(15, 30, 45, .99); border-radius: 14px 14px 0 0; }
.ph-menu .ph-title { background: none; border: 0; color: #fff; font: 700 18px system-ui, sans-serif; padding: 8px 4px; min-height: 44px; text-align: left; touch-action: manipulation; }
.ph-menu .col { display: flex; flex-direction: column; gap: 8px; }
.ph-menu label { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 15px; min-height: 40px; }
.ph-menu select { font-size: 15px; padding: 6px 4px; max-width: 56%; }
.ph-menu input[type=checkbox] { width: 22px; height: 22px; }
.ph-menu .left-col .ph-btn, .ph-menu > .card > .col .ph-btn { min-height: 44px; padding: 7px 14px; }
.ph-menu .advbtn { grid-column: 1 / -1; min-height: 40px; padding: 6px 14px; font-size: 14px; }
.ph-menu .adv { grid-column: 1 / -1; display: none; grid-template-columns: 1fr 1.1fr; gap: 8px 22px; padding-top: 4px; border-top: 1px solid rgba(255, 255, 255, .12); }
.ph-menu .adv.open { display: grid; }
.ph-menu .foot { grid-column: 1 / -1; font-size: 11.5px; color: #8ea2b5; line-height: 1.4; }
.ph-menu .foot a { color: #a9c6e2; }
.tc-root.summary .tc-horn, .tc-root.summary .tc-back, .tc-root.summary .tc-speed { display: none; }
`;

const el = (tag, cls, text, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };
// texts that follow the language: tx(node, () => t('key')) sets the text now and again on 'tuktuk-lang'
const LIVE = [];
const tx = (node, fn) => { LIVE.push([node, fn]); node.textContent = fn(); return node; };
addEventListener('tuktuk-lang', () => { for (const [n, f] of LIVE) n.textContent = f(); });

// touch: TouchControls. api: { startGame(), setPaused(bool), resetToRoad(), recenter(), restartTour(), newTour(), freeRide(), hasTour(),
//   startArcade(), isArcade(), cycleTilt(), tiltLabel(), toggleCamera(), camLabel(), toggleMap(), mapOn(), openMap(), openDiagnostics(), applyFov(), applyRes(), toggleStats?(), version, credit }
// pc: the same menu on a PC (Esc): no touch controls, no phone-only rows, no toast and summary buttons (the desktop HUD has its own)
export function createPhoneUi({ touch: touchIn, api, pc = false }) {
  const touch = touchIn || { releaseAll() {}, resetLook() {}, setVisible() {}, setConfig() {}, hooks: {}, root: document.createElement('div') };
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const settings = {
    get steer() { return loadSetting('phone.steer', 'buttons'); }, get gas() { return loadSetting('phone.gas', 'analog'); },
    get fov() { return loadSetting('phone.fov', 100); }, get vibrate() { return loadSetting('phone.vibrate', true) !== false; },
    get lookReturn() { return loadSetting('phone.lookReturn', true) !== false; },
  };
  const ui = { started: false, menuOpen: false };

  // ---------------------------------------------------------------- toast and summary
  const toast = el('div', 'ph-toast', '', document.body);
  const sum = el('div', 'ph-sum', null, document.body);
  const newTourBtn = tx(el('button', 'ph-btn main', '', sum), () => t('ph.newTour')), freeBtn = tx(el('button', 'ph-btn', '', sum), () => t('ph.freeRide'));
  newTourBtn.addEventListener('click', () => api.newTour()); freeBtn.addEventListener('click', () => api.freeRide());
  // a message of the UI itself (e.g. why full screen failed); the game's own messages arrive through update()
  let holdUntil = 0, holdTimer = 0;
  const flashToast = (text, ms) => {
    toast.textContent = text; toast.style.color = '#ffd166'; toast.style.display = 'block';
    holdUntil = performance.now() + ms; clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { if (performance.now() >= holdUntil) toast.style.display = 'none'; }, ms + 50);
  };

  // ---------------------------------------------------------------- settings rows (start screen and menu share the setters)
  const defs = [
    { label: 'set.control', options: () => [['table', t('set.table')], ['vr', t('set.vrNext'), true], ['tilt', t('set.tiltNext'), true]], get: () => 'table', set: () => {} },
    { label: 'set.steer', options: () => [['buttons', t('set.steerButtons')], ['slider', t('set.steerSlider')]], get: () => settings.steer, set: (v) => { saveSetting('phone.steer', v); touch.setConfig({ steer: v }); } },
    { label: 'set.gas', options: () => [['analog', t('set.gasAnalog')], ['full', t('set.gasFull')]], get: () => settings.gas, set: (v) => { saveSetting('phone.gas', v); touch.setConfig({ gas: v }); } },
    { label: 'set.level', options: () => levelOptions(api.levels ? api.levels() : [], api.level ? api.level() : ''), get: () => (api.level ? api.level() : ''), set: (v) => { if (unfoldIfHardRow(v)) return 'refill'; if (api.setLevel) api.setLevel(v); } },
    { label: 'set.autoGas', check: true, get: () => loadSetting('arcade.manualGas', false) !== true, set: (v) => { saveSetting('arcade.manualGas', !v); api.applyAutoGas(); } },
    { label: 'set.sound', check: true, get: () => loadSetting('sound.on', true) !== false, set: (v) => { saveSetting('sound.on', v); api.applySound(); } },
    { label: 'set.music', check: true, get: () => loadSetting('music.on', true) !== false, set: (v) => { saveSetting('music.on', v); api.applySound(); } },
    { label: 'set.fov', options: [[90, '90°'], [100, '100°'], [110, '110°']], get: () => settings.fov, set: (v) => { saveSetting('phone.fov', +v); api.applyFov(); } },
    { label: 'set.res', options: () => [['std', t('set.resStd')], ['high', t('set.resHigh')], ['eco', t('set.resEco')]], get: () => loadSetting('phone.res', 'std'), set: (v) => { saveSetting('phone.res', v); api.applyRes(); } },
    { label: 'set.vibration', check: true, get: () => settings.vibrate, set: (v) => { saveSetting('phone.vibrate', v); touch.setConfig({ vibrate: v }); } },
    { label: 'set.lookReturn', check: true, get: () => settings.lookReturn, set: (v) => { saveSetting('phone.lookReturn', v); touch.setConfig({ lookReturn: v }); } },
  ];
  // the options of a row may be a function (the list of levels changes with the owner's levels)
  const fillOptions = (input, d) => { input.textContent = ''; for (const [v, text, dis] of typeof d.options === 'function' ? d.options() : d.options) { const o = new Option(text, v); o.disabled = !!dis; input.add(o); } };
  const addRow = (parent, d) => {
    const label = el('label', 'ph-only-label', null, parent); tx(label.appendChild(document.createTextNode('')), () => t(d.label));
    let input;
    if (d.check) { input = el('input', null, null, label); input.type = 'checkbox'; input.checked = !!d.get(); input.addEventListener('change', () => d.set(input.checked)); }
    else {
      input = el('select', null, null, label);
      fillOptions(input, d);
      input.value = String(d.get());
      input.addEventListener('change', () => { if (d.set(isNaN(+input.value) ? input.value : +input.value) === 'refill') { fillOptions(input, d); input.value = String(d.get()); if (input.showPicker) { try { input.showPicker(); } catch (e) { /* needs a user gesture: the change event is one, but not everywhere */ } } } });
      if (typeof d.options === 'function') addEventListener('tuktuk-lang', () => { const v = input.value; fillOptions(input, d); input.value = v; });
    }
    return input;
  };

  // "more below" button for a scrolling full-screen layer: shown while there is content below, a tap scrolls on
  function scrollHint(layer, visibleWhen) {
    const b = el('button', 'ph-more', '↓', document.body); b.setAttribute('aria-label', t('ph.more'));
    const update = () => { const more = visibleWhen() && layer.scrollTop + layer.clientHeight < layer.scrollHeight - 10; b.style.display = more ? 'block' : 'none'; };
    layer.addEventListener('scroll', update, { passive: true });
    addEventListener('resize', update);
    b.addEventListener('click', () => layer.scrollBy({ top: Math.max(120, layer.clientHeight * 0.7), behavior: 'smooth' }));
    setInterval(update, 500);   // the layer's content and visibility change without events
    update();
    return update;
  }

  // the title screen (src/ui/titleScreen.js) shows these rows in its Settings drawer
  const settingsDefs = defs;

  // ---------------------------------------------------------------- menu (pause), 0.19.2: the game on top, the technical rows under "Advanced"
  const PC_HIDDEN = new Set(['set.control', 'set.steer', 'set.gas', 'set.fov', 'set.res', 'set.vibration', 'set.lookReturn']);   // phone-only rows
  const BASIC = new Set(['set.level', 'set.sound', 'set.music']);
  const activeDefs = defs.filter((d) => !(pc && PC_HIDDEN.has(d.label)));
  const menu = el('div', 'ph-menu', null, document.body);
  const mcard = el('div', 'card', null, menu);
  // the header stays on screen while the menu scrolls: "Resume" is always reachable; the title is a button too (where the ≡ of the game sits)
  const h2 = el('h2', null, null, mcard);
  const titleBtn = tx(el('button', 'ph-title', '', h2), () => '≡  ' + t('ph.pause')); titleBtn.id = 'menuTitle';
  const close = tx(el('button', 'ph-btn main', '', h2), () => t('ph.resume')); close.id = 'resumeBtn';
  const left = el('div', 'col', null, mcard), right = el('div', 'col', null, mcard);
  const advBtn = el('button', 'ph-btn advbtn', '', mcard); advBtn.id = 'advBtn';
  const adv = el('div', 'adv', null, mcard), advL = el('div', 'col', null, adv), advR = el('div', 'col', null, adv);
  const setAdv = (open) => { adv.classList.toggle('open', open); advBtn.textContent = t(open ? 'ph.advancedClose' : 'ph.advancedOpen'); };
  advBtn.addEventListener('click', () => { setAdv(!adv.classList.contains('open')); if (adv.classList.contains('open')) setTimeout(() => adv.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50); });
  addEventListener('tuktuk-lang', () => setAdv(adv.classList.contains('open'))); setAdv(false);
  const act = (key, fn, parent = left, cls = 'ph-btn') => { const b = tx(el('button', cls, '', parent), () => t(key)); b.addEventListener('click', fn); return b; };
  let armed = 0;
  // the game: restart, map, help, main menu, full screen (the level, sound, music and language rows are on the right)
  const tourBtn = act('ph.restartTour', () => { api.restartTour(); closeMenu(); });
  // stuck? the way back onto the road is here, not under Advanced
  const resetBtn = act('ph.resetRoad', () => {
    if (!armed) { armed = setTimeout(() => { armed = 0; resetBtn.classList.remove('armed'); resetBtn.textContent = t('ph.resetRoad'); }, 3000); resetBtn.classList.add('armed'); resetBtn.textContent = api.hasTour() ? t('ph.resetSureTour') : t('ph.resetSure'); return; }
    clearTimeout(armed); armed = 0; resetBtn.classList.remove('armed'); resetBtn.textContent = t('ph.resetRoad'); api.resetToRoad(); closeMenu();
  }, left, 'ph-btn danger');
  act('ph.map', () => { closeMenu(); api.openMap(); });
  act('ph.help', () => { if (api.openHelp) api.openHelp(); });
  const homeBtn = act('ph.home', () => { closeMenu(); if (api.goHome) api.goHome(); });   // the title screen (0.19.0)
  const rowOf = (parent, d) => addRow(parent, d);
  const rowEls = activeDefs.map((d) => rowOf(BASIC.has(d.label) ? right : (activeDefs.indexOf(d) % 2 ? advR : advL), d));
  { const label = el('label', null, null, right); tx(label.appendChild(document.createTextNode('')), () => t('set.language')); const b = tx(el('button', 'ph-btn', '', label), () => LANGS.find(([id]) => id === getLang())[1]); b.addEventListener('click', () => setLang(otherLang())); }
  act('ph.fullscreen', async () => { const r = await toggleFullscreen(); closeMenu(); if (r && !r.ok) flashToast(hintFor(r), 7000); }, right);
  // Advanced: the camera, tilt and minimap, the auto-gas and phone settings (above), then the actions
  const labelled = (parent, key, valueFn, onClick) => { const label = el('label', null, null, parent); tx(label.appendChild(document.createTextNode('')), () => t(key)); const b = tx(el('button', 'ph-btn', '', label), valueFn); b.addEventListener('click', () => { onClick(); b.textContent = valueFn(); }); return b; };
  const camSel = labelled(advL, 'ph.camera', () => api.camLabel(), () => api.toggleCamera());
  const tiltBtn = labelled(advR, 'ph.cabTilt', () => api.tiltLabel(), () => api.cycleTilt());
  const mapBtn = labelled(advL, 'ph.minimap', () => t(api.mapOn() ? 'ph.yes' : 'ph.no'), () => api.toggleMap());
  act('ph.recenter', () => { touch.resetLook(); closeMenu(); }, advR);
  act('ph.diag', () => { closeMenu(); api.openDiagnostics(); }, advR);
  const installBtn = act('ph.install', () => install(), advL, 'ph-btn'); installBtn.style.display = 'none';
  onInstallChange((can) => { installBtn.style.display = can ? '' : 'none'; });
  const editorBtn = act('ph.editor', () => { closeMenu(); if (api.openEditor) api.openEditor(); }, advR); editorBtn.style.display = 'none';
  const soundBtn = act('ph.sounds', () => { if (api.openSoundLab) api.openSoundLab(); }, advL); soundBtn.style.display = 'none';   // the sound lab: the owner's device only (the menu stays open under it)
  const close2 = tx(el('button', 'ph-btn main', '', adv), () => t('ph.resume')); close2.style.gridColumn = '1 / -1'; close2.id = 'resumeBtn2';   // the same, at the end of the long list
  const foot = el('div', 'foot', null, adv);   // the credits and the version live under Advanced (and on the title screen)
  const footHtml = () => `${api.credit || ''}<br>${t('ph.version', { v: api.version })}`;
  addEventListener('tuktuk-lang', () => { foot.innerHTML = footHtml(); });
  foot.innerHTML = footHtml();

  function openMenu() {
    if (!ui.started || ui.menuOpen) return;
    ui.menuOpen = true; menu.style.display = 'flex'; touch.releaseAll(); api.setPaused(true); setAdv(false); menu.scrollTop = 0;
    camSel.textContent = api.camLabel(); tiltBtn.textContent = api.tiltLabel(); mapBtn.textContent = t(api.mapOn() ? 'ph.yes' : 'ph.no');
    tourBtn.style.display = api.hasTourSpec() ? '' : 'none'; tourBtn.textContent = t(api.isArcade && api.isArcade() ? 'ph.restartRun' : 'ph.restartTour');
    homeBtn.style.display = api.goHome ? '' : 'none';
    activeDefs.forEach((d, i) => { if (!d.check) { if (typeof d.options === 'function') fillOptions(rowEls[i], d); rowEls[i].value = String(d.get()); } else rowEls[i].checked = !!d.get(); });
    foot.innerHTML = footHtml();   // the sound credits arrive after the manifest
    soundBtn.style.display = api.soundLabEnabled && api.soundLabEnabled() ? '' : 'none';
    editorBtn.style.display = api.editorEnabled && api.editorEnabled() ? '' : 'none';
  }
  scrollHint(menu, () => ui.menuOpen);
  function closeMenu() { if (!ui.menuOpen) return; ui.menuOpen = false; menu.style.display = 'none'; api.setPaused(false); }
  close.addEventListener('click', closeMenu); close2.addEventListener('click', closeMenu); titleBtn.addEventListener('click', closeMenu);
  menu.addEventListener('click', (e) => { if (e.target === menu) closeMenu(); });   // a tap on the dimmed outside
  touch.hooks.menu = () => (ui.menuOpen ? closeMenu() : openMenu());
  touch.hooks.camera = () => { api.toggleCamera(); flashToast(t(api.camIsCockpit && api.camIsCockpit() ? 'ph.camCockpit' : 'ph.camChase'), 1200); };
  touch.hooks.map = () => { api.openMap(); };   // the 🗺 button: the full-screen map (the minimap on / off is in the menu)
  touch.hooks.fullscreen = async () => { const r = await toggleFullscreen(); if (r && !r.ok) flashToast(hintFor(r), 7000); };

  async function toggleFullscreen() {
    if (isFullscreen()) { await document.exitFullscreen().catch(() => {}); return { ok: true, why: 'exit' }; }
    const r = await enterFullscreen(); if (r.ok) await lockLandscape(); return r;
  }

  // ---------------------------------------------------------------- start / pause plumbing
  // called from the click on "Грати": full screen and the lock must be requested right here, inside the tap
  function onStart({ gesture = true } = {}) {
    if (pc) { ui.started = true; return; }   // a PC: no full screen request, no back-button trap
    const fs = gesture ? enterFullscreen() : null;   // issued synchronously, awaited below (not without a tap: autostart)
    if (gesture) keepAwake();
    ui.started = true;
    touch.setVisible(true);
    history.pushState({ tuktuk: 1 }, '');
    if (fs) fs.then((r) => { if (r.ok) lockLandscape(); else flashToast(hintFor(r), 9000); });
    api.applyFov();
    if (api.onStarted) api.onStarted();
  }
  // back to the title screen: the controls go, the menu stays shut until the next play
  function onHome() { ui.started = false; closeMenu(); touch.setVisible(false); touch.releaseAll(); }
  addEventListener('popstate', () => { if (pc || !ui.started) return; history.pushState({ tuktuk: 1 }, ''); if (ui.menuOpen) closeMenu(); else openMenu(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') openMenu(); });
  // leaving full screen with the system gesture also pauses (and the screen is smaller then)
  document.addEventListener('fullscreenchange', () => { if (ui.started && !isFullscreen() && !ui.menuOpen) { api.applyFov(); } });

  // ---------------------------------------------------------------- per frame / per 0.2 s
  const sumBtns = (show) => { sum.style.display = show ? 'flex' : 'none'; touch.root.classList.toggle('summary', show); };
  return {
    onStart, onHome, openMenu, closeMenu, flashToast, settingsDefs,
    get started() { return ui.started; }, get menuOpen() { return ui.menuOpen; },
    // 5 Hz from main: message of the moment and the tour state
    update({ msg, msgColor, panel }) {
      if (pc) return;
      if (msg) { toast.textContent = msg; toast.style.color = msgColor || '#ffd166'; toast.style.display = 'block'; holdUntil = 0; }
      else if (toast.style.display === 'block' && performance.now() >= holdUntil) toast.style.display = 'none';
      const summary = !!(panel && panel.mode === 'summary');
      if (sum.style.display !== (summary ? 'flex' : 'none')) sumBtns(summary);
    },
    report() { return screenReport(); },
  };
}
