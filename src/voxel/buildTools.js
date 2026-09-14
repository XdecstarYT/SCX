import { AIR, block, blockId } from '../data/blocks.js';
import { zone, ZONE_NONE } from '../data/zones.js';
import { EditBatch } from './history.js';
import { CHUNK_Y } from '../core/constants.js';
import { PLAN_STRIDE } from './structures.js';
import { PROP_BY_ID } from '../data/props.js';

/**
 * Tools that emit a multi-material PLAN rather than a single-material cell
 * list. They are priced and applied through pricePlan/applyPlan.
 */
export const PLAN_TOOLS = new Set([
  'grandstand', 'bowl', 'canopy', 'garage', 'retaining',
  'raise', 'lower', 'flatten', 'ramp', 'prefab',
]);

export const TOOLS = [
  { key: 'single',   name: 'Block',     icon: '■', drag: false, hint: 'Tap to place one block' },
  { key: 'line',     name: 'Line',      icon: '╱', drag: true,  hint: 'Tap start, tap end' },
  { key: 'wall',     name: 'Wall',      icon: '█', drag: true,  hint: 'Tap two points; extrudes up by wall height' },
  { key: 'floor',    name: 'Floor',     icon: '▭', drag: true,  hint: 'Tap two corners; fills a flat slab' },
  { key: 'box',      name: 'Rectangle', icon: '❑', drag: true,  hint: 'Tap two corners; fills a solid box' },
  { key: 'hollow',   name: 'Room',      icon: '⬚', drag: true,  hint: 'Tap two corners; builds walls, floor and ceiling' },

  // Curved and sloped geometry. Circle is to Floor what Cylinder is to Wall:
  // the same gesture, an elliptical footprint instead of a rectangular one.
  { key: 'circle',   name: 'Circle',    icon: '\u25CF', drag: true, hint: 'Tap two corners; fills the ellipse inside them' },
  { key: 'cylinder', name: 'Cylinder',  icon: '\u25CB', drag: true, hint: 'Tap two corners; raises an elliptical wall' },
  { key: 'dome',     name: 'Dome',      icon: '\u25D3', drag: true, hint: 'Tap two corners; arches a dome shell over them' },
  { key: 'pitched',  name: 'Gable',     icon: '\u25B3', drag: true, hint: 'Tap two corners; lays a pitched roof that sheds rain' },
  { key: 'stairs',   name: 'Stairs',    icon: '\u25E5', drag: true, hint: 'Tap the bottom, then the top; builds a flight between them' },
  { key: 'fill',     name: 'Fill',      icon: '⬛', drag: false, hint: 'Flood-fills the enclosed area you tap' },
  { key: 'replace',  name: 'Replace',   icon: '⇄', drag: true,  hint: 'Tap two corners; swaps the material you first tapped' },
  { key: 'copy',     name: 'Copy',      icon: '⧉', drag: true,  hint: 'Tap two corners to copy a structure' },
  { key: 'paste',    name: 'Paste',     icon: '⎘', drag: false, hint: 'Tap to stamp the copied structure' },
  { key: 'prefab',   name: 'Prefab',    icon: '\u25A3', drag: false, hint: 'Tap to place the chosen prefab; rotate it first if you need to' },

  // Procedural structures: the player sets the footprint, the engine lays the
  // repetitive rows, supports, columns and vomitories.
  { key: 'grandstand', name: 'Stand',   icon: '\u25E4', drag: true, hint: 'Tap two corners; builds a raked seating tier facing the pitch' },
  { key: 'bowl',       name: 'Bowl',    icon: '\u25EF', drag: true, hint: 'Tap the two corners of the pitch; rings it with four tiers' },
  { key: 'canopy',     name: 'Canopy',  icon: '\u2312', drag: true, hint: 'Tap two corners; roofs everything under them on columns' },
  { key: 'garage',     name: 'Garage',  icon: '\u26DB', drag: true, hint: 'Tap two corners; builds a multi-level car park' },
  { key: 'retaining',  name: 'Retain',  icon: '\u2261', drag: true, hint: 'Tap two points; builds a retaining wall along the line' },

  // Arranging what is already there: repaint a surface without rebuilding it,
  // and pick equipment up and put it down instead of demolishing and re-buying.
  { key: 'paint',    name: 'Paint',   icon: '\u25A4', drag: false, hint: 'Repaint the block you tap with the held material' },
  { key: 'surface',  name: 'Surface', icon: '\u25A6', drag: true,  hint: 'Repaint the whole connected face you tap - one tap does a wall' },
  { key: 'paintbox', name: 'Area',    icon: '\u2751', drag: true,  hint: 'Tap two corners; repaints every solid block inside, leaving the shape alone' },
  { key: 'move',     name: 'Move',    icon: '\u2725', drag: false, hint: 'Tap a fitting to pick it up, tap again to set it down. Free.' },
  { key: 'clone',    name: 'Clone',   icon: '\u29C9', drag: false, hint: 'Tap a fitting to hold a copy of it, then tap to place' },
  { key: 'sample',   name: 'Sample',  icon: '\u2316', drag: false, hint: 'Tap anything to put it in your hand' },

  // Terrain shaping.
  { key: 'raise',   name: 'Raise',   icon: '\u25B2', drag: true, hint: 'Tap two corners; raises the ground' },
  { key: 'lower',   name: 'Lower',   icon: '\u25BC', drag: true, hint: 'Tap two corners; lowers the ground' },
  { key: 'flatten', name: 'Flatten', icon: '\u25AC', drag: true, hint: 'Tap the level you want, then the far corner' },
  { key: 'ramp',    name: 'Ramp',    icon: '\u25E2', drag: true, hint: 'Tap two points; slopes the ground between them' },
];

