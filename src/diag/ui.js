// Phone diagnostics UI (stage F0): the FPS button + widget with a 10-minute graph, the diagnostics panel
// with "Копіювати звіт", the bench intro card and progress pill. All DOM is built here with inline styles.
import { loadSetting, saveSetting } from '../settings.js';
import { copyText } from './report.js';

const SAFE_L = 'env(safe-area-inset-left)';
function h(tag, css, text, parent) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
const BTN = 'font:600 13px system-ui,sans-serif;padding:8px 12px;min-height:36px;border:0;border-radius:8px;background:#ffd166;color:#222;cursor:pointer;touch-action:manipulation';
const BTN_GHOST = 'font:600 13px system-ui,sans-serif;padding:8px 12px;min-height:36px;border:1px solid #ffd166;border-radius:8px;background:rgba(16,22,28,.85);color:#ffd166;cursor:pointer;touch-action:manipulation';

// opts: { stats, getReport() -> Promise<string>, cap, onBench() | null, visible, side: 'left' | 'right' (right: next to the
// phone's top-right buttons) }
export function createDiagUI(opts) {
  const { stats } = opts;
  const D = window.__diag || {};
  const root = h('div', 'position:fixed;left:0;top:0;z-index:50;font:12px/1.35 system-ui,sans-serif;pointer-events:none');
  document.body.appendChild(root);

  // ---- button + widget ----
  // top-left: [FPS] toggle; when open, [Діагностика] [Замір] next to it and a compact block below
  // (kept short: on a phone the minimap of the desktop HUD starts ~200 px from the top)
  const right = opts.side === 'right';
  const SAFE_R = 'max(8px, env(safe-area-inset-right))';
  const topRow = h('div', `position:fixed;${right ? `right:calc(${SAFE_R} + 164px)` : `left:calc(8px + ${SAFE_L})`};top:8px;display:flex;gap:6px;pointer-events:auto`, null, root);
  const toggle = h('button', `${BTN_GHOST};padding:6px 10px;min-height:32px`, 'FPS', topRow);
  const diagBtn = h('button', `${BTN};padding:6px 10px;min-height:32px;display:none`, 'Діагностика', topRow);
  const benchBtn = opts.onBench ? h('button', `${BTN_GHOST};padding:6px 10px;min-height:32px;display:none`, 'Замір', topRow) : null;
  const widget = h('div', `position:fixed;${right ? `right:${SAFE_R};top:62px` : `left:calc(8px + ${SAFE_L});top:46px`};width:288px;padding:6px 8px;border-radius:10px;background:rgba(16,22,28,.82);color:#fff;pointer-events:none;display:none`, null, root);
  const l1 = h('div', 'font:700 15px ui-monospace,monospace', '', widget);
  const l2 = h('div', 'font:11px ui-monospace,monospace;color:#cfe3f5;margin-top:1px', '', widget);
  const l3 = h('div', 'font:10px ui-monospace,monospace;color:#9fb3c8;margin-top:1px', '', widget);
  const canvas = h('canvas', 'display:block;margin-top:4px;width:272px;height:34px;border-radius:4px;background:rgba(255,255,255,.06)', null, widget);
  canvas.width = 544; canvas.height = 68;
  h('div', 'font:9px system-ui,sans-serif;color:#9fb3c8;margin-top:1px', '5 с — стовпчик, до 10 хв · лінії 60 і 30 FPS', widget);

  let shown = loadSetting('diagWidget.v2', !!opts.visible);
  const apply = () => {
    widget.style.display = shown ? 'block' : 'none';
    diagBtn.style.display = shown ? 'block' : 'none';
    if (benchBtn) benchBtn.style.display = shown ? 'block' : 'none';
  };
  toggle.addEventListener('click', () => { shown = !shown; saveSetting('diagWidget.v2', shown); apply(); draw(); });
  apply();

  const last = { l1: '', l2: '', l3: '', graph: '' };
  const put = (el, key, text) => { if (last[key] !== text) { last[key] = text; el.textContent = text; } };
  function draw() {
    if (!shown) return;
    const s = stats.snapshot();
    const hz = stats.refreshHz;
    put(l1, 'l1', `${s.fps.toFixed(0)} FPS · ${s.avgMs.toFixed(1)} мс`);
    l1.style.color = s.fps >= 55 ? '#8be28b' : s.fps >= 40 ? '#ffd166' : '#ff7a5c';
    put(l2, 'l2', `p95 ${s.p95.toFixed(0)} мс · 1 %: ${s.low1.toFixed(0)} FPS · макс ${s.worst.toFixed(0)} мс`);
    put(l3, 'l3', `calls ${s.calls} · ${(s.tris / 1000).toFixed(0)}k · CPU ${s.cpuMs.toFixed(1)} мс${hz ? ` · екран ${hz.toFixed(0)} Гц` : ''}${opts.cap > 0 ? ` · ліміт ${opts.cap}` : ''}`);
    const sig = stats.history.length + ':' + (stats.history.length ? stats.history[stats.history.length - 1].fps.toFixed(0) : '');
    if (sig === last.graph) return;   // the graph changes once per 5 s
    last.graph = sig;
    const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    const max = 75, hist = stats.history, bw = W / 120;
    for (let i = 0; i < hist.length; i++) {
      const f = hist[i].fps;
      g.fillStyle = f >= 55 ? '#4cc36b' : f >= 40 ? '#e5b23a' : '#e5573a';
      const bh = Math.min(1, f / max) * H;
      g.fillRect(W - (hist.length - i) * bw, H - bh, Math.max(1, bw - 1), bh);
    }
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.setLineDash([4, 4]);
    for (const f of [60, 30]) { const y = H - f / max * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  }
  setInterval(draw, 500);

  // ---- diagnostics panel ----
  const panel = h('div', 'position:fixed;inset:0;z-index:120;display:none;flex-direction:column;gap:8px;padding:8px 10px;background:rgba(10,16,22,.96);color:#fff;pointer-events:auto');
  document.body.appendChild(panel);
  const bar = h('div', 'display:flex;flex-wrap:wrap;gap:8px;align-items:center', null, panel);
  const copyBtn = h('button', BTN, 'Копіювати звіт', bar);
  const refreshBtn = h('button', BTN_GHOST, 'Оновити', bar);
  const againBtn = opts.onBench ? h('button', BTN_GHOST, 'Замір ще раз', bar) : null;
  const closeBtn = h('button', BTN_GHOST, 'Закрити', bar);
  const msg = h('span', 'font:13px system-ui,sans-serif;color:#cfe3f5', '', bar);
  const area = h('textarea', 'flex:1;min-height:0;width:100%;box-sizing:border-box;font:11px/1.35 ui-monospace,monospace;background:#0c1319;color:#dfe9f2;border:1px solid #2c3a47;border-radius:8px;padding:8px;resize:none');
  area.readOnly = true; area.spellcheck = false;
  panel.appendChild(area);

  let building = null;
  async function refresh() {
    msg.textContent = 'Збираю звіт… (≈1 с, міряю датчики)';
    area.value = '';
    const p = building = opts.getReport();
    try { const text = await p; if (building === p) { area.value = text; msg.textContent = `Звіт готовий: ${text.length} символів. Натисни «Копіювати звіт» і встав у чат.`; } }
    catch (e) { area.value = `Не вдалося зібрати звіт: ${e && e.stack || e}`; msg.textContent = 'Помилка збирання звіту'; }
  }
  async function copy() {
    if (!area.value) await refresh();
    const ok = await copyText(area.value);
    if (ok) msg.textContent = `Скопійовано ✓ (${area.value.length} символів). Встав у чат.`;
    else { area.focus(); area.select(); msg.textContent = 'Автокопіювання не вдалось: текст виділено — утримай палець на ньому → «Копіювати».'; }
  }
  function open() { panel.style.display = 'flex'; refresh(); }
  function close() { panel.style.display = 'none'; }
  diagBtn.addEventListener('click', open);
  copyBtn.addEventListener('click', copy);
  refreshBtn.addEventListener('click', refresh);
  closeBtn.addEventListener('click', close);
  if (againBtn) againBtn.addEventListener('click', () => { close(); opts.onBench(); });
  if (benchBtn) benchBtn.addEventListener('click', () => opts.onBench());
  D.openPanel = open;   // the red error line opens the panel

  // ---- bench: intro card and progress pill ----
  const pill = h('div', 'position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:60;padding:6px 12px;border-radius:999px;background:rgba(16,22,28,.88);color:#fff;font:600 13px system-ui,sans-serif;display:none;pointer-events:none;white-space:nowrap;max-width:92vw;overflow:hidden;text-overflow:ellipsis');
  document.body.appendChild(pill);
  const bar2 = h('div', 'position:fixed;left:50%;top:40px;transform:translateX(-50%);z-index:60;width:min(360px,70vw);height:4px;border-radius:2px;background:rgba(255,255,255,.2);display:none;pointer-events:none');
  const fill = h('div', 'height:100%;width:0;border-radius:2px;background:#ffd166', null, bar2);
  document.body.appendChild(bar2);

  function setProgress(st) {
    if (!st) { if (pill.style.display !== 'none') pill.style.display = bar2.style.display = 'none'; return; }
    if (pill.style.display !== 'block') pill.style.display = bar2.style.display = 'block';
    if (pill.textContent !== st.text) pill.textContent = st.text;
    const w = `${Math.round(st.progress * 100)}%`;
    if (fill.style.width !== w) fill.style.width = w;
  }

  function showIntro({ passes, stations, per = 10.5, onStart }) {
    const card = h('div', 'position:fixed;inset:0;z-index:110;display:flex;align-items:center;justify-content:center;background:rgba(20,40,60,.85);color:#fff;pointer-events:auto');
    const box = h('div', 'max-width:560px;max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;margin:12px;padding:18px 20px;background:rgba(15,30,45,.96);border-radius:14px;font:15px/1.45 system-ui,sans-serif', null, card);
    h('div', 'font:700 22px system-ui,sans-serif;margin-bottom:6px', '🛺 Замір швидкодії', box);
    h('div', null, `Тук-тук сам проїде ${stations} важких місць міста (${passes > 1 ? passes + ' кола поспіль' : 'одне коло'}), приблизно ${Math.max(0.1, Math.ceil(passes * stations * per / 60 * 10) / 10)} хв. Тримай телефон горизонтально й нічого не торкайся. Наприкінці з'явиться звіт: натисни «Копіювати звіт» і встав його в чат.`, box);
    h('div', 'font-size:13px;opacity:.75;margin-top:6px', 'Порада: заряд батареї понад 50 %, екран не блокуй, інші застосунки закрий.', box);
    const go = h('button', `${BTN};font-size:17px;padding:12px 24px;margin-top:12px`, 'Почати замір', box);
    go.addEventListener('click', () => { card.remove(); onStart(); });
    document.body.appendChild(card);
  }

  // the FPS button row and widget can be hidden (the phone start screen); the panel, the red error line and the bench card stay
  const setVisible = (v) => { root.style.display = v ? '' : 'none'; };
  return { open, close, setProgress, showIntro, draw, refresh, setVisible };
}
