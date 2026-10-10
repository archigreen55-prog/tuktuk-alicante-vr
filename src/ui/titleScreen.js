// The title screen and the loading screen (0.19.0, docs/plan-title-screen.md sections 1–2; the layout follows the mock-ups
// docs/img/mock-title-landscape-en.png and mock-title-portrait-uk.png). One layer (#overlay) in two states: 'loading' (logo, progress bar,
// a rotating tip) and 'menu' (the big Crazy Tuk button with the level line under it, Real tour and Free ride at its side, the record
// pill, EN | UA, Settings, Help). The background: a static picture (assets/title-bg.jpg) until the city is built, then the live 3D city
// behind a translucent shade (main.js places the camera while the screen is open). Portrait on a phone: one column, the big button full
// width, the two others side by side, a dashed card asking to turn the phone (the game itself needs landscape: phone.onStart asks for it).
// api: { play(mode, e), levels() -> [[id, name]], level(), setLevel(id), tours() -> [[id, name]], tour(), setTour(id), best() -> string,
//        settingsDefs -> [{ label (key), options|check, get, set }], credit (html, the full credits), version, vrButton?, hasTour() }
import { t, getLang, setLang, LANGS } from '../i18n.js';
import { HELP } from './help.js';

const CSS = /* css */ `
#overlay.ts { position: fixed; inset: 0; z-index: 10; display: flex; flex-direction: column; color: #fff; font-family: system-ui, sans-serif; overflow: hidden; background: #10161c; user-select: none; }
#overlay.ts .ts-bg { position: absolute; inset: 0; background: #1b2a38 url(assets/title-bg.jpg) center / cover no-repeat; transition: opacity .8s; }
#overlay.ts.live { background: transparent; } #overlay.ts.live .ts-bg { opacity: 0; }
#overlay.ts .ts-shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10, 16, 24, .45) 0%, rgba(10, 16, 24, .12) 40%, rgba(10, 16, 24, .55) 100%); }
#overlay.ts .ts-top { position: absolute; left: 0; right: 0; top: 0; display: flex; justify-content: space-between; align-items: center; padding: 10px 14px 0; font-size: 12px; z-index: 1; }
#overlay.ts .ts-ver { opacity: .75; text-shadow: 0 1px 3px #000; }
#overlay.ts .ts-lang { display: flex; border: 1px solid rgba(255, 255, 255, .55); border-radius: 9px; overflow: hidden; background: rgba(16, 22, 28, .45); }
#overlay.ts .ts-lang button { font: 700 14px system-ui, sans-serif; padding: 6px 12px; min-width: 42px; min-height: 30px; border: 0; background: transparent; color: #cfe3f5; cursor: pointer; touch-action: manipulation; }
#overlay.ts .ts-lang button.on { background: #ffd166; color: #222; }
#overlay.ts .ts-mid { position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 36px 16px 30px; min-height: 0; }
#overlay.ts .ts-logo { text-align: center; line-height: 1; animation: ts-in .45s ease-out; }
#overlay.ts .ts-name { font-size: 56px; font-weight: 900; letter-spacing: .01em; color: #ffd166; text-shadow: 0 3px 0 #9a6400, 0 7px 18px rgba(0, 0, 0, .6); }
#overlay.ts .ts-sub { margin-top: 6px; font-size: 24px; font-weight: 800; letter-spacing: .35em; text-indent: .35em; color: #fff; text-shadow: 0 2px 6px rgba(0, 0, 0, .8); }
#overlay.ts .ts-tag { margin-top: 8px; font-size: 14px; font-weight: 600; color: #e3edf7; text-shadow: 0 1px 6px rgba(0, 0, 0, .9); }
@keyframes ts-in { from { transform: scale(.92); opacity: 0; } to { transform: none; opacity: 1; } }
/* loading */
#overlay.ts .ts-load { width: min(520px, 90vw); text-align: center; }
#overlay.ts .ts-bar { height: 10px; border-radius: 6px; background: rgba(255, 255, 255, .18); overflow: hidden; }
#overlay.ts .ts-fill { height: 100%; width: 0; border-radius: 6px; background: #ffd166; transition: width .35s ease-out, background .3s; }
#overlay.ts .ts-fill.done { background: #6fe06f; }
#overlay.ts .ts-stage { margin-top: 6px; font-size: 13px; color: #e6eef5; text-shadow: 0 1px 4px #000; }
#overlay.ts .ts-tip { margin-top: 8px; font-size: 13px; line-height: 1.35; color: #ffe9b3; min-height: 2.7em; text-shadow: 0 1px 4px #000; }
#overlay.ts .ts-tip b { color: #ffd166; }
/* menu: the big button (with the level line under it) and the two side buttons */
#overlay.ts .ts-menu { display: flex; flex-direction: column; align-items: center; gap: 8px; }
#overlay.ts .ts-row { display: flex; align-items: flex-start; gap: 14px; }
#overlay.ts .ts-main { display: flex; flex-direction: column; align-items: center; gap: 4px; }
#overlay.ts .ts-big { width: 250px; min-height: 112px; padding: 10px 16px; border: 0; border-radius: 18px; background: linear-gradient(180deg, #ffd86b, #f9bf2a); color: #222; font: 900 26px/1.1 system-ui, sans-serif; cursor: pointer; touch-action: manipulation; box-shadow: 0 5px 0 #b8841a, 0 10px 22px rgba(0, 0, 0, .45); animation: ts-pulse 2s ease-in-out infinite; }
#overlay.ts .ts-big small { display: block; font: 600 13px/1.2 system-ui, sans-serif; margin-top: 5px; color: #4a3a10; }
#overlay.ts .ts-big:disabled { opacity: .45; cursor: default; animation: none; }
@keyframes ts-pulse { 0%, 100% { box-shadow: 0 5px 0 #b8841a, 0 10px 22px rgba(0, 0, 0, .45); } 50% { box-shadow: 0 5px 0 #b8841a, 0 10px 30px rgba(255, 209, 102, .6); } }
#overlay.ts .ts-level { position: relative; display: inline-flex; align-items: center; gap: 4px; font: 600 13px system-ui, sans-serif; color: #e3edf7; text-shadow: 0 1px 4px #000; padding: 2px 6px; }
#overlay.ts .ts-level select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; font-size: 16px; }
#overlay.ts .ts-side { display: flex; flex-direction: column; gap: 10px; width: 170px; }
#overlay.ts .ts-mid-btn { min-height: 51px; padding: 6px 12px; border: 2px solid rgba(255, 255, 255, .55); border-radius: 14px; background: rgba(16, 22, 28, .55); color: #fff; font: 700 16px/1.15 system-ui, sans-serif; text-align: left; cursor: pointer; touch-action: manipulation; }
#overlay.ts .ts-mid-btn small { display: block; font: 500 12px/1.2 system-ui, sans-serif; color: #d6e2ee; margin-top: 2px; }
#overlay.ts .ts-mid-btn:disabled { opacity: .45; cursor: default; }
#overlay.ts .ts-best { margin-top: 4px; padding: 6px 16px; border-radius: 20px; background: rgba(10, 14, 20, .72); font: 700 14px/1.3 system-ui, sans-serif; color: #ffd166; text-align: center; }
#overlay.ts .ts-bottom { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; padding: 4px 14px 9px; font-size: 12px; color: #e3edf7; text-shadow: 0 1px 3px #000; z-index: 1; }
#overlay.ts .ts-credits { line-height: 1.3; } #overlay.ts .ts-credits button { color: #ffd166; background: none; border: 0; padding: 0; font: inherit; cursor: pointer; text-decoration: underline; text-shadow: inherit; }
#overlay.ts .ts-small { display: flex; gap: 14px; align-items: center; white-space: nowrap; }
#overlay.ts .ts-small button { font: 600 13px system-ui, sans-serif; padding: 6px 4px; min-height: 32px; border: 0; background: none; color: #e3edf7; text-shadow: 0 1px 3px #000; cursor: pointer; touch-action: manipulation; }
#overlay.ts #vrbutton { position: static !important; width: auto !important; left: auto !important; bottom: auto !important; margin: 0 !important; font: 700 13px system-ui, sans-serif !important; padding: 6px 12px !important; border-radius: 10px !important; border: 1px solid rgba(255, 209, 102, .7) !important; color: #ffd166 !important; background: rgba(16, 22, 28, .6) !important; opacity: 1 !important; }
html.ui-phone #overlay.ts #vrbutton { display: none !important; }
#overlay.ts .ts-rotate { display: none; }
/* drawers: settings, help, credits */
#overlay.ts .ts-drawer { position: absolute; inset: 0; z-index: 2; display: none; align-items: flex-start; justify-content: center; overflow-y: auto; overscroll-behavior: contain; background: rgba(10, 14, 20, .85); touch-action: pan-y; }
#overlay.ts .ts-drawer.open { display: flex; }
#overlay.ts .ts-drawer .card { margin: 8px; width: min(96vw, 820px); box-sizing: border-box; padding: 10px 16px 14px; border-radius: 14px; background: rgba(15, 30, 45, .97); }
#overlay.ts .ts-drawer h2 { margin: 0 0 8px; font-size: 18px; display: flex; justify-content: space-between; align-items: center; }
#overlay.ts .ts-drawer h2 button { font: 700 14px system-ui, sans-serif; min-height: 40px; padding: 6px 16px; border-radius: 10px; border: 0; background: #ffd166; color: #222; cursor: pointer; touch-action: manipulation; }
#overlay.ts .ts-rows { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 22px; }
#overlay.ts .ts-rows label { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 14px; min-height: 36px; }
#overlay.ts .ts-rows select { font-size: 14px; padding: 5px 4px; max-width: 56%; } #overlay.ts .ts-rows input[type=checkbox] { width: 20px; height: 20px; }
#overlay.ts .ts-help { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
#overlay.ts .ts-help h3 { margin: 8px 0 2px; font-size: 15px; color: #cfe3f5; }
#overlay.ts .ts-help table { border-collapse: collapse; font-size: 12.5px; width: 100%; }
#overlay.ts .ts-help td { padding: 2px 8px 2px 0; vertical-align: top; } #overlay.ts .ts-help td:first-child { color: #ffd166; white-space: nowrap; font-weight: 600; }
#overlay.ts .ts-creditsFull { font-size: 13px; line-height: 1.5; color: #cfe3f5; } #overlay.ts .ts-creditsFull a { color: #ffd166; }
/* PC and tablets: everything a notch larger */
@media (min-width: 1000px) and (min-height: 600px) {
  #overlay.ts .ts-name { font-size: 76px; } #overlay.ts .ts-sub { font-size: 30px; } #overlay.ts .ts-tag { font-size: 17px; }
  #overlay.ts .ts-mid { gap: 18px; }
  #overlay.ts .ts-big { width: 320px; min-height: 140px; font-size: 32px; } #overlay.ts .ts-big small { font-size: 15px; }
  #overlay.ts .ts-side { width: 220px; } #overlay.ts .ts-mid-btn { min-height: 64px; font-size: 19px; } #overlay.ts .ts-mid-btn small { font-size: 13px; }
  #overlay.ts .ts-level { font-size: 15px; } #overlay.ts .ts-best { font-size: 16px; padding: 8px 20px; }
  #overlay.ts .ts-bottom { font-size: 14px; padding: 4px 20px 12px; } #overlay.ts .ts-small button { font-size: 15px; }
  #overlay.ts .ts-top { padding: 14px 20px 0; font-size: 14px; }
}
/* portrait: one column (the mock-up docs/img/mock-title-portrait-uk.png) */
@media (orientation: portrait) {
  #overlay.ts .ts-mid { justify-content: flex-start; padding: 70px 24px 76px; gap: 14px; }
  #overlay.ts .ts-name { font-size: 46px; } #overlay.ts .ts-sub { font-size: 22px; } #overlay.ts .ts-tag { font-size: 13px; }
  #overlay.ts .ts-menu { width: 100%; gap: 12px; flex: 1; align-self: stretch; }
  #overlay.ts .ts-row { flex-direction: column; width: 100%; gap: 12px; }
  #overlay.ts .ts-main { width: 100%; } #overlay.ts .ts-big { width: 100%; min-height: 88px; }
  #overlay.ts .ts-side { flex-direction: row; width: 100%; gap: 12px; } #overlay.ts .ts-mid-btn { flex: 1; min-height: 76px; }
  #overlay.ts .ts-best { width: 100%; box-sizing: border-box; padding: 10px 16px; font-size: 15px; }
  #overlay.ts .ts-rotate { display: block; margin-top: auto; width: 100%; box-sizing: border-box; padding: 14px 16px; border: 2px dashed rgba(255, 255, 255, .7); border-radius: 16px; background: rgba(16, 22, 28, .45); font: 700 15px/1.3 system-ui, sans-serif; color: #fff; text-align: center; text-shadow: 0 1px 4px #000; }
  #overlay.ts .ts-bottom { align-items: flex-start; } #overlay.ts .ts-credits { max-width: 62%; } #overlay.ts .ts-small { flex-direction: column; align-items: flex-end; gap: 2px; white-space: normal; }
  #overlay.ts .ts-rows, #overlay.ts .ts-help { grid-template-columns: 1fr; }
}
`;

