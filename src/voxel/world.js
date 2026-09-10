import { CHUNK_X, CHUNK_Z, CHUNK_Y, GROUND_Y, BLOCK_SIZE } from '../core/constants.js';
import { block, blockId, AIR } from '../data/blocks.js';
import { zone, ZONE_NONE } from '../data/zones.js';
import { PropLayer } from './props.js';

const CX = CHUNK_X, CZ = CHUNK_Z, CY = CHUNK_Y;
const CHUNK_VOLUME = CX * CY * CZ;

/**
 * One 16 x 64 x 16 column of voxels. Two parallel layers:
 *   blocks  Uint8Array  (material id, 0 = air)
 *   zones   Uint8Array  (functional zone id, 0 = none)
 * Both allocate lazily; an untouched chunk costs nothing but a Map slot.
 */
export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_VOLUME);
    this.zones = new Uint8Array(CHUNK_VOLUME);
    this.dirty = true;
    this.zoneDirty = true;
    this.nonEmpty = 0;
    this.maxY = 0;
  }

  static index(x, y, z) {
    return (y * CZ + z) * CX + x;
  }
}

/**
 * Chunked voxel world. Coordinates are integer voxel coordinates with the
 * origin at the plot corner; world-space metres = voxel * BLOCK_SIZE.
 */
export class VoxelWorld {
  constructor(size = 128) {
    this.size = size;                 // plot is size x size voxels
    this.chunks = new Map();          // "cx,cz" -> Chunk
    this.dirtyChunks = new Set();
    this.version = 0;                 // bumped on every mutation batch
    this.blockCounts = new Map();     // blockId -> count (for maintenance/appearance)
    this.zoneCounts = new Map();      // zoneId -> count
    // Sports equipment lives beside the voxels, not inside them: a goal post
    // is 24cm thick and a voxel is 2m.
    this.props = new PropLayer();
  }

  key(cx, cz) { return cx + ',' + cz; }

  inBounds(x, y, z) {
    return x >= 0 && z >= 0 && x < this.size && z < this.size && y >= 0 && y < CY;
  }

