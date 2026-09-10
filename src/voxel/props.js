import { BLOCK_SIZE } from '../core/constants.js';
import { propId, PROP_BY_ID } from '../data/props.js';
import { packPos, unpackX, unpackY, unpackZ } from './history.js';

/**
 * The prop layer: grid-snapped sports equipment that sits on top of the voxel
 * grid rather than inside it.
 *
 * Equipment is not made of voxels because a goal post is 24cm thick and a
 * voxel is 2m. Storing it separately keeps the greedy mesher untouched and
 * lets a prop carry the one thing a voxel cannot: a facing direction.
 *
 * A prop is anchored to one cell and occupies a rectangle of cells around it.
 * Rotation turns both the geometry and the occupied rectangle by the same
 * 90 degrees about that anchor cell's centre, so the two can never disagree.
 */

/** Rotate a cell offset by `rot` quarter-turns, matching THREE's rotateY. */
export function rotateOffset(dx, dz, rot) {
  let x = dx, z = dz;
  for (let i = 0; i < (((rot % 4) + 4) % 4); i++) { const nx = z; z = -x; x = nx; }
  return [x, z];
}

/** Cell offsets a prop covers at a given rotation, relative to its anchor. */
export function footprintOffsets(type, rot) {
  const w = type.foot.w, d = type.foot.d;
  const ox = (w - 1) >> 1, oz = (d - 1) >> 1;
  const out = [];
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < d; j++) out.push(rotateOffset(i - ox, j - oz, rot));
  }
  return out;
}

/** Local axis-aligned bounds of a prop's geometry, in metres. */
export function localBounds(type) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const [cx, cy, cz, w, h, d] of type.parts) {
    x0 = Math.min(x0, cx - w / 2); x1 = Math.max(x1, cx + w / 2);
    y0 = Math.min(y0, cy - h / 2); y1 = Math.max(y1, cy + h / 2);
    z0 = Math.min(z0, cz - d / 2); z1 = Math.max(z1, cz + d / 2);
  }
  return { x0, y0, z0, x1, y1, z1 };
}

/** World-space AABB of a placed prop, in metres. */
export function worldBounds(rec) {
  const type = PROP_BY_ID[rec.typeId];
  const b = localBounds(type);
  const [ax, az] = rotateOffset(b.x0, b.z0, rec.rot);
  const [bx, bz] = rotateOffset(b.x1, b.z1, rec.rot);
  const [cx2, cz2] = rotateOffset(b.x0, b.z1, rec.rot);
  const [dx2, dz2] = rotateOffset(b.x1, b.z0, rec.rot);
  const ox = (rec.x + 0.5) * BLOCK_SIZE;
  const oy = rec.y * BLOCK_SIZE;
  const oz = (rec.z + 0.5) * BLOCK_SIZE;
  return {
    x0: ox + Math.min(ax, bx, cx2, dx2), x1: ox + Math.max(ax, bx, cx2, dx2),
    y0: oy + b.y0, y1: oy + b.y1,
    z0: oz + Math.min(az, bz, cz2, dz2), z1: oz + Math.max(az, bz, cz2, dz2),
  };
}

/**
 * Picking margin, in metres. A goal post is 24cm thick and a corner flag is
 * 9cm: without a little slack around the true bounds, aiming at one from the
 * overview camera would be a game of its own. Only picking uses this - the
 * footprint that decides where a prop may stand stays exact.
 */
export const PICK_MARGIN = 0.35;

function inflate(b, m) {
  return {
    x0: b.x0 - m, x1: b.x1 + m,
    y0: b.y0 - m * 0.5, y1: b.y1 + m * 0.5,
    z0: b.z0 - m, z1: b.z1 + m,
  };
}

export class PropLayer {
  constructor() {
    this.byAnchor = new Map();   // packedPos -> record
    this.occupied = new Map();   // packedPos -> anchor packedPos
    this.counts = new Map();     // typeId -> count
    this.version = 0;
    this.dirty = true;
  }

  get size() { return this.byAnchor.size; }

  at(x, y, z) {
    const owner = this.occupied.get(packPos(x, y, z));
    return owner === undefined ? null : this.byAnchor.get(owner) || null;
  }

  anchorAt(x, y, z) { return this.byAnchor.get(packPos(x, y, z)) || null; }

  /**
   * Which cells this placement would need, or null if the type is unknown.
   * Bounds are the caller's job, so the preview can show a partly off-plot
   * placement in red rather than silently vanishing.
   */
  cellsFor(typeId, x, y, z, rot) {
    const type = PROP_BY_ID[typeId];
    if (!type) return null;
    return footprintOffsets(type, rot).map(([dx, dz]) => [x + dx, y, z + dz]);
  }

  /**
   * Can a prop go here? Every cell must be inside the plot, empty of blocks
   * and free of other props, and the whole footprint must be supported from
   * below - equipment does not float.
   */
  canPlace(world, typeId, x, y, z, rot) {
    const cells = this.cellsFor(typeId, x, y, z, rot);
    if (!cells) return { ok: false, reason: 'Unknown item.' };
    for (const [cx, cy, cz] of cells) {
      if (!world.inBounds(cx, cy, cz)) return { ok: false, reason: 'That would hang off the edge of your land.' };
      if (world.isSolid(cx, cy, cz)) return { ok: false, reason: 'There is a block in the way. Aim at the surface it should stand on.' };
      const owner = this.occupied.get(packPos(cx, cy, cz));
      if (owner !== undefined && owner !== packPos(x, y, z)) {
        return { ok: false, reason: 'Another piece of equipment is already there.' };
      }
      if (cy > 0 && !world.isSolid(cx, cy - 1, cz)) {
        return { ok: false, reason: 'Equipment needs solid ground underneath its whole footprint.' };
      }
    }
    return { ok: true, cells };
  }

