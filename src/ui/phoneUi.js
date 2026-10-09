// The phone interface of stage F1 (docs/plan-phone.md sections 3, 6): a compact start screen, the HTML HUD
// (the desktop HUD of hud.js, restyled for 915 x 412 px), the pause menu with the settings, the tour summary
// buttons, the message toast, full screen / landscape / wake lock, the Android "back" button as pause.
// Controls themselves are in input/touchControls.js. This module never touches physics: it talks to main.js
// through `api`.
import { loadSetting, saveSetting } from '../settings.js';
import { enterFullscreen, lockLandscape, keepAwake, fullscreenBlocker, hintFor, isFullscreen, canInstall, install, onInstallChange, screenReport } from './screenMode.js';

const CSS = /* css */ `
html.ui-phone { touch-action: manipulation; overscroll-behavior: none; }
html.ui-phone #attr, html.ui-phone #debug, html.ui-phone #vrbutton { display: none !important; }
/* start screen: two columns, no tables of keys */
html.ui-phone #overlay { align-items: flex-start; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; touch-action: pan-y; -webkit-overflow-scrolling: touch; }
html.ui-phone #overlay .card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 4px 20px; align-content: start; width: min(96vw, 880px); max-width: none; margin: 6px auto; padding: 12px 18px; max-height: none; overflow: visible; touch-action: pan-y; }
html.ui-phone #overlay h1 { grid-column: 1; margin: 0; font-size: 22px; }
html.ui-phone #overlay p { grid-column: 1; margin: 2px 0; font-size: 13.5px; line-height: 1.35; }
html.ui-phone #overlay #buttons { grid-column: 1; margin: 6px 0 2px; }
html.ui-phone #overlay #start { font-size: 22px; padding: 14px 40px; }
html.ui-phone #overlay #fsHint { grid-column: 1; font-size: 12.5px; color: #ffb199; margin: 4px 0 0; display: none; }
html.ui-phone #overlay #status { grid-column: 1; font-size: 11px; margin: 4px 0 0; }
html.ui-phone #overlay #version { grid-column: 1; }
html.ui-phone #overlay #settings { grid-column: 2; grid-row: 1 / span 8; margin: 0; gap: 7px; }
html.ui-phone #overlay #settings label { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 14px; }
html.ui-phone #overlay #settings select { font-size: 15px; padding: 6px 4px; margin: 0; max-width: 58%; }
html.ui-phone #overlay #settings input[type=checkbox] { margin: 0 0 0 8px; width: 20px; height: 20px; }
html.ui-phone #overlay .controls { display: none; }
html.ui-phone #overlay .ph-only-label { display: flex; }
html.ui-phone #overlay .ph-note { font-size: 12px; color: #9fb3c8; margin: 0; }
html.ui-phone #overlay .ph-link { background: none; border: 1px solid #ffd166; color: #ffd166; border-radius: 10px; font: 700 14px system-ui, sans-serif; padding: 11px 16px; min-height: 44px; }
/* the desktop HUD, restyled */
html.ui-phone #tourHud { left: 50%; right: auto; top: 6px; transform: translateX(-50%); min-width: 0; width: max-content; max-width: min(44vw, 340px); padding: 5px 10px; font-size: 13px; text-align: center; pointer-events: none; }
html.ui-phone #tourHud .l1 { font-size: 12px; } html.ui-phone #tourHud .l2 { font-size: 16px; } html.ui-phone #tourHud .l3, html.ui-phone #tourHud .l4 { font-size: 13px; }
html.ui-phone #tourCard { left: 50%; bottom: auto; top: 54px; transform: translateX(-50%); width: min(58vw, 540px); max-height: calc(100vh - 150px); overflow-y: auto; font-size: 15px; z-index: 8; background: rgba(10, 14, 20, .88); pointer-events: none; }
html.ui-phone #tourCard.mode-card, html.ui-phone #tourCard.mode-summary { pointer-events: auto; touch-action: pan-y; }
html.ui-phone #tourCard.mode-text { width: min(52vw, 480px); top: 58px; font-size: 14px; padding: 8px 12px; }
html.ui-phone #tourCard .t { font-size: 18px; } html.ui-phone #tourCard .c { font-size: 13px; }
html.ui-phone #miniMap { left: max(10px, env(safe-area-inset-left)); top: 62px; bottom: auto; width: 110px; height: 110px; z-index: 8; pointer-events: auto; transition: width .15s, height .15s; }
/* toast, summary buttons, menu */
.ph-toast { position: fixed; left: 50%; top: 31%; transform: translateX(-50%); z-index: 45; max-width: 60vw; padding: 8px 16px; border-radius: 12px; background: rgba(10, 14, 20, .78); color: #ffd166; font: 700 20px/1.25 system-ui, sans-serif; text-align: center; pointer-events: none; display: none; }
.ph-sum { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 45; display: none; gap: 14px; }
.ph-btn { font: 700 16px system-ui, sans-serif; min-height: 48px; padding: 10px 20px; border-radius: 12px; border: 2px solid #ffd166; background: rgba(16, 22, 28, .9); color: #ffd166; touch-action: manipulation; }
.ph-more { position: fixed; left: 50%; bottom: 8px; transform: translateX(-50%); z-index: 95; display: none; padding: 8px 18px; border-radius: 20px; border: 2px solid #ffd166; background: rgba(16, 22, 28, .92); color: #ffd166; font: 700 15px system-ui, sans-serif; box-shadow: 0 2px 10px rgba(0, 0, 0, .5); }
.ph-btn.main { background: #ffd166; color: #222; }
.ph-btn.danger.armed { background: #ff7a5c; border-color: #ff7a5c; color: #222; }
.ph-menu { position: fixed; inset: 0; z-index: 90; display: none; align-items: flex-start; justify-content: center; overflow-y: auto; overscroll-behavior: contain; background: rgba(10, 14, 20, .82); color: #fff; font-family: system-ui, sans-serif; touch-action: pan-y; }
.ph-menu .card { margin: 6px; width: min(96vw, 880px); max-height: none; overflow: visible; box-sizing: border-box; padding: 10px 16px 12px; border-radius: 14px; background: rgba(15, 30, 45, .96); display: grid; grid-template-columns: 1fr 1.1fr; gap: 8px 22px; touch-action: pan-y; }
.ph-menu h2 { grid-column: 1 / -1; margin: 0; font-size: 18px; display: flex; justify-content: space-between; align-items: center; }
.ph-menu .col { display: flex; flex-direction: column; gap: 8px; }
.ph-menu label { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 15px; min-height: 40px; }
.ph-menu select { font-size: 15px; padding: 6px 4px; max-width: 56%; }
.ph-menu input[type=checkbox] { width: 22px; height: 22px; }
.ph-menu .foot { grid-column: 1 / -1; font-size: 11.5px; color: #8ea2b5; line-height: 1.4; }
.ph-menu .foot a { color: #a9c6e2; }
.tc-root.summary .tc-horn, .tc-root.summary .tc-back, .tc-root.summary .tc-speed { display: none; }
`;

