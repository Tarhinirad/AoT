import * as THREE from 'three';
import { Giant } from './giant.js';

const rayOut = { dist: 0, point: null, normal: null, collider: null, attach: null };

/** Owns all giants: spawning, stepping, ray queries and debris from severed limbs. */
export class GiantManager {
  constructor(scene, colliders, rng) {
    this.scene = scene;
    this.colliders = colliders;
    this.rng = rng;
    this.giants = [];
    this.debris = [];
    this.events = []; // forwarded giant events with giant ref
    this.brainFactory = null; // set by the game (AI)
  }

  spawn(variant, x, z, yaw = 0, height) {
    const g = new Giant(this.scene, { variant, x, z, yaw, rng: this.rng, height });
    if (this.brainFactory) g.brain = this.brainFactory(g);
    this.giants.push(g);
    return g;
  }

  get aliveCount() {
    let n = 0;
    for (const g of this.giants) if (g.alive) n++;
    return n;
  }

  clear() {
    for (const g of this.giants) g.dispose();
    this.giants.length = 0;
    for (const d of this.debris) this.scene.remove(d.obj);
    this.debris.length = 0;
  }

  step(dt, ctx) {
    this._separate();
    for (let i = this.giants.length - 1; i >= 0; i--) {
      const g = this.giants[i];
      if (g.alive && g.brain) g.brain.update(dt, ctx);
      g.update(dt, this.colliders);
      for (const e of g.events) {
        e.giant = g;
        if (e.type === 'sever') this._spawnDebris(g, e.group);
        this.events.push(e);
      }
      g.events.length = 0;
      if (g.removable) {
        g.dispose();
        this.giants.splice(i, 1);
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vel.y -= 22 * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.z += d.spin.z * dt;
      if (d.obj.position.y < d.rest) {
        d.obj.position.y = d.rest;
        d.vel.multiplyScalar(0.3);
        d.vel.y = 0;
        d.spin.multiplyScalar(0.5);
      }
      if (d.life < 1.5) d.obj.position.y -= dt * 1.5;
      if (d.life <= 0) {
        this.scene.remove(d.obj);
        this.debris.splice(i, 1);
      }
    }
  }

  /** Keep giants from walking through each other. */
  _separate() {
    const gs = this.giants;
    for (let i = 0; i < gs.length; i++) {
      const a = gs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < gs.length; j++) {
        const b = gs[j];
        if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        const nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        b.pos.x += nx * push; b.pos.z += nz * push;
      }
    }
  }

  _spawnDebris(giant, group) {
    const obj = group.clone(true);
    obj.visible = true;
    group.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
    this.scene.add(obj);
    const out = new THREE.Vector3(Math.sin(giant.yaw + Math.PI / 2), 0.4, Math.cos(giant.yaw + Math.PI / 2));
    this.debris.push({
      obj,
      vel: out.multiplyScalar(giant.H * 0.3),
      spin: new THREE.Vector3(this.rng.range(-2, 2), 0, this.rng.range(-2, 2)),
      life: 6,
      rest: giant.H * 0.04,
    });
  }

  /** Nearest ray hit across all giants. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
    let best = maxDist, hit = false;
    for (const g of this.giants) {
      if (!g.alive) continue;
      if (g.raycast(ox, oy, oz, dx, dy, dz, best, rayOut)) {
        best = rayOut.dist;
        hit = true;
        out.dist = rayOut.dist;
        out.point = out.point || { x: 0, y: 0, z: 0 };
        out.normal = out.normal || { x: 0, y: 0, z: 0 };
        out.point.x = rayOut.point.x; out.point.y = rayOut.point.y; out.point.z = rayOut.point.z;
        out.normal.x = rayOut.normal.x; out.normal.y = rayOut.normal.y; out.normal.z = rayOut.normal.z;
        out.collider = rayOut.collider;
        out.attach = null;
      }
    }
    return hit;
  }

  resolvePlayer(player) {
    for (const g of this.giants) g.resolveSphere(player.pos, player.radius, player.vel);
  }
}
