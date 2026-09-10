import { blockId, AIR } from '../data/blocks.js';
import { zoneId, ZONE_NONE } from '../data/zones.js';
import { propId } from '../data/props.js';
import { PLAN_STRIDE } from './structures.js';

/**
 * The prefab library: whole facilities, laid out correctly, in one tap.
 *
 * A prefab is authored once in a local frame - x to the right, z away, y up
 * from the surface the player is aiming at - and then rotated into place. The
 * output is the same PLAN format the procedural structures already use
 * ([x, y, z, blockId, zoneId] repeating) plus a list of props, so prefabs
 * ride the existing pricing, staging, undo and construction pipeline rather
 * than inventing a second one.
 *
 * ly = -1 is the surface course: it replaces the ground rather than sitting on
 * top of it, which is why a laid pitch is flush with the grass around it.
 */

class Canvas {
  constructor() {
    this.cells = [];
    this.props = [];
    this.index = new Map();
  }

  /**
   * Paint one cell. A prefab is authored the way you would build it - lay the
   * slab, raise the walls, then cut the doorway - so the last writer wins and
   * `blockKey: null` carves a hole.
   */
  set(lx, ly, lz, blockKey, zoneKey) {
    const k = (lx + 512) * 1_048_576 + (ly + 64) * 4096 + (lz + 512);
    const id = blockKey ? blockId(blockKey) : AIR;
    const zid = zoneKey ? zoneId(zoneKey) : ZONE_NONE;
    const at = this.index.get(k);
    if (at !== undefined) {
      this.cells[at + 3] = id;
      this.cells[at + 4] = zid;
      return;
    }
    this.index.set(k, this.cells.length);
    this.cells.push(lx, ly, lz, id, zid);
  }

  fill(x0, y0, z0, x1, y1, z1, blockKey, zoneKey) {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) this.set(x, y, z, blockKey, zoneKey);
  }

  /** Hollow rectangle outline on one level. */
  ring(x0, z0, x1, z1, y, blockKey, zoneKey) {
    for (let x = x0; x <= x1; x++) { this.set(x, y, z0, blockKey, zoneKey); this.set(x, y, z1, blockKey, zoneKey); }
    for (let z = z0; z <= z1; z++) { this.set(x0, y, z, blockKey, zoneKey); this.set(x1, y, z, blockKey, zoneKey); }
  }

  /** Four walls of a room, `h` blocks tall, with the corners included. */
  walls(x0, z0, x1, z1, y0, h, blockKey, zoneKey) {
    for (let y = y0; y < y0 + h; y++) this.ring(x0, z0, x1, z1, y, blockKey, zoneKey);
  }

  /** Solid filled ellipse inscribed in the rectangle. */
  ellipse(x0, z0, x1, z1, y, blockKey, zoneKey) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const rx = (x1 - x0 + 1) / 2, rz = (z1 - z0 + 1) / 2;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rx, dz = (z + 0.5 - cz) / rz;
        if (dx * dx + dz * dz <= 1) this.set(x, y, z, blockKey, zoneKey);
      }
    }
  }

  prop(lx, ly, lz, key, rot = 0) {
    const id = propId(key);
    if (id) this.props.push({ typeId: id, x: lx, y: ly, z: lz, rot: rot & 3 });
  }
}

// --------------------------------------------------------------- prefabs

/** A raked seating tier along the +x axis, looking toward -z. */
function stand(c, w, rows, opts = {}) {
  const seat = opts.seat || 'seat';
  const rise = opts.rise ?? 1;
  const roof = opts.roof || null;
  let top = 0;
  for (let r = 0; r < rows; r++) {
    const y = Math.floor(r * rise);
    const z = r;
    top = Math.max(top, y);
    for (let x = 0; x < w; x++) {
      for (let yy = -1; yy < y; yy++) c.set(x, yy, z, 'concrete');
      // Every 8th column is a vomitory: stairs up through the tier.
      const vom = w > 12 && x % 9 === 4;
      c.set(x, y, z, vom ? 'stair' : seat, vom ? 'stairs' : 'seating');
    }
  }
  // Concourse behind the last row, at the top of the rake.
  const cz = rows;
  for (let x = 0; x < w; x++) {
    for (let yy = -1; yy < top; yy++) { c.set(x, yy, cz, 'concrete'); c.set(x, yy, cz + 1, 'concrete'); }
    c.set(x, top, cz, 'pavement', 'concourse');
    c.set(x, top, cz + 1, 'pavement', 'concourse');
  }
  if (roof) {
    for (let x = 0; x < w; x++) {
      c.set(x, top + 4, 0, 'steel');
      for (let z = 0; z <= cz + 1; z++) c.set(x, top + 5, z, roof);
    }
    for (let x = 0; x < w; x += 6) for (let y = top + 1; y <= top + 4; y++) c.set(x, y, cz + 1, 'steel');
  }
  return { top, depth: cz + 2 };
}

