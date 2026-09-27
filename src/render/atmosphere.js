import * as THREE from 'three';

/**
 * Late-afternoon "golden hour" atmosphere: sun, sky dome with drifting
 * procedural clouds, sun-tinted height fog (patched into every built-in
 * material), and an environment map baked from the sky for PBR ambient light.
 */
export const ATMOS = {
  sunDir: new THREE.Vector3(-0.55, 0.5, 0.68).normalize(),
  sunColor: new THREE.Color(1.0, 0.8, 0.58),
  sunIntensity: 3.8,
  skyTop: new THREE.Color(0x2f63ad),
  skyHorizon: new THREE.Color(0xb9cad6),
  fogColor: new THREE.Color(0xbfc3c0), // horizon haze away from the sun
  fogSunColor: new THREE.Color(0xf2c48c), // haze toward the sun
  hemiSky: 0x9fb8d8,
  hemiGround: 0x6a5840,
};

const v3 = (v) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
const c3 = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

let fogInstalled = false;

/**
 * Replace three's fog chunks: distance fog that is thicker near the ground,
 * and glows warm when looking toward the sun (in-scattering). Must run before
 * any material compiles.
 */
export function installFogChunks() {
  if (fogInstalled) return;
  fogInstalled = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  C.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
  vec3 fogV = vFogWorld - cameraPosition;
  float fogD = length( fogV );
  vec3 fogDir = fogV / max( fogD, 1e-4 );
  float fogLow = exp( - max( vFogWorld.y, 0.0 ) * 0.014 );
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogD * fogD );
  #else
    float fogFactor = smoothstep( fogNear, fogFar * mix( 1.2, 1.0, fogLow ), fogD );
    fogFactor = mix( fogFactor * fogFactor, fogFactor, 0.35 );
    fogFactor = max( fogFactor, fogLow * 0.1 * smoothstep( fogNear, fogFar, fogD ) );
  #endif
  float fogSun = pow( max( dot( fogDir, ${v3(ATMOS.sunDir)} ), 0.0 ), 6.0 );
  vec3 fogCol = mix( fogColor, ${c3(ATMOS.fogSunColor)}, fogSun * 0.85 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;
}

const NOISE_GLSL = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}`;

export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: ATMOS.skyTop.clone() },
      uHorizon: { value: ATMOS.skyHorizon.clone() },
      uFog: { value: ATMOS.fogColor.clone() },
      uFogSun: { value: ATMOS.fogSunColor.clone() },
      uSunColor: { value: ATMOS.sunColor.clone() },
      uSunDir: { value: ATMOS.sunDir.clone() },
      uTime: { value: 0 },
      uEnv: { value: 0 },
    },
    vertexShader: `varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `uniform vec3 uTop, uHorizon, uFog, uFogSun, uSunColor, uSunDir; uniform float uTime, uEnv;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        float sd = max(dot(d, uSunDir), 0.0);
        vec3 sky = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
        sky += uSunColor * (pow(sd, 5.0) * 0.45 + pow(sd, 48.0) * 0.8);
        // The horizon band uses the exact fog formula so geometry melts into the sky.
        vec3 fogCol = mix(uFog, uFogSun, pow(sd, 6.0) * 0.85);
        sky = mix(fogCol, sky, smoothstep(-0.02, 0.2, h));
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.1) * 0.9 + vec2(uTime * 0.006, uTime * 0.0025);
          float n = fbm(uv * 1.4);
          float wisps = fbm(uv * 4.0 + 3.1);
          float cover = smoothstep(0.5, 0.78, n * 0.85 + wisps * 0.25) * smoothstep(0.0, 0.2, h);
          float thick = smoothstep(0.55, 0.9, n);
          vec3 lit = mix(vec3(1.0, 0.95, 0.9), uSunColor * 1.6, pow(sd, 3.0) * 0.8 + 0.15);
          vec3 shade = mix(vec3(0.52, 0.52, 0.62), uFogSun * 0.7, 0.25);
          vec3 cc = mix(lit, shade, thick * 0.75);
          // Silver lining around the sun.
          cc += uSunColor * pow(sd, 12.0) * (1.0 - thick) * 1.5;
          sky = mix(sky, cc, cover * 0.9);
        }
        if (uEnv < 0.5) sky += uSunColor * smoothstep(0.99935, 0.9997, sd) * 40.0;
        gl_FragColor = vec4(sky, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function createSky(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), createSkyMaterial());
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

/** Bake an environment map from the sky (no sun disk) for PBR ambient light. */
export function createEnvironment(renderer) {
  const envScene = new THREE.Scene();
  const mat = createSkyMaterial();
  mat.uniforms.uEnv.value = 1;
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat));
  // A warm ground hemisphere so undersides pick up bounce light from the streets.
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(90, 32, 8, 0, Math.PI * 2, Math.PI / 2 + 0.05, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x5c5040, side: THREE.BackSide }),
  );
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02, 0.1, 400);
  pmrem.dispose();
  mat.dispose();
  return rt.texture;
}
