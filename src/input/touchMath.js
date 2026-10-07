// The numbers behind the phone controls ("За столом" mode), as pure functions: no DOM, no three.js, so
// tools/test-touch.mjs checks them in Node and the autopilot can use the same curves. They follow the
// keyboard on purpose (src/input/keyboard.js): the scoring thresholds of the tour were calibrated on it.
export const STEER_RATE = 3.2;      // 1/s: the wheel goes 0 -> 1 in ~0.3 s (as with the A / D keys)
export const STEER_RELEASE = 5;     // 1/s: and comes back faster when the finger is lifted
export const BRAKE_START = 0.35;    // the brake at the first touch ...
export const BRAKE_RAMP = 0.6;      // ... and the time (s) to the full brake: a tap brakes gently, holding brakes hard
export const GAS_MIN = 0.35;        // analog gas: the bottom of the pedal ...
export const LOOK_YAW = 2.9;        // rad, how far the head turns (enough to see the passengers, as the mouse look)
export const LOOK_PITCH = [-1.0, 0.9];
export const BACK_YAW = -2.705;     // 155 deg through the right shoulder: both rows of tourists are in view
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// buttons ◄ ►: dir = -1 | 0 | 1 -> the wheel moves towards it at a limited rate
export function steerRamp(steer, dir, dt) {
  const rate = dir === 0 ? STEER_RELEASE : STEER_RATE;
  const d = dir - steer;
  return Math.abs(d) < rate * dt ? dir : steer + Math.sign(d) * rate * dt;
}

// slider: x = finger position, [left, right] = the track, knob travels the middle (track minus the knob radius on both sides)
export function sliderSteer(x, left, right, knob = 22, dead = 0.05) {
  const half = (right - left) / 2 - knob;
  const v = clamp((x - (left + right) / 2) / Math.max(1, half), -1, 1);
  const a = Math.abs(v);
  if (a < dead) return 0;
  return Math.sign(v) * (a - dead) / (1 - dead);
}

// gas pedal: the higher the finger on the pedal the more gas (the bottom edge = GAS_MIN, the top = 1)
export function gasFromY(y, top, bottom, mode = 'analog') {
  if (mode === 'full') return 1;
  return GAS_MIN + (1 - GAS_MIN) * clamp((bottom - y) / Math.max(1, bottom - top), 0, 1);
}

// brake: t = how long it has been held (s)
export function brakeRamp(t) {
  return t > 0 ? Math.min(1, BRAKE_START + (1 - BRAKE_START) * t / BRAKE_RAMP) : 0;
}

// finger drag -> head turn (rad per px as the mouse look, a little faster for a thumb)
export function lookDrag(yaw, pitch, dx, dy, k = 0.0055) {
  return [clamp(yaw - dx * k, -LOOK_YAW, LOOK_YAW), clamp(pitch - dy * k, LOOK_PITCH[0], LOOK_PITCH[1])];
}

// the head returns to the front after `delay` s without a touch (tau = 0.3 s); looking back moves in 0.3 s
export function lookReturn(v, idle, dt, { delay = 1.5, tau = 0.3 } = {}) {
  if (idle < delay) return v;
  return Math.abs(v) < 1e-3 ? 0 : v * Math.exp(-dt / tau);
}
export function approach(v, target, dt, tau = 0.12) {
  return Math.abs(target - v) < 1e-3 ? target : v + (target - v) * (1 - Math.exp(-dt / tau));
}

// the horizontal field of view in degrees -> the vertical one for three.js (PerspectiveCamera.fov)
export function verticalFov(horizontalDeg, aspect, max = 85) {
  const v = 2 * Math.atan(Math.tan((horizontalDeg * Math.PI / 180) / 2) / aspect) * 180 / Math.PI;
  return Math.min(max, v);
}
