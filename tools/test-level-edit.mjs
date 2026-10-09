// The editor's model (src/game/levelEdit.js) on the real city: adding / moving / deleting / reordering, the 3-12 gates rule, undo / redo,
// snapping to the road, the via point goes into the nearest segment, and a level made this way runs in Arcade.
//   node tools/test-level-edit.mjs
import { readFile } from 'node:fs/promises';
import { RoadGraph } from '../src/game/route.js';
import { Arcade } from '../src/game/arcade.js';
import { LevelDoc, newLevel } from '../src/game/levelEdit.js';
import { LEVEL, validateLevel, levelFromTour } from '../src/game/levels.js';
import { driveGraph, checkLevel, PATH } from '../src/game/pathfind.js';
import { buildWorld } from './sim-tour.mjs';
import { encodeLevel, decodeLevel } from '../src/game/levelShare.js';

const city = JSON.parse(await readFile('data/city.json', 'utf8')), spec = JSON.parse(await readFile('data/tour.json', 'utf8'));
const graph = new RoadGraph(city.tour.graph), facts = JSON.parse(await readFile('data/arcade-facts.json', 'utf8')).uk;
const ctx = { graph, places: city.tour.places, spec, facts };
let bad = 0; const check = (c, m, x = '') => { if (!c) bad++; console.log(c ? 'ok  ' : 'FAIL', m, x); };

