import * as THREE from 'three';
import { AI, AI_TIMING, nextState, isWindup } from './aiStateMachine.js';
import { CITY } from '../world/city.js';
import { clamp } from '../core/math.js';

const losHit = { dist: 0, point: null, normal: null, collider: null };
const probeHit = { dist: 0, point: null, normal: null, collider: null };
const AVOID_OFFSETS = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8];
const local = new THREE.Vector3();
const tmp = new THREE.Vector3();

/**
 * Executes the AI state machine for one giant: builds the perception snapshot,
 * asks `nextState`, then drives steering, animation and attack resolution.
 * Attack outcomes are emitted as giant events for the game to apply.
 */
export class GiantBrain {
  constructor(giant, rng, colliders) {
    this.g = giant;
    this.rng = rng;
    this.colliders = colliders;
    this.state = AI.WANDER;
    this.t = 0;
    this.grabCD = 1.5;
    this.swipeCD = 0.5;
    this.lostTime = 99;
    this.canSee = false;
    this.losTimer = rng.range(0, 0.3);
    this.wanderTarget = new THREE.Vector2(giant.pos.x, giant.pos.z);
    this.wanderTimer = 0;
    this.stuckCheckT = 0;
    this.stuckFrom = new THREE.Vector2(giant.pos.x, giant.pos.z);
    this.detourT = 0;
    this.detourSign = 1;
    this.avoidT = rng.range(0, 0.3);
    this.avoidOffset = 0;
    this.attackSide = 'R';
    this.grabHit = false;
    this.released = false;
    this.swipeDone = false;
    this.zig = rng.range(0, 10);
    this.twitchT = 0;
    this.ctx = {
      t: 0, canSee: false, lostTime: 99, dist: 999, grabRange: 0, swipeRange: 0, grabReady: false,
      swipeReady: false, hasArm: true, inFront: false, reachable: true, playerHeld: false,
      swipeable: true, staggered: false, grabHit: false, released: false, abnormal: giant.abnormal, roll: 0,
    };
  }

  /** Called by the game when the held player escapes or is dropped. */
  releasePlayer() {
    this.released = true;
  }

  update(dt, { player, game }) {
    const g = this.g;
    const H = g.H;
    this.t += dt;
    this.grabCD -= dt;
    this.swipeCD -= dt;

    // --- Perception ---
    // Reach centre: roughly where the hands can sweep (half height, slightly ahead).
    const fx = Math.sin(g.yaw), fz = Math.cos(g.yaw);
    const dist = Math.hypot(player.pos.x - (g.pos.x + fx * H * 0.2), player.pos.y - H * 0.5, player.pos.z - (g.pos.z + fz * H * 0.2));
    const dx = player.pos.x - g.pos.x, dz = player.pos.z - g.pos.z;
    const hd = Math.hypot(dx, dz) || 1e-6;
    const fwdDot = (dx * Math.sin(g.yaw) + dz * Math.cos(g.yaw)) / hd;
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.25;
      this.canSee = this._detect(player, hd);
    }
    this.lostTime = this.canSee ? 0 : this.lostTime + dt;

    const c = this.ctx;
    c.t = this.t;
    c.canSee = this.canSee && player.alive;
    c.lostTime = this.lostTime;
    c.dist = dist;
    c.grabRange = H * 0.45 + 1.5;
    c.swipeRange = H * 0.52 + 2;
    c.grabReady = this.grabCD <= 0 && player.grabImmunity <= 0;
    c.swipeReady = this.swipeCD <= 0;
    c.hasArm = g.hasArm('L') || g.hasArm('R');
    c.inFront = fwdDot > 0.55;
    c.reachable = player.pos.y < H * 1.15;
    c.swipeable = player.pos.y > H * 0.3;
    c.playerHeld = player.grabbed && game.grab?.giant !== g;
    c.staggered = g.staggerT > 0;
    c.grabHit = this.grabHit;
    c.released = this.released;
    c.roll = this.rng.next();

    const next = nextState(this.state, c);
    if (next !== this.state) this._enter(next, player);

    // --- Behaviour ---
    const a = g.anim;
    a.reachL = 0; a.reachR = 0;
    a.swipeL = null; a.swipeR = null;
    a.crouch = 0; a.lean = 0; a.twist = 0;
    a.headPitch = 0; a.headYaw = 0; a.headTilt = 0;
    g.telegraph = 0;
    const toPlayerYaw = Math.atan2(dx, dz);
    g.turnRate = g.cfg.turn;
    // How far below the shoulders the player is: giants bend down for low targets.
    const low = clamp((H * 0.8 - player.pos.y) / (H * 0.6), 0, 1);

