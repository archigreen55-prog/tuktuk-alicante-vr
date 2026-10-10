// Ride comfort of the tourists (stage 6 plan, section 4): events from the physics each frame, the
// group mood 0..100, and at the end tips and a 1-5 star review. No three.js: runs in Node tools too.
// All thresholds live here, in one place.
import { t } from '../i18n.js';
export const COMFORT = {
  tauBrake: 0.15, tauLat: 0.2,           // s, smoothing of the braking and sideways acceleration
  brakeHard: 3.5, brakeHardFor: 0.3,     // m/s², s
  brakeEmergency: 5.0, brakeEmergencyFor: 0.2,
  turnFast: 3.0, turnFastFor: 0.4,
  turnDanger: 4.5, turnDangerFor: 0.3,
  handbrakeSpeed: 10 / 3.6,              // m/s, handbrake above this = a skid
  touch: 0.5, hit: 2, hitHard: 4,        // m/s into a wall
  scrapeAfter: 1, scrapeSpeed: 5 / 3.6,  // s of wall contact, m/s
  cooldown: 1.5,                         // s between two events of one kind
  softStop: 2.5, softStopWindow: 5,      // m/s², s: gentle braking before a stop earns a bonus
  calmEvery: 30,                         // s without events -> +1 mood
  fastDownGrade: 0.04, fastDownSpeed: 35 / 3.6, // on a descent steeper than this, faster than this (terrain; the
                                                // motor never goes above 30 downhill, so it takes nitro or a crest)
};
export const MOOD_DELTA = {
  brake: -6, emergency: -12, turn: -5, danger: -10,
  touch: -4, hit: -12, hitHard: -25, scrape: -2, fastDown: -5, nitro: -10,
  nearPeople: -5, reset: -10, leftEarly: -5,
  softStop: 3, calm: 1,
};
// the labels of the events: t('ev.l.<kind>') of src/i18n.js; this list only documents the kinds
export const LABEL = {
  brake: 'Різке гальмування', emergency: 'Екстрене гальмування', turn: 'Швидкий поворот', danger: 'Небезпечний поворот',
  touch: 'Дотик до стіни', hit: 'Удар!', hitHard: 'Сильний удар!', scrape: 'Шкрябаємо стіну',
  nearPeople: 'Повільніше біля людей!', fastDown: 'Надто швидко на спуску!', nitro: 'Ой! Нітро!', reset: 'Повернення на дорогу', leftEarly: 'Ще фотографуємо!', softStop: "М'яка зупинка",
};
// which review line a penalty feeds (tour.json "reviews")
const GROUP = { brake: 'brakes', emergency: 'brakes', fastDown: 'brakes', nitro: 'nitro', turn: 'turns', danger: 'turns', touch: 'hits', hit: 'hits', hitHard: 'hits', scrape: 'hits', nearPeople: 'hits', reset: 'hits', leftEarly: 'brakes' };
// the event that a stronger one replaces within one braking / turning episode
const UPGRADE = { emergency: 'brake', danger: 'turn' };

export const TIP_BASE = 10;       // € per tourist at mood 100
export const TIP_ON_TIME = 4;     // € per tourist, finished within the target time
export const TIP_ALMOST = 2;      // € per tourist, up to +25 % over the target
export const LATE_FACTOR = 1.25;

export class ComfortScore {
  constructor() { this.reset(); }

  reset() {
    this.mood = 100;
    this.aBr = 0; this.aLat = 0;
    this.hardT = 0; this.emT = 0; this.fastT = 0; this.dangerT = 0; this.contactT = 0;
    this.brakeEpisode = null; this.turnEpisode = null;
    this.last = {};       // time of the last event per kind
    this.counts = {};     // events per kind
    this.penalty = {};    // mood lost per review group
    this.t = 0; this.calmT = 0;
    this.brakeHist = [];  // [t, aBr] over the last softStopWindow seconds
  }

