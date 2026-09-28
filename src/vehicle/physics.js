// Arcade tuk-tuk model: kinematic "bicycle" steering + lateral slip, fixed timestep.
// Heading convention: rotation.y = heading, forward = (-sin h, -cos h) (three.js -Z forward).
export const TUNING = {
  maxForward: 40 / 3.6,   // m/s (comfort limit)
  maxReverse: 8 / 3.6,
  engineAccel: 3.6,       // m/s² at standstill, fades towards top speed
  brakeDecel: 6.0,
  reverseAccel: 2.0,
  rolling: 0.35,          // m/s²
  air: 0.004,             // m/s² per (m/s)²
  wheelbase: 1.9,
  steerLow: 0.55,         // max wheel angle (rad) at standstill
  steerHigh: 0.2,         // at top speed
  steerRate: 2.6,         // rad/s wheel turn speed
  maxYawRate: 60 * Math.PI / 180, // comfort cap
  gripKeep: 0.86,         // share of lateral speed kept per 1/60 s
  handbrakeKeep: 0.965,
  handbrakeDecel: 2.2,
  handbrakeYaw: 1.35,
  reverseDelay: 0.5,      // hold brake this long at standstill to start reversing
  circleR: 0.72,          // collision circles along the body (offset forward, m): cab front and
  circles: [0.62, -0.62, -1.6],  // middle, plus the rear of the long body (second passenger bench)
  impactSlow: 4.0,        // m/s into a wall -> heavy slowdown
  wallSlideKeep: 0.995,   // lateral speed kept per 1/60 s while touching a wall
  edgeZone: 20,           // soft play-area edge: speed towards the boundary is capped within this distance
  edgeStop: 3,            // ... down to 0 this far from the boundary wall (the body never touches it)
  edgeDecel: 3.7,         // m/s², braking profile of the cap (≥ 40 km/h at the zone entry, so no jolt)
};

export class TukTukPhysics {
  // bounds: optional play-area rect {minX, maxX, minZ, maxZ} for the soft edge
  constructor(world, start, bounds = null) {
    this.world = world;
    this.bounds = bounds;
    this.edgeDist = Infinity; // distance to the nearest play-area boundary
    this.x = start.x; this.z = start.z; this.heading = start.heading;
    this.vx = 0; this.vz = 0;
    this.wheel = 0;       // current wheel angle (rad), + = right
    this.forwardSpeed = 0;
    this.yawRate = 0;
    this.brakeHold = 0;
    this.reversing = false;
    this.lastImpact = 0;  // m/s of the latest hit (for comfort effects)
    this.accel = 0;       // longitudinal acceleration m/s² (for comfort effects)
    this.safe = { x: this.x, z: this.z, heading: this.heading };
    this.prev = { x: this.x, z: this.z, heading: this.heading };
  }

  step(dt, input) {
    const T = TUNING;
    this.prev.x = this.x; this.prev.z = this.z; this.prev.heading = this.heading;
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const fx = -sh, fz = -ch, rx = ch, rz = -sh;
    let vf = this.vx * fx + this.vz * fz;
    let vr = this.vx * rx + this.vz * rz;
    const vf0 = vf;

    // --- longitudinal ---
    const throttle = input.throttle, brake = input.brake;
    if (brake > 0 && vf < 0.3 && !this.reversing) {
      this.brakeHold += dt;
      if (this.brakeHold > (input.reverseDelay ?? T.reverseDelay)) this.reversing = true;
    } else if (brake === 0) this.brakeHold = 0;
    if (throttle > 0 && this.reversing && vf > -0.3) this.reversing = false;
    if (brake === 0 && this.reversing && vf > -0.05) this.reversing = false;

    if (this.reversing) {
      if (brake > 0 && vf > -T.maxReverse) vf -= T.reverseAccel * brake * dt;
      if (throttle > 0) vf = Math.min(0, vf + T.brakeDecel * throttle * dt);
    } else {
      // analog throttle (controller trigger) sets a lower top speed; the keyboard's 1 gives the full curve
      const top = T.maxForward * throttle;
      if (throttle > 0 && vf < top) {
        const k = Math.max(0, 1 - (vf / top) ** 2);
        vf += T.engineAccel * Math.sqrt(throttle) * (0.3 + 0.7 * Math.sqrt(k)) * dt;
      }
      if (brake > 0) vf = vf > 0 ? Math.max(0, vf - T.brakeDecel * brake * dt) : Math.min(0, vf + T.brakeDecel * brake * dt);
    }
    if (input.handbrake) vf = vf > 0 ? Math.max(0, vf - T.handbrakeDecel * dt) : Math.min(0, vf + T.handbrakeDecel * dt);
    // resistance
    const drag = (T.rolling + T.air * vf * vf) * dt;
    if (throttle === 0 || this.reversing || vf > T.maxForward * throttle) vf = Math.abs(vf) <= drag ? 0 : vf - Math.sign(vf) * drag;
    else vf -= Math.sign(vf) * T.air * vf * vf * dt;
    vf = Math.min(T.maxForward, Math.max(-T.maxReverse, vf));

    // --- lateral grip ---
    // while scraping a wall, keep the sideways speed so the tuk-tuk slides along it
    // (no automatic heading change: in VR that would rotate the player's view).
    const keep = this.contactTimer > 0 ? T.wallSlideKeep : input.handbrake ? T.handbrakeKeep : T.gripKeep;
    vr *= Math.pow(keep, dt * 60);
    this.contactTimer = Math.max(0, (this.contactTimer || 0) - dt);

    // --- steering ---
    const sp = Math.min(1, Math.abs(vf) / T.maxForward);
    const maxWheel = T.steerLow + (T.steerHigh - T.steerLow) * sp;
    const target = input.steer * maxWheel;
    const dw = target - this.wheel, stepW = T.steerRate * dt;
    this.wheel += Math.abs(dw) < stepW ? dw : Math.sign(dw) * stepW;
    let yaw = (vf / T.wheelbase) * Math.tan(this.wheel);
    if (input.handbrake) yaw *= T.handbrakeYaw;
    yaw = Math.max(-T.maxYawRate, Math.min(T.maxYawRate, yaw));
    this.yawRate = yaw;

    // velocity stays on the old axes, heading turns: next step's projection yields the slip.
    this.vx = fx * vf + rx * vr;
    this.vz = fz * vf + rz * vr;

    // --- soft play-area edge ---
    this.edgeDist = Infinity;
    const B = this.bounds;
    if (B) {
      this.softEdge(this.x - B.minX, -1, 0);
      this.softEdge(B.maxX - this.x, 1, 0);
      this.softEdge(this.z - B.minZ, 0, -1);
      this.softEdge(B.maxZ - this.z, 0, 1);
      vf = this.vx * fx + this.vz * fz;
    }

    this.heading -= yaw * dt; // positive yaw = right turn = clockwise seen from above
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.forwardSpeed = vf;
    this.accel = (vf - vf0) / dt;

    this.collide();
  }

