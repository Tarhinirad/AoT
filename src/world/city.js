import { createRng } from '../core/rng.js';

/**
 * Pure data description of the walled city district. No Three.js here: the
 * layout feeds both the collider set and the render meshes.
 *
 * Coordinates: y up, north = -z. The wall encloses [-HALF, HALF]^2.
 * North band: forest edge. Center: grand plaza with a clock tower.
 * South wall: a breach where giants pour in.
 */
export const CITY = {
  HALF: 230,
  WALL_HEIGHT: 50,
  WALL_THICK: 10,
  BREACH_HALF: 22,
  FOREST_Z0: -226,
  FOREST_Z1: -150,
  BLOCK: 32,
  STREET: 13,
  PLAZA_R: 44,
};

const PLASTER = [0xe8dcc2, 0xd9c7a3, 0xcfb58c, 0xe3d3b3, 0xc9b79c, 0xbfa88a, 0xd8cdb8, 0xa89880];
const ROOF = [0xa0492d, 0x8f3e27, 0xb45a36, 0x6e5446, 0x5b6770, 0x7a3a2a];

export function generateCity(seed = 1337) {
  const rng = createRng(seed);
  const { HALF, BLOCK, STREET, PLAZA_R } = CITY;
  const buildings = [];
  const trees = [];
  const squares = [];

  const pitch = BLOCK + STREET;
  const cityZ0 = CITY.FOREST_Z1 + 8;
  const maxI = Math.floor((HALF - 14) / pitch);

  for (let i = -maxI; i <= maxI; i++) {
    for (let j = -maxI; j <= maxI; j++) {
      const cx = i * pitch;
      const cz = j * pitch;
      const x0 = cx - BLOCK / 2, x1 = cx + BLOCK / 2;
      const z0 = cz - BLOCK / 2, z1 = cz + BLOCK / 2;
      if (x0 < -HALF + 12 || x1 > HALF - 12 || z1 > HALF - 30 || z0 < cityZ0) continue;
      const distC = Math.hypot(cx, cz);
      if (distC < PLAZA_R + 8) continue; // grand plaza
      // Keep an open approach corridor from the breach to the city.
      if (Math.abs(cx) < 10 && cz > HALF - 80) continue;
      // Scatter a few open squares (supply depots live in some of them).
      if (squares.length < 4 && rng.chance(0.06) && distC > 90) {
        squares.push({ x: cx, z: cz, size: BLOCK });
        continue;
      }
      subdivideBlock(rng, buildings, x0, z0, x1, z1, distC);
    }
  }
  // Guarantee at least two squares for depots.
  while (squares.length < 2) {
    const b = buildings.splice(Math.floor(rng.next() * buildings.length), 1)[0];
    const cx = Math.round(b.x / pitch) * pitch, cz = Math.round(b.z / pitch) * pitch;
    for (let k = buildings.length - 1; k >= 0; k--) {
      const o = buildings[k];
      if (Math.abs(o.x - cx) < BLOCK / 2 + 1 && Math.abs(o.z - cz) < BLOCK / 2 + 1) buildings.splice(k, 1);
    }
    squares.push({ x: cx, z: cz, size: BLOCK });
  }

  // Clock tower in the plaza: tall, easy anchor.
  buildings.push({ x: 0, z: 0, w: 8, d: 8, h: 64, roof: 'spire', roofH: 14, color: 0xcbbd9f, roofColor: 0x4f5d66, tower: true });
  // Plaza colonnade pillars
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    buildings.push({
      x: Math.cos(a) * 30, z: Math.sin(a) * 30, w: 3, d: 3, h: 22,
      roof: 'flat', roofH: 0, color: 0xd6ccb4, roofColor: 0xd6ccb4, pillar: true,
    });
  }

  // Forest edge: tall trees filling the northern band, thinning toward the city.
  for (let z = CITY.FOREST_Z0 + 6; z < CITY.FOREST_Z1 + 10; z += 11) {
    for (let x = -HALF + 8; x < HALF - 8; x += 11) {
      const edge = (z - CITY.FOREST_Z0) / (CITY.FOREST_Z1 - CITY.FOREST_Z0);
      if (rng.chance(edge * 0.55)) continue;
      const tx = x + rng.range(-4, 4), tz = z + rng.range(-4, 4);
      const h = rng.range(30, 52);
      trees.push({ x: tx, z: tz, h, r: rng.range(0.9, 1.6), canopyR: rng.range(5, 8), canopyY: h * rng.range(0.42, 0.55) });
    }
  }
  // Some big trees outside the wall for scenery (non-colliding handled by view).
  const outerTrees = [];
  for (let k = 0; k < 220; k++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(HALF + 30, HALF + 420);
    outerTrees.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, h: rng.range(14, 30), canopyR: rng.range(4, 7) });
  }

  // Outer wall with a breach in the south side.
  const { WALL_HEIGHT: WH, WALL_THICK: WT, BREACH_HALF: BH } = CITY;
  const wall = [
    { minX: -HALF - WT, maxX: HALF + WT, minZ: -HALF - WT, maxZ: -HALF }, // north
    { minX: -HALF - WT, maxX: -BH, minZ: HALF, maxZ: HALF + WT }, // south-west
    { minX: BH, maxX: HALF + WT, minZ: HALF, maxZ: HALF + WT }, // south-east
    { minX: -HALF - WT, maxX: -HALF, minZ: -HALF, maxZ: HALF }, // west
    { minX: HALF, maxX: HALF + WT, minZ: -HALF, maxZ: HALF }, // east
  ].map((w) => ({ ...w, minY: 0, maxY: WH }));
  // Rubble at the breach (low, hookable blocks).
  const rubble = [];
  for (let k = 0; k < 9; k++) {
    const s = rng.range(2, 5);
    rubble.push({ x: rng.range(-BH, BH), z: HALF + rng.range(-6, 14), w: s, d: s * rng.range(0.7, 1.3), h: s * 0.6, rot: rng.range(0, 1) });
  }

  // Supply depots: one on the plaza, others in the open squares.
  const depots = [{ x: 0, z: 30 }];
  for (const sq of squares.slice(0, 3)) depots.push({ x: sq.x, z: sq.z });

  // Giant spawn points: the breach, and deep in the forest.
  const spawns = [
    { x: 0, z: HALF + 30, kind: 'breach' },
    { x: -8, z: HALF + 45, kind: 'breach' },
    { x: 10, z: HALF + 50, kind: 'breach' },
    { x: -150, z: -210, kind: 'forest' },
    { x: 0, z: -215, kind: 'forest' },
    { x: 150, z: -210, kind: 'forest' },
  ];

  return { buildings, trees, outerTrees, wall, rubble, depots, spawns, squares, half: HALF };
}

