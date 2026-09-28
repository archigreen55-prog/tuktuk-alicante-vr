// Імпорт з TukTuk OS, крок 1 (docs/plan-tuktuk-os-sync.md, розд. 8): лінії маршруту туру.
//
// Читає копію TukTuk OS лише для читання (git show <ref>:<шлях>, без checkout і без робочої теки),
// складає тури гри за data/tuktuk-os-map.json і пише data/tour-lines.json: для кожного плеча
// «звідки→куди» — лінію та її джерело. Пріоритет джерел:
//   1. лінія власника з редактора TukTuk OS (route-line.json, by: owner; або схвалена з GPX);
//   2. автоматична лінія "auto-tuktuk-os" — маршрутизатор OSRM, той самий HTTP API, що в TukTuk OS
//      (власний OSRM з профілем tuktuk.lua або сервер застосунку гіда); лише коли задано адресу
//      сервера (auto.osrm у файлі відповідностей або --osrm). Інакше береться з минулого імпорту;
//   3. "astar" — лінії немає, маршрут рахує гра (наш A* по city.json), як у версії 0.7.0.
// Інших файлів гри скрипт не змінює: тексти, точки, значки й фото — крок 2.
//
//   node tools/import-tuktuk-os.mjs --dry-run      лише звіт, нічого не пише
//   node tools/import-tuktuk-os.mjs                пише data/tour-lines.json (і файл відповідностей, якщо його немає)
//
// Прапорці:
//   --repo <тека>        копія TukTuk OS (за замовчуванням source.repo з файлу відповідностей)
//   --ref <гілка>        гілка чи коміт (source.ref), напр. origin/main
//   --no-fetch           не робити git fetch у копії TukTuk OS
//   --osrm <адреса>      сервер OSRM для автоматичних ліній, напр. http://localhost:5000 (auto.osrm)
//   --profile <профіль>  профіль у запиті OSRM (auto.profile, за замовчуванням driving)
//   --map <файл>         файл відповідностей (data/tuktuk-os-map.json)
//   --out <файл>         куди писати лінії (data/tour-lines.json)
//   --route-line <файл>  для перевірки: route-line.json з файлу, а не з TukTuk OS
//   --force              переписати tour-lines.json, навіть якщо його правили вручну

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoadGraph } from '../src/game/route.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- прапорці ----------
const KNOWN = { 'dry-run': 0, 'no-fetch': 0, force: 0, help: 0, repo: 1, ref: 1, osrm: 1, profile: 1, map: 1, out: 1, 'route-line': 1 };
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const name = a.replace(/^--/, '');
  if (!a.startsWith('--') || !(name in KNOWN)) fail(`невідомий аргумент ${a}. Довідка: node tools/import-tuktuk-os.mjs --help`);
  if (KNOWN[name]) {
    const v = process.argv[++i];
    if (v === undefined || v.startsWith('--')) fail(`--${name}: потрібне значення`);
    args[name] = v;
  } else args[name] = true;
}
if (args.help) {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  console.log(src.slice(0, src.findIndex((l) => l.startsWith('import'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n').trim());
  process.exit(0);
}
const DRY = !!args['dry-run'];

// ---------- пороги (план, розд. 2.3) ----------
const POINT_MARGIN = 30; // м від краю зони: точка туру всередині (як EDGE_MARGIN у build-city)
const LINE_MARGIN = 5;   // м від краю: далі лінія виходить за зону (як граф доріг і межі фізики)
const STEP = 2;          // м, крок вибірки при перевірках
const OFF_STREET = 8;    // м від краю проїжджої частини вулиці OSM
const RUN_MIN = 10;      // м, коротші відрізки «не на вулиці» / «пішохідна» не показуються
const ONEWAY_RUN = 20;   // м проти односторонньої
const IN_BUILDING = 2;   // м усередині будівлі — вже «перетинає будівлю»
const JUMP = 150;        // м між сусідніми вершинами — ознака збою GPS
const SNAP_WARN = 40;    // м від точки TukTuk OS до дороги, куди її прив'язав OSRM
const SHIFT_WARN = 10;   // м, зсув точки з минулого імпорту
const ENDS_SAME = 1;     // м: автоматична лінія з минулого імпорту придатна, якщо кінці не зсунулись
const LOOP_K = 2, LOOP_M = 200; // автоматична лінія довша за LOOP_K × A* + LOOP_M — схоже на петлю
const OSRM_GAP = 1100;   // мс між запитами (правила публічного сервера: ≤ 1 запиту/с)
const UA = 'tuktuk-alicante-vr/import-tuktuk-os (github.com/archigreen55-prog/tuktuk-alicante-vr)';

// ---------- файл відповідностей ----------
const STOPS = ['casa-carbonell', 'ayuntamiento', 'santa-maria', 'postiguet', 'mercado-central'];
const DEFAULT_MAP = {
  _help: [
    'Файл відповідностей TukTuk OS → VR-гра. Редагуєш ти; tools/import-tuktuk-os.mjs його лише читає (і створює, якщо файла немає).',
    'source: локальна копія TukTuk OS лише для читання, гілка й маршрут.',
    'auto.osrm: адреса сервера OSRM для автоматичних ліній (напр. "http://localhost:5000"). null — сервер не питати: плечі без лінії власника беруть автоматичну лінію з минулого імпорту або йдуть нашим A*.',
    'tours: тури гри. line: "order" — точки класичного маршруту (order 1–20 у points.json) від start до finish; або id туру TukTuk OS (напр. "60-classic-stops") — тоді порядок з його computed.rows. sameLineAs: та сама лінія, що в іншому турі.',
    'Точки поза зоною гри випадають, крім тих, що мають vr (тоді у грі використовується місце vr). exclude — не брати точку взагалі.',
    'stops — зупинки з карткою й фото; passes: "all" — решта точок лінії стають фактами на ходу, [] — без фактів (точки лишаються лише вершинами лінії).',
    'legs: поправки окремих плечей «звідки→куди». use: "astar" — автоматичну лінію не брати, лише наш A*. Лінія власника з редактора TukTuk OS однаково має пріоритет.',
    'points: vr — id місця в data/tour.json зараз; exclude — причина, чому точку не беремо. credits — для assets/tour/CREDITS.md (крок 2).',
  ],
  source: { repo: '~/projects/_ref/TukTuk-OS', ref: 'origin/feat/route-preview', route: 'alicante-classic' },
  auto: { osrm: null, profile: 'driving' },
  tours: {
    full: { line: 'order', start: 'melia', finish: 'melia', stops: STOPS, passes: 'all' },
    short: { sameLineAs: 'full', stops: STOPS, passes: [] },
  },
  legs: {
    'postiguet→mercado-central': { use: 'astar', why: 'рішення власника 28.09: поки A*; справжнім шляхом — після розширення зони (гора, замок, північ міста)' },
  },
  points: {
    melia: { vr: 'melia', note: 'крок 2: зону посадки перенести на точку власника з редактора' },
    'casa-carbonell': { vr: 'explanada', note: 'одна зупинка з карткою Casa Carbonell' },
    explanada: { note: 'факт на ходу одразу після Casa Carbonell' },
    canalejas: { vr: 'canalejas' },
    'ficus-canalejas': {},
    'casa-de-las-brujas': { vr: 'brujas' },
    'sede-universitaria': { vr: 'university' },
    'rambla-mendez-nunez': { vr: 'rambla' },
    ayuntamiento: { vr: 'townHall' },
    'santa-maria': { vr: 'santaMaria' },
    postiguet: { vr: 'postiguet', note: 'точка TukTuk OS (ліфт до замку) за межею зони; у грі — наше місце postiguet' },
    'colegio-san-antonio': { exclude: 'у зоні, але плечі до нього й від нього виходять за зону (інші тури — пізніше)' },
    'mercado-central': { vr: 'mercado' },
    luceros: { vr: 'luceros' },
    'calle-san-francisco': { vr: 'sanFrancisco' },
  },
  credits: {
    icons: { source: 'TukTuk OS, client/public/media/alicante-classic/<id>/illustration.svg', author: 'власник TukTuk OS', license: 'All rights reserved' },
  },
};

const MAP_FILE = resolve(ROOT, args.map ?? 'data/tuktuk-os-map.json');
const OUT_FILE = resolve(ROOT, args.out ?? 'data/tour-lines.json');
const mapExists = existsSync(MAP_FILE);
const map = mapExists ? readJson(MAP_FILE) : DEFAULT_MAP;

// ---------- звіт ----------
const log = [];
const say = (s = '') => log.push(s);
const problems = { error: [], warn: [], info: [] };
const note = (level, s) => problems[level].push(s);

// ---------- TukTuk OS ----------
const repo = (args.repo ?? map.source?.repo ?? '').replace(/^~(?=\/|$)/, homedir());
const ref = args.ref ?? map.source?.ref ?? 'origin/main';
const route = map.source?.route ?? 'alicante-classic';
const CONTENT = `client/src/content/routes/${route}`;
if (!repo || !existsSync(join(repo, '.git'))) fail(`немає копії TukTuk OS: ${repo || '(source.repo порожній)'}. Вкажи --repo або source.repo.`);
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20, timeout: 90_000 });
let fetched = 'ні (--no-fetch)';
if (!args['no-fetch']) {
  try { git('fetch', '--all', '--prune', '--quiet'); fetched = 'так'; } catch (err) { fetched = 'не вдалося'; note('warn', `git fetch у копії TukTuk OS не вдався (${firstLine(err.stderr || err.message)}): беру те, що вже є локально.`); }
}
let commit, commitDate;
try { [commit, commitDate] = git('log', '-1', '--format=%H %cI', ref).trim().split(' '); } catch { fail(`у копії TukTuk OS немає гілки чи коміту ${ref}`); }
const show = (path) => { try { return git('show', `${ref}:${path}`); } catch { return null; } };
const showJson = (path) => { const t = show(path); if (t === null) return null; try { return JSON.parse(t); } catch (err) { fail(`${ref}:${path} — не JSON: ${err.message}`); } };

const WATCH = ['route-line.json', 'route-line.geojson', 'points.json', 'tours.json'].map((f) => `${CONTENT}/${f}`);
const lastChange = (r) => { try { return git('log', '-1', '--format=%cI', r, '--', ...WATCH).trim(); } catch { return ''; } };
const refChanged = lastChange(ref);

const pointsArr = showJson(`${CONTENT}/points.json`);
const toursFile = showJson(`${CONTENT}/tours.json`);
if (!pointsArr || !toursFile) fail(`у ${ref} немає ${CONTENT}/points.json або tours.json`);
let lineFile, lineFrom;
if (args['route-line']) { lineFile = readJson(resolve(args['route-line'])); lineFrom = `${args['route-line']} (--route-line, для перевірки)`; }
else { lineFile = showJson(`${CONTENT}/route-line.json`) ?? { legs: {} }; lineFrom = `${ref}:${CONTENT}/route-line.json`; }
const ownerLines = lineFile.legs ?? {};
if (show(`${CONTENT}/route-line.geojson`) !== null) note('warn', 'у TukTuk OS з\'явився route-line.geojson — цей формат скрипт ще не читає; лінії взято лише з route-line.json.');

// гілки TukTuk OS, де лінії, точки чи тури змінювались пізніше, ніж у вибраній
const newer = [];
try {
  for (const full of git('for-each-ref', '--format=%(refname)', 'refs/remotes').split('\n').filter(Boolean)) {
    const b = full.replace(/^refs\/remotes\//, '');
    if (/\/HEAD$/.test(b) || /\/tmp\//.test(b) || b === ref) continue;
    const d = lastChange(b);
    if (d && refChanged && d > refChanged) newer.push(`${b} (${d.slice(0, 16).replace('T', ' ')})`);
  }
} catch { /* лише інформація */ }

const P = new Map();
for (const p of pointsArr) P.set(p.id, p);

// ---------- місто гри ----------
const city = readJson(join(ROOT, 'data/city.json'));
const { origin: O, metresPerDeg: MPD, rect: RECT } = city.meta;
const proj = (lat, lng) => [(lng - O.lon) * MPD.lon, -(lat - O.lat) * MPD.lat];
const unproj = (x, z) => [O.lat - z / MPD.lat, O.lon + x / MPD.lon];
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const ll = ([x, z]) => unproj(x, z).map(r6);
const inRect = ([x, z], m) => x >= RECT.minX + m && x <= RECT.maxX - m && z >= RECT.minZ + m && z <= RECT.maxZ - m;
const outBy = ([x, z], m) => Math.max(RECT.minX + m - x, x - (RECT.maxX - m), RECT.minZ + m - z, z - (RECT.maxZ - m));
const graph = new RoadGraph(city.tour.graph);
const idx = buildIndexes(city);

// ---------- тури гри ----------
const pointInfo = {};  // id -> { lat, lng, zone, vr }
function pointOf(id) {
  if (pointInfo[id]) return pointInfo[id];
  const p = P.get(id);
  if (!p) return null;
  const xz = proj(p.lat, p.lng);
  const vr = map.points?.[id]?.vr;
  const onMount = idx.inBuilding(xz) === 'mount';
  const zone = inRect(xz, POINT_MARGIN) && !onMount ? 'in' : 'out';
  return (pointInfo[id] = { lat: r6(p.lat), lng: r6(p.lng), zone, ...(zone === 'out' ? { out: onMount ? 'mount' : Math.round(outBy(xz, POINT_MARGIN)) } : {}), ...(vr ? { vr } : {}) });
}
// точка на дорозі, куди веде A*: для точки в зоні — найближча проїзна вулиця, зв'язана в обидва боки
// з центром міста (як nearestRoadPoint у build-city); для точки поза зоною — наше місце vr
const roadCache = new Map();
function anchorXZ(id) {
  const pt = pointOf(id);
  if (pt.zone === 'out') { const pl = pt.vr && city.tour.places[pt.vr]; return pl ? pl.p : null; }
  if (!roadCache.has(id)) roadCache.set(id, roadPoint(proj(pt.lat, pt.lng)));
  return roadCache.get(id);
}
function roadPoint([px, pz], radius = 120) {
  const hub = [city.landmarks.rambla.x, city.landmarks.rambla.z];
  const seen = new Set(), cands = [];
  const r = Math.ceil(radius / 40);
  for (let i = graph.cellX(px) - r; i <= graph.cellX(px) + r; i++) for (let j = graph.cellZ(pz) - r; j <= graph.cellZ(pz) + r; j++) {
    for (const k of graph.grid.get(i * 100000 + j) ?? []) {
      if (seen.has(k)) continue;
      seen.add(k);
      const ax = graph.x[graph.ea[k]], az = graph.z[graph.ea[k]], ex = graph.x[graph.eb[k]] - ax, ez = graph.z[graph.eb[k]] - az;
      const t = Math.max(0.05, Math.min(0.95, ((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez || 1)));
      const q = [ax + ex * t, az + ez * t];
      const d = dxz(q, [px, pz]);
      if (d <= radius) cands.push({ q, d });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands.slice(0, 12)) if (graph.route(c.q, hub) && graph.route(hub, c.q)) return c.q;
  return cands[0]?.q ?? null;
}

const tours = {};
const dropped = new Map(); // id -> причина
for (const [tid, spec] of Object.entries(map.tours ?? {})) {
  let ids;
  if (spec.sameLineAs) {
    const base = map.tours[spec.sameLineAs];
    if (!base || base.sameLineAs) fail(`тур ${tid}: sameLineAs "${spec.sameLineAs}" — немає такого туру (або він сам sameLineAs)`);
    ids = null; // заповнимо після базового
  } else ids = sequence(tid, spec);
  tours[tid] = { spec, ids };
}
for (const t of Object.values(tours)) if (!t.ids) t.ids = tours[t.spec.sameLineAs].ids;

function sequence(tid, spec) {
  let raw;
  if (spec.line === 'order') {
    const start = spec.start ?? 'melia', finish = spec.finish ?? start;
    const mid = pointsArr.filter((p) => Number.isFinite(p.order)).sort((a, b) => a.order - b.order).map((p) => p.id);
    raw = [start, ...mid, finish];
  } else {
    const t = toursFile.tours?.find((x) => x.id === spec.line);
    if (!t) fail(`тур ${tid}: у TukTuk OS немає туру "${spec.line}"`);
    const comp = spec.variant ? t.computed?.[spec.variant] : Object.values(t.computed ?? {})[0];
    if (!comp?.rows) fail(`тур ${tid}: у туру "${spec.line}" немає computed.rows${spec.variant ? ` для ${spec.variant}` : ''}`);
    raw = comp.rows.map((r) => r.id);
  }
  const ids = [];
  raw.forEach((id, i) => {
    const edge = i === 0 || i === raw.length - 1;
    const p = P.get(id);
    if (!p) fail(`тур ${tid}: точки "${id}" немає в points.json TukTuk OS`);
    const m = map.points?.[id] ?? {};
    const pt = pointOf(id);
    let why = null;
    if (m.exclude) why = `exclude: ${m.exclude}`;
    else if (p.status && p.status !== 'active') why = `у TukTuk OS status: ${p.status}`;
    else if (pt.zone === 'out' && !m.vr) why = pt.out === 'mount' ? 'на схилі гори, у грі не проїхати' : 'поза зоною гри';
    if (why && edge) fail(`тур ${tid}: старт чи фініш "${id}" не можна взяти (${why})`);
    if (why) { dropped.set(id, why); return; }
    if (ids[ids.length - 1] !== id) ids.push(id);
  });
  return ids;
}

function roles(tid) {
  const { spec, ids } = tours[tid];
  const inner = ids.slice(1, -1);
  const stops = new Set(spec.stops ?? []);
  const passes = spec.passes === 'all' ? new Set(inner.filter((id) => !stops.has(id))) : new Set(spec.passes ?? []);
  for (const id of [...stops, ...passes]) if (!inner.includes(id)) fail(`тур ${tid}: "${id}" у stops/passes, але його немає на лінії туру (${ids.join(' ')})`);
  return ids.map((id, i) => [id, i === 0 ? 'start' : i === ids.length - 1 ? 'finish' : stops.has(id) ? 'stop' : passes.has(id) ? 'pass' : 'via']);
}

// ---------- минулий імпорт ----------
let prev = null;
if (existsSync(OUT_FILE)) {
  try { prev = JSON.parse(readFileSync(OUT_FILE, 'utf8')); } catch (err) { note('warn', `${rel(OUT_FILE)} не читається (${err.message}) — буде переписаний з нуля.`); }
}
const prevHand = prev && prev.hash && prev.hash !== contentHash(prev);

// ---------- плечі ----------
const osrm = (args.osrm ?? map.auto?.osrm ?? null) || null;
const profile = args.profile ?? map.auto?.profile ?? 'driving';
const legKeys = [];
for (const { ids } of Object.values(tours)) for (let i = 1; i < ids.length; i++) { const k = `${ids[i - 1]}→${ids[i]}`; if (!legKeys.includes(k)) legKeys.push(k); }

const legs = {};
const cachedLegs = new Set(); // автоматичні лінії з минулого імпорту (лише для звіту)
let lastRequest = 0;
for (const key of legKeys) legs[key] = await resolveLeg(key);

async function resolveLeg(key) {
  const [a, b] = key.split('→');
  const A = pointOf(a), B = pointOf(b);
  const ends = [[A.lat, A.lng], [B.lat, B.lng]];
  const tried = [];
  // 1. лінія власника (або схвалена з GPX)
  const own = ownerLines[key];
  if (own) {
    const src = own.by === 'gpx' ? 'gpx' : 'owner';
    if (own.mode === 'walk') tried.push('у TukTuk OS плече «пішки» (туристи йдуть, тук-тук чекає)');
    else {
      const res = checkLine(key, [[A.lat, A.lng], ...(own.via ?? []), [B.lat, B.lng]], src);
      if (res.ok) return finishLeg(key, { src, mode: 'drive', ...res.leg });
      tried.push(`лінія власника не пройшла перевірку: ${res.why}`);
    }
  }
  // 2. автоматична лінія (OSRM)
  const force = map.legs?.[key]?.use === 'astar';
  if (force) tried.push(map.legs[key].why ? `use: astar — ${map.legs[key].why}` : 'use: astar у файлі відповідностей');
  else if (osrm) {
    const got = await osrmLeg(A, B).catch((err) => ({ err: err.message }));
    if (got.err) tried.push(`OSRM: ${got.err}`);
    else {
      const res = checkLine(key, got.pts, 'auto', got.snap);
      if (res.ok) return finishLeg(key, { src: 'auto-tuktuk-os', mode: 'drive', engine: got.engine, snap: got.snap, why: tried.join('; '), ...res.leg });
      tried.push(`автоматична лінія не пройшла перевірку: ${res.why}`);
    }
  } else {
    const old = prev?.legs?.[key];
    if (old?.src === 'auto-tuktuk-os' && old.ends && dist(old.ends[0], ends[0]) <= ENDS_SAME && dist(old.ends[1], ends[1]) <= ENDS_SAME) {
      const res = checkLine(key, old.raw ?? old.pts, 'auto', old.snap);
      if (res.ok) { cachedLegs.add(key); return finishLeg(key, { src: 'auto-tuktuk-os', mode: 'drive', engine: old.engine, snap: old.snap, why: tried.join('; '), ...res.leg }); }
      tried.push(`автоматична лінія з минулого імпорту не пройшла перевірку: ${res.why}`);
    } else if (old?.src === 'auto-tuktuk-os') tried.push('точку перенесли — автоматичну лінію треба перерахувати (--osrm)');
    else tried.push(own ? 'автоматична лінія вимкнена (auto.osrm = null)' : 'лінії власника немає; автоматична вимкнена (auto.osrm = null)');
  }
  // 3. A* гри
  const pa = anchorXZ(a), pb = anchorXZ(b);
  const r = pa && pb ? graph.route(pa, pb) : null;
  if (!r) note('warn', `${key}: A* не знайшов дороги між точками — гра не прокладе це плече.`);
  return { src: 'astar', why: tried.join('; '), ends, m: r ? Math.round(r.len) : null, pts: [] };
}

function finishLeg(key, leg) {
  const [a, b] = key.split('→');
  const A = pointOf(a), B = pointOf(b);
  if (leg.src === 'auto-tuktuk-os' && !leg.trim) {
    // петлі OSRM (односторонні й пішохідні вулиці, TukTuk OS: ROUTE_EDITOR_PLAN §0) — варто глянути й намалювати плече
    const pa = anchorXZ(a), pb = anchorXZ(b), r = pa && pb && graph.route(pa, pb);
    if (r && leg.m > LOOP_K * r.len + LOOP_M) note('warn', `${key}: автоматична лінія ${leg.m} м, а A* гри — ${Math.round(r.len)} м. Петля навколо кварталів? Варто намалювати плече в редакторі TukTuk OS.`);
  }
  const out = { src: leg.src, mode: leg.mode, ends: [[A.lat, A.lng], [B.lat, B.lng]], m: leg.m };
  if (leg.trim) {
    // лінію обрізано на межі зони: гра доїжджає від кінця лінії до місця vr своїм A*
    let join = 0;
    const add = (from, to, what) => { const r = from && to && graph.route(from, to); if (r) join += r.len; else { join = NaN; note('warn', `${key}: від ${what} A* не доїжджає — гра не з'єднає обрізану лінію з місцем.`); } };
    if (leg.trim.includes('end')) add(proj(...leg.pts[leg.pts.length - 1]), anchorXZ(b), `кінця лінії на межі зони до місця ${B.vr ?? b}`);
    if (leg.trim.includes('start')) add(anchorXZ(a), proj(...leg.pts[0]), `місця ${A.vr ?? a} до початку лінії на межі зони`);
    out.trim = leg.trim; out.joinM = Number.isFinite(join) ? Math.round(join) : null;
  }
  if (leg.engine) out.engine = leg.engine;
  if (leg.snap) out.snap = leg.snap;
  if (leg.why) out.why = leg.why;
  if (leg.trim && leg.raw) out.raw = leg.raw; // необрізана лінія OSRM, щоб перевірити знову без мережі
  out.pts = leg.pts;
  return out;
}

// ---------- OSRM ----------
async function osrmLeg(A, B) {
  const wait = lastRequest + OSRM_GAP - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const base = osrm.replace(/\/+$/, '');
  const url = `${base}/route/v1/${profile}/${A.lng},${A.lat};${B.lng},${B.lat}?overview=full&geometries=polyline6&alternatives=false&steps=false`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  const body = await res.text();
  let data;
  try { data = JSON.parse(body); } catch { throw new Error(`HTTP ${res.status}, відповідь не JSON`); }
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(`${data.code ?? 'HTTP ' + res.status}${data.message ? ' ' + data.message : ''}`);
  const pts = decodePolyline6(data.routes[0].geometry).map(([la, ln]) => [r6(la), r6(ln)]);
  if (pts.length < 2) throw new Error('порожня геометрія');
  return { pts, snap: data.waypoints.map((w) => Math.round(w.distance ?? 0)), engine: `${base} · ${profile}` };
}
function decodePolyline6(s) {
  const out = [];
  let i = 0, lat = 0, lng = 0;
  const next = () => { let r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); return r & 1 ? ~(r >> 1) : r >> 1; };
  while (i < s.length) { lat += next(); lng += next(); out.push([lat / 1e6, lng / 1e6]); }
  return out;
}

// ---------- перевірка лінії (план, розд. 2.3) ----------
// pts — [lat, lng] по порядку руху. Повертає { ok, leg: { pts, m, trim, raw } } або { ok: false, why }.
function checkLine(key, ptsLL, kind, snap) {
  const raw = ptsLL.map(([la, ln]) => [r6(la), r6(ln)]);
  let xz = raw.map(([la, ln]) => proj(la, ln));
  const where = (p) => ll(p).join(', ');
  // кінці: точка TukTuk OS може стояти на будівлі (пам'ятка з Wikidata), тоді лінія власника
  // починається з першої вершини — так само, як тук-тук стоїть на вулиці біля неї
  if (kind !== 'auto') {
    if (xz.length > 2 && segmentInside(xz[0], xz[1]) > IN_BUILDING) { note('info', `${key}: точка «звідки» на будівлі — лінія починається з першої вершини.`); xz = xz.slice(1); }
    if (xz.length > 2 && segmentInside(xz[xz.length - 2], xz[xz.length - 1]) > IN_BUILDING) { note('info', `${key}: точка «куди» на будівлі — лінія закінчується на останній вершині.`); xz = xz.slice(0, -1); }
    const v = raw.slice(1, -1);
    if (v.length >= 2) {
      const f = xz[0], t = xz[xz.length - 1];
      const vf = proj(...v[0]), vl = proj(...v[v.length - 1]);
      if (dxz(f, vf) > dxz(f, vl) && dxz(t, vl) > dxz(t, vf) && dxz(vf, vl) > 30) note('warn', `${key}: вершини йдуть від «куди» до «звідки» — плече намальоване задом наперед?`);
    }
  } else if (snap) {
    snap.forEach((d, i) => { if (d > SNAP_WARN) note('warn', `${key}: OSRM прив'язав точку «${i ? 'куди' : 'звідки'}» до дороги за ${d} м — точку варто поставити на вулицю, де тук-тук стоїть або проїжджає.`); });
  }
  // межа зони: кінці можна обрізати (точка за межею), вихід посередині — ні
  const inside = xz.map((p) => inRect(p, LINE_MARGIN));
  const i0 = inside.indexOf(true), i1 = inside.lastIndexOf(true);
  if (i0 < 0) return { ok: false, why: 'уся лінія поза зоною гри' };
  for (let i = i0; i <= i1; i++) if (!inside[i]) return { ok: false, why: `виходить за зону посередині (${where(xz[i])})` };
  let trim = [];
  if (i0 > 0) { xz = [cutAtEdge(xz[i0], xz[i0 - 1]), ...xz.slice(i0)]; trim.push('start'); }
  const j1 = xz.length - (inside.length - 1 - i1) - 1;
  if (i1 < inside.length - 1) { xz = [...xz.slice(0, j1 + 1), cutAtEdge(xz[j1], xz[j1 + 1])]; trim.push('end'); }
  let len = 0;
  for (let i = 1; i < xz.length; i++) {
    const d = dxz(xz[i - 1], xz[i]);
    len += d;
    if (d > JUMP && kind !== 'auto') note('warn', `${key}: стрибок ${Math.round(d)} м між вершинами біля ${where(xz[i - 1])} — збій GPS або пропущені вершини; пряма може різати квартал.`);
  }
  if (len < 5) return { ok: false, why: 'після обрізання по межі зони лінії майже не лишилось' };
  // вибірка вздовж лінії
  const run = { bld: null, off: null, ped: null, ow: null };
  const found = { bld: [], off: [], ped: [], ow: [] };
  const flush = (k) => { if (run[k]) { found[k].push(run[k]); run[k] = null; } };
  const mark = (k, on, p, extra) => {
    if (!on) return flush(k);
    if (!run[k]) run[k] = { n: 0, at: p, ...extra };
    run[k].n++;
  };
  for (let i = 1; i < xz.length; i++) {
    const [ax, az] = xz[i - 1], [bx, bz] = xz[i];
    const L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let s = i === 1 ? 0 : STEP; s <= L; s += STEP) {
      const p = [ax + ux * s, az + uz * s];
      const inB = idx.inBuilding(p);
      mark('bld', inB, p, { what: inB });
      const road = idx.nearestRoad(p);
      const drive = graph.nearestEdge(p[0], p[1], 6);
      const onStreet = road && road.d <= Math.max(OFF_STREET, road.w / 2 + 2);
      mark('off', !onStreet && !idx.inPlaza(p), p);
      mark('ped', !drive && ((road && road.d <= OFF_STREET && /^(pedestrian|busway)$/.test(road.k)) || idx.inPlaza(p)), p, { name: road?.n || idx.inPlaza(p) });
      let against = false;
      if (drive && graph.eow[drive.e]) {
        const e = drive.e, ex = graph.x[graph.eb[e]] - graph.x[graph.ea[e]], ez = graph.z[graph.eb[e]] - graph.z[graph.ea[e]];
        against = (ex * ux + ez * uz) / (Math.hypot(ex, ez) || 1) < -0.5;
      }
      mark('ow', against, p);
    }
  }
  for (const k of Object.keys(run)) flush(k);
  const bld = found.bld.filter((r) => r.n * STEP > IN_BUILDING);
  for (const r of found.off.filter((r) => r.n * STEP >= RUN_MIN)) note('warn', `${key}: ${r.n * STEP} м далі ${OFF_STREET} м від вулиці OSM, від ${where(r.at)} — лінія зрізає кут або вулиці немає в OSM.`);
  for (const r of found.ped.filter((r) => r.n * STEP >= RUN_MIN)) note('info', `${key}: ${r.n * STEP} м пішохідною вулицею чи площею${r.name ? ` (${r.name})` : ''}, від ${where(r.at)} — тук-тук тут їде за дозволом? Фізика гри проїзд дозволяє.`);
  for (const r of found.ow.filter((r) => r.n * STEP >= ONEWAY_RUN)) note('info', `${key}: ${r.n * STEP} м проти односторонньої OSM, від ${where(r.at)}.`);
  if (bld.length) {
    const r = bld[0];
    const what = r.what === 'mount' ? 'схил гори' : 'будівлю';
    note('error', `${key}: лінія перетинає ${what} біля ${where(r.at)} (місць: ${bld.length}) — у грі тук-тук вріжеться в стіну. Доки лінію не поправлено, плече бере наступне джерело (автоматична лінія або A*).`);
    return { ok: false, why: `перетинає ${what} біля ${where(r.at)}` };
  }
  const leg = { pts: xz.map(ll), m: Math.round(len), trim: trim.length ? trim.join('+') : null };
  if (kind === 'auto') leg.raw = raw;
  return { ok: true, leg };
}
function cutAtEdge(pin, pout) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const t = (lo + hi) / 2; if (inRect([pin[0] + (pout[0] - pin[0]) * t, pin[1] + (pout[1] - pin[1]) * t], LINE_MARGIN)) lo = t; else hi = t; }
  return [pin[0] + (pout[0] - pin[0]) * lo, pin[1] + (pout[1] - pin[1]) * lo];
}
function segmentInside(a, b) {
  const L = dxz(a, b);
  let n = 0;
  for (let s = 0; s <= L; s += 1) if (idx.inBuilding([a[0] + (b[0] - a[0]) * s / (L || 1), a[1] + (b[1] - a[1]) * s / (L || 1)])) n++;
  return n;
}

// ---------- підсумок і запис ----------
const outTours = {};
for (const tid of Object.keys(tours)) {
  const { ids, spec } = tours[tid];
  const keys = ids.slice(1).map((id, i) => `${ids[i]}→${id}`);
  const sum = { legs: keys.length, owner: 0, gpx: 0, auto: 0, astar: 0, lineM: 0, astarM: 0 };
  for (const k of keys) {
    const l = legs[k];
    if (l.src === 'astar') { sum.astar++; sum.astarM += l.m ?? 0; }
    else { sum[l.src === 'auto-tuktuk-os' ? 'auto' : l.src]++; sum.lineM += l.m; sum.astarM += l.joinM ?? 0; }
  }
  sum.lineShare = sum.lineM + sum.astarM ? Math.round((100 * sum.lineM) / (sum.lineM + sum.astarM)) : 0;
  outTours[tid] = { ...(spec.sameLineAs ? { sameLineAs: spec.sameLineAs } : {}), points: roles(tid), legs: keys, summary: sum };
}
const usedPoints = Object.fromEntries([...new Set(Object.values(tours).flatMap((t) => t.ids))].map((id) => [id, pointInfo[id]]));
const out = {
  _about: [
    'Лінії маршруту туру з TukTuk OS. Генерує tools/import-tuktuk-os.mjs — не правити вручну: лінії правляться в редакторі TukTuk OS (/route?edit=1, вкладка «Лінія»), склад турів — у data/tuktuk-os-map.json.',
    'legs["звідки→куди"].src: owner — лінія власника; gpx — схвалена з GPX; auto-tuktuk-os — автоматична з OSRM; astar — лінії немає, маршрут рахує гра (A* по city.json), why — чому.',
    'pts — [lat, lng] по порядку руху (напрям руху), m — довжина лінії в метрах. trim — лінію обрізано на межі зони гри, гра доїжджає до місця своїм A* (joinM).',
    'Гра цей файл ще не читає (крок 3 плану docs/plan-tuktuk-os-sync.md).',
  ],
  format: 1,
  source: { repo: 'archigreen55-prog/TukTuk-OS', ref, commit, commitDate, route, lines: lineFrom.startsWith(ref) ? 'route-line.json' : lineFrom },
  points: usedPoints,
  tours: outTours,
  legs,
};
out.hash = contentHash(out);

// ---------- друк звіту ----------
say(`TukTuk OS: ${rel(repo)} · ${ref} · ${commit.slice(0, 7)} (${commitDate.slice(0, 16).replace('T', ' ')}) · fetch: ${fetched}`);
if (newer.length) note('warn', `лінії, точки чи тури пізніше змінювались в інших гілках: ${newer.join(', ')}. Якщо нове там — --ref або source.ref.`);
const ownN = Object.keys(ownerLines).length;
say(`Лінії власника: ${ownN} ${legsWord(ownN)} у ${lineFrom}. Автоматичні (OSRM): ${osrm ? `${osrm} · ${profile}` : 'вимкнено (auto.osrm = null)'}.`);
if (!mapExists) say(`Файл відповідностей ${rel(MAP_FILE)} ще не існує — ${DRY ? 'взято варіант за замовчуванням (буде створено без --dry-run)' : 'створюю варіант за замовчуванням'}.`);
const outside = Object.entries(pointInfo).filter(([id, p]) => p.zone === 'out' && !dropped.has(id));
for (const [id, p] of outside) say(`Точка ${id} ${p.out === 'mount' ? 'на схилі гори' : `за межею зони на ${p.out} м (з відступом ${POINT_MARGIN} м)`} — у грі місце ${p.vr}.`);
if (dropped.size) say(`Не беремо: ${[...dropped].map(([id, why]) => `${id} (${why})`).join(', ')}.`);
say();
const SRC = { owner: 'власник', gpx: 'GPX', 'auto-tuktuk-os': 'авто', astar: 'A*' };
const printed = new Set();
for (const [tid, t] of Object.entries(outTours)) {
  if (t.sameLineAs && printed.has(t.sameLineAs)) {
    const r = t.points.filter(([, role]) => role === 'stop').map(([id]) => id);
    say(`Тур ${tid}: та сама лінія, що ${t.sameLineAs}. Зупинки: ${r.join(', ')}; фактів на ходу: ${t.points.filter(([, role]) => role === 'pass').length}.`);
    say();
    continue;
  }
  printed.add(tid);
  say(`Тур ${tid}: ${t.points.length} точок, ${t.legs.length} ${legsWord(t.legs.length)}`);
  say(`  ${t.points.map(([id, role]) => (role === 'stop' ? `[${id}]` : role === 'via' ? `(${id})` : id)).join(' → ')}`);
  t.legs.forEach((k, i) => {
    const l = legs[k];
    const m = l.m == null ? '    ? м' : `${String(l.m).padStart(5)} м`;
    const extra = l.src === 'astar' ? `  ${l.why}` : `${l.trim ? `  обрізано (${l.trim}), до місця A* ${l.joinM ?? '?'} м` : ''}${cachedLegs.has(k) ? '  з минулого імпорту' : ''}${l.why ? `  (${l.why})` : ''}`;
    say(`  ${String(i + 1).padStart(2)}. ${k.padEnd(40)} ${SRC[l.src].padEnd(8)} ${m}${extra}`);
  });
  const s = t.summary;
  say(`  Покриття: з лінії ${s.legs - s.astar} з ${s.legs} плечей (власник ${s.owner}, GPX ${s.gpx}, авто ${s.auto}), ${s.lineShare} % довжини; A* — ${s.astar} ${legsWord(s.astar)}, ~${s.astarM} м.`);
  say();
}
say(`Перевірки ліній: помилок ${problems.error.length}, попереджень ${problems.warn.length}, інформації ${problems.info.length}.`);
for (const lvl of ['error', 'warn', 'info']) for (const s of problems[lvl]) say(`  ${{ error: '✗', warn: '!', info: 'i' }[lvl]} ${s}`);
// зміни з минулого імпорту
if (prev?.points) {
  const shifts = [];
  for (const [id, p] of Object.entries(usedPoints)) {
    const q = prev.points[id];
    if (q) { const d = dist([p.lat, p.lng], [q.lat, q.lng]); if (d > SHIFT_WARN) shifts.push(`${id} ${Math.round(d)} м`); }
  }
  const changed = Object.keys(legs).filter((k) => prev.legs?.[k] && prev.legs[k].src !== legs[k].src).map((k) => `${k}: ${SRC[prev.legs[k].src] ?? prev.legs[k].src} → ${SRC[legs[k].src]}`);
  say(`З минулого імпорту: точки зсунулись > ${SHIFT_WARN} м — ${shifts.length ? shifts.join(', ') : 'ні'}; джерело плеча змінилось — ${changed.length ? changed.join(', ') : 'ні'}.`);
} else say('Минулого імпорту немає.');

// безпека: у вихідних файлах не має бути ключів і адрес бази
const LEAK = [/supabase\.co/i, /eyJ[A-Za-z0-9_-]{8,}\./, /service_role/i, /anon[ _-]?key/i, /SUPABASE_/, /VITE_/, /sk_live/, /-----BEGIN/];
const outText = stringify(out) + '\n';
const mapText = stringify(map) + '\n';
for (const [name, text] of [[rel(OUT_FILE), outText], [rel(MAP_FILE), mapText]]) {
  const hit = LEAK.find((re) => re.test(text));
  if (hit) { say(`✗ ${name}: знайдено ${hit} — схоже на ключ чи адресу бази. Нічого не записано.`); finish(1); }
}

const same = prev && !prevHand && prev.hash === out.hash;
const kb = (Buffer.byteLength(outText) / 1024).toFixed(1);
if (DRY) {
  if (prevHand) say(`! ${rel(OUT_FILE)} правили вручну (хеш не збігається) — без --force запис буде зупинено.`);
  say(`--dry-run: нічого не записано. ${rel(OUT_FILE)} ${same ? 'не змінився б' : `був би записаний (${kb} КБ)`}.`);
  finish(0);
}
if (prevHand && !args.force) {
  say(`✗ ${rel(OUT_FILE)} правили вручну (хеш не збігається). Лінії правляться в редакторі TukTuk OS. Щоб переписати — --force.`);
  finish(1);
}
if (!mapExists) { writeFileSync(MAP_FILE, mapText); say(`Записано ${rel(MAP_FILE)} (варіант за замовчуванням — редагуй).`); }
if (same) say(`${rel(OUT_FILE)}: без змін.`);
else { writeFileSync(OUT_FILE, outText); say(`Записано ${rel(OUT_FILE)} (${kb} КБ).`); }
finish(0);

// ---------- допоміжне ----------
function finish(code) { console.log(log.join('\n')); process.exit(code); }
function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }
function legsWord(n) { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? 'плече' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'плечі' : 'плечей'; }
function firstLine(s) { return String(s).trim().split('\n')[0]; }
function rel(p) { const r = relative(ROOT, p); return r.startsWith('..') ? p.replace(homedir(), '~') : r; }
function readJson(file) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch (err) { fail(`${file}: ${err.message}`); } }
function dxz(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
function dist(a, b) { return dxz(proj(a[0], a[1]), proj(b[0], b[1])); }
function contentHash(o) {
  const { hash, ...rest } = o;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex').slice(0, 16);
}
// JSON з числовими масивами в один рядок: лінії лишаються читабельними й короткими
function stringify(v, ind = '') {
  if (Array.isArray(v)) {
    const flat = JSON.stringify(v);
    if (v.every((x) => typeof x !== 'object' || x === null || (Array.isArray(x) && x.every((y) => typeof y !== 'object'))) && (flat.length <= 120 || v.every((x) => typeof x !== 'string'))) return flat;
    return `[\n${v.map((x) => ind + '  ' + stringify(x, ind + '  ')).join(',\n')}\n${ind}]`;
  }
  if (v && typeof v === 'object') {
    const e = Object.entries(v).filter(([, x]) => x !== undefined);
    if (!e.length) return '{}';
    return `{\n${e.map(([k, x]) => `${ind}  ${JSON.stringify(k)}: ${stringify(x, ind + '  ')}`).join(',\n')}\n${ind}}`;
  }
  return JSON.stringify(v);
}

// Індекси міста для перевірок: будівлі й гора (точка всередині), вулиці OSM (найближча), площі.
function buildIndexes(c) {
  const CELL = 50;
  const key = (i, j) => i * 100000 + j;
  const cell = (v) => Math.floor(v / CELL);
  const polys = [];
  const grid = new Map();
  const add = (g, item, minX, minZ, maxX, maxZ) => {
    for (let i = cell(minX); i <= cell(maxX); i++) for (let j = cell(minZ); j <= cell(maxZ); j++) {
      const k = key(i, j);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(item);
    }
  };
  const bbox = (p) => { let a = Infinity, b = Infinity, c2 = -Infinity, d = -Infinity; for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); c2 = Math.max(c2, p[i]); b = Math.min(b, p[i + 1]); d = Math.max(d, p[i + 1]); } return [a, b, c2, d]; };
  const pip = (p, x, z) => { let ins = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins; } return ins; };
  for (const b of c.buildings) { const item = { p: b.p, holes: b.holes || [], what: 'building' }; polys.push(item); add(grid, item, ...bbox(b.p)); }
  if (c.mount?.foot) { const item = { p: c.mount.foot, holes: [], what: 'mount' }; add(grid, item, ...bbox(c.mount.foot)); }
  const plazaGrid = new Map();
  for (const pl of c.plazas) { const item = { p: pl.p, holes: [], what: pl.n || (pl.k === 'explanada' ? 'Explanada' : 'площа') }; add(plazaGrid, item, ...bbox(pl.p)); }
  const segGrid = new Map();
  for (const r of c.roads) for (let i = 2; i < r.p.length; i += 2) {
    const s = { ax: r.p[i - 2], az: r.p[i - 1], bx: r.p[i], bz: r.p[i + 1], r };
    add(segGrid, s, Math.min(s.ax, s.bx), Math.min(s.az, s.bz), Math.max(s.ax, s.bx), Math.max(s.az, s.bz));
  }
  const hit = (g, [x, z]) => { for (const it of g.get(key(cell(x), cell(z))) ?? []) if (pip(it.p, x, z) && !it.holes.some((h) => pip(h, x, z))) return it.what; return null; };
  return {
    inBuilding: (p) => hit(grid, p),
    inPlaza: (p) => hit(plazaGrid, p),
    nearestRoad([x, z]) {
      let best = null;
      const ci = cell(x), cj = cell(z);
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const s of segGrid.get(key(i, j)) ?? []) {
        const ex = s.bx - s.ax, ez = s.bz - s.az, l2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / l2));
        const d = Math.hypot(x - s.ax - ex * t, z - s.az - ez * t);
        if (!best || d < best.d) best = { d, w: s.r.w, k: s.r.k, n: s.r.n };
      }
      return best;
    },
  };
}
