// ?debug=walls (docs/plan-arcade-a2.md A.0): shows what blocks the tuk-tuk. Collision edges around it are drawn as red curtains
// (buildings), magenta (castle / city walls), blue (sea), white (zone edge), steep slopes (the "wall" rule: rise over 0.5 m in
// 1.5 m) as orange squares on the ground, and when the tuk-tuk is stopped or scraped a label says by what, with the coordinates
// (for a bug report: "x 640, z 31: мур замку/міста"). Nothing is built unless the switch is on.
import * as THREE from 'three';
import { KIND_NAME } from '../vehicle/collision.js';

const COLORS = [0xff3030, 0xff40ff, 0x3080ff, 0xffffff, 0xffa030];   // KIND order
const RADIUS = 130, CELL = 3, SLOPE = 0.5 / 1.5;

export class WallsDebug {
  constructor(scene, world, terrain, groundY) {
    this.world = world; this.terrain = terrain; this.groundY = groundY;
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9, fog: false }));
    this.lines.frustumCulled = false; this.lines.renderOrder = 30;
    this.slope = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xff9020, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.slope.frustumCulled = false; this.slope.renderOrder = 29;
    scene.add(this.lines, this.slope);
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;left:50%;bottom:76px;transform:translateX(-50%);z-index:50;padding:6px 12px;border-radius:10px;background:rgba(10,14,20,.78);color:#ffd166;font:700 14px system-ui,sans-serif;pointer-events:none;display:none;white-space:nowrap';
    document.body.appendChild(this.el);
    this.t = 1e9; this.cx = 1e9; this.cz = 1e9; this.msgUntil = 0; this.msg = '';
  }
  // x, z: the tuk-tuk; hit: { kind, text } for this frame or null; now: seconds
  update(dt, x, z, now, reason) {
    this.t += dt;
    if (this.t > 0.7 && Math.hypot(x - this.cx, z - this.cz) > 6 || this.t > 3) { this.t = 0; this.cx = x; this.cz = z; this.rebuild(x, z); }
    if (reason) { this.msg = `${reason} · x ${x.toFixed(0)}, z ${z.toFixed(0)}`; this.msgUntil = now + 3; }
    const show = now < this.msgUntil;
    if (show !== (this.el.style.display === 'block')) this.el.style.display = show ? 'block' : 'none';
    if (show) this.el.textContent = this.msg;
  }
  rebuild(x, z) {
    const E = this.world.edgesNear(x, z, RADIUS), pos = [], col = [], c = new THREE.Color();
    for (const e of E) {
      if (Math.hypot(e.ax - x, e.az - z) > RADIUS + 40) continue;
      c.setHex(COLORS[e.kind] ?? 0xffffff);
      const y = this.groundY(e.ax, e.az), y2 = this.groundY(e.bx, e.bz);
      for (const dy of [0.2, 1.6]) { pos.push(e.ax, y + dy, e.az, e.bx, y2 + dy, e.bz); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
      pos.push(e.ax, y + 0.2, e.az, e.ax, y + 1.6, e.az); col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const g = this.lines.geometry;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    // steep cells (the gradient over 1.5 m is more than a third)
    const q = [], T = this.terrain, h = CELL, R = 60;
    if (T) for (let gx = Math.floor((x - R) / h) * h; gx < x + R; gx += h) for (let gz = Math.floor((z - R) / h) * h; gz < z + R; gz += h) {
      const cx = gx + h / 2, cz = gz + h / 2;
      const g1 = Math.hypot(T.height(cx + 0.75, cz) - T.height(cx - 0.75, cz), T.height(cx, cz + 0.75) - T.height(cx, cz - 0.75)) / 1.5;
      if (g1 < SLOPE) continue;
      const y = T.height(cx, cz) + 0.15;
      q.push(gx, y, gz, gx + h, y, gz, gx, y, gz + h, gx + h, y, gz, gx + h, y, gz + h, gx, y, gz + h);
    }
    this.slope.geometry.setAttribute('position', new THREE.Float32BufferAttribute(q, 3));
    this.slope.geometry.computeBoundingSphere();
  }
}

export const wallsReason = (phys, impact, verge) => {
  if (verge > 0) return `заблоковано: крутий схил (ковзаєш вздовж нього)`;
  if (impact > 1.5 && phys.contactKind != null) return `заблоковано: ${KIND_NAME[phys.contactKind] || 'перешкода'}`;
  return null;
};
