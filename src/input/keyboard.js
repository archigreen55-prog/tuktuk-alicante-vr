// Keyboard input -> the common input state { throttle, brake, steer, handbrake, horn } + one-shot actions.
export class KeyboardInput {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();
    this.steer = 0;
    target.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }
  any(...codes) { return codes.some((c) => this.down.has(c)); }
  // one-shot: true once per key press
  take(code) { const had = this.pressed.has(code); this.pressed.delete(code); return had; }

  read(dt, out) {
    out.throttle = this.any('KeyW', 'ArrowUp') ? 1 : 0;
    out.brake = this.any('KeyS', 'ArrowDown') ? 1 : 0;
    out.handbrake = this.any('Space');
    out.horn = this.any('KeyH');
    // keys are digital: ramp the steering so the wheel does not snap
    const target = (this.any('KeyD', 'ArrowRight') ? 1 : 0) - (this.any('KeyA', 'ArrowLeft') ? 1 : 0);
    const rate = target === 0 ? 5 : 3.2;
    const d = target - this.steer;
    this.steer += Math.abs(d) < rate * dt ? d : Math.sign(d) * rate * dt;
    out.steer = this.steer;
    return out;
  }
  endFrame() { this.pressed.clear(); }
}
