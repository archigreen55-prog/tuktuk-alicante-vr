// "Hands on the handlebar" steering (stage 5 plan, section 1) and the handlebar visuals.
// Both grips pressed = hands hold the bar. The bar angle is the angle of the left->right hand line
// about the steering axis, so hands can rest anywhere (no reaching for the real grips). Throttle =
// twisting the right hand about the grip axis, relative to its pose when it grabbed. Released bar:
// throttle springs to 0 and the bar self-centres with speed (caster), no automatic braking.
import * as THREE from 'three';
import { BAR_LOCK } from '../vehicle/tuktuk.js';

const DEG = Math.PI / 180;
const DEAD = 2 * DEG;             // steering dead zone
const FILTER = 0.05;              // s, low-pass on the hand angle (tracking jitter)
const REGRAB_BLEND = 0.2;         // s, bar eases to the hands after a grab (no jump)
const CENTRE_RATE = 40 * DEG;     // rad/s max self-centring, reached at top speed
const CENTRE_PER_MS = CENTRE_RATE / 11; // rad/s per m/s of speed
const TWIST_DEAD = 3 * DEG;
const TWIST_FULL = 25 * DEG;
const TWIST_SIGN = 1;             // +1: rolling the top of the grip towards you = gas
const MIN_HANDS = 0.15;           // m, hands closer than this (or crossed) do not count as a grab
const ENGINE_PERIOD = 0.09;       // s between engine-vibration pulses

