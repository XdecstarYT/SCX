import { AIR, block, blockId } from '../data/blocks.js';
import { zone, ZONE_NONE } from '../data/zones.js';
import { EditBatch } from './history.js';
import { CHUNK_Y } from '../core/constants.js';

export const TOOLS = [
  { key: 'single',   name: 'Block',     icon: '■', drag: false, hint: 'Tap to place one block' },
  { key: 'line',     name: 'Line',      icon: '╱', drag: true,  hint: 'Tap start, tap end' },
  { key: 'wall',     name: 'Wall',      icon: '█', drag: true,  hint: 'Tap two points; extrudes up by wall height' },
  { key: 'floor',    name: 'Floor',     icon: '▭', drag: true,  hint: 'Tap two corners; fills a flat slab' },
  { key: 'box',      name: 'Rectangle', icon: '❑', drag: true,  hint: 'Tap two corners; fills a solid box' },
  { key: 'hollow',   name: 'Room',      icon: '⬚', drag: true,  hint: 'Tap two corners; builds walls, floor and ceiling' },
  { key: 'fill',     name: 'Fill',      icon: '⬛', drag: false, hint: 'Flood-fills the enclosed area you tap' },
  { key: 'replace',  name: 'Replace',   icon: '⇄', drag: true,  hint: 'Tap two corners; swaps the material you first tapped' },
  { key: 'copy',     name: 'Copy',      icon: '⧉', drag: true,  hint: 'Tap two corners to copy a structure' },
  { key: 'paste',    name: 'Paste',     icon: '⎘', drag: false, hint: 'Tap to stamp the copied structure' },
];

export const MAX_TOOL_VOXELS = 60000;
/** Clipboard record layout: dx, dy, dz, blockId, zoneId. */
export const CLIP_STRIDE = 5;

const clampY = (y) => Math.max(0, Math.min(CHUNK_Y - 1, y));

function boxCells(a, b, out) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = clampY(Math.min(a.y, b.y)), y1 = clampY(Math.max(a.y, b.y));
  const z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) out.push(x, y, z);
  return out;
}

function lineCells(a, b, out) {
  let x = a.x, y = a.y, z = a.z;
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), dz = Math.abs(b.z - a.z);
  const sx = b.x > a.x ? 1 : -1, sy = b.y > a.y ? 1 : -1, sz = b.z > a.z ? 1 : -1;
  const n = Math.max(dx, dy, dz);
  if (n === 0) { out.push(x, y, z); return out; }
  let ex, ey, ez;
  if (dx >= dy && dx >= dz) {
    ey = 2 * dy - dx; ez = 2 * dz - dx;
    for (let i = 0; i <= dx; i++) {
      out.push(x, clampY(y), z);
      if (ey >= 0) { y += sy; ey -= 2 * dx; }
      if (ez >= 0) { z += sz; ez -= 2 * dx; }
      ey += 2 * dy; ez += 2 * dz; x += sx;
    }
  } else if (dy >= dx && dy >= dz) {
    ex = 2 * dx - dy; ez = 2 * dz - dy;
    for (let i = 0; i <= dy; i++) {
      out.push(x, clampY(y), z);
      if (ex >= 0) { x += sx; ex -= 2 * dy; }
      if (ez >= 0) { z += sz; ez -= 2 * dy; }
      ex += 2 * dx; ez += 2 * dz; y += sy;
    }
  } else {
    ex = 2 * dx - dz; ey = 2 * dy - dz;
    for (let i = 0; i <= dz; i++) {
      out.push(x, clampY(y), z);
      if (ex >= 0) { x += sx; ex -= 2 * dz; }
      if (ey >= 0) { y += sy; ey -= 2 * dz; }
      ex += 2 * dx; ey += 2 * dy; z += sz;
    }
  }
  return out;
}

/** Flood-fill contiguous empty voxels on one horizontal level. */
function floodCells(world, start, out, limit = 12000) {
  const seen = new Set();
  const key = (x, z) => x * 1024 + z;
  const stack = [[start.x, start.z]];
  const y = start.y;
  if (world.getBlock(start.x, y, start.z) !== AIR) return out;
  while (stack.length && seen.size < limit) {
    const [x, z] = stack.pop();
    if (x < 0 || z < 0 || x >= world.size || z >= world.size) continue;
    const k = key(x, z);
    if (seen.has(k)) continue;
    if (world.getBlock(x, y, z) !== AIR) continue;
    seen.add(k);
    out.push(x, y, z);
    stack.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
  }
  return out;
}

/**
 * Compute the voxel list a tool affects. Pure: no mutation, so the same call
 * powers both the ghost preview and the committed edit.
 * @returns {number[]} flat [x,y,z, x,y,z, ...]
 */
