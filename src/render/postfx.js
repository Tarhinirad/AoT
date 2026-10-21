import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ATMOS } from './atmosphere.js';

/**
 * Linear-HDR colour grade: warm highlights, cool shadows, a touch of contrast,
 * sun shafts, vignette, and a little dither against banding in the sky.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    tShafts: { value: null },
    uShafts: { value: 0 },
    uVignette: { value: 0.9 },
    uSaturation: { value: 1.05 },
    uContrast: { value: 1.08 },
    uHurt: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse, tShafts; uniform float uVignette, uSaturation, uContrast, uHurt, uShafts; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c += texture2D(tShafts, vUv).rgb * uShafts;
      // Contrast pivots on mid grey in linear light, so highlights keep their range.
      c = pow(max(c, 0.0) / 0.18, vec3(uContrast)) * 0.18;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= mix(vec3(0.92, 0.97, 1.07), vec3(1.06, 1.0, 0.92), smoothstep(0.05, 0.9, l));
      c = mix(vec3(l), c, uSaturation);
      vec2 d = vUv - 0.5;
      float v = dot(d, d);
      c *= 1.0 - v * uVignette;
      // Desaturate toward the edges when badly hurt.
      c = mix(c, vec3(l) * vec3(1.1, 0.8, 0.75), uHurt * smoothstep(0.05, 0.35, v) * 0.7);
      float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      c *= 1.0 + (n - 0.5) * 0.02;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

/**
 * Screen-space sun shafts at quarter resolution: keep only the very bright
 * pixels around the sun (sky glow and the disc, so rooftops and towers carve
 * dark gaps), then smear them toward the sun in two radial-blur passes. The
 * grade pass adds the result, so this costs no extra full-resolution pass.
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
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
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
 * Optional post-processing chain: scene → bloom → sun shafts → grade → tone map + sRGB.
 * Without it (low quality) the renderer tone maps directly.
 */
export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.enabled = false;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
  }

  setEnabled(on, { msaa = 4, bloom = true, shafts = true } = {}) {
    this._dispose();
    this.enabled = on;
    if (!on) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: msaa });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.55, 0.92);
      composer.addPass(this.bloom);
    }
    this.grade = new ShaderPass(GradeShader);
    if (shafts) {
      this.shafts = new SunShaftsPass(this.camera, this.grade.uniforms);
      composer.addPass(this.shafts);
    }
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
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
    this.shafts = null;
    this.grade = null;
  }

  resize() {
    if (!this.composer) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  setHurt(k) {
    if (this.grade) this.grade.uniforms.uHurt.value = k;
  }

  render(dt) {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