  getChunk(cx, cz, create = false) {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c && create) {
      c = new Chunk(cx, cz);
      this.chunks.set(k, c);
    }
    return c;
  }

  chunkAt(x, z, create = false) {
    return this.getChunk(Math.floor(x / CX), Math.floor(z / CZ), create);
  }

  getBlock(x, y, z) {
    if (!this.inBounds(x, y, z)) return AIR;
    const c = this.chunkAt(x, z, false);
    if (!c) return AIR;
    return c.blocks[Chunk.index(x - c.cx * CX, y, z - c.cz * CZ)];
  }

  getZone(x, y, z) {
    if (!this.inBounds(x, y, z)) return ZONE_NONE;
    const c = this.chunkAt(x, z, false);
    if (!c) return ZONE_NONE;
    return c.zones[Chunk.index(x - c.cx * CX, y, z - c.cz * CZ)];
  }

  isSolid(x, y, z) {
    const id = this.getBlock(x, y, z);
    return id !== AIR && block(id).solid;
  }

  /** Does this block hide the face of a neighbour? Transparent blocks do not. */
  isOpaque(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id === AIR) return false;
    return !block(id).transparent;
  }

  setBlock(x, y, z, id, zoneOverride = undefined) {
    if (!this.inBounds(x, y, z)) return false;
    const c = this.chunkAt(x, z, true);
    const i = Chunk.index(x - c.cx * CX, y, z - c.cz * CZ);
    const prev = c.blocks[i];
    const prevZone = c.zones[i];

    let nextZone = prevZone;
    if (zoneOverride !== undefined) {
      nextZone = zoneOverride;
    } else if (id !== AIR) {
      const auto = block(id).autoZone;
      // Auto-zone only if the voxel had no zone, or carried the previous
      // block's auto-zone (so repainting a zone by hand is never clobbered).
      if (auto) {
        const prevAuto = prev !== AIR ? block(prev).autoZone : null;
        if (prevZone === ZONE_NONE || (prevAuto && prevZone === (zoneIdOf(prevAuto)))) {
          nextZone = zoneIdOf(auto);
        }
      }
    } else {
      nextZone = ZONE_NONE; // removing a block clears its zone
    }

    if (prev === id && prevZone === nextZone) return false;

    if (prev !== id) {
      if (prev !== AIR) {
        c.nonEmpty--;
        this.blockCounts.set(prev, (this.blockCounts.get(prev) || 0) - 1);
      }
      if (id !== AIR) {
        c.nonEmpty++;
        this.blockCounts.set(id, (this.blockCounts.get(id) || 0) + 1);
        if (y > c.maxY) c.maxY = y;
      }
      c.blocks[i] = id;
    }
    if (prevZone !== nextZone) {
      if (prevZone) this.zoneCounts.set(prevZone, (this.zoneCounts.get(prevZone) || 0) - 1);
      if (nextZone) this.zoneCounts.set(nextZone, (this.zoneCounts.get(nextZone) || 0) + 1);
      c.zones[i] = nextZone;
      c.zoneDirty = true;
    }

    c.dirty = true;
    this.dirtyChunks.add(c);
    this.markNeighbourChunks(x, y, z);
    this.version++;
    return true;
  }

  setZone(x, y, z, zid) {
    if (!this.inBounds(x, y, z)) return false;
    const c = this.chunkAt(x, z, true);
    const i = Chunk.index(x - c.cx * CX, y, z - c.cz * CZ);
    if (c.blocks[i] === AIR) return false; // zones live on solid voxels
    const prev = c.zones[i];
    if (prev === zid) return false;
    if (prev) this.zoneCounts.set(prev, (this.zoneCounts.get(prev) || 0) - 1);
    if (zid) this.zoneCounts.set(zid, (this.zoneCounts.get(zid) || 0) + 1);
    c.zones[i] = zid;
    c.zoneDirty = true;
    c.dirty = true;
    this.dirtyChunks.add(c);
    this.version++;
    return true;
  }

  /** A change at a chunk border invalidates the neighbour's face culling. */
  markNeighbourChunks(x, y, z) {
    const lx = x % CX, lz = z % CZ;
    if (lx === 0) this.touch(x - 1, z);
    if (lx === CX - 1) this.touch(x + 1, z);
    if (lz === 0) this.touch(x, z - 1);
    if (lz === CZ - 1) this.touch(x, z + 1);
  }

  touch(x, z) {
    if (x < 0 || z < 0 || x >= this.size || z >= this.size) return;
    const c = this.chunkAt(x, z, false);
    if (c) { c.dirty = true; this.dirtyChunks.add(c); }
  }

  /** Highest solid voxel in a column, or -1. */
  heightAt(x, z) {
    const c = this.chunkAt(x, z, false);
    if (!c) return -1;
    const lx = x - c.cx * CX, lz = z - c.cz * CZ;
    for (let y = CY - 1; y >= 0; y--) {
      if (c.blocks[Chunk.index(lx, y, lz)] !== AIR) return y;
    }
    return -1;
  }

  /** Generate the starting plot: dirt fill, grass surface, a boundary road. */
  generateTerrain() {
    const grass = blockId('grass');
    const dirt = blockId('dirt');
    for (let x = 0; x < this.size; x++) {
      for (let z = 0; z < this.size; z++) {
        for (let y = 0; y < GROUND_Y; y++) {
          this.setBlock(x, y, z, y === GROUND_Y - 1 ? grass : dirt, ZONE_NONE);
        }
      }
    }
    this.version++;
  }

  /** Extend the plot when land is upgraded, filling the new ring with terrain. */
  expandTo(newSize) {
    if (newSize <= this.size) return;
    const old = this.size;
    this.size = newSize;
    const grass = blockId('grass');
    const dirt = blockId('dirt');
    for (let x = 0; x < newSize; x++) {
      for (let z = 0; z < newSize; z++) {
        if (x < old && z < old) continue;
        for (let y = 0; y < GROUND_Y; y++) {
          this.setBlock(x, y, z, y === GROUND_Y - 1 ? grass : dirt, ZONE_NONE);
        }
      }
    }
    this.version++;
  }

  forEachChunk(fn) { this.chunks.forEach(fn); }

  /** Voxel coords -> world-space metres (block centre). */
  toWorld(x, y, z) {
    return [(x + 0.5) * BLOCK_SIZE, (y + 0.5) * BLOCK_SIZE, (z + 0.5) * BLOCK_SIZE];
  }
}

// Lazy zone lookup, avoids a circular import cost in the hot setBlock path.
let _zoneIdCache = null;
function zoneIdOf(key) {
  if (!_zoneIdCache) _zoneIdCache = new Map();
  let v = _zoneIdCache.get(key);
  if (v === undefined) { v = zone(key).id; _zoneIdCache.set(key, v); }
  return v;
}

export { CHUNK_X, CHUNK_Z, CHUNK_Y };
