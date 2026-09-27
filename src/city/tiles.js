// Texture tiles drawn by code on a canvas at load time (stage 5 plan, section 2): no image files.
//
// Facade tiles are MASKS, not colours (plan 2.3): R = shade (x1.275), G = plaster weight,
// B = shutter weight, A = glass weight; the remainder is metal. The shader multiplies the weights by
// the building's plaster colour, its shutter colour, a sky-tinted glass and a fixed metal grey, so one
// tile serves every building and the weights average correctly on mip levels.
// Ground tiles are plain colours (RGB, mean level ~196 = "neutral", the shader scales by 1.3 and
// tints with the vertex colour); road-marking tiles are white with alpha.
// All tiles go into WebGL2 texture arrays (DataArrayTexture) so every layer tiles with REPEAT and
// has mip levels + anisotropic filtering.
import * as THREE from 'three';

export const TILE = 256;
export const MOSAIC_SIZE = 512;

// Facade layers (index = layer in the facade array). Keep in sync with the GLSL in facades.js.
export const F = {
  PLAIN: 0, ROOF: 1, CORNICE: 2, PARAPET: 3, COURT: 4,
  ENS_A: 5, ENS_B: 6, ENS_C: 7, ENS_BAL: 8, ENS_DOOR_A: 9, ENS_DOOR_B: 10,
  CLS_A: 11, CLS_B: 12, CLS_DOOR: 13, OLD_A: 14, OLD_B: 15, TOWER: 16, TOWER_B: 17, OFFICE: 18,
  CIVIC: 19, CIVIC_WALL: 20,
  SHOP_A: 21, SHOP_B: 22, SHOP_C: 23, ENTRANCE: 24, GARAGE: 25, GROUND_WIN: 26, CIVIC_GROUND: 27, GLASS_GROUND: 28,
};
export const FACADE_LAYERS = 29;
// Ground layers.
export const G = { ASPHALT: 0, COBBLE: 1, PAVING: 2, PAVING_PED: 3, M2W2: 4, M1W1: 5, M1W2: 6, M1W3: 7, M1W4: 8, M2W4: 9, ZEBRA: 10 };
export const GROUND_LAYERS = 11;
// Metres covered by one tile
export const BAY_W = 3.3;                  // facade tiles: one bay wide
export const MARK_PERIOD = 8;              // road markings: 8 m along (2 m dash, 6 m gap)
export const ZEBRA_DEPTH = 3;              // m along the road
// Explanada mosaic (plan 2.6): transverse wavy stripes red / cream / black / cream, repeating along
// the promenade. One tile = one stripe cycle along x one wave period across.
export const MOSAIC = {
  stripes: ['#8e2a2a', '#e9dcc4', '#1e1c1c', '#e9dcc4'], // red (rojo Alicante), cream, black, cream
  stripeWidth: 1.0,   // m, along the promenade
  waveLength: 6.0,    // m, across the promenade
  amplitude: 0.45,    // m
  tessera: 0.06,      // m, small tile grid
};
export const MOSAIC_ALONG = MOSAIC.stripes.length * MOSAIC.stripeWidth; // m covered by the tile along
export const MOSAIC_ACROSS = MOSAIC.waveLength;                          // m covered across

// ---------- painter: two canvases (material weights, shade), tile units 0..1 with v up ----------
const MAT = { plaster: 'rgb(255,0,0)', shutter: 'rgb(0,255,0)', glass: 'rgb(0,0,255)', metal: 'rgb(0,0,0)' };
const SHADE_SCALE = 200; // byte = shade * 200, so shades up to 1.27 fit

