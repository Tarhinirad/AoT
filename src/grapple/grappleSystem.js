import * as THREE from 'three';
import { Hook } from './hook.js';
import {
  GRAPPLE, applyRopeConstraint, hookPullAccel, boostDirection, drainGas,
  swingSteer, applySoftArrival, releaseBoostAmount, regenGas,
} from './ropeMath.js';

const tmp = new THREE.Vector3();
const dirs = [new THREE.Vector3(), new THREE.Vector3()];
const dists = [0, 0];
const soft = [false, false]; // static anchor: soft arrival applies (never on giants)
const boostDir = new THREE.Vector3();
const hipOffset = new THREE.Vector3();
const ropeAvg = new THREE.Vector3();
const steer = new THREE.Vector3();

/**
 * Owns both hooks and the gas tank. Applies rope forces and constraints to
 * the player each fixed step.
 */
export class GrappleSystem {
  constructor() {
    this.hooks = [new Hook(-1), new Hook(1)];
    this.gas = GRAPPLE.gasMax;
    this.gasMax = GRAPPLE.gasMax;
    this.boosting = false; // actually thrusting this step (for FX/audio)
    this.reelingAny = false;
    this.gasIdleT = 0; // seconds since gas was last spent (drives recharge)
    this.origins = [new THREE.Vector3(), new THREE.Vector3()];
    this.events = []; // {type:'fire'|'attach'|'detach'|'release'|'empty', side}
    this.lowGasWarned = false;
  }

  get attachedCount() {
    return (this.hooks[0].attached ? 1 : 0) + (this.hooks[1].attached ? 1 : 0);
  }

  reset() {
    for (const h of this.hooks) {
      h.state = 'idle';
      h.attach = null;
    }
    this.gas = this.gasMax;
    this.gasIdleT = 0;
  }

  /** Hip launcher positions, offset left/right of the facing direction. */
  updateOrigins(playerPos, rightVec) {
    for (let i = 0; i < 2; i++) {
      const s = this.hooks[i].side;
      hipOffset.copy(rightVec).multiplyScalar(0.35 * s);
      this.origins[i].copy(playerPos).add(hipOffset);
    }
  }

  fire(index, target) {
    const h = this.hooks[index];
    h.fire(this.origins[index], target);
    this.gas = Math.max(0, this.gas - GRAPPLE.fireGasCost);
    this.gasIdleT = 0;
    this.events.push({ type: 'fire', side: h.side });
  }

  /**
   * Let go of both hooks. Pass the player for a deliberate release: letting
   * go of a taut rope at speed slingshots you a little further.
   */
  releaseAll(player = null) {
    let any = false;
    let wasSwinging = false;
    for (const h of this.hooks) {
      if (h.state === 'attached' || h.state === 'flying') {
        if (h.attached) wasSwinging = true;
        h.release();
        any = true;
      }
    }
    let boost = 0;
    if (any && player && wasSwinging && !player.grounded) {
      const sp = player.vel.length();
      boost = releaseBoostAmount(sp);
      if (boost > 0) {
        player.vel.multiplyScalar((sp + boost) / sp);
        if (player.vel.y > -6) player.vel.y += GRAPPLE.releaseLift;
      }
    }
    if (any) this.events.push({ type: 'release', boost });
  }

  /**
   * One fixed step.
   * @param {object} controls {reel:[bool,bool], boost:bool, look:Vector3, wish:Vector3}
   */
  step(dt, player, controls, raycast) {
    const boostHeld = controls.boost;
    this.boosting = false;
    this.reelingAny = false;
    let hasGas = this.gas > 0;
    const gasBefore = this.gas;

    for (let i = 0; i < 2; i++) {
      const h = this.hooks[i];
      const wasAttached = h.attached;
      h.update(dt, this.origins[i], raycast);
      if (h.justAttached) this.events.push({ type: 'attach', side: h.side, collider: h.collider, point: h.anchor.clone() });
      if (wasAttached && !h.attached) this.events.push({ type: 'detach', side: h.side });
    }

    // Rope pulls and gas use
    let n = 0;
    ropeAvg.set(0, 0, 0);
    for (let i = 0; i < 2; i++) {
      const h = this.hooks[i];
      if (!h.attached) continue;
      tmp.subVectors(h.anchor, player.pos);
      const dist = tmp.length();
      if (dist < 1e-6) continue;
      tmp.divideScalar(dist);
      dists[n] = dist;
      soft[n] = !h.attach;
      dirs[n++].copy(tmp);
      ropeAvg.add(tmp);
      const reeling = controls.reel[i];
      h.reeling = reeling;
      if (reeling && hasGas) {
        const r = drainGas(this.gas, GRAPPLE.reelGasRate, dt);
        this.gas = r.gas;
        this.reelingAny = true;
        // Glide in to a wall rather than slamming into it. Reeling into a giant
        // keeps full speed: that's how nape strikes get their power.
        if (!h.attach) applySoftArrival(player.vel, tmp, dist, dt);
      }
      const a = hookPullAccel(dist, { reeling, boosting: false, hasGas });
      player.accel.addScaledVector(tmp, a);
    }

    // Swing steering: WASD pushes you along the arc of the swing.
    if (n > 0 && controls.wish && !player.grounded) {
      const l = ropeAvg.length();
      if (l > 1e-6) {
        ropeAvg.divideScalar(l);
        swingSteer(controls.wish, ropeAvg, steer);
        player.accel.addScaledVector(steer, GRAPPLE.swingSteerAccel);
      }
    }

    // Break ground contact so the rope can swing us instead of dragging us along the floor.
    if (player.grounded && n > 0 && hasGas && (boostHeld || controls.reel[0] || controls.reel[1])) {
      player.vel.y = Math.max(player.vel.y, GRAPPLE.liftOffSpeed);
      player.grounded = false;
    }

    if (boostHeld && hasGas && !(player.grounded && n === 0)) {
      const rate = n > 0 ? GRAPPLE.boostGasRate : GRAPPLE.freeBoostGasRate;
      const r = drainGas(this.gas, rate, dt);
      this.gas = r.gas;
      if (r.ok) {
        boostDirection(dirs.slice(0, n), controls.look, boostDir);
        player.accel.addScaledVector(boostDir, n > 0 ? GRAPPLE.boostAccel : GRAPPLE.freeBoostAccel);
        this.boosting = true;
        for (let i = 0; i < n; i++) if (soft[i]) applySoftArrival(player.vel, dirs[i], dists[i], dt);
      }
    }
    if (hasGas && this.gas <= 0) this.events.push({ type: 'empty' });

    // Passive recharge after a pause in gas use (and fully while resting on the ground).
    this.gasIdleT = this.gas < gasBefore ? 0 : this.gasIdleT + dt;
    const resting = player.grounded && n === 0 && player.speed < 3;
    this.gas = regenGas(this.gas, this.gasIdleT, resting, dt);
  }

  /** Enforce rope lengths after integration. Two passes for two ropes. */
  constrain(player) {
    for (let pass = 0; pass < 2; pass++) {
      for (const h of this.hooks) {
        if (!h.attached) continue;
        h.tension = applyRopeConstraint(player.pos, player.vel, h.anchor, h.length);
      }
    }
  }
}
