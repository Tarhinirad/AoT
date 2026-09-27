import * as THREE from 'three';
import { buildGiantRig, poseGiant } from './giantRig.js';
import { napeHealth, limbHealth } from '../combat/damage.js';
import { raySphere, dampAngle, angleDelta, clamp } from '../core/math.js';

const tmp = new THREE.Vector3();
const LIMBS = ['armL', 'armR', 'legL', 'legR'];

export const VARIANTS = {
  small: { minH: 4, maxH: 6.5, walk: 3.4, run: 6.5, turn: 2.6, detect: 70, score: 100 },
  medium: { minH: 7.5, maxH: 10.5, walk: 4.2, run: 7.5, turn: 2.0, detect: 85, score: 180 },
  large: { minH: 13, maxH: 15, walk: 5.0, run: 8.5, turn: 1.4, detect: 100, score: 300 },
  abnormal: { minH: 7, maxH: 12, walk: 5.5, run: 17, turn: 4.5, detect: 130, score: 450 },
};

let nextId = 1;

/**
 * A giant: body rig + health pools + movement. Behaviour decisions come from
 * `this.brain` (AI, see ai.js); this class executes them.
 */
export class Giant {
  constructor(scene, { variant = 'medium', height, x = 0, z = 0, yaw = 0, rng }) {
    this.id = nextId++;
    this.variant = variant;
    this.cfg = VARIANTS[variant];
    this.H = height ?? rng.range(this.cfg.minH, this.cfg.maxH);
    this.abnormal = variant === 'abnormal';
    this.rig = buildGiantRig(this.H, rng, this.abnormal);
    this.root = this.rig.root;
    this.scene = scene;
    scene.add(this.root);

    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = yaw;
    this.speed = 0; // current forward speed
    this.desiredSpeed = 0;
    this.desiredYaw = yaw;
    this.turnRate = this.cfg.turn;
    this.radius = this.H * 0.12;

    this.napeMax = napeHealth(this.H);
    this.napeHP = this.napeMax;
    this.limbs = {};
    for (const l of LIMBS) this.limbs[l] = { hp: limbHealth(this.H), max: limbHealth(this.H), severed: false, regen: 0 };

    this.alive = true;
    this.deathT = 0;
    this.removable = false;
    this.flashT = 0;
    this.telegraph = 0; // 0..1 attack windup glow, set by the brain
    this.staggerT = 0;
    this.staggerSide = 1;
    this.anim = { walk: 0, phase: rng.range(0, 6.28), sprint: 0 };
    this.brain = null;
    this.events = [];
    this.stepDist = 0;
    this.lastFootPhase = 0;
    this.updateHitboxes();
  }

  get crippled() {
    return this.limbs.legL.severed || this.limbs.legR.severed;
  }

  /** Point on the nape (for aim/HUD). */
  get napeWorld() {
    return this.rig.hitboxes[0].world;
  }

  hasArm(side) {
    return !this.limbs['arm' + side].severed;
  }

