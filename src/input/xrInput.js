// Quest 3 controllers -> the common input state (plan 6.1, stage 5 plan 1.4) + one-shot actions.
// WebXR 'xr-standard' gamepad: buttons[0] trigger, [1] grip, [3] stick press, [4] A/X, [5] B/Y;
// axes[2], [3] thumbstick.
const STICK_DEAD = 0.12;
const TRIGGER_DEAD = 0.05;
const HOLD = 1.0;          // s, for Y (recentre), X (stress level), A+B / both grips (reset)
const TAP = 0.5;           // s, X released before this = FPS counter toggle
const REVERSE_DELAY = 0.4; // s of left trigger at standstill before reversing

const pressed = (gp, i) => !!(gp && gp.buttons[i] && gp.buttons[i].pressed);
const value = (gp, i) => (gp && gp.buttons[i] ? gp.buttons[i].value : 0);
const trigger = (v) => (v < TRIGGER_DEAD ? 0 : (v - TRIGGER_DEAD) / (1 - TRIGGER_DEAD));

export class XRInput {
  constructor() {
    this.left = null;        // gamepads
    this.right = null;
    this.leftSource = null;  // XRInputSources (for grip poses)
    this.rightSource = null;
    this.stickActive = false;
    this.gripLeft = false;
    this.gripRight = false;
    this.prev = {};
    this.holds = { y: 0, x: 0, grips: 0, ab: 0 };
    this.actions = { fps: false, stress: false, vignette: false, recenter: false, reset: false, mode: false };
  }

  // true once per press
  edge(key, down) {
    const e = down && !this.prev[key];
    this.prev[key] = down;
    return e;
  }
  // hold timer; true once when it reaches HOLD
  hold(key, down, dt) {
    const h = this.holds;
    h[key] = down ? h[key] + dt : 0;
    return h[key] >= HOLD && h[key] - dt < HOLD;
  }

  // Merges the controllers into `out` (on top of the keyboard state); returns this frame's actions.
  // mode: 'stick' | 'hands' (in hands mode both grips hold the handlebar, so they do not reset).
  read(session, dt, out, mode) {
    this.left = this.right = this.leftSource = this.rightSource = null;
    if (session) {
      for (const src of session.inputSources) {
        if (!src.gamepad) continue;
        if (src.handedness === 'left') { this.left = src.gamepad; this.leftSource = src; }
        else if (src.handedness === 'right') { this.right = src.gamepad; this.rightSource = src; }
      }
    }
    const L = this.left, R = this.right, act = this.actions;

    out.throttle = Math.max(out.throttle, trigger(value(R, 0)));   // right trigger: gas
    out.brake = Math.max(out.brake, trigger(value(L, 0)));         // left trigger: brake / reverse
    out.reverseDelay = REVERSE_DELAY;
    // left stick X: steering, dead zone + quadratic curve for precision near the centre
    const sx = L ? (L.axes.length >= 4 ? L.axes[2] : L.axes[0] || 0) : 0;
    const a = Math.abs(sx);
    this.stickActive = a > STICK_DEAD;
    if (this.stickActive) {
      const k = (a - STICK_DEAD) / (1 - STICK_DEAD);
      out.steer = Math.sign(sx) * k * k;
    }
    const btnA = pressed(R, 4), btnB = pressed(R, 5);
    out.handbrake = out.handbrake || btnA;          // A
    out.horn = out.horn || (btnB && !btnA);         // B (silent while A+B resets)
    this.gripLeft = pressed(L, 1);
    this.gripRight = pressed(R, 1);

    // X: tap = FPS counter, hold 1 s = next stress level
    const x = pressed(L, 4);
    act.fps = !x && this.prev.x && this.holds.x < TAP;
    this.prev.x = x;
    act.stress = this.hold('x', x, dt);
    act.vignette = this.edge('ls', pressed(L, 3));  // left stick press: vignette strength
    act.mode = this.edge('rs', pressed(R, 3));      // right stick press: steering mode
    act.recenter = this.hold('y', pressed(L, 5), dt);
    const gripsReset = this.hold('grips', mode === 'stick' && this.gripLeft && this.gripRight, dt);
    act.reset = this.hold('ab', btnA && btnB, dt) || gripsReset;
    return act;
  }

  pulse(hand, strength, ms) {
    for (const gp of hand === 'left' ? [this.left] : hand === 'right' ? [this.right] : [this.left, this.right]) {
      const h = gp && gp.hapticActuators && gp.hapticActuators[0];
      if (h && h.pulse) h.pulse(strength, ms).catch(() => {});
    }
  }
}