export const MAX_TOOL_VOXELS = 60000;
/** Clipboard record layout: dx, dy, dz, blockId, zoneId. */
export const CLIP_STRIDE = 5;
export { PLAN_STRIDE, surfaceCells };

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

/**
 * Filled ellipse inscribed in the footprint, on one horizontal level. Uses the
 * same half-voxel centring as the prefab canvas so a Circle drawn by hand and
 * an oval laid by a prefab land on exactly the same voxels.
 */
function ellipseCells(a, b, y, out) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const rx = (x1 - x0 + 1) / 2, rz = (z1 - z0 + 1) / 2;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx, dz = (z + 0.5 - cz) / rz;
      if (dx * dx + dz * dz <= 1) out.push(x, clampY(y), z);
    }
  }
  return out;
}

/** The rim of that ellipse: inside, but with a neighbour outside. */
function ellipseRing(a, b, y, out) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const rx = (x1 - x0 + 1) / 2, rz = (z1 - z0 + 1) / 2;
  const inside = (x, z) => {
    const dx = (x + 0.5 - cx) / rx, dz = (z + 0.5 - cz) / rz;
    return dx * dx + dz * dz <= 1;
  };
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, z)) continue;
      if (inside(x + 1, z) && inside(x - 1, z) && inside(x, z + 1) && inside(x, z - 1)) continue;
      out.push(x, clampY(y), z);
    }
  }
  return out;
}

/**
 * A one-voxel-thick half-ellipsoid shell sitting on the footprint.
 *
 * Drawing each horizontal slice as a ring leaves gaps wherever the surface is
 * shallow, so instead every voxel inside the solid is kept only when one of
 * its six neighbours is outside it. That is watertight by construction.
 */
function domeCells(a, b, opts, out) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  const baseY = clampY(Math.min(a.y, b.y));
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const rx = (x1 - x0 + 1) / 2, rz = (z1 - z0 + 1) / 2;
  const ry = Math.max(1, Math.round(Math.min(rx, rz) * (opts.domePitch ?? 1)));
  const solid = (x, y, z) => {
    if (y < baseY) return false;
    const dx = (x + 0.5 - cx) / rx, dz = (z + 0.5 - cz) / rz, dy = (y - baseY) / ry;
    return dx * dx + dz * dz + dy * dy <= 1;
  };
  for (let y = baseY; y <= baseY + ry; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!solid(x, y, z)) continue;
        // The base course is a rim, not a lid: leave the floor open.
        const shell = !solid(x + 1, y, z) || !solid(x - 1, y, z)
          || !solid(x, y, z + 1) || !solid(x, y, z - 1) || !solid(x, y + 1, z);
        if (shell) out.push(x, clampY(y), z);
      }
    }
  }
  return out;
}