  // s: { dt, speed (forward, m/s), accel (m/s²), yawRate (rad/s), brake (0..1), reversing,
  //      impact (m/s), contact (touching a wall), handbrake }. Returns this frame's events.
  update(s) {
    const C = COMFORT, dt = s.dt, out = [];
    this.t += dt;
    // braking by the driver only (no soft edge, no reversing)
    const rawBr = s.brake > 0.05 && !s.reversing && s.speed > 0.3 ? Math.max(0, -s.accel) : 0;
    this.aBr += (rawBr - this.aBr) * (1 - Math.exp(-dt / C.tauBrake));
    const rawLat = Math.abs(s.speed * s.yawRate);
    this.aLat += (rawLat - this.aLat) * (1 - Math.exp(-dt / C.tauLat));
    this.brakeHist.push([this.t, this.aBr]);
    while (this.brakeHist.length && this.brakeHist[0][0] < this.t - C.softStopWindow) this.brakeHist.shift();

    // braking episode: "hard" first, upgraded to "emergency" if it gets stronger
    this.hardT = this.aBr >= C.brakeHard ? this.hardT + dt : 0;
    this.emT = this.aBr >= C.brakeEmergency ? this.emT + dt : 0;
    if (this.aBr < 1) this.brakeEpisode = null;
    if (this.emT >= C.brakeEmergencyFor) this.episodeEvent('brakeEpisode', 'emergency', out);
    else if (this.hardT >= C.brakeHardFor) this.episodeEvent('brakeEpisode', 'brake', out);

    // turning episode
    this.fastT = this.aLat >= C.turnFast ? this.fastT + dt : 0;
    this.dangerT = this.aLat >= C.turnDanger ? this.dangerT + dt : 0;
    // downhill too fast (terrain): the descent cap in the physics keeps most drivers under it
    if ((s.grade || 0) < -C.fastDownGrade && s.speed > C.fastDownSpeed && this.ready('fastDown')) { this.last.fastDown = this.t; out.push(this.add('fastDown')); }
    const skid = s.handbrake && Math.abs(s.speed) > C.handbrakeSpeed;
    if (this.aLat < 1.5 && !skid) this.turnEpisode = null;
    if (this.dangerT >= C.turnDangerFor || skid) this.episodeEvent('turnEpisode', 'danger', out);
    else if (this.fastT >= C.turnFastFor) this.episodeEvent('turnEpisode', 'turn', out);

    // walls: one event per crash, the strongest kind
    if (s.impact >= C.touch && this.ready('impact')) {
      const kind = s.impact >= C.hitHard ? 'hitHard' : s.impact >= C.hit ? 'hit' : 'touch';
      this.last.impact = this.t;
      out.push(this.add(kind));
    }
    this.contactT = s.contact && Math.abs(s.speed) > C.scrapeSpeed ? this.contactT + dt : 0;
    if (this.contactT >= C.scrapeAfter && this.t - (this.last.scrape ?? -1e9) >= 1) {
      this.last.scrape = this.t;
      out.push(this.add('scrape'));
    }

    // calm driving slowly restores the mood
    this.calmT = out.length ? 0 : this.calmT + dt;
    if (this.calmT >= C.calmEvery) { this.calmT = 0; if (this.mood < 100) this.add('calm'); }
    return out;
  }

  ready(key) { return this.t - (this.last[key] ?? -1e9) >= COMFORT.cooldown; }

  // one event per episode; a stronger kind in the same episode replaces the weaker one
  episodeEvent(slot, kind, out) {
    const ep = this[slot];
    if (ep === kind || (ep && UPGRADE[ep] === kind)) return;
    if (ep === UPGRADE[kind]) { // upgrade: take only the difference, report the full severity
      const ev = this.add(kind, MOOD_DELTA[kind] - MOOD_DELTA[ep]);
      this.counts[ep]--; ev.delta = MOOD_DELTA[kind];
      this[slot] = kind; out.push(ev);
      return;
    }
    if (!this.ready(slot)) { this[slot] = kind; return; }
    this.last[slot] = this.t;
    this[slot] = kind;
    out.push(this.add(kind));
  }

  // apply an event (also used by the tour: reset, nearPeople, leftEarly, softStop)
  add(kind, delta = MOOD_DELTA[kind]) {
    const before = this.mood;
    this.mood = Math.max(0, Math.min(100, this.mood + delta));
    if (kind !== 'calm' && kind !== 'softStop') {
      this.counts[kind] = (this.counts[kind] || 0) + 1;
      const g = GROUP[kind];
      if (g) this.penalty[g] = (this.penalty[g] || 0) + (before - this.mood);
      this.calmT = 0;
    }
    return { type: kind, delta, label: t('ev.l.' + kind) };
  }

  // gentle stop: +3 if the last seconds of braking stayed soft
  softStop() {
    const peak = this.brakeHist.reduce((m, [, a]) => Math.max(m, a), 0);
    return peak <= COMFORT.softStop ? this.add('softStop') : null;
  }

  tipsEstimate(group) { return tips(this.mood, 'yes', group); }

  // final result: { mood, stars, tips, onTime ('yes'|'almost'|'late'), review (group key), counts }
  result({ time, target, group }) {
    const onTime = time <= target ? 'yes' : time <= target * LATE_FACTOR ? 'almost' : 'late';
    const m = this.mood;
    let stars = m >= 90 ? 5 : m >= 75 ? 4 : m >= 60 ? 3 : m >= 40 ? 2 : 1;
    if (onTime === 'late') stars = Math.max(1, stars - 1);
    const worst = Object.entries(this.penalty).sort((a, b) => b[1] - a[1])[0];
    let review;
    if (m >= 90 && onTime !== 'late') review = 'great';
    else if (onTime === 'late' && (!worst || worst[1] < 15)) review = 'late';
    else review = worst && worst[1] > 0 ? worst[0] : onTime === 'late' ? 'late' : 'great';
    return { mood: Math.round(m), stars, tips: tips(m, onTime, group), onTime, review, counts: { ...this.counts } };
  }
}

// € for the whole group, rounded to 0.50
export function tips(mood, onTime, group) {
  const bonus = onTime === 'yes' ? TIP_ON_TIME : onTime === 'almost' ? TIP_ALMOST : 0;
  const each = TIP_BASE * Math.pow(Math.max(0, mood) / 100, 1.5) + bonus;
  return Math.round(each * group * 2) / 2;
}