class Painter {
  constructor(size = TILE, bayW = BAY_W, bayH = 3.0) {
    this.s = size;
    this.bayW = bayW; this.bayH = bayH; // metres covered by the tile (for metre-based drawing)
    this.m = document.createElement('canvas'); this.m.width = this.m.height = size;
    this.h = document.createElement('canvas'); this.h.width = this.h.height = size;
    this.mc = this.m.getContext('2d', { willReadFrequently: true }); this.hc = this.h.getContext('2d', { willReadFrequently: true });
  }
  // rectangle in metres (x from the left, y from the bottom)
  rect(x, y, w, h, mat, shade = 1) {
    const s = this.s, X = (x / this.bayW) * s, W = (w / this.bayW) * s, H = (h / this.bayH) * s, Y = s - ((y + h) / this.bayH) * s;
    this.mc.fillStyle = MAT[mat]; this.mc.fillRect(X, Y, W, H);
    this.hc.fillStyle = grey(shade); this.hc.fillRect(X, Y, W, H);
  }
  fill(mat, shade = 1) { this.rect(0, 0, this.bayW, this.bayH, mat, shade); }
  // vertical shade gradient over a rectangle (material unchanged)
  shadeGradient(x, y, w, h, shadeBottom, shadeTop) {
    const s = this.s, X = (x / this.bayW) * s, W = (w / this.bayW) * s, H = (h / this.bayH) * s, Y = s - ((y + h) / this.bayH) * s;
    const g = this.hc.createLinearGradient(0, Y + H, 0, Y);
    g.addColorStop(0, grey(shadeBottom)); g.addColorStop(1, grey(shadeTop));
    this.hc.fillStyle = g; this.hc.fillRect(X, Y, W, H);
  }
  // arch-topped opening (semicircle on top of a rectangle)
  arch(x, y, w, h, mat, shade = 1) {
    const s = this.s, X = (x / this.bayW) * s, W = (w / this.bayW) * s, Yb = s - (y / this.bayH) * s, Yt = s - ((y + h) / this.bayH) * s;
    const r = W / 2, ry = (w / 2 / this.bayH) * s; // the arch is a half ellipse in pixels (tile metres are not square)
    for (const [c, style] of [[this.mc, MAT[mat]], [this.hc, grey(shade)]]) {
      c.fillStyle = style; c.beginPath();
      c.moveTo(X, Yb); c.lineTo(X, Yt + ry); c.ellipse(X + r, Yt + ry, r, ry, 0, Math.PI, 0); c.lineTo(X + W, Yb); c.closePath(); c.fill();
    }
  }
  // horizontal lines (slats, joints): every `step` metres inside the rectangle, `t` metres thick
  hlines(x, y, w, h, step, t, mat, shade) { for (let yy = y; yy < y + h - 1e-6; yy += step) this.rect(x, yy, w, Math.min(t, y + h - yy), mat, shade); }
  vlines(x, y, w, h, step, t, mat, shade) { for (let xx = x; xx < x + w - 1e-6; xx += step) this.rect(xx, y, Math.min(t, x + w - xx), h, mat, shade); }
  // random speckle for gravel / stone (deterministic)
  speckle(count, size, shadeMin, shadeMax, mat = null, seed = 1) {
    let r = seed;
    const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
    for (let i = 0; i < count; i++) {
      const x = rnd() * this.bayW, y = rnd() * this.bayH, sh = shadeMin + rnd() * (shadeMax - shadeMin);
      const s = this.s, X = (x / this.bayW) * s, W = (size / this.bayW) * s, H = (size / this.bayH) * s, Y = s - (y / this.bayH) * s;
      this.hc.fillStyle = grey(sh); this.hc.fillRect(X, Y, W, H);
      if (mat) { this.mc.fillStyle = MAT[mat]; this.mc.fillRect(X, Y, W, H); }
    }
  }
  // -> RGBA bytes: R shade, G plaster, B shutter, A glass
  data() {
    const s = this.s, m = this.mc.getImageData(0, 0, s, s).data, h = this.hc.getImageData(0, 0, s, s).data;
    const out = new Uint8Array(s * s * 4);
    for (let i = 0; i < s * s; i++) { out[i * 4] = h[i * 4]; out[i * 4 + 1] = m[i * 4]; out[i * 4 + 2] = m[i * 4 + 1]; out[i * 4 + 3] = m[i * 4 + 2]; }
    return out;
  }
}
const grey = (shade) => { const v = Math.max(0, Math.min(255, Math.round(shade * SHADE_SCALE))); return `rgb(${v},${v},${v})`; };