/**
 * A pitched roof surface. The ridge runs down the long axis; height climbs
 * from each eave toward it, and the risers between steps are filled so rain
 * (and the renderer) sees a closed surface rather than a flight of stairs.
 */
function pitchedCells(a, b, opts, out) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  const baseY = clampY(Math.min(a.y, b.y));
  const pitch = opts.roofPitch ?? 1;
  const alongX = (x1 - x0) >= (z1 - z0);
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      // Distance in from the nearer eave, measured across the short axis.
      const from = alongX ? Math.min(z - z0, z1 - z) : Math.min(x - x0, x1 - x);
      const h = Math.round(from * pitch);
      const prev = Math.round(Math.max(0, from - 1) * pitch);
      for (let y = prev + (from === 0 ? 0 : 1); y <= h; y++) out.push(x, clampY(baseY + y), z);
    }
  }
  return out;
}

/**
 * A flight of stairs from the first point to the second: a solid wedge, so it
 * carries its own load and reads as concrete rather than as floating treads.
 * The run follows whichever horizontal axis is longer; the width is whatever
 * the two taps span across the other one.
 */
function stairCells(a, b, opts, out) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const alongX = Math.abs(dx) >= Math.abs(dz);
  const run = Math.max(1, Math.abs(alongX ? dx : dz));
  const step = (alongX ? dx : dz) >= 0 ? 1 : -1;
  const width = Math.max(1, Math.abs(alongX ? dz : dx) + 1);
  const wStart = alongX ? Math.min(a.z, b.z) : Math.min(a.x, b.x);
  const baseY = clampY(Math.min(a.y, b.y));
  const topY = clampY(Math.max(a.y, b.y));
  // One block of climb per step unless the two taps are further apart
  // vertically than horizontally, in which case the flight steepens to reach.
  const climb = topY - baseY;
  const rise = Math.max(1, opts.stairRise ?? (Math.round(climb / run) || 1));
  for (let i = 0; i <= run; i++) {
    const y = clampY(baseY + (climb > 0 ? Math.min(i * rise, climb) : i * rise));
    const px = alongX ? a.x + i * step : 0;
    const pz = alongX ? 0 : a.z + i * step;
    for (let w = 0; w < width; w++) {
      const x = alongX ? px : wStart + w;
      const z = alongX ? wStart + w : pz;
      for (let yy = baseY; yy <= y; yy++) out.push(x, clampY(yy), z);
    }
  }
  return out;
}

/**
 * The visible face you tapped, as far as it runs: every cell of the same
 * material, 4-connected across the plane of the face, that is also exposed in
 * the same direction. That is what a person means by "this wall" - the far
 * side of it, and the identical blocks buried behind it, are a different
 * surface and stay as they are.
 */
function surfaceCells(world, hit, out, limit = 20000) {
  if (!hit) return out;
  const { x, y, z, nx = 0, ny = 0, nz = 0 } = hit;
  const id = world.getBlock(x, y, z);
  if (id === AIR) return out;
  const exposed = (cx, cy, cz) => {
    const ax = cx + nx, ay = cy + ny, az = cz + nz;
    if (!world.inBounds(ax, ay, az)) return true;
    return world.getBlock(ax, ay, az) === AIR;
  };
  // Step along the two axes the face lies in.
  const axes = nx ? [[0, 1, 0], [0, 0, 1]] : ny ? [[1, 0, 0], [0, 0, 1]] : [[1, 0, 0], [0, 1, 0]];
  const seen = new Set([packKey(x, y, z)]);
  const stack = [[x, y, z]];
  while (stack.length && out.length / 3 < limit) {
    const [cx, cy, cz] = stack.pop();
    out.push(cx, cy, cz);
    for (const [ax, ay, az] of axes) {
      for (const sgn of [1, -1]) {
        const px = cx + ax * sgn, py = cy + ay * sgn, pz = cz + az * sgn;
        if (py < 0 || py >= CHUNK_Y) continue;
        if (!world.inBounds(px, py, pz)) continue;
        const k = packKey(px, py, pz);
        if (seen.has(k)) continue;
        if (world.getBlock(px, py, pz) !== id) continue;
        if (!exposed(px, py, pz)) continue;
        seen.add(k);
        stack.push([px, py, pz]);
      }
    }
  }
  return out;
}