function subdivideBlock(rng, out, x0, z0, x1, z1, distC) {
  const r = rng.next();
  const lots = [];
  if (r < 0.2) {
    lots.push([x0, z0, x1, z1]);
  } else if (r < 0.55) {
    if (rng.chance(0.5)) {
      const m = rng.range(x0 + 11, x1 - 11);
      lots.push([x0, z0, m, z1], [m, z0, x1, z1]);
    } else {
      const m = rng.range(z0 + 11, z1 - 11);
      lots.push([x0, z0, x1, m], [x0, m, x1, z1]);
    }
  } else {
    const mx = rng.range(x0 + 11, x1 - 11), mz = rng.range(z0 + 11, z1 - 11);
    lots.push([x0, z0, mx, mz], [mx, z0, x1, mz], [x0, mz, mx, z1], [mx, mz, x1, z1]);
  }
  const central = 1 - Math.min(1, distC / 260);
  for (const [a, b, c, d] of lots) {
    const inset = 0.8;
    const w = c - a - inset * 2, dd = d - b - inset * 2;
    if (w < 5 || dd < 5) continue;
    const roll = rng.next();
    let h, roof, roofH;
    const towerChance = 0.07 + central * 0.16;
    if (roll < towerChance) {
      h = rng.range(34, 56);
      roof = rng.chance(0.6) ? 'spire' : 'flat';
      roofH = roof === 'spire' ? rng.range(6, 12) : 0;
    } else if (roll < towerChance + 0.25) {
      h = rng.range(19, 30);
      roof = rng.chance(0.5) ? 'gable' : 'flat';
      roofH = roof === 'gable' ? rng.range(3, 5) : 0;
    } else {
      h = rng.range(9, 17);
      roof = 'gable';
      roofH = rng.range(2.5, 4.5);
    }
    // Towers occupy only part of their lot.
    let bw = w, bd = dd;
    if (h > 34) {
      bw = Math.min(w, rng.range(9, 14));
      bd = Math.min(dd, rng.range(9, 14));
    }
    out.push({
      x: (a + c) / 2, z: (b + d) / 2, w: bw, d: bd, h, roof, roofH,
      color: rng.pick(PLASTER), roofColor: rng.pick(ROOF), tower: h > 34,
    });
  }
}

/** Register every static piece of the city in a collider set. */
export function buildColliders(city, colliders) {
  for (const b of city.buildings) {
    // Gable roofs: approximate with a box half-way up the roof.
    const top = b.h + (b.roof === 'gable' ? b.roofH * 0.5 : 0);
    colliders.addBox(b.x - b.w / 2, 0, b.z - b.d / 2, b.x + b.w / 2, top, b.z + b.d / 2, { tag: 'building' });
    if (b.roof === 'spire') {
      // Spire: a thinner column so hooks can catch it.
      const s = Math.min(b.w, b.d) * 0.3;
      colliders.addBox(b.x - s, b.h, b.z - s, b.x + s, b.h + b.roofH * 0.7, b.z + s, { tag: 'spire' });
    }
  }
  for (const t of city.trees) {
    colliders.addCylinder(t.x, t.z, t.r, 0, t.h * 0.97, { tag: 'tree' });
    // Canopy: hookable but not solid (the player passes through leaves).
    colliders.addCylinder(t.x, t.z, t.canopyR * 0.55, t.canopyY, t.h * 0.95, { tag: 'canopy', solid: false });
  }
  for (const w of city.wall) {
    colliders.addBox(w.minX, w.minY, w.minZ, w.maxX, w.maxY, w.maxZ, { tag: 'wall' });
  }
  for (const r of city.rubble) {
    colliders.addBox(r.x - r.w / 2, 0, r.z - r.d / 2, r.x + r.w / 2, r.h, r.z + r.d / 2, { tag: 'rubble' });
  }
  for (const d of city.depots) {
    colliders.addBox(d.x - 4, 0, d.z - 4, d.x + 4, 1.2, d.z + 4, { tag: 'depot' });
  }
  colliders.build();
  return colliders;
}
