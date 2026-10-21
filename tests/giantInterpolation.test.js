import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Giant } from '../src/giants/giant.js';
import { StaticColliders } from '../src/world/colliders.js';
import { createRng } from '../src/core/rng.js';

function walkingGiant() {
  const scene = new THREE.Scene();
  const colliders = new StaticColliders();
  colliders.build();
  const g = new Giant(scene, { variant: 'medium', x: 0, z: 0, yaw: 0, rng: createRng(7) });
  g.desiredSpeed = 6;
  g.desiredYaw = 0.5;
  for (let i = 0; i < 60; i++) g.update(1 / 120, colliders);
  return { g, colliders };
}

describe('giant render interpolation', () => {
  it('places the body between the last two physics steps', () => {
    const { g } = walkingGiant();
    expect(g.pos.distanceTo(g.prevPos)).toBeGreaterThan(0);
    g.interpolate(0);
    expect(g.root.position.x).toBeCloseTo(g.prevPos.x, 6);
    expect(g.root.position.z).toBeCloseTo(g.prevPos.z, 6);
    expect(g.root.rotation.y).toBeCloseTo(g.prevYaw, 6);
    g.interpolate(0.5);
    expect(g.root.position.x).toBeCloseTo((g.prevPos.x + g.pos.x) / 2, 6);
    g.interpolate(1);
    expect(g.root.position.z).toBeCloseTo(g.pos.z, 6);
    expect(g.root.rotation.y).toBeCloseTo(g.yaw, 6);
  });

  it('turns the short way across ±π', () => {
    const { g } = walkingGiant();
    g.prevYaw = Math.PI - 0.05;
    g.yaw = -Math.PI + 0.05;
    g.interpolate(0.5);
    expect(Math.abs(Math.abs(g.root.rotation.y) - Math.PI)).toBeLessThan(1e-6);
  });

  it('the next physics step restores the simulated pose for hitboxes', () => {
    const { g, colliders } = walkingGiant();
    g.interpolate(0);
    g.update(1 / 120, colliders);
    expect(g.root.position.x).toBeCloseTo(g.pos.x, 6);
    expect(g.root.position.z).toBeCloseTo(g.pos.z, 6);
  });
});
