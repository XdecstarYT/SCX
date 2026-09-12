import { GROUND_Y, BLOCK_SIZE } from './constants.js';
import { blockId } from '../data/blocks.js';
import { zoneId, SPORT_ZONES } from '../data/zones.js';
import { generateGrandstand, generateParkingGarage } from '../voxel/structures.js';
import { generatePrefab } from '../voxel/prefabs.js';
import { applyPlan } from '../voxel/buildTools.js';
import { propId } from '../data/props.js';

/**
 * Building blocks for authored starting positions.
 *
 * A scenario needs a complex that already exists - a stadium somebody else
 * built badly, a ground half finished, an arena with no car park - and writing
 * each one out voxel by voxel would be unreadable. These are the pieces every
 * scenario is made of, so a starting position reads as a description of the
 * place rather than as a wall of coordinates.
 *
 * They write straight into the world: a scenario is a fixture, not a player,
 * and none of this is priced or staged.
 */
const G = GROUND_Y;

export function slab(world, x0, z0, w, d, blockKey, zoneKey, y = G - 1) {
  const id = blockId(blockKey);
  const zid = zoneKey ? zoneId(zoneKey) : undefined;
  for (let z = z0; z < z0 + d; z++) {
    for (let x = x0; x < x0 + w; x++) world.setBlock(x, y, z, id, zid);
  }
}

/** A regulation playing surface, centred, returning the rectangle it used. */
export function pitch(world, zoneKey, cx, cz, scale = 1) {
  const sz = SPORT_ZONES.find((z) => z.key === zoneKey);
  if (!sz) return null;
  const ideal = sz.regulation.ideal || sz.regulation;
  const w = Math.round(Math.max(ideal.w, ideal.d) * scale);
  const d = Math.round(Math.min(ideal.w, ideal.d) * scale);
  const x0 = Math.round(cx - w / 2), z0 = Math.round(cz - d / 2);
  slab(world, x0, z0, w, d, sz.surfaces[0], sz.key);
  return { x0, z0, w, d, cx, cz, sport: sz.sport };
}

/**
 * Rings of raked seating around a rectangle. `gap` leaves a run-off, `skip`
 * leaves whole sides open - a ground with three stands and a grass bank is a
 * very different place from a closed bowl, and scenarios need both.
 */
export function bowl(world, rect, rings, opts = {}) {
  const gap = opts.gap ?? 3;
  const rise = opts.rise ?? 0.8;
  const open = new Set(opts.open || []);          // 'n' | 's' | 'e' | 'w'
  const seat = blockId(opts.seat || 'seat');
  const conc = blockId('concrete');
  const pave = blockId('pavement');
  const zSeat = zoneId('seating'), zConc = zoneId('concourse');
  let placed = 0;
  for (let k = 0; k < rings; k++) {
    const r = gap + k;
    const y = G + Math.floor(k * rise);
    if (y >= 58) break;
    const x0 = rect.x0 - r, x1 = rect.x0 + rect.w - 1 + r;
    const z0 = rect.z0 - r, z1 = rect.z0 + rect.d - 1 + r;
    const concourse = opts.concourseEvery ? k > 0 && k % opts.concourseEvery === 0 : false;
    const col = (x, z) => {
      if (x < 1 || z < 1 || x >= world.size - 1 || z >= world.size - 1) return;
      for (let yy = G - 1; yy < y; yy++) world.setBlock(x, yy, z, conc);
      world.setBlock(x, y, z, concourse ? pave : seat, concourse ? zConc : zSeat);
      placed++;
    };
    for (let x = x0; x <= x1; x++) {
      if (!open.has('n')) col(x, z0);
      if (!open.has('s')) col(x, z1);
    }
    for (let z = z0 + 1; z < z1; z++) {
      if (!open.has('w')) col(x0, z);
      if (!open.has('e')) col(x1, z);
    }
  }
  return placed;
}

/** A block of facility, sized so the ratings see something real. */
export function room(world, x0, z0, w, d, zoneKey, blockKey = 'tile') {
  slab(world, x0, z0, w, d, blockKey, zoneKey);
}

/** A multi-level car park, using the same generator the Garage tool uses. */
export function garage(world, x0, z0, side, levels) {
  const plan = generateParkingGarage(world, { x: x0, z: z0 },
    { x: x0 + side - 1, z: z0 + side - 1 }, { levels });
  if (plan.cells.length) applyPlan(world, plan.cells, 'Garage');
}

/** A raked stand facing the pitch, from the same generator the Stand tool uses. */
export function stand(world, x0, z0, x1, z1, opts = {}) {
  const plan = generateGrandstand(world, { x: x0, z: z0 }, { x: x1, z: z1 }, opts);
  if (plan.cells.length) applyPlan(world, plan.cells, 'Stand');
}

export function prefabAt(world, key, x, z, rot = 0) {
  const plan = generatePrefab(world, key, { x, y: G, z }, rot);
  if (plan.cells.length) applyPlan(world, plan.cells, key, plan.props);
}

/** Floodlight masts on a ring around a point. */
export function floodlights(world, cx, cz, radius, count, height = 13) {
  const steel = blockId('steel'), lamp = blockId('floodlight');
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.4;
    const x = Math.round(cx + Math.cos(a) * radius);
    const z = Math.round(cz + Math.sin(a) * radius);
    if (x < 2 || z < 2 || x >= world.size - 2 || z >= world.size - 2) continue;
    for (let y = G; y < G + height; y++) world.setBlock(x, y, z, steel);
    world.setBlock(x, G + height, z, lamp);
  }
}

/** Equipment, placed if the spot will take it. */
export function fit(world, key, x, z, rot = 0) {
  const id = propId(key);
  if (id && world.props.canPlace(world, id, x, G, z, rot).ok) world.props.add(id, x, G, z, rot);
}

/** A straight run of road or path. */
export function road(world, x0, z0, w, d, kind = 'road_main') {
  const zoneFor = { road_main: 'road_main', road: 'road', road_emerg: 'road_emergency',
    bus_lane: 'road_bus', pavement: 'concourse', asphalt: 'parking' };
  slab(world, x0, z0, w, d, kind, zoneFor[kind] || 'road');
}

export { G as GROUND };
