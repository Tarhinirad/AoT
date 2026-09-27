import * as THREE from 'three';
import { GRAPPLE, takeUpSlack } from './ropeMath.js';

const hit = { dist: 0, point: null, normal: null, collider: null, attach: null };

/**
 * One grappling hook. States: idle → flying → attached → (released) retracting → idle.
 * An anchor may be static (world point) or follow a moving target through
 * `attach.worldPoint(out)` (e.g. a giant body part).
 */
export class Hook {
  constructor(side) {
    this.side = side; // -1 left, +1 right
    this.state = 'idle';
    this.tip = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.anchor = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.traveled = 0;
    this.length = 0;
    this.attach = null; // dynamic attachment
    this.collider = null;
    this.reeling = false;
    this.justAttached = false;
    this.tension = 0;
  }

  get attached() {
    return this.state === 'attached';
  }

  fire(origin, target) {
    this.state = 'flying';
    this.tip.copy(origin);
    this.dir.subVectors(target, origin);
    if (this.dir.lengthSq() < 1e-6) this.dir.set(0, 0, -1);
    this.dir.normalize();
    this.traveled = 0;
    this.attach = null;
  }

  release() {
    if (this.state === 'attached' || this.state === 'flying') this.state = 'retracting';
    this.attach = null;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} origin  hook launcher position (player hip)
   * @param {Function} raycast (ox,oy,oz,dx,dy,dz,max,out) => bool
   */
  update(dt, origin, raycast) {
    this.justAttached = false;
    if (this.state === 'flying') {
      const step = GRAPPLE.hookSpeed * dt;
      const remaining = GRAPPLE.maxRange - this.traveled;
      const d = Math.min(step, remaining);
      hit.attach = null;
      if (raycast(this.tip.x, this.tip.y, this.tip.z, this.dir.x, this.dir.y, this.dir.z, d, hit)) {
        this.anchor.set(hit.point.x, hit.point.y, hit.point.z);
        this.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
        this.tip.copy(this.anchor);
        this.collider = hit.collider;
        this.attach = hit.attach || null;
        this.state = 'attached';
        this.justAttached = true;
        this.length = origin.distanceTo(this.anchor);
        return;
      }
      this.tip.addScaledVector(this.dir, d);
      this.traveled += d;
      if (this.traveled >= GRAPPLE.maxRange - 1e-6) this.state = 'retracting';
    } else if (this.state === 'attached') {
      if (this.attach) {
        if (!this.attach.valid()) {
          this.release();
          return;
        }
        this.attach.worldPoint(this.anchor);
        this.tip.copy(this.anchor);
      }
      this.length = takeUpSlack(this.length, origin.distanceTo(this.anchor));
    } else if (this.state === 'retracting') {
      const toO = this.dir.subVectors(origin, this.tip);
      const dist = toO.length();
      const step = GRAPPLE.retractSpeed * dt;
      if (dist <= step) {
        this.state = 'idle';
        this.tip.copy(origin);
      } else {
        this.tip.addScaledVector(toO, step / dist);
      }
    }
  }
}
