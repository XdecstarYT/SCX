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
      // Roof trusses on a 7-block grid: metal spans 8, the hall is 22 x 17.
      for (const x of [7, 14]) {
        for (const z of [3, 9, 15]) for (let y = 0; y < 5; y++) c.set(x, y, z, 'beam');
      }
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
      for (let x = 0; x <= 17; x++) for (let z = 3; z <= 6; z++) c.set(x, 6, z, 'roof_metal');
      // Columns every five metres along both edges: a metal canopy spans 8
      // blocks, so the middle of an 18-wide gate needs something under it.
      for (let x = 0; x <= 17; x += 5) {
        for (const z of [3, 6]) for (let y = 0; y < 6; y++) c.set(x, y, z, 'steel');
      }
      c.set(9, 5, 3, 'advert');
      c.set(8, 5, 3, 'advert');
    },
  },
  {
    key: 'food_court', name: 'Food Court', group: 'building', unlock: 'adv_materials',
    size: { x: 20, z: 13 }, icon: '\u{1F354}',
    hint: 'Six serveries around a covered seating area, zoned Concession.',
    build(c) {
      c.fill(0, -1, 0, 19, -1, 12, 'tile', 'concourse');
      c.fill(1, -1, 1, 18, -1, 4, 'tile', 'concession');
      c.fill(1, -1, 8, 18, -1, 11, 'tile', 'concession');
      c.walls(0, 0, 19, 12, 0, 4, 'facade_m');
      c.fill(0, 4, 0, 19, 4, 12, 'roof_glass');
      // Pillars on a 5-block grid. Glass spans 6, so a 20x13 hall cannot be
      // roofed off its walls alone - and the inspector notices.
      for (let x = 5; x <= 15; x += 5) {
        for (const z of [2, 6, 10]) for (let y = 0; y < 4; y++) c.set(x, y, z, 'steel');
      }
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
    key: 'grandstand_lg', name: 'Main Grandstand', group: 'seating', unlock: 'canopy',
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

  // --------------------------------------------------------------------------
  // Second wave. Every sport the game can schedule now has a prefab that lays
  // it out to regulation, and the facilities a big complex needs but nobody
  // enjoys placing block by block.
  // --------------------------------------------------------------------------
  {
    key: 'court_volleyball', name: 'Volleyball Court', group: 'field',
    size: { x: 15, z: 11 }, icon: '\u{1F3D0}',
    hint: 'An 18m x 10m indoor court with the net up and a run-off all round.',
    build(c) {
      c.fill(0, -1, 0, 14, -1, 10, 'rubber', 'concourse');
      c.fill(3, -1, 3, 11, -1, 7, 'gym_floor', 'court_volleyball');
      c.prop(7, 0, 5, 'net_volley', 0);
      c.prop(1, 0, 9, 'bench_crowd', 0);
      c.prop(12, 0, 9, 'bench_crowd', 0);
    },
  },
  {
    key: 'court_beach', name: 'Beach Court', group: 'field',
    size: { x: 14, z: 10 }, icon: '\u{1F3D6}',
    hint: 'A 16m x 10m sand court with the posts sunk and a raked surround.',
    build(c) {
      c.fill(0, -1, 0, 13, -1, 9, 'sand', 'concourse');
      c.fill(3, -1, 2, 10, -1, 6, 'sand_court', 'court_beach');
      c.prop(6, 0, 4, 'net_beach', 0);
      c.prop(1, 0, 8, 'bench_crowd', 0);
    },
  },
  {
    key: 'court_netball', name: 'Netball Court', group: 'field',
    size: { x: 22, z: 14 }, icon: '\u{1F945}',
    hint: 'A 32m x 16m court with a ring at each end and no backboards.',
    build(c) {
      c.fill(0, -1, 0, 21, -1, 13, 'rubber', 'concourse');
      c.fill(3, -1, 3, 18, -1, 10, 'gym_floor', 'court_netball');
      c.prop(3, 0, 6, 'post_netball', 0);
      c.prop(18, 0, 6, 'post_netball', 0);
      c.prop(1, 0, 12, 'bench_crowd', 0);
      c.prop(19, 0, 12, 'bench_crowd', 0);
    },
  },
  {
    key: 'court_handball', name: 'Handball Court', group: 'field',
    size: { x: 26, z: 16 }, icon: '\u{1F93E}',
    hint: 'A 40m x 20m court with a goal at each end and space behind them.',
    build(c) {
      c.fill(0, -1, 0, 25, -1, 15, 'rubber', 'concourse');
      c.fill(3, -1, 3, 22, -1, 12, 'gym_floor', 'court_handball');
      c.prop(3, 0, 7, 'goal_handball', 1);
      c.prop(22, 0, 7, 'goal_handball', 3);
      c.prop(12, 0, 14, 'dugout', 0);
      c.prop(1, 0, 14, 'bench_crowd', 0);
    },
  },
  {
    key: 'velodrome', name: 'Velodrome Track', group: 'field', unlock: 'velodrome',
    size: { x: 50, z: 34 }, icon: '\u{1F6B4}',
    hint: 'A 92m x 60m banked board oval with the start gate and timing tower.',
    build(c) {
      c.ellipse(0, 0, 49, 33, -1, 'gravel', 'concourse');
      // Filled, not a ring: the analyser measures an oval by its bounding box
      // only while it is actually oval-shaped, and a track with the middle cut
      // out would be measured as the thin band it is and fail regulation.
      c.ellipse(2, 2, 47, 31, -1, 'boards', 'track_cycling');
      c.prop(24, 0, 4, 'gate_start', 0);
      c.prop(6, 0, 16, 'timing_tower', 0);
      c.prop(43, 0, 16, 'camera_platform', 0);
      c.prop(24, 0, 29, 'podium', 0);
      c.prop(13, 0, 31, 'water_station', 0);
    },
  },
  {
    key: 'skate_park', name: 'Skate Park', group: 'field',
    size: { x: 22, z: 16 }, icon: '\u{1F6F9}',
    hint: 'A 36m x 24m concrete park with two transitions and somewhere to sit.',
    build(c) {
      c.fill(0, -1, 0, 21, -1, 15, 'pavement', 'concourse');
      c.fill(2, -1, 2, 19, -1, 13, 'skate_conc', 'park_skate');
      c.prop(6, 0, 4, 'ramp_skate', 0);
      c.prop(15, 0, 11, 'ramp_skate', 2);
      c.prop(2, 0, 15, 'bench_crowd', 0);
      c.prop(19, 0, 15, 'water_station', 0);
    },
  },
  {
    key: 'climb_wall', name: 'Climbing Wall', group: 'field',
    size: { x: 14, z: 12 }, icon: '\u{1F9D7}',
    hint: 'A 16m competition face with four routes on it and a crumb landing.',
    build(c) {
      c.fill(0, -1, 0, 13, -1, 11, 'rubber', 'concourse');
      c.fill(1, -1, 1, 12, -1, 9, 'crumb', 'wall_climb');
      // The face itself: eight blocks of concrete, braced back to the ground.
      c.fill(0, 0, 0, 13, 7, 0, 'concrete');
      for (const x of [2, 6, 11]) for (let y = 0; y < 4; y++) c.set(x, y, 1, 'steel');
      c.prop(2, 0, 1, 'holds_climb', 0);
      c.prop(5, 0, 1, 'holds_climb', 0);
      c.prop(8, 0, 1, 'holds_climb', 0);
      c.prop(11, 0, 1, 'holds_climb', 0);
      c.prop(6, 0, 11, 'bench_crowd', 0);
    },
  },

  // ------------------------------------------------------- more buildings
  {
    key: 'box_office', name: 'Ticket Office', group: 'building',
    size: { x: 14, z: 8 }, icon: '\u{1F39F}',
    hint: 'Windows, a queue line and turnstiles: where the money comes in.',
    build(c) {
      room(c, 14, 8, 3, { floor: 'tile', wall: 'brick', roof: 'roof_metal', zone: 'box_office' });
      // Serving windows along the front, and the queue line outside them.
      for (let x = 2; x <= 11; x += 3) c.set(x, 1, 0, 'window');
      for (const x of [1, 5, 9, 12]) c.set(x, 0, 0, 'turnstile');
      c.set(0, 2, 0, 'cctv');
      c.set(13, 2, 0, 'cctv');
      c.set(6, 2, 0, 'advert');
    },
  },
  {
    key: 'media_centre', name: 'Media Centre', group: 'building', unlock: 'broadcast',
    size: { x: 20, z: 14 }, icon: '\u{1F4FA}',
    hint: 'A press room between a broadcast gallery and a media workroom.',
    build(c) {
      room(c, 20, 14, 4, { floor: 'carpet', wall: 'facade_m', roof: 'roof_metal', zone: 'press_room' });
      // Metal spans 8 and the hall is 20 wide, so the middle needs columns.
      for (const x of [6, 13]) {
        for (const z of [3, 7, 11]) for (let y = 0; y < 4; y++) c.set(x, y, z, 'steel');
      }
      c.fill(1, -1, 1, 5, -1, 5, 'tile', 'broadcast');
      c.fill(14, -1, 1, 18, -1, 5, 'tile', 'media');
      c.fill(1, -1, 9, 18, -1, 12, 'carpet', 'press_room');
      for (let x = 8; x <= 11; x++) c.set(x, 0, 9, 'seat_press', 'press_room');
      c.prop(10, 0, 12, 'camera_platform', 0);
      c.set(9, 2, 13, 'screen');
    },
  },
  {
    key: 'vip_pavilion', name: 'VIP Pavilion', group: 'building', unlock: 'hospitality',
    size: { x: 16, z: 12 }, icon: '\u{1F942}',
    hint: 'Hospitality below, boxes above, and a row of seats looking out.',
    build(c) {
      c.fill(0, -1, 0, 15, -1, 11, 'carpet', 'hospitality');
      c.walls(0, 0, 15, 11, 0, 3, 'glass');
      for (const x of [5, 10]) for (const z of [3, 8]) for (let y = 0; y < 3; y++) c.set(x, y, z, 'steel');
      c.fill(0, 3, 0, 15, 3, 11, 'floor_conc');
      // Upper deck: boxes at the back, VIP seats on the front edge.
      c.fill(1, 3, 1, 14, 3, 10, 'carpet', 'luxury_box');
      c.walls(0, 4, 15, 11, 4, 3, 'glass');
      c.fill(1, 4, 1, 14, 4, 2, 'seat_vip', 'seating_vip');
      c.fill(0, 7, 0, 15, 7, 11, 'roof_metal');
      // A way in at each end of the ground floor.
      for (let y = 0; y < 2; y++) { c.set(7, y, 0, null); c.set(8, y, 0, null); }
      c.set(7, 2, 0, 'advert');
    },
  },
  {
    key: 'plant_room', name: 'Services Compound', group: 'building', unlock: 'power_grid',
    size: { x: 14, z: 10 }, icon: '⚙',
    hint: 'Switchgear, chillers, water storage and the bins, fenced off.',
    build(c) {
      c.fill(0, -1, 0, 13, -1, 9, 'floor_conc', 'plant');
      c.walls(0, 0, 13, 9, 0, 2, 'fence');
      for (let y = 0; y < 2; y++) { c.set(6, y, 0, null); c.set(7, y, 0, null); }
      c.fill(1, 0, 2, 3, 1, 4, 'hvac');
      c.fill(5, 0, 2, 6, 2, 4, 'water_tank');
      c.fill(9, 0, 2, 10, 1, 4, 'substation');
      c.fill(12, 0, 2, 12, 1, 4, 'generator');
      c.fill(1, -1, 6, 5, -1, 8, 'concrete', 'waste');
      for (const x of [1, 3, 5]) c.set(x, 0, 7, 'recycling');
      c.set(11, 2, 8, 'cctv');
    },
  },

  // --------------------------------------------------------- more outdoor
  {
    key: 'transit_stop', name: 'Transit Interchange', group: 'outdoor', unlock: 'transport',
    size: { x: 26, z: 14 }, icon: '\u{1F68B}',
    hint: 'Tram, bus and drop-off lanes behind one covered platform, plus bike parking.',
    build(c) {
      c.fill(0, -1, 0, 25, -1, 13, 'pavement', 'concourse');
      c.fill(0, -1, 0, 25, -1, 1, 'tram', 'transit');
      c.fill(0, -1, 6, 25, -1, 7, 'bus_lane', 'road_bus');
      c.fill(0, -1, 9, 25, -1, 10, 'dropoff', 'road_service');
      c.fill(0, -1, 12, 21, -1, 12, 'cycle_lane', 'cycle_route');
      // Platform canopy. Metal spans 8, so columns every eight blocks.
      for (const x of [4, 12, 20]) {
        for (const z of [3, 4]) for (let y = 0; y < 3; y++) c.set(x, y, z, 'steel');
      }
      c.fill(4, 3, 3, 20, 3, 4, 'roof_metal');
      c.set(12, 2, 4, 'advert');
      c.prop(8, 0, 4, 'bench_crowd', 0);
      c.prop(16, 0, 4, 'bench_crowd', 0);
      c.fill(22, -1, 11, 25, -1, 13, 'gravel', 'bike_park');
      c.prop(23, 0, 11, 'bike_rack', 0);
      c.prop(23, 0, 13, 'bike_rack', 0);
    },
  },
  {
    key: 'civic_forecourt', name: 'Civic Forecourt', group: 'outdoor',
    size: { x: 24, z: 16 }, icon: '⛲',
    hint: 'The approach a flagship deserves: paving, a fountain, trees and a clock.',
    build(c) {
      c.fill(0, -1, 0, 23, -1, 15, 'granite', 'fanzone');
      c.fill(9, -1, 6, 14, -1, 9, 'water');
      c.set(11, 0, 7, 'fountain');
      c.set(12, 0, 8, 'fountain');
      for (const [x, z] of [[2, 2], [21, 2], [2, 13], [21, 13]]) c.set(x, 0, z, 'pine');
      for (const [x, z] of [[6, 2], [17, 2], [6, 13], [17, 13]]) c.set(x, 0, z, 'planter');
      c.set(11, 0, 1, 'clocktower');
      c.set(12, 0, 1, 'statue');
      c.prop(4, 0, 8, 'bench_crowd', 0);
      c.prop(19, 0, 8, 'bench_crowd', 0);
      c.prop(2, 0, 8, 'water_station', 0);
      c.prop(21, 0, 8, 'bike_rack', 0);
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
