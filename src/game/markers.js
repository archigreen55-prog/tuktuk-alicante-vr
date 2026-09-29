// The target on the road (stage 6): a glowing zone lying on the road (rim + chevrons running to its
// middle) and a light pillar above it, seen over the rooftops and fading out when close.
// Two transparent draw calls; both hidden when there is no zone.
import * as THREE from 'three';

const COLORS = { pickup: 0xffcc33, stop: 0xffcc33, finish: 0x55dd88, ready: 0x55ee77 };

const zoneVS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const zoneFS = /* glsl */ `
uniform vec3 uColor;
uniform vec2 uSize;     // width, length (m)
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 m = (vUv - 0.5) * uSize;                       // metres from the centre (x across, y along)
  vec2 e = uSize * 0.5 - abs(m);                      // distance to the edges
  float rim = 1.0 - smoothstep(0.35, 0.6, min(e.x, e.y));
  float chev = fract((abs(m.y) + abs(m.x) * 0.6) * 0.5 + uTime * 0.9);   // chevrons towards the middle
  chev = step(0.6, chev) * step(0.9, e.x) * step(0.9, e.y);
  float a = max(rim * 0.95, max(chev * 0.45, 0.14));
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;
const pillarVS = /* glsl */ `
varying float vH;
void main() { vH = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const pillarFS = /* glsl */ `
uniform vec3 uColor;
uniform float uFade;
varying float vH;
void main() {
  float a = pow(1.0 - vH, 1.6) * 0.55 * uFade;
  gl_FragColor = vec4(uColor * a, 1.0);   // additive
  #include <colorspace_fragment>
}`;

export class StopMarker {
  constructor(scene) {
    const zoneGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.zoneU = { uColor: { value: new THREE.Color(COLORS.stop) }, uSize: { value: new THREE.Vector2(6, 14) }, uTime: { value: 0 } };
    this.zone = new THREE.Mesh(zoneGeo, new THREE.ShaderMaterial({
      uniforms: this.zoneU, vertexShader: zoneVS, fragmentShader: zoneFS, transparent: true, depthWrite: false,
    }));
    this.zone.name = 'stop zone';
    this.zone.renderOrder = 5;
    const pillarGeo = new THREE.CylinderGeometry(1.4, 1.4, 40, 20, 1, true).translate(0, 20, 0);
    this.pillarU = { uColor: { value: new THREE.Color(COLORS.stop) }, uFade: { value: 1 } };
    this.pillar = new THREE.Mesh(pillarGeo, new THREE.ShaderMaterial({
      uniforms: this.pillarU, vertexShader: pillarVS, fragmentShader: pillarFS, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.pillar.name = 'light pillar';
    this.pillar.renderOrder = 6;
    this.zone.visible = this.pillar.visible = false;
    scene.add(this.zone, this.pillar);
  }

  // zone: { x, z, d: [dx, dz], len, w, kind, y (ground) } or null; ready: the tuk-tuk stands in it
  update(dt, zone, camPos, ready) {
    const on = !!zone;
    this.zone.visible = this.pillar.visible = on;
    if (!on) return;
    const gy = zone.y || 0;
    this.zone.position.set(zone.x, gy + 0.09, zone.z);
    this.zone.rotation.y = Math.atan2(zone.d[0], zone.d[1]);
    this.zone.scale.set(zone.w, 1, zone.len);
    this.zoneU.uSize.value.set(zone.w, zone.len);
    this.zoneU.uTime.value += dt;
    const col = ready ? COLORS.ready : COLORS[zone.kind] || COLORS.stop;
    this.zoneU.uColor.value.setHex(col);
    this.pillarU.uColor.value.setHex(col);
    this.pillar.position.set(zone.x, gy, zone.z);
    const d = Math.hypot(camPos.x - zone.x, camPos.z - zone.z);
    this.pillarU.uFade.value = Math.min(1, Math.max(0, (d - 12) / 18));
    this.pillar.visible = this.pillarU.uFade.value > 0.01;
  }
}
