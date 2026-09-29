// Arcade tuk-tuk model: kinematic "bicycle" steering + lateral slip, fixed timestep.
// Heading convention: rotation.y = heading, forward = (-sin h, -cos h) (three.js -Z forward).
// Terrain (plan-terrain.md 5): the model stays 2D (x, z, heading); the ground grid gives the height and
// the pitch / roll under the wheels, gravity along the heading, a power-limited motor on climbs,
// regeneration and a speed cap on descents, a parking hold at standstill and a "wall" on steep slopes.
// Speeds on slopes follow the owner's real tuk-tuk (report-terrain-1b.md): up to 30 km/h on 8–10 %, 25 on
// 14 %, never more than 30 downhill. Nitro (arcade): a burst up to nitroMaxKmh for up to nitroTime, then
// a recharge; movement is sub-stepped so the collisions hold at those speeds.
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
  // terrain
  gravity: 9.81,
  powerAccel: 12,         // m²/s³: motor acceleration = min(curve, powerAccel / speed): how hard it pulls on a climb
  // climbs: the motor's controller holds this speed at most, [grade, km/h] interpolated (owner's data:
  // ~30 km/h on 8–10 %, ~25 on 14 %; below 4 % the flat top speed)
  climbSpeed: [[0.04, 40], [0.08, 31], [0.10, 30], [0.14, 25], [0.22, 15]],
  regen: 1.0,             // m/s² extra deceleration with the throttle off on a descent (electric braking)
  regenGrade: 0.02,       // descents steeper than this get the regen
  downhillCap: [[0.02, 40 / 3.6], [0.04, 30 / 3.6]], // [grade, max speed m/s], interpolated: 30 km/h on every descent from 4 %
  capDecel: 3.0,          // m/s², how the cap trims the speed (the motor is cut at the cap)
  holdSpeed: 0.3,         // m/s: below this with no pedal the tuk-tuk stands (parking brake)
  wheelFront: 1.08, wheelRear: -1.45, track: 1.24, // m, wheel positions along / across (ground sampling)
  probeAhead: 1.5, slopeWallRise: 0.5,             // m: ground rising this much within probeAhead (33 %) = a wall
  // nitro (arcade burst). nitroMaxKmh can be set with ?nitro=80 (main.js)
  nitroMaxKmh: 60,        // km/h top speed during the burst
  nitroAccel: 5.5,        // m/s² net push (drag and slopes ignored while it burns)
  nitroTime: 4,           // s the burst lasts at most (holding the button)
  nitroRecharge: 10,      // s to recharge after a burst
  nitroMinSpeed: 1,       // m/s: only while driving forward
  overspeedFade: 2.5,     // m/s²: above the normal top speed after a burst the tuk-tuk slows down evenly at this rate
  maxStep: 0.2,           // m: the move is split into sub-steps no longer than this (no tunnelling at nitro speed)
  crashSpeed: 50 / 3.6,   // m/s: a wall hit (normal speed > impactSlow) at a speed above this = a crash (main: fade + reset)
};

// max speed on a descent of `grade` (0..): linear between the table rows, none below the first
export function downhillCap(grade) {
  const C = TUNING.downhillCap;
  if (grade <= C[0][0]) return Infinity;
  for (let i = 1; i < C.length; i++) if (grade <= C[i][0]) { const t = (grade - C[i - 1][0]) / (C[i][0] - C[i - 1][0]); return C[i - 1][1] + (C[i][1] - C[i - 1][1]) * t; }
  return C[C.length - 1][1];
}
// max speed the motor holds on a climb of `grade` (0..), m/s; none below the first row
export function climbCap(grade) {
  const C = TUNING.climbSpeed;
  if (grade <= C[0][0]) return Infinity;
  for (let i = 1; i < C.length; i++) if (grade <= C[i][0]) { const t = (grade - C[i - 1][0]) / (C[i][0] - C[i - 1][0]); return (C[i - 1][1] + (C[i][1] - C[i - 1][1]) * t) / 3.6; }
  return C[C.length - 1][1] / 3.6;
}