export function toolCells(tool, world, a, b, opts = {}) {
  const cells = [];
  if (!a) return cells;
  switch (tool) {
    case 'single':
      cells.push(a.x, clampY(a.y), a.z);
      break;
    case 'line':
      lineCells(a, b || a, cells);
      break;
    case 'wall': {
      const foot = lineCells({ ...a, y: a.y }, { ...(b || a), y: a.y }, []);
      const h = Math.max(1, opts.wallHeight || 3);
      for (let i = 0; i < foot.length; i += 3) {
        for (let k = 0; k < h; k++) cells.push(foot[i], clampY(foot[i + 1] + k), foot[i + 2]);
      }
      break;
    }
    case 'floor': {
      const y = a.y;
      boxCells({ x: a.x, y, z: a.z }, { x: (b || a).x, y, z: (b || a).z }, cells);
      break;
    }
    case 'box':
    case 'replace':
    case 'copy':
      boxCells(a, b || a, cells);
      break;
    case 'hollow': {
      const x0 = Math.min(a.x, (b || a).x), x1 = Math.max(a.x, (b || a).x);
      const z0 = Math.min(a.z, (b || a).z), z1 = Math.max(a.z, (b || a).z);
      const y0 = clampY(Math.min(a.y, (b || a).y));
      const y1 = clampY(Math.max(a.y, (b || a).y + (a.y === (b || a).y ? (opts.wallHeight || 3) : 0)));
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          for (let x = x0; x <= x1; x++) {
            const shell = x === x0 || x === x1 || z === z0 || z === z1 || y === y0 || y === y1;
            if (shell) cells.push(x, y, z);
          }
        }
      }
      break;
    }
    case 'fill':
      floodCells(world, { x: a.x, y: clampY(a.y), z: a.z }, cells);
      break;
    case 'paste': {
      const clip = opts.clipboard;
      if (!clip) break;
      for (let i = 0; i < clip.cells.length; i += CLIP_STRIDE) {
        cells.push(a.x + clip.cells[i], clampY(a.y + clip.cells[i + 1]), a.z + clip.cells[i + 2]);
      }
      break;
    }
    default:
      cells.push(a.x, clampY(a.y), a.z);
  }
  if (cells.length / 3 > MAX_TOOL_VOXELS) cells.length = MAX_TOOL_VOXELS * 3;
  return cells;
}

/**
 * Price a pending edit without touching the world.
 * @returns {{cost, refund, placed, removed, blocked}}
 */
export function priceEdit(world, cells, mode, materialId, opts = {}) {
  let cost = 0, refund = 0, placed = 0, removed = 0, blocked = 0;
  const mat = materialId ? block(materialId) : null;
  const filterId = opts.replaceTarget ?? null;
  const clip = opts.clipboard;

  for (let i = 0, ci = 0; i < cells.length; i += 3, ci++) {
    const x = cells[i], y = cells[i + 1], z = cells[i + 2];
    if (!world.inBounds(x, y, z)) { blocked++; continue; }
    const prev = world.getBlock(x, y, z);

    if (mode === 'demolish') {
      if (prev === AIR) continue;
      removed++;
      refund += block(prev).cost * 0.3;
      continue;
    }
    let id = materialId;
    if (mode === 'paste' && clip) id = clip.cells[ci * CLIP_STRIDE + 3];
    if (filterId !== null && prev !== filterId) continue;
    if (prev === id) continue;
    if (prev !== AIR) refund += block(prev).cost * 0.3;
    if (id !== AIR) { cost += block(id).cost; placed++; }
  }
  return { cost, refund, placed, removed, blocked, net: cost - refund };
}

/**
 * Apply an edit and return a reversible EditBatch.
 * `mode`: 'build' | 'demolish' | 'zone' | 'paste'
 */
export function applyEdit(world, cells, mode, materialId, opts = {}) {
  const batch = new EditBatch(opts.label || mode);
  const filterId = opts.replaceTarget ?? null;
  const clip = opts.clipboard;
  const zoneOverride = opts.zoneId;

  for (let i = 0, ci = 0; i < cells.length; i += 3, ci++) {
    const x = cells[i], y = cells[i + 1], z = cells[i + 2];
    if (!world.inBounds(x, y, z)) continue;
    const prevB = world.getBlock(x, y, z);
    const prevZ = world.getZone(x, y, z);

    if (mode === 'zone') {
      if (prevB === AIR) continue;
      if (prevZ === zoneOverride) continue;
      world.setZone(x, y, z, zoneOverride);
      batch.record(x, y, z, prevB, prevZ, prevB, zoneOverride);
      continue;
    }

    if (mode === 'demolish') {
      if (prevB === AIR) continue;
      batch.refund += block(prevB).cost * 0.3;
      world.setBlock(x, y, z, AIR, ZONE_NONE);
      batch.record(x, y, z, prevB, prevZ, AIR, ZONE_NONE);
      continue;
    }

    let id = materialId;
    let zid = undefined;
    if (mode === 'paste' && clip) { id = clip.cells[ci * CLIP_STRIDE + 3]; zid = clip.cells[ci * CLIP_STRIDE + 4]; }
    if (filterId !== null && prevB !== filterId) continue;
    if (prevB === id) continue;

    if (prevB !== AIR) batch.refund += block(prevB).cost * 0.3;
    if (id !== AIR) batch.cost += block(id).cost;
    world.setBlock(x, y, z, id, zid);
    batch.record(x, y, z, prevB, prevZ, id, world.getZone(x, y, z));
  }
  return batch;
}

/** Snapshot a region for copy/paste and blueprints. Stride 5: dx,dy,dz,block,zone. */
export function copyRegion(world, a, b) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = clampY(Math.min(a.y, b.y)), y1 = clampY(Math.max(a.y, b.y));
  const z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  const cells = [];
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const id = world.getBlock(x, y, z);
        if (id === AIR) continue;
        cells.push(x - x0, y - y0, z - z0, id, world.getZone(x, y, z));
      }
  return {
    cells,
    size: { x: x1 - x0 + 1, y: y1 - y0 + 1, z: z1 - z0 + 1 },
    count: cells.length / CLIP_STRIDE,
  };
}

/** Rotate a clipboard 90 degrees around Y. */
export function rotateClipboard(clip) {
  const out = [];
  const { x: sx, z: sz } = clip.size;
  for (let i = 0; i < clip.cells.length; i += CLIP_STRIDE) {
    const dx = clip.cells[i], dy = clip.cells[i + 1], dz = clip.cells[i + 2];
    out.push(sz - 1 - dz, dy, dx, clip.cells[i + 3], clip.cells[i + 4]);
  }
  return { cells: out, size: { x: sz, y: clip.size.y, z: sx }, count: clip.count };
}