  update(dt, colliders) {
    const a = this.anim;
    if (!this.alive) {
      this.deathT += dt;
      a.fall = Math.min(1, (this.deathT / 1.7) ** 2);
      a.walk = Math.max(0, a.walk - dt * 3);
      if (this.deathT > 5) this.root.position.y = -(this.deathT - 5) * this.H * 0.12;
      if (this.deathT > 9) this.removable = true;
      if (this.deathT > 1.7 && !this._landed) {
        this._landed = true;
        this.events.push({ type: 'bodyfall' });
      }
      this._applyPose();
      return;
    }

    // Limb regeneration
    for (const l of LIMBS) {
      const limb = this.limbs[l];
      if (limb.severed) {
        limb.regen -= dt;
        if (limb.regen <= 0) this._regrow(l);
      }
    }

    // Turn and move (giants walk where they face).
    const crippleMul = this.crippled ? 0.25 : 1;
    this.yaw = dampAngle(this.yaw, this.desiredYaw, this.turnRate * 2, dt);
    const facingErr = Math.abs(angleDelta(this.yaw, this.desiredYaw));
    const turnSlow = clamp(1.2 - facingErr, 0.15, 1);
    const target = this.desiredSpeed * crippleMul * turnSlow;
    this.speed += (target - this.speed) * Math.min(1, dt * 3);
    if (this.staggerT > 0) {
      this.staggerT -= dt;
      this.speed *= 0.9;
    }
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.pos.x += fx * this.speed * dt;
    this.pos.z += fz * this.speed * dt;
    // Giants step over low buildings; bigger ones over more of the city.
    colliders.resolveCircleXZ(this.pos, this.radius, this.H * 0.55);

    // Walk animation phase follows distance travelled.
    const moved = Math.abs(this.speed) * dt;
    const strideLen = this.H * 0.75;
    a.phase += (moved / strideLen) * Math.PI * 2;
    a.walk += (clamp(this.speed / 2, 0, 1) - a.walk) * Math.min(1, dt * 5);
    a.sprint += ((this.speed > this.cfg.walk * 1.4 ? 1 : 0) - a.sprint) * Math.min(1, dt * 3);
    a.crawl = this.crippled ? 1 : 0;
    a.stagger = this.staggerT > 0 ? Math.sin(Math.min(1, this.staggerT / 0.8) * Math.PI) : 0;
    a.staggerSide = this.staggerSide;
    // Footstep events at each foot plant
    const foot = Math.floor(a.phase / Math.PI);
    if (foot !== this.lastFootPhase) {
      this.lastFootPhase = foot;
      if (a.walk > 0.3) this.events.push({ type: 'step' });
    }

    if (this.flashT > 0) this.flashT -= dt;
    this._applyPose();
  }

  _applyPose() {
    this.root.position.x = this.pos.x;
    this.root.position.z = this.pos.z;
    this.root.rotation.y = this.yaw;
    poseGiant(this.rig, this.anim);
    const f = Math.max(0, this.flashT) / 0.15;
    // Windup telegraph: pulsing red glow that speeds up as the attack nears.
    const tg = this.alive ? this.telegraph * (0.55 + 0.45 * Math.sin(performance.now() * 0.02 * (1 + this.telegraph))) : 0;
    this.rig.skin.emissive.setRGB(Math.max(f * 0.8, tg * 0.55), f * 0.25, f * 0.15);
    this.updateHitboxes();
  }

  updateHitboxes() {
    this.root.updateMatrixWorld(true);
    for (const hb of this.rig.hitboxes) {
      hb.world.copy(hb.offset).applyMatrix4(hb.bone.matrixWorld);
    }
  }

  hitboxActive(hb) {
    if (!this.alive) return false;
    if (hb.limb && this.limbs[hb.limb].severed) return false;
    return true;
  }