const doc = new LevelDoc(newLevel({ id: 'my-test', title: 'Тест' }), ctx);
check(doc.items.length === 1 && doc.items[0].finish && doc.items[0].place === 'melia', 'a new level: the finish at the start place');
check(doc.problems().level.some((t) => /воріт 1/.test(t)), 'problem: too few gates', doc.problems().level.join('; '));
// gates on the road (a point 8 m off the road snaps to it)
const e = graph.nearestEdge(468, 191, 50); 
const r = doc.addGate(e.x + 6, e.z + 6);
check(r.index === 0 && doc.items[0].k === 'gate' && doc.items[0].d, 'a gate is added before the finish, with the direction of the road', JSON.stringify(doc.items[0]));
{ const q = graph.nearestEdge(doc.items[0].p[0], doc.items[0].p[1], 5); check(q && q.d < 0.15, 'it snapped to the road', q && q.d.toFixed(3)); }
const far = doc.addGate(-1000, -1000);   // far from any road: stays where it is, no direction
check(doc.items[1].d === undefined && far.onRoad === false, 'a point far from a road is not snapped');
check(doc.valid, 'three gates (2 + the finish) are valid', JSON.stringify([...doc.problems().items]));
check(doc.finishIndex === 2 && doc.items[2].finish, 'the finish is still last');
// via: into the nearest segment
const v = doc.addVia(doc.items[0].p[0] + 3, doc.items[0].p[1] + 3);
check(doc.items[v.index].k === 'via', 'a via point added', `at ${v.index}`);
check(doc.items.map((i) => i.k).join() === 'via,gate,gate,gate' || doc.items.map((i) => i.k).join() === 'gate,via,gate,gate', 'in the first segment: ' + doc.items.map((i) => i.k).join());
// undo / redo
const n0 = doc.items.length; doc.undo(); check(doc.items.length === n0 - 1, 'undo removes the via'); doc.redo(); check(doc.items.length === n0, 'redo brings it back');
// max gates
let last; for (let i = 0; i < 20; i++) last = doc.addGate(e.x + i * 3, e.z); 
check(doc.gates.length === LEVEL.maxGates && last.error, `no more than ${LEVEL.maxGates} gates`, last.error);
check(doc.finishIndex === doc.items.length - 1, 'the finish is last after many adds');
// the finish cannot be removed or moved up/down
check(doc.remove(doc.finishIndex).error, 'finish cannot be deleted');
check(doc.reorder(doc.finishIndex, -1).error, 'finish cannot be moved in the order');
check(doc.reorder(doc.finishIndex - 1, 1).error, 'nothing can go past the finish');
const a = doc.items[1].p.join(), b = doc.items[2].p.join(); doc.reorder(1, 1);
check(doc.items[1].p.join() === b && doc.items[2].p.join() === a, 'reorder swaps two neighbours');
// remove, undo to 30 steps
const before = doc.items.length; doc.remove(0); check(doc.items.length === before - 1, 'remove'); doc.undo(); check(doc.items.length === before, 'undo remove');
for (let i = 0; i < 40; i++) doc.setTitle('en', 'x' + i);
check(doc.undoStack.length === 30, 'undo is capped at 30', doc.undoStack.length);
// drag a place gate: it becomes a free gate that keeps its name and fact
const d2 = new LevelDoc(levelFromTour(spec, 'short'), ctx);
const i = d2.items.findIndex((q) => q.place === 'explanada');
d2.beginDrag(); d2.dragTo(i, d2.pointOf(d2.items[i])[0] + 12, d2.pointOf(d2.items[i])[1]); d2.dragTo(i, d2.pointOf(d2.items[i])[0] + 3, d2.pointOf(d2.items[i])[1]); d2.endDrag();
check(!d2.items[i].place && d2.items[i].title === spec.places.explanada.title && d2.items[i].fact === facts.explanada, 'a moved place gate keeps title and fact', JSON.stringify(d2.items[i]));
check(d2.undoStack.length === 1, 'a drag is one undo step'); d2.undo(); check(d2.items[i].place === 'explanada', 'undo of the drag restores the place gate');
d2.beginDrag(); d2.dragTo(i, 0, 0); d2.cancelDrag(); check(d2.items[i].place === 'explanada', 'cancelDrag restores it');
// the built-in levels are valid
for (const t of spec.tours) check(validateLevel(levelFromTour(spec, t.id), { places: city.tour.places }).length === 0, `${t.id} is valid`);
// validation: no uk title, 2 gates, finish not last, via after the finish, too long a fact
const bads = (mut) => { const lv = JSON.parse(JSON.stringify(doc.level)); mut(lv); return validateLevel(lv, { places: city.tour.places }); };
check(bads((lv) => { lv.title.uk = ' '; }).length > 0, 'no uk title: invalid');
check(bads((lv) => { lv.time = { mode: 'manual', par: 5 }; }).some((t) => /секунд/.test(t)), 'manual time out of range');
check(bads((lv) => { lv.items.push({ k: 'via', p: [1, 1] }); }).some((t) => /після фінішу/.test(t)), 'a via after the finish');
check(bads((lv) => { lv.items.find((q) => q.k === 'gate').fact = 'я'.repeat(80); }).some((t) => /факт/.test(t)), 'a fact over 70 characters');
// the level runs in Arcade (the far gate of the test, which no road reaches, goes first)
doc.remove(doc.items.findIndex((q) => q.k === 'gate' && q.p && q.p[0] === -1000));
const run = new Arcade(doc.level, { places: city.tour.places, spec, graph }, { facts, useRoute: false });
check(run.gates.length === 11 && run.gates.at(-1).finish && run.gates[0].d.length === 2, 'Arcade accepts the level', `${run.gates.length} gates`);
run.estimatePar(); check(run.par > 0, 'auto time: par from the length', String(run.par));
// ---- the map checks (pathfind.js) ----
const dg = JSON.parse(await readFile('data/drive-graph.json', 'utf8'));
check(dg.edges === city.tour.graph.e.length / 3 && dg.dropped.length > 20, 'drive-graph.json matches the city', `${dg.dropped.length} dropped of ${dg.edges}`);
const drive = driveGraph(city, dg.dropped), { world } = buildWorld();
const pctx = { drive, clear: (x, z, r) => world.penetration(x, z, r) === 0 };
for (const t of spec.tours) { const c = checkLevel(new LevelDoc(levelFromTour(spec, t.id, { vias: JSON.parse(await readFile('data/arcade-via.json', 'utf8'))[t.id] }), ctx), pctx); check(c.items.size === 0 && c.len > 1000, `${t.id}: no problems on the map, ${(c.len / 1000).toFixed(2)} km`, JSON.stringify([...c.items])); }
// the castle without its via points: the checker asks for them, and with them the leg is fine
{
  const castle = JSON.parse(await readFile('data/levels/castle.json', 'utf8')); castle.items = castle.items.filter((q) => q.k !== 'via');
  const dd = new LevelDoc(castle, ctx), c1 = checkLevel(dd, pctx);
  const marq = dd.items.findIndex((q) => q.place === 'marq');
  check(c1.suggestions.some((q) => q.at === marq && q.vias.length >= 3), 'castle without vias: the leg to MARQ needs a detour', JSON.stringify(c1.suggestions.map((q) => [q.at, q.vias.length])));
  dd.edit((lv) => { for (const sg of [...c1.suggestions].sort((a, b) => b.at - a.at)) lv.items.splice(sg.at, 0, ...sg.vias.map((v) => ({ k: 'via', p: v }))); });
  const c2 = checkLevel(dd, pctx); check(c2.suggestions.length === 0 && c2.items.size === 0, 'after accepting them nothing is left', JSON.stringify([...c2.items]));
}
// a gate in a building, a gate far from every road, two gates 10 m apart
{
  const d3 = new LevelDoc(newLevel({ id: 'my-x', title: 'x' }), ctx);
  let wall = null;   // the nearest point by the Explanada with a wall closer than 1 m (found on the real collision world)
  for (let r = 4; r < 80 && !wall; r += 2) for (let a = 0; a < 6.28 && !wall; a += 0.1) { const x = 468 + Math.cos(a) * r, z = 191 + Math.sin(a) * r; if (world.penetration(x, z, 1) > 0) wall = [x, z]; }
  d3.addGate(wall[0], wall[1]); d3.items[0].p = [wall[0], wall[1]]; delete d3.items[0].d;   // put right on a wall (no snapping)
  d3.addGate(-1000, -1000);
  const e1 = graph.nearestEdge(468, 191, 50); d3.addGate(e1.x, e1.z); d3.addGate(e1.x + 10, e1.z);
  const c = checkLevel(d3, pctx), txt = (i) => (c.items.get(i) || []).join(' | ');
  check(/стіні або будівлі/.test(txt(0)), 'a gate on a wall is flagged', txt(0));
  check(/далеко від дороги/.test(txt(1)), 'a gate far from any road is flagged', txt(1));
  check(/ближче 25 м/.test(txt(3)), 'two gates 10 m apart: the second is flagged', txt(3));
}
// ---- stay-on-road: the rule in Arcade, the corridor in the checks ----
{
  const shortLv = JSON.parse(await readFile('data/levels/short.json', 'utf8'));
  const stayLv = (rules = {}, type = 'stay-on-road') => ({ ...JSON.parse(JSON.stringify(shortLv)), type, rules });
  check(validateLevel(stayLv({ margin: 1 }), { places: city.tour.places }).length === 0, 'a stay-on-road level is valid');
  check(validateLevel(stayLv({ margin: 9 }), { places: city.tour.places }).some((t) => /margin/.test(t)), 'margin out of range is refused');
  check(validateLevel(stayLv({}, 'stunt'), { places: city.tour.places }).length === 0, 'the types stay in the format');
  const dd = new LevelDoc(stayLv(), ctx); dd.setType('standard'); dd.setType('stay-on-road');
  check(dd.level.rules.margin === 1, 'choosing the type puts the default margin into the rules', JSON.stringify(dd.level.rules));
  // a point on a residential street and one beside it
  const e = graph.nearestEdge(468, 191, 80), a = graph.ea[e.e], b = graph.eb[e.e];
  const dx = graph.x[b] - graph.x[a], dz = graph.z[b] - graph.z[a], l = Math.hypot(dx, dz), nx = -dz / l, nz = dx / l, half = graph.roadHalf(e.e);
  const feed = (run, x, z, secs) => { const ev = []; for (let t = 0; t < secs; t += 1 / 72) { run.update({ dt: 1 / 72, x, z, speed: 22, impact: 0, contact: false, blocked: false, nitroActive: false, clearance: null, drifting: false }); ev.push(...run.events); } return ev; };
  const mk = (lv) => new Arcade(lv, { places: city.tour.places, spec, graph, drive }, { facts, useRoute: false });
  const run = mk(stayLv({ margin: 1 })); run.par = 300; run.timeLeft = 100; run.begin(e.x, e.z);
  check(feed(run, e.x, e.z, 2).every((q) => q.type !== 'offRoad') && !run.off.on, 'on the axis of the street: nothing happens');
  const out = [e.x + nx * (half + 1 + 2.5), e.z + nz * (half + 1 + 2.5)];   // 2.5 m beyond the corridor
  run.stake = 10; const t0 = run.timeLeft, ev1 = feed(run, out[0], out[1], 0.3);
  check(!ev1.some((q) => q.type === 'offRoad') && !run.off.on, 'outside for 0.3 s: still within the grace (0.5 s)');
  const ev2 = feed(run, out[0], out[1], 1.7), st1 = run.stake;
  check(ev2.some((q) => q.type === 'offRoad' && q.on) && run.off.on && run.off.count === 1, 'outside longer: off the road (one event)');
  const spent = t0 - run.timeLeft;   // 2.0 s of the clock + 2 s per second outside after the grace
  check(spent > 2 + 2 * 1.4 && spent < 2 + 2 * 1.6 + 0.1, 'the clock runs 3x faster while outside', spent.toFixed(2) + ' s of the clock in 2.0 s');
  check(st1 < 10 * Math.exp(-0.25 * 1.4) * 1.05 && st1 > 10 * Math.exp(-0.25 * 1.6) * 0.9, 'the stake burns 25 % per second', `10 -> ${st1.toFixed(2)}`);
  check(run.combo === 1, 'the combo is reset');
  const ev3 = feed(run, e.x, e.z, 0.3);
  check(ev3.some((q) => q.type === 'offRoad' && !q.on) && !run.off.on, 'back on the street: the event ends');
  run.finish('finished'); check(run.result.offRoad === 1 && run.result.offRoadSecs > 1.3 && run.result.offRoadBurnt > 0, 'the result counts it', JSON.stringify([run.result.offRoad, run.result.offRoadSecs, run.result.offRoadBurnt]));
  // the same on a standard level: nothing
  const st = mk(stayLv({}, 'standard')); st.par = 300; st.timeLeft = 100; st.begin(e.x, e.z);
  check(feed(st, out[0], out[1], 2).every((q) => q.type !== 'offRoad') && st.off.count === 0, 'a standard level has no such rule');
  // a wide road gives a wider corridor than a narrow one
  check(graph.roadHalf(0) > 0 && [0, 1, 2, 3, 4].every((k) => k < 5), 'road widths by class exist');
  // the editor's check: the corridor is drawn along the way, a gate outside it is reported
  const sd = new LevelDoc(stayLv({ margin: 1 }), ctx), cs = checkLevel(sd, pctx);
  check(cs.corridor.length > 50 && cs.corridor.every((c) => c[4] > 4), 'the corridor follows the way', `${cs.corridor.length} pieces`);
  const gi = sd.items.findIndex((q) => q.k === 'gate'), keep = JSON.stringify(sd.items[gi]);
  sd.items[gi] = { k: 'gate', p: [out[0], out[1]] };
  const cs2 = checkLevel(sd, pctx); check((cs2.items.get(gi) || []).some((t) => /коридором/.test(t)), 'a gate outside the corridor is flagged', (cs2.items.get(gi) || []).join(' | '));
  sd.items[gi] = JSON.parse(keep);
  check(checkLevel(new LevelDoc(stayLv({ margin: 1 }, 'standard'), ctx), pctx).corridor.length === 0, 'a standard level has no corridor');
}
// ---- handing a level over: code and back ----
{
  const castle = JSON.parse(await readFile('data/levels/castle.json', 'utf8'));
  const code = await encodeLevel(castle);
  check(code.startsWith('TTL1.') && code.length < 1400, 'the code is short', `${code.length} characters for 27 items`);
  const back = await decodeLevel(code, { places: city.tour.places });
  check(back.level && JSON.stringify(back.level) === JSON.stringify(castle) && back.problems.length === 0, 'the code decodes to the same level');
  const wrapped = await decodeLevel(code.replace(/(.{60})/g, '$1\n  '), { places: city.tour.places });
  check(wrapped.level && wrapped.level.id === 'castle', 'a code broken into lines still decodes');
  check((await decodeLevel(JSON.stringify(castle))).level.id === 'castle', 'plain JSON is accepted');
  check((await decodeLevel(code.slice(0, 80))).error, 'a cut code gives an error', (await decodeLevel(code.slice(0, 80))).error);
  check((await decodeLevel('hello')).error && (await decodeLevel('')).error, 'garbage and empty give errors');
  check((await decodeLevel(JSON.stringify({ ...castle, schema: 7 }))).error, 'another format version is refused');
  const mine = { ...castle, id: 'my-abc', mine: true }; check(!(await decodeLevel(await encodeLevel(mine))).level.mine, 'the editor flag is not sent');
}
console.log(bad ? `${bad} FAILED` : 'ALL OK'); process.exit(bad ? 1 : 0);
