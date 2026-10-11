// The centre levels (0.20.1): valid, the gates are on places of the city, the Meliá finish stands on the carriageway you arrive by, and the bonus
// gate (Calle San Francisco) works: taking it pays twice, skipping it costs nothing and is not a miss.   node tools/test-centre.mjs
import { readFile } from 'node:fs/promises';
import { loadSpec } from './lib/load-spec.mjs';
import { RoadGraph } from '../src/game/route.js';
import { Arcade, RUSH } from '../src/game/arcade.js';
import { validateLevel } from '../src/game/levels.js';
let bad = 0; const check = (c, m, x = '') => { if (!c) bad++; console.log(c ? 'ok  ' : 'FAIL', m, x); };
const spec = await loadSpec(), city = JSON.parse(await readFile('data/city.json', 'utf8')), graph = new RoadGraph(city.tour.graph);
const idx = JSON.parse(await readFile('data/levels/index.json', 'utf8'));
check(idx.levels[0].id === 'centre' && idx.levels[1].id === 'centre-mini', 'the centre levels come first in the list', idx.levels.map((l) => l.id).join());
check(idx.levels.filter((l) => l.group === 'hard').map((l) => l.id).join() === 'castle,full' && !idx.levels.some((l) => l.id === 'short' && l.group), 'castle and full are "hard", short is not');
const facts = {}; for (const [id, p] of Object.entries(spec.places)) if (p.line) facts[id] = p.line;
for (const id of ['centre', 'centre-mini']) {
  const lv = JSON.parse(await readFile(`data/levels/${id}.json`, 'utf8'));
  check(validateLevel(lv, { places: city.tour.places }).length === 0, `${id} is valid`, validateLevel(lv, { places: city.tour.places }).join('; '));
  const run = new Arcade(lv, { places: city.tour.places, spec, graph }, { facts, useRoute: false });
  const bonus = run.gates.filter((g) => g.bonus);
  check(bonus.length === 1 && bonus[0].id === 'sanFrancisco' && run.regular === run.gates.length - 1, `${id}: one bonus gate (San Francisco), the others count`, `${run.gates.length} gates, ${run.regular} regular`);
  const fin = run.gates.at(-1);
  check(fin.finish && fin.id === 'melia' && Math.hypot(fin.p[0] - city.tour.places.melia.p[0], fin.p[1] - city.tour.places.melia.p[1]) < 20 && fin.title === spec.places.melia.title, `${id}: the finish is Meliá on the other carriageway (≤ 20 m from its place)`);
  check(lv.time.par > 120 && lv.time.par < 600, `${id}: par measured`, String(lv.time.par));
  check(run.gates.every((g) => g.short === '' || g.short.length <= 90), `${id}: gate lines ≤ 90`);
  // the bonus gate: take it (exact) -> twice the tips of an ordinary gate; skip it -> nothing lost
  const play = (takeBonus) => {
    const r = new Arcade(lv, { places: city.tour.places, spec, graph }, { facts, useRoute: false }); r.par = 300; r.timeLeft = 300 * 0.35; r.begin(0, 0);
    const out = { tips: [] };
    for (let i = 0; i < r.gates.length; i++) {
      const g = r.gates[i];
      if (g.bonus && !takeBonus) continue;   // drive past it to the next gate: the active gate is dropped when the next one is reached
      for (const [x, z] of [[g.p[0] - 30, g.p[1]], [g.p[0], g.p[1]], [g.p[0] + 6, g.p[1]], [g.p[0] + 12, g.p[1]]]) { r.update({ dt: 0.1, x, z, speed: 20, impact: 0, contact: false, blocked: false, nitroActive: false, clearance: null, drifting: false }); for (const ev of r.events) if (ev.type === 'gate') out.tips.push(ev); }
    }
    return { run: r, ...out };
  };
  const took = play(true), skipped = play(false);
  const bEv = took.tips.find((e) => e.bonus), oEv = took.tips.find((e) => !e.bonus && !e.finish && e.kind === 'exact');
  const unit = RUSH.gateTips.exact * RUSH.bonusMul, k = bEv ? bEv.tips / unit : 0;   // the tips are × the combo (1..comboMax)
  check(bEv && bEv.kind === 'exact' && Number.isInteger(k) && k >= 1 && k <= RUSH.comboMax && oEv.tips % RUSH.gateTips.exact === 0, `${id}: a bonus gate pays ×${RUSH.bonusMul} (× combo ${k})`, bEv ? `${bEv.tips} vs ordinary ${oEv.tips}` : 'no event');
  check(took.run.result && took.run.result.bonusGates === 1 && took.run.result.bonusTaken === 1, `${id}: the result counts the bonus gate as taken`);
  const sk = skipped.run.result;
  check(sk && sk.missed === 0 && sk.bonusTaken === 0 && skipped.run.results.includes('skipped'), `${id}: skipping the bonus gate is not a miss`, sk ? `missed ${sk.missed}, results ${skipped.run.results.join()}` : 'no result');
}
console.log(bad ? `${bad} FAILED` : 'ALL OK'); process.exit(bad ? 1 : 0);
