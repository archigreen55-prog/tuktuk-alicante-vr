// Crazy Tuk interface (docs/plan-arcade.md): the clock, the tips (banked + at stake), the speed on a PC (the phone has
// its own), the landmark card on the way to a gate, the gate result flash, the countdown and the summary with the
// record and the "book the real tour" button. Plain HTML over the canvas, phone and PC alike; updated ~10 times a
// second from main.js, nothing runs while the mode is off.
import { euroWhole as euro, clock as fmtClock } from './dashboard.js';

const CSS = `
.ah { position: fixed; inset: 0; pointer-events: none; z-index: 6; font-family: system-ui, sans-serif; color: #fff; display: none; }
.ah.on { display: block; }
.ah-clock { position: absolute; left: 50%; top: 8px; transform: translateX(-50%); font: 700 34px/1 system-ui, sans-serif; font-variant-numeric: tabular-nums; text-shadow: 0 1px 4px #000, 0 0 2px #000; padding: 4px 14px; border-radius: 12px; background: rgba(10, 14, 20, .55); }
.ah-clock.low { color: #ff7a5c; animation: ah-blink .5s steps(2) infinite; }
@keyframes ah-blink { to { opacity: .45; } }
.ah-tips { position: absolute; left: 50%; top: 56px; transform: translateX(-50%); font: 700 18px/1.2 system-ui, sans-serif; text-shadow: 0 1px 3px #000; white-space: nowrap; text-align: center; }
.ah-tips .st { color: #ffd166; font-size: 15px; }
.ah-tips .cb { color: #ff9f43; font-size: 14px; margin-left: 8px; }
.ah-speed { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); text-align: center; text-shadow: 0 1px 4px #000; line-height: 1; }
.ah-speed b { display: block; font-size: 44px; font-variant-numeric: tabular-nums; } .ah-speed span { font-size: 13px; opacity: .85; }
.ah-gate { position: absolute; left: 50%; top: 92px; transform: translateX(-50%); font: 600 14px/1.3 system-ui, sans-serif; color: #cfe3f5; text-shadow: 0 1px 3px #000; white-space: nowrap; }
.ah-card { position: absolute; left: 50%; top: 112px; transform: translateX(-50%); max-width: min(62vw, 520px); padding: 5px 12px 6px; border-radius: 10px; background: rgba(10, 14, 20, .62); text-align: center; opacity: 0; transition: opacity .7s ease-out; }
.ah-card.show { opacity: 1; transition: opacity .25s ease-in; }
.ah-card .t { font: 700 14px/1.2 system-ui, sans-serif; color: #ffd166; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .ah-card .f { font: 12px/1.25 system-ui, sans-serif; margin-top: 1px; color: #e8f1fa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ah-bonus { position: absolute; left: calc(50% + 74px); top: 12px; font: 800 22px/1 system-ui, sans-serif; color: #6fe06f; text-shadow: 0 1px 4px #000; opacity: 0; transform: translateY(6px); }
.ah-bonus.bad { color: #ff7a5c; }
.ah-bonus.show { animation: ah-bonus 1.6s ease-out forwards; }
@keyframes ah-bonus { 0% { opacity: 0; transform: translateY(8px) scale(.7); } 12% { opacity: 1; transform: none; } 70% { opacity: 1; } 100% { opacity: 0; transform: translateY(-6px); } }
.ah-white { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
.ah-white.go { animation: ah-white .3s ease-out; }
@keyframes ah-white { 0% { opacity: .45; } 100% { opacity: 0; } }
.ah-flash { position: absolute; left: 50%; top: 36%; transform: translate(-50%, -50%) scale(.6); font: 900 40px/1.1 system-ui, sans-serif; text-align: center; text-shadow: 0 2px 6px #000, 0 0 3px #000; opacity: 0; transition: opacity .15s, transform .15s; white-space: nowrap; }
.ah-flash.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.ah-flash small { display: block; font-size: 20px; font-weight: 700; }
.ah-count { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); font: 900 120px/1 system-ui, sans-serif; text-shadow: 0 3px 10px #000; color: #ffd166; display: none; }
.ah-sum { position: fixed; inset: 0; z-index: 60; display: none; overflow-y: auto; background: rgba(10, 14, 20, .86); color: #fff; font-family: system-ui, sans-serif; pointer-events: auto; touch-action: pan-y; }
.ah-sum .card { margin: 8px auto; width: min(96vw, 820px); box-sizing: border-box; padding: 14px 18px 16px; border-radius: 14px; background: rgba(15, 30, 45, .97); }
.ah-sum h2 { margin: 0 0 4px; font-size: 22px; } .ah-sum h2 small { color: #9fb3c8; font-weight: 400; font-size: 14px; margin-left: 8px; }
.ah-sum .big { font-size: 40px; font-weight: 900; color: #ffd166; line-height: 1.1; } .ah-sum .stars { font-size: 26px; color: #ffd166; letter-spacing: 2px; }
.ah-sum .rec { color: #6fe06f; font-weight: 700; margin: 2px 0 6px; } .ah-sum .prev { color: #9fb3c8; font-size: 13px; }
.ah-sum table { border-collapse: collapse; font-size: 14px; margin: 6px 0; } .ah-sum td { padding: 2px 14px 2px 0; } .ah-sum td:first-child { color: #9fb3c8; }
.ah-sum .gates { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 6px 14px; margin: 8px 0; }
.ah-sum .g { padding: 6px 10px; border-radius: 10px; background: rgba(255, 255, 255, .06); font-size: 13px; } .ah-sum .g b { display: block; font-size: 14px; color: #ffd166; } .ah-sum .g i { color: #9fb3c8; font-style: normal; }
.ah-sum .g.exact { border-left: 4px solid #6fe06f; } .ah-sum .g.good { border-left: 4px solid #ffd166; } .ah-sum .g.ok { border-left: 4px solid #9fb3c8; } .ah-sum .g.missed { border-left: 4px solid #ff7a5c; opacity: .75; }
.ah-sum .btns { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
.ah-sum button, .ah-sum a.b { font: 700 16px system-ui, sans-serif; min-height: 48px; padding: 10px 20px; border-radius: 12px; border: 2px solid #ffd166; background: rgba(16, 22, 28, .9); color: #ffd166; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; touch-action: manipulation; }
.ah-sum button.main { background: #ffd166; color: #222; }
.ah-sum a.b.book { border-color: #25d366; color: #25d366; opacity: 0; transition: opacity .4s; } .ah-sum a.b.book.show { opacity: 1; }
.ah-sum .note { color: #9fb3c8; font-size: 13px; margin-top: 10px; }
`;
const el = (tag, cls, text, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };
const KIND = { exact: 'Точно!', good: 'Добре', ok: 'Є', missed: 'Пропущено' };

