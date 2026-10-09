// Builds the levels of the three tours of the game: data/levels/<id>.json and data/levels/index.json, from data/tour.json (the route),
// data/arcade-via.json (via points, tools/arcade-vias.mjs) and data/arcade-par.json (the measured par, tools/sim-arcade.mjs --par --write).
//   node tools/make-levels.mjs
// Levels of the owner (from the editor) are NOT touched: they are added by hand as data/levels/<id>.json plus a line in the index (see docs/level-editor.md).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { levelFromTour, validateLevel, levelTitle } from '../src/game/levels.js';

const spec = JSON.parse(await readFile('data/tour.json', 'utf8'));
const city = JSON.parse(await readFile('data/city.json', 'utf8'));
const via = JSON.parse(await readFile('data/arcade-via.json', 'utf8'));
const par = JSON.parse(await readFile('data/arcade-par.json', 'utf8'));
await mkdir('data/levels', { recursive: true });

let index = { schema: 1, levels: [] };
try { index = JSON.parse(await readFile('data/levels/index.json', 'utf8')); } catch { /* first run */ }
const own = index.levels.filter((l) => !l.builtin);   // levels added by hand stay in the list

// one item per line: the file is read and corrected by people
const text = (lv) => {
  const j = (v) => JSON.stringify(v);
  const rows = lv.items.map((it) => '    ' + j(it));
  return `{\n  "schema": ${lv.schema},\n  "id": ${j(lv.id)},\n  "title": ${j(lv.title)},\n  "type": ${j(lv.type)},\n  "start": ${j(lv.start)},\n  "time": ${j(lv.time)},\n  "items": [\n${rows.join(',\n')}\n  ],\n  "rules": ${j(lv.rules)},\n  "extras": ${j(lv.extras)}\n}\n`;
};

const built = [];
for (const t of spec.tours) {
  const lv = levelFromTour(spec, t.id, { vias: via[t.id] || null, par: par[t.id] || null });
  const er = validateLevel(lv, { places: city.tour.places });
  if (er.length) throw new Error(`${t.id}: ${er.join('; ')}`);
  await writeFile(`data/levels/${t.id}.json`, text(lv));
  built.push({ id: lv.id, file: `${lv.id}.json`, builtin: true, type: lv.type, gates: lv.items.filter((i) => i.k === 'gate').length, title: lv.title });
  console.log(`${lv.id}: ${levelTitle(lv)} | ${lv.title.en} | ${lv.title.es} · ворота ${built[built.length - 1].gates}, через ${lv.items.filter((i) => i.k === 'via').length}, par ${lv.time.par}`);
}
await writeFile('data/levels/index.json', JSON.stringify({ schema: 1, levels: [...built, ...own] }, null, 2) + '\n');
console.log('data/levels/index.json:', built.length + own.length, 'рівнів');
