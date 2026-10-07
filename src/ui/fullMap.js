// Full-screen map (phone: tap the minimap; PC: click the minimap or press M). The game is paused while it is open.
// Drawn from the city vectors on one canvas at the device pixel ratio (crisp text and lines), only while open and only
// when something changed: nothing runs while the map is closed. North is up.
//   pan: one finger / mouse drag     zoom: two-finger pinch / wheel / + - buttons / double tap     "до мене": back to the tuk-tuk
// Layers: sea, parks, plazas, buildings (from 0.25 px/m), roads, the walked trail (grey), the planned rest of the tour
// (arrows show the direction), the way to the next target (orange), places with names, the tuk-tuk with its heading.

const COL = { land: '#e6dcc6', sea: '#6fa8cf', park: '#b3d397', plaza: '#efe7d6', building: '#c9bba2', buildingEdge: '#b5a68c', road: '#ffffff', roadEdge: '#b9ad97', ped: '#f3ecdf' };
const ROAD_W = { primary: 12, primary_link: 7, secondary: 10, secondary_link: 7, tertiary: 8, tertiary_link: 6, residential: 6.5, unclassified: 6, living_street: 5, service: 4, pedestrian: 5, busway: 7 };
const MAX_SCALE = 3.2;          // px per metre
const BUILDINGS_FROM = 0.25;    // px per metre
const LABELS_FROM = 0.4;        // px per metre: names appear, below that only icons
const FONT = '700 14px system-ui, sans-serif';

const CSS = `
.fm { position: fixed; inset: 0; z-index: 92; display: none; background: #e6dcc6; touch-action: none; user-select: none; -webkit-user-select: none; font-family: system-ui, sans-serif; }
.fm canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
.fm button { position: absolute; border: 2px solid #10161c; background: rgba(255, 255, 255, .94); color: #10161c; font: 700 16px system-ui, sans-serif; border-radius: 12px; min-width: 48px; min-height: 48px; padding: 0 14px; box-shadow: 0 2px 8px rgba(0, 0, 0, .35); touch-action: manipulation; }
.fm button:active { background: #ffd166; }
.fm .fm-close { top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); font-size: 24px; width: 52px; height: 52px; padding: 0; }
.fm .fm-me { bottom: max(10px, env(safe-area-inset-bottom)); right: max(10px, env(safe-area-inset-right)); }
.fm .fm-zin, .fm .fm-zout { right: max(10px, env(safe-area-inset-right)); width: 48px; padding: 0; font-size: 26px; }
.fm .fm-zin { top: calc(50% - 54px); } .fm .fm-zout { top: calc(50% + 2px); }
.fm .fm-title { position: absolute; left: max(10px, env(safe-area-inset-left)); top: max(8px, env(safe-area-inset-top)); padding: 8px 14px; border-radius: 12px; background: rgba(16, 22, 28, .82); color: #fff; font: 700 15px system-ui, sans-serif; pointer-events: none; }
`;

