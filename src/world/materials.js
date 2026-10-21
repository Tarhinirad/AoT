import * as THREE from 'three';
import { ATMOS } from '../render/atmosphere.js';

const v3 = (v) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

/**
 * Procedural PBR materials for the medieval town. Everything is computed in
 * the fragment shader from world or instance-local coordinates, so there are
 * no texture assets: half-timbered facades, ashlar stone, clay-tile and slate
 * roofs, cobbled streets and grass.
 *
 * Patterns fade to their average colour where a pixel covers many
 * centimetres (fwidth), which keeps distant facades from shimmering.
 */

export const GLSL_NOISE = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm3(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.07 + vec2(3.1, 7.7); a *= 0.5; }
  return s / 0.875;
}
float sdBox2(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
// Round-topped (Romanesque) window/door: p relative to the bottom centre.
float sdArch(vec2 p, float hw, float h) {
  float rh = max(h - hw, 0.0);
  float box = sdBox2(p - vec2(0.0, rh * 0.5), vec2(hw, rh * 0.5));
  float circ = length(vec2(p.x, p.y - rh)) - hw;
  return min(box, max(circ, rh - p.y));
}
float fill(float d, float fw) { return 1.0 - smoothstep(-fw, fw, d); }
// Height (metres) written by the pattern functions below, turned into a
// perturbed normal by bumpNormal() so mortar, tiles and cobbles catch the sun.
float gBump = 0.0;
// Derivative bump mapping (Mikkelsen): no tangents or textures needed.
vec3 bumpNormal(vec3 pos, vec3 n, float h, float fd) {
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * fd;
  vec2 dh = vec2(dFdx(h), dFdy(h));
  return normalize(abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2));
}
// Running-bond stone blocks. Returns colour, writes the mortar mask.
vec3 ashlar(vec2 p, vec2 size, vec3 c, float seed, float fw, out float mortar) {
  float row = floor(p.y / size.y);
  vec2 q = vec2(p.x / size.x + 0.5 * mod(row, 2.0) + hash12(vec2(row, seed)) * 0.3, p.y / size.y);
  vec2 id = floor(q), f = fract(q);
  float e = min(min(f.x, 1.0 - f.x) * size.x, min(f.y, 1.0 - f.y) * size.y);
  mortar = (1.0 - smoothstep(0.015, 0.045 + fw, e)) * (1.0 - smoothstep(0.04, 0.12, fw));
  float h = hash12(id + seed * 13.1);
  float grain = vnoise(p * 1.9 + seed);
  vec3 s = c * (0.8 + 0.32 * h) * (0.9 + 0.16 * grain);
  // Pillowed blocks: rounded arrises falling into recessed mortar joints.
  gBump = 0.025 * smoothstep(0.0, 0.1, e) - 0.02 * mortar + 0.012 * grain + 0.01 * h;
  // Chipped, rounded block edges catch less light.
  s *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.12, e)) * (1.0 - smoothstep(0.03, 0.12, fw));
  return mix(s, c * 0.5, mortar);
}
`;

function standard(opts) {
  return new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...opts });
}

/**
 * Building walls. Instanced box (or open cylinder with FACADE_CYL) whose unit
 * geometry spans y 0..1. Per-instance attribute aFacade = (style, seed,
 * plinth height, v offset). Styles: 0 house, 1 stone tower, 2 hall, 3 curtain
 * wall, 4 bell tower, 5 plain stone (chimneys, merlons).
 */
export function createFacadeMaterial({ cylinder = false } = {}) {
  const mat = standard({ color: 0xffffff });
  if (cylinder) mat.defines = { FACADE_CYL: '' };
  mat.customProgramCacheKey = () => 'facade' + (cylinder ? '-cyl' : '');
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aFacade;
        varying vec3 vFObjN; varying vec2 vFUV; varying vec2 vFSize;
        // Per-instance values are flat: interpolation noise in the seed would flip hashed windows per pixel.
        flat varying vec4 vFacade;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 fsc = vec3(1.0);
        #ifdef USE_INSTANCING
          fsc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #endif
        vFObjN = normal;
        vFacade = aFacade;
        vFSize = vec2(fsc.x, fsc.y + aFacade.w);
        #ifdef FACADE_CYL
          float circ = 3.14159265 * fsc.x;
          vFUV = vec2((atan(position.z, position.x) / 6.2831853 + 0.5) * circ, position.y * fsc.y + aFacade.w);
          vFSize = vec2(circ, fsc.y + aFacade.w);
        #else
          if (abs(normal.x) > 0.5) {
            vFUV = vec2((0.5 + position.z * sign(normal.x)) * fsc.z, position.y * fsc.y + aFacade.w);
            vFSize.x = fsc.z;
          } else {
            vFUV = vec2((0.5 - position.x * sign(normal.z)) * fsc.x, position.y * fsc.y + aFacade.w);
          }
        #endif
        if (abs(normal.y) > 0.5) vFUV = position.xz * fsc.xz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFObjN; varying vec2 vFUV; varying vec2 vFSize;
        // Per-instance values are flat: interpolation noise in the seed would flip hashed windows per pixel.
        flat varying vec4 vFacade;
        ${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 fEmis = vec3(0.0);
        float fRough = roughness;
        float fBump = 0.0;
        {
          vec3 base = diffuseColor.rgb;
          int style = int(vFacade.x + 0.5);
          float seed = vFacade.y;
          float plinth = vFacade.z;
          vec2 uv = vFUV;
          float fw = max(length(fwidth(uv)), 1e-4);
          float df = smoothstep(0.05, 0.3, fw); // detail fade with distance
          float mortar;
          if (abs(vFObjN.y) > 0.5) {
            diffuseColor.rgb = ashlar(uv, vec2(1.3, 0.9), base * 0.8, seed, fw, mortar);
            fBump = gBump;
          } else {
            float u = uv.x, v = uv.y, W = vFSize.x, H = vFSize.y;
            vec3 col;
            vec3 stone = (style == 0 || style == 2) ? vec3(0.47, 0.42, 0.36) * (0.9 + 0.2 * hash12(vec2(seed, 3.1))) : base;
            if (style == 3) {
              // Curtain wall: huge weathered blocks, string courses, damp streaks, moss at the foot.
              col = ashlar(uv, vec2(1.9, 0.95), base, seed, fw, mortar);
              fBump = gBump * 1.6;
              float course = fract(v / 12.0) * 12.0;
              fBump += 0.08 * (1.0 - smoothstep(0.55, 0.6 + fw, course));
              col = mix(col, base * 1.12, (1.0 - smoothstep(0.55, 0.6 + fw, course)) * (1.0 - df * 0.5));
              col *= 1.0 - 0.35 * smoothstep(0.6, 0.7, course) * (1.0 - smoothstep(0.7, 1.6, course));
              col *= 0.78 + 0.3 * vnoise(vec2(u * 0.3, v * 0.015 + seed));
              col = mix(col, vec3(0.2, 0.24, 0.13), (1.0 - smoothstep(0.0, 7.0, v)) * 0.55 * vnoise(uv * 0.35));
            } else if (style == 1 || style == 4 || style == 5 || v < plinth) {
              bool tower = style == 1 || style == 4;
              col = ashlar(uv, tower ? vec2(1.05, 0.52) : vec2(0.75, 0.38), stone, seed, fw, mortar);
              fBump = gBump;
              if (tower) {
                // Lancet windows, one per bay on alternate floors.
                float fh = 4.2;
                float fl = floor(v / fh);
                float nb = max(1.0, floor(W / 3.8 + 0.5));
                float bw = W / nb;
                float bi = floor(u / bw);
                vec2 wp = vec2(u - (bi + 0.5) * bw, v - fl * fh - 1.3);
                float has = step(0.5, hash12(vec2(bi, fl) + seed * 3.7)) * step(fh, v) * step(v, H - 4.0);
                float d = sdArch(wp, 0.32, 1.9);
                float win = has * fill(d, fw);
                float surround = has * fill(abs(d - 0.12) - 0.1, fw);
                col = mix(col, stone * 1.15, surround * (1.0 - df));
                fBump = mix(fBump, 0.05, surround);
                fBump = mix(fBump, -0.3, win);
                float lit = step(0.9, hash12(vec2(bi * 3.1, fl) + seed));
                col = mix(col, mix(vec3(0.03, 0.03, 0.035), vec3(0.9, 0.5, 0.2), lit * 0.5), win);
                fEmis += win * lit * vec3(1.0, 0.5, 0.18) * 1.0 * (1.0 - df * 0.6);
                if (style == 4) {
                  // Belfry: tall open arches near the top of the bell tower, with louvres.
                  vec2 bp = vec2(u - W * 0.5, v - (H - 13.0));
                  float bd = sdArch(bp, 1.5, 8.0);
                  float bel = fill(bd, fw);
                  float louv = step(0.5, fract(bp.y * 2.2)) * step(bp.y, 5.5);
                  col = mix(col, stone * 1.18, fill(abs(bd - 0.25) - 0.22, fw));
                  col = mix(col, mix(vec3(0.02), vec3(0.16, 0.1, 0.06), louv), bel);
                  fBump = mix(fBump, -0.4 + 0.08 * louv, bel);
                }
              } else if (style != 5) {
                // House ground floor: arched door and small shop windows.
                float nb = max(1.0, floor(W / 2.6 + 0.5));
                float bw = W / nb;
                float bi = floor(u / bw);
                float bx = u - (bi + 0.5) * bw;
                float doorBay = floor(hash12(vec2(seed, 9.7)) * nb);
                if (bi == doorBay && hash12(vec2(seed, 1.3)) < 0.75) {
                  float d = sdArch(vec2(bx, v), 0.62, 2.55);
                  float door = fill(d, fw);
                  float planks = 0.85 + 0.15 * step(0.12, fract(bx * 3.2 + 0.5));
                  vec3 dc = vec3(0.24, 0.14, 0.08) * planks * (0.85 + 0.2 * vnoise(vec2(bx * 8.0, v * 0.5)));
                  col = mix(col, stone * 0.8, fill(abs(d - 0.1) - 0.1, fw) * (1.0 - df));
                  col = mix(col, dc, door);
                  fBump = mix(fBump, -0.18 + 0.012 * planks, door);
                } else {
                  float d = sdArch(vec2(bx, v - 0.95), 0.42, 1.35);
                  float win = fill(d, fw);
                  float lit = step(0.88, hash12(vec2(bi, 5.0) + seed));
                  col = mix(col, stone * 0.75, fill(abs(d - 0.08) - 0.08, fw) * (1.0 - df));
                  vec3 gl = mix(vec3(0.04, 0.05, 0.06), vec3(0.95, 0.6, 0.28), lit * 0.55);
                  float bars = (1.0 - smoothstep(0.03, 0.03 + fw, abs(bx))) * (1.0 - smoothstep(0.012, 0.035, fw));
                  col = mix(col, mix(gl, vec3(0.12, 0.08, 0.05), bars), win);
                  fBump = mix(fBump, -0.2 + 0.1 * bars, win);
                  fEmis += win * (1.0 - bars) * lit * vec3(1.0, 0.55, 0.2) * 0.9;
                  fRough = mix(fRough, 0.2, win * (1.0 - lit));
                }
              }
            } else {
              // Half-timbered upper floors: posts, beams, braces, windows with shutters.
              bool hall = style == 2;
              float lv = v - plinth;
              float fh = hall ? 3.9 : 3.0;
              float fl = floor(lv / fh);
              float fy = lv - fl * fh;
              float nb = max(1.0, floor(W / (hall ? 4.2 : 3.3) + 0.5));
              float bw = W / nb;
              float bi = floor(u / bw);
              float bx = u - bi * bw;
              float rnd = hash12(vec2(bi, fl) + seed * 7.13);
              float tfw = fw + 0.005;
              float t = 1.0 - smoothstep(0.13 - tfw, 0.13 + tfw, min(bx, bw - bx));
              t = max(t, 1.0 - smoothstep(0.12 - tfw, 0.12 + tfw, min(fy, fh - fy)));
              t = max(t, 1.0 - smoothstep(0.2 - tfw, 0.2 + tfw, H - v));
              float hasWin = step(0.4, rnd);
              float hw = min(hall ? 0.72 : 0.52, bw * 0.24), wh = hall ? 2.0 : 1.35;
              vec2 wp = vec2(bx - bw * 0.5, fy - 0.9);
              float dW = sdBox2(wp - vec2(0.0, wh * 0.5), vec2(hw, wh * 0.5));
              float winM = hasWin * fill(dW, fw);
              float frameM = hasWin * fill(abs(dW) - 0.07, fw);
              t = max(t, hasWin * (1.0 - smoothstep(0.07 - tfw, 0.07 + tfw, abs(fy - 0.78))));
              // Braces: an X in blind bays, K-struts under the sill otherwise.
              float L = sqrt(bw * bw + fh * fh);
              float d1 = abs(fy * bw - bx * fh) / L, d2 = abs(fy * bw - (bw - bx) * fh) / L;
              t = max(t, (1.0 - hasWin) * (1.0 - smoothstep(0.08 - tfw, 0.08 + tfw, min(d1, d2))));
              float sx = min(bx, bw - bx), sL = sqrt(0.49 + 0.6);
              float ds = abs(fy * 0.7 - sx * 0.78) / sL;
              t = max(t, hasWin * step(fy, 0.78) * step(sx, 0.7) * (1.0 - smoothstep(0.07 - tfw, 0.07 + tfw, ds)));
              vec3 plaster = base * (0.9 + 0.12 * vnoise(uv * 0.9 + seed)) * (1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.6, fy)));
              vec3 wood = vec3(0.16, 0.1, 0.062) * (0.8 + 0.4 * vnoise(vec2(u * 3.0, v * 0.35) + seed));
              t *= 1.0 - df * 0.55;
              col = mix(plaster, wood, t);
              // Timbers stand proud of a slightly lumpy lime plaster.
              fBump = 0.006 * vnoise(uv * 7.0 + seed) + 0.035 * t;
              // Shutters
              float hasSh = hasWin * step(0.45, hash12(vec2(bi + 3.1, fl) + seed));
              float shx = abs(wp.x) - hw - 0.06;
              float shM = hasSh * step(0.0, shx) * step(shx, hw * 0.95) * step(0.0, wp.y) * step(wp.y, wh) * (1.0 - df);
              float pick = hash12(vec2(seed, 4.4));
              vec3 shCol = pick < 0.33 ? vec3(0.13, 0.26, 0.17) : pick < 0.66 ? vec3(0.42, 0.12, 0.08) : vec3(0.12, 0.2, 0.32);
              float slat = step(0.5, fract(wp.y * 3.5));
              col = mix(col, shCol * (0.8 + 0.2 * slat), shM);
              col = mix(col, wood * 1.2, frameM * (1.0 - df * 0.5));
              fBump = mix(fBump, 0.03 + 0.008 * slat, shM);
              fBump = mix(fBump, 0.05, frameM);
              float lit = step(0.93, hash12(vec2(bi * 1.7, fl * 2.3) + seed * 1.3));
              float mull = (1.0 - smoothstep(0.03, 0.03 + fw, min(abs(wp.x), abs(wp.y - wh * 0.55)))) * (1.0 - smoothstep(0.012, 0.035, fw));
              vec3 glass = mix(vec3(0.05, 0.065, 0.08), vec3(0.95, 0.6, 0.28), lit * 0.6);
              float glassM = winM * (1.0 - frameM);
              col = mix(col, mix(glass, wood, mull), glassM);
              fBump = mix(fBump, -0.1 + 0.05 * mull, glassM);
              fEmis += glassM * (1.0 - mull) * lit * vec3(1.0, 0.55, 0.2) * 0.9;
              fRough = mix(fRough, 0.15, glassM * (1.0 - lit) * (1.0 - mull));
            }
            // Grime at the foot of the wall and soft occlusion in the corners.
            col *= mix(0.68, 1.0, smoothstep(0.0, 2.5, v));
            #ifndef FACADE_CYL
              col *= mix(0.8, 1.0, smoothstep(0.0, 0.5, min(u, W - u)));
            #endif
            diffuseColor.rgb = col;
          }
          fBump *= 1.0 - df;
        }`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = bumpNormal(-vViewPosition, normal, fBump, faceDirection);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += fEmis;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = fRough;');
  };
  return mat;
}

