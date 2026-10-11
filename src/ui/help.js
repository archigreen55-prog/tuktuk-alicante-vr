// The "How to drive" panel of the title screen and the pause menu (0.19.0): the keyboard and Quest tables that used to be the
// start screen, plus the phone buttons. Two languages, kept here rather than in the dictionaries: these are tables, not lines.
export const HELP = {
  en: {
    kb: ['Keyboard', [
      ['W / ↑', 'gas'],
      ['S / ↓', 'brake (short: gentle, longer: harder); hold at a standstill: reverse'],
      ['A D / ← →', 'steer'],
      ['Space', 'handbrake (slide)'],
      ['Crazy Tuk', 'auto-gas ≈ 70 km/h (or W: gas), S brake, Space handbrake (drift), Shift nitro (the tank, up to 120 km/h), T restart the run (twice)'],
      ['Shift (hold)', 'nitro: in the tour a burst to 60 km/h for 4 s, then 10 s to recharge; the tourists shout "oy", −10 mood'],
      ['K', 'cab tilt: full / half / off'],
      ['R', 'back onto the nearest road'],
      ['C', 'camera: cockpit / behind'],
      ['F', 'FPS counter on the dashboard'],
      ['H', 'horn'],
      ['T', 'tour: a new one after the summary; twice: restart'],
      ['M', 'full-screen map (a click on the minimap too)'],
      ['N', 'minimap on / off'],
      ['Esc', 'main menu'],
      ['Right mouse button', 'look around'],
    ]],
    quest: ['Quest 3 (play seated)', [
      ['Both grips', '"hands on the bar": hold the grips, steer by turning your hands'],
      ['Twist the right grip towards you', 'gas ("hands on the bar")'],
      ['Right trigger', 'gas (always)'],
      ['Left trigger', 'brake; hold at a standstill: reverse'],
      ['Left stick ← →', 'steer (in the hands mode: when the bar is released)'],
      ['A', 'handbrake (slide)'],
      ['B (hold)', 'nitro (a burst up to 4 s, 10 s to recharge; in the tour: "oy", −10 mood)'],
      ['Right stick forward', 'horn'],
      ['Right stick press', 'steering mode: stick / hands'],
      ['X / hold X 1 s', 'FPS counter / load test'],
      ['Left stick press', 'vignette strength'],
      ['Y short', 'tour: a new one after the summary; twice: restart'],
      ['Y (hold 1 s)', 're-centre the seat'],
      ['A + B (1 s)', 'back onto the road (in the stick mode: both grips 1 s as well)'],
    ]],
    phone: ['Phone', [
      ['◄ ►', 'steer (or the slider: Settings)'],
      ['GAS', 'gas; in Crazy Tuk the auto-gas holds ≈ 70 km/h by itself'],
      ['BRAKE', 'brake; hold at a standstill: reverse'],
      ['HAND', 'handbrake: the drift'],
      ['NITRO', 'hold: up to 120 km/h while the tank lasts; exact gates refill it'],
      ['📯 · ⟲', 'horn · back onto the road'],
      ['≡ · 🗺 · 📷 · ⛶', 'pause menu · map · camera · full screen'],
      ['Drag the view', 'look around (it returns forward by itself)'],
    ]],
  },
  uk: {
    kb: ['Клавіатура', [
      ['W / ↑', 'газ'],
      ['S / ↓', 'гальмо (коротко — м’яко, довше — сильніше); утримуй на місці — задній хід'],
      ['A D / ← →', 'поворот'],
      ['Пробіл', 'ручник (занос)'],
      ['Crazy Tuk', 'автогаз ≈ 70 км/год (або W — газ), S — гальмо, Пробіл — ручник (дрифт), Shift — нітро (бак, до 120 км/год), T — забіг заново (двічі)'],
      ['Shift (утримувати)', 'нітро: у турі ривок до 60 км/год до 4 с, потім 10 с перезарядка; туристи кричать «ой», −10 настрою'],
      ['K', 'нахил кабіни: повний / половина / вимкнено'],
      ['R', 'повернутися на найближчу дорогу'],
      ['C', 'камера: кабіна / ззаду'],
      ['F', 'лічильник FPS на панелі'],
      ['H', 'гудок'],
      ['T', 'тур: новий після підсумку; двічі — почати заново'],
      ['M', 'карта на весь екран (клік по мінікарті теж)'],
      ['N', 'мінікарта вкл / викл'],
      ['Esc', 'головне меню'],
      ['Права кнопка миші', 'озирнутися'],
    ]],
    quest: ['Quest 3 (грати сидячи)', [
      ['Обидва grip', '«руки на кермі»: тримати ручки, кермо — поворотом рук'],
      ['Крутити праву ручку на себе', 'газ («руки на кермі»)'],
      ['Правий тригер', 'газ (завжди)'],
      ['Лівий тригер', 'гальмо; утримуй на місці — задній хід'],
      ['Лівий стік ← →', 'поворот (у режимі рук — коли кермо відпущене)'],
      ['A', 'ручник (занос)'],
      ['B (утримувати)', 'нітро (ривок до 4 с, перезарядка 10 с; у турі — «ой», −10 настрою)'],
      ['Правий стік уперед', 'гудок'],
      ['Натиск правого стіка', 'режим керування: стік / руки'],
      ['X / утримати X 1 с', 'лічильник FPS / тест навантаження'],
      ['Натиск лівого стіка', 'сила віньєтки'],
      ['Y коротко', 'тур: новий після підсумку; двічі — почати заново'],
      ['Y (утримати 1 с)', 'перецентрувати сидіння'],
      ['A + B (1 с)', 'повернутися на дорогу (у режимі стіка — ще й обидва grip 1 с)'],
    ]],
    phone: ['Телефон', [
      ['◄ ►', 'поворот (або повзунок: Налаштування)'],
      ['ГАЗ', 'газ; у Crazy Tuk автогаз сам тримає ≈ 70 км/год'],
      ['ГАЛЬМО', 'гальмо; утримуй на місці — задній хід'],
      ['РУЧНИК', 'ручник: дрифт'],
      ['НІТРО', 'тримай: до 120 км/год, поки є бак; точні ворота доливають його'],
      ['📯 · ⟲', 'гудок · назад на дорогу'],
      ['≡ · 🗺 · 📷 · ⛶', 'меню паузи · карта · камера · повний екран'],
      ['Тягни погляд', 'озирнутися (сам повертається вперед)'],
    ]],
  },
};

