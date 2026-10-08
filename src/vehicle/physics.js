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

// Crazy Tuk (docs/plan-arcade.md, section 2.1): the same model with a different profile. Flat-out 120 km/h, 150 with
// the nitro, a strong motor that ignores the slope tables, hard brakes, a turn rate bounded by a lateral acceleration
// instead of the comfort yaw cap, a stronger drift on the handbrake, a wide soft edge and a rebound instead of a crash.
export const ARCADE = {
  ...TUNING,
  arcade: true,
  maxForward: 120 / 3.6,
  engineAccel: 7.0,       // 0 -> 60 km/h in about 3 s
  powerAccel: 220,        // the motor pulls the castle climb (8-14 %) without losing speed
  climbSpeed: null, downhillCap: null, regen: 0,   // no slope governors
  brakeDecel: 12,
  rolling: 0.3, air: 0.0012,                       // 1.3 m/s² of drag at 120 km/h: the motor still reaches the top speed
  steerHigh: 0.3,
  maxYawRate: 110 * Math.PI / 180,
  latAccelMax: 30,        // m/s² (≈ 3 g, arcade grip): R = v² / 30 -> 9.3 m at 60 km/h, 37 m at 120, 58 m at 150
  minTurnRadius: 7.5,     // m, the tightest path at low speed
  gripKeep: 0.86,
  // speeds (tune here): the auto-gas holds autoGasKmh, the pedal gives maxForward, the nitro nitroMaxKmh (below)
  autoGasKmh: 70, cruiseFade: 3,   // km/h the auto-gas holds; m/s² it trims a faster speed back (after a nitro burst)
  // drift (handbrake at speed): the rear loses grip, the heading turns faster than the path, the tuk-tuk slides sideways.
  // The side force is bounded (driftFriction m/s²), so the slide is caught by steering against it; releasing the
  // handbrake brings the grip back in 1/gripRecover s and the slide turns into forward speed. It never spins past
  // driftMaxSlip and never flips (the model is 2D).
  handbrakeDecel: 1.5, handbrakeYaw: 2.0,
  driftMinSpeed: 30 / 3.6,  // m/s: slower than this the handbrake only turns tighter (no slide)
  driftEnter: 7, gripRecover: 2.5,   // 1/s: how fast the rear lets go / takes hold again
  driftFriction: 30,        // m/s²: side force of the sliding tyres (the grip's turn is ~30)
  driftCarry: 0.85,         // share of the sideways speed the tyres turn into forward speed (the rest is scrubbed)
  driftScrub: 0.5,          // 1/s: forward speed lost per m/s of sideways speed while sliding
  driftAlign: 1.0,          // 1/s: how hard the heading is pulled back to the path with the stick centred
  driftMaxSlip: 70 * Math.PI / 180,   // rad: the heading does not rotate any further away from the path than this
  // a slide with the nitro (or the gas pedal) held: long and fast, hardly any speed lost (the plain handbrake drift is unchanged)
  driftBoostScrub: 0.1, driftBoostFriction: 0.7,   // × driftScrub, × driftFriction while input.slideBoost
  driftSmoke: 2.5,          // m/s of sideways speed above which the game shows smoke / marks / squeal
  // reversing (the real tuk-tuk keeps 8 km/h): quick enough for a U-turn in an alley
  maxReverse: 30 / 3.6, reverseAccel: 7, reverseDelay: 0.2,
  edgeZone: 120, edgeDecel: 8,                     // from 150 km/h the soft edge needs ≥ 110 m
  scrapeKeep: 0.9985, bounce: 1.15,
  slopeScrape: 0.985,       // speed kept per step while sliding along a steep slope (A.2)
  overspeedFade: 4,
  crashSpeed: Infinity,   // never a reset by the physics (arcade.js resets a stuck tuk-tuk itself)
  // nitro as a tank: full = 100 %, burns 25 %/s while held, refills 3 %/s by itself (events add more)
  nitroTank: true, nitroMaxKmh: 150, nitroAccel: 6.0, nitroDrain: 0.25, nitroPassive: 0.03, nitroMinSpeed: -10,   // from a standstill, even rolling backwards, without the gas
};

