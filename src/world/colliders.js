/**
 * Static world collision: axis-aligned boxes and vertical cylinders, plus the
 * y=0 ground plane. Pure JS (no Three.js) so it can be unit tested and reused
 * by giants, hooks and the camera. A uniform XZ grid accelerates sphere queries.
 */
const EPS = 1e-6;

export class StaticColliders {
  constructor(cellSize = 24) {
    this.cellSize = cellSize;
    this.items = [];
    this.grid = new Map();
    this._stamp = 0;
    this._cands = [];
  }

  /** opts: { solid=true, hookable=true, tag } */
  addBox(minX, minY, minZ, maxX, maxY, maxZ, opts = {}) {
    const c = {
      type: 0,
      minX, minY, minZ, maxX, maxY, maxZ,
      solid: opts.solid !== false,
      hookable: opts.hookable !== false,
      tag: opts.tag || 'building',
      _stamp: 0,
    };
    this.items.push(c);
    return c;
  }

  /** Vertical cylinder centered at (x, z) spanning y0..y1. */
  addCylinder(x, z, radius, y0, y1, opts = {}) {
    const c = {
      type: 1,
      x, z, r: radius, minY: y0, maxY: y1,
      minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius,
      solid: opts.solid !== false,
      hookable: opts.hookable !== false,
      tag: opts.tag || 'tree',
      _stamp: 0,
    };
    this.items.push(c);
    return c;
  }

  _key(ix, iz) {
    return (ix + 1000) * 4096 + (iz + 1000);
  }

