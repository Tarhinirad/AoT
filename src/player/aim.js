import * as THREE from 'three';
import { GRAPPLE } from '../grapple/ropeMath.js';

const hit = { dist: 0, point: null, normal: null, collider: null, attach: null };
const dir = new THREE.Vector3();
const up = new THREE.Vector3();
// Aim assist rings (radians). Wider rings only kick in when the tighter ones miss.
const ASSIST_ANGLES = [0.03, 0.06, 0.1];
const ASSIST_SAMPLES = 12;

/**
 * Crosshair targeting: raycasts along the camera's forward ray to find what a
 * hook would hit. If the center ray misses, a small cone of probe rays gives
 * gentle aim assist.
 */
export class Aimer {
  constructor(raycast) {
    this.raycast = raycast;
    this.point = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.assisted = false; // the target came from the assist cone, not the crosshair ray
    this.inRange = false;
    this.giant = null;
    this.nape = false;
  }

  update(camPos, forward, right, playerPos) {
    const f = forward;
    // Start the ray level with the player so we never hook things behind them.
    const along = Math.max(0, (playerPos.x - camPos.x) * f.x + (playerPos.y - camPos.y) * f.y + (playerPos.z - camPos.z) * f.z);
    const ox = camPos.x + f.x * along, oy = camPos.y + f.y * along, oz = camPos.z + f.z * along;
    const range = GRAPPLE.maxRange;
    this.inRange = false;
    this.giant = null;
    this.nape = false;
    this.assisted = false;
    this.point.set(ox + f.x * range, oy + f.y * range, oz + f.z * range);
    if (this._probe(ox, oy, oz, f.x, f.y, f.z, playerPos)) return;
    this.assisted = true;
    const u = up.crossVectors(right, f).normalize();
    for (const ang of ASSIST_ANGLES) {
      const t = Math.tan(ang);
      for (let k = 0; k < ASSIST_SAMPLES; k++) {
        const a = (k / ASSIST_SAMPLES) * Math.PI * 2;
        const ca = Math.cos(a) * t, sa = Math.sin(a) * t;
        dir.set(f.x + right.x * ca + u.x * sa, f.y + right.y * ca + u.y * sa, f.z + right.z * ca + u.z * sa).normalize();
        if (this._probe(ox, oy, oz, dir.x, dir.y, dir.z, playerPos)) return;
      }
    }
  }

  _probe(ox, oy, oz, dx, dy, dz, p) {
    if (!this.raycast(ox, oy, oz, dx, dy, dz, GRAPPLE.maxRange + 20, hit)) return false;
    if (hit.collider?.tag === 'ground' && hit.dist > 40) return false;
    const pt = hit.point;
    if (Math.hypot(pt.x - p.x, pt.y - p.y, pt.z - p.z) > GRAPPLE.maxRange) return false;
    this.point.set(pt.x, pt.y, pt.z);
    this.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    this.inRange = true;
    this.giant = hit.collider?.giant || null;
    this.nape = hit.collider?.hitbox?.kind === 'nape';
    return true;
  }
}
