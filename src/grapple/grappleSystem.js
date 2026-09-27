import * as THREE from 'three';
import { Hook } from './hook.js';
import { GRAPPLE, applyRopeConstraint, hookPullAccel, boostDirection, drainGas } from './ropeMath.js';

const tmp = new THREE.Vector3();
const dirs = [new THREE.Vector3(), new THREE.Vector3()];
const boostDir = new THREE.Vector3();
const hipOffset = new THREE.Vector3();

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
    this.origins = [new THREE.Vector3(), new THREE.Vector3()];
    this.events = []; // {type:'fire'|'attach'|'release'|'empty', side}
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
    this.events.push({ type: 'fire', side: h.side });
  }

  releaseAll() {
    let any = false;
    for (const h of this.hooks) {
      if (h.state === 'attached' || h.state === 'flying') {
        h.release();
        any = true;
      }
    }
    if (any) this.events.push({ type: 'release' });
  }

  /**
   * One fixed step.
   * @param {object} controls {reel:[bool,bool], boost:bool, look:Vector3}
   */
  step(dt, player, controls, raycast) {
    const boostHeld = controls.boost;
    this.boosting = false;
    this.reelingAny = false;
    let hasGas = this.gas > 0;

    for (let i = 0; i < 2; i++) {
      const h = this.hooks[i];
      const wasAttached = h.attached;
      h.update(dt, this.origins[i], raycast);
      if (h.justAttached) this.events.push({ type: 'attach', side: h.side, collider: h.collider, point: h.anchor.clone() });
      if (wasAttached && !h.attached) this.events.push({ type: 'detach', side: h.side });
    }

    // Rope pulls and gas use
    let n = 0;
    for (let i = 0; i < 2; i++) {
      const h = this.hooks[i];
      if (!h.attached) continue;
      tmp.subVectors(h.anchor, player.pos);
      const dist = tmp.length();
      if (dist < 1e-6) continue;
      tmp.divideScalar(dist);
      dirs[n++].copy(tmp);
      const reeling = controls.reel[i];
      h.reeling = reeling;
      if (reeling && hasGas) {
        const r = drainGas(this.gas, GRAPPLE.reelGasRate, dt);
        this.gas = r.gas;
        this.reelingAny = true;
      }
      const a = hookPullAccel(dist, { reeling, boosting: false, hasGas });
      player.accel.addScaledVector(tmp, a);
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
      }
    }
    if (hasGas && this.gas <= 0) this.events.push({ type: 'empty' });

    // Anti soft-lock: slow regen while standing on the ground.
    if (player.grounded && n === 0 && player.speed < 3) {
      this.gas = Math.min(this.gasMax, this.gas + GRAPPLE.groundRegen * dt);
    }
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