// The tables as DOM (0.19.2): used by the title screen's Help drawer and by the in-game Help layer (pause menu), so Help never has to
// reopen the title screen (and never moves the tuk-tuk).
import { getLang } from '../i18n.js';
export function fillHelpTables(body, isPhone) {
  body.textContent = '';
  const HL = HELP[getLang()] || HELP.en;
  for (const k of isPhone ? ['phone', 'kb', 'quest'] : ['kb', 'quest', 'phone']) {
    const [title, lines] = HL[k];
    const box = document.createElement('div'); body.appendChild(box);
    const h = document.createElement('h3'); h.textContent = title; box.appendChild(h);
    const table = document.createElement('table'); box.appendChild(table);
    for (const [a, b] of lines) { const tr = document.createElement('tr'); table.appendChild(tr); for (const x of [a, b]) { const td = document.createElement('td'); td.textContent = x; tr.appendChild(td); } }
  }
}
const CSS = /* css */ `
.hp-layer { position: fixed; inset: 0; z-index: 120; display: none; align-items: flex-start; justify-content: center; overflow-y: auto; overscroll-behavior: contain; background: rgba(10, 14, 20, .88); color: #fff; font-family: system-ui, sans-serif; touch-action: pan-y; }
.hp-layer.open { display: flex; }
.hp-layer .card { margin: 8px; width: min(96vw, 820px); box-sizing: border-box; padding: 10px 16px 14px; border-radius: 14px; background: rgba(15, 30, 45, .97); }
.hp-layer h2 { margin: 0 0 8px; font-size: 18px; display: flex; justify-content: space-between; align-items: center; }
.hp-layer h2 button { font: 700 14px system-ui, sans-serif; min-height: 40px; padding: 6px 16px; border-radius: 10px; border: 0; background: #ffd166; color: #222; cursor: pointer; touch-action: manipulation; }
.hp-layer .body { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
.hp-layer h3 { margin: 8px 0 2px; font-size: 15px; color: #cfe3f5; }
.hp-layer table { border-collapse: collapse; font-size: 12.5px; width: 100%; }
.hp-layer td { padding: 2px 8px 2px 0; vertical-align: top; } .hp-layer td:first-child { color: #ffd166; white-space: nowrap; font-weight: 600; }
@media (max-height: 460px) and (orientation: landscape), (orientation: portrait) { .hp-layer .body { grid-template-columns: 1fr; } }
`;
export function createHelpLayer({ isPhone, title, onOpen, onClose }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const layer = document.createElement('div'); layer.className = 'hp-layer'; document.body.appendChild(layer);
  const card = document.createElement('div'); card.className = 'card'; layer.appendChild(card);
  const h = document.createElement('h2'); card.appendChild(h);
  const ttl = document.createElement('span'); h.appendChild(ttl);
  const x = document.createElement('button'); x.textContent = '✕'; h.appendChild(x);
  const body = document.createElement('div'); body.className = 'body'; card.appendChild(body);
  const close = () => { if (!layer.classList.contains('open')) return; layer.classList.remove('open'); if (onClose) onClose(); };
  x.addEventListener('click', close); layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
  const fill = () => { ttl.textContent = title(); fillHelpTables(body, isPhone); };
  addEventListener('tuktuk-lang', fill);
  return { open() { fill(); layer.classList.add('open'); if (onOpen) onOpen(); }, close, get isOpen() { return layer.classList.contains('open'); } };
}
