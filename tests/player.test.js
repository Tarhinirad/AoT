import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Player } from '../src/player/player.js';
import { StaticColliders } from '../src/world/colliders.js';

/** Walk forward (-z) for `seconds` against the given boxes. */
function walk(boxes, seconds = 2) {
  const col = new StaticColliders();
  for (const b of boxes) col.addBox(...b);
  col.build();
  const p = new Player(new THREE.Vector3(0, 0.45, 5));
  p.grounded = true;
  const intent = { wish: new THREE.Vector3(0, 0, -1), jump: false, hooked: false };
  const dt = 1 / 120;
  for (let i = 0; i < seconds / dt; i++) {
    p.integrate(dt, intent);
    p.collide(col, dt);
  }
  return p;
}

describe('stepping up ledges', () => {
  it('walks up onto a 1.2 m supply-depot platform', () => {
    const p = walk([[-4, 0, -8, 4, 1.2, 0]], 0.9);
    expect(p.pos.y).toBeCloseTo(1.2 + p.radius, 1);
    expect(p.pos.z).toBeLessThan(-2);
    expect(p.grounded).toBe(true);
  });

  it('still stops at a wall taller than a step', () => {
    const p = walk([[-4, 0, -8, 4, 2, 0]]);
    expect(p.pos.y).toBeLessThan(1);
    expect(p.pos.z).toBeGreaterThan(0);
  });

  it("doesn't step into a gap with no head room", () => {
    // Ledge with a beam right above it.
    const p = walk([[-4, 0, -8, 4, 1.0, 0], [-4, 2.0, -8, 4, 6, 0]]);
    expect(p.pos.y).toBeLessThan(1);
    expect(p.pos.z).toBeGreaterThan(0);
  });
});
