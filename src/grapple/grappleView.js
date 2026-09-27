import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const mid = new THREE.Vector3();

/** Renders the two ropes as thin stretched cylinders plus hook tips. */
export class GrappleView {
  constructor(scene) {
    const ropeGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 4, 1, true).translate(0, 0.5, 0);
    const ropeMat = new THREE.MeshBasicMaterial({ color: 0x2b2622 });
    const tipGeo = new THREE.ConeGeometry(0.12, 0.4, 5).rotateX(Math.PI / 2);
    const tipMat = new THREE.MeshLambertMaterial({ color: 0x8c949c });
    this.ropes = [];
    this.tips = [];
    for (let i = 0; i < 2; i++) {
      const r = new THREE.Mesh(ropeGeo, ropeMat);
      r.frustumCulled = false;
      const t = new THREE.Mesh(tipGeo, tipMat);
      scene.add(r, t);
      this.ropes.push(r);
      this.tips.push(t);
    }
  }

  update(grapple, origins) {
    for (let i = 0; i < 2; i++) {
      const h = grapple.hooks[i];
      const rope = this.ropes[i], tip = this.tips[i];
      const visible = h.state !== 'idle';
      rope.visible = tip.visible = visible;
      if (!visible) continue;
      const o = origins[i];
      tmp.subVectors(h.tip, o);
      const len = tmp.length();
      rope.position.copy(o);
      rope.scale.set(1, Math.max(0.01, len), 1);
      if (len > 1e-4) rope.quaternion.setFromUnitVectors(UP, tmp.divideScalar(len));
      tip.position.copy(h.tip);
      mid.copy(h.tip).add(tmp);
      tip.lookAt(mid);
    }
  }
}