// ---------- facade tile drawings (bay 3.3 m wide; floors 3.0 m high, ground 4.0 m) ----------
// Window: reveal shadow, frame (metal), glass. blind: 0..1 share of the opening covered by a blind (shutter material).
function windowBox(p, x, y, w, h, { frame = 0.05, blind = 0, glassShade = 1, frameShade = 0.95, reveal = 0.08 } = {}) {
  p.rect(x - reveal, y - reveal * 0.6, w + reveal * 2, h + reveal * 1.2, 'plaster', 0.62);           // reveal / shadow
  p.rect(x, y, w, h, 'metal', frameShade);                                                           // frame
  p.rect(x + frame, y + frame, w - frame * 2, h - frame * 2, 'glass', glassShade);
  p.rect(x + w / 2 - frame / 2, y + frame, frame, h - frame * 2, 'metal', frameShade);              // centre mullion
  if (blind > 0) {
    const bh = (h - frame * 2) * blind;
    p.rect(x + frame, y + h - frame - bh, w - frame * 2, bh, 'shutter', 0.92);
    p.hlines(x + frame, y + h - frame - bh, w - frame * 2, bh, 0.08, 0.018, 'shutter', 0.72);
  }
}
// wooden shutters (louvred) at both sides of an opening, or closed over it
function shutters(p, x, y, w, h, open) {
  if (open) {
    const sw = Math.min(0.45, w * 0.48);
    for (const xx of [x - sw - 0.02, x + w + 0.02]) { p.rect(xx, y, sw, h, 'shutter', 0.9); p.hlines(xx + 0.03, y + 0.05, sw - 0.06, h - 0.1, 0.1, 0.03, 'shutter', 0.68); }
  } else {
    p.rect(x, y, w, h, 'shutter', 0.88);
    p.hlines(x + 0.04, y + 0.05, w - 0.08, h - 0.1, 0.1, 0.03, 'shutter', 0.66);
    p.rect(x + w / 2 - 0.012, y, 0.024, h, 'shutter', 0.6);
  }
}
// painted balcony rail in front of the lower `rh` metres of an opening at x..x+w
function paintedRail(p, x, y, w, rh, shade = 0.28) {
  p.rect(x - 0.15, y - 0.16, w + 0.3, 0.16, 'plaster', 0.55);          // slab shadow
  p.rect(x - 0.15, y - 0.02, w + 0.3, 0.05, 'metal', 0.72);            // slab edge
  p.vlines(x - 0.12, y, w + 0.24, rh, 0.14, 0.03, 'metal', shade);      // bars
  p.rect(x - 0.15, y + rh - 0.04, w + 0.3, 0.04, 'metal', shade);       // handrail
}
function stoneJoints(p, step = 0.6, brick = 1.1) {
  p.hlines(0, 0, p.bayW, p.bayH, step, 0.02, 'plaster', 0.86);
  for (let row = 0, y = 0; y < p.bayH; y += step, row++) p.vlines((row % 2) * brick / 2, y, p.bayW, Math.min(step, p.bayH - y), brick, 0.02, 'plaster', 0.86);
}
function rollupShutter(p, x, y, w, h, shade = 0.8) {
  p.rect(x, y, w, h, 'metal', shade);
  p.hlines(x, y, w, h, 0.1, 0.03, 'metal', shade - 0.14);
}
function signBoard(p, x, y, w, h) {
  p.rect(x, y, w, h, 'metal', 0.34);
  p.rect(x + w * 0.2, y + h * 0.35, w * 0.6, h * 0.3, 'metal', 0.9); // light "lettering" band
}

const FLOOR = (fn) => { const p = new Painter(TILE, BAY_W, 3.0); p.fill('plaster', 1); fn(p); return p; };
const GROUND = (fn) => { const p = new Painter(TILE, BAY_W, 4.0); p.fill('plaster', 1); fn(p); return p; };

