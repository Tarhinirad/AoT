import { describe, it, expect } from 'vitest';
import { StaticColliders } from '../src/world/colliders.js';
import { generateCity, buildColliders } from '../src/world/city.js';

function world() {
  const c = new StaticColliders(10);
  c.addBox(-5, 0, -5, 5, 20, 5);
  c.addCylinder(30, 0, 2, 0, 40);
  c.build();
  return c;
}

describe('StaticColliders.raycast', () => {
  it('hits the near face of a box with the correct normal', () => {
    const out = {};
    const hit = world().raycast(-20, 10, 0, 1, 0, 0, 100, out);
    expect(hit).toBe(true);
    expect(out.dist).toBeCloseTo(15);
    expect(out.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  it('hits the side of a cylinder', () => {
    const out = {};
    expect(world().raycast(30, 10, -20, 0, 0, 1, 100, out)).toBe(true);
    expect(out.dist).toBeCloseTo(18);
    expect(out.normal.z).toBeCloseTo(-1);
  });

  it('hits the ground plane when looking down', () => {
    const out = {};
    const d = Math.SQRT1_2;
    expect(world().raycast(-50, 10, -50, 0, -d, d, 100, out)).toBe(true);
    expect(out.collider.tag).toBe('ground');
    expect(out.point.y).toBeCloseTo(0);
  });

  it('respects max distance and filters', () => {
    const out = {};
    expect(world().raycast(-20, 10, 0, 1, 0, 0, 10, out)).toBe(false);
    expect(world().raycast(-20, 10, 0, 1, 0, 0, 100, out, () => false, false)).toBe(false);
  });
});

describe('StaticColliders.resolveSphere', () => {
  it('pushes a sphere out of a box side and reports the normal', () => {
    const c = world();
    const p = { x: 5.2, y: 10, z: 0 };
    const normals = [];
    c.resolveSphere(p, 0.5, (nx, ny, nz) => normals.push([nx, ny, nz]));
    expect(p.x).toBeCloseTo(5.5);
    expect(normals[0]).toEqual([1, 0, 0]);
  });

  it('lands a sphere on a roof', () => {
    const c = world();
    const p = { x: 0, y: 20.2, z: 0 };
    c.resolveSphere(p, 0.5);
    expect(p.y).toBeCloseTo(20.5);
  });

  it('keeps spheres above the ground', () => {
    const p = { x: 100, y: -3, z: 100 };
    world().resolveSphere(p, 0.5);
    expect(p.y).toBeCloseTo(0.5);
  });
});

describe('city generation', () => {
  it('is deterministic and produces anchors and depots', () => {
    const a = generateCity(7), b = generateCity(7);
    expect(a.buildings.length).toBe(b.buildings.length);
    expect(a.buildings.length).toBeGreaterThan(60);
    expect(a.trees.length).toBeGreaterThan(50);
    expect(a.depots.length).toBeGreaterThanOrEqual(3);
    const cols = buildColliders(a, new StaticColliders());
    expect(cols.items.length).toBeGreaterThan(a.buildings.length);
  });

  it('keeps the spawn area clear', () => {
    const cols = buildColliders(generateCity(1337), new StaticColliders());
    const p = { x: 0, y: 3, z: 40 };
    let hits = 0;
    cols.resolveSphere(p, 0.45, (nx, ny, nz, d, c) => { if (c.tag !== 'ground') hits++; });
    expect(hits).toBe(0);
  });
});