const el = (tag, cls, text, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };

// touch: TouchControls. api: { startGame(), setPaused(bool), resetToRoad(), recenter(), restartTour(), newTour(), freeRide(), hasTour(),
//   startArcade(), isArcade(), cycleTilt(), tiltLabel(), toggleCamera(), camLabel(), toggleMap(), mapOn(), openMap(), openDiagnostics(), applyFov(), applyRes(), toggleStats?(), version, credit }
export function createPhoneUi({ touch, api }) {
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
  const newTourBtn = el('button', 'ph-btn main', 'Новий тур', sum), freeBtn = el('button', 'ph-btn', 'Вільна їзда', sum);
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
    { label: 'Режим керування', options: [['table', 'За столом'], ['vr', 'Як у VR (наступний етап)', true], ['tilt', 'Нахил телефона (наступний етап)', true]], get: () => 'table', set: () => {} },
    { label: 'Кермо', options: [['buttons', 'кнопки ◄ ►'], ['slider', 'повзунок']], get: () => settings.steer, set: (v) => { saveSetting('phone.steer', v); touch.setConfig({ steer: v }); } },
    { label: 'Газ', options: [['analog', 'плавний (чим вище палець)'], ['full', 'повний']], get: () => settings.gas, set: (v) => { saveSetting('phone.gas', v); touch.setConfig({ gas: v }); } },
    { label: 'Рівень Crazy Tuk', options: () => (api.levels ? api.levels() : []), get: () => (api.level ? api.level() : ''), set: (v) => { if (api.setLevel) api.setLevel(v); } },
    { label: 'Автогаз (Crazy Tuk, ≈ 70 км/год)', check: true, get: () => loadSetting('arcade.manualGas', false) !== true, set: (v) => { saveSetting('arcade.manualGas', !v); api.applyAutoGas(); } },
    { label: 'Звук', check: true, get: () => loadSetting('sound.on', true) !== false, set: (v) => { saveSetting('sound.on', v); api.applySound(); } },
    { label: 'Музика', check: true, get: () => loadSetting('music.on', true) !== false, set: (v) => { saveSetting('music.on', v); api.applySound(); } },
    { label: 'Поле зору по горизонталі', options: [[90, '90°'], [100, '100°'], [110, '110°']], get: () => settings.fov, set: (v) => { saveSetting('phone.fov', +v); api.applyFov(); } },
    { label: 'Роздільність картинки', options: [['std', 'стандартна (≈ 0.65 Мп)'], ['high', 'висока (≈ 0.85 Мп)'], ['eco', 'економна (≈ 0.4 Мп)']], get: () => loadSetting('phone.res', 'std'), set: (v) => { saveSetting('phone.res', v); api.applyRes(); } },
    { label: 'Вібрація (удари, нітро)', check: true, get: () => settings.vibrate, set: (v) => { saveSetting('phone.vibrate', v); touch.setConfig({ vibrate: v }); } },
    { label: 'Погляд сам повертається вперед', check: true, get: () => settings.lookReturn, set: (v) => { saveSetting('phone.lookReturn', v); touch.setConfig({ lookReturn: v }); } },
  ];
  // the options of a row may be a function (the list of levels changes with the owner's levels)
  const fillOptions = (input, d) => { input.textContent = ''; for (const [v, text, dis] of typeof d.options === 'function' ? d.options() : d.options) { const o = new Option(text, v); o.disabled = !!dis; input.add(o); } };
  const addRow = (parent, d) => {
    const label = el('label', 'ph-only-label', null, parent); label.append(d.label);
    let input;
    if (d.check) { input = el('input', null, null, label); input.type = 'checkbox'; input.checked = !!d.get(); input.addEventListener('change', () => d.set(input.checked)); }
    else {
      input = el('select', null, null, label);
      fillOptions(input, d);
      input.value = String(d.get());
      input.addEventListener('change', () => d.set(isNaN(+input.value) ? input.value : +input.value));
    }
    return input;
  };

  // "more below" button for a scrolling full-screen layer: shown while there is content below, a tap scrolls on
  function scrollHint(layer, visibleWhen) {
    const b = el('button', 'ph-more', '↓ ще налаштування', document.body);
    const update = () => { const more = visibleWhen() && layer.scrollTop + layer.clientHeight < layer.scrollHeight - 10; b.style.display = more ? 'block' : 'none'; };
    layer.addEventListener('scroll', update, { passive: true });
    addEventListener('resize', update);
    b.addEventListener('click', () => layer.scrollBy({ top: Math.max(120, layer.clientHeight * 0.7), behavior: 'smooth' }));
    setInterval(update, 500);   // the layer's content and visibility change without events
    update();
    return update;
  }

  // ---------------------------------------------------------------- start screen
  const $ = (id) => document.getElementById(id);
  function adaptStartScreen() {
    const card = document.querySelector('#overlay .card'); if (!card) return;
    const p = card.querySelector('p'); if (p) p.textContent = 'Два режими: «Справжній тур» — спокійно, із зупинками, фото й фактами, чайові за плавність; «Crazy Tuk» — 60–150 км/год крізь усі точки маршруту, чайові за швидкість. Керування — кнопками на екрані.';
    for (const id of ['steering', 'vignette', 'vibration', 'manualGasRow', 'soundRow', 'musicRow']) { const l = $(id) && $(id).closest('label'); if (l) l.style.display = 'none'; }
    const tiltLabel = $('tilt') && $('tilt').closest('label'); if (tiltLabel && tiltLabel.firstChild) tiltLabel.firstChild.textContent = 'Нахил кабіни на підйомах';
    const settingsEl = $('settings');
    for (const d of defs) addRow(settingsEl, d);
    scrollHint($('overlay'), () => getComputedStyle($('overlay')).display !== 'none');
    const note = el('p', 'ph-note', 'Інші режими керування (як у VR, нахил) — наступним етапом.', settingsEl);
    note.style.gridColumn = 'auto';
    const hint = el('div', null, '', null); hint.id = 'fsHint'; $('buttons').after(hint);
    const inst = el('button', 'ph-link', 'Встановити як застосунок', $('buttons')); inst.style.display = 'none'; inst.id = 'installBtn';
    inst.addEventListener('click', () => install());
    onInstallChange((can) => { inst.style.display = can ? '' : 'none'; });
    if (canInstall()) inst.style.display = '';
    const blocker = fullscreenBlocker();
    if (blocker) { hint.style.display = 'block'; hint.textContent = `Повний екран тут недоступний: ${blocker}. Відкрий гру в самому Chrome (⋮ → «Відкрити в Chrome») або додай на головний екран (⋮ → «Додати на головний екран» / «Встановити застосунок»).`; }
  }

  // ---------------------------------------------------------------- menu (pause)
  const menu = el('div', 'ph-menu', null, document.body);
  const mcard = el('div', 'card', null, menu);
  const h2 = el('h2', null, 'Пауза', mcard);
  const close = el('button', 'ph-btn main', 'Продовжити ▶', h2);
  const left = el('div', 'col', null, mcard), right = el('div', 'col', null, mcard);
  const act = (text, fn, parent = left, cls = 'ph-btn') => { const b = el('button', cls, text, parent); b.addEventListener('click', fn); return b; };
  let armed = 0;
  act('Карта на весь екран', () => { closeMenu(); api.openMap(); });
  const resetBtn = act('Повернути на дорогу', () => {
    if (!armed) { armed = setTimeout(() => { armed = 0; resetBtn.classList.remove('armed'); resetBtn.textContent = 'Повернути на дорогу'; }, 3000); resetBtn.classList.add('armed'); resetBtn.textContent = api.hasTour() ? 'Точно? У турі −10 до настрою' : 'Точно? Натисни ще раз'; return; }
    clearTimeout(armed); armed = 0; resetBtn.classList.remove('armed'); resetBtn.textContent = 'Повернути на дорогу'; api.resetToRoad(); closeMenu();
  }, left, 'ph-btn danger');
  act('Перецентрувати погляд', () => { touch.resetLook(); closeMenu(); });
  const tourBtn = act('Почати тур заново', () => { api.restartTour(); closeMenu(); });
  const arcadeBtn = act('Crazy Tuk', () => { api.startArcade(); closeMenu(); });
  act('Вільна їзда', () => { api.freeRide(); closeMenu(); });
  const editorBtn = act('Редактор рівнів', () => { closeMenu(); if (api.openEditor) api.openEditor(); }); editorBtn.style.display = 'none';
  const soundBtn = act('Звуки', () => { if (api.openSoundLab) api.openSoundLab(); }); soundBtn.style.display = 'none';   // the sound lab: the owner's device only (the menu stays open under it)
  act('Діагностика і звіт', () => { closeMenu(); api.openDiagnostics(); });
  act('На весь екран ⛶', async () => { const r = await toggleFullscreen(); closeMenu(); if (r && !r.ok) flashToast(hintFor(r), 7000); });
  const installBtn = act('Встановити як застосунок', () => install(), left, 'ph-btn'); installBtn.style.display = 'none';
  onInstallChange((can) => { installBtn.style.display = can ? '' : 'none'; });
  const rowEls = defs.map((d) => addRow(right, d));
  const camSel = (() => { const label = el('label', null, null, right); label.append('Камера'); const b = el('button', 'ph-btn', api.camLabel(), label); b.addEventListener('click', () => { api.toggleCamera(); b.textContent = api.camLabel(); }); return b; })();
  const tiltBtn = (() => { const label = el('label', null, null, right); label.append('Нахил кабіни'); const b = el('button', 'ph-btn', api.tiltLabel(), label); b.addEventListener('click', () => { api.cycleTilt(); b.textContent = api.tiltLabel(); }); return b; })();
  const mapBtn = (() => { const label = el('label', null, null, right); label.append('Мінікарта'); const b = el('button', 'ph-btn', api.mapOn() ? 'так' : 'ні', label); b.addEventListener('click', () => { api.toggleMap(); b.textContent = api.mapOn() ? 'так' : 'ні'; }); return b; })();
  const foot = el('div', 'foot', null, mcard);
  const footHtml = () => `${api.credit || ''}<br>версія ${api.version}`;
  foot.innerHTML = footHtml();

  function openMenu() {
    if (!ui.started || ui.menuOpen) return;
    ui.menuOpen = true; menu.style.display = 'flex'; touch.releaseAll(); api.setPaused(true);
    camSel.textContent = api.camLabel(); tiltBtn.textContent = api.tiltLabel(); mapBtn.textContent = api.mapOn() ? 'так' : 'ні';
    tourBtn.style.display = api.hasTourSpec() ? '' : 'none'; tourBtn.textContent = api.isArcade && api.isArcade() ? 'Забіг заново' : 'Почати тур заново';
    arcadeBtn.style.display = api.hasTourSpec() && !(api.isArcade && api.isArcade()) ? '' : 'none';
    defs.forEach((d, i) => { if (!d.check) { if (typeof d.options === 'function') fillOptions(rowEls[i], d); rowEls[i].value = String(d.get()); } else rowEls[i].checked = !!d.get(); });
    foot.innerHTML = footHtml();   // the sound credits arrive after the manifest
    soundBtn.style.display = api.soundLabEnabled && api.soundLabEnabled() ? '' : 'none';
    editorBtn.style.display = api.editorEnabled && api.editorEnabled() ? '' : 'none';
  }
  scrollHint(menu, () => ui.menuOpen);
  function closeMenu() { if (!ui.menuOpen) return; ui.menuOpen = false; menu.style.display = 'none'; api.setPaused(false); }
  close.addEventListener('click', closeMenu);
  touch.hooks.menu = () => (ui.menuOpen ? closeMenu() : openMenu());
  touch.hooks.camera = () => { api.toggleCamera(); flashToast(api.camLabel() === 'кабіна' ? 'Камера: кабіна' : 'Камера: ззаду', 1200); };
  touch.hooks.map = () => { api.openMap(); };   // the 🗺 button: the full-screen map (the minimap on / off is in the menu)
  touch.hooks.fullscreen = async () => { const r = await toggleFullscreen(); if (r && !r.ok) flashToast(hintFor(r), 7000); };

  async function toggleFullscreen() {
    if (isFullscreen()) { await document.exitFullscreen().catch(() => {}); return { ok: true, why: 'вихід' }; }
    const r = await enterFullscreen(); if (r.ok) await lockLandscape(); return r;
  }

  // ---------------------------------------------------------------- start / pause plumbing
  // called from the click on "Грати": full screen and the lock must be requested right here, inside the tap
  function onStart({ gesture = true } = {}) {
    const fs = gesture ? enterFullscreen() : null;   // issued synchronously, awaited below (not without a tap: autostart)
    if (gesture) keepAwake();
    ui.started = true;
    touch.setVisible(true);
    history.pushState({ tuktuk: 1 }, '');
    if (fs) fs.then((r) => { if (r.ok) lockLandscape(); else flashToast(hintFor(r), 9000); });
    api.applyFov();
    if (api.onStarted) api.onStarted();
  }
  addEventListener('popstate', () => { if (!ui.started) return; history.pushState({ tuktuk: 1 }, ''); if (ui.menuOpen) closeMenu(); else openMenu(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') openMenu(); });
  // leaving full screen with the system gesture also pauses (and the screen is smaller then)
  document.addEventListener('fullscreenchange', () => { if (ui.started && !isFullscreen() && !ui.menuOpen) { api.applyFov(); } });

  // ---------------------------------------------------------------- per frame / per 0.2 s
  const sumBtns = (show) => { sum.style.display = show ? 'flex' : 'none'; touch.root.classList.toggle('summary', show); };
  return {
    onStart, adaptStartScreen, openMenu, closeMenu, flashToast,
    get started() { return ui.started; }, get menuOpen() { return ui.menuOpen; },
    // 5 Hz from main: message of the moment and the tour state
    update({ msg, msgColor, panel }) {
      if (msg) { toast.textContent = msg; toast.style.color = msgColor || '#ffd166'; toast.style.display = 'block'; holdUntil = 0; }
      else if (toast.style.display === 'block' && performance.now() >= holdUntil) toast.style.display = 'none';
      const summary = !!(panel && panel.mode === 'summary');
      if (sum.style.display !== (summary ? 'flex' : 'none')) sumBtns(summary);
    },
    report() { return screenReport(); },
  };
}
