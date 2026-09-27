// Quest 3 controllers -> the common input state (plan 6.1) + one-shot actions.
// WebXR 'xr-standard' gamepad: buttons[0] trigger, [1] grip, [3] stick press, [4] A/X, [5] B/Y;
// axes[2], [3] thumbstick.
const STICK_DEAD = 0.12;
const TRIGGER_DEAD = 0.05;
const HOLD = 1.0;          // s, for Y (recentre) and both grips (reset)
const REVERSE_DELAY = 0.4; // s of left trigger at standstill before reversing

const pressed = (gp, i) => !!(gp && gp.buttons[i] && gp.buttons[i].pressed);
const value = (gp, i) => (gp && gp.buttons[i] ? gp.buttons[i].value : 0);
const trigger = (v) => (v < TRIGGER_DEAD ? 0 : (v - TRIGGER_DEAD) / (1 - TRIGGER_DEAD));

export class XRInput {
  constructor() {
    this.left = null;
    this.right = null;
    this.prev = {};
    this.holdY = 0;
    this.holdGrips = 0;
    this.actions = { fps: false, vignette: false, recenter: false, reset: false };
  }

  // true once per press
  edge(key, down) {
    const e = down && !this.prev[key];
    this.prev[key] = down;
    return e;
  }

  // Merges the controllers into `out` (on top of the keyboard state); returns this frame's actions.
  read(session, dt, out) {
    this.left = this.right = null;
    if (session) {
      for (const src of session.inputSources) {
        if (src.gamepad && src.handedness === 'left') this.left = src.gamepad;
        else if (src.gamepad && src.handedness === 'right') this.right = src.gamepad;
      }
    }
    const L = this.left, R = this.right, act = this.actions;

    out.throttle = Math.max(out.throttle, trigger(value(R, 0)));   // right trigger: gas
    out.brake = Math.max(out.brake, trigger(value(L, 0)));         // left trigger: brake / reverse
    out.reverseDelay = REVERSE_DELAY;
    // left stick X: steering, dead zone + quadratic curve for precision near the centre
    const sx = L ? (L.axes.length >= 4 ? L.axes[2] : L.axes[0] || 0) : 0;
    const a = Math.abs(sx);
    if (a > STICK_DEAD) {
      const k = (a - STICK_DEAD) / (1 - STICK_DEAD);
      out.steer = Math.sign(sx) * k * k;
    }
    out.handbrake = out.handbrake || pressed(R, 3) || pressed(R, 4); // right stick press or A
    out.horn = out.horn || pressed(R, 5);                              // B

    act.fps = this.edge('x', pressed(L, 4));        // X: FPS counter
    act.vignette = this.edge('ls', pressed(L, 3));  // left stick press: vignette strength
    this.holdY = pressed(L, 5) ? this.holdY + dt : 0;
    act.recenter = this.holdY >= HOLD && this.holdY - dt < HOLD;
    this.holdGrips = pressed(L, 1) && pressed(R, 1) ? this.holdGrips + dt : 0;
    act.reset = this.holdGrips >= HOLD && this.holdGrips - dt < HOLD;
    return act;
  }

  pulse(strength, ms) {
    for (const gp of [this.left, this.right]) {
      const h = gp && gp.hapticActuators && gp.hapticActuators[0];
      if (h && h.pulse) h.pulse(strength, ms).catch(() => {});
    }
  }
}
