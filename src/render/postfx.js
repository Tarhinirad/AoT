import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Linear-HDR colour grade: warm highlights, cool shadows, a touch of contrast, vignette. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.9 },
    uSaturation: { value: 1.08 },
    uHurt: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVignette, uSaturation, uHurt; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= mix(vec3(0.93, 0.97, 1.06), vec3(1.05, 1.0, 0.93), smoothstep(0.05, 0.9, l));
      c = mix(vec3(l), c, uSaturation);
      vec2 d = vUv - 0.5;
      float v = dot(d, d);
      c *= 1.0 - v * uVignette;
      // Desaturate toward the edges when badly hurt.
      c = mix(c, vec3(l) * vec3(1.1, 0.8, 0.75), uHurt * smoothstep(0.05, 0.35, v) * 0.7);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/**
 * Optional post-processing chain: scene → bloom → grade → tone map + sRGB.
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

  setEnabled(on, { msaa = 4, bloom = true } = {}) {
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
