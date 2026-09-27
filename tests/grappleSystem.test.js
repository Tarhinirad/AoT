import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GrappleSystem } from '../src/grapple/grappleSystem.js';
import { GRAPPLE } from '../src/grapple/ropeMath.js';
import { Player, PLAYER_CONFIG } from '../src/player/player.js';

const noRaycast = () => false;

function hooked(anchor, playerPos) {
  const g = new GrappleSystem();
  const p = new Player(playerPos);
  const h = g.hooks[1];
  h.state = 'attached';
  h.anchor.copy(anchor);
  h.tip.copy(anchor);
  h.length = anchor.distanceTo(playerPos);
  return { g, p };
}

function step(g, p, controls, dt = 1 / 120) {
  g.updateOrigins(p.pos, new THREE.Vector3(1, 0, 0));
  g.step(dt, p, controls, noRaycast);
  const hooked = g.attachedCount > 0;
  p.integrate(dt, { wish: controls.wish, jump: false, hooked, dragScale: hooked ? GRAPPLE.hookedDragScale : 1 });
  g.constrain(p);
}

describe('GrappleSystem', () => {
  it('reeling into a wall arrives gently instead of crashing', () => {
    const anchor = new THREE.Vector3(0, 20, -40);
    const { g, p } = hooked(anchor, new THREE.Vector3(0, 20, 0));
    const controls = { reel: [false, true], boost: true, look: new THREE.Vector3(0, 0, -1), wish: new THREE.Vector3() };
    let arrival = null;
    let top = 0;
    for (let i = 0; i < 120 * 6 && arrival === null; i++) {
      step(g, p, controls);
      top = Math.max(top, p.speed);
      if (p.pos.distanceTo(anchor) < 1.6) arrival = p.speed;
    }
    expect(arrival).not.toBeNull();
    expect(top).toBeGreaterThan(20); // it's still a fast zip across the gap
    expect(arrival).toBeLessThan(PLAYER_CONFIG.impactDamageSpeed * 0.5);
  });

  it('WASD steers a hanging swing sideways', () => {
    const anchor = new THREE.Vector3(0, 30, 0);
    const { g, p } = hooked(anchor, new THREE.Vector3(0, 10, 0));
    const controls = { reel: [false, false], boost: false, look: new THREE.Vector3(0, 0, -1), wish: new THREE.Vector3(1, 0, 0) };
    for (let i = 0; i < 60; i++) step(g, p, controls);
    expect(p.vel.x).toBeGreaterThan(8);
    expect(p.pos.distanceTo(anchor)).toBeLessThanOrEqual(20 + 1e-6);
  });

  it('letting go at speed slingshots, letting go slowly does not', () => {
    const fast = hooked(new THREE.Vector3(0, 30, 0), new THREE.Vector3(0, 10, 0));
    fast.p.vel.set(30, 0, 0);
    fast.g.releaseAll(fast.p);
    expect(fast.p.speed).toBeGreaterThan(30);
    expect(fast.g.events.at(-1).boost).toBeGreaterThan(0);

    const slow = hooked(new THREE.Vector3(0, 30, 0), new THREE.Vector3(0, 10, 0));
    slow.p.vel.set(5, 0, 0);
    slow.g.releaseAll(slow.p);
    expect(slow.p.speed).toBeCloseTo(5);
    // Forced releases (grabs, swipes) never boost.
    const forced = hooked(new THREE.Vector3(0, 30, 0), new THREE.Vector3(0, 10, 0));
    forced.p.vel.set(30, 0, 0);
    forced.g.releaseAll();
    expect(forced.p.speed).toBeCloseTo(30);
  });

  it('recharges gas after a pause in use', () => {
    const g = new GrappleSystem();
    const p = new Player(new THREE.Vector3(0, 50, 0));
    g.gas = 10;
    const controls = { reel: [false, false], boost: false, look: new THREE.Vector3(0, 0, -1), wish: new THREE.Vector3() };
    for (let i = 0; i < 120 * 3; i++) step(g, p, controls);
    expect(g.gas).toBeGreaterThan(14);
    expect(g.gas).toBeLessThanOrEqual(GRAPPLE.gasRegenCap);
  });
});
