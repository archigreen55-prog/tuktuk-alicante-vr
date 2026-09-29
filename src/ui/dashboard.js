// Dashboard panel (canvas texture): speed, tour status, compass dial, messages, "on the way" facts,
// the fact card at a stop, the tour summary, optional FPS stats, OSM attribution, build version.
// The canvas is redrawn only when what it shows changes (at most as often as main calls draw()).
// The compass arrow is a separate small mesh in the panel plane, turned every frame (no redraw).
import * as THREE from 'three';

const W = 768, H = 384;           // canvas px
const PW = 0.50, PH = 0.25;       // panel size, m
const DIAL = { x: 668, y: 96, r: 74 };
const FONT = 'system-ui, sans-serif';

export class Dashboard {
  constructor(version = '') {
    this.version = version;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshBasicMaterial({ map: this.texture }));
    this.mesh.name = 'dashboard';
    this.showFps = false;
    this.sig = '';
    // compass arrow on the dial (points up = target straight ahead)
    const s = new THREE.Shape();
    s.moveTo(0, 0.042); s.lineTo(0.026, 0.004); s.lineTo(0.01, 0.008); s.lineTo(0.01, -0.036);
    s.lineTo(-0.01, -0.036); s.lineTo(-0.01, 0.008); s.lineTo(-0.026, 0.004); s.closePath();
    this.arrowMat = new THREE.MeshBasicMaterial({ color: 0xffcc33 });
    this.arrow = new THREE.Mesh(new THREE.ShapeGeometry(s), this.arrowMat);
    this.arrow.name = 'compass arrow';
    this.arrow.position.set((DIAL.x / W - 0.5) * PW, (0.5 - DIAL.y / H) * PH, 0.002);
    this.arrow.visible = false;
    this.mesh.add(this.arrow);
    this.draw({ speed: 0 });
  }

  // angle: bearing of the target relative to the heading (rad, + = to the right); null hides it
  setArrow(angle, color = 0xffcc33) {
    if (angle == null) { this.arrow.visible = false; return; }
    this.arrow.visible = true;
    this.arrow.rotation.z = -angle;
    this.arrowMat.color.setHex(color);
  }

  // s: { speed, msg, msgColor, stats: { fps, hz, calls, tris, gpuMs, cpuMs, stress } (when shown),
  //      tour: null | { mode: 'drive' | 'card' | 'summary', ... } } (see main.js tourPanel())
  draw(s) {
    const sig = JSON.stringify([Math.round(Math.abs(s.speed || 0) * 3.6), (s.speed || 0) < -0.1, s.msg, s.msgColor, this.showFps && s.stats, s.tour]);
    if (sig === this.sig) return false;
    this.sig = sig;
    const g = this.ctx;
    g.fillStyle = '#10161c'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#f2c230'; g.lineWidth = 5; g.strokeRect(2.5, 2.5, W - 5, H - 5);
    const t = s.tour;
    if (t && t.mode === 'card') this.drawCard(g, t);
    else if (t && t.mode === 'summary') this.drawSummary(g, t);
    else this.drawDrive(g, s, t);
    // footer: attribution + version
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left'; g.font = `15px ${FONT}`; g.fillStyle = '#7f93a6';
    g.fillText('© OpenStreetMap contributors · рельєф © IGN (CNIG)', 16, H - 12);
    if (this.version) { g.textAlign = 'right'; g.fillText('v' + this.version, W - 14, H - 12); }
    this.texture.needsUpdate = true;
    return true;
  }

  drawDrive(g, s, t) {
    // speed
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffffff'; g.font = `bold 96px ${FONT}`; g.textAlign = 'right';
    g.fillText(String(Math.round(Math.abs(s.speed || 0) * 3.6)), 190, 112);
    g.textAlign = 'left'; g.font = `bold 28px ${FONT}`; g.fillStyle = '#f2c230'; g.fillText('km/h', 198, 110);
    if ((s.speed || 0) < -0.1) { g.fillStyle = '#ff8a5c'; g.fillText('R', 272, 110); }
    if (t) {
      // status: stop i/N or the next point, distance, clock
      g.fillStyle = '#9fb3c8'; g.font = `22px ${FONT}`;
      g.fillText(t.line1 || '', 312, 46);
      g.fillStyle = '#ffffff';
      fitText(g, t.title || '', 312, 84, 262, 30, 18, 'bold ');
      g.font = `24px ${FONT}`; g.fillStyle = '#cfe3f5';
      g.fillText(t.line3 || '', 312, 122);
      // compass dial
      if (t.dial) {
        g.strokeStyle = '#34495e'; g.lineWidth = 4;
        g.beginPath(); g.arc(DIAL.x, DIAL.y, DIAL.r, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#34495e'; g.beginPath(); g.arc(DIAL.x, DIAL.y - DIAL.r, 6, 0, Math.PI * 2); g.fill();
      }
      // mood + tips
      if (t.mood != null) {
        const col = moodColor(t.mood);
        for (let i = 0; i < t.group; i++) { g.fillStyle = col; g.beginPath(); g.arc(30 + i * 30, 172, 11, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = '#cfe3f5'; g.font = `24px ${FONT}`; g.textAlign = 'left';
        g.fillText(`Настрій ${Math.round(t.mood)} %`, 30 + t.group * 30 + 8, 181);
        g.textAlign = 'right'; g.fillText(`Чайові ≈ ${euro(t.tips)}`, W - 20, 181);
      } else if (t.hint) {
        g.fillStyle = '#cfe3f5'; g.font = `24px ${FONT}`; g.textAlign = 'left';
        fitText(g, t.hint, 20, 181, W - 40, 24, 16, '');
      }
    }
    // message line
    if (s.msg) {
      g.textAlign = 'center'; g.fillStyle = s.msgColor || '#ff9f43';
      fitText(g, s.msg, W / 2, 228, W - 40, 30, 16, 'bold ', 'center');
    }
    // "on the way" fact / intro
    if (t && t.text) {
      g.textAlign = 'left'; g.fillStyle = '#f2c230';
      fitText(g, t.text.title, 20, 266, W - 40, 24, 16, 'bold ');
      g.fillStyle = '#ffffff';
      wrapFit(g, t.text.body, 20, 276, W - 40, 60, 24, 16);
    }
    // stats (F / X)
    if (this.showFps && s.stats) {
      const st = s.stats, target = st.hz || 72;
      const ms = (v) => (v == null ? 'н/д' : v.toFixed(1));
      g.textAlign = 'right'; g.font = `bold 22px ${FONT}`;
      g.fillStyle = st.fps >= target - 2 ? '#6fe06f' : st.fps >= target * 0.8 ? '#ffd166' : '#ff5c5c';
      const line = `${Math.round(st.fps)} FPS · GPU ${ms(st.gpuMs)} · CPU ${ms(st.cpuMs)} · ${st.hz ? st.hz + ' Гц · ' : ''}${st.calls} calls · ${(st.tris / 1000).toFixed(0)}k${st.stress > 1 ? ` · ×${st.stress}` : ''}`;
      g.fillText(line, W - 16, t ? 352 : 300);
    }
  }

  drawCard(g, t) {
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = '#f2c230';
    fitText(g, t.title, 20, 50, W - 150, 34, 20, 'bold ');
    g.textAlign = 'right'; g.fillStyle = '#9fb3c8'; g.font = `24px ${FONT}`;
    g.fillText(t.counter || '', W - 20, 48);
    g.textAlign = 'left'; g.fillStyle = '#ffffff';
    wrapFit(g, t.body || '', 20, 70, W - 40, t.credit ? 212 : 250, 32, 18);
    if (t.credit) { g.fillStyle = '#9fb3c8'; wrapFit(g, t.credit, 20, 286, W - 40, 42, 17, 13); } // photo authors (licences)
    g.fillStyle = '#6fe06f';
    fitText(g, t.footer || '', 20, 350, W - 40, 26, 16, 'bold ');
  }

  drawSummary(g, t) {
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = '#f2c230'; g.font = `bold 34px ${FONT}`; g.fillText('Тур завершено!', 20, 50);
    g.textAlign = 'right'; g.fillStyle = '#ffd166'; g.font = `bold 40px ${FONT}`;
    g.fillText('★'.repeat(t.stars) + '☆'.repeat(5 - t.stars), W - 20, 52);
    g.textAlign = 'left'; g.font = `26px ${FONT}`;
    g.fillStyle = '#ffffff'; g.fillText(`Чайові ${euro(t.tips)}`, 20, 96);
    g.fillStyle = t.onTime === 'yes' ? '#6fe06f' : t.onTime === 'almost' ? '#ffd166' : '#ff7a5c';
    g.textAlign = 'right'; g.fillText(`Час ${clock(t.time)} / ${clock(t.target)} — ${t.onTime === 'yes' ? 'вчасно' : t.onTime === 'almost' ? 'трохи довше' : 'запізнення'}`, W - 20, 96);
    g.textAlign = 'left'; g.fillStyle = '#cfe3f5';
    wrapFit(g, t.events, 20, 112, W - 40, 64, 24, 16);
    g.fillStyle = '#ffffff';
    wrapFit(g, t.review ? `«${t.review}»` : '', 20, 182, W - 40, 70, 26, 16, 'italic ');
    g.fillStyle = '#9fb3c8';
    fitText(g, t.best || '', 20, 290, W - 40, 22, 14, '');
    g.fillStyle = '#6fe06f';
    fitText(g, t.footer || '', 20, 336, W - 40, 26, 16, 'bold ');
  }
}

export function euro(v) { return `${Number(v).toFixed(2).replace(/\.00$/, '')} €`; }
export function clock(s) { s = Math.max(0, Math.round(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
export function moodColor(m) { return m >= 80 ? '#6fe06f' : m >= 55 ? '#ffd166' : m >= 35 ? '#ff9f43' : '#ff5c5c'; }

// one line, font shrinks until it fits
function fitText(g, text, x, y, maxW, size, min, style = '', align) {
  if (!text) return;
  let s = size;
  do { g.font = `${style}${s}px ${FONT}`; s -= 1; } while (g.measureText(text).width > maxW && s >= min);
  if (align) g.textAlign = align;
  let out = text;
  if (g.measureText(out).width > maxW) { while (out.length > 1 && g.measureText(out + '…').width > maxW) out = out.slice(0, -1); out += '…'; }
  g.fillText(out, x, y);
}

// wrapped text in a box (top y, height h): the biggest font from size down to min that fits;
// paragraphs split on \n; cut with an ellipsis if even the smallest font does not fit
function wrapFit(g, text, x, top, maxW, h, size, min, style = '') {
  if (!text) return;
  let lines = [], s = size;
  for (; s >= min; s -= 1) {
    g.font = `${style}${s}px ${FONT}`;
    lines = wrap(g, text, maxW);
    if (lines.length * s * 1.22 <= h) break;
  }
  s = Math.max(s, min);
  const lh = s * 1.22, maxLines = Math.max(1, Math.floor(h / lh));
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + ' …'; }
  g.textBaseline = 'top';
  lines.forEach((l, i) => g.fillText(l, x, top + i * lh));
  g.textBaseline = 'alphabetic';
}
function wrap(g, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (g.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}
