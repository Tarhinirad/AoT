import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SCRUB_HDR_GLSL } from './shaderFixes.js';

/**
 * Linear-HDR colour grade: warm highlights, cool shadows, a touch of contrast,
 * vignette. Spliced into the OutputPass shader ahead of tone mapping so the
 * grade costs no extra full-screen pass.
 */
const GRADE_UNIFORMS = {
  uVignette: { value: 0.9 },
  uSaturation: { value: 1.08 },
  uHurt: { value: 0 },
};
const GRADE_GLSL = `
      {
        vec3 c = gl_FragColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c *= mix(vec3(0.93, 0.97, 1.06), vec3(1.05, 1.0, 0.93), smoothstep(0.05, 0.9, l));
        c = mix(vec3(l), c, uSaturation);
        vec2 d = vUv - 0.5;
        float v = dot(d, d);
        c *= 1.0 - v * uVignette;
        // Desaturate toward the edges when badly hurt.
        c = mix(c, vec3(l) * vec3(1.1, 0.8, 0.75), uHurt * smoothstep(0.05, 0.35, v) * 0.7);
        gl_FragColor = vec4(c, 1.0);
      }`;

function createGradedOutputPass() {
  const pass = new OutputPass();
  const mat = pass.material;
  Object.assign(mat.uniforms, GRADE_UNIFORMS);
  mat.fragmentShader = mat.fragmentShader
    .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\n\t\tuniform float uVignette, uSaturation, uHurt;' + SCRUB_HDR_GLSL)
    .replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = vec4( scrubHdr( texture2D( tDiffuse, vUv ).rgb ), 1.0 );' + GRADE_GLSL);
  return pass;
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