export class TukTukPhysics {
  // bounds: optional play-area rect {minX, maxX, minZ, maxZ} for the soft edge; terrain: Terrain or null (flat)
  constructor(world, start, bounds = null, terrain = null) {
    this.world = world;
    this.bounds = bounds;
    this.terrain = terrain;
    this.y = 0; this.pitch = 0; this.roll = 0; // ground under the tuk-tuk (pitch > 0 = nose up)
    this.grade = 0;                           // tan(pitch)
    this.slopeHit = 0;                        // m/s lost into a steep slope this step
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
    // nitro: active burst, seconds burnt, charge 0..1 (1 = ready), uses (count, for the tour), button edge
    this.nitro = { active: false, t: 0, charge: 1, uses: 0, held: false };
    this.crash = false;   // set by a hard wall hit above crashSpeed; main clears it after the reset
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
    this.sampleGround(fx, fz, rx, rz);

    // --- nitro state (button held = burn, a new press needed after the recharge) ---
    const N = this.nitro, press = !!input.nitro && !N.held;
    N.held = !!input.nitro;
    if (N.active) {
      N.t += dt;
      if (!input.nitro || N.t >= T.nitroTime || vf < T.nitroMinSpeed || this.reversing) { N.active = false; N.charge = 0; }
    } else if (press && N.charge >= 1 && vf >= T.nitroMinSpeed && !this.reversing && !input.handbrake) {
      N.active = true; N.t = 0; N.uses++;
    }
    if (!N.active && N.charge < 1) N.charge = Math.min(1, N.charge + dt / T.nitroRecharge);
    const nitroTop = T.nitroMaxKmh / 3.6;

    // --- longitudinal ---
    const throttle = input.throttle, brake = input.brake;
    // gravity along the heading (nose up = uphill = slows down); a nitro burst ignores it
    if (!N.active) vf -= T.gravity * Math.sin(this.pitch) * dt;
    if (brake > 0 && vf < 0.3 && !this.reversing) {
      this.brakeHold += dt;
      if (this.brakeHold > (input.reverseDelay ?? T.reverseDelay)) this.reversing = true;
    } else if (brake === 0) this.brakeHold = 0;
    if (throttle > 0 && this.reversing && vf > -0.3) this.reversing = false;
    if (brake === 0 && this.reversing && vf > -0.05) this.reversing = false;

    if (this.reversing) {
      if (brake > 0 && vf > -T.maxReverse) vf -= T.reverseAccel * brake * dt;
      if (throttle > 0) vf = Math.min(0, vf + T.brakeDecel * throttle * dt);
    } else if (N.active) {
      // nitro: a straight push to the burst top speed (the brake still works)
      if (vf < nitroTop) vf = Math.min(nitroTop, vf + T.nitroAccel * dt);
      if (brake > 0) vf = Math.max(0, vf - T.brakeDecel * brake * dt);
    } else {
      // analog throttle (controller trigger) sets a lower top speed; the keyboard's 1 gives the full curve
      const top = T.maxForward * throttle;
      const cap = this.grade < 0 ? downhillCap(-this.grade) : Infinity; // descents: a governor by grade
      const climb = this.grade > 0 ? climbCap(this.grade) : Infinity;   // climbs: the motor holds this at most
      const want = Math.min(top, climb);
      if (throttle > 0 && vf < want && vf < cap) {
        const k = Math.max(0, 1 - (vf / top) ** 2);
        const motor = Math.min(T.engineAccel * Math.sqrt(throttle) * (0.3 + 0.7 * Math.sqrt(k)), T.powerAccel * throttle / Math.max(1, vf));
        vf = Math.min(want, vf + motor * dt);
      }
      // descents: electric braking with the throttle off, and the governor trimming above the cap
      if (this.grade < -T.regenGrade && throttle === 0 && vf > 0) vf = Math.max(0, vf - T.regen * dt);
      if (vf > cap && vf <= T.maxForward) vf = Math.max(cap, vf - T.capDecel * dt); // (above 40 after a burst: the even fade below)
      if (brake > 0) vf = vf > 0 ? Math.max(0, vf - T.brakeDecel * brake * dt) : Math.min(0, vf + T.brakeDecel * brake * dt);
    }
    if (input.handbrake) vf = vf > 0 ? Math.max(0, vf - T.handbrakeDecel * dt) : Math.min(0, vf + T.handbrakeDecel * dt);
    // resistance (none while the nitro burns: its push is net; above the normal top speed after a burst an
    // even fade instead of the drag, which at 100 km/h would brake as hard as the brake pedal)
    if (!N.active && vf > T.maxForward) vf = Math.max(T.maxForward, vf - T.overspeedFade * dt);
    else if (!N.active) {
      const drag = (T.rolling + T.air * vf * vf) * dt;
      if (throttle === 0 || this.reversing || vf > T.maxForward * throttle) vf = Math.abs(vf) <= drag ? 0 : vf - Math.sign(vf) * drag;
      else vf -= Math.sign(vf) * T.air * vf * vf * dt;
    }
    vf = Math.min(N.active ? Math.max(T.maxForward, nitroTop) : Infinity, Math.max(-T.maxReverse, vf));
    // parking hold: no pedal and (almost) standing -> standing, whatever the slope
    if (throttle === 0 && brake === 0 && !this.reversing && Math.abs(vf) < T.holdSpeed) vf = 0;

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
    // above the normal top speed (nitro) the yaw cap shrinks: the sideways acceleration stays what it is at 40 km/h
    const yawCap = T.maxYawRate * Math.min(1, T.maxForward / Math.max(1e-3, Math.abs(vf)));
    yaw = Math.max(-yawCap, Math.min(yawCap, yaw));
    this.yawRate = yaw;

    // velocity stays on the old axes, heading turns: next step's projection yields the slip.
    this.vx = fx * vf + rx * vr;
    this.vz = fz * vf + rz * vr;

    // --- soft play-area edge ---
    this.edgeDist = Infinity;
    const B = this.bounds;
    if (B) {
      // the braking zone grows with the speed (nitro), so the cap never cuts the speed with a jolt
      const v2 = this.vx * this.vx + this.vz * this.vz;
      this.edgeZoneNow = Math.max(T.edgeZone, v2 / (2 * T.edgeDecel) + T.edgeStop + 2);
      this.softEdge(this.x - B.minX, -1, 0);
      this.softEdge(B.maxX - this.x, 1, 0);
      this.softEdge(this.z - B.minZ, 0, -1);
      this.softEdge(B.maxZ - this.z, 0, 1);
      vf = this.vx * fx + this.vz * fz;
    }

    // steep slope ahead = a wall (the hill flank, the rock over the beach): no driving into it
    this.slopeHit = 0;
    if (this.terrain) {
      const sp = Math.hypot(this.vx, this.vz);
      if (sp > 0.05) {
        const ux = this.vx / sp, uz = this.vz / sp;
        const rise = this.terrain.height(this.x + ux * T.probeAhead, this.z + uz * T.probeAhead) - this.terrain.height(this.x, this.z);
        if (rise > T.slopeWallRise) { this.slopeHit = sp; this.vx = this.vz = 0; vf = 0; }
      }
    }

    this.heading -= yaw * dt; // positive yaw = right turn = clockwise seen from above
    // move in sub-steps of at most maxStep with the collisions after each: at 100 km/h a step is 0.39 m
    const n = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vz) * dt / T.maxStep));
    let impact = 0;
    for (let k = 0; k < n; k++) {
      this.x += this.vx * dt / n;
      this.z += this.vz * dt / n;
      this.collide();
      impact = Math.max(impact, this.lastImpact);
    }
    this.lastImpact = impact;
    this.forwardSpeed = this.vx * fx + this.vz * fz;
    this.accel = (this.forwardSpeed - vf0) / dt;
    // (slopeHit stays separate from lastImpact: a verge is not a wall for the tourists' mood; the
    // vignette takes both, see main.js)
  }

  // Ground height under the centre and the pitch / roll from the wheel points
  sampleGround(fx, fz, rx, rz) {
    const T = TUNING, G = this.terrain;
    if (!G) { this.y = 0; this.pitch = 0; this.roll = 0; this.grade = 0; return; }
    const hF = G.height(this.x + fx * T.wheelFront, this.z + fz * T.wheelFront);
    const rxz = this.x + fx * T.wheelRear, rzz = this.z + fz * T.wheelRear;
    const hL = G.height(rxz - rx * T.track / 2, rzz - rz * T.track / 2);
    const hR = G.height(rxz + rx * T.track / 2, rzz + rz * T.track / 2);
    const hRear = (hL + hR) / 2;
    this.pitch = Math.atan2(hF - hRear, T.wheelFront - T.wheelRear);
    this.roll = Math.atan2(hL - hR, T.track);
    this.grade = Math.tan(this.pitch);
    this.y = G.height(this.x, this.z);
  }

  // Caps the velocity component towards one boundary edge (outward normal nx, nz; d = distance to it).
  // The cap follows a constant-deceleration curve, so the tuk-tuk brakes smoothly and stops before
  // the wall; motion along the edge or back to the centre is not limited.
  softEdge(d, nx, nz) {
    const T = TUNING;
    if (d < this.edgeDist) this.edgeDist = d;
    if (d >= (this.edgeZoneNow || T.edgeZone)) return;
    const cap = Math.sqrt(2 * T.edgeDecel * Math.max(0, d - T.edgeStop));
    const vo = this.vx * nx + this.vz * nz;
    if (vo > cap) { this.vx -= nx * (vo - cap); this.vz -= nz * (vo - cap); }
  }

  collide() {
    const T = TUNING, W = this.world;
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    let impact = 0;
    const speedBefore = Math.hypot(this.vx, this.vz);
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
    if (impact > T.impactSlow) {
      if (speedBefore > T.crashSpeed) this.crash = true; // main: short fade, back onto the road
      this.vx *= 0.4; this.vz *= 0.4;
    }
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

  groundAt(x, z) { return this.terrain ? this.terrain.height(x, z) : 0; }

  fits(x, z, heading) {
    const fx = -Math.sin(heading), fz = -Math.cos(heading), T = TUNING;
    return T.circles.every((o) => this.world.penetration(x + fx * o, z + fz * o, T.circleR + 0.3) === 0);
  }

  teleport(x, z, heading) {
    this.x = this.prev.x = this.safe.x = x;
    this.z = this.prev.z = this.safe.z = z;
    this.heading = this.prev.heading = this.safe.heading = heading;
    this.vx = this.vz = 0; this.wheel = 0; this.forwardSpeed = 0; this.reversing = false;
    this.nitro.active = false; this.crash = false;
  }
}