    switch (this.state) {
      case AI.WANDER: {
        this.wanderTimer -= dt;
        const wx = this.wanderTarget.x - g.pos.x, wz = this.wanderTarget.y - g.pos.z;
        if (this.wanderTimer <= 0 || wx * wx + wz * wz < 25) this._pickWander(player);
        g.desiredYaw = Math.atan2(wx, wz);
        g.desiredSpeed = g.cfg.walk * 0.6;
        a.headYaw = Math.sin(this.t * 0.7 + this.zig) * 0.5;
        break;
      }
      case AI.PURSUE: {
        g.desiredYaw = toPlayerYaw;
        const close = dist < c.swipeRange * 1.3;
        g.desiredSpeed = hd < g.radius + 1.5 ? 0 : close ? g.cfg.walk * 0.6 : hd > 35 ? g.cfg.run : g.cfg.walk;
        if (g.abnormal) {
          g.desiredYaw += Math.sin(this.t * 2.3 + this.zig) * 0.5;
          this._twitch(dt, a);
        }
        this._lookAt(player, a);
        break;
      }
      case AI.SPRINT: {
        g.desiredYaw = toPlayerYaw + Math.sin(this.t * 5 + this.zig) * 0.45;
        g.desiredSpeed = g.cfg.run;
        g.turnRate = g.cfg.turn * 1.5;
        a.headTilt = Math.sin(this.t * 9) * 0.3;
        break;
      }
      case AI.GRAB_WINDUP: {
        const windup = g.abnormal ? AI_TIMING.grabWindupAbnormal : AI_TIMING.grabWindup;
        const k = clamp(this.t / windup, 0, 1);
        g.desiredYaw = toPlayerYaw;
        g.turnRate = g.cfg.turn * 2.2;
        g.desiredSpeed = 0;
        a.crouch = k * (0.4 + low * 0.6);
        a.lean = k * low * 0.5;
        this._aimArm(player, a, this.attackSide);
        // Raise the hand high and back before the lunge: a readable telegraph.
        a.reachPitch = 1.0 + k * 0.6;
        a['reach' + this.attackSide] = k * 0.9;
        a.reachElbow = -0.9 * k;
        a.twist = (this.attackSide === 'R' ? 0.25 : -0.25) * k;
        this._lookAt(player, a);
        g.telegraph = k;
        break;
      }
      case AI.GRAB: {
        const k = clamp(this.t / AI_TIMING.grab, 0, 1);
        g.desiredYaw = toPlayerYaw;
        g.desiredSpeed = g.cfg.walk * 2.2 * (1 - k); // lunge
        a.lean = (0.35 + low * 0.6) * Math.min(1, k / 0.6); // bend into the lunge, then hold
        a.crouch = low;
        this._aimArm(player, a, this.attackSide);
        a['reach' + this.attackSide] = 1;
        a.reachElbow = -0.1;
        a['grip' + this.attackSide] = k;
        this._lookAt(player, a);
        if (!this.grabHit && k > 0.2 && player.alive && !player.grabbed && player.grabImmunity <= 0) {
          const hand = g.rig.hitboxes.find((h) => h.name === 'hand' + this.attackSide);
          if (hand.world.distanceTo(player.pos) < hand.radius + 1.5 + H * 0.12) {
            this.grabHit = true;
            g.events.push({ type: 'grab', side: this.attackSide });
          }
        }
        break;
      }
      case AI.HOLD: {
        const k = clamp(this.t / 1.2, 0, 1);
        g.desiredSpeed = 0;
        const side = this.attackSide;
        a['reach' + side] = 1;
        a.reachPitch = 0.1 + k * 0.35;
        a['reachYaw' + side] = (side === 'L' ? -0.35 : 0.35) * k;
        a.reachElbow = -0.2 - k * 1.3;
        a['grip' + side] = 1;
        a.headPitch = 0.25;
        g.telegraph = this.t > AI_TIMING.holdMax - 1.2 ? 0.6 + 0.4 * Math.sin(this.t * 25) : 0;
        if (this.t >= AI_TIMING.holdMax - dt && !this.released) {
          g.events.push({ type: 'bite' });
          this.released = true;
        }
        break;
      }
      case AI.SWIPE_WINDUP: {
        const k = clamp(this.t / AI_TIMING.swipeWindup, 0, 1);
        g.desiredYaw = toPlayerYaw;
        g.turnRate = g.cfg.turn * 2.5;
        g.desiredSpeed = 0;
        a['swipe' + this.attackSide] = -k;
        a.swipeBlend = k;
        a.lean = low * 0.6 * k;
        this._aimArm(player, a, this.attackSide);
        a.swipePitch = a.reachPitch;
        a.twist = (this.attackSide === 'R' ? -0.4 : 0.4) * k;
        a.crouch = 0.3 * k;
        g.telegraph = k;
        this._lookAt(player, a);
        break;
      }
      case AI.SWIPE: {
        const k = clamp(this.t / AI_TIMING.swipe, 0, 1);
        const e = k * k * (3 - 2 * k);
        g.desiredSpeed = 0;
        a['swipe' + this.attackSide] = -1 + 2 * e;
        a.swipeBlend = 1;
        a.lean = low * 0.6;
        this._aimArm(player, a, this.attackSide);
        a.swipePitch = a.reachPitch;
        a.twist = (this.attackSide === 'R' ? -0.4 + 0.8 * e : 0.4 - 0.8 * e);
        a.crouch = 0.3;
        if (!this.swipeDone && k > 0.1 && k < 0.9 && player.alive && !player.grabbed) {
          for (const hb of g.rig.hitboxes) {
            if (hb.limb !== 'arm' + this.attackSide) continue;
            if (hb.world.distanceTo(player.pos) < hb.radius + 1.3 + H * 0.06) {
              this.swipeDone = true;
              tmp.subVectors(player.pos, g.pos).setY(0).normalize();
              g.events.push({ type: 'swipeHit', dir: tmp.clone() });
              break;
            }
          }
        }
        break;
      }
      case AI.RECOVER:
        g.desiredSpeed = 0;
        g.desiredYaw = toPlayerYaw;
        a.headPitch = -0.1;
        break;
      case AI.STAGGER:
        g.desiredSpeed = 0;
        break;
    }

