// Checks the phone input curves (src/input/touchMath.js) against the keyboard they must feel like.
// node tools/test-touch.mjs
import { steerRamp, sliderSteer, gasFromY, brakeRamp, lookDrag, lookReturn, approach, verticalFov, BACK_YAW, LOOK_YAW } from '../src/input/touchMath.js';
let bad = 0;
const ok = (c, msg) => { if (!c) { bad++; console.log('FAIL', msg); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// steering buttons: 0 -> 1 in about 0.31 s at 72 Hz steps, back to 0 faster than it went
let s = 0, t = 0; while (s < 1 && t < 2) { s = steerRamp(s, 1, 1 / 72); t += 1 / 72; }
ok(t > 0.28 && t < 0.34, `wheel to full in ${t.toFixed(3)} s`);
let r = 1, tr = 0; while (r > 0 && tr < 2) { r = steerRamp(r, 0, 1 / 72); tr += 1 / 72; }
ok(tr < t, `release (${tr.toFixed(3)} s) faster than press (${t.toFixed(3)} s)`);
ok(near(steerRamp(0.99, 1, 1), 1) && near(steerRamp(-0.5, -1, 1), -1), 'the ramp never overshoots');
// the ramp does not depend on the frame rate (60 / 120 / 30 Hz reach full wheel in the same time)
for (const hz of [30, 60, 120]) { let q = 0, tt = 0; while (q < 1) { q = steerRamp(q, 1, 1 / hz); tt += 1 / hz; } ok(Math.abs(tt - 1 / 3.2) < 1.2 / hz + 1e-6, `${hz} Hz: ${tt.toFixed(3)} s`); }

// slider: dead zone, symmetric, full at the ends of the knob travel
ok(sliderSteer(300, 200, 400) === 0, 'slider centre = 0');
ok(sliderSteer(200 + 22, 200, 400) === -1 && sliderSteer(400 - 22, 200, 400) === 1, 'slider ends = ±1');
ok(sliderSteer(0, 200, 400) === -1 && sliderSteer(999, 200, 400) === 1, 'slider beyond the track is clamped');
ok(near(sliderSteer(330, 200, 400), -sliderSteer(270, 200, 400)), 'slider symmetric');
ok(sliderSteer(303, 200, 400) === 0 && sliderSteer(320, 200, 400) > 0, 'slider dead zone');
let prev = -2; for (let x = 222; x <= 378; x += 4) { const v = sliderSteer(x, 200, 400); ok(v >= prev - 1e-9, 'slider monotonic'); prev = v; }

// gas: bottom 0.35, top 1, linear, clamped; "full" mode always 1
ok(near(gasFromY(500, 300, 500), 0.35) && near(gasFromY(300, 300, 500), 1) && near(gasFromY(400, 300, 500), 0.675), 'gas curve');
ok(gasFromY(900, 300, 500) === 0.35 && gasFromY(0, 300, 500) === 1, 'gas clamped outside the pedal');
ok(gasFromY(500, 300, 500, 'full') === 1, 'full gas mode');

// brake: 0.35 at the touch, full after 0.6 s, 0 when released
ok(brakeRamp(0) === 0 && near(brakeRamp(1e-6), 0.35, 1e-3) && brakeRamp(0.6) === 1 && brakeRamp(5) === 1 && near(brakeRamp(0.3), 0.675), 'brake ramp');

// look: drag turns the head against the finger movement and is limited; it returns after 1.5 s
let [y, p] = lookDrag(0, 0, -100, 0); ok(y > 0.5 && y < 0.6, `drag left turns the head left (${y.toFixed(2)})`);
[y, p] = lookDrag(0, 0, 9999, 9999); ok(y === -LOOK_YAW && p === -1, 'look limits');
ok(lookReturn(1, 1.0, 0.1) === 1, 'no return before the delay');
let v = 1, idle = 1.6; for (let i = 0; i < 60; i++) v = lookReturn(v, idle, 1 / 60); ok(Math.abs(v) < 0.05, `returns to the front within a second (${v.toFixed(3)})`);
ok(BACK_YAW < -2.6 && BACK_YAW > -2.8, 'look back = 155° to the right');
let b = 0; for (let i = 0; i < 60; i++) b = approach(b, BACK_YAW, 1 / 60); ok(Math.abs(b - BACK_YAW) < 0.02, 'look back reached within a second');

// field of view: 100° horizontal on the phone screens
ok(Math.abs(verticalFov(100, 915 / 412) - 56.4) < 0.3, `S20 Ultra full screen: ${verticalFov(100, 915 / 412).toFixed(1)}°`);
ok(Math.abs(verticalFov(100, 886 / 316) - 46.2) < 0.4, `with the address bar: ${verticalFov(100, 886 / 316).toFixed(1)}°`);
ok(verticalFov(100, 1) === 85, 'the vertical angle is capped');
console.log(bad ? `${bad} checks FAILED` : 'OK: the phone input curves match the keyboard ones');
process.exit(bad ? 1 : 0);