  /** Place without validation. Callers price and validate first. */
  add(typeId, x, y, z, rot) {
    const key = packPos(x, y, z);
    if (this.byAnchor.has(key)) this.remove(x, y, z);
    const rec = { typeId, x, y, z, rot: ((rot % 4) + 4) % 4, key, bounds: null };
    // A placed prop never moves, so its world bounds are computed once here
    // rather than rebuilt for every ray of every frame.
    rec.bounds = worldBounds(rec);
    rec.pickBounds = inflate(rec.bounds, PICK_MARGIN);
    this.byAnchor.set(key, rec);
    for (const [cx, cy, cz] of this.cellsFor(typeId, x, y, z, rec.rot)) {
      this.occupied.set(packPos(cx, cy, cz), key);
    }
    this.counts.set(typeId, (this.counts.get(typeId) || 0) + 1);
    this.version++;
    this.dirty = true;
    return rec;
  }

  /** Remove by anchor cell. Returns the removed record, or null. */
  remove(x, y, z) {
    const key = packPos(x, y, z);
    const rec = this.byAnchor.get(key);
    if (!rec) return null;
    for (const [cx, cy, cz] of this.cellsFor(rec.typeId, rec.x, rec.y, rec.z, rec.rot)) {
      const p = packPos(cx, cy, cz);
      if (this.occupied.get(p) === key) this.occupied.delete(p);
    }
    this.byAnchor.delete(key);
    const n = (this.counts.get(rec.typeId) || 1) - 1;
    if (n <= 0) this.counts.delete(rec.typeId); else this.counts.set(rec.typeId, n);
    this.version++;
    this.dirty = true;
    return rec;
  }

  /** Remove whatever occupies this cell, wherever its anchor is. */
  removeAt(x, y, z) {
    const rec = this.at(x, y, z);
    return rec ? this.remove(rec.x, rec.y, rec.z) : null;
  }

  /**
   * A block was destroyed. Anything standing on it, or inside it, comes down
   * with it - otherwise goal posts survive their own pitch being dug up.
   */
  onBlockRemoved(x, y, z) {
    const dropped = [];
    for (const dy of [0, 1]) {
      const rec = this.at(x, y + dy, z);
      if (rec && !dropped.includes(rec)) dropped.push(rec);
    }
    for (const rec of dropped) this.remove(rec.x, rec.y, rec.z);
    return dropped;
  }

  values() { return this.byAnchor.values(); }

  /** Total upkeep, power and appearance contributed by every placed prop. */
  totals() {
    let maintenance = 0, power = 0, appearance = 0, revenue = 0, count = 0;
    const provides = {};
    for (const rec of this.byAnchor.values()) {
      const t = PROP_BY_ID[rec.typeId];
      if (!t) continue;
      maintenance += t.maintenance;
      power += t.power;
      appearance += t.appearance;
      revenue += t.revenue;
      provides[t.provides] = (provides[t.provides] || 0) + 1;
      count++;
    }
    return { maintenance, power, appearance, revenue, count, provides };
  }

  /**
   * Ray against every prop's world AABB. There are tens of props in a
   * complex, not thousands, so a linear pass is both simpler and faster than
   * any acceleration structure would be.
   */
  raycast(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const rec of this.byAnchor.values()) {
      const t = rayBox(origin, dir, rec.pickBounds || inflate(worldBounds(rec), PICK_MARGIN));
      if (t !== null && t < bestT && t >= 0) { bestT = t; best = rec; }
    }
    return best ? { rec: best, dist: bestT } : null;
  }

  serialize() {
    const out = [];
    for (const rec of this.byAnchor.values()) {
      const t = PROP_BY_ID[rec.typeId];
      if (t) out.push([t.key, rec.x, rec.y, rec.z, rec.rot]);
    }
    return out;
  }

  static deserialize(list) {
    const layer = new PropLayer();
    if (!Array.isArray(list)) return layer;
    for (const entry of list) {
      if (!Array.isArray(entry)) continue;
      const [key, x, y, z, rot] = entry;
      const id = propId(key);
      if (id) layer.add(id, x, y, z, rot || 0);
    }
    return layer;
  }
}

/** Slab method. Returns the entry distance, or null when the ray misses. */
function rayBox(o, d, b) {
  let tmin = -Infinity, tmax = Infinity;
  for (const [oi, di, lo, hi] of [
    [o.x, d.x, b.x0, b.x1], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.z0, b.z1],
  ]) {
    if (Math.abs(di) < 1e-8) {
      if (oi < lo || oi > hi) return null;
      continue;
    }
    let t1 = (lo - oi) / di, t2 = (hi - oi) / di;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return tmin < 0 ? 0 : tmin;
}

export { packPos, unpackX, unpackY, unpackZ, rayBox };
