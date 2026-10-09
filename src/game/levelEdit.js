// The model of the level editor (0.16.0): a level being edited with undo / redo, snapping of points to the road and the rules of
// docs/plan-level-editor.md. No DOM and no three.js: the editor's interface (src/ui/levelEditor.js) and the tests (tools/test-level-edit.mjs) use it.
// Items are indexed as in level.items (gates and via points together); the LAST gate is the finish and stays last.
import { LEVEL, validateLevel, gatesOf } from './levels.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const r1 = (v) => Math.round(v * 10) / 10;
export const SNAP = 20;          // m: a point snaps to the nearest road this close
export const UNDO_MAX = 30;

// a new level: the finish at the start place (the tourists are taken back), the name as given
export function newLevel({ id, title = 'Мій рівень', startPlace = 'melia' } = {}) {
  return {
    schema: LEVEL.schema, id: id || newId(), title: { uk: title, en: '', es: '' }, type: 'standard', start: { place: startPlace },
    time: { mode: 'auto', par: null }, items: [{ k: 'gate', place: startPlace, finish: true }], rules: {}, extras: {},
  };
}
export const newId = () => 'my-' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);

export class LevelDoc {
  // ctx: { graph: RoadGraph, places: city.tour.places, spec: data/tour.json, facts: { placeId: line } }
  constructor(level, ctx = {}) {
    this.level = clone(level); this.ctx = ctx;
    this.undoStack = []; this.redoStack = []; this.listeners = []; this.dragBefore = null;
  }
  on(fn) { this.listeners.push(fn); }
  changed() { for (const f of this.listeners) f(this.level); }

