// Round heading-up minimap left of the dashboard (stage 6). The city map is drawn once into a
// texture (MAP_RES m/px) and the route into a second, coarser one (only when the route changes);
// the disc shader shifts and turns the UVs every frame, so the map turns smoothly at the display
// rate with no canvas redraws. One draw call.
import * as THREE from 'three';
import { pairs } from '../city/geo.js';

const MAP_RES = 1.5;     // m per map pixel
const ROUTE_RES = 3;     // m per route pixel
const COL = { land: '#e6dcc6', sea: '#6fa8cf', park: '#b3d397', plaza: '#efe7d6', mount: '#c9b98f', building: '#c5b79e', road: '#ffffff', roadEdge: '#b9ad97', ped: '#f3ecdf' };

// The static map of the city on a canvas; rect = city.meta.rect (local metres, z = south = down)
export function drawCityMap(city) {
  const R = city.meta.rect;
  const W = Math.ceil((R.maxX - R.minX) / MAP_RES), H = Math.ceil((R.maxZ - R.minZ) / MAP_RES);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const X = (x) => (x - R.minX) / MAP_RES, Z = (z) => (z - R.minZ) / MAP_RES;
  const poly = (flat, fill) => {
    g.beginPath();
    for (let i = 0; i < flat.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, X(flat[i]), Z(flat[i + 1]));
    g.closePath(); g.fillStyle = fill; g.fill();
  };
  g.fillStyle = COL.land; g.fillRect(0, 0, W, H);
  poly(city.sea, COL.sea);
  for (const p of city.parks) poly(p, COL.park);
  for (const pl of city.plazas) poly(Array.isArray(pl) ? pl : pl.p, COL.plaza);
  for (const b of city.buildings) poly(b.p, COL.building);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const road = (r, extra, col) => {
    const pts = pairs(r.p);
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    g.lineWidth = Math.max(1.5, r.w / MAP_RES + extra); g.strokeStyle = col; g.stroke();
  };
  for (const r of city.roads) if (r.k !== 'pedestrian') road(r, 1.6, COL.roadEdge);
  for (const r of city.roads) road(r, 0, r.k === 'pedestrian' ? COL.ped : COL.road);
  return cv;
}

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const fragmentShader = /* glsl */ `
uniform sampler2D uMap, uRoute;
uniform vec4 uRect;        // minX, minZ, width, height (m)
uniform vec3 uView;        // centre x, z, radius (m)
uniform float uHeading;
uniform vec3 uTarget;      // x, z, 1 if shown
uniform float uTime, uRouteOn;
varying vec2 vUv;
vec2 toWorld(vec2 p) {     // disc coords (-1..1, v up = forward) -> world x, z
  float s = sin(uHeading), c = cos(uHeading);
  vec2 right = vec2(c, -s), fwd = vec2(-s, -c);
  return uView.xy + (right * p.x + fwd * p.y) * uView.z;
}
vec2 toDisc(vec2 w) {      // world -> disc coords
  float s = sin(uHeading), c = cos(uHeading);
  vec2 d = (w - uView.xy) / uView.z;
  return vec2(dot(d, vec2(c, -s)), dot(d, vec2(-s, -c)));
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  vec2 w = toWorld(p);
  vec2 uv = vec2((w.x - uRect.x) / uRect.z, 1.0 - (w.y - uRect.y) / uRect.w);
  vec3 col = vec3(0.86, 0.82, 0.74);
  if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
    col = texture2D(uMap, uv).rgb;
    float route = texture2D(uRoute, uv).a * uRouteOn;
    col = mix(col, vec3(1.0, 0.72, 0.0), route);
  }
  // target: pulsing dot, or a mark on the rim when outside the disc
  if (uTarget.z > 0.5) {
    vec2 t = toDisc(uTarget.xy);
    float pulse = 0.5 + 0.5 * sin(uTime * 6.0);
    if (length(t) < 0.9) {
      float d = length(p - t);
      col = mix(col, vec3(0.1, 0.1, 0.1), step(d, 0.075));
      col = mix(col, mix(vec3(1.0, 0.25, 0.1), vec3(1.0, 0.85, 0.2), pulse), step(d, 0.055));
    } else {
      vec2 rim = normalize(t) * 0.9;
      col = mix(col, mix(vec3(1.0, 0.25, 0.1), vec3(1.0, 0.85, 0.2), pulse), step(length(p - rim), 0.07));
    }
  }
  // north mark
  vec2 n = toDisc(uView.xy + vec2(0.0, -1.0) * uView.z);
  col = mix(col, vec3(0.85, 0.15, 0.15), step(length(p - normalize(n) * 0.9), 0.045));
  // player arrow in the centre (points up = forward)
  vec2 q = p;
  float tri = step(-0.07, q.y) * step(q.y, 0.1) * step(abs(q.x), (0.1 - q.y) * 0.45);
  col = mix(col, vec3(0.08, 0.1, 0.12), step(abs(q.x), (0.12 - q.y) * 0.5) * step(-0.09, q.y) * step(q.y, 0.12));
  col = mix(col, vec3(0.2, 0.55, 1.0), tri);
  // rim
  col = mix(col, vec3(0.06, 0.08, 0.1), smoothstep(0.93, 0.96, r));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class Minimap {
  constructor(city) {
    const R = city.meta.rect;
    this.rect = R;
    this.mapCanvas = drawCityMap(city);
    this.mapTex = new THREE.CanvasTexture(this.mapCanvas);
    this.mapTex.colorSpace = THREE.SRGBColorSpace;
    this.mapTex.anisotropy = 4;
    this.routeCanvas = document.createElement('canvas');
    this.routeCanvas.width = Math.ceil((R.maxX - R.minX) / ROUTE_RES);
    this.routeCanvas.height = Math.ceil((R.maxZ - R.minZ) / ROUTE_RES);
    this.routeTex = new THREE.CanvasTexture(this.routeCanvas);
    this.uniforms = {
      uMap: { value: this.mapTex }, uRoute: { value: this.routeTex },
      uRect: { value: new THREE.Vector4(R.minX, R.minZ, R.maxX - R.minX, R.maxZ - R.minZ) },
      uView: { value: new THREE.Vector3(0, 0, 150) }, uHeading: { value: 0 },
      uTarget: { value: new THREE.Vector3(0, 0, 0) }, uTime: { value: 0 }, uRouteOn: { value: 0 },
    };
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(0.085, 48), new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader,
    }));
    this.mesh.name = 'minimap';
    this.radius = 150;
    this.routeVersion = -1;
    this.route = null;
  }

  // Redraw the route layer (only when the route changes). pts: [[x, z], ...] or null
  setRoute(pts, version) {
    if (version === this.routeVersion) return;
    this.routeVersion = version;
    this.route = pts;
    const cv = this.routeCanvas, g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    this.uniforms.uRouteOn.value = pts && pts.length > 1 ? 1 : 0;
    if (pts && pts.length > 1) {
      const R = this.rect;
      g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 3.2; g.strokeStyle = 'rgba(255,190,0,0.95)';
      g.beginPath();
      pts.forEach(([x, z], i) => { const px = (x - R.minX) / ROUTE_RES, pz = (z - R.minZ) / ROUTE_RES; if (i) g.lineTo(px, pz); else g.moveTo(px, pz); });
      g.stroke();
    }
    this.routeTex.needsUpdate = true;
  }

  // every frame: tuk-tuk position / heading / speed, target {x, z} or null
  update(dt, x, z, heading, speed, target) {
    const want = 150 + 150 * Math.min(1, Math.abs(speed) / 11.1);
    this.radius += (want - this.radius) * (1 - Math.exp(-dt / 0.8));
    this.uniforms.uView.value.set(x, z, this.radius);
    this.uniforms.uHeading.value = heading;
    this.uniforms.uTime.value += dt;
    if (target) this.uniforms.uTarget.value.set(target.x, target.z, 1); else this.uniforms.uTarget.value.z = 0;
  }
}
