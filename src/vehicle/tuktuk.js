// Tuk-tuk built from primitives, merged into a single vertex-coloured mesh (1 draw call),
// plus the dashboard panel (canvas texture) and a seat anchor for the camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const C = {
  body: 0xf2c230, bodyDark: 0xd9a51f, roof: 0x1f6b45, frame: 0x2a2a2a, seat: 0x5a3422,
  chrome: 0xc8c8c8, tire: 0x161616, grip: 0x111111, light: 0xfff4c0, floor: 0x3b3b3b,
};

function part(geo, color, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
  g.translate(x, y, z);
  const col = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r, l, s = 10) => new THREE.CylinderGeometry(r, r, l, s);

export function createTukTuk({ version = '' } = {}) {
  const P = [];
  // chassis & floor
  P.push(part(box(1.3, 0.1, 2.2), C.floor, 0, 0.36, 0.35));
  // front cowl around the front wheel + dash top
  P.push(part(box(0.78, 0.55, 0.55), C.body, 0, 0.66, -0.98));
  P.push(part(box(1.16, 0.12, 0.36), C.body, 0, 0.94, -0.8));
  P.push(part(box(1.16, 0.5, 0.06), C.bodyDark, 0, 0.66, -0.64));
  // side skirts and rear body
  for (const s of [-1, 1]) {
    P.push(part(box(0.06, 0.42, 1.55), C.body, s * 0.64, 0.6, 0.65));
    P.push(part(box(0.06, 0.12, 0.9), C.bodyDark, s * 0.64, 0.46, -0.55));
  }
  P.push(part(box(1.3, 0.75, 0.08), C.body, 0, 0.78, 1.44));
  // pillars
  for (const s of [-1, 1]) {
    P.push(part(box(0.05, 1.0, 0.05), C.frame, s * 0.58, 1.43, -0.98));
    P.push(part(box(0.05, 1.45, 0.05), C.frame, s * 0.62, 1.2, 1.42));
    P.push(part(box(0.04, 0.04, 2.4), C.frame, s * 0.62, 1.88, 0.22)); // roof rails
  }
  // windscreen frame (top bar) and roof
  P.push(part(box(1.2, 0.05, 0.05), C.frame, 0, 1.9, -0.98));
  P.push(part(box(1.46, 0.07, 2.7), C.roof, 0, 1.95, 0.22));
  P.push(part(box(1.5, 0.12, 0.08), C.roof, 0, 1.9, -1.12)); // visor lip
  // driver seat & passenger bench
  P.push(part(box(0.5, 0.12, 0.42), C.seat, 0, 0.66, -0.02));
  P.push(part(box(0.5, 0.42, 0.08), C.seat, 0, 0.9, 0.22, -0.12));
  P.push(part(box(1.18, 0.16, 0.46), C.seat, 0, 0.66, 0.98));
  P.push(part(box(1.18, 0.5, 0.08), C.seat, 0, 0.98, 1.3, -0.12));
  // steering column + handlebars
  P.push(part(cyl(0.025, 0.26, 8), C.chrome, 0, 0.92, -0.74, -0.5));
  P.push(part(cyl(0.018, 0.74, 8), C.chrome, 0, 1.02, -0.66, 0, 0, Math.PI / 2));
  for (const s of [-1, 1]) {
    P.push(part(cyl(0.028, 0.14, 8), C.grip, s * 0.31, 1.02, -0.66, 0, 0, Math.PI / 2));
    P.push(part(box(0.1, 0.012, 0.03), C.frame, s * 0.29, 1.04, -0.61)); // brake levers
  }
  // wheels
  P.push(part(cyl(0.26, 0.16, 14), C.tire, 0, 0.26, -1.08, 0, 0, Math.PI / 2));
  for (const s of [-1, 1]) P.push(part(cyl(0.26, 0.16, 14), C.tire, s * 0.62, 0.26, 0.98, 0, 0, Math.PI / 2));
  // headlight
  P.push(part(cyl(0.09, 0.06, 10), C.light, 0, 0.82, -1.27, Math.PI / 2));

  const geo = mergeGeometries(P);
  const body = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  body.name = 'tuktuk body';

  const group = new THREE.Group();
  group.name = 'tuktuk';
  group.add(body);

  const dashboard = new Dashboard(version);
  dashboard.mesh.position.set(0, 1.134, -0.87);
  dashboard.mesh.rotation.x = -0.45;
  group.add(dashboard.mesh);

  // Seat anchor: origin at the driver's seat on the cab floor. Desktop camera sits at eye height;
  // in VR (stage 4) the XR camera is placed under this anchor with local-floor reference space.
  const seat = new THREE.Group();
  seat.name = 'seat';
  seat.position.set(0, 0.0, -0.05);
  group.add(seat);

  return { group, dashboard, seat, triangles: geo.attributes.position.count / 3 };
}

// Dashboard panel: speed, optional FPS counter, message line, OSM attribution, build version.
export class Dashboard {
  constructor(version = '') {
    this.version = version;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512; this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.21), new THREE.MeshBasicMaterial({ map: this.texture }));
    this.mesh.name = 'dashboard';
    this.showFps = false;
    this.draw({ speed: 0, fps: 0, calls: 0, tris: 0 });
  }
  // msg: optional text for the message line (msgColor defaults to orange)
  draw({ speed, fps, calls, tris, msg = '', msgColor = '#ff9f43' }) {
    const g = this.ctx, W = 512, H = 256;
    g.fillStyle = '#10161c'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#f2c230'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
    g.fillStyle = '#ffffff'; g.font = 'bold 96px system-ui, sans-serif'; g.textBaseline = 'alphabetic';
    g.textAlign = 'right'; g.fillText(String(Math.round(Math.abs(speed) * 3.6)), 190, 118);
    g.textAlign = 'left'; g.font = 'bold 34px system-ui, sans-serif'; g.fillStyle = '#f2c230'; g.fillText('km/h', 200, 116);
    if (speed < -0.1) { g.fillStyle = '#ff8a5c'; g.fillText('R', 290, 116); }
    if (this.showFps) {
      g.textAlign = 'right';
      g.fillStyle = fps >= 70 ? '#6fe06f' : fps >= 55 ? '#ffd166' : '#ff5c5c';
      g.font = 'bold 40px system-ui, sans-serif'; g.fillText(`${Math.round(fps)} FPS`, W - 20, 62);
      g.font = '20px system-ui, sans-serif'; g.fillStyle = '#9fb3c8';
      g.fillText(`${calls} calls · ${(tris / 1000).toFixed(0)}k tris`, W - 20, 96);
    }
    if (msg) {
      g.textAlign = 'center'; g.fillStyle = msgColor;
      let size = 34;
      do { g.font = `bold ${size}px system-ui, sans-serif`; size -= 2; } while (g.measureText(msg).width > W - 40 && size > 16);
      g.fillText(msg, W / 2, 178);
    }
    g.textAlign = 'left'; g.font = '22px system-ui, sans-serif'; g.fillStyle = '#9fb3c8';
    g.fillText('© OpenStreetMap contributors', 20, H - 22);
    if (this.version) {
      g.textAlign = 'right'; g.font = '18px system-ui, sans-serif'; g.fillStyle = '#6f8396';
      g.fillText('v' + this.version, W - 18, H - 22);
    }
    this.texture.needsUpdate = true;
  }
}
