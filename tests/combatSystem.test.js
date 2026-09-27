import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Giant } from '../src/giants/giant.js';
import { CombatSystem } from '../src/combat/combatSystem.js';
import { createRng } from '../src/core/rng.js';
import { StaticColliders } from '../src/world/colliders.js';

function setup(height = 9) {
  const scene = new THREE.Scene();
  const giant = new Giant(scene, { variant: 'medium', height, x: 0, z: 0, yaw: Math.PI, rng: createRng(5) });
  const cols = new StaticColliders();
  cols.build();
  giant.update(1 / 120, cols); // pose + hitboxes
  return { giant, cols, combat: new CombatSystem() };
}

/** Fly the player in a straight line through `target` at `speed`, slashing at `slashAt` meters out. */
function pass({ giant, cols, combat }, target, dir, speed, slashAt, hold = true) {
  const player = { pos: new THREE.Vector3(), vel: dir.clone().multiplyScalar(speed), get speed() { return this.vel.length(); } };
  player.pos.copy(target).addScaledVector(dir, -12);
  const dt = 1 / 120;
  let slashed = false;
  for (let i = 0; i < 400; i++) {
    const d = player.pos.distanceTo(target);
    if (!slashed && d <= slashAt) {
      combat.trySlash();
      slashed = true;
    }
    combat.held = hold && slashed;
    combat.step(dt, player, dir, [giant]);
    player.pos.addScaledVector(player.vel, dt);
    giant.update(dt, cols);
    if (player.pos.distanceTo(target) > 14 && i > 10) break;
  }
  return combat.events;
}

describe('CombatSystem slash resolution', () => {
  it('a fast pass straight through the nape kills', () => {
    const s = setup();
    const nape = s.giant.napeWorld.clone();
    // Approach from behind-left, slightly above.
    const dir = new THREE.Vector3(0.3, -0.2, 1).normalize();
    const ev = pass(s, nape, dir, 45, 6);
    expect(ev.find((e) => e.type === 'kill')).toBeTruthy();
    expect(s.giant.alive).toBe(false);
  });

  it('does not waste the swing on an arm when the nape is imminent', () => {
    const s = setup();
    const nape = s.giant.napeWorld.clone();
    // Come in low from the side so an arm/shoulder enters range first.
    const dir = new THREE.Vector3(1, 0.15, 0.2).normalize();
    const ev = pass(s, nape, dir, 55, 7);
    const hits = ev.filter((e) => e.type === 'hit' || e.type === 'kill');
    expect(hits.length).toBe(1);
    expect(hits[0].part).toBe('nape');
  });

  it('a slow nape hit only wounds a large giant', () => {
    const s = setup(15);
    const nape = s.giant.napeWorld.clone();
    const ev = pass(s, nape, new THREE.Vector3(0, 0, 1), 8, 2);
    const hit = ev.find((e) => e.type === 'hit');
    expect(hit?.part).toBe('nape');
    expect(s.giant.alive).toBe(true);
  });

  it('a tap slash (not held) expires after the short window', () => {
    const s = setup();
    const nape = s.giant.napeWorld.clone();
    // Slash far too early without holding: nothing in range during the window.
    const ev = pass(s, nape, new THREE.Vector3(0, 0, 1), 30, 11, false);
    expect(ev.filter((e) => e.type === 'hit' || e.type === 'kill').length).toBe(0);
  });
});