function drawFacadeTiles() {
  const T = new Array(FACADE_LAYERS);
  T[F.PLAIN] = FLOOR(() => {});
  T[F.ROOF] = FLOOR((p) => { p.fill('plaster', 0.9); p.speckle(900, 0.08, 0.72, 1.05, null, 7); });
  T[F.CORNICE] = FLOOR((p) => { // band of 0.9 m: shadow under the cornice, light lip, coping
    p.fill('plaster', 1);
    p.shadeGradient(0, 0, p.bayW, 1.5, 1.0, 0.55);
    p.rect(0, 1.5, p.bayW, 0.75, 'plaster', 1.15);
    p.rect(0, 2.25, p.bayW, 0.75, 'plaster', 0.92);
  });
  T[F.PARAPET] = FLOOR((p) => { p.fill('plaster', 0.97); p.rect(0, 0.9, p.bayW, 0.25, 'plaster', 0.7); p.rect(0, 2.75, p.bayW, 0.25, 'plaster', 1.1); });
  T[F.COURT] = FLOOR((p) => windowBox(p, 1.15, 1.05, 1.0, 1.2, { blind: 0.15 }));
  // Ensanche 60s-80s: aluminium window with a roller blind box, blinds in several states, balconies
  const ensWindow = (p, blind) => { p.rect(0.95, 2.3, 1.4, 0.28, 'plaster', 0.9); windowBox(p, 1.0, 1.0, 1.3, 1.3, { blind }); p.rect(0.9, 0.93, 1.5, 0.07, 'plaster', 1.1); };
  T[F.ENS_A] = FLOOR((p) => ensWindow(p, 0.08));
  T[F.ENS_B] = FLOOR((p) => ensWindow(p, 0.55));
  T[F.ENS_C] = FLOOR((p) => ensWindow(p, 1.0));
  T[F.ENS_BAL] = FLOOR((p) => { p.rect(0.85, 2.35, 1.6, 0.28, 'plaster', 0.9); windowBox(p, 0.9, 0.2, 1.5, 2.15, { blind: 0.2 }); paintedRail(p, 0.75, 0.2, 1.8, 1.0); });
  T[F.ENS_DOOR_A] = FLOOR((p) => { p.rect(0.85, 2.35, 1.6, 0.28, 'plaster', 0.9); windowBox(p, 0.9, 0.2, 1.5, 2.15, { blind: 0.1 }); });
  T[F.ENS_DOOR_B] = FLOOR((p) => { p.rect(0.85, 2.35, 1.6, 0.28, 'plaster', 0.9); windowBox(p, 0.9, 0.2, 1.5, 2.15, { blind: 0.6 }); });
  // Classic XIX c.: tall window-door, wooden shutters, small iron balcony, string course
  const clsFrame = (p) => { p.rect(0, 2.85, p.bayW, 0.15, 'plaster', 0.8); p.rect(1.0, 0.15, 1.3, 2.5, 'plaster', 1.12); };
  T[F.CLS_A] = FLOOR((p) => { clsFrame(p); windowBox(p, 1.1, 0.2, 1.1, 2.3, { frame: 0.06, frameShade: 0.5, glassShade: 0.85 }); shutters(p, 1.1, 0.2, 1.1, 2.3, true); paintedRail(p, 1.0, 0.2, 1.3, 0.95, 0.22); });
  T[F.CLS_B] = FLOOR((p) => { clsFrame(p); shutters(p, 1.1, 0.2, 1.1, 2.3, false); paintedRail(p, 1.0, 0.2, 1.3, 0.95, 0.22); });
  T[F.CLS_DOOR] = FLOOR((p) => { clsFrame(p); windowBox(p, 1.1, 0.2, 1.1, 2.3, { frame: 0.06, frameShade: 0.5, glassShade: 0.85 }); shutters(p, 1.1, 0.2, 1.1, 2.3, true); });
  // Old town: small window, shutters, whitewash
  T[F.OLD_A] = FLOOR((p) => { windowBox(p, 1.2, 1.2, 0.9, 1.1, { frame: 0.06, frameShade: 0.6 }); shutters(p, 1.2, 1.2, 0.9, 1.1, true); p.rect(1.1, 1.12, 1.1, 0.08, 'plaster', 1.1); });
  T[F.OLD_B] = FLOOR((p) => { p.rect(1.1, 1.12, 1.1, 0.08, 'plaster', 1.1); p.rect(1.2 - 0.08, 1.2 - 0.05, 0.9 + 0.16, 1.1 + 0.1, 'plaster', 0.62); shutters(p, 1.2, 1.2, 0.9, 1.1, false); });
  // Tower / hotel: ribbon glazing over a concrete band
  T[F.TOWER] = FLOOR((p) => { p.rect(0, 0, p.bayW, 0.9, 'plaster', 0.93); p.rect(0, 0.9, p.bayW, 1.75, 'metal', 0.85); p.rect(0.05, 0.95, p.bayW - 0.1, 1.65, 'glass', 1); p.vlines(0, 0.9, p.bayW, 1.75, 1.1, 0.06, 'metal', 0.85); p.rect(0, 2.65, p.bayW, 0.35, 'plaster', 0.93); });
  T[F.TOWER_B] = FLOOR((p) => { p.rect(0, 0, p.bayW, 0.9, 'plaster', 0.93); p.rect(0, 0.9, p.bayW, 1.75, 'metal', 0.85); p.rect(0.05, 0.95, p.bayW - 0.1, 1.65, 'shutter', 0.95); p.vlines(0, 0.9, p.bayW, 1.75, 1.1, 0.06, 'metal', 0.85); p.rect(0, 2.65, p.bayW, 0.35, 'plaster', 0.93); });
  // Office: curtain wall with dark mullions and spandrel glass
  T[F.OFFICE] = FLOOR((p) => { p.fill('metal', 0.35); p.rect(0.04, 0.04, p.bayW - 0.08, 0.86, 'glass', 0.55); p.rect(0.04, 0.96, p.bayW - 0.08, 2.0, 'glass', 1); p.vlines(1.65 - 0.03, 0, p.bayW, 3.0, 5, 0.06, 'metal', 0.35); });
  // Civic / church: tall arched window in ashlar stone
  T[F.CIVIC] = FLOOR((p) => { stoneJoints(p); p.arch(1.2, 0.5, 0.9, 2.2, 'plaster', 0.62); p.arch(1.28, 0.55, 0.74, 2.05, 'glass', 0.6); p.rect(1.28, 0.55, 0.74, 0.04, 'plaster', 0.62); });
  T[F.CIVIC_WALL] = FLOOR((p) => stoneJoints(p));
  // ---- ground floors (4.0 m) ----
  T[F.SHOP_A] = GROUND((p) => { p.rect(0.1, 0.0, 3.1, 3.55, 'metal', 0.4); p.rect(0.2, 0.3, 2.9, 2.6, 'glass', 0.95); p.rect(0.2, 0.0, 2.9, 0.3, 'metal', 0.5); signBoard(p, 0.1, 2.95, 3.1, 0.6); });
  T[F.SHOP_B] = GROUND((p) => { p.rect(0.1, 0.0, 3.1, 3.55, 'metal', 0.4); p.rect(0.2, 0.3, 2.9, 2.6, 'glass', 0.95); rollupShutter(p, 0.2, 1.5, 2.9, 1.4, 0.82); signBoard(p, 0.1, 2.95, 3.1, 0.6); });
  T[F.SHOP_C] = GROUND((p) => { p.rect(0.1, 0.0, 3.1, 3.55, 'metal', 0.4); rollupShutter(p, 0.2, 0.0, 2.9, 2.9, 0.78); signBoard(p, 0.1, 2.95, 3.1, 0.6); });
  T[F.ENTRANCE] = GROUND((p) => {
    p.rect(0.85, 0, 1.6, 2.7, 'plaster', 0.88);                         // stone surround
    p.rect(1.0, 0, 1.3, 2.5, 'shutter', 0.75);                          // wooden door
    p.hlines(1.06, 0.3, 1.18, 2.0, 0.55, 0.04, 'shutter', 0.5); p.rect(1.63, 0, 0.04, 2.5, 'shutter', 0.5);
    p.rect(1.08, 1.95, 1.14, 0.45, 'glass', 0.8);                       // transom light
    p.rect(2.55, 2.9, 0.7, 0.5, 'plaster', 0.62); p.rect(2.6, 2.95, 0.6, 0.4, 'glass', 0.9);  // small windows
    p.rect(0.05, 2.9, 0.7, 0.5, 'plaster', 0.62); p.rect(0.1, 2.95, 0.6, 0.4, 'glass', 0.9);
    p.rect(0, 3.8, p.bayW, 0.2, 'plaster', 0.85);
  });
  T[F.GARAGE] = GROUND((p) => { p.rect(0.3, 0, 2.7, 2.6, 'metal', 0.45); rollupShutter(p, 0.4, 0, 2.5, 2.5, 0.74); p.rect(0, 3.8, p.bayW, 0.2, 'plaster', 0.85); });
  T[F.GROUND_WIN] = GROUND((p) => { windowBox(p, 1.1, 1.4, 1.1, 1.25, { blind: 0.3 }); p.vlines(1.05, 1.35, 1.2, 1.35, 0.15, 0.03, 'metal', 0.3); p.rect(1.05, 1.35, 1.2, 0.03, 'metal', 0.3); p.rect(1.05, 2.67, 1.2, 0.03, 'metal', 0.3); p.rect(0, 3.8, p.bayW, 0.2, 'plaster', 0.85); });
  T[F.CIVIC_GROUND] = GROUND((p) => { stoneJoints(p, 0.7, 1.4); p.arch(0.75, 0, 1.8, 3.4, 'plaster', 1.1); p.arch(0.9, 0, 1.5, 3.2, 'metal', 0.28); p.hlines(0.95, 0.3, 1.4, 2.6, 0.5, 0.04, 'metal', 0.18); });
  T[F.GLASS_GROUND] = GROUND((p) => { p.fill('metal', 0.35); p.rect(0.05, 0.1, p.bayW - 0.1, 3.4, 'glass', 0.9); p.vlines(1.1 - 0.03, 0, p.bayW, 4, 1.1, 0.06, 'metal', 0.35); p.rect(0, 3.6, p.bayW, 0.4, 'metal', 0.35); });
  return T;
}

