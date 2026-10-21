import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { SCRUB_HDR_GLSL } from './shaderFixes.js';
import { ATMOS } from './atmosphere.js';

/**
 * Linear-HDR colour grade: sun shafts, a gentle contrast curve, warm
 * highlights, cool shadows, vignette, and a little dither against banding in
 * the sky. Spliced into the OutputPass shader ahead of tone mapping so the
 * grade costs no extra full-screen pass.
 */
const GRADE_UNIFORMS = {
  uVignette: { value: 0.9 },
  uSaturation: { value: 1.05 },
  uContrast: { value: 1.08 },
  uHurt: { value: 0 },
  tShafts: { value: null },
  uShafts: { value: 0 },
};
const GRADE_GLSL = `
      {
        vec3 c = gl_FragColor.rgb;
        if (uShafts > 0.0) c += texture2D(tShafts, vUv).rgb * uShafts;
        // Contrast pivots on mid grey in linear light, so highlights keep their range.
        c = pow(c / 0.18, vec3(uContrast)) * 0.18;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c *= mix(vec3(0.93, 0.97, 1.06), vec3(1.05, 1.0, 0.93), smoothstep(0.05, 0.9, l));
        c = mix(vec3(l), c, uSaturation);
        vec2 d = vUv - 0.5;
        float v = dot(d, d);
        c *= 1.0 - v * uVignette;
        // Desaturate toward the edges when badly hurt.
        c = mix(c, vec3(l) * vec3(1.1, 0.8, 0.75), uHurt * smoothstep(0.05, 0.35, v) * 0.7);
        float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        c *= 1.0 + (n - 0.5) * 0.02;
        gl_FragColor = vec4(c, 1.0);
      }`;

function createGradedOutputPass() {
  const pass = new OutputPass();
  const mat = pass.material;
  Object.assign(mat.uniforms, GRADE_UNIFORMS);
  mat.fragmentShader = mat.fragmentShader
    .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\n\t\tuniform float uVignette, uSaturation, uContrast, uHurt, uShafts;\n\t\tuniform sampler2D tShafts;' + SCRUB_HDR_GLSL)
    .replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = vec4( scrubHdr( texture2D( tDiffuse, vUv ).rgb ), 1.0 );' + GRADE_GLSL);
  return pass;
}

const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

/**
 * Screen-space sun shafts at quarter resolution: keep only the very bright
 * pixels around the sun (sky glow and the disc, so rooftops and towers carve
 * dark gaps), then smear them toward the sun in two radial-blur passes. The
 * grade adds the result, so this costs no extra full-resolution pass, and
 * nothing runs while the sun is off screen.
 */