    if (g.desiredSpeed > 0.5) this._avoid(dt);
    this._handleStuck(dt);
  }

  /**
   * Obstacle avoidance: probe the desired heading for tall buildings and veer
   * to the nearest clear heading. Re-evaluated a few times per second.
   */
  _avoid(dt) {
    const g = this.g;
    this.avoidT -= dt;
    if (this.avoidT <= 0) {
      this.avoidT = 0.3;
      const minH = g.H * 0.55;
      const filter = (c) => c.solid && c.maxY >= minH;
      const look = g.radius + 4 + g.speed * 1.2;
      this.avoidOffset = 0;
      for (const off of AVOID_OFFSETS) {
        const yaw = g.desiredYaw + off;
        const dx = Math.sin(yaw), dz = Math.cos(yaw);
        // Two parallel probes at the giant's flanks so it doesn't clip corners.
        const rx = dz * g.radius * 0.8, rz = -dx * g.radius * 0.8;
        const blocked =
          this.colliders.raycast(g.pos.x + rx, 2, g.pos.z + rz, dx, 0, dz, look, probeHit, filter, false) ||
          this.colliders.raycast(g.pos.x - rx, 2, g.pos.z - rz, dx, 0, dz, look, probeHit, filter, false);
        if (!blocked) {
          this.avoidOffset = off;
          break;
        }
      }
    }
    g.desiredYaw += this.avoidOffset;
  }

  _enter(state, player) {
    const prev = this.state;
    this.state = state;
    this.t = 0;
    const g = this.g;
    switch (state) {
      case AI.GRAB_WINDUP:
      case AI.SWIPE_WINDUP: {
        // Attack with the arm on the player's side, if it's still attached.
        const dx = player.pos.x - g.pos.x, dz = player.pos.z - g.pos.z;
        const leftDot = dx * Math.cos(g.yaw) - dz * Math.sin(g.yaw); // + means player on giant's left
        let side = leftDot > 0 ? 'L' : 'R';
        if (!g.hasArm(side)) side = side === 'L' ? 'R' : 'L';
        this.attackSide = side;
        g.events.push({ type: 'windup', kind: state === AI.GRAB_WINDUP ? 'grab' : 'swipe' });
        break;
      }
      case AI.GRAB:
        this.grabHit = false;
        break;
      case AI.HOLD:
        this.released = false;
        break;
      case AI.SWIPE:
        this.swipeDone = false;
        g.events.push({ type: 'swipe' });
        break;
      case AI.RECOVER:
        if (prev === AI.GRAB || prev === AI.HOLD || prev === AI.GRAB_WINDUP) this.grabCD = AI_TIMING.grabCooldown;
        if (prev === AI.SWIPE || prev === AI.SWIPE_WINDUP) this.swipeCD = AI_TIMING.swipeCooldown;
        if (prev === AI.HOLD) g.events.push({ type: 'release' });
        this.grabHit = false;
        break;
      case AI.PURSUE:
        if (prev === AI.WANDER) g.events.push({ type: 'spot' });
        break;
      case AI.SPRINT:
        g.events.push({ type: 'sprint' });
        break;
      case AI.STAGGER:
        this.grabCD = Math.max(this.grabCD, 1);
        break;
    }
  }

  _detect(player, hd) {
    const g = this.g;
    if (!player.alive) return false;
    if (hd < 22) return true; // close enough to hear
    if (hd > g.cfg.detect) return false;
    if (g.abnormal) return true; // abnormals always know
    const head = g.rig.hitboxes[1].world;
    tmp.set(player.pos.x - head.x, player.pos.y + 0.8 - head.y, player.pos.z - head.z);
    const d = tmp.length();
    tmp.divideScalar(d);
    const blocked = this.colliders.raycast(head.x, head.y, head.z, tmp.x, tmp.y, tmp.z, d - 2, losHit, (c) => c.solid, false);
    return !blocked;
  }

  _pickWander(player) {
    const r = this.rng;
    this.wanderTimer = r.range(6, 12);
    const H = CITY.HALF - 20;
    if (r.chance(0.6) && player.alive) {
      // Drift toward the player's area so waves stay engaging.
      this.wanderTarget.set(clamp(player.pos.x + r.range(-70, 70), -H, H), clamp(player.pos.z + r.range(-70, 70), -H, H));
    } else {
      this.wanderTarget.set(r.range(-H, H), r.range(-H, H));
    }
  }

  /** Point the attacking arm at the player (yaw/pitch in the giant's local frame). */
  _aimArm(player, a, side) {
    const g = this.g;
    local.copy(player.pos);
    g.root.worldToLocal(local);
    const s = side === 'L' ? 1 : -1;
    const sx = s * 0.14 * g.H, sy = g.H * 0.8;
    const lx = local.x - sx, ly = local.y - sy, lz = Math.max(0.5, local.z);
    a['reachYaw' + side] = clamp(Math.atan2(lx, lz), -1.2, 1.2);
    a.reachPitch = clamp(Math.atan2(ly, Math.hypot(lx, lz)) + (a.lean || 0), -1.3, 1.3);
  }

  _lookAt(player, a) {
    const g = this.g;
    local.copy(player.pos);
    g.root.worldToLocal(local);
    a.headYaw = clamp(Math.atan2(local.x, Math.max(0.1, local.z)), -0.9, 0.9);
    a.headPitch = clamp(-Math.atan2(local.y - g.H * 0.9, Math.hypot(local.x, local.z)) * 0.6, -0.6, 0.5);
  }

  _twitch(dt, a) {
    this.twitchT -= dt;
    if (this.twitchT < 0) this.twitchT = this.rng.range(0.4, 1.8);
    a.headTilt = this.twitchT < 0.15 ? Math.sin(this.t * 60) * 0.5 : Math.sin(this.t * 1.3) * 0.25;
  }

  /** If walking but not making progress, veer for a moment to slide around obstacles. */
  _handleStuck(dt) {
    const g = this.g;
    if (this.detourT > 0) {
      this.detourT -= dt;
      g.desiredYaw += this.detourSign * 1.3;
    }
    this.stuckCheckT += dt;
    if (this.stuckCheckT >= 1.2) {
      const moved = Math.hypot(g.pos.x - this.stuckFrom.x, g.pos.z - this.stuckFrom.y);
      if (g.desiredSpeed > 1 && moved < g.desiredSpeed * 1.2 * 0.35 && this.detourT <= 0) {
        this.detourT = 1.6;
        this.detourSign = this.rng.chance(0.5) ? 1 : -1;
      }
      this.stuckFrom.set(g.pos.x, g.pos.z);
      this.stuckCheckT = 0;
    }
  }

  get telegraphing() {
    return isWindup(this.state);
  }
}
