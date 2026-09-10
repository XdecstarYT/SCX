import { CHUNK_X, CHUNK_Z, CHUNK_Y, SEATS_PER_VOXEL, VOXELS_PER_CAR, PEOPLE_PER_CAR, BLOCK_SIZE } from '../core/constants.js';
import { block, AIR } from '../data/blocks.js';
import { zone, ZONE_BY_ID, SPORT_ZONES } from '../data/zones.js';
import { Chunk } from '../voxel/world.js';

/**
 * ---------------------------------------------------------------------------
 * COMPLEX ANALYSIS
 * ---------------------------------------------------------------------------
 * One pass over the voxel data produces everything the simulation needs to
 * "understand" the player's build: zone footprints, per-zone connected
 * components, block-derived statistics, and roof coverage.
 *
 * Nothing here matches against a fixed blueprint. A venue is whatever the
 * geometry says it is.
 */

export function scanWorld(world) {
  const size = world.size;
  const zoneInfo = new Map(); // zoneId -> { count, bbox, foot:Uint8Array, yTop:Int16Array }
  const stats = {
    blocks: 0, appearance: 0, power: 0, maintenance: 0, revenue: 0, safety: 0,
    floodlights: [], screens: 0, adverts: 0, roofVoxels: 0, glassVoxels: 0,
    maxY: 0, decorScore: 0,
  };

  const ensure = (zid) => {
    let r = zoneInfo.get(zid);
    if (!r) {
      r = {
        id: zid, count: 0,
        minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9, minY: 1e9, maxY: -1e9,
        foot: new Uint8Array(size * size),
        levels: new Set(),
      };
      zoneInfo.set(zid, r);
    }
    return r;
  };

  world.forEachChunk((chunk) => {
    const ox = chunk.cx * CHUNK_X, oz = chunk.cz * CHUNK_Z;
    for (let y = 0; y < CHUNK_Y; y++) {
      for (let z = 0; z < CHUNK_Z; z++) {
        for (let x = 0; x < CHUNK_X; x++) {
          const i = Chunk.index(x, y, z);
          const id = chunk.blocks[i];
          if (id === AIR) continue;
          const wx = ox + x, wz = oz + z;
          if (wx >= size || wz >= size) continue;
          const b = block(id);

          stats.blocks++;
          stats.appearance += b.appearance;
          stats.power += b.power;
          stats.maintenance += b.maintenance;
          stats.revenue += b.revenue;
          stats.safety += b.safety;
          if (y > stats.maxY) stats.maxY = y;
          if (b.category === 'roof') stats.roofVoxels++;
          if (b.key === 'glass') stats.glassVoxels++;
          if (b.light) stats.floodlights.push([wx, y, wz]);
          if (b.key === 'screen') stats.screens++;
          if (b.key === 'advert') stats.adverts++;
          if (b.category === 'decor') stats.decorScore += 1 + b.appearance;

          const zid = chunk.zones[i];
          if (zid === 0) continue;
          const r = ensure(zid);
          r.count++;
          if (wx < r.minX) r.minX = wx;
          if (wx > r.maxX) r.maxX = wx;
          if (wz < r.minZ) r.minZ = wz;
          if (wz > r.maxZ) r.maxZ = wz;
          if (y < r.minY) r.minY = y;
          if (y > r.maxY) r.maxY = y;
          r.levels.add(y);
          r.foot[wz * size + wx] = 1;
        }
      }
    }
  });

  return { zoneInfo, stats, size };
}

/** 4-connected components of a zone footprint bitmap. */
export function components(foot, size, minArea = 4) {
  const seen = new Uint8Array(size * size);
  const out = [];
  const stack = [];
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const s = z * size + x;
      if (!foot[s] || seen[s]) continue;
      stack.length = 0;
      stack.push(s);
      seen[s] = 1;
      const cells = [];
      let minX = x, maxX = x, minZ = z, maxZ = z;
      while (stack.length) {
        const c = stack.pop();
        cells.push(c);
        const cx = c % size, cz = (c / size) | 0;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cz < minZ) minZ = cz; if (cz > maxZ) maxZ = cz;
        if (cx > 0 && foot[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; stack.push(c - 1); }
        if (cx < size - 1 && foot[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; stack.push(c + 1); }
        if (cz > 0 && foot[c - size] && !seen[c - size]) { seen[c - size] = 1; stack.push(c - size); }
        if (cz < size - 1 && foot[c + size] && !seen[c + size]) { seen[c + size] = 1; stack.push(c + size); }
      }
      if (cells.length >= minArea) {
        out.push({
          cells, area: cells.length, minX, maxX, minZ, maxZ,
          cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2,
        });
      }
    }
  }
  return out;
}

/**
 * Largest axis-aligned rectangle fully inside a component. This is what turns
 * "a big green blob" into "a 53 x 34 regulation pitch".
 */
export function largestRectangle(comp, size) {
  const w = comp.maxX - comp.minX + 1;
  const h = comp.maxZ - comp.minZ + 1;
  const grid = new Uint8Array(w * h);
  for (const c of comp.cells) {
    const x = (c % size) - comp.minX;
    const z = ((c / size) | 0) - comp.minZ;
    grid[z * w + x] = 1;
  }
  const heights = new Int32Array(w);
  let best = { w: 0, h: 0, area: 0, x: comp.minX, z: comp.minZ };
  const stack = [];
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) heights[x] = grid[z * w + x] ? heights[x] + 1 : 0;
    stack.length = 0;
    for (let x = 0; x <= w; x++) {
      const cur = x === w ? 0 : heights[x];
      while (stack.length && heights[stack[stack.length - 1]] >= cur) {
        const top = stack.pop();
        const height = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = x - left;
        const area = width * height;
        if (area > best.area) {
          best = { w: width, h: height, area, x: comp.minX + left, z: comp.minZ + z - height + 1 };
        }
      }
      stack.push(x);
    }
  }
  return best;
}

/** Fraction of a footprint that has any solid block above it (roof coverage). */
export function roofCoverage(world, comp, size, fromY) {
  if (comp.cells.length === 0) return 0;
  const step = Math.max(1, Math.floor(comp.cells.length / 400));
  let covered = 0, sampled = 0;
  for (let i = 0; i < comp.cells.length; i += step) {
    const c = comp.cells[i];
    const x = c % size, z = (c / size) | 0;
    sampled++;
    for (let y = fromY + 2; y < CHUNK_Y; y++) {
      if (world.isSolid(x, y, z)) { covered++; break; }
    }
  }
  return sampled ? covered / sampled : 0;
}

/** Nearest-component distance in voxels between two footprint components. */
export function centreDistance(a, b) {
  const dx = a.cx - b.cx, dz = a.cz - b.cz;
  return Math.sqrt(dx * dx + dz * dz);
}

/** How many floodlights sit within `radius` voxels of a footprint centre. */
export function lightsNear(floodlights, cx, cz, radius) {
  let n = 0;
  const r2 = radius * radius;
  for (const [x, , z] of floodlights) {
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz <= r2) n++;
  }
  return n;
}

export { SEATS_PER_VOXEL, VOXELS_PER_CAR, PEOPLE_PER_CAR, BLOCK_SIZE };