  // ---- history ----
  // edit: one undoable step (nothing recorded when the level did not change)
  edit(fn) {
    const before = JSON.stringify(this.level);
    const out = fn(this.level);
    if (out && out.error) { this.level = JSON.parse(before); return out; }
    if (JSON.stringify(this.level) !== before) { this.push(before); this.changed(); }
    return out || {};
  }
  push(before) { this.undoStack.push(before); if (this.undoStack.length > UNDO_MAX) this.undoStack.shift(); this.redoStack.length = 0; }
  undo() { if (!this.undoStack.length) return false; this.redoStack.push(JSON.stringify(this.level)); this.level = JSON.parse(this.undoStack.pop()); this.changed(); return true; }
  redo() { if (!this.redoStack.length) return false; this.undoStack.push(JSON.stringify(this.level)); this.level = JSON.parse(this.redoStack.pop()); this.changed(); return true; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  // ---- geometry ----
  get items() { return this.level.items; }
  get gates() { return gatesOf(this.level); }
  get finishIndex() { let f = -1; this.level.items.forEach((it, i) => { if (it.k === 'gate') f = i; }); return f; }
  startPoint() {
    const s = this.level.start || {};
    if (s.place) { const p = this.ctx.places && this.ctx.places[s.place]; return p ? [p.p[0], p.p[1]] : null; }
    return Number.isFinite(s.x) ? [s.x, s.z] : null;
  }
  // [x, z] of an item (a place gate: the place's point)
  pointOf(it) {
    if (it.p) return it.p;
    const pl = it.place && this.ctx.places && this.ctx.places[it.place];
    return pl ? pl.p : null;
  }
  // the road under a point: { p, d, onRoad }; the direction of the road is the gate's direction
  snap(x, z, max = SNAP) {
    const g = this.ctx.graph, e = g && g.nearestEdge(x, z, max);
    if (!e) return { p: [r1(x), r1(z)], d: null, onRoad: false };
    const a = g.ea[e.e], b = g.eb[e.e], dx = g.x[b] - g.x[a], dz = g.z[b] - g.z[a], l = Math.hypot(dx, dz) || 1;
    return { p: [r1(e.x), r1(e.z)], d: [Math.round(dx / l * 1000) / 1000, Math.round(dz / l * 1000) / 1000], onRoad: true };
  }
  titleOfItem(i) {
    const it = this.level.items[i]; if (!it) return '';
    if (it.title) return it.title;
    if (it.place) { const s = this.ctx.spec && this.ctx.spec.places[it.place]; return s && s.title || it.place; }
    return `Ворота ${this.gates.indexOf(it) + 1}`;
  }
  gateNumber(i) { const it = this.level.items[i]; return it && it.k === 'gate' ? this.gates.indexOf(it) + 1 : 0; }

  // ---- editing (every one an undoable step; { error } leaves the level as it was) ----
  addGate(x, z) {
    return this.edit((lv) => {
      if (gatesOf(lv).length >= LEVEL.maxGates) return { error: `Максимум ${LEVEL.maxGates} воріт` };
      const s = this.snap(x, z), it = { k: 'gate', p: s.p, ...(s.d ? { d: s.d } : {}) };
      // before the finish and its via points: after the last ordinary gate
      let at = 0; lv.items.forEach((q, i) => { if (q.k === 'gate' && !q.finish) at = i + 1; });
      lv.items.splice(at, 0, it);
      return { index: at, onRoad: s.onRoad };
    });
  }
  addVia(x, z) {
    return this.edit((lv) => {
      const s = this.snap(x, z), it = { k: 'via', p: s.p };
      const wp = [this.startPoint(), ...lv.items.map((q) => this.pointOf(q))];   // waypoint j+1 is item j
      let best = Infinity, at = lv.items.length - 1;
      for (let j = 0; j < wp.length - 1; j++) {
        const a = wp[j], b = wp[j + 1]; if (!a || !b) continue;
        const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1;
        let t = ((s.p[0] - a[0]) * ex + (s.p[1] - a[1]) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(s.p[0] - a[0] - ex * t, s.p[1] - a[1] - ez * t);
        if (d < best) { best = d; at = j; }
      }
      lv.items.splice(at, 0, it);
      return { index: at, onRoad: s.onRoad };
    });
  }
  // dragging: beginDrag / dragTo (not recorded) / endDrag (one step)
  beginDrag() { this.dragBefore = JSON.stringify(this.level); }
  dragTo(i, x, z) {
    const lv = this.level, it = lv.items[i]; if (!it) return null;
    const s = this.snap(x, z);
    if (it.k === 'gate') {
      if (it.place) {   // moved away from its place: a free gate that keeps the name and the fact
        const pid = it.place, sp = this.ctx.spec && this.ctx.spec.places[pid];
        if (sp && !it.title) it.title = sp.title;
        if (this.ctx.facts && this.ctx.facts[pid] && !it.fact) it.fact = this.ctx.facts[pid];
        delete it.place;
      }
      it.p = s.p; if (s.d) it.d = s.d; else delete it.d;
    } else it.p = s.p;
    return s;
  }
  endDrag() {
    const b = this.dragBefore; this.dragBefore = null;
    if (b && JSON.stringify(this.level) !== b) { this.push(b); this.changed(); }
  }
  cancelDrag() { if (this.dragBefore) { this.level = JSON.parse(this.dragBefore); this.dragBefore = null; } }
  remove(i) {
    return this.edit((lv) => {
      const it = lv.items[i]; if (!it) return { error: 'Немає такої точки' };
      if (it.k === 'gate' && it.finish) return { error: 'Фініш не видаляється: його можна перетягнути' };
      lv.items.splice(i, 1);
      return {};
    });
  }
  // moves item i one place up (dir -1) or down (+1); the finish stays the last gate
  reorder(i, dir) {
    return this.edit((lv) => {
      const j = i + dir, fin = this.finishIndex;
      if (i === fin || j < 0 || j >= fin) return { error: 'Тут не можна' };
      [lv.items[i], lv.items[j]] = [lv.items[j], lv.items[i]];
      return { index: j };
    });
  }
  // via points (the points [x, z]) put in front of item `at`: they belong to the gate that follows
  insertVias(at, pts) { return this.edit((lv) => { lv.items.splice(at, 0, ...pts.map((p) => ({ k: 'via', p: [p[0], p[1]] }))); }); }
  setTitle(lang, text) { return this.edit((lv) => { lv.title = { ...lv.title, [lang]: String(text).slice(0, LEVEL.titleMax) }; }); }
  setGateText(i, { title, fact }) {
    return this.edit((lv) => {
      const it = lv.items[i]; if (!it || it.k !== 'gate') return { error: 'Це не ворота' };
      if (title != null) { if (title.trim()) it.title = title.trim().slice(0, LEVEL.titleMax); else delete it.title; }
      if (fact != null) { if (fact.trim()) it.fact = fact.trim().slice(0, LEVEL.factMax); else delete it.fact; }
    });
  }
  setTime(mode, par) {
    return this.edit((lv) => {
      lv.time = mode === 'manual' ? { mode: 'manual', par: Math.max(20, Math.min(3600, Math.round(par) || 300)) } : { mode: 'auto', par: null };
    });
  }
  setType(type) { return this.edit((lv) => { if (LEVEL.types.includes(type)) lv.type = type; }); }
  // the start: a place or a point with the heading; the finish at the same place if it was at the old start
  setStart(start) { return this.edit((lv) => { lv.start = clone(start); }); }
  // the finish where the start is (a place gate when the start is a place)
  finishAtStart() {
    return this.edit((lv) => {
      const f = lv.items[this.finishIndex]; if (!f) return;
      const s = lv.start, keep = f.title;
      for (const k of Object.keys(f)) if (k !== 'k') delete f[k];
      if (s.place) Object.assign(f, { place: s.place, finish: true });
      else { const sn = this.snap(s.x, s.z); Object.assign(f, { p: sn.p, ...(sn.d ? { d: sn.d } : {}), finish: true }); if (keep) f.title = keep; }
    });
  }

  // ---- checks (the rules that need no pathfinding; the pathfinding ones are in the editor's checks, src/game/pathfind.js) ----
  problems() {
    const lv = this.level, out = { level: [], items: new Map() };
    const add = (i, text) => { const a = out.items.get(i) || []; a.push(text); out.items.set(i, a); };
    for (const t of validateLevel(lv, { places: this.ctx.places })) {
      if (/^ворота \d+: |^«через» \d+: |^елемент \d+: /.test(t)) { const i = +/\d+/.exec(t)[0]; add(i, t.replace(/^[^:]+: /, '')); } else out.level.push(t);
    }
    return out;
  }
  get valid() { const p = this.problems(); return !p.level.length && !p.items.size; }

  // the way through the gates, in metres and the clock "auto" would give (RUSH.parPerMetre of arcade.js, applied by the Arcade itself)
  routeLength() {
    const g = this.ctx.graph, s = this.startPoint(); if (!g || !s) return null;
    const pts = [s, ...this.gates.map((q) => this.pointOf(q)).filter(Boolean)];
    const r = pts.length > 1 ? g.routeVia(pts) : null;
    return r ? r.len : null;
  }
}
