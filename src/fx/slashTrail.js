import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const side = new THREE.Vector3();

/** Two crossing crescent arcs that flash along the travel direction on a slash. */
export class SlashTrail {
  constructor(scene) {
    const geo = new THREE.RingGeometry(1.65, 2.0, 24, 1, -Math.PI * 0.55, Math.PI * 1.1);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xf4fbff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.arcs = [new THREE.Mesh(geo, this.mat), new THREE.Mesh(geo, this.mat)];
    for (const a of this.arcs) {
      a.frustumCulled = false;
      a.visible = false;
      scene.add(a);
    }
    this.t = 0;
    this.dir = new THREE.Vector3(0, 0, -1);
    this.hit = false;
  }

  trigger(pos, dir, hit = false) {
    this.t = 0.18;
    this.hit = hit;
    this.dir.copy(dir).normalize();
    this.pos = pos;
  }

  update(dt, pos) {
    if (this.t <= 0) return;
    this.t -= dt;
    const k = Math.max(0, this.t / 0.18);
    this.mat.opacity = k * (this.hit ? 0.7 : 0.4);
    this.mat.color.setHex(this.hit ? 0xffd9b0 : 0xf4fbff);
    // Arcs lie in planes containing the travel direction, tilted ±35° about it.
    side.crossVectors(this.dir, UP);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    for (let i = 0; i < 2; i++) {
      const a = this.arcs[i];
      a.visible = this.t > 0;
      a.position.copy(pos).addScaledVector(this.dir, 0.8);
      // Ring faces +Z by default: point its normal sideways, then roll.
      tmp.copy(a.position).add(side);
      a.lookAt(tmp);
      a.rotateZ((i === 0 ? 1 : -1) * 0.6 + (1 - k) * (i === 0 ? 1.4 : -1.4));
      a.scale.setScalar(0.9 + (1 - k) * 0.4);
    }
  }
}
