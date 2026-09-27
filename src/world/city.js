import { createRng } from '../core/rng.js';

/**
 * Pure data description of the walled medieval town of Aldmere. No Three.js
 * here: the layout feeds both the collider set and the render meshes.
 *
 * Coordinates: y up, north = -z. The curtain wall encloses [-HALF, HALF]^2.
 * North band: forest edge. Center: market square with the cathedral bell
 * tower. South wall: the broken main gate where giants pour in.
 *
 * Building styles:
 *   house  half-timbered row house (stone ground floor, jettied upper floors, steep gable)
 *   hall   guild hall (taller stone base, timber upper floors, steep gable)
 *   round  round stone tower with a conical slate roof (cylinder collider)
 *   keep   square stone tower, crenellated or with a pyramid spire
 *   bell   the cathedral bell tower in the market square
 *   pillar market-square column topped by a fire brazier
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
  PLINTH: 3.2, // stone ground floor height of houses
  JETTY: 0.45, // how far the upper floors of a house overhang the street
};

// Limewash plasters (warm whites, ochres, a few pastel pinks and greens).
const PLASTER = [0xefe2c4, 0xe6cf9c, 0xdcb97a, 0xf0e4cf, 0xd9bf94, 0xe7c3a6, 0xcfd2b0, 0xe2b88f, 0xc9d3c4, 0xe6c2b4, 0xd8a878, 0xeadcb8];
const TILE = [0xa4472a, 0x8e3b24, 0xb4552f, 0x9a4a2e, 0x7d3a26, 0xae5a36];
const SLATE = [0x4b5560, 0x55606b, 0x3f4852, 0x5d5a66];
const STONE = [0xb5a58a, 0xa89a82, 0xbfb198, 0x9f937d, 0xc2b497];
const BANNER = [0x8c1c1c, 0x1f3f7a, 0x8c1c1c, 0x2f5a2a, 0x6b1e4f];

export function generateCity(seed = 1337) {
  const rng = createRng(seed);
  const { HALF, BLOCK, STREET, PLAZA_R } = CITY;
  const buildings = [];
  const trees = [];
  const squares = [];
  const chimneys = [];
  const banners = [];
  const props = []; // barrels and crates: {kind, x, z, s, rot}
  const lanterns = []; // wall lanterns: {x, y, z}

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
      if (distC < PLAZA_R + 8) continue; // market square
      // Keep an open approach corridor from the broken gate to the city.
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

  // Cathedral bell tower in the market square: tall, easy anchor.
  buildings.push({ x: 0, z: 0, w: 9, d: 9, h: 64, roof: 'spire', roofH: 18, color: 0xc4b598, roofColor: 0x4b5560, style: 'bell', tower: true });
  // Market-square columns, each crowned with a fire brazier.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    buildings.push({
      x: Math.cos(a) * 30, z: Math.sin(a) * 30, w: 1.8, d: 1.8, h: 14,
      roof: 'flat', roofH: 0, color: 0xcfc2a6, roofColor: 0xcfc2a6, style: 'pillar', pillar: true,
    });
  }

  // Market stalls between the tower and the columns (low, so giants step over them).
  const stalls = [];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + rng.range(-0.08, 0.08);
    // Leave the south approach (spawn and depot) open.
    if (Math.abs(angleDelta(a, Math.PI / 2)) < 0.35) continue;
    const r = rng.chance(0.5) ? 17 : 22.5;
    stalls.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, rot: -a + Math.PI / 2, w: 3.4, d: 2.2, h: 3.0, color: rng.pick([0xb8322a, 0x2b5c9a, 0xd9a13a, 0x3f7a3a, 0x8a3a7a]) });
  }

  // Details on buildings: chimneys, banners, lanterns, barrels and crates.
  for (const b of buildings) {
    if (b.style === 'house' || b.style === 'hall') {
      const alongZ = b.d >= b.w;
      const halfW = (alongZ ? b.w : b.d) / 2;
      if (rng.chance(0.7)) {
        const off = halfW * 0.4 * (rng.chance(0.5) ? 1 : -1);
        const along = (alongZ ? b.d : b.w) * rng.range(-0.3, 0.3);
        chimneys.push({
          x: b.x + (alongZ ? off : along), z: b.z + (alongZ ? along : off),
          y0: b.h + b.roofH * 0.5, top: b.h + b.roofH + rng.range(0.8, 1.8), w: rng.range(0.7, 1.0),
        });
      }
      if (rng.chance(0.35)) {
        // Lantern on a corner of the street face.
        const sx = rng.chance(0.5) ? 1 : -1, sz = rng.chance(0.5) ? 1 : -1;
        const faceX = rng.chance(0.5);
        lanterns.push({
          x: b.x + (faceX ? sx * (b.w / 2 + 0.35) : sx * (b.w / 2 - 0.8)),
          y: CITY.PLINTH + 0.4,
          z: b.z + (faceX ? sz * (b.d / 2 - 0.8) : sz * (b.d / 2 + 0.35)),
        });
      }
      if (rng.chance(0.22)) {
        const sx = rng.chance(0.5) ? 1 : -1, sz = rng.chance(0.5) ? 1 : -1;
        const px = b.x + sx * (b.w / 2 + 0.7), pz = b.z + sz * (b.d / 2 - 1.2);
        const n = 1 + Math.floor(rng.next() * 3);
        for (let q = 0; q < n; q++) {
          props.push({ kind: rng.chance(0.55) ? 'barrel' : 'crate', x: px, z: pz - sz * q * 1.05, s: rng.range(0.85, 1.05), rot: rng.range(0, 6.28) });
        }
      }
    }
    if ((b.style === 'keep' || b.style === 'round' || b.style === 'hall') && rng.chance(0.55)) {
      const side = Math.floor(rng.next() * 4);
      const nx = [1, -1, 0, 0][side], nz = [0, 0, 1, -1][side];
      const half = b.style === 'round' ? b.w / 2 : nx ? b.w / 2 : b.d / 2;
      const bh = Math.min(12, b.h * 0.35);
      banners.push({
        x: b.x + nx * (half + 0.08), z: b.z + nz * (half + 0.08), y: b.h - 2 - bh / 2 - (b.style === 'hall' ? 0 : 3),
        rotY: Math.atan2(nx, nz), w: Math.min(3.2, (nx ? b.d : b.w) * 0.35), h: bh, color: rng.pick(BANNER),
      });
    }
  }
  // The bell tower flies the town colours on all four faces.
  for (let s = 0; s < 4; s++) {
    const nx = [1, -1, 0, 0][s], nz = [0, 0, 1, -1][s];
    banners.push({ x: nx * 4.58, z: nz * 4.58, y: 29, rotY: Math.atan2(nx, nz), w: 3.6, h: 16, color: 0x8c1c1c });
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
  // Scenery outside the wall (non-colliding).
  const outerTrees = [];
  for (let k = 0; k < 420; k++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(HALF + 30, HALF + 520);
    outerTrees.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, h: rng.range(12, 30), canopyR: rng.range(3.5, 7), broad: rng.chance(0.35) });
  }

  // Curtain wall with a breach where the south gate stood.
  const { WALL_HEIGHT: WH, WALL_THICK: WT, BREACH_HALF: BH } = CITY;
  const wall = [
    { minX: -HALF - WT, maxX: HALF + WT, minZ: -HALF - WT, maxZ: -HALF }, // north
    { minX: -HALF - WT, maxX: -BH, minZ: HALF, maxZ: HALF + WT }, // south-west
    { minX: BH, maxX: HALF + WT, minZ: HALF, maxZ: HALF + WT }, // south-east
    { minX: -HALF - WT, maxX: -HALF, minZ: -HALF, maxZ: HALF }, // west
    { minX: HALF, maxX: HALF + WT, minZ: -HALF, maxZ: HALF }, // east
  ].map((w) => ({ ...w, minY: 0, maxY: WH }));
  // Round towers along the wall: corners, midpoints, and the two flanking the broken gate.
  const C = HALF + WT / 2;
  const wallTowers = [
    [-C, -C], [C, -C], [-C, C], [C, C],
    [0, -C], [-115, -C], [115, -C],
    [-C, 0], [-C, -115], [-C, 115],
    [C, 0], [C, -115], [C, 115],
    [-(BH + 11), C], [BH + 11, C], [-125, C], [125, C],
  ].map(([x, z]) => ({ x, z, r: 9, h: WH + 10, roofH: 14 }));
  // Rubble at the breach (low, hookable blocks).
  const rubble = [];
  for (let k = 0; k < 9; k++) {
    const s = rng.range(2, 5);
    rubble.push({ x: rng.range(-BH, BH), z: HALF + rng.range(-6, 14), w: s, d: s * rng.range(0.7, 1.3), h: s * 0.6, rot: rng.range(0, 1) });
  }
  // Huge banners down the inner face of the wall.
  for (let t = -180; t <= 180; t += 90) {
    banners.push({ x: t, z: -HALF + 0.1, y: 36, rotY: 0, w: 7, h: 20, color: 0x8c1c1c, big: true });
    banners.push({ x: -HALF + 0.1, z: t, y: 36, rotY: Math.PI / 2, w: 7, h: 20, color: 0x1f3f7a, big: true });
    banners.push({ x: HALF - 0.1, z: t, y: 36, rotY: -Math.PI / 2, w: 7, h: 20, color: 0x1f3f7a, big: true });
  }

  // Supply depots: one on the square, others in the open squares.
  const depots = [{ x: 0, z: 30 }];
  for (const sq of squares.slice(0, 3)) depots.push({ x: sq.x, z: sq.z });

  // Giant spawn points: just inside the breach, and deep in the forest.
  const spawns = [
    { x: 0, z: HALF - 8, kind: 'breach' },
    { x: -12, z: HALF - 14, kind: 'breach' },
    { x: 12, z: HALF - 14, kind: 'breach' },
    { x: -160, z: -205, kind: 'forest' },
    { x: -60, z: -212, kind: 'forest' },
    { x: 60, z: -212, kind: 'forest' },
    { x: 160, z: -205, kind: 'forest' },
  ];

  return {
    buildings, trees, outerTrees, wall, wallTowers, rubble, depots, spawns, squares,
    stalls, chimneys, banners, props, lanterns, half: HALF,
  };
}

function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
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
    const cx = (a + c) / 2, cz = (b + d) / 2;
    const roll = rng.next();
    const towerChance = 0.07 + central * 0.16;
    if (roll < towerChance) {
      // Towers occupy only part of their lot.
      const h = rng.range(34, 56);
      if (rng.chance(0.5)) {
        const s = Math.min(w, dd, rng.range(9, 13));
        out.push({ x: cx, z: cz, w: s, d: s, h, roof: 'cone', roofH: rng.range(9, 15), color: rng.pick(STONE), roofColor: rng.pick(SLATE), style: 'round', tower: true });
      } else {
        const spire = rng.chance(0.5);
        out.push({
          x: cx, z: cz, w: Math.min(w, rng.range(9, 14)), d: Math.min(dd, rng.range(9, 14)), h,
          roof: spire ? 'spire' : 'flat', roofH: spire ? rng.range(8, 14) : 0,
          color: rng.pick(STONE), roofColor: rng.pick(SLATE), style: 'keep', tower: true,
        });
      }
    } else if (roll < towerChance + 0.25) {
      const h = rng.range(16, 23);
      const roofH = Math.min(12, Math.min(w, dd) * rng.range(0.4, 0.55));
      out.push({ x: cx, z: cz, w, d: dd, h, roof: 'gable', roofH, color: rng.pick(PLASTER), roofColor: rng.pick(TILE), style: 'hall' });
    } else {
      // Rows of narrow half-timbered houses. Deep lots get two rows back to back,
      // so every house has a street front and the skyline is a jumble of gables.
      const alongX = w >= dd;
      const len = alongX ? w : dd;
      const depth = alongX ? dd : w;
      const rows = depth > 15 ? 2 : 1;
      const rowD = depth / rows;
      for (let rI = 0; rI < rows; rI++) {
        const n = Math.max(1, Math.min(5, Math.floor(len / rng.range(6, 8.5))));
        const cut = len / n;
        const baseH = rng.range(10, 14.5);
        const d0 = (alongX ? b + inset : a + inset) + rowD * rI;
        for (let k = 0; k < n; k++) {
          const s0 = (alongX ? a + inset : b + inset) + cut * k;
          const hw = alongX ? cut - 0.3 : rowD - (rows > 1 ? 0.15 : 0);
          const hd = alongX ? rowD - (rows > 1 ? 0.15 : 0) : cut - 0.3;
          const h = Math.max(8.5, baseH + rng.range(-2.5, 3.5));
          const hx = alongX ? s0 + cut / 2 : d0 + rowD / 2;
          const hz = alongX ? d0 + rowD / 2 : s0 + cut / 2;
          const span = Math.min(hw, hd);
          // Jetties overhang the street, never a neighbour or the house behind.
          const front = CITY.JETTY;
          out.push({
            x: hx, z: hz, w: hw, d: hd, h, roof: 'gable', roofH: Math.min(8.5, Math.max(3.5, span * rng.range(0.65, 0.9))),
            color: rng.pick(PLASTER), roofColor: rng.pick(TILE), style: 'house',
            jx: alongX ? (n > 1 ? 0 : front) : rows > 1 ? 0 : front,
            jz: alongX ? (rows > 1 ? 0 : front) : n > 1 ? 0 : front,
          });
        }
      }
    }
  }
}

/** Register every static piece of the city in a collider set. */
export function buildColliders(city, colliders) {
  for (const b of city.buildings) {
    if (b.style === 'round') {
      colliders.addCylinder(b.x, b.z, b.w / 2, 0, b.h, { tag: 'building' });
      colliders.addCylinder(b.x, b.z, b.w * 0.3, b.h, b.h + b.roofH * 0.65, { tag: 'spire' });
      continue;
    }
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
  for (const t of city.wallTowers || []) {
    colliders.addCylinder(t.x, t.z, t.r, 0, t.h, { tag: 'wall' });
  }
  for (const r of city.rubble) {
    colliders.addBox(r.x - r.w / 2, 0, r.z - r.d / 2, r.x + r.w / 2, r.h, r.z + r.d / 2, { tag: 'rubble' });
  }
  for (const s of city.stalls || []) {
    const hw = Math.max(s.w, s.d) / 2;
    colliders.addBox(s.x - hw * 0.8, 0, s.z - hw * 0.8, s.x + hw * 0.8, s.h, s.z + hw * 0.8, { tag: 'stall' });
  }
  for (const p of city.props || []) {
    const r = 0.5 * p.s;
    colliders.addBox(p.x - r, 0, p.z - r, p.x + r, 1.1 * p.s, p.z + r, { tag: 'prop', hookable: false });
  }
  for (const d of city.depots) {
    colliders.addBox(d.x - 4, 0, d.z - 4, d.x + 4, 1.2, d.z + 4, { tag: 'depot' });
  }
  colliders.build();
  return colliders;
}