  // Caps the velocity component towards one boundary edge (outward normal nx, nz; d = distance to it).
  // The cap follows a constant-deceleration curve, so the tuk-tuk brakes smoothly and stops before
  // the wall; motion along the edge or back to the centre is not limited.
  softEdge(d, nx, nz) {
    const T = TUNING;
    if (d < this.edgeDist) this.edgeDist = d;
    if (d >= T.edgeZone) return;
    const cap = Math.sqrt(2 * T.edgeDecel * Math.max(0, d - T.edgeStop));
    const vo = this.vx * nx + this.vz * nz;
    if (vo > cap) { this.vx -= nx * (vo - cap); this.vz -= nz * (vo - cap); }
  }

  collide() {
    const T = TUNING, W = this.world;
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    let impact = 0;
    const normals = [];
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const o of T.circles) {
        const cx = this.x + fx * o, cz = this.z + fz * o;
        const [nx2, nz2] = W.resolveCircle(cx, cz, T.circleR, (nx, nz) => normals.push(nx, nz));
        if (nx2 !== cx || nz2 !== cz) { this.x += nx2 - cx; this.z += nz2 - cz; moved = true; }
      }
      if (!moved) break;
    }
    for (let i = 0; i < normals.length; i += 2) {
      const nx = normals[i], nz = normals[i + 1];
      const vn = this.vx * nx + this.vz * nz;
      this.contactTimer = 0.15;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        this.vx -= nx * vn * 1.05; this.vz -= nz * vn * 1.05; // small bounce
        this.vx *= 0.996; this.vz *= 0.996;                   // scrape
      }
    }
    if (impact > T.impactSlow) { this.vx *= 0.4; this.vz *= 0.4; }
    this.lastImpact = impact;

    // anti-stuck: still deep inside something after resolving -> back to last safe spot
    let worst = 0;
    for (const o of T.circles) worst = Math.max(worst, W.penetration(this.x + fx * o, this.z + fz * o, T.circleR));
    if (worst > 0.25) {
      this.x = this.safe.x; this.z = this.safe.z; this.heading = this.safe.heading;
      this.vx = this.vz = 0;
      this.reverts = (this.reverts || 0) + 1;
    } else if (worst === 0) {
      this.safe.x = this.x; this.safe.z = this.z; this.safe.heading = this.heading;
    }
  }

  fits(x, z, heading) {
    const fx = -Math.sin(heading), fz = -Math.cos(heading), T = TUNING;
    return T.circles.every((o) => this.world.penetration(x + fx * o, z + fz * o, T.circleR + 0.3) === 0);
  }

  teleport(x, z, heading) {
    this.x = this.prev.x = this.safe.x = x;
    this.z = this.prev.z = this.safe.z = z;
    this.heading = this.prev.heading = this.safe.heading = heading;
    this.vx = this.vz = 0; this.wheel = 0; this.forwardSpeed = 0; this.reversing = false;
  }
}
