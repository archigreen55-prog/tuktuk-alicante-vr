// The first-run hint (0.19.2, docs/plan-title-screen.md section 3; the layout of docs/img/mock-first-run-hint-uk.png): shown once per device
// before the countdown of the first Crazy Tuk run. Six cells (steer, gas, brake, handbrake, nitro, gates), the EN | UA switch, a
// "don't show again" box (on by default) and the "Got it ▶" button that starts the countdown. On a phone the pictograms are the
// on-screen buttons; on a PC they are the keys. Never shown in VR. Texts: src/i18n/*.js (hint.*).
import { t, setLang, getLang, LANGS } from '../i18n.js';
import { loadSetting, saveSetting } from '../settings.js';

const SEEN = 'hint.seen';
const CSS = /* css */ `
.fr-layer { position: fixed; inset: 0; z-index: 100; display: none; align-items: center; justify-content: center; background: rgba(6, 10, 16, .55); color: #fff; font-family: system-ui, sans-serif; }
.fr-layer.open { display: flex; }
.fr-card { width: min(94vw, 880px); max-height: 96vh; overflow-y: auto; box-sizing: border-box; padding: 14px 18px 14px; border-radius: 18px; background: rgba(15, 28, 44, .96); box-shadow: 0 10px 40px rgba(0, 0, 0, .5); }
.fr-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.fr-top h2 { margin: 0; font-size: 20px; }
.fr-lang { display: flex; border: 1px solid rgba(255, 255, 255, .55); border-radius: 9px; overflow: hidden; }
.fr-lang button { font: 700 14px system-ui, sans-serif; padding: 6px 12px; min-width: 42px; border: 0; background: transparent; color: #cfe3f5; cursor: pointer; touch-action: manipulation; }
.fr-lang button.on { background: #ffd166; color: #222; }
.fr-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 18px; }
.fr-cell { display: flex; align-items: center; gap: 12px; font: 600 14px/1.25 system-ui, sans-serif; }
.fr-ico { flex: none; min-width: 64px; height: 52px; padding: 0 6px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border: 3px solid #6fe06f; border-radius: 12px; background: rgba(16, 24, 34, .9); color: #ffd166; font: 800 13px system-ui, sans-serif; text-align: center; white-space: nowrap; }
.fr-ico.round { width: 56px; height: 56px; min-width: 56px; border-radius: 50%; border-color: #ff9f43; }
.fr-bottom { display: flex; justify-content: flex-end; align-items: center; gap: 18px; margin-top: 12px; }
.fr-bottom label { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #cfd8e2; }
.fr-bottom input { width: 20px; height: 20px; }
.fr-ok { font: 800 20px system-ui, sans-serif; min-height: 52px; padding: 10px 28px; border: 0; border-radius: 14px; background: #ffd166; color: #222; cursor: pointer; touch-action: manipulation; }
@media (max-height: 460px) and (orientation: landscape) { .fr-card { padding: 8px 14px 10px; } .fr-top h2 { font-size: 17px; } .fr-grid { gap: 6px 14px; } .fr-cell { font-size: 12.5px; gap: 9px; } .fr-ico { height: 44px; min-width: 56px; } .fr-ico.round { width: 48px; height: 48px; min-width: 48px; } .fr-ok { min-height: 44px; font-size: 18px; } .fr-bottom { margin-top: 8px; } }
@media (orientation: portrait) { .fr-grid { grid-template-columns: 1fr 1fr; } }
`;
const el = (tag, cls, text, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };

export function createFirstRun({ isPhone, onDone }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const layer = el('div', 'fr-layer', null, document.body), card = el('div', 'fr-card', null, layer);
  const top = el('div', 'fr-top', null, card), title = el('h2', null, '', top), langBox = el('div', 'fr-lang', null, top);
  const langBtns = LANGS.map(([id, label]) => { const b = el('button', null, label, langBox); b.dataset.lang = id; b.addEventListener('click', () => setLang(id)); return b; });
  const grid = el('div', 'fr-grid', null, card);
  const bottom = el('div', 'fr-bottom', null, card), lab = el('label', null, null, bottom), box = el('input', null, null, lab); box.type = 'checkbox'; box.checked = true;
  const labTxt = el('span', null, '', lab), ok = el('button', 'fr-ok', '', bottom); ok.id = 'firstRunOk';
  let open = false;
  function fill() {
    title.textContent = t('hint.title'); labTxt.textContent = t('hint.dontShow'); ok.textContent = t('hint.ok');
    for (const b of langBtns) b.classList.toggle('on', b.dataset.lang === getLang());
    grid.textContent = '';
    const P = isPhone;   // the pictogram of a cell: the on-screen button (phone) or the key (PC)
    const cells = [
      [P ? '◄ ►' : 'A D', P ? 'hint.steerPhone' : 'hint.steerKey', false],
      [P ? t('tc.gas') : 'W', P ? 'hint.gasPhone' : 'hint.gasKey', false],
      [P ? t('tc.brake') : 'S', 'hint.brake', false],
      [P ? t('tc.hand') : t('hint.space'), 'hint.hand', false],
      [P ? t('tc.nitro') : 'Shift', 'hint.nitro', true],
      ['⛩', 'hint.gate', false],
    ];
    for (const [ico, key, round] of cells) { const c = el('div', 'fr-cell', null, grid); el('div', 'fr-ico' + (round ? ' round' : ''), ico, c); el('div', null, t(key), c); }
  }
  addEventListener('tuktuk-lang', fill); fill();
  ok.addEventListener('click', () => { if (box.checked) saveSetting(SEEN, true); hide(); if (onDone) onDone(); });
  let shownAt = 0;   // the Enter that started the run on the title must not dismiss the hint it has just opened
  addEventListener('keydown', (e) => { if (open && performance.now() - shownAt > 600 && (e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) { e.preventDefault(); ok.click(); } });
  function hide() { open = false; layer.classList.remove('open'); }
  return {
    // true when the hint is due (not seen on this device); ?hint=1 forces it (tests), ?hint=0 never
    due: (params) => (params.get('hint') === '1' ? true : params.get('hint') === '0' ? false : loadSetting(SEEN, false) !== true),
    show() { open = true; shownAt = performance.now(); fill(); layer.classList.add('open'); },
    hide, get isOpen() { return open; },
  };
}