// ---------- ground tiles: plain colours ----------
class ColorPainter {
  constructor(size = TILE, w = 1, h = 1) {
    this.s = size; this.w = w; this.h = h;
    this.c = document.createElement('canvas'); this.c.width = this.c.height = size;
    this.g = this.c.getContext('2d', { willReadFrequently: true });
  }
  fill(style) { this.g.fillStyle = style; this.g.fillRect(0, 0, this.s, this.s); }
  clear() { this.g.clearRect(0, 0, this.s, this.s); }
  // x, y in tile units 0..1 (y down = across / along as documented per tile)
  rect(x, y, w, h, style) { this.g.fillStyle = style; this.g.fillRect(x * this.s, y * this.s, w * this.s, h * this.s); }
  roundRect(x, y, w, h, r, style) { this.g.fillStyle = style; this.g.beginPath(); this.g.roundRect(x * this.s, y * this.s, w * this.s, h * this.s, r * this.s); this.g.fill(); }
  ellipse(x, y, rx, ry, style) { this.g.fillStyle = style; this.g.beginPath(); this.g.ellipse(x * this.s, y * this.s, rx * this.s, ry * this.s, 0, 0, Math.PI * 2); this.g.fill(); }
  noise(amp, seed = 1, block = 1) {
    const s = this.s, img = this.g.getImageData(0, 0, s, s), d = img.data;
    let r = seed; const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
    for (let y = 0; y < s; y += block) for (let x = 0; x < s; x += block) {
      const n = (rnd() - 0.5) * 2 * amp;
      for (let yy = y; yy < Math.min(s, y + block); yy++) for (let xx = x; xx < Math.min(s, x + block); xx++) {
        const i = (yy * s + xx) * 4; d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
    }
    this.g.putImageData(img, 0, 0);
  }
  data() { return new Uint8Array(this.g.getImageData(0, 0, this.s, this.s).data.buffer); }
}
const rgb = (r, g, b) => `rgb(${r},${g},${b})`;
const WHITE = 'rgba(242,242,236,1)';

function drawGroundTiles() {
  const T = new Array(GROUND_LAYERS);
  // asphalt: tile = 7 m; fine grain + a few patches (the vertex colour sets the actual grey)
  T[G.ASPHALT] = (() => { const p = new ColorPainter(); p.fill(rgb(196, 196, 196)); p.ellipse(0.3, 0.6, 0.22, 0.14, rgb(184, 184, 186)); p.ellipse(0.75, 0.2, 0.15, 0.2, rgb(204, 203, 200)); p.rect(0.55, 0.62, 0.35, 0.02, rgb(180, 180, 180)); p.noise(9, 3); return p; })();
  // sett paving (living streets): tile = 2 m, stones ~12 cm on darker joints
  T[G.COBBLE] = (() => {
    const p = new ColorPainter(); p.fill(rgb(150, 146, 140));
    const n = 16, step = 1 / n; let r = 5; const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = 186 + Math.round((rnd() - 0.5) * 40); p.roundRect(i * step + 0.006 + ((j % 2) * step) / 2, j * step + 0.006, step - 0.012, step - 0.012, 0.012, rgb(v + 4, v, v - 6)); }
    p.noise(5, 9); return p;
  })();
  // sidewalk "baldosas": tile = 2 m, 40 cm squares, grey-ochre with joints
  T[G.PAVING] = (() => {
    const p = new ColorPainter(); p.fill(rgb(160, 152, 138));
    const n = 5, step = 1 / n; let r = 11; const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = 200 + Math.round((rnd() - 0.5) * 18); p.rect(i * step + 0.006, j * step + 0.006, step - 0.012, step - 0.012, rgb(v, v - 5, v - 16)); }
    p.noise(4, 13); return p;
  })();
  // pedestrian streets & plazas: tile = 3 m, 60x40 slabs in running bond, light stone
  T[G.PAVING_PED] = (() => {
    const p = new ColorPainter(); p.fill(rgb(170, 165, 155));
    const cols = 5, rows = 7.5, sw = 1 / cols, sh = 1 / rows; let r = 17; const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
    for (let j = 0; j < rows; j++) { const off = (j % 2) * sw / 2; for (let i = -1; i < cols; i++) { const v = 206 + Math.round((rnd() - 0.5) * 16); p.rect(i * sw + off + 0.005, j * sh + 0.005, sw - 0.01, sh - 0.01, rgb(v, v - 3, v - 10)); } }
    p.noise(4, 19); return p;
  })();
  // markings: x = along (8 m), y = across the road (0..1 = full width), transparent elsewhere
  const marks = (fn) => { const p = new ColorPainter(); p.clear(); fn(p); return p; };
  const LW = 0.014;  // line thickness in tile units (~12 cm on a 9 m road)
  const edges = (p) => { p.rect(0, 0.05, 1, LW, WHITE); p.rect(0, 0.95 - LW, 1, LW, WHITE); };
  const dashed = (p, y) => p.rect(0, y - LW / 2, 0.25, LW, WHITE);        // 2 m dash, 6 m gap
  const solid = (p, y) => p.rect(0, y - LW / 2, 1, LW, WHITE);
  T[G.M2W2] = marks((p) => { edges(p); dashed(p, 0.5); });
  T[G.M1W1] = marks((p) => { edges(p); });
  T[G.M1W2] = marks((p) => { edges(p); dashed(p, 0.5); });
  T[G.M1W3] = marks((p) => { edges(p); dashed(p, 1 / 3); dashed(p, 2 / 3); });
  T[G.M1W4] = marks((p) => { edges(p); dashed(p, 0.25); dashed(p, 0.5); dashed(p, 0.75); });
  T[G.M2W4] = marks((p) => { edges(p); solid(p, 0.5 - 0.012); solid(p, 0.5 + 0.012); dashed(p, 0.25); dashed(p, 0.75); });
  // zebra: x = across (1 m: 0.5 m stripe + gap), y = along the zebra (3 m)
  T[G.ZEBRA] = marks((p) => p.rect(0.02, 0.08, 0.48, 0.84, WHITE));
  return T;
}