/** Floor slab, walls, roof and a doorway: the shell every indoor room shares. */
function room(c, w, d, h, opts = {}) {
  const floor = opts.floor || 'tile';
  const wall = opts.wall || 'concrete';
  const roof = opts.roof || 'roof_conc';
  const zoneKey = opts.zone || null;
  c.fill(0, -1, 0, w - 1, -1, d - 1, floor, zoneKey);
  c.walls(0, 0, w - 1, d - 1, 0, h, wall);
  c.fill(0, h, 0, w - 1, h, d - 1, roof);
  // Doorway in the middle of the front (z = 0) wall.
  const dx = Math.floor(w / 2);
  for (let y = 0; y < Math.min(2, h); y++) { c.set(dx, y, 0, null); c.set(dx - 1, y, 0, null); }
  if (opts.windows !== false) {
    for (let x = 2; x < w - 2; x += 3) c.set(x, 1, d - 1, 'glass');
  }
}

export const PREFABS = [
  // ------------------------------------------------------------- playing
  {
    key: 'court_basketball', name: 'Basketball Court', group: 'field',
    size: { x: 19, z: 14 }, icon: '⛹',
    hint: 'Regulation 30m x 16m hardwood court with hoops, benches and a run-off.',
    build(c) {
      // Zoned as concourse, not training: the run-off is where people stand,
      // and letting it auto-zone would classify the whole thing as a gym.
      c.fill(0, -1, 0, 18, -1, 13, 'rubber', 'concourse');
      c.fill(2, -1, 3, 16, -1, 10, 'hardwood', 'court_basketball');
      c.prop(9, 0, 1, 'hoop_basketball', 2);
      c.prop(9, 0, 12, 'hoop_basketball', 0);
      c.prop(4, 0, 12, 'dugout', 0);
      c.prop(14, 0, 12, 'dugout', 0);
    },
  },
  {
    key: 'court_tennis', name: 'Tennis Court', group: 'field',
    size: { x: 22, z: 16 }, icon: '\u{1F3BE}',
    hint: 'A full clay court with the net, surround and a bench on each side.',
    build(c) {
      c.fill(0, -1, 0, 21, -1, 15, 'pavement', 'concourse');
      c.fill(2, -1, 3, 19, -1, 12, 'clay', 'court_tennis');
      c.prop(10, 0, 7, 'net_tennis', 0);
      c.prop(3, 0, 14, 'dugout', 0);
      c.prop(18, 0, 14, 'dugout', 0);
    },
  },
  {
    key: 'pitch_soccer', name: 'Soccer Pitch', group: 'field',
    size: { x: 57, z: 38 }, icon: '⚽',
    hint: 'A championship 106m x 68m pitch with goals, corner flags and dugouts.',
    build(c) {
      c.fill(0, -1, 0, 56, -1, 37, 'grass');
      c.fill(2, -1, 2, 54, -1, 35, 'turf', 'pitch_football');
      c.prop(28, 0, 2, 'goal_soccer', 2);
      c.prop(28, 0, 35, 'goal_soccer', 0);
      for (const [x, z] of [[2, 2], [54, 2], [2, 35], [54, 35]]) c.prop(x, 0, z, 'corner_flag', 0);
      c.prop(20, 0, 0, 'dugout', 2);
      c.prop(36, 0, 0, 'dugout', 2);
    },
  },
  {
    key: 'oval_afl', name: 'Australian Rules Oval', group: 'field',
    size: { x: 86, z: 74 }, icon: '\u{1F3C9}',
    hint: 'A full 164m x 140m oval with goal and behind posts at each end.',
    build(c) {
      c.ellipse(0, 0, 85, 73, -1, 'grass');
      c.ellipse(2, 2, 83, 71, -1, 'turf', 'pitch_afl');
      c.prop(42, 0, 4, 'goal_afl', 2);
      c.prop(42, 0, 69, 'goal_afl', 0);
      c.prop(20, 0, 8, 'dugout', 2);
      c.prop(64, 0, 8, 'dugout', 2);
    },
  },
  {
    key: 'ground_cricket', name: 'Cricket Ground', group: 'field',
    size: { x: 80, z: 80 }, icon: '\u{1F3CF}',
    hint: 'A 150m circular field with a centre wicket, stumps and sight screens.',
    build(c) {
      c.ellipse(0, 0, 79, 79, -1, 'grass');
      c.ellipse(2, 2, 77, 77, -1, 'turf', 'pitch_cricket');
      // The wicket square: a drier, harder strip down the middle.
      c.fill(38, -1, 30, 41, -1, 49, 'sand', 'pitch_cricket');
      c.prop(39, 0, 31, 'stumps_cricket', 0);
      c.prop(39, 0, 48, 'stumps_cricket', 2);
      c.prop(39, 0, 4, 'sightscreen', 2);
      c.prop(39, 0, 75, 'sightscreen', 0);
      c.prop(12, 0, 12, 'dugout', 1);
      c.prop(67, 0, 67, 'dugout', 3);
    },
  },

  // ------------------------------------------------------------ buildings
  {
    key: 'gym_small', name: 'Small Gym', group: 'building',
    size: { x: 13, z: 11 }, icon: '\u{1F3CB}',
    hint: 'A 26m x 22m training room, floor to roof, zoned as Training.',
    build(c) {
      room(c, 13, 11, 4, { floor: 'rubber', wall: 'brick', roof: 'roof_metal', zone: 'training' });
      c.prop(3, 0, 8, 'bench_crowd', 0);
      c.prop(9, 0, 8, 'bench_crowd', 0);
    },
  },
  {
    key: 'gym_medium', name: 'Performance Centre', group: 'building',
    size: { x: 22, z: 17 }, icon: '\u{1F3CB}',
    hint: 'A two-storey training centre with a practice net and a medical bay.',
    build(c) {
      room(c, 22, 17, 5, { floor: 'rubber', wall: 'facade_c', roof: 'roof_metal', zone: 'training' });
      c.fill(16, -1, 1, 20, -1, 6, 'tile', 'medical');
      c.walls(15, 0, 20, 7, 0, 3, 'concrete');
      for (let y = 0; y < 2; y++) c.set(15, y, 4, null);
      c.prop(6, 0, 12, 'goal_practice', 0);
    },
  },
  {
    key: 'locker_room', name: 'Locker Rooms', group: 'building',
    size: { x: 16, z: 10 }, icon: '\u{1F6BF}',
    hint: 'Home and away changing rooms with showers between them.',
    build(c) {
      c.fill(0, -1, 0, 15, -1, 9, 'tile', 'locker');
      c.walls(0, 0, 15, 9, 0, 3, 'concrete');
      c.fill(0, 3, 0, 15, 3, 9, 'roof_conc');
      // Shower block in the middle, zoned as restroom so it counts as plumbing.
      c.fill(7, -1, 1, 8, -1, 8, 'tile', 'restroom');
      for (let y = 0; y < 3; y++) { c.set(7, y, 4, null); c.set(8, y, 4, null); }
      for (let y = 0; y < 2; y++) { c.set(3, y, 0, null); c.set(12, y, 0, null); }
      c.prop(3, 0, 6, 'bench_crowd', 0);
      c.prop(12, 0, 6, 'bench_crowd', 0);
    },
  },
  {
    key: 'entrance_gate', name: 'Stadium Entrance', group: 'building',
    size: { x: 18, z: 10 }, icon: '\u{1F6AA}',
    hint: 'A gated entrance plaza with turnstiles, security and a canopy.',
    build(c) {
      c.fill(0, -1, 0, 17, -1, 9, 'pavement', 'concourse');
      c.fill(1, -1, 3, 16, -1, 6, 'tile', 'entrance');
      c.fill(1, -1, 7, 5, -1, 9, 'tile', 'security');
      // Turnstile piers: gaps between them are the lanes people walk through.
      for (let x = 1; x <= 16; x += 3) {
        for (let y = 0; y < 2; y++) { c.set(x, y, 4, 'metal'); c.set(x, y, 5, 'metal'); }
      }
      for (let x = 0; x <= 17; x += 17) for (let y = 0; y < 6; y++) c.set(x, y, 4, 'facade_c');
      for (let x = 0; x <= 17; x++) c.set(x, 6, 4, 'roof_metal');
      for (let x = 0; x <= 17; x++) for (let z = 3; z <= 6; z++) c.set(x, 6, z, 'roof_metal');
      c.set(9, 5, 3, 'advert');
      c.set(8, 5, 3, 'advert');
    },
  },
  {
    key: 'food_court', name: 'Food Court', group: 'building',
    size: { x: 20, z: 13 }, icon: '\u{1F354}',
    hint: 'Six serveries around a covered seating area, zoned Concession.',
    build(c) {
      c.fill(0, -1, 0, 19, -1, 12, 'tile', 'concourse');
      c.fill(1, -1, 1, 18, -1, 4, 'tile', 'concession');
      c.fill(1, -1, 8, 18, -1, 11, 'tile', 'concession');
      c.walls(0, 0, 19, 12, 0, 4, 'facade_m');
      c.fill(0, 4, 0, 19, 4, 12, 'roof_glass');
      // Counters facing the middle, with a gap you can walk through.
      for (let x = 2; x <= 17; x++) { c.set(x, 0, 4, 'metal'); c.set(x, 0, 8, 'metal'); }
      for (const x of [9, 10]) { c.set(x, 0, 4, null); c.set(x, 0, 8, null); }
      for (let z = 5; z <= 7; z++) { c.set(0, 1, z, null); c.set(19, 1, z, null); c.set(0, 0, z, null); c.set(19, 0, z, null); }
      for (let x = 3; x <= 16; x += 4) { c.set(x, 1, 3, 'advert'); c.set(x, 1, 9, 'advert'); }
    },
  },

  // ------------------------------------------------------------- seating
  {
    key: 'grandstand_sm', name: 'Small Grandstand', group: 'seating',
    size: { x: 24, z: 10 }, icon: '◤',
    hint: 'Eight raked rows with a concourse behind. About 1,150 seats.',
    build(c) { stand(c, 24, 8, { rise: 1 }); },
  },
  {
    key: 'grandstand_lg', name: 'Main Grandstand', group: 'seating',
    size: { x: 44, z: 18 }, icon: '◤',
    hint: 'Fourteen roofed rows with vomitories and a wide concourse. About 3,700 seats.',
    build(c) { stand(c, 44, 14, { rise: 1, roof: 'roof_stadium' }); },
  },

  // ------------------------------------------------------------- outdoor
  {
    key: 'car_park', name: 'Car Park', group: 'outdoor',
    size: { x: 32, z: 22 }, icon: '\u{1F17F}',
    hint: 'About 130 spaces with an access road, lighting and a footpath.',
    build(c) {
      c.fill(0, -1, 0, 31, -1, 21, 'asphalt', 'parking');
      c.fill(0, -1, 10, 31, -1, 11, 'road', 'road');
      c.fill(0, -1, 0, 31, -1, 0, 'path', 'concourse');
      for (const x of [4, 14, 24]) {
        for (let y = 0; y < 4; y++) c.set(x, y, 10, 'steel');
        c.set(x, 4, 10, 'floodlight');
      }
    },
  },
  {
    key: 'plaza', name: 'Fan Plaza', group: 'outdoor',
    size: { x: 22, z: 18 }, icon: '✦',
    hint: 'An open fan zone with a big screen, planting and benches.',
    build(c) {
      c.fill(0, -1, 0, 21, -1, 17, 'pavement', 'fanzone');
      for (const [x, z] of [[2, 2], [19, 2], [2, 15], [19, 15], [10, 2]]) c.set(x, 0, z, 'planter');
      for (const [x, z] of [[5, 8], [16, 8], [10, 14]]) c.prop(x, 0, z, 'bench_crowd', 0);
      c.prop(10, 0, 16, 'scoreboard_sm', 0);
    },
  },
];

