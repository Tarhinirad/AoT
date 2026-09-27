import * as THREE from 'three';

const SEGS = 28;
const tmp = new THREE.Vector3();
const axis = new THREE.Vector3();
const perpA = new THREE.Vector3();
const perpB = new THREE.Vector3();
const pt = new THREE.Vector3();
const toCam = new THREE.Vector3();
const side = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const pts = Array.from({ length: SEGS + 1 }, () => new THREE.Vector3());

/**
 * Renders the two ropes as camera-facing ribbons that whip out while the hook
 * flies and twang when it bites, plus hook tips and a ground-truth anchor
 * marker showing exactly where a hook fired now would land.
 */
export class GrappleView {
  constructor(scene) {
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x2e2822, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
    const tipGeo = new THREE.ConeGeometry(0.13, 0.45, 6).rotateX(Math.PI / 2);
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.9, roughness: 0.3 });
    this.ropes = [];
    this.tips = [];
    this.wave = [0, 0];
    this.prevState = ['idle', 'idle'];
    this.t = 0;
    for (let i = 0; i < 2; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array((SEGS + 1) * 2 * 3);
      const nor = new Float32Array((SEGS + 1) * 2 * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
      const idx = [];
      for (let k = 0; k < SEGS; k++) {
        const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
      geo.setIndex(idx);
      const r = new THREE.Mesh(geo, ropeMat);
      r.frustumCulled = false;
      r.castShadow = false;
      const t = new THREE.Mesh(tipGeo, tipMat);
      scene.add(r, t);
      this.ropes.push(r);
      this.tips.push(t);
    }

    // Anchor marker: a ring laid on the surface the crosshair is locked onto.
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 32), this.markerMat);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), this.markerMat);
    const ticks = new THREE.Mesh(tickGeometry(), this.markerMat);
    this.marker.add(ring, dot, ticks);
    this.markerTicks = ticks;
    this.marker.renderOrder = 10;
    for (const c of this.marker.children) c.renderOrder = 10;
    this.marker.visible = false;
    scene.add(this.marker);
  }

  /**
   * @param {object} grapple GrappleSystem
   * @param {THREE.Vector3[]} origins hook launcher positions
   * @param {THREE.Camera} camera
   * @param {object} aim {inRange, point, normal, giant} or null to hide the marker
   * @param {number} dt
   */
  update(grapple, origins, camera, aim, dt) {
    this.t += dt;
    for (let i = 0; i < 2; i++) {
      const h = grapple.hooks[i];
      const rope = this.ropes[i], tip = this.tips[i];
      const visible = h.state !== 'idle';
      rope.visible = tip.visible = visible;
      if (h.state !== this.prevState[i]) {
        if (h.state === 'flying') this.wave[i] = 1;
        else if (h.state === 'attached') this.wave[i] = 0.7; // twang on bite
        this.prevState[i] = h.state;
      }
      this.wave[i] = Math.max(0, this.wave[i] - dt * (h.state === 'flying' ? 1.2 : 4));
      if (!visible) continue;
      const o = origins[i];
      this._buildRope(rope, o, h.tip, camera, h.state === 'flying' ? Math.max(0.35, this.wave[i]) : this.wave[i], i);
      tip.position.copy(h.tip);
      tmp.subVectors(h.tip, o);
      if (tmp.lengthSq() > 1e-6) tip.lookAt(pt.copy(h.tip).add(tmp));
    }

    const m = this.marker;
    m.visible = !!(aim && aim.inRange);
    if (m.visible) {
      m.position.copy(aim.point).addScaledVector(aim.normal, 0.05);
      m.quaternion.setFromUnitVectors(Z, aim.normal);
      // Constant-ish screen size, gentle pulse.
      const d = camera.position.distanceTo(aim.point);
      m.scale.setScalar(Math.max(0.6, d * 0.022) * (1 + Math.sin(this.t * 8) * 0.06));
      this.markerTicks.rotation.z = this.t * 1.5;
      this.markerMat.color.setHex(aim.giant ? (aim.nape ? 0xff4d2e : 0xff8a5c) : 0xffd27a);
    }
  }

  _buildRope(mesh, a, b, camera, wave, seed) {
    axis.subVectors(b, a);
    const len = axis.length();
    if (len < 1e-4) return;
    axis.divideScalar(len);
    perpA.crossVectors(axis, UP);
    if (perpA.lengthSq() < 1e-4) perpA.set(1, 0, 0);
    perpA.normalize();
    perpB.crossVectors(axis, perpA).normalize();
    const amp = wave * Math.min(1.6, len * 0.05);
    const phase = this.t * 38 + seed * 1.7;
    for (let k = 0; k <= SEGS; k++) {
      const s = k / SEGS;
      const env = Math.sin(Math.PI * s) * amp;
      const w1 = Math.sin(s * 9.0 - phase) * env;
      const w2 = Math.cos(s * 6.0 - phase * 0.8) * env * 0.6;
      pts[k].copy(a).addScaledVector(axis, len * s).addScaledVector(perpA, w1).addScaledVector(perpB, w2);
    }
    const pos = mesh.geometry.attributes.position.array;
    const nor = mesh.geometry.attributes.normal.array;
    const cam = camera.position;
    for (let k = 0; k <= SEGS; k++) {
      const p = pts[k];
      const q = pts[k < SEGS ? k + 1 : k];
      const r = pts[k > 0 ? k - 1 : k];
      tmp.subVectors(q, r).normalize();
      toCam.subVectors(cam, p);
      const dc = toCam.length();
      toCam.divideScalar(dc || 1);
      side.crossVectors(tmp, toCam).normalize();
      // Keep at least ~1.5 px wide so distant ropes never vanish.
      const hw = Math.max(0.035, dc * 0.0012);
      const j = k * 6;
      pos[j] = p.x - side.x * hw; pos[j + 1] = p.y - side.y * hw; pos[j + 2] = p.z - side.z * hw;
      pos[j + 3] = p.x + side.x * hw; pos[j + 4] = p.y + side.y * hw; pos[j + 5] = p.z + side.z * hw;
      nor[j] = nor[j + 3] = toCam.x;
      nor[j + 1] = nor[j + 4] = toCam.y;
      nor[j + 2] = nor[j + 5] = toCam.z;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.normal.needsUpdate = true;
  }
}

/** Four small triangular ticks around the ring (rotates for a "locked on" feel). */
function tickGeometry() {
  const p = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const r0 = 0.82, r1 = 1.1, w = 0.12;
    p.push(c * r0, s * r0, 0, c * r1 - s * w, s * r1 + c * w, 0, c * r1 + s * w, s * r1 - c * w, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return g;
}