// Explanada mosaic: tile = MOSAIC_ALONG m (x) by MOSAIC_ACROSS m (y); stripes across the promenade,
// their boundaries waving along y.
function drawMosaic() {
  const s = MOSAIC_SIZE, p = new ColorPainter(s);
  const g = p.g, M = MOSAIC, n = M.stripes.length;
  g.fillStyle = M.stripes[0]; g.fillRect(0, 0, s, s);
  const px = s / MOSAIC_ALONG, py = s / MOSAIC_ACROSS;
  // draw each stripe as a wavy band; wrap by drawing one extra period on each side
  for (let k = -1; k <= n; k++) {
    const col = M.stripes[((k % n) + n) % n];
    const x0 = k * M.stripeWidth;
    g.fillStyle = col; g.beginPath();
    for (let j = 0; j <= 64; j++) { const y = (j / 64) * MOSAIC_ACROSS, wave = M.amplitude * Math.sin((y / M.waveLength) * Math.PI * 2); const X = (x0 + wave) * px; j === 0 ? g.moveTo(X, y * py) : g.lineTo(X, y * py); }
    for (let j = 64; j >= 0; j--) { const y = (j / 64) * MOSAIC_ACROSS, wave = M.amplitude * Math.sin((y / M.waveLength) * Math.PI * 2); g.lineTo((x0 + M.stripeWidth + wave) * px, y * py); }
    g.closePath(); g.fill();
  }
  // tessera grid: thin darker joints
  g.fillStyle = 'rgba(0,0,0,0.13)';
  const tx = M.tessera * px, ty = M.tessera * py;
  for (let x = 0; x < s; x += tx) g.fillRect(Math.round(x), 0, 1, s);
  for (let y = 0; y < s; y += ty) g.fillRect(0, Math.round(y), s, 1);
  return p;
}

