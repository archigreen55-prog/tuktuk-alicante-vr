// VR comfort overlay: tunnel vignette (turns, acceleration, braking, impacts) + fade to black.
// One quad drawn directly in clip space, so each eye gets it centred on its own optical axis with
// no stereo offset and no FOV guessing; the darkening radius is an angle from the view axis.
import * as THREE from 'three';
import { TUNING } from '../vehicle/physics.js';

export const VIGNETTE_LEVELS = [
  { id: 'off', label: 'вимкнено', k: 0 },
  { id: 'weak', label: 'слабко', k: 0.6 },
  { id: 'standard', label: 'стандартно', k: 1 },
  { id: 'strong', label: 'сильно', k: 1.4 },
];
const STORE_KEY = 'tuktuk.vignette';

export function loadVignetteLevel() {
  let id = null;
  try { id = localStorage.getItem(STORE_KEY); } catch { /* storage blocked */ }
  return VIGNETTE_LEVELS.find((l) => l.id === id) || VIGNETTE_LEVELS[2];
}
export function saveVignetteLevel(level) {
  try { localStorage.setItem(STORE_KEY, level.id); } catch { /* storage blocked */ }
}

const vertexShader = /* glsl */ `
varying vec2 vTan;
void main() {
  // tangent of the view angle at this clip-space position, from this eye's projection
  vTan = vec2((position.x + projectionMatrix[2][0]) / projectionMatrix[0][0],
              (position.y + projectionMatrix[2][1]) / projectionMatrix[1][1]);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const fragmentShader = /* glsl */ `
uniform float uRadius;   // angle (rad) from the view axis where the darkening starts
uniform float uFeather;  // angle over which it goes to black
uniform float uFade;     // 0..1 full-screen black
varying vec2 vTan;
void main() {
  float v = smoothstep(uRadius, uRadius + uFeather, atan(length(vTan)));
  gl_FragColor = vec4(0.0, 0.0, 0.0, max(v, uFade));
}`;

export class ComfortOverlay {
  constructor() {
    this.uniforms = { uRadius: { value: 1 }, uFeather: { value: 0.35 }, uFade: { value: 0 } };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader,
      transparent: true, depthTest: false, depthWrite: false,
    }));
    this.mesh.name = 'comfort overlay';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10000;
    this.mesh.visible = false;
    this.level = loadVignetteLevel();
    this.intensity = 0;  // 0..1 vignette strength after smoothing
    this.impactT = 0;    // remaining time of an impact pulse
    this.fade = 0;
    this.fadeRate = 0;   // per second; 0 = hold
  }

  setLevel(level) { this.level = level; saveVignetteLevel(level); }
  cycleLevel() {
    const i = VIGNETTE_LEVELS.indexOf(this.level);
    this.setLevel(VIGNETTE_LEVELS[(i + 1) % VIGNETTE_LEVELS.length]);
    return this.level;
  }

  blackout() { this.fade = 1; this.fadeRate = 0; }                // hold black until fadeIn()
  fadeIn(seconds) { this.fade = 1; this.fadeRate = 1 / seconds; }

  // phys: TukTukPhysics; impact: strongest wall hit this frame (m/s); enabled: vignette on at all;
  // tiltRate: rad/s the cab pitch is changing (terrain: a crest or a dip)
  update(dt, phys, impact, enabled, tiltRate = 0) {
    if (impact > TUNING.impactSlow) this.impactT = 0.35;
    this.impactT = Math.max(0, this.impactT - dt);

    let target = 0;
    if (enabled && this.level.k > 0) {
      const turn = Math.min(1, Math.abs(phys.yawRate) / TUNING.maxYawRate) * 0.5;  // ~0.35 in a normal turn
      const acc = Math.min(1, Math.max(0, Math.abs(phys.accel) - 1.2) / 4.8) * 0.6; // hard braking ≈ 0.6
      const hit = this.impactT > 0 ? 0.7 : 0;
      const tiltV = Math.min(1, tiltRate / 0.44) * 0.5;                              // 25°/s ≈ hard braking
      target = Math.min(1, Math.max(turn, acc, hit, tiltV) * this.level.k);
    }
    // rise in ~0.15 s, fall in ~0.4 s
    const tau = target > this.intensity ? 0.05 : 0.13;
    this.intensity += (target - this.intensity) * (1 - Math.exp(-dt / tau));
    if (this.intensity < 0.005) this.intensity = 0;

    this.fade = Math.max(0, this.fade - this.fadeRate * dt);

    this.uniforms.uRadius.value = 0.95 - 0.65 * this.intensity; // 54° .. 17°
    this.uniforms.uFade.value = this.fade;
    this.mesh.visible = this.intensity > 0 || this.fade > 0;
  }
}