// onAgain(), onTour(), bookLink: string | null (null = the number is not set yet), showSpeed: PC (the phone shows its own)
export function createArcadeHud({ onAgain, onTour, bookLink, showSpeed, onBookMissing }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const root = el('div', 'ah', null, document.body);
  const clockEl = el('div', 'ah-clock', '0:00', root);
  const tips = el('div', 'ah-tips', null, root); const pocket = el('span', 'pk', '0 €', tips); const stake = el('span', 'st', '', tips); const combo = el('span', 'cb', '', tips);
  const bonus = el('div', 'ah-bonus', '', root);
  const gate = el('div', 'ah-gate', '', root);
  const speed = showSpeed ? el('div', 'ah-speed', null, root) : null; const speedNum = speed ? el('b', null, '0', speed) : null; if (speed) el('span', null, 'км/год', speed);
  const card = el('div', 'ah-card', null, root); const cardT = el('div', 't', '', card), cardF = el('div', 'f', '', card);
  const white = el('div', 'ah-white', null, root);
  const flash = el('div', 'ah-flash', null, root);
  const count = el('div', 'ah-count', '3', root);
  const sum = el('div', 'ah-sum', null, document.body);
  let flashTimer = 0, cardId = null, last = {};
  const set = (node, text) => { if (last[node.className] !== text) { node.textContent = text; last[node.className] = text; } };

  return {
    show(on) { root.classList.toggle('on', !!on); if (!on) { sum.style.display = 'none'; card.classList.remove('show'); cardId = null; } },
    setCountdown(n) { count.style.display = n == null ? 'none' : 'block'; if (n != null) count.textContent = n > 0 ? String(n) : 'ЇДЬ!'; },
    // s: { timeLeft, pocket, stake, combo, kmh, gateIndex, gateCount, gateTitle, card: { id, title, text } | null }
    update(s) {
      const tl = Math.max(0, s.timeLeft);
      set(clockEl, isFinite(tl) ? `${Math.floor(tl / 60)}:${String(Math.floor(tl % 60)).padStart(2, '0')}` : '--:--');
      clockEl.classList.toggle('low', tl < 10 && isFinite(tl));
      set(pocket, euro(s.pocket)); set(stake, s.stake > 0.5 ? ` +${euro(s.stake)} на кону` : ''); set(combo, s.combo > 1 ? `×${s.combo}` : '');
      set(gate, s.gateTitle ? `${s.gateIndex + 1}/${s.gateCount} · ${s.gateTitle}${s.gateDist != null ? ' · ' + (s.gateDist < 1000 ? Math.round(s.gateDist / 10) * 10 + ' м' : (s.gateDist / 1000).toFixed(1) + ' км') : ''}` : '');
      if (speedNum) set(speedNum, String(Math.round(Math.abs(s.kmh))));
      const c = s.card;
      // the card appears when a gate is passed, stays a few seconds (arcade.js), then fades out smoothly (CSS); the text stays while it fades
      if ((c ? c.id : null) !== cardId) { cardId = c ? c.id : null; if (c) { cardT.textContent = c.title; cardF.textContent = c.text || ''; card.classList.add('show'); } else card.classList.remove('show'); }
    },
    // a short white flash of the whole screen (a gate passed)
    flashScreen() { white.classList.remove('go'); void white.offsetWidth; white.classList.add('go'); },
    // seconds won / lost flash next to the clock
    bonusTime(sec) {
      if (!sec) return;
      bonus.textContent = `${sec > 0 ? '+' : '−'}${Math.round(Math.abs(sec))} с`; bonus.classList.toggle('bad', sec < 0);
      bonus.classList.remove('show'); void bonus.offsetWidth; bonus.classList.add('show');
    },
    flashGate(ev) {
      const k = ev.kind;
      flash.innerHTML = '';
      el('div', null, ev.finish ? 'ФІНІШ!' : KIND[k], flash).style.color = k === 'exact' ? '#6fe06f' : k === 'good' ? '#ffd166' : k === 'ok' ? '#cfe3f5' : '#ff7a5c';
      if (k !== 'missed') el('small', null, `+${euro(ev.tips)}${ev.time ? ` · +${Math.round(ev.time)} с` : ''}`, flash);
      else el('small', null, 'ворота пропущено', flash);
      flash.classList.add('show'); clearTimeout(flashTimer); flashTimer = setTimeout(() => flash.classList.remove('show'), 1300);
    },
    flashText(text, color = '#ff7a5c') { flash.innerHTML = ''; el('div', null, text, flash).style.color = color; flash.classList.add('show'); clearTimeout(flashTimer); flashTimer = setTimeout(() => flash.classList.remove('show'), 1200); },
    // r: Arcade result; gates: [{ title, text, kind }]; best: { tips, stars, time } | null; isRecord
    summary(r, { gates, best, isRecord, tourTitle }) {
      sum.innerHTML = '';
      const c = el('div', 'card', null, sum);
      const h = el('h2', null, r.state === 'timeout' ? 'Час вийшов' : 'Фініш!', c); el('small', null, `Crazy Tuk · ${tourTitle}`, h);
      el('div', 'big', euro(r.tips), c);
      el('div', 'stars', '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars), c);
      if (isRecord) el('div', 'rec', '🏆 Новий рекорд!', c);
      if (best && !isRecord) el('div', 'prev', `Твій рекорд: ${euro(best.tips)} · ${'★'.repeat(best.stars)}`, c);
      const tbl = el('table', null, null, c);
      const row = (k, v) => { const tr = el('tr', null, null, tbl); el('td', null, k, tr); el('td', null, v, tr); };
      row('Час', fmtClock(r.time) + (r.state === 'finished' ? ` · лишилось ${Math.round(r.timeLeft)} с → +${euro(r.bonus)}` : ''));
      row('Ворота', `точно ${r.exact} · добре ${r.good} · є ${r.ok} · пропущено ${r.missed} з ${r.gates}`);
      row('Максимум', `${r.maxKmh} км/год`); row('Удари', String(r.hits)); row('Шлях', `${(r.dist / 1000).toFixed(1)} км`);
      const gl = el('div', 'gates', null, c);
      for (const g of gates) { const d = el('div', 'g ' + (g.kind || 'missed'), null, gl); el('b', null, g.title, d); el('i', null, (KIND[g.kind] || 'не дістались') + (g.text ? ' · ' : ''), d); d.append(g.text || ''); }
      const btns = el('div', 'btns', null, c);
      const again = el('button', 'main', 'Ще раз', btns); again.addEventListener('click', onAgain);
      const tourB = el('button', null, 'Справжній тур', btns); tourB.addEventListener('click', onTour);
      const book = el('a', 'b book', 'Забронювати справжній тур', btns);
      if (bookLink) { book.href = bookLink; book.target = '_blank'; book.rel = 'noopener'; }
      else { book.href = '#'; book.addEventListener('click', (e) => { e.preventDefault(); if (onBookMissing) onBookMissing(); }); }
      setTimeout(() => book.classList.add('show'), 1500);   // not before a stray tap can land on it
      el('div', 'note', 'Це гра. На справжньому турі ми не ламаємо стіни, але драйв той самий 😉', c);
      sum.style.display = 'block'; sum.scrollTop = 0;
    },
    hideSummary() { sum.style.display = 'none'; },
    get summaryOpen() { return sum.style.display === 'block'; },
  };
}
