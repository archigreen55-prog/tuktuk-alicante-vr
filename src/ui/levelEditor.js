// The level editor (0.17.0): works on the full-screen map (src/ui/fullMap.js openEditor). Reachable only for the owner: see src/game/editorAccess.js.
// Left column: the tools (+ gate, + via, move, delete, undo, redo); bottom: the order, the level (names, time, start, my levels), the test drive;
// a tap on the map adds with the active tool, a point is dragged with one finger (it is drawn above the finger), two fingers move the map.
// Every step is saved at once (src/game/levelStore.js), so nothing is lost. The model is src/game/levelEdit.js (no DOM, tested in Node).
import { LevelDoc, newLevel, newId, SNAP } from '../game/levelEdit.js';
import { LEVEL, levelTitle } from '../game/levels.js';
import { checkLevel } from '../game/pathfind.js';
import { encodeLevel, decodeLevel, cleanLevel } from '../game/levelShare.js';
import { loadSetting, saveSetting } from '../settings.js';

const CSS = `
.le { position: absolute; inset: 0; pointer-events: none; font-family: system-ui, sans-serif; }
.le button, .le input, .le select, .le .le-panel { pointer-events: auto; }
.le button { position: absolute; border: 2px solid #10161c; background: rgba(255, 255, 255, .95); color: #10161c; font: 700 15px system-ui, sans-serif; border-radius: 12px; min-width: 48px; min-height: 48px; padding: 0 10px; box-shadow: 0 2px 8px rgba(0, 0, 0, .35); touch-action: manipulation; }
.le button:active { background: #ffd166; }
.le button.on { background: #ffd84a; box-shadow: 0 0 0 3px #10161c, 0 2px 8px rgba(0, 0, 0, .35); }
.le button[disabled] { opacity: .45; }
.le .le-left { left: max(10px, env(safe-area-inset-left)); } .le .le-bot { bottom: max(10px, env(safe-area-inset-bottom)); }
.le .le-go { background: #2e9e57; color: #fff; }
.le .le-sel { position: absolute; left: 50%; top: max(8px, env(safe-area-inset-top)); transform: translateX(-50%); display: none; gap: 8px; align-items: center; padding: 6px 10px; border-radius: 12px; background: rgba(16, 22, 28, .9); color: #fff; font: 700 14px system-ui, sans-serif; max-width: 52vw; pointer-events: auto; }
.le .le-sel button { position: static; min-height: 40px; min-width: 40px; font-size: 14px; }
.le .le-sel span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.le .le-toast { position: absolute; left: 50%; top: 64px; transform: translateX(-50%); padding: 8px 14px; border-radius: 12px; background: rgba(180, 30, 20, .95); color: #fff; font: 700 14px system-ui, sans-serif; display: none; max-width: 70vw; text-align: center; }
.le .le-panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(380px, 92vw); background: rgba(250, 247, 240, .98); border-left: 2px solid #10161c; display: none; overflow-y: auto; padding: 10px 12px 18px; box-sizing: border-box; -webkit-overflow-scrolling: touch; color: #10161c; }
.le .le-panel h3 { margin: 4px 0 8px; font: 800 17px system-ui, sans-serif; display: flex; justify-content: space-between; align-items: center; }
.le .le-panel h4 { margin: 14px 0 6px; font: 800 14px system-ui, sans-serif; color: #35424f; }
.le .le-panel label { display: block; margin: 6px 0; font: 600 13px system-ui, sans-serif; }
.le .le-panel input[type=text], .le .le-panel input[type=number], .le .le-panel select { width: 100%; box-sizing: border-box; min-height: 40px; font: 600 15px system-ui, sans-serif; border: 2px solid #9aa5b1; border-radius: 8px; padding: 4px 8px; background: #fff; color: #10161c; }
.le .le-panel input[type=number] { width: 120px; }
.le .le-panel .pb { position: static; display: inline-block; margin: 4px 6px 4px 0; min-height: 42px; font-size: 14px; }
.le .le-panel .pb.x { position: static; min-width: 42px; padding: 0; }
.le .le-row { display: flex; align-items: center; gap: 6px; padding: 6px 4px; border-bottom: 1px solid #d8d2c4; font: 600 14px system-ui, sans-serif; }
.le .le-row.sel { background: #ffe9a8; } .le .le-row .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.le .le-row .nm.via { color: #5a6672; padding-left: 14px; font-weight: 500; }
.le .le-row button { position: static; min-height: 38px; min-width: 38px; padding: 0 6px; font-size: 15px; box-shadow: none; }
.le .le-panel textarea { width: 100%; box-sizing: border-box; min-height: 74px; font: 500 12px ui-monospace, monospace; border: 2px solid #9aa5b1; border-radius: 8px; padding: 6px; background: #fff; color: #10161c; word-break: break-all; }
.le .le-note { font: 500 12px system-ui, sans-serif; color: #5a6672; margin: 2px 0 6px; }
.le .le-bad { color: #b3261e; font: 700 13px system-ui, sans-serif; margin: 3px 0; } .le .le-ok { color: #1f7a3d; font: 700 13px system-ui, sans-serif; }
`;