// ---------- assembly ----------
function arrayTexture(painters, size, anisotropy) {
  const data = new Uint8Array(size * size * 4 * painters.length);
  painters.forEach((p, i) => data.set(p.data(), i * size * size * 4));
  const tex = new THREE.DataArrayTexture(data, size, size, painters.length);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

// Builds every tile. anisotropy: e.g. min(8, renderer max). Returns textures + the canvases (for ?tiles).
export function buildTiles(anisotropy = 8) {
  const t0 = performance.now();
  const facadePainters = drawFacadeTiles();
  const groundPainters = drawGroundTiles();
  const mosaicPainter = drawMosaic();
  const facade = arrayTexture(facadePainters, TILE, anisotropy);
  const ground = arrayTexture(groundPainters, TILE, anisotropy);
  const mosaic = new THREE.DataTexture(mosaicPainter.data(), MOSAIC_SIZE, MOSAIC_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  mosaic.wrapS = mosaic.wrapT = THREE.RepeatWrapping;
  mosaic.minFilter = THREE.LinearMipmapLinearFilter; mosaic.magFilter = THREE.LinearFilter;
  mosaic.generateMipmaps = true; mosaic.anisotropy = anisotropy; mosaic.needsUpdate = true;
  const ms = performance.now() - t0;
  const bytes = (FACADE_LAYERS + GROUND_LAYERS) * TILE * TILE * 4 + MOSAIC_SIZE * MOSAIC_SIZE * 4;
  return { facade, ground, mosaic, ms, bytes, preview: { facade: facadePainters, ground: groundPainters, mosaic: mosaicPainter } };
}

// ?tiles: shows every tile on the page (laptop check). Facade masks are shown decoded with sample colours.
export function showTilesPage(tiles) {
  const root = document.createElement('div');
  root.id = 'tiles';
  root.style.cssText = 'position:fixed;inset:0;overflow:auto;background:#223;padding:12px;z-index:50;font:12px system-ui;color:#ddd';
  const h = (t) => { const e = document.createElement('h3'); e.textContent = t; e.style.margin = '10px 0 4px'; root.appendChild(e); };
  const grid = () => { const g = document.createElement('div'); g.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px'; root.appendChild(g); return g; };
  const decode = (p) => {
    const c = document.createElement('canvas'); c.width = c.height = p.s;
    const g = c.getContext('2d'), img = g.createImageData(p.s, p.s), d = p.data();
    const plaster = [0.93, 0.83, 0.68], shutter = [0.25, 0.42, 0.28], glass = [0.45, 0.6, 0.7], metal = [0.55, 0.57, 0.6];
    for (let i = 0; i < p.s * p.s; i++) {
      const sh = d[i * 4] / SHADE_SCALE, wp = d[i * 4 + 1] / 255, ws = d[i * 4 + 2] / 255, wg = d[i * 4 + 3] / 255, wm = Math.max(0, 1 - wp - ws - wg);
      for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.min(255, 255 * sh * (wp * plaster[k] + ws * shutter[k] + wg * glass[k] + wm * metal[k]));
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0); return c;
  };
  const cell = (canvas, label, g) => { const d = document.createElement('div'); d.style.textAlign = 'center'; canvas.style.cssText = 'width:160px;height:160px;image-rendering:auto;background:#555'; d.appendChild(canvas); const l = document.createElement('div'); l.textContent = label; d.appendChild(l); g.appendChild(d); };
  h('Фасади (маски, показані з прикладними кольорами)'); let g = grid();
  const names = Object.entries(F).sort((a, b) => a[1] - b[1]);
  tiles.preview.facade.forEach((p, i) => cell(decode(p), `${i} ${names[i][0]}`, g));
  h('Дороги й тротуари (розмітка на сірому)'); g = grid();
  const gnames = Object.entries(G).sort((a, b) => a[1] - b[1]);
  tiles.preview.ground.forEach((p, i) => { const c = document.createElement('canvas'); c.width = c.height = p.s; const x = c.getContext('2d'); x.fillStyle = '#666'; x.fillRect(0, 0, p.s, p.s); x.drawImage(p.c, 0, 0); cell(c, `${i} ${gnames[i][0]}`, g); });
  h('Мозаїка Explanada (один період)'); g = grid();
  cell(tiles.preview.mosaic.c, 'mosaic 512²', g);
  const info = document.createElement('p'); info.textContent = `${tiles.preview.facade.length + tiles.preview.ground.length + 1} плиток, ${(tiles.bytes / 1048576).toFixed(1)} МБ без mip, намальовано за ${tiles.ms.toFixed(0)} мс`; root.appendChild(info);
  document.body.appendChild(root);
}