// max speed on a descent of `grade` (0..): linear between the table rows, none below the first
export function downhillCap(grade, T = TUNING) {
  const C = T.downhillCap;
  if (!C || grade <= C[0][0]) return Infinity;
  for (let i = 1; i < C.length; i++) if (grade <= C[i][0]) { const t = (grade - C[i - 1][0]) / (C[i][0] - C[i - 1][0]); return C[i - 1][1] + (C[i][1] - C[i - 1][1]) * t; }
  return C[C.length - 1][1];
}
// max speed the motor holds on a climb of `grade` (0..), m/s; none below the first row
export function climbCap(grade, T = TUNING) {
  const C = T.climbSpeed;
  if (!C || grade <= C[0][0]) return Infinity;
  for (let i = 1; i < C.length; i++) if (grade <= C[i][0]) { const t = (grade - C[i - 1][0]) / (C[i][0] - C[i - 1][0]); return (C[i - 1][1] + (C[i][1] - C[i - 1][1]) * t) / 3.6; }
  return C[C.length - 1][1] / 3.6;
}

export class TukTukPhysics {
  // bounds: optional play-area rect {minX, maxX, minZ, maxZ} for the soft edge; terrain: Terrain or null (flat)
  constructor(world, start, bounds = null, terrain = null, tuning = TUNING) {
    this.T = tuning;      // TUNING (the real tuk-tuk) or ARCADE (Crazy Tuk, src/vehicle/arcade profile below)
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
    this.grip = 1;        // arcade: rear grip 1 (holds) .. 0 (sliding on the handbrake)
    this.slip = 0;        // arcade: angle between the heading and the path (rad, + = the path is to the right of the nose)
    this.slipSpeed = 0;   // arcade: sideways speed (m/s) of the tuk-tuk in its own frame, for the smoke / marks / squeal
    // nitro: active burst, seconds burnt, charge 0..1 (1 = ready), uses (count, for the tour), button edge
    this.nitro = { active: false, t: 0, charge: 1, uses: 0, held: false };
    this.crash = false;   // set by a hard wall hit above crashSpeed; main clears it after the reset
    this.safe = { x: this.x, z: this.z, heading: this.heading };
    this.prev = { x: this.x, z: this.z, heading: this.heading };
  }

