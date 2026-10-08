// Crazy Tuk chase camera (racing-game style). The camera is kept as an OFFSET from the tuk-tuk, not as a smoothed world
// position, so it never lags behind the motion and can never end up inside the cab: the offset direction follows the
// heading (a little of the path in a drift) with a smoothed angle, the distance and height grow with the speed, the
// view widens, the nitro shakes it lightly. A march along the line to the camera pulls it closer when a wall is in the
// way (the camera then rises, at the very worst it hangs straight above the cab) and it is never lower than the ground + minAbove.
export const CAM = {
  dist: [6.2, 11.5],        // m behind the tuk-tuk at ≤ lowKmh .. ≥ highKmh
  height: [3.5, 5.3],       // m above the ground under the tuk-tuk
  lowKmh: 30, highKmh: 125, // the speed range that moves the camera
  fovAdd: 24,               // ° (horizontal) added at the top speed
  fovNitro: 10,             // ° more while the nitro burns
  liftMax: 5.5,             // m: extra height when a wall pulls the camera in (at the very worst it hangs above the cab looking down)
  minAbove: 1.6,            // m above the ground at the camera
  wallPad: 0.5,             // m kept between the camera and a wall
  yawRate: 5,               // 1/s: how fast the camera swings round behind the heading
  pathShare: 0.3,           // share of the path direction (vs the heading) the camera looks along: shows the slide of a drift
  pull: 14,                 // 1/s: how fast the distance recovers after a wall pushed the camera in (going in is instant)
  shake: 0.07,              // m: nitro shake amplitude (and 0.012 rad of roll)
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class ArcadeCam {
  constructor() { this.reset(); }
  reset() { this.yaw = null; this.dist = CAM.dist[0]; this.k = 0; this.fov = 0; this.shakeK = 0; this.t = 0; }

  // s: { x, z, gy, heading, vx, vz, kmh, nitro }; world: CollisionWorld (penetration) or null; groundAt(x, z)
  // returns { px, py, pz, lx, ly, lz, fovAdd, roll }
  update(dt, s, world, groundAt) {
    this.t += dt;
    const sp = Math.hypot(s.vx, s.vz);
    // the direction the camera looks along: the heading, bent towards the path while sliding
    let want = Math.atan2(-Math.cos(s.heading), -Math.sin(s.heading));   // forward = (-sin h, -cos h) as the angle atan2(z, x)
    if (sp > 4) {
      const path = Math.atan2(s.vz, s.vx);
      want += angDiff(path, want) * CAM.pathShare;
    }
    if (this.yaw == null) this.yaw = want;
    this.yaw += angDiff(want, this.yaw) * (1 - Math.exp(-dt * CAM.yawRate));
    const k = clamp01((s.kmh - CAM.lowKmh) / (CAM.highKmh - CAM.lowKmh));
    this.k += (k - this.k) * (1 - Math.exp(-dt * 3));
    this.fov += ((s.nitro ? CAM.fovNitro : 0) - this.fov) * (1 - Math.exp(-dt * (s.nitro ? 4 : 2)));
    this.shakeK += ((s.nitro ? 1 : 0) - this.shakeK) * (1 - Math.exp(-dt * 8));
    const wantDist = CAM.dist[0] + (CAM.dist[1] - CAM.dist[0]) * this.k;
    const height = CAM.height[0] + (CAM.height[1] - CAM.height[0]) * this.k;
    const fx = Math.cos(this.yaw), fz = Math.sin(this.yaw);   // unit vector the camera looks along (horizontal)

    // how far back the way is free: march from the tuk-tuk along -f, a wall ends it
    let free = wantDist;
    if (world) {
      for (let d = 0.4; d <= wantDist + CAM.wallPad; d += 0.4) {
        if (world.penetration(s.x - fx * d, s.z - fz * d, 0.35) > 0) { free = Math.max(0, d - 0.4 - CAM.wallPad); break; }
      }
    }
    // pushed in at once, let out smoothly
    if (free < this.dist) this.dist = free; else this.dist += (free - this.dist) * (1 - Math.exp(-dt * CAM.pull));
    const d = this.dist;

    let px = s.x - fx * d, pz = s.z - fz * d;
    let py = Math.max(s.gy + height, groundAt(px, pz) + CAM.minAbove);
    // a nearer camera sits higher: it looks over the roof of the cab, and above it at the very worst - never into it
    if (d < wantDist) py += (1 - d / wantDist) * CAM.liftMax;
    let roll = 0;
    if (this.shakeK > 0.01) {
      const a = CAM.shake * this.shakeK, t = this.t;
      px += (Math.sin(t * 61) + Math.sin(t * 37.7)) * 0.5 * a;
      py += (Math.sin(t * 53.3) + Math.sin(t * 29.1)) * 0.5 * a;
      roll = (Math.sin(t * 47) + Math.sin(t * 23.3)) * 0.5 * 0.012 * this.shakeK;
    }
    const ahead = 3 + 5 * this.k;
    return { px, py, pz, lx: s.x + fx * ahead, ly: s.gy + 1.1, lz: s.z + fz * ahead, fovAdd: CAM.fovAdd * this.k + this.fov, roll };
  }
}