export class HandlebarControl {
  constructor(handlebar) {
    this.bar = handlebar;
    this.angle = 0;          // bar rotation about the steering axis, > 0 = left turn
    this.twist = 0;          // right-grip twist (rad), > 0 = gas
    this.held = false;       // both hands on the bar, steering by hands
    this.rightHeld = false;
    this.leftHeld = false;
    this.invalid = false;    // both grips pressed but hands crossed / too close
    this.releasedFor = 0;    // s since the bar was let go (hands mode)
    this.engineVibration = true;
    this.filt = 0;
    this.blend = 0;
    this.engineT = 0;
    this.quietUntil = 0;     // no engine pulses until then (impact pulse is playing)
    this.q0 = new THREE.Quaternion(); // right grip neutral, in the grip frame
    this.seenReal = { left: false, right: false };
    // The swept-back grip is not perpendicular to the steering axis, so turning the bar with still
    // wrists would read as a twist. The steering axis in the grip frame, to take that part out:
    this.axisInGrip = new THREE.Vector3(0, 1, 0).applyQuaternion(handlebar.rightGripBase.quaternion.clone().invert());
    this.tq = new THREE.Quaternion(); this.sw = new THREE.Quaternion();
    // ... which also takes a little of a real twist: scale back so 20° of wrist reads as 20°
    this.twistScale = 1;
    this.twistScale = (20 * DEG) / this.gripTwist(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 20 * DEG));
    // scratch
    this.pl = new THREE.Vector3(); this.pr = new THREE.Vector3(); this.d = new THREE.Vector3();
    this.q = new THREE.Quaternion(); this.qg = new THREE.Quaternion(); this.qi = new THREE.Quaternion();
  }

  // ctx: { vr, mode, xrFrame, refSpace, rig (xr rig group), xrIn, speed, now }; out: input state.
  update(dt, ctx, out) {
    const { vr, mode, xrIn } = ctx;
    const hands = vr && mode === 'hands';
    let leftPose = null, rightPose = null;
    if (hands && ctx.xrFrame && ctx.refSpace) {
      if (xrIn.gripLeft && xrIn.leftSource && xrIn.leftSource.gripSpace) leftPose = ctx.xrFrame.getPose(xrIn.leftSource.gripSpace, ctx.refSpace);
      if (xrIn.gripRight && xrIn.rightSource && xrIn.rightSource.gripSpace) rightPose = ctx.xrFrame.getPose(xrIn.rightSource.gripSpace, ctx.refSpace);
    }
    const leftHeld = hands && xrIn.gripLeft && this.tracked('left', leftPose);
    const rightHeld = hands && xrIn.gripRight && this.tracked('right', rightPose);
    if (leftHeld && !this.leftHeld) xrIn.pulse('left', 0.3, 25);
    if (rightHeld && !this.rightHeld) xrIn.pulse('right', 0.3, 25);

    // --- steering ---
    let held = false;
    this.invalid = false;
    if (leftHeld && rightHeld) {
      this.toBar(leftPose.transform.position, ctx.rig, this.pl);
      this.toBar(rightPose.transform.position, ctx.rig, this.pr);
      const d = this.d.subVectors(this.pr, this.pl);
      // into the steering-axis frame (pivot): the angle about its Y is the bar angle
      d.applyQuaternion(this.qi.copy(this.bar.pivot.quaternion).invert());
      const len = Math.hypot(d.x, d.z);
      const raw = Math.atan2(-d.z, d.x);
      if (len >= MIN_HANDS && Math.abs(raw) < 80 * DEG) {
        held = true;
        if (!this.held) { this.filt = raw; this.blend = REGRAB_BLEND; }
        this.filt += (raw - this.filt) * (1 - Math.exp(-dt / FILTER));
        const target = THREE.MathUtils.clamp(this.filt, -BAR_LOCK, BAR_LOCK);
        if (this.blend > 0) {
          this.angle += (target - this.angle) * Math.min(1, dt / this.blend);
          this.blend -= dt;
        } else this.angle = target;
        const a = Math.abs(this.angle);
        out.steer = a < DEAD ? 0 : -Math.sign(this.angle) * (a - DEAD) / (BAR_LOCK - DEAD);
      } else this.invalid = true;
    }
    if (!held) {
      if (!hands || xrIn.stickActive) {
        // bar follows the stick / keyboard
        this.angle += (-out.steer * BAR_LOCK - this.angle) * (1 - Math.exp(-dt / 0.05));
      } else {
        // let go: caster self-centring, faster with speed, none at standstill
        const step = Math.min(CENTRE_RATE, CENTRE_PER_MS * Math.abs(ctx.speed)) * dt;
        this.angle = Math.abs(this.angle) <= step ? 0 : this.angle - Math.sign(this.angle) * step;
        out.steer = -this.angle / BAR_LOCK;
      }
    }
    this.held = held;
    this.releasedFor = hands && !held ? this.releasedFor + dt : 0;

    // --- throttle: right-hand twist about the grip axis ---
    this.bar.steer.rotation.y = this.angle;
    if (rightHeld) {
      // grip frame orientation in the tuk-tuk frame (with the current bar angle)
      this.qg.copy(this.bar.pivot.quaternion).multiply(this.bar.steer.quaternion).multiply(this.bar.rightGripBase.quaternion);
      const o = rightPose.transform.orientation;
      this.q.set(o.x, o.y, o.z, o.w).premultiply(ctx.rig.quaternion);   // controller in the tuk-tuk frame
      this.q.premultiply(this.qi.copy(this.qg).invert());               // ... in the grip frame
      if (!this.rightHeld) { this.q0.copy(this.q); this.twist = 0; }
      const delta = this.qi.copy(this.q0).invert().premultiply(this.q); // q * q0^-1, grip-frame axes
      this.twist = TWIST_SIGN * this.gripTwist(delta);
      const gas = THREE.MathUtils.clamp((this.twist - TWIST_DEAD) / (TWIST_FULL - TWIST_DEAD), 0, 1);
      out.throttle = Math.max(out.throttle, gas);
      this.bar.rightGrip.rotation.x = THREE.MathUtils.clamp(this.twist, -10 * DEG, 30 * DEG);
    } else {
      this.twist = 0;
      // the grip shows the trigger / keyboard throttle
      this.bar.rightGrip.rotation.x += (out.throttle * TWIST_FULL - this.bar.rightGrip.rotation.x) * (1 - Math.exp(-dt / 0.05));
    }
    this.leftHeld = leftHeld;
    this.rightHeld = rightHeld;
    this.bar.leftGlove.visible = leftHeld;
    this.bar.rightGlove.visible = rightHeld;

    // --- engine vibration in the right grip (weak) ---
    this.engineT -= dt;
    if (rightHeld && this.engineVibration && this.engineT <= 0 && ctx.now >= this.quietUntil) {
      this.engineT = ENGINE_PERIOD;
      xrIn.pulse('right', 0.04 + 0.08 * out.throttle, ENGINE_PERIOD * 1000 + 15);
    }
  }

  // Twist about the grip axis (X) of a grip-frame rotation, after removing its part about the steering axis.
  gripTwist(delta) {
    const a = this.axisInGrip, d = delta.x * a.x + delta.y * a.y + delta.z * a.z;
    const ta = this.tq.set(a.x * d, a.y * d, a.z * d, delta.w);
    if (ta.lengthSq() < 1e-12) ta.identity(); else ta.normalize();
    const sw = this.sw.copy(delta).multiply(ta.invert());                // delta = swing * ta
    if (sw.w < 0) { sw.x = -sw.x; sw.w = -sw.w; }
    return 2 * Math.atan2(sw.x, sw.w) * this.twistScale;
  }

  // Pose usable for holding the bar? An emulated (IMU-only) position counts as lost tracking only once
  // the hand has had real tracking, so devices that always report emulated poses still work.
  tracked(hand, pose) {
    if (!pose) return false;
    if (!pose.emulatedPosition) { this.seenReal[hand] = true; return true; }
    return !this.seenReal[hand];
  }

  // controller position (reference space) -> tuk-tuk frame (the rig hangs under the seat, which is
  // only translated, so differences between hands come out right)
  toBar(p, rig, out) {
    return out.set(p.x, p.y, p.z).applyQuaternion(rig.quaternion).add(rig.position);
  }
}
