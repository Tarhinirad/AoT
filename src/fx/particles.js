import * as THREE from 'three';

/**
 * Pooled CPU-simulated particles drawn as one THREE.Points with soft round
 * sprites. Used for steam, gas puffs, sparks and dust.
 */
export class Particles {
  constructor(scene, max = 1500) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);
    this.cursor = 0;
    this.active = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, max);
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying float vA; varying vec3 vC; uniform float scale;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float dist = -mv.z;
          // Fade out particles right in front of the lens so bursts never white out the view.
          vA = alpha * smoothstep(0.8, 5.0, dist); vC = color;
          gl_PointSize = alpha > 0.0 ? min(size * scale / max(dist, 0.1), scale * 0.18) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA; varying vec3 vC;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d) * 4.0;
          if (r > 1.0) discard;
          gl_FragColor = vec4(vC, vA * (1.0 - r));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.material = mat;
    scene.add(this.points);
  }

  setViewportHeight(h) {
    this.material.uniforms.scale.value = h * 0.9;
  }

  /**
   * @param {THREE.Vector3} p origin
   * @param {number} count
   * @param {object} o {color, speed, spread, dir, size, grow, life, gravity, drag, alpha, jitter}
   */
  emit(p, count, o = {}) {
    const color = new THREE.Color(o.color ?? 0xffffff);
    const speed = o.speed ?? 5;
    const spread = o.spread ?? 1;
    const life = o.life ?? 1;
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const j = o.jitter ?? 0;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * j;
      this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * j;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * j;
      // random direction blended with dir by (1 - spread)
      let x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, z = Math.random() * 2 - 1;
      const l = Math.hypot(x, y, z) || 1;
      x /= l; y /= l; z /= l;
      if (o.dir) {
        x = o.dir.x * (1 - spread) + x * spread;
        y = o.dir.y * (1 - spread) + y * spread;
        z = o.dir.z * (1 - spread) + z * spread;
      }
      const s = speed * (0.5 + Math.random() * 0.8);
      this.vel[i * 3] = x * s + (o.baseVel?.x ?? 0);
      this.vel[i * 3 + 1] = y * s + (o.baseVel?.y ?? 0);
      this.vel[i * 3 + 2] = z * s + (o.baseVel?.z ?? 0);
      const shade = 0.85 + Math.random() * 0.15;
      this.col[i * 3] = color.r * shade;
      this.col[i * 3 + 1] = color.g * shade;
      this.col[i * 3 + 2] = color.b * shade;
      const lf = life * (0.6 + Math.random() * 0.6);
      this.life[i] = lf;
      this.maxLife[i] = lf;
      this.size[i] = (o.size ?? 1) * (0.7 + Math.random() * 0.6);
      this.grow[i] = o.grow ?? 0;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1;
      this.baseAlpha[i] = o.alpha ?? 0.8;
      this.alpha[i] = this.baseAlpha[i];
    }
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      any = true;
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = Math.max(0, this.size[i] + this.grow[i] * dt);
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.life[i] > 0 ? this.baseAlpha[i] * Math.min(1, t * 2.5) : 0;
    }
    if (any || this._wasAny) {
      const a = this.geo.attributes;
      a.position.needsUpdate = true;
      a.color.needsUpdate = true;
      a.size.needsUpdate = true;
      a.alpha.needsUpdate = true;
    }
    this._wasAny = any;
  }
}