/**
 * Roofs: clay tiles or slate on instanced gable prisms (ridge along local Z)
 * or cones/pyramids (ROOF_CONE). Instance colour is the tile colour. Gable
 * ends are drawn as timber-framed plaster.
 */
export function createRoofMaterial({ cone = false } = {}) {
  const mat = standard({ color: 0xffffff, roughness: 0.82 });
  if (cone) mat.defines = { ROOF_CONE: '' };
  mat.customProgramCacheKey = () => 'roof' + (cone ? '-cone' : '');
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRP; varying vec3 vRN; flat varying vec3 vRS; flat varying float vRSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 rsc = vec3(1.0);
        vRSeed = 0.0;
        #ifdef USE_INSTANCING
          rsc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vRSeed = fract(instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.291);
        #endif
        vRP = position * rsc; vRN = normal; vRS = rsc;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRP; varying vec3 vRN; flat varying vec3 vRS; flat varying float vRSeed;
        ${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rRough = roughness;
        float rBump = 0.0;
        {
          vec3 base = diffuseColor.rgb;
          float seed = vRSeed * 97.0;
          vec2 tuv;
          bool gableEnd = false;
          #ifdef ROOF_CONE
            float ang = atan(vRP.z, vRP.x);
            float slopeLen = sqrt(0.25 * vRS.x * vRS.x + vRS.y * vRS.y);
            tuv = vec2((ang / 6.2831853 + 0.5) * 3.14159 * vRS.x / 0.34, vRP.y * slopeLen / max(vRS.y, 0.01) / 0.3);
            tuv.x = floor(tuv.x * (1.0 - vRP.y / vRS.y * 0.6)) + fract(tuv.x);
          #else
            // Slope of this face in scaled space (inverse-scale the normal), so tile rows
            // stay ~32 cm apart along the slope on gables and hip ends alike.
            vec3 ns = normalize(vRN / vRS);
            float sinT = max(length(ns.xz), 0.2);
            tuv = vec2((abs(ns.z) > abs(ns.x) ? vRP.x : vRP.z) / 0.3, vRP.y / sinT / 0.32);
            gableEnd = abs(vRN.z) > 0.7 && abs(vRN.y) < 0.1;
          #endif
          vec2 fwv = fwidth(tuv);
          float df = smoothstep(0.25, 0.9, max(fwv.x, fwv.y));
          if (!gableEnd) {
            float row = floor(tuv.y);
            float cx = tuv.x + 0.5 * mod(row, 2.0);
            vec2 id = vec2(floor(cx), row), f = vec2(fract(cx), fract(tuv.y));
            vec3 tc = base * (0.78 + 0.38 * hash12(id + seed));
            tc *= 1.0 - (0.45 * smoothstep(0.55, 1.0, f.y) + 0.3 * (1.0 - smoothstep(0.03, 0.12, min(f.x, 1.0 - f.x)))) * (1.0 - df);
            // Moss and sun-bleaching
            float moss = smoothstep(0.55, 0.85, fbm3(vRP.xz * 0.35 + vRP.y * 0.2 + seed));
            tc = mix(tc, vec3(0.2, 0.24, 0.1), moss * 0.4);
            tc *= mix(0.82, 1.08, clamp(vRP.y / max(vRS.y, 0.01), 0.0, 1.0));
            diffuseColor.rgb = tc;
            // Each course laps over the one below; clay tiles are also rounded across.
            rBump = 0.035 * (1.0 - f.y) + 0.018 * sin(f.x * 3.14159) + 0.006 * hash12(id + seed + 0.5);
            rBump *= 1.0 - moss * 0.5;
          } else {
            // Timber-framed gable end with an attic window.
            float fw = length(fwidth(vRP.xy)) + 0.005;
            float W = vRS.x, H = vRS.y, x = vRP.x, y = vRP.y;
            vec3 plaster = vec3(0.86, 0.8, 0.68) * (0.9 + 0.12 * vnoise(vRP.xy * 0.9 + seed));
            vec3 wood = vec3(0.16, 0.1, 0.062);
            float slope = sqrt(0.25 * W * W + H * H);
            float edge = (H * (1.0 - abs(x) / (0.5 * W)) - y) * (0.5 * W) / slope;
            float t = 1.0 - smoothstep(0.22 - fw, 0.22 + fw, edge);
            t = max(t, 1.0 - smoothstep(0.1 - fw, 0.1 + fw, abs(x)) * step(y, H * 0.3) + 0.0);
            t = max(t, (1.0 - smoothstep(0.09 - fw, 0.09 + fw, abs(y - H * 0.3))));
            t = max(t, 1.0 - smoothstep(0.12 - fw, 0.12 + fw, y));
            float dW = sdBox2(vec2(x, y - H * 0.5), vec2(0.32, 0.42));
            float win = step(3.8, H) * fill(dW, fw);
            float fr = step(3.8, H) * fill(abs(dW) - 0.07, fw);
            vec3 col = mix(plaster, wood, max(t, fr) * (1.0 - df * 0.5));
            rBump = 0.035 * max(t, fr) - 0.12 * win * (1.0 - fr);
            float lit = step(0.7, hash12(vec2(seed, 2.0)));
            col = mix(col, mix(vec3(0.04, 0.05, 0.06), vec3(0.95, 0.6, 0.3), lit * 0.6), win * (1.0 - fr));
            diffuseColor.rgb = col;
            rRough = 0.92;
          }
          rBump *= 1.0 - df;
        }`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = bumpNormal(-vViewPosition, normal, rBump, faceDirection);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = rRough;');
  };
  return mat;
}

/**
 * Ground occlusion map shared by every ground plane: a blurred top-down mask
 * of building, wall and tree footprints (see WorldView). It darkens ambient
 * light where streets meet walls and under the forest canopy.
 * uGroundAOBox = (min x, min z, 1 / size).
 */
export const GROUND_AO = {
  uGroundAO: { value: null },
  uGroundAOBox: { value: new THREE.Vector3(0, 0, 1) },
};

/**
 * Ground planes, patterned in world XZ. kind: 0 grass, 1 cobbled street,
 * 2 market square (fan-laid cobbles), 3 forest floor, 4 flagstone square.
 */
export function createGroundMaterial(kind, color) {
  const mat = standard({ color, roughness: kind === 0 || kind === 3 ? 0.97 : 0.88 });
  mat.defines = { GROUND_KIND: kind };
  mat.customProgramCacheKey = () => 'ground' + kind;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, GROUND_AO);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGW;\nuniform sampler2D uGroundAO;\nuniform vec3 uGroundAOBox;\n${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float gAO = 1.0 - 0.8 * texture2D(uGroundAO, (vGW.xz - uGroundAOBox.xy) * uGroundAOBox.z).r;
        float gH = 0.0;
        {
          vec3 base = diffuseColor.rgb;
          vec2 p = vGW.xz;
          float fw = max(length(fwidth(p)), 1e-4);
          float df = smoothstep(0.04, 0.22, fw);
          vec3 col = base;
          #if GROUND_KIND == 0 || GROUND_KIND == 3
            float n = fbm3(p * 0.045);
            float n2 = vnoise(p * 0.6);
            #if GROUND_KIND == 0
              col = mix(base * vec3(0.8, 0.85, 0.7), base * vec3(1.15, 1.08, 0.8), n);
              col = mix(col, vec3(0.42, 0.4, 0.22), smoothstep(0.62, 0.8, n) * 0.5);
            #else
              col = mix(base * 0.75, vec3(0.3, 0.22, 0.13), smoothstep(0.45, 0.75, n) * 0.6);
            #endif
            col *= 0.9 + 0.2 * mix(n2, 0.5, df);
            gH = 0.05 * n2 + 0.02 * vnoise(p * 3.1) * (1.0 - df);
          #else
            vec2 s = GROUND_KIND == 4 ? vec2(1.5, 1.05) : vec2(0.56, 0.42);
            vec2 q;
            #if GROUND_KIND == 2
              float r = length(p);
              float a = atan(p.y, p.x);
              // Fan-laid cobbles in concentric rings, with a paved border every 9 m.
              q = vec2(a * r / s.x, r / s.y);
            #else
              q = p / s;
            #endif
            float row = floor(q.y);
            q.x += 0.5 * mod(row, 2.0) + hash12(vec2(row, 1.7)) * 0.35;
            vec2 id = floor(q), f = fract(q) - 0.5;
            float d = length(max(abs(f) - vec2(0.33, 0.27), 0.0)) - 0.14;
            float st = 1.0 - smoothstep(-0.03, 0.05, d);
            float h = hash12(id);
            vec3 sc = base * (0.72 + 0.45 * h);
            sc *= 0.92 + 0.14 * (1.0 - length(f) * 1.6);
            col = mix(base * 0.5, sc, st);
            col = mix(col, base * 0.85, df);
            // Domed stones set into sunken joints.
            gH = ((1.0 - smoothstep(-0.12, 0.04, d)) * (0.025 + 0.02 * (1.0 - length(f) * 1.6)) + 0.006 * h) * (1.0 - smoothstep(0.02, 0.1, fw));
            float dirt = fbm3(p * 0.06);
            col = mix(col, vec3(0.3, 0.25, 0.19), smoothstep(0.5, 0.8, dirt) * 0.45);
            #if GROUND_KIND == 2
              float ring = abs(fract(r / 9.0) - 0.5) * 9.0;
              col = mix(col, base * 1.15 * (0.9 + 0.1 * h), (1.0 - smoothstep(0.35, 0.35 + fw, ring)) * step(12.0, r));
            #endif
          #endif
          diffuseColor.rgb = col;
        }`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = bumpNormal(-vViewPosition, normal, gH, faceDirection);')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= gAO;
        reflectedLight.indirectSpecular *= gAO;
        reflectedLight.directDiffuse *= mix(1.0, gAO, 0.5);`);
  };
  return mat;
}

/** Waving cloth for banners: vertex sway pinned at the top edge. */
export function createClothMaterial(opts = {}) {
  const mat = standard({ side: THREE.DoubleSide, roughness: 0.85, ...opts });
  const uTime = { value: 0 };
  mat.userData.uTime = uTime;
  mat.customProgramCacheKey = () => 'cloth';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float ph = 0.0;
          #ifdef USE_INSTANCING
            ph = instanceMatrix[3].x * 0.3 + instanceMatrix[3].z * 0.17;
          #endif
          float k = (1.0 - uv.y);
          transformed.z += sin(uTime * 2.2 + uv.y * 5.0 + ph) * 0.08 * k + sin(uTime * 3.7 + uv.x * 4.0 + ph) * 0.04 * k;
          transformed.x += sin(uTime * 1.3 + ph) * 0.03 * k;
        }`);
  };
  return mat;
}