  step(dt, input) {
    const T = this.T;
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
    if (T.nitroTank) {
      // arcade: a tank 0..1 burnt while the button is held (nitroDrain per s), refilled slowly by itself (nitroPassive
      // per s) and by the game's events (arcade.js adds to `charge`); no fixed burst length, no cooldown
      if (input.nitro && N.charge > 0 && this.reversing) this.reversing = false;   // the nitro takes the tuk-tuk out of reverse
      const can = !!input.nitro && N.charge > 0 && vf >= T.nitroMinSpeed && !this.reversing;
      if (can && !N.active) { N.active = true; N.t = 0; N.uses++; }
      if (!can) N.active = false;
      if (N.active) { N.t += dt; N.charge = Math.max(0, N.charge - T.nitroDrain * dt); }
      else N.charge = Math.min(1, N.charge + T.nitroPassive * dt);
    } else {
      if (N.active) {
        N.t += dt;
        if (!input.nitro || N.t >= T.nitroTime || vf < T.nitroMinSpeed || this.reversing) { N.active = false; N.charge = 0; }
      } else if (press && N.charge >= 1 && vf >= T.nitroMinSpeed && !this.reversing && !input.handbrake) {
        N.active = true; N.t = 0; N.uses++;
      }
      if (!N.active && N.charge < 1) N.charge = Math.min(1, N.charge + dt / T.nitroRecharge);
    }
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
      let top = T.maxForward * throttle;
      if (input.cruiseKmh && T.arcade) {   // the auto-gas: holds this speed, trims a faster one back (after the nitro)
        top = Math.min(top, input.cruiseKmh / 3.6);
        if (vf > top) vf = Math.max(top, vf - T.cruiseFade * dt);
      }
      const cap = this.grade < 0 ? downhillCap(-this.grade, T) : Infinity; // descents: a governor by grade
      const climb = this.grade > 0 ? climbCap(this.grade, T) : Infinity;   // climbs: the motor holds this at most
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
    const boosted = T.arcade && !!input.slideBoost && this.grip < 1;   // sliding with the nitro / gas held: no braking from the handbrake
    if (input.handbrake && !boosted) vf = vf > 0 ? Math.max(0, vf - T.handbrakeDecel * dt) : Math.min(0, vf + T.handbrakeDecel * dt);
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
    if (throttle === 0 && brake === 0 && !this.reversing && !N.active && Math.abs(vf) < T.holdSpeed) vf = 0;

    // --- lateral grip ---
    // while scraping a wall, keep the sideways speed so the tuk-tuk slides along it
    // (no automatic heading change: in VR that would rotate the player's view).
    if (T.arcade) {
      // rear grip: the handbrake at speed lets it go, releasing brings it back (slowly: the slide is carried out)
      const wantLoose = !!input.handbrake && vf > T.driftMinSpeed && !this.reversing;
      this.grip = wantLoose ? Math.max(0, this.grip - T.driftEnter * dt) : Math.min(1, this.grip + T.gripRecover * dt);
      const vr0 = vr;
      if (this.contactTimer > 0) vr *= Math.pow(T.wallSlideKeep, dt * 60);
      else {
        const held = vr * Math.pow(T.gripKeep, dt * 60);
        if (this.grip < 1) {
          const slid = Math.sign(vr) * Math.max(0, Math.abs(vr) - T.driftFriction * (boosted ? T.driftBoostFriction : 1) * dt);   // bounded side force
          vr = slid + (held - slid) * this.grip;
        } else vr = held;
        // the tyres rotate the path instead of killing the speed: what vanished sideways turns (mostly) into forward speed
        const turned = (vr0 * vr0 - vr * vr) * T.driftCarry;
        if (turned > 0 && vf > 0.5) vf = Math.sqrt(vf * vf + turned);
        if (this.grip < 1 && vf > 0) vf = Math.max(0, vf - T.driftScrub * (boosted ? T.driftBoostScrub : 1) * Math.abs(vr) * (1 - this.grip) * dt);
      }
    } else {
      const keep = this.contactTimer > 0 ? T.wallSlideKeep : input.handbrake ? T.handbrakeKeep : T.gripKeep;
      vr *= Math.pow(keep, dt * 60);
    }
    this.contactTimer = Math.max(0, (this.contactTimer || 0) - dt);
    this.slipSpeed = Math.abs(vr);
    this.slip = vf > 0.5 ? Math.atan2(vr, vf) : 0;

    // --- steering ---
    const sp = Math.min(1, Math.abs(vf) / T.maxForward);
    const maxWheel = T.steerLow + (T.steerHigh - T.steerLow) * sp;
    const target = input.steer * maxWheel;
    const dw = target - this.wheel, stepW = T.steerRate * dt;
    this.wheel += Math.abs(dw) < stepW ? dw : Math.sign(dw) * stepW;
    let yaw;
    if (T.arcade) {
      // arcade: the turn rate is proportional to the stick and limited by a lateral acceleration (latAccelMax) and a
      // smallest path radius (minTurnRadius), so a full stick never saturates in a jerk: at 60 km/h R ≈ 9 m, at 120 ≈ 37 m
      const av = Math.max(1e-3, Math.abs(vf));
      const yawCap = Math.min(T.maxYawRate, T.latAccelMax / av, av / T.minTurnRadius);
      const slide = 1 - this.grip;
      yaw = (maxWheel > 0 ? this.wheel / maxWheel : 0) * yawCap * Math.sign(vf || 1);
      if (input.handbrake) yaw *= 1 + (T.handbrakeYaw - 1) * (vf > T.driftMinSpeed ? Math.max(slide, 0.35) : 0.35);   // slow: only a tighter turn
      if (slide > 0 && vf > 0.5) {
        yaw += T.driftAlign * this.slip * slide;   // the nose is pulled back towards the path (the slide settles by itself)
        if (Math.abs(this.slip) > T.driftMaxSlip && yaw * this.slip < 0) yaw = 0;   // no spinning round
      }
    } else {
      yaw = (vf / T.wheelbase) * Math.tan(this.wheel);
      if (input.handbrake) yaw *= T.handbrakeYaw;
      // above the normal top speed (nitro) the yaw cap shrinks: the sideways acceleration stays what it is at 40 km/h
      const yawCap = T.maxYawRate * Math.min(1, T.maxForward / Math.max(1e-3, Math.abs(vf)));
      yaw = Math.max(-yawCap, Math.min(yawCap, yaw));
    }
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
        if (rise > T.slopeWallRise) {
          if (T.arcade && this.slideAlongSlope(ux, uz)) vf = this.vx * fx + this.vz * fz;   // Crazy Tuk: slide along the slope, not into a wall
          else { this.slopeHit = sp; this.vx = this.vz = 0; vf = 0; }
        }
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

  // Crazy Tuk (A.2): a steep slope ahead does not stop the tuk-tuk dead: the part of the velocity that goes uphill is taken away and
  // the rest slides along the slope (the contour). Returns false when the gradient is unusable (a DEM step): then the wall rule applies.
  slideAlongSlope(ux, uz) {
    const G = this.terrain, d = 0.75;
    const gx = (G.height(this.x + d, this.z) - G.height(this.x - d, this.z)) / (2 * d), gz = (G.height(this.x, this.z + d) - G.height(this.x, this.z - d)) / (2 * d);
    const g = Math.hypot(gx, gz);
    if (g < 0.12) return false;
    const nx = gx / g, nz = gz / g, vn = this.vx * nx + this.vz * nz;   // n: horizontal uphill direction
    if (vn <= 0) return true;                                           // already moving along / down: nothing to remove
    this.vx -= nx * vn; this.vz -= nz * vn;
    this.vx *= this.T.slopeScrape; this.vz *= this.T.slopeScrape;
    // the nose swings along the slope too (otherwise the tyres turn the slide back into "forward = uphill" and the speed drains away)
    if (Math.hypot(this.vx, this.vz) > 1) {
      const d = Math.atan2(-this.vx, -this.vz) - this.heading;
      this.heading += Math.atan2(Math.sin(d), Math.cos(d)) * 0.15;
    }
    this.slopeHit = vn;                                                 // m/s lost into the slope (the vibration / the stuck timer read it)
    this.slopeSlid = 0.2;
    return true;
  }

  // Ground height under the centre and the pitch / roll from the wheel points
  sampleGround(fx, fz, rx, rz) {
    const T = this.T, G = this.terrain;
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
    const T = this.T;
    if (d < this.edgeDist) this.edgeDist = d;
    if (d >= (this.edgeZoneNow || T.edgeZone)) return;
    const cap = Math.sqrt(2 * T.edgeDecel * Math.max(0, d - T.edgeStop));
    const vo = this.vx * nx + this.vz * nz;
    if (vo > cap) { this.vx -= nx * (vo - cap); this.vz -= nz * (vo - cap); }
  }

  collide() {
    const T = this.T, W = this.world;
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    let impact = 0;
    const speedBefore = Math.hypot(this.vx, this.vz);
    const normals = [];
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const o of T.circles) {
        const cx = this.x + fx * o, cz = this.z + fz * o;
        const [nx2, nz2] = W.resolveCircle(cx, cz, T.circleR, (nx, nz, depth, e) => { normals.push(nx, nz); if (e !== undefined && W.kind) this.contactKind = W.kind[e]; });
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
        this.vx -= nx * vn * (T.bounce || 1.05); this.vz -= nz * vn * (T.bounce || 1.05); // small bounce
        this.vx *= T.scrapeKeep || 0.996; this.vz *= T.scrapeKeep || 0.996;             // scrape
      }
    }
    if (impact > T.impactSlow) {
      if (T.arcade) {
        // arcade: no reset, a rebound. A glancing hit (little speed into the wall) keeps 65 % of the speed, a head-on
        // one 40 %; the game (arcade.js) reads `hit` for the tips and the combo
        const into = Math.min(1, impact / Math.max(1e-3, speedBefore));
        const keep = 0.65 - 0.25 * into;
        this.vx *= keep; this.vz *= keep;
        this.hit = { speed: speedBefore, into: impact, keep };
      } else {
        if (speedBefore > T.crashSpeed) this.crash = true; // main: short fade, back onto the road
        this.vx *= 0.4; this.vz *= 0.4;
      }
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
    const fx = -Math.sin(heading), fz = -Math.cos(heading), T = this.T;
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