export function createFullMap({ city, getTour, getTrail, getTuk, graph, setPaused, canOpen = () => true }) {
  let root = null, cv = null, g = null, built = null;
  let open = false, pushed = false, ignorePop = false, dirty = false, raf = 0;
  const view = { cx: 0, cz: 0, s: 0.5, W: 0, H: 0, dpr: 1 };
  const ptrs = new Map();
  let pinch = null, lastTap = 0, moved = 0;
  let plan = null, planVersion = -9, planNext = -9;   // remaining planned route, recomputed when the route or target changes
  let anim = null, pulse = 0;

  // ------------------------------------------------------------------ static layers (Path2D in world metres)
  function build() {
    const poly = (path, flat) => { path.moveTo(flat[0], flat[1]); for (let i = 2; i < flat.length; i += 2) path.lineTo(flat[i], flat[i + 1]); path.closePath(); };
    const sea = new Path2D(), parks = new Path2D(), plazas = new Path2D(), buildings = new Path2D();
    poly(sea, city.sea);
    for (const p of city.parks) poly(parks, p);
    for (const pl of city.plazas) poly(plazas, Array.isArray(pl) ? pl : pl.p);
    for (const b of city.buildings) poly(buildings, b.p);
    const roads = new Map();   // kind -> Path2D
    for (const r of city.roads) {
      let p = roads.get(r.k); if (!p) roads.set(r.k, (p = new Path2D()));
      p.moveTo(r.p[0], r.p[1]); for (let i = 2; i < r.p.length; i += 2) p.lineTo(r.p[i], r.p[i + 1]);
    }
    const R = city.meta.rect;
    built = { sea, parks, plazas, buildings, roads, rect: R };
  }

  function ensureDom() {
    if (root) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement('div'); root.className = 'fm';
    cv = document.createElement('canvas'); root.appendChild(cv); g = cv.getContext('2d');
    const btn = (cls, text, fn) => { const b = document.createElement('button'); b.className = cls; b.textContent = text; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); b.addEventListener('pointerdown', (e) => e.stopPropagation()); root.appendChild(b); return b; };
    btn('fm-close', '✕', () => close());
    btn('fm-me', '◎ До мене', () => toMe());
    btn('fm-zin', '+', () => zoomAt(view.W / 2, view.H / 2, 1.6));
    btn('fm-zout', '−', () => zoomAt(view.W / 2, view.H / 2, 1 / 1.6));
    const title = document.createElement('div'); title.className = 'fm-title'; title.textContent = 'Карта · гра на паузі'; root.appendChild(title);
    document.body.appendChild(root);
    cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    addEventListener('resize', () => { if (open) { resize(); invalidate(); } });
  }

  // ------------------------------------------------------------------ view
  const fitScale = () => { const R = built.rect; return Math.min(view.W / (R.maxX - R.minX), view.H / (R.maxZ - R.minZ)) * 0.95; };
  const clampView = () => {
    view.s = Math.max(fitScale() * 0.8, Math.min(MAX_SCALE, view.s));
    const R = built.rect;
    view.cx = Math.max(R.minX, Math.min(R.maxX, view.cx)); view.cz = Math.max(R.minZ, Math.min(R.maxZ, view.cz));
  };
  function resize() {
    view.W = root.clientWidth || innerWidth; view.H = root.clientHeight || innerHeight;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cv.width = Math.round(view.W * view.dpr); cv.height = Math.round(view.H * view.dpr);
  }
  function zoomAt(px, py, k) {
    const wx = view.cx + (px - view.W / 2) / view.s, wz = view.cz + (py - view.H / 2) / view.s;
    view.s = Math.max(fitScale() * 0.8, Math.min(MAX_SCALE, view.s * k));
    view.cx = wx - (px - view.W / 2) / view.s; view.cz = wz - (py - view.H / 2) / view.s;
    clampView(); invalidate();
  }
  function toMe() {
    const t = getTuk();
    anim = { t0: performance.now(), from: { cx: view.cx, cz: view.cz, s: view.s }, to: { cx: t.x, cz: t.z, s: Math.max(view.s, 0.9) } };
    invalidate();
  }

  // ------------------------------------------------------------------ pointers: pan and pinch
  function onDown(e) {
    cv.setPointerCapture && (() => { try { cv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ } })();
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    anim = null; moved = 0;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
  }
  function onMove(e) {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const ox = p.x, oy = p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) {
      view.cx -= (p.x - ox) / view.s; view.cz -= (p.y - oy) / view.s; moved += Math.abs(p.x - ox) + Math.abs(p.y - oy);
      clampView(); invalidate();
    } else if (ptrs.size >= 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      // the world point that was under the old midpoint stays under the new one, at the new scale
      const wx = view.cx + (pinch.mx - view.W / 2) / view.s, wz = view.cz + (pinch.my - view.H / 2) / view.s;
      view.s = Math.max(fitScale() * 0.8, Math.min(MAX_SCALE, view.s * d / pinch.d));
      view.cx = wx - (mx - view.W / 2) / view.s; view.cz = wz - (my - view.H / 2) / view.s;
      pinch = { d, mx, my }; moved += 99;
      clampView(); invalidate();
    }
  }
  function onUp(e) {
    const had = ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (had && ptrs.size === 0 && moved < 10 && e.type === 'pointerup') {   // a tap; two quick taps zoom in
      const now = performance.now();
      if (now - lastTap < 320) { zoomAt(e.clientX, e.clientY, 2); lastTap = 0; } else lastTap = now;
    }
  }

  // ------------------------------------------------------------------ drawing
  function invalidate() { dirty = true; if (!raf && open) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0;
    if (!open) return;
    if (anim) {
      const k = Math.min(1, (performance.now() - anim.t0) / 350), e = 1 - Math.pow(1 - k, 3);
      view.cx = anim.from.cx + (anim.to.cx - anim.from.cx) * e; view.cz = anim.from.cz + (anim.to.cz - anim.from.cz) * e; view.s = anim.from.s + (anim.to.s - anim.from.s) * e;
      if (k >= 1) anim = null; else dirty = true;
    }
    if (dirty) { dirty = false; draw(); }
    if (anim) raf = requestAnimationFrame(frame);
  }

  function remainingPlan(tour, tuk) {
    if (!tour || !tour.items || tour.state === 'summary') return null;
    if (plan !== null && planVersion === tour.routeVersion && planNext === tour.next) return plan;
    planVersion = tour.routeVersion; planNext = tour.next;
    const pts = [[tuk.x, tuk.z]];
    for (let i = tour.next; i < tour.items.length; i++) pts.push(tour.items[i].place.p);
    const r = pts.length > 1 ? graph.routeVia(pts) : null;
    plan = r ? r.pts : null;
    return plan;
  }

  function stroke(path, width, color, minPx) { g.lineWidth = Math.max(width, minPx / view.s); g.strokeStyle = color; g.stroke(path); }

  function draw() {
    const { s, dpr, W, H } = view;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = COL.land; g.fillRect(0, 0, cv.width, cv.height);
    g.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 - view.cx * s), dpr * (H / 2 - view.cz * s));
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.fillStyle = COL.sea; g.fill(built.sea);
    g.fillStyle = COL.park; g.fill(built.parks);
    g.fillStyle = COL.plaza; g.fill(built.plazas);
    if (s >= BUILDINGS_FROM) { g.fillStyle = COL.building; g.fill(built.buildings); if (s >= 0.8) { g.lineWidth = 0.6 / s; g.strokeStyle = COL.buildingEdge; g.stroke(built.buildings); } }
    // roads: casing first, then the surface, small kinds under big ones
    const kinds = ['pedestrian', 'service', 'living_street', 'unclassified', 'residential', 'tertiary_link', 'tertiary', 'secondary_link', 'secondary', 'primary_link', 'busway', 'primary'].filter((k) => built.roads.has(k));
    for (const k of kinds) stroke(built.roads.get(k), ROAD_W[k] || 5, COL.roadEdge, 2.6);
    for (const k of kinds) stroke(built.roads.get(k), (ROAD_W[k] || 5) - 1.2, k === 'pedestrian' ? COL.ped : COL.road, 1.4);

    const tour = getTour(), tuk = getTuk();
    const trail = getTrail();
    // the walked trail: grey
    if (trail && trail.length > 1) {
      g.beginPath(); trail.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
      g.lineWidth = Math.max(5, 5 / s); g.strokeStyle = 'rgba(110, 118, 128, .85)'; g.stroke();
    }
    // the planned rest of the tour with direction chevrons, and the way to the next target on top
    const rest = remainingPlan(tour, tuk);
    if (rest && rest.length > 1) { pathLine(rest, 'rgba(46, 107, 214, .85)', 6); chevrons(rest, '#fff', 'rgba(46, 107, 214, .95)'); }
    if (tour && tour.route && tour.route.length > 1) { pathLine(tour.route, 'rgba(255, 150, 0, .95)', 8); chevrons(tour.route, '#fff', '#e07b00'); }

    // screen-space layer: places, tuk-tuk, scale
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPlaces(tour);
    drawTuk(tuk);
    drawScale();
  }

  function pathLine(pts, color, px) {
    g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
    g.lineWidth = Math.max(px / view.s, 0); g.strokeStyle = color; g.stroke();
  }
  // arrowheads along a polyline every ~70 screen px (screen-sized, drawn in world coordinates with the scale compensated)
  function chevrons(pts, fill, edge) {
    const step = 70 / view.s, size = 7 / view.s;
    let acc = step / 2;
    g.fillStyle = fill; g.strokeStyle = edge; g.lineWidth = 2 / view.s;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (!L) continue;
      const ux = dx / L, uz = dz / L;
      while (acc < L) {
        const x = a[0] + ux * acc, z = a[1] + uz * acc;
        g.beginPath();
        g.moveTo(x + ux * size, z + uz * size); g.lineTo(x - ux * size - uz * size * 0.9, z - uz * size + ux * size * 0.9); g.lineTo(x - ux * size * 0.3, z - uz * size * 0.3); g.lineTo(x - ux * size + uz * size * 0.9, z - uz * size - ux * size * 0.9);
        g.closePath(); g.fill(); g.stroke();
        acc += step;
      }
      acc -= L;
    }
  }

  const toScreen = (x, z) => [view.W / 2 + (x - view.cx) * view.s, view.H / 2 + (z - view.cz) * view.s];

  function drawPlaces(tour) {
    const spec = tour && tour.spec;
    const items = tour ? tour.items : [];
    const rows = [];
    const inTour = new Map();
    items.forEach((it, i) => { if (it.kind !== 'finish') inTour.set(it.place.id, { kind: it.kind, i, state: tour.done[i] }); });
    const target = tour ? tour.target : null;
    for (const [id, pl] of Object.entries(city.tour.places)) {
      const title = (spec && spec.places[id] && spec.places[id].title) || pl.name || id;
      const t = inTour.get(id);
      const isStart = tour && tour.start.id === id;
      const isTarget = target && Math.hypot(target.x - pl.p[0], target.z - pl.p[1]) < 1;
      rows.push({ id, title, p: pl.p, t, isStart, isTarget, pri: isTarget ? 0 : isStart ? 1 : t && t.kind === 'stop' ? 2 : t ? 3 : 4 });
    }
    rows.sort((a, b) => a.pri - b.pri);
    const stopNo = new Map(); let n = 0; for (const it of items) if (it.kind === 'stop') stopNo.set(it.place.id, ++n);
    const boxes = [];
    g.font = FONT; g.textBaseline = 'middle';
    for (const r of rows) {
      const [x, y] = toScreen(r.p[0], r.p[1]);
      if (x < -40 || y < -40 || x > view.W + 40 || y > view.H + 40) continue;
      const rad = r.isTarget ? 14 : r.t && r.t.kind === 'stop' || r.isStart ? 13 : r.t ? 9 : 7;
      // icon
      if (r.isTarget) { const pulse = 1 + 0.25 * Math.sin(performance.now() / 300); g.beginPath(); g.arc(x, y, rad + 7 * pulse, 0, Math.PI * 2); g.fillStyle = 'rgba(255, 64, 32, .28)'; g.fill(); }
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2);
      g.fillStyle = r.isStart ? '#2e9e57' : r.t && r.t.kind === 'stop' ? (r.t.state === 'done' ? '#7a8590' : '#ff8a00') : r.t ? '#fff' : '#b8c0c8';
      g.fill(); g.lineWidth = r.isTarget ? 3.5 : 2.5; g.strokeStyle = r.isTarget ? '#ff4020' : '#10161c'; g.stroke();
      g.fillStyle = '#fff'; g.textAlign = 'center';
      if (r.isStart) { g.beginPath(); g.moveTo(x - 4, y - 6); g.lineTo(x + 6, y); g.lineTo(x - 4, y + 6); g.closePath(); g.fill(); }
      else if (r.t && r.t.kind === 'stop') g.fillText(String(stopNo.get(r.id)), x, y + 0.5);
      else if (r.t) { g.fillStyle = '#ff8a00'; g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill(); }
      boxes.push([x - rad, y - rad, x + rad, y + rad]);
      // name (only when zoomed in enough, the next target always)
      if (view.s < LABELS_FROM && !r.isTarget) continue;
      const w = g.measureText(r.title).width + 6, h = 20;
      let lx = x + rad + 4, align = 'left';
      if (lx + w > view.W - 4) { lx = x - rad - 4; align = 'right'; }
      const box = align === 'left' ? [lx - 2, y - h / 2, lx + w, y + h / 2] : [lx - w, y - h / 2, lx + 2, y + h / 2];
      if (!r.isTarget && boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      g.textAlign = align; g.lineWidth = 4; g.strokeStyle = 'rgba(255, 255, 255, .95)'; g.strokeText(r.title, lx, y);
      g.fillStyle = r.isTarget ? '#c4210a' : '#10161c'; g.fillText(r.title, lx, y);
    }
  }

  function drawTuk(tuk) {
    const [x, y] = toScreen(tuk.x, tuk.z);
    const fx = -Math.sin(tuk.heading), fz = -Math.cos(tuk.heading), ang = Math.atan2(fz, fx);
    g.save(); g.translate(x, y); g.rotate(ang);
    g.beginPath(); g.arc(0, 0, 17, 0, Math.PI * 2); g.fillStyle = 'rgba(51, 136, 255, .25)'; g.fill();
    g.beginPath(); g.moveTo(16, 0); g.lineTo(-11, 11); g.lineTo(-5, 0); g.lineTo(-11, -11); g.closePath();
    g.fillStyle = '#3388ff'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke(); g.lineWidth = 1.5; g.strokeStyle = '#10161c'; g.stroke();
    g.restore();
  }

  function drawScale() {
    const nice = [10, 20, 50, 100, 200, 500, 1000]; let m = nice[0];
    for (const c of nice) if (c * view.s <= 150) m = c;
    const px = m * view.s, x0 = 14, y0 = view.H - 22;
    g.fillStyle = 'rgba(255, 255, 255, .92)'; g.fillRect(x0 - 6, y0 - 26, px + 74, 40);
    g.strokeStyle = '#10161c'; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, y0 - 6); g.lineTo(x0, y0); g.lineTo(x0 + px, y0); g.lineTo(x0 + px, y0 - 6); g.stroke();
    g.font = FONT; g.fillStyle = '#10161c'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(m >= 1000 ? '1 км' : m + ' м', x0 + 2, y0 - 10);
    g.fillText('↑ Пн', x0 + px + 10, y0 - 10);
    g.textBaseline = 'middle';
  }

  // ------------------------------------------------------------------ open / close
  function doOpen() {
    if (open || !canOpen()) return;
    if (!built) build();
    ensureDom();
    open = true; root.style.display = 'block';
    resize();
    const t = getTuk();
    view.cx = t.x; view.cz = t.z; view.s = Math.min(MAX_SCALE, Math.max(0.9, fitScale()));
    clampView(); plan = null; anim = null; ptrs.clear(); pinch = null;
    setPaused(true);
    try { history.pushState({ fullMap: true }, ''); pushed = true; } catch (_) { pushed = false; }
    pulse = setInterval(() => invalidate(), 140);   // the pulsing ring of the next target
    invalidate();
  }
  function doClose(fromPop) {
    if (!open) return;
    open = false; root.style.display = 'none'; ptrs.clear(); pinch = null; anim = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    clearInterval(pulse); pulse = 0;
    setPaused(false);
    if (pushed && !fromPop) {   // take our history entry off again without the phone menu's Back handler reacting to it
      pushed = false; ignorePop = true; setTimeout(() => { ignorePop = false; }, 600);
      try { history.back(); } catch (_) { ignorePop = false; }
    } else pushed = false;
  }
  function close() { doClose(false); }
  // registered before the phone menu's popstate handler (created later), so it can keep the Back button for itself:
  // Back with the map open closes the map only
  addEventListener('popstate', (e) => {
    if (ignorePop) { ignorePop = false; e.stopImmediatePropagation(); return; }
    if (open) { pushed = false; doClose(true); e.stopImmediatePropagation(); }
  });
  addEventListener('keydown', (e) => {
    if (e.target && /^(input|select|textarea)$/i.test(e.target.tagName)) return;
    if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey) { if (open) close(); else doOpen(); e.preventDefault(); }
    else if (e.code === 'Escape' && open) { close(); e.preventDefault(); }
  });

  return {
    open: doOpen, close, toggle: () => (open ? close() : doOpen()),
    get isOpen() { return open; },
    get view() { return view; },
  };
}