const packKey = (x, y, z) => (y * 4096 + z) * 4096 + x;

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
    case 'circle':
      ellipseCells(a, b || a, a.y, cells);
      break;
    case 'cylinder': {
      const h = Math.max(1, opts.wallHeight || 3);
      const rim = ellipseRing(a, b || a, a.y, []);
      for (let i = 0; i < rim.length; i += 3) {
        for (let k = 0; k < h; k++) cells.push(rim[i], clampY(rim[i + 1] + k), rim[i + 2]);
      }
      break;
    }
    case 'dome':
      domeCells(a, b || a, opts, cells);
      break;
    case 'pitched':
      pitchedCells(a, b || a, opts, cells);
      break;
    case 'stairs':
      stairCells(a, b || a, opts, cells);
      break;
    case 'fill':
      floodCells(world, { x: a.x, y: clampY(a.y), z: a.z }, cells);
      break;
    case 'paint':
      cells.push(a.x, clampY(a.y), a.z);
      break;
    case 'paintbox':
      boxCells(a, b || a, cells);
      break;
    case 'surface':
      surfaceCells(world, opts.face, cells);
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
  // Equipment knocked down by the edit refunds like a block does, and is
  // counted once however many of its cells the edit touches.
  const doomed = new Set();
  const layer = world.props;

  for (let i = 0, ci = 0; i < cells.length; i += 3, ci++) {
    const x = cells[i], y = cells[i + 1], z = cells[i + 2];
    if (!world.inBounds(x, y, z)) { blocked++; continue; }
    const prev = world.getBlock(x, y, z);

    if (mode === 'demolish') {
      if (prev === AIR) continue;
      removed++;
      refund += block(prev).cost * 0.3;
      if (layer && layer.size) {
        for (const dy of [0, 1]) {
          const rec = layer.at(x, y + dy, z);
          if (rec) doomed.add(rec);
        }
      }
      continue;
    }
    // Painting recolours what is there; it never fills a hole, so a brush
    // dragged past the end of a wall does not quietly build one.
    if (mode === 'paint' && prev === AIR) continue;
    let id = materialId;
    if (mode === 'paste' && clip) id = clip.cells[ci * CLIP_STRIDE + 3];
    if (filterId !== null && prev !== filterId) continue;
    if (prev === id) continue;
    if (prev !== AIR) refund += block(prev).cost * 0.3;
    if (id !== AIR) {
      cost += block(id).cost; placed++;
      if (layer && layer.size) { const rec = layer.at(x, y, z); if (rec) doomed.add(rec); }
    }
  }
  let propsRemoved = 0;
  for (const rec of doomed) {
    refund += (PROP_BY_ID[rec.typeId]?.cost || 0) * 0.3;
    propsRemoved++;
  }
  return { cost, refund, placed, removed, blocked, propsRemoved, net: cost - refund };
}

