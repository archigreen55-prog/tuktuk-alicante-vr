// Textured materials for the city (stage 5 plan, section 2). All three stay MeshLambertMaterial
// (same lighting and fog); onBeforeCompile only replaces how the surface colour is computed, so the
// meshes and draw calls do not change.
//   facades: per-vertex building index + (u along the facade, bay width, wall kind, wall height);
//            per-building parameters in a small float table texture; tiles from the facade array.
//   roads:   (along, across, half width, marking fade) + template -> asphalt / paving / markings.
//   plazas:  paving, or the Explanada mosaic in promenade coordinates.
import * as THREE from 'three';
import { F, G, BAY_W, MARK_PERIOD, MOSAIC_ALONG, MOSAIC_ACROSS } from './tiles.js';

export const PARAPET_H = 0.9;
// shutter / blind / door colours (index in the building table): green, brown, white, grey, dark green, blue-grey
export const SHUTTER_COLORS = [0x3e6b48, 0x6b4a2e, 0xece6da, 0x8a9097, 0x2f4f3a, 0x6f8a9a];
export const TABLE_W = 64;

// Per-building table: one RGBA float texel = (style, ground floor height, floor height, shutter index).
export function buildBuildingTable(buildings, layouts) {
  const rows = Math.ceil(buildings.length / TABLE_W);
  const data = new Float32Array(TABLE_W * rows * 4);
  buildings.forEach((b, i) => {
    const L = layouts[i];
    data[i * 4] = b.s || 0; data[i * 4 + 1] = L.gH; data[i * 4 + 2] = L.fH; data[i * 4 + 3] = L.shutter;
  });
  const tex = new THREE.DataTexture(data, TABLE_W, rows, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// Vertical layout of a building from its height and level count (build-city writes h = 4 + 3(lv-1) + 0.9).
export function buildingLayout(b, styleName) {
  const h = b.h;
  let lv = b.lv || Math.max(1, Math.round((h - 1.9) / 3));
  let gH = styleName === 'old' ? 3.2 : 4.0;
  if (h - gH - PARAPET_H < 2.4) lv = 1;
  let fH = 3.0, floors = 0;
  if (lv === 1) gH = Math.max(2.4, h - PARAPET_H);
  else { fH = THREE.MathUtils.clamp((h - gH - PARAPET_H) / (lv - 1), 2.5, 4.6); floors = Math.max(0, Math.round((h - gH - PARAPET_H) / fH)); }
  return { gH, fH, floors };
}

const GLSL_COMMON = /* glsl */ `
float ihash(int a, int b, int c) {
  uint h = uint(a + 7) * 374761393u + uint(b + 13) * 668265263u + uint(c + 1000) * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u; h ^= h >> 16u;
  return float(h & 0xffffu) / 65535.0;
}`;

const glslConsts = (obj) => Object.entries(obj).map(([k, v]) => `const float ${k} = ${v}.0;`).join('\n');

// ---------- facades ----------
const FACADE_VERTEX_PARS = /* glsl */ `
attribute float aBld;
attribute vec4 aWall;
uniform sampler2D uTable;
flat varying vec4 vBld;
flat varying float vBi;
varying vec4 vWall;
varying vec3 vWPos;`;
const FACADE_VERTEX = /* glsl */ `
int bi = int(aBld + 0.5);
vBld = texelFetch(uTable, ivec2(bi & ${TABLE_W - 1}, bi >> ${Math.log2(TABLE_W)}), 0);
vBi = aBld;
vWall = aWall;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`;

const FACADE_FRAGMENT_PARS = /* glsl */ `
uniform highp sampler2DArray uTiles;
uniform vec3 uSky;
uniform vec3 uMetal;
uniform vec3 uGlass;
uniform vec3 uShutters[${SHUTTER_COLORS.length}];
flat varying vec4 vBld;
flat varying float vBi;
varying vec4 vWall;
varying vec3 vWPos;
${glslConsts(F)}
const float PARAPET_M = ${PARAPET_H};
const float BAY = ${BAY_W};
${GLSL_COMMON}
// ground floor tile by style and street class (1 back/courtyard, 2 residential, 3 main street)
float groundLayer(int style, int cls, float r) {
  if (cls <= 1) return (style == 5) ? CIVIC_WALL : GROUND_WIN;
  if (style == 5) return (cls == 3 && r < 0.6) ? CIVIC_GROUND : (r < 0.5 ? CIVIC : CIVIC_WALL);
  if (style == 4 || style == 3) return cls == 3 ? GLASS_GROUND : (r < 0.5 ? GLASS_GROUND : GARAGE);
  if (style == 2) return r < 0.55 ? ENTRANCE : (r < 0.8 ? GROUND_WIN : SHOP_A);
  if (cls == 3) return r < 0.55 ? SHOP_A : (r < 0.75 ? SHOP_B : (r < 0.88 ? ENTRANCE : SHOP_C));
  return r < 0.35 ? ENTRANCE : (r < 0.5 ? GARAGE : (r < 0.78 ? GROUND_WIN : SHOP_A));
}
float floorLayer(int style, int cls, bool bal3d, float r) {
  if (cls <= 1) return r < 0.7 ? COURT : PLAIN;
  if (style == 0) return bal3d ? (r < 0.6 ? ENS_DOOR_A : ENS_DOOR_B) : (r < 0.35 ? ENS_A : (r < 0.55 ? ENS_B : (r < 0.7 ? ENS_C : ENS_BAL)));
  if (style == 1) return bal3d ? CLS_DOOR : (r < 0.6 ? CLS_A : CLS_B);
  if (style == 2) return r < 0.6 ? OLD_A : OLD_B;
  if (style == 3) return r < 0.85 ? TOWER : TOWER_B;
  if (style == 4) return OFFICE;
  return r < 0.7 ? CIVIC : CIVIC_WALL;
}
vec3 facadeColor(vec3 plaster, vec3 viewNormal, vec3 viewDir) {
  int k = int(vWall.z + 0.5);
  int style = int(vBld.x + 0.5);
  float gH = vBld.y, fH = vBld.z;
  vec3 shutter = uShutters[int(vBld.w + 0.5) % ${SHUTTER_COLORS.length}];
  float y = vWPos.y, h = vWall.w, u = vWall.x, bw = max(vWall.y, 0.1);
  int bi = int(vBi + 0.5);
  float layer; vec2 uv;
  if (vWall.z < -0.5) { layer = ROOF; uv = vWPos.xz / 3.0; }
  else if (k == 0 || bw < 1.2) { layer = PLAIN; uv = vec2(u / BAY, y / 3.0); }
  else {
    int cls = k & 7;
    bool bal3d = (k & 8) != 0;
    int bay = int(floor(u / bw));
    float ub = u / bw;
    if (y > h - PARAPET_M) { layer = (style == 1 || style == 2 || style == 5) ? CORNICE : PARAPET; uv = vec2(ub, (y - (h - PARAPET_M)) / PARAPET_M); }
    else if (y < gH) { layer = groundLayer(style, cls, ihash(bi, bay, -1)); uv = vec2(ub, y / gH); }
    else { float f = floor((y - gH) / fH); layer = floorLayer(style, cls, bal3d, ihash(bi, bay, int(f))); uv = vec2(ub, (y - gH) / fH); }
  }
  vec4 t = texture(uTiles, vec3(uv, layer));
  float shade = t.r * 1.275;
  float wPl = t.g, wSh = t.b, wGl = t.a;
  float wMe = max(0.0, 1.0 - wPl - wSh - wGl);
  float fres = pow(1.0 - clamp(dot(viewNormal, viewDir), 0.0, 1.0), 3.0);
  vec3 glass = mix(uGlass, uSky, 0.3 + 0.6 * fres);
  return shade * (wPl * plaster + wSh * shutter + wGl * glass + wMe * uMetal);
}`;
const FACADE_FRAGMENT = /* glsl */ `
diffuseColor.rgb *= facadeColor(vColor.rgb, normalize(vNormal), normalize(vViewPosition)); // vColor = plaster`;

// ---------- roads / sidewalks ----------
export const TPL = { ASPHALT: 0, MARK: 1 /* 1..6 = G.M2W2..G.M2W4 */, ZEBRA: 7, SIDEWALK: 10, PED: 11, COBBLE: 12 };
export const MARK_TEMPLATES = { M2W2: 1, M1W1: 2, M1W2: 3, M1W3: 4, M1W4: 5, M2W4: 6 }; // template -> layer = G.M2W2 - 1 + tpl

const ROAD_VERTEX_PARS = /* glsl */ `
attribute vec4 aRoad;
attribute float aTpl;
varying vec4 vRoad;
flat varying float vTpl;
varying vec3 vWPos;`;
const ROAD_VERTEX = /* glsl */ `
vRoad = aRoad; vTpl = aTpl;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
const ROAD_FRAGMENT_PARS = /* glsl */ `
uniform highp sampler2DArray uGround;
varying vec4 vRoad;
flat varying float vTpl;
varying vec3 vWPos;
${glslConsts(G)}
const vec3 MARK_COL = vec3(0.93, 0.93, 0.9);
const vec3 KERB_COL = vec3(0.78, 0.76, 0.72);
vec3 roadColor(vec3 tint) {
  int tpl = int(vTpl + 0.5);
  vec2 wp = vWPos.xz;
  if (tpl == ${TPL.SIDEWALK}) {
    vec3 c = texture(uGround, vec3(wp / 2.0, PAVING)).rgb * 1.3 * tint;
    float a = abs(vRoad.y), hw = vRoad.z;
    float kerb = smoothstep(hw - 0.04, hw + 0.04, a) * (1.0 - smoothstep(hw + 0.22, hw + 0.3, a));
    return mix(c, KERB_COL, kerb * 0.9);
  }
  if (tpl == ${TPL.PED}) return texture(uGround, vec3(wp / 3.0, PAVING_PED)).rgb * 1.3 * tint;
  if (tpl == ${TPL.COBBLE}) return texture(uGround, vec3(wp / 2.0, COBBLE)).rgb * 1.3 * tint;
  vec3 asphalt = texture(uGround, vec3(wp / 7.0, ASPHALT)).rgb * 1.3 * tint;
  asphalt *= 0.8 + 0.4 * texture(uGround, vec3(wp / 43.0, ASPHALT)).r * 1.3;
  if (tpl >= 1 && tpl <= 6) {
    vec4 m = texture(uGround, vec3(vRoad.x / ${MARK_PERIOD}.0, vRoad.y / vRoad.z * 0.5 + 0.5, M2W2 - 1.0 + float(tpl)));
    return mix(asphalt, MARK_COL, m.a * vRoad.w * 0.9);
  }
  if (tpl == ${TPL.ZEBRA}) {
    vec4 m = texture(uGround, vec3(vRoad.y, vRoad.x, ZEBRA));
    return mix(asphalt, MARK_COL, m.a * 0.9);
  }
  return asphalt;
}`;
const ROAD_FRAGMENT = /* glsl */ `
diffuseColor.rgb *= roadColor(vColor.rgb);`;

// ---------- plazas ----------
const PLAZA_VERTEX_PARS = /* glsl */ `
attribute float aKind;
flat varying float vKind;
varying vec3 vWPos;`;
const PLAZA_VERTEX = /* glsl */ `
vKind = aKind;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
const PLAZA_FRAGMENT_PARS = /* glsl */ `
uniform highp sampler2DArray uGround;
uniform sampler2D uMosaic;
uniform vec4 uExplanada; // centre x, centre z, cos(axis), sin(axis)
flat varying float vKind;
varying vec3 vWPos;
${glslConsts(G)}
vec3 plazaColor(vec3 tint) {
  vec2 wp = vWPos.xz;
  if (vKind > 0.5 && vKind < 1.5) {
    vec2 d = wp - uExplanada.xy;
    vec2 q = vec2(d.x * uExplanada.z + d.y * uExplanada.w, -d.x * uExplanada.w + d.y * uExplanada.z); // along, across
    return texture(uMosaic, vec2(q.x / ${MOSAIC_ALONG}.0, q.y / ${MOSAIC_ACROSS}.0)).rgb;
  }
  return texture(uGround, vec3(wp / 3.0, PAVING_PED)).rgb * 1.3 * tint;
}`;
const PLAZA_FRAGMENT = /* glsl */ `
diffuseColor.rgb *= plazaColor(vColor.rgb);`;

// Injects the chunks into a MeshLambertMaterial. uniforms: { name: { value } }.
function textured(material, { vertexPars, vertex, fragmentPars, fragment, uniforms }, key) {
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${vertexPars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertex}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragmentPars}`)
      .replace('#include <color_fragment>', fragment); // replaces diffuseColor *= vColor
  };
  material.customProgramCacheKey = () => key;
  return material;
}

export function facadeMaterial(tiles, table, sky) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return textured(mat, {
    vertexPars: FACADE_VERTEX_PARS, vertex: FACADE_VERTEX, fragmentPars: FACADE_FRAGMENT_PARS, fragment: FACADE_FRAGMENT,
    uniforms: {
      uTiles: { value: tiles.facade }, uTable: { value: table },
      uSky: { value: new THREE.Color(sky).multiplyScalar(0.9) },
      uMetal: { value: new THREE.Color(0x8e9195) },
      uGlass: { value: new THREE.Color(0x2c3a46) },
      uShutters: { value: SHUTTER_COLORS.map((c) => new THREE.Color(c)) },
    },
  }, 'facade');
}
export function roadMaterial(tiles) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false });
  return textured(mat, { vertexPars: ROAD_VERTEX_PARS, vertex: ROAD_VERTEX, fragmentPars: ROAD_FRAGMENT_PARS, fragment: ROAD_FRAGMENT, uniforms: { uGround: { value: tiles.ground } } }, 'road');
}
export function plazaMaterial(tiles, explanada) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false });
  const e = explanada || { centre: [0, 0], axis: 0 };
  return textured(mat, {
    vertexPars: PLAZA_VERTEX_PARS, vertex: PLAZA_VERTEX, fragmentPars: PLAZA_FRAGMENT_PARS, fragment: PLAZA_FRAGMENT,
    uniforms: { uGround: { value: tiles.ground }, uMosaic: { value: tiles.mosaic }, uExplanada: { value: new THREE.Vector4(e.centre[0], e.centre[1], Math.cos(e.axis), Math.sin(e.axis)) } },
  }, 'plaza');
}
