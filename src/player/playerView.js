import * as THREE from 'three';
import { dampAngle, damp, clamp } from '../core/math.js';

/** Low-poly soldier: cloak, harness, gas canisters and two blades. */
export class PlayerView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // leans/rotates
    this.root.add(this.body);
    const cloak = new THREE.MeshLambertMaterial({ color: 0x3f6b45, flatShading: true });
    const skin = new THREE.MeshLambertMaterial({ color: 0xe0b48f });
    const leather = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
    const metal = new THREE.MeshLambertMaterial({ color: 0x9aa3ad });
    const white = new THREE.MeshLambertMaterial({ color: 0xe9e4d8 });
    const hair = new THREE.MeshLambertMaterial({ color: 0x3a2a1e });
    this.bladeMat = new THREE.MeshLambertMaterial({ color: 0xdfe8f0, emissive: 0x223344 });

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.7, 6), white);
    torso.position.y = 0.15;
    this.body.add(torso);
    const jacket = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.28, 0.42, 6), leather);
    jacket.position.y = 0.32;
    this.body.add(jacket);
    const cape = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.95, 6, 1, true), cloak);
    cape.position.set(0, 0.05, 0.12);
    cape.material.side = THREE.DoubleSide;
    this.cape = cape;
    this.body.add(cape);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 0), skin);
    head.position.y = 0.72;
    this.body.add(head);
    const hairM = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), hair);
    hairM.position.set(0, 0.78, 0.04);
    hairM.scale.set(1, 0.7, 1);
    this.body.add(hairM);
    // Legs
    this.legs = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(0.11 * s, -0.2, 0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.16), white);
      m.position.y = -0.3;
      leg.add(m);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.22, 0.2), leather);
      boot.position.set(0, -0.58, -0.02);
      leg.add(boot);
      this.body.add(leg);
      this.legs.push(leg);
    }
    // Gear: canisters at the hips, blade boxes
    for (const s of [-1, 1]) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.55, 6), metal);
      can.rotation.x = Math.PI / 2;
      can.position.set(0.33 * s, -0.12, 0.1);
      this.body.add(can);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.55), metal);
      box.position.set(0.36 * s, -0.28, 0.05);
      this.body.add(box);
    }
    // Arms with blades
    this.arms = [];
    this.blades = [];
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(0.32 * s, 0.42, 0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.55, 0.11), white);
      m.position.y = -0.26;
      arm.add(m);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.95), this.bladeMat);
      blade.position.set(0, -0.54, -0.42);
      arm.add(blade);
      this.body.add(arm);
      this.arms.push(arm);
      this.blades.push(blade);
    }
    this.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    scene.add(this.root);
    this.yaw = 0;
    this.lean = 0;
    this.pitch = 0;
    this.walkPhase = 0;
    this.slashAnim = 0; // 0..1 counts down
    this.slashSide = 1;
  }

  triggerSlash() {
    this.slashAnim = 1;
    this.slashSide *= -1;
  }

  setBladesVisible(v) {
    for (const b of this.blades) b.visible = v;
  }

  update(dt, pos, player, cameraYaw, grappling) {
    this.root.position.copy(pos);
    const v = player.vel;
    const horiz = Math.hypot(v.x, v.z);
    let targetYaw = this.yaw;
    if (player.grounded && horiz < 1.5) targetYaw = cameraYaw;
    else if (horiz > 1.5) targetYaw = Math.atan2(-v.x, -v.z);
    this.yaw = dampAngle(this.yaw, targetYaw, player.grounded ? 12 : 6, dt);
    this.root.rotation.y = this.yaw;

    // Lean into velocity while airborne, stand upright on the ground.
    const pitchTarget = player.grounded ? 0 : clamp(-v.y * 0.02, -0.6, 0.6) + clamp(horiz * 0.012, 0, 0.7) * (grappling ? 1 : 0.6);
    this.pitch = damp(this.pitch, pitchTarget, 6, dt);
    this.body.rotation.x = -this.pitch;

    // Walk cycle
    if (player.grounded && horiz > 0.5) {
      this.walkPhase += dt * horiz * 1.6;
      const s = Math.sin(this.walkPhase) * Math.min(1, horiz / 6) * 0.8;
      this.legs[0].rotation.x = s;
      this.legs[1].rotation.x = -s;
    } else {
      const tuck = player.grounded ? 0 : 0.5;
      this.legs[0].rotation.x = damp(this.legs[0].rotation.x, tuck, 8, dt);
      this.legs[1].rotation.x = damp(this.legs[1].rotation.x, tuck * 0.6, 8, dt);
    }
    // Arms: forward-held blades, slash swing
    this.slashAnim = Math.max(0, this.slashAnim - dt * 5);
    const swing = Math.sin(this.slashAnim * Math.PI);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const arm = this.arms[i];
      arm.rotation.x = -0.9 - swing * 1.4;
      arm.rotation.z = side * (0.35 + swing * 0.6 * (side === this.slashSide ? 1.4 : 0.6));
    }
    this.cape.rotation.x = clamp(horiz * 0.02, 0, 0.9);
  }
}