/**
 * Apply an edit and return a reversible EditBatch.
 * `mode`: 'build' | 'paint' | 'demolish' | 'zone' | 'paste'
 * 'paint' is 'build' that refuses to touch air: it recolours a surface in
 * place rather than adding to it.
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
      dropProps(world, batch, x, y, z);
      world.setBlock(x, y, z, AIR, ZONE_NONE);
      batch.record(x, y, z, prevB, prevZ, AIR, ZONE_NONE);
      continue;
    }

    if (mode === 'paint' && prevB === AIR) continue;
    let id = materialId;
    let zid = undefined;
    if (mode === 'paste' && clip) { id = clip.cells[ci * CLIP_STRIDE + 3]; zid = clip.cells[ci * CLIP_STRIDE + 4]; }
    if (filterId !== null && prevB !== filterId) continue;
    if (prevB === id) continue;

    if (prevB !== AIR) batch.refund += block(prevB).cost * 0.3;
    if (id !== AIR) batch.cost += block(id).cost;
    if (id !== AIR) dropProps(world, batch, x, y, z, true);
    world.setBlock(x, y, z, id, zid);
    batch.record(x, y, z, prevB, prevZ, id, world.getZone(x, y, z));
  }
  return batch;
}

/**
 * Equipment standing on (or inside) a voxel comes down when that voxel does,
 * and the removal is recorded so undo puts it back.
 * @param inPlaceOnly true when a block is being *replaced* rather than removed,
 *        in which case only equipment occupying the voxel itself is affected.
 */
export function dropProps(world, batch, x, y, z, inPlaceOnly = false) {
  const layer = world.props;
  if (!layer || layer.size === 0) return;
  const hits = [];
  const here = layer.at(x, y, z);
  if (here) hits.push(here);
  if (!inPlaceOnly) {
    const above = layer.at(x, y + 1, z);
    if (above && above !== here) hits.push(above);
  }
  for (const rec of hits) {
    layer.remove(rec.x, rec.y, rec.z);
    batch.recordProp('del', rec.typeId, rec.x, rec.y, rec.z, rec.rot);
  }
}

// ---------------------------------------------------------------- plans

/** Positions only, for the ghost preview. */
export function planPositions(plan) {
  const out = [];
  for (let i = 0; i < plan.length; i += PLAN_STRIDE) out.push(plan[i], plan[i + 1], plan[i + 2]);
  return out;
}

/** Price a multi-material plan without touching the world. */
export function pricePlan(world, plan, props = null) {
  let cost = 0, refund = 0, placed = 0, removed = 0;
  if (props) for (const p of props) cost += PROP_BY_ID[p.typeId]?.cost || 0;
  for (let i = 0; i < plan.length; i += PLAN_STRIDE) {
    const x = plan[i], y = plan[i + 1], z = plan[i + 2], id = plan[i + 3];
    if (!world.inBounds(x, y, z)) continue;
    const prev = world.getBlock(x, y, z);
    if (prev === id) continue;
    if (prev !== AIR) refund += block(prev).cost * 0.3;
    if (id !== AIR) { cost += block(id).cost; placed++; } else if (prev !== AIR) removed++;
  }
  return { cost, refund, placed, removed, net: cost - refund };
}

/** Apply a multi-material plan and return a reversible batch. */
export function applyPlan(world, plan, label = 'Structure', props = null) {
  const batch = new EditBatch(label);
  for (let i = 0; i < plan.length; i += PLAN_STRIDE) {
    const x = plan[i], y = plan[i + 1], z = plan[i + 2];
    const id = plan[i + 3], zid = plan[i + 4];
    if (!world.inBounds(x, y, z)) continue;
    const prevB = world.getBlock(x, y, z);
    const prevZ = world.getZone(x, y, z);
    if (prevB === id && prevZ === zid) continue;
    if (prevB !== AIR) batch.refund += block(prevB).cost * 0.3;
    if (id !== AIR) batch.cost += block(id).cost;
    dropProps(world, batch, x, y, z, id !== AIR);
    world.setBlock(x, y, z, id, zid);
    batch.record(x, y, z, prevB, prevZ, id, world.getZone(x, y, z));
  }
  // A plan can carry equipment as well as blocks; place it once the voxels
  // beneath it exist.
  if (props) {
    for (const p of props) {
      const r = world.props.canPlace(world, p.typeId, p.x, p.y, p.z, p.rot);
      if (!r.ok) continue;
      world.props.add(p.typeId, p.x, p.y, p.z, p.rot);
      batch.recordProp('add', p.typeId, p.x, p.y, p.z, p.rot);
      batch.cost += PROP_BY_ID[p.typeId]?.cost || 0;
    }
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
