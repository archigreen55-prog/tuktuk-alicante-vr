// Desktop copy of the tour UI (stage 6): on a laptop the dashboard in the cockpit view is too small
// to read, so the tour status, the fact card / summary and a heading-up minimap are also shown as
// HTML. Hidden in VR (the headset shows the dashboard).
import { euro, clock, moodColor } from './dashboard.js';
import { t } from '../i18n.js';

export class DesktopHud {
  constructor(minimap) {
    this.minimap = minimap;
    this.status = document.getElementById('tourHud');
    this.card = document.getElementById('tourCard');
    this.canvas = document.getElementById('miniMap');
    this.g = this.canvas.getContext('2d');
    this.showMap = true;
    this.lastStatus = ''; this.lastCard = '';
  }

  // panel: the same object as the dashboard's tour state (or null in free ride)
  update(visible, panel) {
    const show = (el, on) => { el.style.display = on ? 'block' : 'none'; };
    show(this.status, visible && panel && panel.mode === 'drive');
    show(this.card, visible && panel && (panel.mode === 'card' || panel.mode === 'summary' || !!panel.text));
    if (!visible || !panel) return;
    let status = '';
    if (panel.mode === 'drive') {
      status = `<div class="l1">${esc(panel.line1 || '')}</div><div class="l2">${esc(panel.title || '')}</div><div class="l3">${esc(panel.line3 || '')}</div>`;
      if (panel.mood != null) status += `<div class="l4"><span style="color:${moodColor(panel.mood)}">●</span> ${t('dash.mood', { v: Math.round(panel.mood) })} · ${t('dash.tips', { v: euro(panel.tips) })}</div>`;
      else if (panel.hint) status += `<div class="l4">${esc(panel.hint)}</div>`;
    }
    if (status !== this.lastStatus) { this.status.innerHTML = status; this.lastStatus = status; }
    let card = '';
    if (panel.mode === 'card') card = `<div class="t">${esc(panel.title)} <span class="c">${esc(panel.counter || '')}</span></div><div class="b">${esc(panel.body || '')}</div>${panel.credit ? `<div class="c">${esc(panel.credit)}</div>` : ''}<div class="f">${esc(panel.footer || '')}</div>`;
    else if (panel.mode === 'summary') {
      card = `<div class="t">${t('dash.tourDone')} <span class="s">${'★'.repeat(panel.stars)}${'☆'.repeat(5 - panel.stars)}</span></div>` +
        `<div class="b">${t('dash.tipsV', { v: euro(panel.tips) })} · ${t('dash.time')} ${clock(panel.time)} / ${clock(panel.target)}<br>${esc(panel.events)}<br><i>${panel.review ? '«' + esc(panel.review) + '»' : ''}</i><br><span class="c">${esc(panel.best || '')}</span></div><div class="f">${esc(panel.footer || '')}</div>`;
    } else if (panel.text) card = `<div class="t">${esc(panel.text.title)}</div><div class="b">${esc(panel.text.body)}</div>`;
    if (card !== this.lastCard) { this.card.innerHTML = card; this.lastCard = card; this.card.className = panel.mode === 'card' ? 'mode-card' : panel.mode === 'summary' ? 'mode-summary' : 'mode-text'; }
  }

  // heading-up map in the corner (desktop only), ~10 Hz from main
  // gates (Crazy Tuk): { list: [{ x, z }] the gates still ahead, next: index in the list } - small marks, the next one bigger and
  // blinking, on the rim when it is out of the disc. No route line there: the player picks the streets.
  drawMap(visible, x, z, heading, target, route, gates = null) {
    this.canvas.style.display = visible && this.showMap ? 'block' : 'none';
    if (!visible || !this.showMap) return;
    const g = this.g, S = this.canvas.width, R = this.minimap.rect, radius = this.minimap.radius;
    const scale = (S / 2) / radius; // px per metre
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#dcd1bb'; g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    g.rotate(heading);                      // heading-up: forward (-sin h, -cos h) points up
    g.scale(scale, scale);
    g.translate(-x, -z);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.minimap.mapCanvas, R.minX, R.minZ, R.maxX - R.minX, R.maxZ - R.minZ);
    if (route && route.length > 1) {
      g.strokeStyle = 'rgba(255,190,0,0.95)'; g.lineWidth = 9; g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath(); route.forEach(([px, pz], i) => (i ? g.lineTo(px, pz) : g.moveTo(px, pz))); g.stroke();
    }
    if (target) { g.fillStyle = '#ff4020'; g.beginPath(); g.arc(target.x, target.z, 9, 0, Math.PI * 2); g.fill(); }
    const blink = performance.now() % 700 < 440;
    if (gates) {
      const m = 0.35 / scale;   // keeps the marks the same size on screen whatever the radius
      gates.list.forEach((p, i) => {
        if (i === gates.next) return;
        g.fillStyle = 'rgba(255,209,102,0.95)'; g.strokeStyle = '#10161c'; g.lineWidth = 2 * m;
        g.beginPath(); g.arc(p.x, p.z, 11 * m, 0, Math.PI * 2); g.fill(); g.stroke();
      });
      for (const v of gates.vias || []) { g.fillStyle = 'rgba(255,255,255,0.9)'; g.strokeStyle = '#10161c'; g.lineWidth = 1.5 * m; g.beginPath(); g.arc(v.x, v.z, 6 * m, 0, Math.PI * 2); g.fill(); g.stroke(); }   // via points: small, no grade
      const n = gates.list[gates.next];
      if (n) {
        g.strokeStyle = '#10161c'; g.lineWidth = 3 * m;
        g.fillStyle = blink ? '#ff4020' : '#ffd166';
        g.beginPath(); g.arc(n.x, n.z, 20 * m, 0, Math.PI * 2); g.fill(); g.stroke();
        g.strokeStyle = blink ? 'rgba(255,64,32,0.8)' : 'rgba(255,209,102,0.0)'; g.lineWidth = 4 * m;
        g.beginPath(); g.arc(n.x, n.z, 34 * m, 0, Math.PI * 2); g.stroke();
      }
    }
    g.restore();
    if (gates && gates.list[gates.next]) {
      // the next gate outside the disc: a blinking arrow on the rim
      const n = gates.list[gates.next], dx = n.x - x, dz = n.z - z, c = Math.cos(heading), sn = Math.sin(heading);
      const sx = dx * c - dz * sn, sy = dx * sn + dz * c, d = Math.hypot(sx, sy) * scale;
      if (d > S / 2 - 14) {
        const a = Math.atan2(sy, sx), rr = S / 2 - 14;
        g.save(); g.translate(S / 2 + Math.cos(a) * rr, S / 2 + Math.sin(a) * rr); g.rotate(a);
        g.fillStyle = blink ? '#ff4020' : '#ffd166'; g.strokeStyle = '#10161c'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(10, 0); g.lineTo(-7, 8); g.lineTo(-7, -8); g.closePath(); g.fill(); g.stroke(); g.restore();
      }
    }
    // player arrow + rim
    g.fillStyle = '#3388ff'; g.strokeStyle = '#111';
    g.beginPath(); g.moveTo(S / 2, S / 2 - 12); g.lineTo(S / 2 + 8, S / 2 + 9); g.lineTo(S / 2 - 8, S / 2 + 9); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = '#10161c'; g.lineWidth = 4; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.stroke();
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/\n/g, '<br>'); }