export const PREFAB_BY_KEY = new Map(PREFABS.map((p) => [p.key, p]));

export const PREFAB_GROUPS = [
  { key: 'field', name: 'Playing Surfaces' },
  { key: 'seating', name: 'Seating' },
  { key: 'building', name: 'Buildings' },
  { key: 'outdoor', name: 'Outdoor' },
];

// ------------------------------------------------------------- placement

/**
 * Rotate a local cell into world space. Quarter-turns match THREE's rotateY,
 * so a prefab and the props inside it always turn the same way.
 */
export function transform(lx, lz, rot, w, d, ax, az) {
  switch (rot & 3) {
    case 1: return [ax + lz, az + (w - 1 - lx)];
    case 2: return [ax + (w - 1 - lx), az + (d - 1 - lz)];
    case 3: return [ax + (d - 1 - lz), az + lx];
    default: return [ax + lx, az + lz];
  }
}

/** Footprint of a prefab in world blocks at a given rotation. */
export function prefabFootprint(def, rot) {
  return (rot & 1) ? { x: def.size.z, z: def.size.x } : { x: def.size.x, z: def.size.z };
}

const canvasCache = new Map();
function authored(def) {
  let c = canvasCache.get(def.key);
  if (!c) { c = new Canvas(); def.build(c); canvasCache.set(def.key, c); }
  return c;
}