  build() {
    this.grid.clear();
    const cs = this.cellSize;
    for (const c of this.items) {
      const x0 = Math.floor(c.minX / cs), x1 = Math.floor(c.maxX / cs);
      const z0 = Math.floor(c.minZ / cs), z1 = Math.floor(c.maxZ / cs);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = this._key(ix, iz);
          let cell = this.grid.get(k);
          if (!cell) this.grid.set(k, (cell = []));
          cell.push(c);
        }
      }
    }
  }

  /** Collect colliders whose grid cells overlap the XZ rectangle (deduplicated). */
  query(minX, minZ, maxX, maxZ, out = this._cands) {
    out.length = 0;
    const cs = this.cellSize;
    const stamp = ++this._stamp;
    const x0 = Math.floor(minX / cs), x1 = Math.floor(maxX / cs);
    const z0 = Math.floor(minZ / cs), z1 = Math.floor(maxZ / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const cell = this.grid.get(this._key(ix, iz));
        if (!cell) continue;
        for (const c of cell) {
          if (c._stamp === stamp) continue;
          c._stamp = stamp;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Nearest ray hit. dir must be normalized. Returns true on hit and fills
   * out = { dist, point:{x,y,z}, normal:{x,y,z}, collider }.
   * filter(collider) -> bool can reject colliders (e.g. non-hookable).
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, out, filter = null, includeGround = true) {
    let best = maxDist;
    let hit = null;
    let nx = 0, ny = 0, nz = 0;

    if (includeGround && dy < -EPS && oy >= 0) {
      const t = -oy / dy;
      if (t < best) {
        best = t;
        hit = GROUND;
        nx = 0; ny = 1; nz = 0;
      }
    }

    // Candidate cells: bounding rectangle of the segment (fine for our ranges).
    const ex = ox + dx * maxDist, ez = oz + dz * maxDist;
    const cands = this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez));
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (filter && !filter(c)) continue;
      if (c.type === 0) {
        // Slab test
        let tmin = 0, tmax = best, axis = -1, sign = 0;
        // X
        if (Math.abs(dx) < EPS) {
          if (ox < c.minX || ox > c.maxX) continue;
        } else {
          const inv = 1 / dx;
          let t1 = (c.minX - ox) * inv, t2 = (c.maxX - ox) * inv, s = -1;
          if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
          if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) continue;
        }
        // Y
        if (Math.abs(dy) < EPS) {
          if (oy < c.minY || oy > c.maxY) continue;
        } else {
          const inv = 1 / dy;
          let t1 = (c.minY - oy) * inv, t2 = (c.maxY - oy) * inv, s = -1;
          if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
          if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) continue;
        }
        // Z
        if (Math.abs(dz) < EPS) {
          if (oz < c.minZ || oz > c.maxZ) continue;
        } else {
          const inv = 1 / dz;
          let t1 = (c.minZ - oz) * inv, t2 = (c.maxZ - oz) * inv, s = -1;
          if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
          if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) continue;
        }
        if (axis < 0) continue; // origin inside box: ignore
        if (tmin < best) {
          best = tmin;
          hit = c;
          nx = axis === 0 ? sign : 0;
          ny = axis === 1 ? sign : 0;
          nz = axis === 2 ? sign : 0;
        }
      } else {
        // Vertical cylinder: side hit via 2D circle intersection, then caps.
        const px = ox - c.x, pz = oz - c.z;
        const a = dx * dx + dz * dz;
        if (a > EPS) {
          const b = px * dx + pz * dz;
          const cc = px * px + pz * pz - c.r * c.r;
          const disc = b * b - a * cc;
          if (disc >= 0 && cc > 0) {
            const t = (-b - Math.sqrt(disc)) / a;
            if (t >= 0 && t < best) {
              const y = oy + dy * t;
              if (y >= c.minY && y <= c.maxY) {
                best = t;
                hit = c;
                const hx = px + dx * t, hz = pz + dz * t;
                const l = Math.hypot(hx, hz) || 1;
                nx = hx / l; ny = 0; nz = hz / l;
                continue;
              }
            }
          }
        }
        // Top cap
        if (dy < -EPS && oy > c.maxY) {
          const t = (c.maxY - oy) / dy;
          if (t < best) {
            const hx = px + dx * t, hz = pz + dz * t;
            if (hx * hx + hz * hz <= c.r * c.r) {
              best = t;
              hit = c;
              nx = 0; ny = 1; nz = 0;
            }
          }
        }
      }
    }

    if (!hit) return false;
    out.dist = best;
    out.point = out.point || { x: 0, y: 0, z: 0 };
    out.normal = out.normal || { x: 0, y: 0, z: 0 };
    out.point.x = ox + dx * best;
    out.point.y = oy + dy * best;
    out.point.z = oz + dz * best;
    out.normal.x = nx;
    out.normal.y = ny;
    out.normal.z = nz;
    out.collider = hit;
    return true;
  }

  /**
   * Push a sphere out of solid colliders and the ground. Calls
   * onContact(nx, ny, nz, depth, collider) for every contact resolved.
   * Mutates pos (any {x,y,z}). Returns number of contacts.
   */
  resolveSphere(pos, r, onContact) {
    let contacts = 0;
    if (pos.y < r) {
      const depth = r - pos.y;
      pos.y = r;
      onContact?.(0, 1, 0, depth, GROUND);
      contacts++;
    }
    const cands = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r);
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (!c.solid) continue;
      if (pos.y + r < c.minY || pos.y - r > c.maxY) continue;
      if (c.type === 0) {
        const cx = pos.x < c.minX ? c.minX : pos.x > c.maxX ? c.maxX : pos.x;
        const cy = pos.y < c.minY ? c.minY : pos.y > c.maxY ? c.maxY : pos.y;
        const cz = pos.z < c.minZ ? c.minZ : pos.z > c.maxZ ? c.maxZ : pos.z;
        let dx = pos.x - cx, dy = pos.y - cy, dz = pos.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r * r) continue;
        let nx, ny, nz, depth;
        if (d2 > EPS) {
          const d = Math.sqrt(d2);
          nx = dx / d; ny = dy / d; nz = dz / d;
          depth = r - d;
        } else {
          // Center inside the box: push out along the axis of least penetration.
          const pens = [
            [pos.x - c.minX, -1, 0, 0],
            [c.maxX - pos.x, 1, 0, 0],
            [pos.y - c.minY, 0, -1, 0],
            [c.maxY - pos.y, 0, 1, 0],
            [pos.z - c.minZ, 0, 0, -1],
            [c.maxZ - pos.z, 0, 0, 1],
          ];
          let m = pens[0];
          for (const p of pens) if (p[0] < m[0]) m = p;
          nx = m[1]; ny = m[2]; nz = m[3];
          depth = m[0] + r;
        }
        pos.x += nx * depth;
        pos.y += ny * depth;
        pos.z += nz * depth;
        onContact?.(nx, ny, nz, depth, c);
        contacts++;
      } else {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const h = Math.hypot(dx, dz);
        if (pos.y > c.maxY) {
          // Above: land on the cap
          if (h < c.r && pos.y - r < c.maxY) {
            const depth = c.maxY - (pos.y - r);
            pos.y += depth;
            onContact?.(0, 1, 0, depth, c);
            contacts++;
          }
          continue;
        }
        if (h >= c.r + r) continue;
        const nx = h > EPS ? dx / h : 1, nz = h > EPS ? dz / h : 0;
        const depth = c.r + r - h;
        pos.x += nx * depth;
        pos.z += nz * depth;
        onContact?.(nx, 0, nz, depth, c);
        contacts++;
      }
    }
    return contacts;
  }

  /**
   * 2D circle push-out on the XZ plane against colliders taller than minHeight
   * (used for giants, which simply step over low structures).
   */
  resolveCircleXZ(pos, r, minHeight, onContact) {
    let contacts = 0;
    const cands = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r);
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (!c.solid || c.maxY < minHeight) continue;
      if (c.type === 0) {
        const cx = pos.x < c.minX ? c.minX : pos.x > c.maxX ? c.maxX : pos.x;
        const cz = pos.z < c.minZ ? c.minZ : pos.z > c.maxZ ? c.maxZ : pos.z;
        const dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let nx, nz, depth;
        if (d2 > EPS) {
          const d = Math.sqrt(d2);
          nx = dx / d; nz = dz / d; depth = r - d;
        } else {
          const pens = [
            [pos.x - c.minX, -1, 0],
            [c.maxX - pos.x, 1, 0],
            [pos.z - c.minZ, 0, -1],
            [c.maxZ - pos.z, 0, 1],
          ];
          let m = pens[0];
          for (const p of pens) if (p[0] < m[0]) m = p;
          nx = m[1]; nz = m[2]; depth = m[0] + r;
        }
        pos.x += nx * depth;
        pos.z += nz * depth;
        onContact?.(nx, nz, depth, c);
        contacts++;
      } else {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const h = Math.hypot(dx, dz);
        if (h >= c.r + r) continue;
        const nx = h > EPS ? dx / h : 1, nz = h > EPS ? dz / h : 0;
        const depth = c.r + r - h;
        pos.x += nx * depth;
        pos.z += nz * depth;
        onContact?.(nx, nz, depth, c);
        contacts++;
      }
    }
    return contacts;
  }
}

export const GROUND = Object.freeze({ type: -1, tag: 'ground', solid: true, hookable: true });