  /**
   * Ray vs this giant's hitboxes. Fills out.attach so hooks can follow the
   * moving body part.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
    // Broad phase: bounding sphere around the body.
    const cy = this.pos.y + this.H * 0.5;
    const tb = raySphere(ox, oy, oz, dx, dy, dz, this.pos.x, cy, this.pos.z, this.H * 0.75);
    const inside = (ox - this.pos.x) ** 2 + (oy - cy) ** 2 + (oz - this.pos.z) ** 2 < (this.H * 0.75) ** 2;
    if (!inside && (tb < 0 || tb > maxDist)) return false;
    let best = maxDist, bestHb = null;
    for (const hb of this.rig.hitboxes) {
      if (!this.hitboxActive(hb)) continue;
      const t = raySphere(ox, oy, oz, dx, dy, dz, hb.world.x, hb.world.y, hb.world.z, hb.radius);
      if (t >= 0 && t < best) {
        best = t;
        bestHb = hb;
      }
    }
    if (!bestHb) return false;
    out.dist = best;
    out.point = out.point || { x: 0, y: 0, z: 0 };
    out.normal = out.normal || { x: 0, y: 0, z: 0 };
    const px = ox + dx * best, py = oy + dy * best, pz = oz + dz * best;
    out.point.x = px; out.point.y = py; out.point.z = pz;
    const w = bestHb.world;
    const l = Math.hypot(px - w.x, py - w.y, pz - w.z) || 1;
    out.normal.x = (px - w.x) / l; out.normal.y = (py - w.y) / l; out.normal.z = (pz - w.z) / l;
    out.collider = { tag: 'giant', giant: this, hitbox: bestHb };
    const local = bestHb.bone.worldToLocal(new THREE.Vector3(px, py, pz));
    const giant = this, hb = bestHb;
    out.attach = {
      giant,
      valid: () => giant.hitboxActive(hb),
      worldPoint: (o) => o.copy(local).applyMatrix4(hb.bone.matrixWorld),
    };
    return true;
  }

  /**
   * Apply a blade hit.
   * @returns {{part, damage, killed, severed}}
   */
  applyHit(hb, damage, hitDir) {
    const res = { part: hb.kind, damage, killed: false, severed: null };
    if (!this.alive) return res;
    this.flashT = 0.15;
    if (hb.kind === 'nape') {
      this.napeHP -= damage;
      if (this.napeHP <= 0) {
        this.napeHP = 0;
        this.kill(hitDir);
        res.killed = true;
      } else {
        this.stagger(hitDir, 0.9);
      }
    } else if (hb.kind === 'limb') {
      const limb = this.limbs[hb.limb];
      limb.hp -= damage;
      if (limb.hp <= 0 && !limb.severed) {
        this._sever(hb.limb);
        res.severed = hb.limb;
      } else {
        this.stagger(hitDir, 0.4);
      }
    } else if (damage > 0) {
      this.stagger(hitDir, 0.25);
    }
    return res;
  }

  stagger(hitDir, dur) {
    this.staggerT = Math.max(this.staggerT, dur);
    // Which way to lean: from the hit direction relative to facing.
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    this.staggerSide = hitDir && hitDir.x * rx + hitDir.z * rz > 0 ? -1 : 1;
  }

  kill(hitDir) {
    this.alive = false;
    this.deathT = 0;
    this.speed = 0;
    this.stagger(hitDir, 0);
    this.rig.napeMark.visible = false;
    this.events.push({ type: 'death' });
  }

  _limbGroup(limb) {
    const side = limb.endsWith('L') ? 'L' : 'R';
    return limb.startsWith('arm') ? this.rig.arms[side].upper : this.rig.legs[side].hip;
  }

  _sever(limb) {
    const l = this.limbs[limb];
    l.severed = true;
    l.regen = 18;
    const g = this._limbGroup(limb);
    g.updateMatrixWorld(true);
    this.events.push({ type: 'sever', limb, group: g });
    g.visible = false;
    this.staggerT = Math.max(this.staggerT, limb.startsWith('leg') ? 1.2 : 0.7);
  }

  _regrow(limb) {
    const l = this.limbs[limb];
    l.severed = false;
    l.hp = l.max;
    this._limbGroup(limb).visible = true;
    this.events.push({ type: 'regrow', limb });
  }

  /** Push the player's sphere out of the giant's body. */
  resolveSphere(pos, r, vel) {
    if (!this.alive && this.deathT > 2.5) return false;
    // Broad phase
    const dxb = pos.x - this.pos.x, dzb = pos.z - this.pos.z;
    if (dxb * dxb + dzb * dzb > (this.H * 0.7 + r) ** 2) return false;
    let touched = false;
    for (const hb of this.rig.hitboxes) {
      if (hb.kind === 'nape') continue;
      if (hb.limb && this.limbs[hb.limb].severed) continue;
      const w = hb.world;
      tmp.set(pos.x - w.x, pos.y - w.y, pos.z - w.z);
      const d = tmp.length();
      const minD = hb.radius * 0.85 + r;
      if (d >= minD || d < 1e-6) continue;
      tmp.divideScalar(d);
      pos.x += tmp.x * (minD - d);
      pos.y += tmp.y * (minD - d);
      pos.z += tmp.z * (minD - d);
      const vn = vel.x * tmp.x + vel.y * tmp.y + vel.z * tmp.z;
      if (vn < 0) vel.addScaledVector(tmp, -vn);
      touched = true;
    }
    return touched;
  }

  dispose() {
    this.scene.remove(this.root);
    this.rig.skin.dispose();
  }
}
