import * as THREE from 'three';
import { clamp, damp, dampFactor, invLerp } from '../core/math.js';

const tmp = new THREE.Vector3();
const hit = { point: null, normal: null, dist: 0, collider: null };

/**
 * Third-person orbit camera: mouse-driven yaw/pitch, smoothed follow,
 * over-the-shoulder offset, collision pull-in, speed-based FOV and shake.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = -0.15;
    this.baseDistance = 6.2;
    this.distance = 6.2;
    this.extraDistance = 0;
    this.shoulder = 0.7;
    this.focus = new THREE.Vector3();
    this.baseFov = 72;
    this.fov = 72;
    this.trauma = 0;
    this.shakeTime = 0;
    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.initialized = false;
  }

  applyMouse(dx, dy, sensitivity, invertY) {
    const k = 0.0022 * sensitivity;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.4, 1.25);
  }

  addShake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Horizontal forward/right basis for WASD movement. */
  moveBasis(outF, outR) {
    outF.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    outR.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  update(dt, target, speed, colliders, fovEffects) {
    if (!this.initialized) {
      this.focus.copy(target);
      this.initialized = true;
    }
    // Faster follow at high speed so the player doesn't drift off-screen.
    const lambda = 14 + speed * 0.35;
    this.focus.x = damp(this.focus.x, target.x, lambda, dt);
    this.focus.y = damp(this.focus.y, target.y + 1.0, lambda * 0.8, dt);
    this.focus.z = damp(this.focus.z, target.z, lambda, dt);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const desiredDist = this.baseDistance + invLerp(15, 60, speed) * 2.5 + this.extraDistance;
    this.distance = damp(this.distance, desiredDist, 4, dt);

    // Desired camera position: behind focus along -forward, shifted right.
    const cam = this.camera.position;
    const ox = this.right.x * this.shoulder, oz = this.right.z * this.shoulder;
    const px = this.focus.x + ox, py = this.focus.y, pz = this.focus.z + oz;
    let dist = this.distance;
    // Collision: cast from the pivot back toward the desired camera position.
    const bx = -this.forward.x, by = -this.forward.y, bz = -this.forward.z;
    if (colliders.raycast(px, py, pz, bx, by, bz, dist + 0.4, hit, (c) => c.solid)) {
      dist = Math.max(0.6, hit.dist - 0.4);
    }
    cam.set(px + bx * dist, Math.max(0.3, py + by * dist), pz + bz * dist);

    // Shake
    this.shakeTime += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    if (s > 0) {
      const t = this.shakeTime * 40;
      cam.x += (Math.sin(t * 1.3) + Math.sin(t * 2.7)) * 0.25 * s;
      cam.y += (Math.sin(t * 1.7 + 1) + Math.sin(t * 3.1)) * 0.25 * s;
      cam.z += (Math.sin(t * 1.1 + 2) + Math.sin(t * 2.3)) * 0.25 * s;
    }

    tmp.copy(cam).addScaledVector(this.forward, 10);
    this.camera.lookAt(tmp);
    if (s > 0) this.camera.rotation.z += Math.sin(this.shakeTime * 33) * 0.03 * s;

    const targetFov = this.baseFov + (fovEffects ? invLerp(18, 70, speed) * 24 : 0);
    this.fov += (targetFov - this.fov) * dampFactor(5, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
