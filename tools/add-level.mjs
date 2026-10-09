// Adds a level that the owner sent (a code from the editor's "Поділитися", or a .json file) to the game:
//   node tools/add-level.mjs <TTL1.code | file.json> [--id my-id] [--en "English name"] [--es "Nombre en español"] [--write]
// Decodes, validates (src/game/levels.js), fills the empty en / es names from --en / --es, measures the time with the simulation's autopilot when the
// level's time is "auto" (par = the normal driver's time × 1.3, as for the built-in tours), and with --write puts data/levels/<id>.json and the line in
// data/levels/index.json. Without --write it only reports. After it: node tools/bump-version.mjs <ver>, commit, push to main.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeLevel } from '../src/game/levelShare.js';
import { validateLevel, levelTitle } from '../src/game/levels.js';
import { simulate, loadLevelFile } from './sim-arcade.mjs';

const args = process.argv.slice(2), flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const VALUE_FLAGS = ['--id', '--en', '--es'];
const src = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1]));
if (!src) { console.log('usage: node tools/add-level.mjs <TTL1.code | file.json> [--id id] [--en "…"] [--es "…"] [--write]'); process.exit(1); }
const city = JSON.parse(await readFile('data/city.json', 'utf8'));
const text = existsSync(src) ? await readFile(src, 'utf8') : src;
const r = await decodeLevel(text, { places: city.tour.places });
if (r.error) { console.log('ERROR:', r.error); process.exit(1); }
const lv = r.level;
if (flag('--id')) lv.id = flag('--id');
else if (/^my-/.test(lv.id)) lv.id = lv.id.replace(/^my-/, 'lv-');   // the editor's ids are device-bound; the game's levels get their own
lv.title = { uk: lv.title.uk || '', en: flag('--en') || lv.title.en || '', es: flag('--es') || lv.title.es || '' };
const er = validateLevel(lv, { places: city.tour.places });
console.log(`level ${lv.id}: «${lv.title.uk}» | en: «${lv.title.en}» | es: «${lv.title.es}» | ${lv.items.filter((i) => i.k === 'gate').length} gates, ${lv.items.filter((i) => i.k === 'via').length} via, type ${lv.type}, time ${lv.time.mode}${lv.time.par ? ' ' + lv.time.par + ' s' : ''}`);
if (er.length) { console.log('PROBLEMS:\n  ' + er.join('\n  ')); process.exit(1); }
if (!lv.title.en || !lv.title.es) console.log('NOTE: en / es names are empty: pass --en and --es (the translations are mine to make)');
// the time: measured by the autopilot when "auto"
if (lv.time.mode === 'auto') {
  const tmp = join(tmpdir(), `add-level-${process.pid}.json`);
  await writeFile(tmp, JSON.stringify(lv));
  const id = await loadLevelFile(tmp);
  try {
    const s = simulate(id, 'normal', { par: null });
    if (s.run.state === 'finished') { lv.time.par = Math.round(s.run.clock * 1.3); console.log(`autopilot: finished in ${s.run.clock.toFixed(1)} s (${s.run.hits} wall hits) -> par ${lv.time.par} s`); }
    else console.log(`autopilot did not finish (${s.run.state}, gates ${s.run.results.filter(Boolean).length}/${s.run.gates.length}): par stays "from the length" in the game`);
  } catch (e) { console.log('autopilot failed:', e.message); }
}
if (!args.includes('--write')) { console.log('\n(dry run; add --write to store it)'); process.exit(0); }
const file = `data/levels/${lv.id}.json`;
const row = (l) => '    ' + JSON.stringify(l);
await writeFile(file, `{\n  "schema": ${lv.schema},\n  "id": ${JSON.stringify(lv.id)},\n  "title": ${JSON.stringify(lv.title)},\n  "type": ${JSON.stringify(lv.type)},\n  "start": ${JSON.stringify(lv.start)},\n  "time": ${JSON.stringify(lv.time)},\n  "items": [\n${lv.items.map(row).join(',\n')}\n  ],\n  "rules": ${JSON.stringify(lv.rules || {})},\n  "extras": ${JSON.stringify(lv.extras || {})}\n}\n`);
const idx = JSON.parse(await readFile('data/levels/index.json', 'utf8'));
const entry = { id: lv.id, file: `${lv.id}.json`, builtin: false, type: lv.type, gates: lv.items.filter((i) => i.k === 'gate').length, title: lv.title };
idx.levels = idx.levels.filter((l) => l.id !== lv.id).concat([entry]);
await writeFile('data/levels/index.json', JSON.stringify(idx, null, 2) + '\n');
console.log(`written ${file} and data/levels/index.json (${levelTitle(lv)}). Next: node tools/bump-version.mjs <ver>, commit, push to main.`);
process.exit(0);
