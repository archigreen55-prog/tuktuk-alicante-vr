// VR comfort overlay: tunnel vignette (turns, acceleration, braking, impacts) + fade to black.
// Nitro: the tunnel is at least NITRO_VIGNETTE (whatever the level setting) and speed lines stream
// outwards in the periphery, drawn by the same quad (no extra draw call).
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
export const NITRO_VIGNETTE = 0.6;   // minimum tunnel strength during a nitro burst

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
uniform float uLines;    // 0..1 speed lines (nitro)
uniform float uTime;
varying vec2 vTan;
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  float r = atan(length(vTan));
  float v = smoothstep(uRadius, uRadius + uFeather, r);
  // speed lines: thin radial streaks in 96 angular sectors, each running outwards at its own pace
  float lines = 0.0;
  if (uLines > 0.0) {
    float a = atan(vTan.y, vTan.x) / 6.2831853 * 96.0;
    float k = floor(a), f = fract(a);
    float on = step(0.55, hash(k));                              // about half of the sectors have a streak
    float thin = 1.0 - smoothstep(0.08, 0.22, abs(f - 0.5));     // across the sector: a thin line
    float run = fract(r * 2.2 - uTime * (1.6 + hash(k + 7.0) * 1.4) + hash(k + 3.0));
    float dash = smoothstep(0.0, 0.15, run) * (1.0 - smoothstep(0.35, 0.6, run)); // a dash moving outwards
    float edge = smoothstep(0.35, 0.7, r);                       // periphery only
    lines = uLines * on * thin * dash * edge;
  }
  float alpha = max(max(v, uFade), lines * 0.85);
  vec3 col = mix(vec3(0.0), vec3(0.95, 0.97, 1.0), lines * (1.0 - uFade));
  gl_FragColor = vec4(col, alpha);
}`;

export class ComfortOverlay {
  constructor() {
    this.uniforms = { uRadius: { value: 1 }, uFeather: { value: 0.35 }, uFade: { value: 0 }, uLines: { value: 0 }, uTime: { value: 0 } };
    this.lines = 0;      // 0..1 speed lines, smoothed
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
  flashBlack(seconds) { this.fade = 1; this.fadeRate = 1 / seconds; } // black now, back in `seconds` (crash reset)
  fadeIn(seconds) { this.fade = 1; this.fadeRate = 1 / seconds; }

  // phys: TukTukPhysics; impact: strongest wall hit this frame (m/s); enabled: vignette on at all;
  // tiltRate: rad/s the cab pitch is changing (terrain: a crest or a dip); nitro: a burst is on
  update(dt, phys, impact, enabled, tiltRate = 0, nitro = false) {
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
    // nitro: a strong tunnel even with the vignette switched off (the burst is the hardest motion in the game)
    if (enabled && nitro) target = Math.max(target, NITRO_VIGNETTE);
    this.lines += ((enabled && nitro ? 1 : 0) - this.lines) * (1 - Math.exp(-dt / 0.2));
    if (this.lines < 0.01) this.lines = 0;
    this.uniforms.uLines.value = this.lines;
    this.uniforms.uTime.value += dt;
    // rise in ~0.15 s, fall in ~0.4 s
    const tau = target > this.intensity ? 0.05 : 0.13;
    this.intensity += (target - this.intensity) * (1 - Math.exp(-dt / tau));
    if (this.intensity < 0.005) this.intensity = 0;

    this.fade = Math.max(0, this.fade - this.fadeRate * dt);

    this.uniforms.uRadius.value = 0.95 - 0.65 * this.intensity; // 54° .. 17°
    this.uniforms.uFade.value = this.fade;
    this.mesh.visible = this.intensity > 0 || this.fade > 0 || this.lines > 0;
  }
}
