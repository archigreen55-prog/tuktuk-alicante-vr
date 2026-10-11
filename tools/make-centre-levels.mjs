// Builds the Crazy Tuk levels of the city centre ("Центр", "Центр-міні", 0.20.1; docs/plan-tuktuk-os-sync-2.md, section 5): gates on the
// places of TukTuk OS (data/places-os.json), via points where the one-way streets make the way bend. Run after build-city / the sync:
//   node tools/make-centre-levels.mjs            prints the route of every variant (length, climb, grade, straights)
//   node tools/make-centre-levels.mjs --write    writes data/levels/centre.json and centre-mini.json (the index and the par: make-levels / sim-arcade)
// The orders below were chosen by a search over the centre places (legs without a stretch steeper than 10 % over 20 m, little re-driving
// of the same street); the bonus gate is Calle San Francisco (the "mushroom street", a short steep ramp): skipping it costs nothing.
// The finish is the Meliá place, but its gate stands on the carriageway you arrive by: the hotel is on a dual carriageway of one-way lanes, and the
// pickup point (the lane the tuk-tuk leaves by) can be reached from the north only by a loop of a kilometre. FINISH is the node of the southbound lane.
import { readFile, writeFile } from 'node:fs/promises';
import { Terrain, profileAlong } from '../src/city/terrain.js';
import { RoadGraph } from '../src/game/route.js';
import { viasFromPath } from '../src/game/pathfind.js';

const city = JSON.parse(await readFile('data/city.json', 'utf8'));
const terrain = Terrain.fromBin(city.meta.terrain, (await readFile(city.meta.terrain.file)).buffer.slice(0));
const og = new RoadGraph(city.tour.graph);   // the one-way tour graph: what the planned route and the simulation use
const P = city.tour.places;

const FINISH = { place: 'melia', finish: true, p: [603, 347] };
export const LEVELS = {
  centre: {
    title: { uk: 'Центр', en: 'City centre', es: 'Centro' },
    order: ['casaCarbonell', 'explanada', 'canalejas', 'ficus', 'brujas', { place: 'sanFrancisco', bonus: true }, 'luceros', 'mercado', 'rambla'],
  },
  'centre-mini': {
    title: { uk: 'Центр-міні', en: 'Centre mini', es: 'Centro mini' },
    order: ['townHall', 'mercado', 'luceros', { place: 'sanFrancisco', bonus: true }, 'university', 'rambla'],
  },
};

const norm = (g) => (typeof g === 'string' ? { place: g } : g);
export function build(id) {
  const def = LEVELS[id], items = []; let prev = P.melia.p, pts = [], len = 0;
  const legs = [];
  for (const g of [...def.order.map(norm), FINISH]) {
    const here = g.p || P[g.place].p, r = og.routeVia([prev, here]);
    if (!r) throw new Error(`${id}: no route ${legs.length ? legs[legs.length - 1].to : 'melia'} -> ${g.place}`);
    for (const v of viasFromPath(r.pts, prev, here)) items.push({ k: 'via', p: v });
    items.push({ k: 'gate', place: g.place, ...(g.bonus ? { bonus: true } : {}), ...(g.finish ? { finish: true, p: g.p } : {}) });
    legs.push({ to: g.place, len: Math.round(r.len) }); pts = pts.length ? pts.concat(r.pts.slice(1)) : r.pts; len += r.len; prev = here;
  }
  return { level: { schema: 1, id, title: def.title, type: 'standard', start: { place: 'melia' }, time: { mode: 'auto', par: null }, items, rules: {}, extras: {} }, pts, len, legs };
}
// the longest straights (m): consecutive segments whose heading stays within 12 degrees
function straights(pts) {
  const list = []; let cur = 0, h0 = null;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1], L = Math.hypot(dx, dz), h = Math.atan2(dz, dx);
    if (h0 === null || Math.abs(Math.atan2(Math.sin(h - h0), Math.cos(h - h0))) < 0.21) { cur += L; if (h0 === null) h0 = h; } else { if (cur > 120) list.push(Math.round(cur)); cur = L; h0 = h; }
  }
  if (cur > 120) list.push(Math.round(cur));
  return list;
}
export function stats(pts) {
  const prof = profileAlong(terrain, pts, 5); let maxG = 0, climb = 0, hi = -1e9; const steep = [];
  for (let i = 4; i < prof.length; i++) { const g = Math.abs(prof[i].y - prof[i - 4].y) / (prof[i].s - prof[i - 4].s || 1); maxG = Math.max(maxG, g); if (g > 0.1) steep.push(`(${prof[i].x.toFixed(0)},${prof[i].z.toFixed(0)}) ${(g * 100).toFixed(0)} %`); }
  for (let i = 1; i < prof.length; i++) { climb += Math.max(0, prof[i].y - prof[i - 1].y); hi = Math.max(hi, prof[i].y); }
  return { maxG, climb, hi, steep, straights: straights(pts) };
}

if (process.argv[1] && process.argv[1].endsWith('make-centre-levels.mjs')) {
  const text = (lv) => {
    const j = (v) => JSON.stringify(v);
    return `{\n  "schema": ${lv.schema},\n  "id": ${j(lv.id)},\n  "title": ${j(lv.title)},\n  "type": ${j(lv.type)},\n  "start": ${j(lv.start)},\n  "time": ${j(lv.time)},\n  "items": [\n${lv.items.map((it) => '    ' + j(it)).join(',\n')}\n  ],\n  "rules": ${j(lv.rules)},\n  "extras": ${j(lv.extras)}\n}\n`;
  };
  for (const id of Object.keys(LEVELS)) {
    const b = build(id), s = stats(b.pts);
    console.log(`${id}: ${b.level.items.filter((i) => i.k === 'gate').length} gates (${b.level.items.filter((i) => i.bonus).length} bonus), ${b.level.items.filter((i) => i.k === 'via').length} vias, route ${(b.len / 1000).toFixed(2)} km, climb ${s.climb.toFixed(1)} m, top ${s.hi.toFixed(1)} m, max grade (20 m) ${(s.maxG * 100).toFixed(1)} %`);
    console.log(`  legs: ${b.legs.map((l) => `${l.to} ${l.len}`).join(' | ')}`);
    console.log(`  straights > 120 m: ${s.straights.join(', ')}; steeper than 10 %: ${s.steep.slice(0, 6).join('; ') || 'none'}`);
    if (process.argv.includes('--write')) {
      let par = null; try { par = JSON.parse(await readFile('data/arcade-par.json', 'utf8'))[id] || null; } catch { /* none yet */ }
      b.level.time.par = par; await writeFile(`data/levels/${id}.json`, text(b.level)); console.log(`  → data/levels/${id}.json (par ${par ?? 'not measured yet'})`);
      const idx = JSON.parse(await readFile('data/levels/index.json', 'utf8')), row = { id, file: `${id}.json`, builtin: true, type: 'standard', gates: b.level.items.filter((i) => i.k === 'gate').length, title: b.level.title };
      const at = idx.levels.findIndex((l) => l.id === id); if (at >= 0) idx.levels[at] = { ...idx.levels[at], ...row }; else idx.levels.splice(Object.keys(LEVELS).indexOf(id), 0, row);
      await writeFile('data/levels/index.json', JSON.stringify(idx, null, 2) + '\n');
    }
  }
}