const TIPS = 8;
const el = (tag, cls, text, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };

export function createTitleScreen({ root, api, isPhone }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  root.className = 'ts'; root.textContent = '';
  const ui = { state: 'loading', open: true, progress: 0, tip: Math.floor(Math.random() * TIPS), onOpen: null, onClose: null, onLang: null };

  el('div', 'ts-bg', null, root); el('div', 'ts-shade', null, root);
  const top = el('div', 'ts-top', null, root);
  el('span', 'ts-ver', `v${api.version}`, top);
  const langBox = el('div', 'ts-lang', null, top);
  const langBtns = LANGS.map(([id, label]) => { const b = el('button', null, label, langBox); b.dataset.lang = id; b.addEventListener('click', () => { setLang(id); }); return b; });
  const mid = el('div', 'ts-mid', null, root);
  const logo = el('div', 'ts-logo', null, mid);
  const name = el('div', 'ts-name', '', logo);
  const sub = el('div', 'ts-sub', '', logo); const tag = el('div', 'ts-tag', '', logo);
  // loading
  const load = el('div', 'ts-load', null, mid);
  const bar = el('div', 'ts-bar', null, load); const fill = el('div', 'ts-fill', null, bar);
  const stage = el('div', 'ts-stage', '', load); const tip = el('div', 'ts-tip', '', load);
  // menu
  const menu = el('div', 'ts-menu', null, mid); menu.style.display = 'none';
  const row = el('div', 'ts-row', null, menu);
  const main = el('div', 'ts-main', null, row);
  const big = el('button', 'ts-big', null, main); big.id = 'start';
  const bigTxt = el('span', null, '', big); const bigSub = el('small', null, '', big);
  big.addEventListener('click', (e) => api.play('arcade', e));
  // the level line under the big button: the text shows the level, an invisible select over it opens the list on a tap
  const level = el('label', 'ts-level', null, main); const levelTxt = el('span', null, '', level); el('span', null, '▾', level);
  const levelSel = el('select', null, null, level); levelSel.id = 'levelSel';
  levelSel.addEventListener('change', () => { api.setLevel(levelSel.value); fillPickers(); refreshBest(); });
  const side = el('div', 'ts-side', null, row);
  const tourBtn = el('button', 'ts-mid-btn', null, side); tourBtn.id = 'tourBtn'; const tourTxt = el('span', null, '', tourBtn); const tourSub = el('small', null, '', tourBtn);
  tourBtn.addEventListener('click', (e) => api.play('tour', e));
  const freeBtn = el('button', 'ts-mid-btn', null, side); freeBtn.id = 'freeBtn'; const freeTxt = el('span', null, '', freeBtn); const freeSub = el('small', null, '', freeBtn);
  freeBtn.addEventListener('click', (e) => api.play('free', e));
  const best = el('div', 'ts-best', '', menu); best.id = 'best';
  const rotate = el('div', 'ts-rotate', '', menu);
  // bottom bar: the short credits (the full list in a drawer), Settings, Help, the VR button
  const bottom = el('div', 'ts-bottom', null, root);
  const credits = el('div', 'ts-credits', null, bottom);
  const small = el('div', 'ts-small', null, bottom);
  const setBtn = el('button', null, '', small); setBtn.id = 'settingsBtn'; setBtn.addEventListener('click', () => openDrawer(settings));
  const helpBtn = el('button', null, '', small); helpBtn.id = 'helpBtn'; helpBtn.addEventListener('click', () => openDrawer(help));
  // drawers
  const drawer = () => { const d = el('div', 'ts-drawer', null, root); const card = el('div', 'card', null, d); const h = el('h2', null, null, card); const title = el('span', null, '', h); const close = el('button', null, '✕', h); close.addEventListener('click', () => closeDrawers()); d.addEventListener('click', (e) => { if (e.target === d) closeDrawers(); }); return { d, card, title }; };
  const S = drawer(); const settings = S.d; const setTitle = S.title; const rows = el('div', 'ts-rows', null, S.card);
  const H = drawer(); const help = H.d; const helpTitle = H.title; const helpBody = el('div', 'ts-help', null, H.card);
  const C = drawer(); const creditsDrawer = C.d; const creditsTitle = C.title; const creditsFull = el('div', 'ts-creditsFull', null, C.card);
  function openDrawer(d) { closeDrawers(); d.classList.add('open'); if (d === settings) fillSettings(); if (d === creditsDrawer) creditsFull.innerHTML = api.credit || ''; }
  function closeDrawers() { for (const d of [settings, help, creditsDrawer]) d.classList.remove('open'); }
  // the settings rows: the same shape as the phone menu's (label = a dictionary key; options may be a function of the language)
  const fillOptions = (input, d) => { input.textContent = ''; for (const [v, text, dis] of typeof d.options === 'function' ? d.options() : d.options) { const o = new Option(text, v); o.disabled = !!dis; input.add(o); } };
  const tourDef = { label: 'set.tour', options: () => (api.tours ? api.tours() : []), get: () => (api.tour ? api.tour() : ''), set: (v) => { api.setTour(v); refreshBest(); } };
  function fillSettings() {
    rows.textContent = '';
    const defs = [...(api.hasTour && api.hasTour() && api.tours && api.tours().length > 1 ? [tourDef] : []), ...(api.settingsDefs || [])];
    for (const d of defs) {
      const label = el('label', null, null, rows); label.append(t(d.label));
      if (d.check) { const input = el('input', null, null, label); input.type = 'checkbox'; input.checked = !!d.get(); input.addEventListener('change', () => d.set(input.checked)); }
      else { const input = el('select', null, null, label); fillOptions(input, d); input.value = String(d.get()); input.addEventListener('change', () => { d.set(isNaN(+input.value) ? input.value : +input.value); }); }
    }
  }
  function fillHelp() {
    helpBody.textContent = '';
    const HL = HELP[getLang()] || HELP.en;
    for (const k of isPhone ? ['phone', 'kb', 'quest'] : ['kb', 'quest', 'phone']) {
      const [title, lines] = HL[k];
      const box = el('div', null, null, helpBody); el('h3', null, title, box);
      const table = el('table', null, null, box);
      for (const [a, b] of lines) { const tr = el('tr', null, null, table); el('td', null, a, tr); el('td', null, b, tr); }
    }
  }
  function fillPickers() {
    if (api.vrButton && api.vrButton.parentNode !== small) small.prepend(api.vrButton);   // the three.js VR button (it exists after the renderer)
    const lv = api.levels(); levelSel.textContent = ''; for (const [id, nm] of lv) levelSel.add(new Option(nm, id)); levelSel.value = api.level() || '';
    levelTxt.textContent = (lv.find(([id]) => id === levelSel.value) || [, ''])[1];
    const has = api.hasTour ? api.hasTour() : true; tourBtn.disabled = !has; big.disabled = !has; level.style.display = has ? '' : 'none';
  }
  function refreshBest() { best.textContent = api.best ? api.best() : ''; }
  function relabel() {
    name.textContent = t('title.crazy'); sub.textContent = t('title.sub'); tag.textContent = t('title.tag');
    bigTxt.textContent = '🛺 ' + t('title.crazy'); bigSub.textContent = t('title.crazySub');
    tourTxt.textContent = '🏛 ' + t('title.tour'); tourSub.textContent = t('title.tourSub');
    freeTxt.textContent = '🌴 ' + t('title.free'); freeSub.textContent = t('title.freeSub');
    rotate.textContent = t('title.rotate');
    setBtn.textContent = t('title.settings'); helpBtn.textContent = t('title.help');
    setTitle.textContent = t('title.settings').replace(' ⚙', ''); helpTitle.textContent = t('ph.help'); creditsTitle.textContent = t('title.creditsTitle');
    credits.textContent = ''; credits.append('© OpenStreetMap contributors · © IGN · ');
    const link = el('button', null, t('title.creditsLink'), credits); link.id = 'creditsBtn'; link.addEventListener('click', () => openDrawer(creditsDrawer));
    for (const b of langBtns) b.classList.toggle('on', b.dataset.lang === getLang());
    fillPickers(); refreshBest(); fillHelp(); if (settings.classList.contains('open')) fillSettings();
    showTip();
  }
  function showTip() { tip.innerHTML = t(`tip.${(ui.tip % TIPS) + 1}`); }
  addEventListener('tuktuk-lang', () => { relabel(); if (ui.onLang) ui.onLang(); });
  relabel();

  // the loading progress: never backwards; the text is the stage, the number the share done
  function setProgress(frac, text) {
    if (frac != null) ui.progress = Math.max(ui.progress, Math.min(1, frac));
    fill.style.width = `${Math.round(ui.progress * 100)}%`;
    if (text != null) stage.textContent = `${text} ${Math.round(ui.progress * 100)} %`;
  }
  const tipInterval = setInterval(() => { if (ui.state !== 'loading') return; ui.tip++; showTip(); }, 3500);
  function ready() {
    if (ui.state !== 'loading') return;
    setProgress(1, t('st.ready')); fill.classList.add('done');
    setTimeout(() => { ui.state = 'menu'; clearInterval(tipInterval); load.style.display = 'none'; menu.style.display = ''; fillPickers(); refreshBest(); }, 300);
  }
  function show(open) {
    if (ui.open === open) return;
    ui.open = open; root.style.display = open ? 'flex' : 'none'; closeDrawers();
    if (open) { fillPickers(); refreshBest(); if (ui.onOpen) ui.onOpen(); } else if (ui.onClose) ui.onClose();
  }
  // Enter on the title: Crazy Tuk (PC); Esc closes a drawer
  addEventListener('keydown', (e) => {
    if (!ui.open || ui.state !== 'menu' || e.repeat || (e.target && /^(input|select|textarea)$/i.test(e.target.tagName))) return;
    if (e.code === 'Enter' && !big.disabled) { e.preventDefault(); api.play('arcade', e); }
    else if (e.code === 'Escape') closeDrawers();
  });

  return {
    setProgress, ready, show, refresh: () => { fillPickers(); refreshBest(); }, relabel,
    openHelp: () => { show(true); openDrawer(help); },
    setLive: (live) => root.classList.toggle('live', !!live),
    get isOpen() { return ui.open; }, get state() { return ui.state; },
    set onOpen(f) { ui.onOpen = f; }, set onClose(f) { ui.onClose = f; }, set onLang(f) { ui.onLang = f; },
    levelSel,
  };
}