const el = (tag, cls, text, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const HIT_TOUCH = 30, HIT_MOUSE = 18;   // px

// opts: { graph, drive (the drivable street graph, src/game/pathfind.js), clear(x, z, r) (free of walls), places (city.tour.places), spec (tour.json), facts,
//         builtin: () => [levels], mine: [levels], saveMine(list), onChange(level, list), tryLevel(level), getTuk() }
export function createLevelEditor(opts) {
  const { graph, places, spec, facts } = opts;
  let mine = opts.mine.slice();
  let doc = null, tool = 'move', sel = -1, drag = null, panel = null, saveTimer = 0, toastTimer = 0, fm = null, check = null;
  const ui = {};
  const ctx = { graph, places, spec, facts };

  // ---------------------------------------------------------------- the levels
  const find = (id) => mine.find((l) => l.id === id);
  function persist(now) {
    clearTimeout(saveTimer);
    const run = () => { saveTimer = 0; if (!doc) return; mine = mine.some((l) => l.id === doc.level.id) ? mine.map((l) => (l.id === doc.level.id ? { ...doc.level, mine: true } : l)) : [...mine, { ...doc.level, mine: true }]; opts.saveMine(mine); if (opts.onChange) opts.onChange(doc.level, mine); };
    if (now) run(); else saveTimer = setTimeout(run, 250);
  }
  function load(level) {
    if (doc && saveTimer) persist(true);
    doc = new LevelDoc(level, ctx); sel = -1; tool = 'move';
    check = null; doc.on(() => { check = null; persist(false); refresh(); });
    saveSetting('editor.last', level.id);
    if (!find(level.id)) persist(true);
    refresh();
    const s = doc.startPoint() || (doc.gates[0] && doc.pointOf(doc.gates[0]));
    if (fm && s) fm.centerOn(s[0], s[1], Math.max(fm.view.s, 0.6));
  }
  function create(from = null) {
    const n = mine.length + 1;
    const lv = from ? { ...JSON.parse(JSON.stringify(from)), id: newId(), title: { uk: `${levelTitle(from)} (копія)`, en: '', es: '' }, time: from.time && from.time.mode === 'manual' ? from.time : { mode: 'auto', par: null }, mine: true }
      : newLevel({ id: newId(), title: `Мій рівень ${n}` });
    delete lv.mine; load(lv); closePanels(); toast(from ? 'Копія створена' : 'Новий рівень: додай ворота', true);
  }
  function remove(id) {
    mine = mine.filter((l) => l.id !== id); opts.saveMine(mine); if (opts.onChange) opts.onChange(null, mine);
    if (doc && doc.level.id === id) { doc = null; if (mine.length) load(mine[mine.length - 1]); else create(); }
  }

  // ---------------------------------------------------------------- the checks: the rules of the model + the map (pathfind.js), after every change
  function getCheck() {
    if (!check && doc) { try { check = checkLevel(doc, { drive: opts.drive, clear: opts.clear }); } catch (e) { console.warn('перевірка рівня:', e); check = { level: [], items: new Map(), suggestions: [], len: 0, legs: [] }; } }
    return check;
  }
  // everything that is wrong: { level: [text], items: Map(index -> [text]) }
  function problems() {
    const pr = doc.problems(), c = getCheck(), items = new Map(pr.items);
    for (const [i, arr] of c.items) items.set(i, [...(items.get(i) || []), ...arr.filter((t) => !(items.get(i) || []).includes(t))]);
    return { level: [...pr.level, ...c.level], items, check: c };
  }

  // ---------------------------------------------------------------- geometry of the points
  const items = () => (doc ? doc.items : []);
  function pointAt(i) { return doc.pointOf(doc.items[i]); }
  function hitItem(wx, wz, view, touch) {
    const r = (touch ? HIT_TOUCH : HIT_MOUSE) / view.s; let best = -1, bd = r;
    items().forEach((it, i) => { const p = pointAt(i); if (!p) return; const d = Math.hypot(p[0] - wx, p[1] - wz) * (it.k === 'via' ? 0.85 : 1); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  // ---------------------------------------------------------------- the hooks of the map
  const editor = {
    title: 'Редактор рівнів',
    attach(root, api) { fm = api; build(root); },
    initialView() { if (!doc) return null; const s = doc.startPoint() || (doc.gates[0] && doc.pointOf(doc.gates[0])); return s ? { x: s[0], z: s[1], s: 0.7 } : null; },
    hit(wx, wz, e, view) {
      if (!doc) return false;
      const i = hitItem(wx, wz, view, e.pointerType !== 'mouse'); if (i < 0) return false;
      sel = i; drag = { i, x0: e.clientX, y0: e.clientY, started: false, lift: e.pointerType !== 'mouse' ? 44 / view.s : 0, view };
      refresh(); return true;
    },
    dragMove(wx, wz, e) {
      if (!drag) return;
      if (!drag.started) { if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 7) return; drag.started = true; doc.beginDrag(); }
      doc.dragTo(drag.i, wx, wz - drag.lift);
    },
    dragEnd() { if (drag && drag.started) doc.endDrag(); drag = null; refresh(); },
    dragCancel() { if (drag && drag.started) doc.cancelDrag(); drag = null; refresh(); },
    tap(wx, wz) {
      if (!doc) return;
      if (tool === 'gate') { const r = doc.addGate(wx, wz); if (r.error) toast(r.error); else { sel = r.index; if (!r.onRoad) toast(`Дорога далі ніж ${SNAP} м: ворота стоять там, де торкнувся`); } }
      else if (tool === 'via') { const r = doc.addVia(wx, wz); if (r.error) toast(r.error); else sel = r.index; }
      else sel = -1;
      refresh();
    },
    onClose() { if (saveTimer) persist(true); closePanels(); drag = null; },

    // ---- drawing: world metres, then the screen
    drawWorld(g, view) {
      if (!doc) return;
      const s = view.s, st = doc.startPoint();
      // the order of the run: a thin dashed line start -> points -> finish (editor only)
      const pts = [st, ...items().map((_, i) => pointAt(i))].filter(Boolean);
      if (pts.length > 1) {
        g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
        g.setLineDash([9 / s, 7 / s]); g.lineWidth = 2.5 / s; g.strokeStyle = 'rgba(30, 70, 160, .8)'; g.stroke(); g.setLineDash([]);
      }
      // the corridor of a stay-on-road level: where the tuk-tuk may drive
      const cr = getCheck().corridor;
      if (doc.level.type === 'stay-on-road' && cr.length) { g.lineCap = 'round'; for (const c of cr) { g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(c[2], c[3]); g.lineWidth = c[4]; g.strokeStyle = 'rgba(46, 160, 80, .26)'; g.stroke(); } g.lineCap = 'butt'; }
      // a gate is a line across the road
      items().forEach((it, i) => {
        if (it.k !== 'gate') return;
        const p = pointAt(i), d = it.d || (it.place && places[it.place] && places[it.place].d); if (!p || !d) return;
        const half = Math.max(6, 14 / s), nx = -d[1], nz = d[0];
        g.beginPath(); g.moveTo(p[0] - nx * half, p[1] - nz * half); g.lineTo(p[0] + nx * half, p[1] + nz * half);
        g.lineWidth = 4 / s; g.strokeStyle = it.finish ? '#1f8f4a' : '#c78a00'; g.stroke();
      });
    },
    drawScreen(g, toScreen, view) {
      if (!doc) return;
      const prob = problems(), st = doc.startPoint();
      g.font = '700 14px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
      if (st) { const [x, y] = toScreen(st[0], st[1]); g.beginPath(); g.arc(x, y, 11, 0, 6.3); g.fillStyle = '#2e9e57'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#10161c'; g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x - 3, y - 5); g.lineTo(x + 5, y); g.lineTo(x - 3, y + 5); g.closePath(); g.fill(); }
      // suggested via points of the check: orange rings with a plus, until accepted
      for (const sg of prob.check.suggestions) for (const v of sg.vias) { const [x, y] = toScreen(v[0], v[1]); g.beginPath(); g.arc(x, y, 8, 0, 6.3); g.fillStyle = 'rgba(255, 140, 0, .25)'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#e07b00'; g.stroke(); g.fillStyle = '#e07b00'; g.font = '800 13px system-ui, sans-serif'; g.fillText('+', x, y + 0.5); g.font = '700 14px system-ui, sans-serif'; }
      let n = 0;
      items().forEach((it, i) => {
        const p = pointAt(i); if (!p) return;
        const [x, y] = toScreen(p[0], p[1]); if (x < -40 || y < -40 || x > view.W + 40 || y > view.H + 40) return;
        const lifted = drag && drag.started && drag.i === i, oy = lifted ? -0 : 0;
        const selected = i === sel, bad = prob.items.has(i);
        if (it.k === 'via') {
          g.beginPath(); g.arc(x, y + oy, selected ? 9 : 6.5, 0, 6.3); g.fillStyle = selected ? '#ffd84a' : '#fff'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = bad ? '#d02a1c' : '#10161c'; g.stroke();
        } else {
          n++;
          if (selected) { g.beginPath(); g.arc(x, y, 22, 0, 6.3); g.fillStyle = 'rgba(255, 140, 0, .35)'; g.fill(); }
          g.beginPath(); g.arc(x, y, 14, 0, 6.3); g.fillStyle = it.finish ? '#2e9e57' : '#ffd84a'; g.fill(); g.lineWidth = 3; g.strokeStyle = bad ? '#d02a1c' : '#10161c'; g.stroke();
          g.fillStyle = it.finish ? '#fff' : '#10161c'; g.fillText(it.finish ? 'Ф' : String(n), x, y + 0.5);
          if (view.s >= 0.4 || selected) {
            const t = doc.titleOfItem(i), w = g.measureText(t).width + 6; g.textAlign = 'left'; g.lineWidth = 4; g.strokeStyle = 'rgba(255, 255, 255, .95)'; g.strokeText(t, x + 19, y - 15); g.fillStyle = '#10161c'; g.fillText(t, x + 19, y - 15); g.textAlign = 'center'; void w;
          }
        }
        if (bad) { g.fillStyle = '#d02a1c'; g.beginPath(); g.arc(x + 12, y - 12, 7, 0, 6.3); g.fill(); g.fillStyle = '#fff'; g.font = '800 11px system-ui, sans-serif'; g.fillText('!', x + 12, y - 11.5); g.font = '700 14px system-ui, sans-serif'; }
      });
    },
  };

  // ---------------------------------------------------------------- the interface
  function toast(text, ok) {
    if (!ui.toast) return;
    ui.toast.textContent = text; ui.toast.style.background = ok ? 'rgba(31, 122, 61, .95)' : 'rgba(180, 30, 20, .95)'; ui.toast.style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { ui.toast.style.display = 'none'; }, 3200);
  }
  function build(root) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const wrap = el('div', 'le', null, root); ui.wrap = wrap;
    const stop = (e) => e.stopPropagation();
    const btn = (cls, text, fn, style = {}, parent = wrap) => { const b = el('button', cls, text, parent); Object.assign(b.style, style); b.addEventListener('click', (e) => { e.stopPropagation(); fn(e); }); b.addEventListener('pointerdown', stop); return b; };
    // tools (the left column)
    let y = 64; const col = (cls, text, fn) => { const b = btn('le-left ' + cls, text, fn, { top: y + 'px' }); y += 54; return b; };
    ui.tGate = col('', '＋ Ворота', () => setTool(tool === 'gate' ? 'move' : 'gate'));
    ui.tVia = col('', '＋ Через', () => setTool(tool === 'via' ? 'move' : 'via'));
    ui.tDel = col('', '🗑', () => deleteSel());
    ui.tUndo = btn('le-left', '↶', () => { if (doc.undo()) sel = -1; refresh(); }, { top: y + 'px', minWidth: '48px', width: '48px', padding: '0' });
    ui.tRedo = btn('le-left', '↷', () => { if (doc.redo()) sel = -1; refresh(); }, { top: y + 'px', left: 'calc(max(10px, env(safe-area-inset-left)) + 52px)', minWidth: '48px', width: '48px', padding: '0' });
    // the bottom row
    const bx = 236; let x = bx;
    const bot = (cls, text, fn) => { const b = btn('le-bot ' + cls, text, fn, { left: x + 'px' }); x += 124; return b; };
    bot('', '≡ Порядок', () => openPanel('order'));
    bot('', '⚙ Рівень', () => openPanel('level'));
    ui.go = bot('le-go', '▶ Спробувати', () => tryLevel()); ui.go.style.width = '150px';
    // the selected point
    ui.sel = el('div', 'le-sel', null, wrap);
    ui.selText = el('span', null, '', ui.sel);
    ui.selEdit = btn('', '✎', () => editGate(), {}, ui.sel); ui.selDel = btn('', '🗑', () => deleteSel(), {}, ui.sel);
    ui.toast = el('div', 'le-toast', '', wrap);
    ui.order = el('div', 'le-panel', null, wrap); ui.level = el('div', 'le-panel', null, wrap);
    for (const p of [ui.order, ui.level]) { p.addEventListener('pointerdown', stop); p.addEventListener('wheel', stop); p.addEventListener('touchstart', stop, { passive: true }); }
    addEventListener('keydown', onKey);
  }
  function setTool(t) { tool = t; refresh(); if (t === 'gate') toast('Торкнись карти: там з\'явиться ворота', true); else if (t === 'via') toast('Торкнись карти: там з\'явиться «через»', true); }
  function deleteSel() {
    if (!doc || sel < 0) { toast('Спершу вибери точку'); return; }
    const r = doc.remove(sel); if (r.error) toast(r.error); else sel = -1; refresh();
  }
  function onKey(e) {
    if (!fm || !fm.editing || !fm.isOpen || (e.target && /^(input|select|textarea)$/i.test(e.target.tagName))) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { if (e.shiftKey ? doc.redo() : doc.undo()) { sel = -1; refresh(); } e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { if (doc.redo()) { sel = -1; refresh(); } e.preventDefault(); }
    else if (e.code === 'Delete' || e.code === 'Backspace') { deleteSel(); e.preventDefault(); }
  }
  function tryLevel() {
    const n = doc.gates.length;
    if (n < 2) { toast('Додай хоча б одні ворота перед фінішем'); return; }
    const c = getCheck(); if ([...c.items.values()].some((a) => a.some((t) => /недосяжні|у стіні/.test(t)))) { toast('Є недосяжні або «в стіні» точки: див. ⚙ Рівень → Перевірка'); return; }
    persist(true); closePanels(); fm.close(); opts.tryLevel(doc.level);
  }

  // ---- status and the buttons
  function refresh() {
    if (!ui.wrap || !doc) return;
    ui.tGate.classList.toggle('on', tool === 'gate'); ui.tVia.classList.toggle('on', tool === 'via');
    ui.tUndo.disabled = !doc.canUndo; ui.tRedo.disabled = !doc.canRedo; ui.tDel.disabled = sel < 0;
    const pr = problems(), nb = pr.level.length + pr.items.size;
    fm.setTitle(`${levelTitle(doc.level) || 'Без назви'} · ворота ${doc.gates.length}/${LEVEL.maxGates}${nb ? ` · ⚠ ${nb}` : ' · ✓'}`);
    const it = sel >= 0 ? doc.items[sel] : null;
    ui.sel.style.display = it ? 'flex' : 'none';
    if (it) {
      const nm = it.k === 'gate' ? doc.titleOfItem(sel) : '', head = it.k === 'via' ? 'Через' : it.finish ? 'Фініш' : 'Ворота ' + doc.gateNumber(sel);
      ui.selText.textContent = nm && nm !== head ? `${head}: ${nm}` : head;
      ui.selEdit.style.display = it.k === 'gate' ? '' : 'none'; ui.selDel.style.display = it.finish ? 'none' : '';
    }
    if (panel === 'order') fillOrder(); else if (panel === 'level') fillLevel();
    fm.invalidate();
  }
  function closePanels() { panel = null; if (ui.order) ui.order.style.display = ui.level.style.display = 'none'; }
  function openPanel(name) {
    if (panel === name) { closePanels(); return; }
    closePanels(); panel = name; (name === 'order' ? ui.order : ui.level).style.display = 'block'; refresh();
  }

  // ---- the order list
  function fillOrder() {
    const p = ui.order; p.textContent = '';
    const h = el('h3', null, 'Порядок проходження', p); const x = el('button', 'pb x', '✕', h); x.addEventListener('click', closePanels);
    el('div', 'le-note', 'Торкнись назви: точка вибереться на карті. ↑ ↓ міняють порядок; фініш завжди останній.', p);
    let n = 0;
    doc.items.forEach((it, i) => {
      const row = el('div', 'le-row' + (i === sel ? ' sel' : ''), null, p);
      const name = el('span', 'nm' + (it.k === 'via' ? ' via' : ''), it.k === 'via' ? '○ через' : `${it.finish ? 'Ф' : ++n}  ${doc.titleOfItem(i)}`, row);
      name.addEventListener('click', () => { sel = i; const q = pointAt(i); if (q) fm.centerOn(q[0], q[1], Math.max(fm.view.s, 0.7)); refresh(); });
      if (!it.finish) {
        const up = el('button', null, '↑', row), dn = el('button', null, '↓', row), dl = el('button', null, '🗑', row);
        up.addEventListener('click', () => { const r = doc.reorder(i, -1); if (!r.error) sel = r.index; refresh(); });
        dn.addEventListener('click', () => { const r = doc.reorder(i, 1); if (!r.error) sel = r.index; refresh(); });
        dl.addEventListener('click', () => { if (!doc.remove(i).error) sel = -1; refresh(); });
        up.disabled = i === 0; dn.disabled = i + 1 >= doc.finishIndex;
      }
    });
  }

  // ---- the level: names, type, time, start, my levels
  function fillLevel() {
    const p = ui.level, keep = document.activeElement && p.contains(document.activeElement) ? document.activeElement : null;
    if (keep && /^(input|select|textarea)$/i.test(keep.tagName)) return;   // do not rebuild under the keyboard
    p.textContent = '';
    const lv = doc.level;
    const h = el('h3', null, 'Рівень', p); const x = el('button', 'pb x', '✕', h); x.addEventListener('click', closePanels);
    el('h4', null, 'Назва', p);
    for (const [l, label] of [['uk', 'Українською'], ['en', 'English'], ['es', 'Español']]) {
      const lab = el('label', null, label, p), inp = el('input', null, null, lab); inp.type = 'text'; inp.value = lv.title[l] || ''; inp.maxLength = LEVEL.titleMax; inp.placeholder = l === 'uk' ? 'обов\'язково' : 'можна порожнім';
      inp.addEventListener('change', () => { doc.setTitle(l, inp.value); });
    }
    el('div', 'le-note', 'English і Español можна лишити порожніми: переклад додається, коли рівень потрапляє в гру.', p);
    // type
    el('h4', null, 'Тип рівня', p);
    const ts = el('select', null, null, p);
    for (const [v, t, dis] of [['standard', 'Звичайний: ворота, швидкість, чайові'], ['stay-on-road', 'Не з\'їжджай з дороги: вихід за вулицю карається'], ['stunt', 'Гори / Каскадер (польоти, пізніше)', true]]) { const o = new Option(t, v); o.disabled = !!dis; ts.add(o); }
    ts.value = lv.type || 'standard'; ts.addEventListener('change', () => doc.setType(ts.value));
    if (lv.type === 'stay-on-road') {
      const r = { margin: 1, grace: 0.5, timePenalty: 2, burn: 0.25, ...lv.rules };
      el('div', 'le-note', 'Поза дорогою (вісь тук-тука далі від краю асфальту вулиці, ніж допуск): годинник іде швидше, чайові «на кону» горять, комбо скидається, екран червоніє. Зелена смуга на карті: де можна їхати.', p);
      for (const [k, label, min, max, step] of [['margin', 'Допуск за край дороги, м', 0, 4, 0.5], ['grace', 'Пільга перед штрафом, с', 0, 5, 0.1], ['timePenalty', 'Штраф часу, с за кожну секунду поза дорогою', 0, 10, 0.5], ['burn', 'Чайові на кону горять, частка за секунду', 0, 1, 0.05]]) {
        const lab = el('label', null, label, p), inp = el('input', null, null, lab); inp.type = 'number'; inp.min = min; inp.max = max; inp.step = step; inp.value = r[k];
        inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) doc.setRules({ [k]: Math.max(min, Math.min(max, v)) }); });
      }
    }
    // time
    el('h4', null, 'Час на проїзд', p);
    const est = (() => { const len = doc.routeLength(); return len ? { len, par: Math.round(len * 0.06) } : null; })();
    const auto = el('label', null, null, p), ar = el('input', null, null, auto); ar.type = 'radio'; ar.name = 'le-time'; ar.checked = lv.time.mode !== 'manual'; auto.append(` Автоматично${est ? `: ≈ ${fmtTime(est.par)} (шлях ${(est.len / 1000).toFixed(1)} км)` : ''}`);
    const man = el('label', null, null, p), mr = el('input', null, null, man); mr.type = 'radio'; mr.name = 'le-time'; mr.checked = lv.time.mode === 'manual'; man.append(' Вручну, секунд: ');
    const mi = el('input', null, null, man); mi.type = 'number'; mi.min = 20; mi.max = 3600; mi.value = lv.time.mode === 'manual' ? lv.time.par : (est ? est.par : 300);
    ar.addEventListener('change', () => doc.setTime('auto')); mr.addEventListener('change', () => doc.setTime('manual', +mi.value));
    mi.addEventListener('change', () => { mr.checked = true; doc.setTime('manual', +mi.value); });
    el('div', 'le-note', 'Це час на весь забіг (на старті годинник має 35 %, решта додається на воротах). Автоматично: від довжини шляху.', p);
    // start
    el('h4', null, 'Старт і фініш', p);
    const ss = el('select', null, null, p);
    const startPlaces = Object.keys(places).filter((id) => spec.places[id]);
    ss.add(new Option('— старт: вибери місце —', ''));
    for (const id of startPlaces) { const o = new Option(spec.places[id].title || id, id); ss.add(o); }
    ss.value = lv.start.place || '';
    ss.addEventListener('change', () => { if (ss.value) { doc.setStart({ place: ss.value }); } });
    const here = el('button', 'pb', '📍 Старт там, де тук-тук', p);
    here.addEventListener('click', () => { const t = opts.getTuk(); doc.setStart({ x: Math.round(t.x * 10) / 10, z: Math.round(t.z * 10) / 10, heading: Math.round(t.heading * 1000) / 1000 }); toast('Старт переставлено', true); });
    const fin = el('button', 'pb', 'Фініш там, де старт', p); fin.addEventListener('click', () => { doc.finishAtStart(); toast('Фініш переставлено на старт', true); });
    // checks: the rules and the map
    el('h4', null, 'Перевірка', p);
    const pr = problems(), c = pr.check;
    if (c.len) el('div', 'le-note', `Шлях через усі точки по вулицях: ${(c.len / 1000).toFixed(2)} км`, p);
    if (!pr.level.length && !pr.items.size) el('div', 'le-ok', '✓ Усе гаразд: воріт від 3 до 12, фініш останній, усі точки досяжні', p);
    for (const t of pr.level) el('div', 'le-bad', '⚠ ' + t, p);
    for (const [i, arr] of pr.items) for (const t of arr) {
      const row = el('div', 'le-row', null, p);
      const nm = el('span', 'nm', `${doc.items[i] && doc.items[i].k === 'gate' ? (doc.items[i].finish ? 'Фініш' : 'Ворота ' + doc.gateNumber(i)) : 'Через'}: ${t}`, row); nm.style.whiteSpace = 'normal'; nm.style.color = '#b3261e';
      nm.addEventListener('click', () => { sel = i; const q = pointAt(i); if (q) fm.centerOn(q[0], q[1], Math.max(fm.view.s, 0.8)); closePanels(); refresh(); });
    }
    if (c.suggestions.length) {
      const all = el('button', 'pb', `✓ Прийняти всі об'їзди (${c.suggestions.reduce((n, s2) => n + s2.vias.length, 0)} точок)`, p);
      all.addEventListener('click', () => { const list = [...c.suggestions].sort((x, y) => y.at - x.at); doc.edit((lv) => { for (const sg of list) lv.items.splice(sg.at, 0, ...sg.vias.map((v) => ({ k: 'via', p: [v[0], v[1]] }))); }); toast('Об\'їзди додано', true); });
      el('div', 'le-note', 'Оранжеві кільця на карті: де редактор радить поставити «через», щоб стрілка вела вулицями, а не в глухий кут або на сходи.', p);
    }
    // my levels
    el('h4', null, 'Мої рівні (на цьому пристрої)', p);
    for (const l of mine) {
      const row = el('div', 'le-row' + (l.id === lv.id ? ' sel' : ''), null, p);
      const nm = el('span', 'nm', `${levelTitle(l) || 'Без назви'} · ${l.items.filter((q) => q.k === 'gate').length} воріт`, row);
      nm.addEventListener('click', () => { load(find(l.id)); });
      const dup = el('button', null, '⧉', row); dup.title = 'Копія'; dup.addEventListener('click', () => create(l));
      const del = el('button', null, '🗑', row); del.addEventListener('click', () => { if (confirmDelete(del, l.id)) remove(l.id); });
    }
    const nw = el('button', 'pb', '＋ Новий рівень', p); nw.addEventListener('click', () => create());
    const bs = el('select', null, null, p); bs.add(new Option('＋ Копія вбудованого рівня як основа…', ''));
    for (const b of opts.builtin()) bs.add(new Option(levelTitle(b), b.id));
    bs.addEventListener('change', () => { const b = opts.builtin().find((q) => q.id === bs.value); if (b) create(b); });
    // handing over: the code to the developer (chat), a file, and the way back
    el('h4', null, 'Передати рівень мені / відкрити код', p);
    el('div', 'le-note', 'Поділитися: код копіюється, відкривається меню телефона (Telegram, пошта…); встав код у чат — я додам рівень у гру, переклади en / es зроблю сам.', p);
    const shareBtn = el('button', 'pb', '📤 Поділитися рівнем', p), fileBtn = el('button', 'pb', '💾 Файл .json', p);
    const out = el('textarea', null, null, p); out.readOnly = true; out.style.display = 'none'; out.addEventListener('focus', () => out.select());
    shareBtn.addEventListener('click', async () => {
      const lv = cleanLevel(doc.level), bad = problems(); persist(true);
      const code = await encodeLevel(lv); out.value = code; out.style.display = 'block';
      let copied = false; try { await navigator.clipboard.writeText(code); copied = true; } catch { try { out.select(); copied = document.execCommand('copy'); } catch { /* the field is there to copy by hand */ } }
      const note = bad.level.length || bad.items.size ? ' (у рівні є зауваження: я їх виправлю, або виправ сам)' : '';
      toast(copied ? `Код скопійовано${note}` : 'Скопіюй код із поля нижче', true);
      if (navigator.share) { try { await navigator.share({ title: `Рівень Crazy Tuk: ${levelTitle(lv)}`, text: code }); } catch { /* cancelled */ } }
    });
    fileBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(cleanLevel(doc.level), null, 1)], { type: 'application/json' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${doc.level.id}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
    const inp = el('textarea', null, null, p); inp.placeholder = 'Встав сюди код рівня (TTL1.…) або JSON';
    const imp = el('button', 'pb', '📥 Відкрити код', p), pick = el('button', 'pb', '📂 З файлу', p);
    const fileIn = el('input', null, null, p); fileIn.type = 'file'; fileIn.accept = '.json,.txt,application/json,text/plain'; fileIn.style.display = 'none';
    const doImport = async (text) => {
      const r = await decodeLevel(text, { places });
      if (r.error) { toast(r.error); return; }
      let lv = r.level; if (find(lv.id) || opts.builtin().some((b) => b.id === lv.id)) lv = { ...lv, id: newId() };   // never over another level
      delete lv.mine; load(lv); persist(true); closePanels(); toast(r.problems.length ? `Рівень відкрито (зауважень: ${r.problems.length})` : 'Рівень відкрито', true);
    };
    imp.addEventListener('click', () => doImport(inp.value));
    pick.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', async () => { const f = fileIn.files && fileIn.files[0]; if (f) doImport(await f.text()); fileIn.value = ''; });
  }
  // a delete asks once more: the first tap arms the button, the second (within 3 s) deletes
  const armed = new Map();
  function confirmDelete(btn, id) {
    if (armed.get(id)) { clearTimeout(armed.get(id)); armed.delete(id); return true; }
    btn.textContent = 'Точно?'; btn.style.width = 'auto';
    armed.set(id, setTimeout(() => { armed.delete(id); btn.textContent = '🗑'; }, 3000));
    return false;
  }
  function editGate() {
    if (sel < 0 || !doc.items[sel] || doc.items[sel].k !== 'gate') return;
    const it = doc.items[sel], cur = it.title || (it.place ? doc.titleOfItem(sel) : ''), curFact = it.fact || (it.place && facts && facts[it.place]) || '';
    const t = prompt('Назва воріт (до 40 символів):', cur); if (t === null) return;
    const f = prompt(`Один рядок про місце, що показується на ходу (до ${LEVEL.factMax} символів; можна порожньо):`, curFact); if (f === null) return;
    doc.setGateText(sel, { title: t, fact: f }); refresh();
  }

  return {
    // opens the editor on the level `id` (a level of mine), else the last edited, else a new one
    open(id = null) {
      const lastId = id || loadSetting('editor.last', null), lv = find(lastId) || mine[mine.length - 1];
      if (!doc || (id && doc.level.id !== id)) { if (lv) load(lv); else create(); }
      const ok = opts.fullMap.openEditor(editor);
      if (ok) refresh();
      return ok;
    },
    setMine(list) { mine = list.slice(); },
    get mine() { return mine; },
    get doc() { return doc; },
    get isOpen() { return !!fm && fm.editing && fm.isOpen; },
    close() { if (fm) fm.close(); },
  };
}