/**
 * Faceted foliage (cone and blob canopies): darker toward the inside and
 * bottom of each layer, per-tree tint variation, and a warm glow when the
 * sun shines through the leaves toward the camera.
 * yRange: the geometry's local y span (cones 0..1, icosahedra -1..1).
 */
export function createFoliageMaterial({ yRange = [0, 1] } = {}) {
  const mat = standard({ color: 0xffffff, flatShading: true, roughness: 0.9 });
  mat.customProgramCacheKey = () => 'foliage' + yRange.join();
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vLeafY; flat varying vec3 vLeafW;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLeafY = (position.y - ${yRange[0].toFixed(2)}) / ${(yRange[1] - yRange[0]).toFixed(2)};
        vec3 leafOrigin = vec3(0.0);
        #ifdef USE_INSTANCING
          leafOrigin = instanceMatrix[3].xyz;
        #endif
        vLeafW = (modelMatrix * vec4(leafOrigin, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vLeafY; flat varying vec3 vLeafW;
        ${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float leafT = hash12(vLeafW.xz * 0.37);
        diffuseColor.rgb *= mix(vec3(0.92, 1.0, 0.85), vec3(1.08, 1.02, 0.9), leafT);
        diffuseColor.rgb *= mix(0.45, 1.12, smoothstep(0.0, 0.9, vLeafY));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 vd = normalize(vViewPosition);
          vec3 sunV = normalize((viewMatrix * vec4(${v3(ATMOS.sunDir)}, 0.0)).xyz);
          float through = pow(max(dot(vd, sunV), 0.0), 4.0);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.9, 0.5) * through * 0.9 * smoothstep(0.2, 1.0, vLeafY);
        }`);
  };
  return mat;
}

/**
 * Distant mountains: rock strata and snow from noise, sun shading with
 * derivative-bumped ridges, and haze that matches the fog toward the sun.
 */
export function createMountainMaterial({ rock, hMax, snowLine = 0, haze = 0.6 }) {
  return new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      uRock: { value: new THREE.Color(rock) },
      uFog: { value: ATMOS.fogColor.clone() },
      uFogSun: { value: ATMOS.fogSunColor.clone() },
      uSkyTop: { value: ATMOS.skyTop.clone() },
      uSunColor: { value: ATMOS.sunColor.clone() },
      uSunDir: { value: ATMOS.sunDir.clone() },
      uHMax: { value: hMax },
      uSnow: { value: snowLine },
      uHaze: { value: haze },
    },
    vertexShader: `varying vec3 vW; varying vec3 vN;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `uniform vec3 uRock, uFog, uFogSun, uSkyTop, uSunColor, uSunDir; uniform float uHMax, uSnow, uHaze;
      varying vec3 vW; varying vec3 vN;
      ${GLSL_NOISE}
      void main(){
        float hn = clamp(vW.y / uHMax, 0.0, 1.0);
        float big = fbm3(vW.xz * 0.006);
        float gully = fbm3(vec2(atan(vW.z, vW.x) * 180.0, vW.y * 0.02));
        vec3 n = bumpNormal(vW, normalize(vN), (big * 40.0 + gully * 25.0) * (0.4 + hn), 1.0);
        vec3 rock = uRock * (0.7 + 0.45 * big) * (0.85 + 0.3 * vnoise(vec2(vW.y * 0.08, big * 4.0)));
        float snow = uSnow > 0.0 ? smoothstep(uSnow, uSnow + 0.08, hn + 0.18 * (big - 0.5) + 0.1 * (n.y - 0.7)) : 0.0;
        vec3 alb = mix(rock, vec3(0.93, 0.94, 0.97), snow);
        float sunD = max(dot(n, uSunDir), 0.0);
        vec3 col = alb * (uSunColor * 1.35 * sunD + mix(uFog * 0.35, uSkyTop * 0.45, n.y * 0.5 + 0.5));
        vec3 v = vW - cameraPosition;
        vec3 dir = normalize(v);
        float fogSun = pow(max(dot(dir, uSunDir), 0.0), 6.0);
        vec3 fogCol = mix(uFog, uFogSun, fogSun * 0.85);
        float hz = clamp(uHaze * (1.0 - 0.35 * hn) * smoothstep(300.0, 1500.0, length(v)) * 1.15, 0.0, 0.92);
        gl_FragColor = vec4(mix(col, fogCol, hz), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