/**
 * Turn a prefab into a placeable plan at (anchor, rot).
 * @returns {{cells:number[], props:object[], meta:object}}
 */
export function generatePrefab(world, key, anchor, rot = 0) {
  const def = PREFAB_BY_KEY.get(key);
  if (!def || !anchor) return { cells: [], props: [], meta: { blocked: true } };
  const src = authored(def);
  const { x: W, z: D } = def.size;
  const cells = [];
  const props = [];
  let outside = 0;
  let minGround = Infinity, maxGround = -Infinity;

  for (let i = 0; i < src.cells.length; i += PLAN_STRIDE) {
    const lx = src.cells[i], ly = src.cells[i + 1], lz = src.cells[i + 2];
    const [wx, wz] = transform(lx, lz, rot, W, D, anchor.x, anchor.z);
    const wy = anchor.y + ly;
    if (!world.inBounds(wx, wy, wz)) { outside++; continue; }
    cells.push(wx, wy, wz, src.cells[i + 3], src.cells[i + 4]);
  }
  for (const p of src.props) {
    const [wx, wz] = transform(p.x, p.z, rot, W, D, anchor.x, anchor.z);
    const wy = anchor.y + p.y;
    if (!world.inBounds(wx, wy, wz)) { outside++; continue; }
    props.push({ typeId: p.typeId, x: wx, y: wy, z: wz, rot: (p.rot + rot) & 3 });
  }

  // Prefabs assume a level pad. Report how uneven the ground is so the dock
  // can tell the player to flatten first rather than silently making a mess.
  const foot = prefabFootprint(def, rot);
  const step = Math.max(1, Math.floor(Math.max(foot.x, foot.z) / 12));
  for (let x = 0; x < foot.x; x += step) {
    for (let z = 0; z < foot.z; z += step) {
      const h = world.heightAt(anchor.x + x, anchor.z + z);
      if (h < 0) continue;
      if (h < minGround) minGround = h;
      if (h > maxGround) maxGround = h;
    }
  }
  const drop = maxGround >= minGround ? maxGround - minGround : 0;

  return {
    cells,
    props,
    meta: {
      prefab: def.key,
      name: def.name,
      footprint: foot,
      outside,
      unevenBy: drop,
      propCount: props.length,
    },
  };
}