class SunShaftsPass extends Pass {
  constructor(camera, gradeUniforms) {
    super();
    this.camera = camera;
    this.gradeUniforms = gradeUniforms;
    this.needsSwap = false;
    this.visible = 0;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.sunUv = new THREE.Vector2();
    this.maskMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uSun: { value: this.sunUv }, uAspect: { value: 1 } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uAspect; varying vec2 vUv;
        ${SCRUB_HDR_GLSL}
        void main(){
          vec3 c = scrubHdr(texture2D(tDiffuse, vUv).rgb);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
          float w = exp(-dot(d, d) * 5.0);
          gl_FragColor = vec4(min(c * smoothstep(2.4, 6.0, l), vec3(6.0)) * w, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uSun: { value: this.sunUv }, uStep: { value: 0.5 } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStep; varying vec2 vUv;
        void main(){
          const int N = 20;
          vec2 dt = (uSun - vUv) * (uStep / float(N));
          vec2 uv = vUv;
          vec3 sum = vec3(0.0);
          float decay = 1.0, wsum = 0.0;
          for (int i = 0; i < N; i++) {
            sum += texture2D(tDiffuse, uv).rgb * decay;
            wsum += decay;
            decay *= 0.94;
            uv += dt;
          }
          gl_FragColor = vec4(sum / wsum, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.maskMat);
    this._sun = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
  }

  setSize(w, h) {
    const qw = Math.max(1, Math.round(w / 4)), qh = Math.max(1, Math.round(h / 4));
    this.rtA.setSize(qw, qh);
    this.rtB.setSize(qw, qh);
    this.maskMat.uniforms.uAspect.value = w / Math.max(1, h);
  }

  render(renderer, writeBuffer, readBuffer) {
    const cam = this.camera;
    cam.getWorldDirection(this._fwd);
    const facing = this._fwd.dot(ATMOS.sunDir);
    this._sun.copy(cam.position).addScaledVector(ATMOS.sunDir, 1000).project(cam);
    this.sunUv.set(this._sun.x * 0.5 + 0.5, this._sun.y * 0.5 + 0.5);
    // Fade out as the sun leaves the screen or swings behind the camera.
    const off = Math.max(Math.abs(this._sun.x), Math.abs(this._sun.y));
    this.visible = facing <= 0 ? 0 : THREE.MathUtils.smoothstep(facing, 0, 0.3) * (1 - THREE.MathUtils.smoothstep(off, 1.0, 1.8));
    this.gradeUniforms.tShafts.value = this.rtA.texture;
    this.gradeUniforms.uShafts.value = this.visible > 0.001 ? 0.55 * this.visible : 0;
    if (this.visible <= 0.001) return;
    this.maskMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.quad.material = this.maskMat;
    renderer.setRenderTarget(this.rtA);
    this.quad.render(renderer);
    this.quad.material = this.blurMat;
    this.blurMat.uniforms.tDiffuse.value = this.rtA.texture;
    this.blurMat.uniforms.uStep.value = 0.55;
    renderer.setRenderTarget(this.rtB);
    this.quad.render(renderer);
    this.blurMat.uniforms.tDiffuse.value = this.rtB.texture;
    this.blurMat.uniforms.uStep.value = 0.12;
    renderer.setRenderTarget(this.rtA);
    this.quad.render(renderer);
  }

  dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.maskMat.dispose();
    this.blurMat.dispose();
    this.quad.dispose();
  }
}

/**
 * Render chain used at every quality level: scene → (bloom) → grade + tone
 * map + sRGB. The scene renders into the chain's own target at `scale` (a
 * pixel ratio of CSS pixels) and the final pass stretches it over the canvas,
 * so dynamic resolution never resizes the canvas itself. Resizing a WebGL
 * canvas clears it, which shows as a black flash on many GPUs.
 */
export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
    this.scale = 1;
  }

  /** (Re)build the chain. Low quality has neither MSAA nor bloom but keeps the grade. */
  configure({ msaa = 0, bloom = true } = {}) {
    this._dispose();
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: msaa });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (bloom) {
      // Threshold sits above sunlit walls, cobbles and clouds: three's bloom passes
      // the full colour of anything over it, so a low threshold hazed the whole
      // view when facing the sun. Lanterns, fires and the sun itself still glow.
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.35, 1.4);
      // Scrub NaN/Inf before the blur: one bad pixel would otherwise spread over the screen.
      const hp = this.bloom.materialHighPassFilter;
      hp.fragmentShader = hp.fragmentShader
        .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;' + SCRUB_HDR_GLSL)
        .replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = vec4( scrubHdr( texture2D( tDiffuse, vUv ).rgb ), 1.0 );');
      hp.needsUpdate = true;
      composer.addPass(this.bloom);
    }
    this.grade = createGradedOutputPass();
    const gu = this.grade.material.uniforms;
    gu.uShafts.value = 0;
    gu.tShafts.value = null;
    // Shafts ride along with bloom (medium/high); low quality skips both.
    if (bloom) composer.addPass(new SunShaftsPass(this.camera, gu));
    composer.addPass(this.grade);
    this.composer = composer;
    this.resize();
  }

  _dispose() {
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      for (const p of this.composer.passes) p.dispose?.();
    }
    this.composer = null;
    this.bloom = null;
    this.grade = null;
  }

  /** Internal resolution as a pixel ratio; the canvas keeps its own size. */
  setScale(ratio) {
    if (ratio === this.scale) return;
    this.scale = ratio;
    this.resize();
  }

  resize() {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.scale);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  setHurt(k) {
    if (this.grade) this.grade.material.uniforms.uHurt.value = k;
  }

  render(dt) {
    this.composer.render(dt);
  }
}
