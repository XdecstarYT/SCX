/**
 * A headless player.
 *
 * It drives the same methods the UI calls - nothing here reaches around the
 * game into raw state - so whatever it finds is something a real player would
 * find too. The point is not to play well; it is to play *plausibly* for three
 * hundred days and show where the economy sags or runs away.
 */
import { generatePrefab } from '../src/voxel/prefabs.js';
import { applyPlan, pricePlan } from '../src/voxel/buildTools.js';
import { blockId } from '../src/data/blocks.js';
import { zoneId } from '../src/data/zones.js';
import { propId } from '../src/data/props.js';
import { GROUND_Y, PLAN_STRIDE } from './constants.mjs';
import { BID_PACKAGES } from '../src/data/events.js';

/** Lay a flat slab of one material, as a plan the economy can price. */
function slab(x0, z0, x1, z1, y, blockKey, zoneKey) {
  const id = blockId(blockKey);
  const zid = zoneKey ? zoneId(zoneKey) : 0;
  const cells = [];
  for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) cells.push(x, y, z, id, zid);
  }
  return cells;
}

/** A hollow room: floor, four walls, roof, zoned. */
function room(x0, z0, x1, z1, y, h, floorKey, zoneKey) {
  const cells = slab(x0, z0, x1, z1, y, floorKey, zoneKey);
  const wall = blockId('concrete');
  const roof = blockId('roof_conc');
  for (let k = 1; k <= h; k++) {
    for (let x = x0; x <= x1; x++) { cells.push(x, y + k, z0, wall, 0); cells.push(x, y + k, z1, wall, 0); }
    for (let z = z0 + 1; z < z1; z++) { cells.push(x0, y + k, z, wall, 0); cells.push(x1, y + k, z, wall, 0); }
  }
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) cells.push(x, y + h + 1, z, roof, 0);
  return cells;
}

export class SimPlayer {
  constructor(game, opts = {}) {
    this.game = game;
    this.log = opts.log || (() => {});
    this.sport = opts.sport || 'football';
    this.plots = [];              // where the next stand or room goes
    this.built = { stands: 0, rings: 0, rooms: {}, parking: 0, lights: 0, sites: 1 };
    this.roomSlot = 0;
    this.skipped = { cash: 0, space: 0 };
    // Set when the *bowl* runs out of room, which is the only kind of space
    // pressure worth buying land for. A facility that cannot find a slot near
    // the pitch is a placement problem, not a land problem, and must not stop
    // the stadium from growing.
    this.spaceTight = false;
  }

  get s() { return this.game.state; }

  // ------------------------------------------------------------- building
  /**
   * Commit a plan the way the build controller does: price it, refuse it if it
   * cannot be afforded, then either stage it or apply it and pay for it.
   */
  commit(cells, label, props = null) {
    const g = this.game;
    const price = pricePlan(g.world, cells, props);
    const net = price.net * (g.state.buildCostMult || 1);
    if (net > g.state.cash) { this.skipped.cash++; return null; }
    const count = cells.length / PLAN_STRIDE;
    const staged = g.stageOrApply({ label, cells, props, cost: net, count });
    if (staged) {
      g.spendConstruction(net, true);
      g.state.stats.blocksPlaced += price.placed;
      return { staged: true, cost: net, count };
    }
    applyPlan(g.world, cells, label, props);
    g.spendConstruction(net, true);
    g.state.stats.blocksPlaced += price.placed;
    g.markWorldDirty();
    return { staged: false, cost: net, count };
  }

  prefab(key, x, z, rot = 0, y = GROUND_Y) {
    const plan = generatePrefab(this.game.world, key, { x, y, z }, rot);
    if (!plan.cells.length || plan.meta.outside > 0) { this.skipped.space++; return null; }
    return this.commit(plan.cells, plan.meta.name, plan.props);
  }

  /**
   * Find an unbuilt rectangle on the plot.
   *
   * "Unbuilt" means every column is still at natural ground level, which is
   * how a player eyeballs it. Scans on a coarse stride so a 256-wide plot is
   * still cheap to search, and remembers where it got to so repeated calls
   * spread out rather than retrying the same corner.
   */
  findFreeArea(w, d, opts = {}) {
    const world = this.game.world;
    const size = world.size;
    const margin = opts.margin ?? 1;
    const stride = 4;
    const ground = GROUND_Y - 1;
    const near = opts.near || null;      // {x, z} to stay close to
    const maxDist = opts.maxDist ?? Infinity;

    // "Free" means still natural ground. Testing only the height would count a
    // laid pitch as free - it is flush with the terrain - and the player would
    // cheerfully build a locker room in the centre circle.
    const grass = blockId('grass'), dirt = blockId('dirt'), sand = blockId('sand');
    const natural = (x, z) => {
      const h = world.heightAt(x, z);
      if (h > ground) return false;
      const id = world.getBlock(x, ground, z);
      return id === grass || id === dirt || id === sand;
    };
    const free = (x0, z0) => {
      for (let z = z0 - margin; z <= z0 + d + margin; z += 2) {
        for (let x = x0 - margin; x <= x0 + w + margin; x += 2) {
          if (x < 0 || z < 0 || x >= size || z >= size) return false;
          if (!natural(x, z)) return false;
        }
      }
      return true;
    };

    let best = null, bestD = Infinity;
    for (let z = 2; z + d + margin < size; z += stride) {
      for (let x = 2; x + w + margin < size; x += stride) {
        const cx = x + w / 2, cz = z + d / 2;
        const dist = near ? Math.hypot(cx - near.x, cz - near.z) : 0;
        if (dist > maxDist) continue;
        if (near && dist >= bestD) continue;      // already have something closer
        if (!free(x, z)) continue;
        if (!near) return { x, z };
        best = { x, z }; bestD = dist;
      }
    }
    return best;
  }

  /** Where the analyser thinks the main venue is, in voxels. */
  get pitchCentre() {
    const v = this.game.primaryVenue;
    return v ? { x: v.centre.x, z: v.centre.z } : { x: 60, z: 58 };
  }

  /** The opening complex: a pitch, a stand, a way in and somewhere to park. */
  openingComplex() {
    const G = GROUND_Y;
    this.prefab('pitch_soccer', 32, 40, 0);
    this.prefab('grandstand_sm', 34, 26, 0);         // north stand, looking south
    this.prefab('entrance_gate', 38, 14, 0);
    this.prefab('locker_room', 14, 44, 0);
    this.prefab('car_park', 60, 6, 0);
    // Roads to the gate, so the parking is actually reachable.
    this.commit(slab(4, 4, 120, 5, G - 1, 'road_main', 'road_main'), 'Approach road');
    this.commit(slab(4, 96, 120, 97, G - 1, 'road_emerg', 'road_emergency'), 'Emergency route');
    this.rooms(['restroom', 'concession', 'medical', 'security']);
    this.floodlights(4);
  }

  /**
   * Extend the bowl by one ring of raked seating around the pitch.
   *
   * This is how a stadium actually grows, and it is far more seat-efficient
   * than dropping separate prefab stands: every ring is entirely inside the
   * venue's reach, so all of it counts.
   */
  expandBowl() {
    const w = this.game.world;
    const v = this.game.primaryVenue;
    if (!v) return null;
    const G = GROUND_Y;
    // Pin the pitch once. Reading it back each ring would measure a pitch that
    // the previous ring had already encroached on, and the bowl would march
    // inward and pave over the playing surface.
    if (!this.bowl) {
      this.bowl = {
        cx: Math.round(v.centre.x),
        cz: Math.round(v.centre.z),
        halfW: Math.ceil(v.field.w / 2),
        halfD: Math.ceil(v.field.d / 2),
      };
    }
    const { cx, cz, halfW, halfD } = this.bowl;
    const ring = this.built.rings + 3;            // leave a run-off around the pitch
    const y = G + Math.floor(this.built.rings * 0.8);
    const x0 = cx - halfW - ring, x1 = cx + halfW + ring;
    const z0 = cz - halfD - ring, z1 = cz + halfD + ring;
    if (x0 < 2 || z0 < 2 || x1 >= w.size - 2 || z1 >= w.size - 2 || y >= 58) {
      this.skipped.space++; this.spaceTight = true; return null;
    }
    // Every fifth ring is a concourse rather than seats, so the crowd can move.
    const concourse = this.built.rings > 0 && this.built.rings % 5 === 0;
    const topKey = concourse ? 'pavement' : 'seat';
    const topZone = concourse ? 'concourse' : 'seating';
    const cells = [];
    const conc = blockId('concrete');
    const top = blockId(topKey), tz = zoneId(topZone);
    const grass = blockId('grass'), dirt = blockId('dirt');
    const column = (x, z) => {
      if (w.heightAt(x, z) > G - 1) return;        // already built on
      const surface = w.getBlock(x, G - 1, z);
      if (surface !== grass && surface !== dirt) return;   // never pave the pitch
      for (let yy = G - 1; yy < y; yy++) cells.push(x, yy, z, conc, 0);
      cells.push(x, y, z, top, tz);
    };
    for (let x = x0; x <= x1; x++) { column(x, z0); column(x, z1); }
    for (let z = z0 + 1; z < z1; z++) { column(x0, z); column(x1, z); }
    if (!cells.length) {
      // This ring is entirely blocked by something already standing there.
      // Step over it and try the next one out rather than giving up on the
      // bowl altogether.
      this.built.rings++;
      this.blockedRings = (this.blockedRings || 0) + 1;
      if (this.blockedRings > 6) { this.skipped.space++; this.spaceTight = true; return null; }
      return this.expandBowl();
    }
    this.blockedRings = 0;
    const r = this.commit(cells, concourse ? 'Concourse ring' : 'Seating ring');
    if (r) this.built.rings++;
    return r;
  }

  /**
   * Add another raked stand wherever the plot still has room for one, so a
   * bigger plot genuinely buys more seats.
   */
  addStand() {
    const key = this.built.stands % 3 === 0 ? 'grandstand_lg' : 'grandstand_sm';
    const w = key === 'grandstand_lg' ? 44 : 24;
    const d = key === 'grandstand_lg' ? 18 : 10;
    // Seating only counts toward a venue when it is inside that venue's reach,
    // so stands hug the pitch rather than landing wherever there is room.
    const v = this.game.primaryVenue;
    const spot = this.findFreeArea(w, d, {
      near: this.pitchCentre,
      maxDist: v ? v.reach * 0.92 : 60,
    });
    if (!spot) { this.skipped.space++; this.spaceTight = true; return null; }
    const r = this.prefab(key, spot.x, spot.z, 0);
    if (r) this.built.stands++;
    return r;
  }

  /**
   * Back-of-house rooms, packed into a grid on whatever land is free. The grid
   * grows with the plot, so buying land really does buy room to build.
   */
  rooms(zones) {
    const G = GROUND_Y;
    const size = this.game.world.size;
    for (const z of zones) {
      const n = this.built.rooms[z] || 0;
      // Facilities count toward the nearest venue, so they stay in reach too.
      const v = this.game.primaryVenue;
      const spot = this.findFreeArea(9, 8, { near: this.pitchCentre, maxDist: v ? v.reach : 70 })
        || this.findFreeArea(9, 8);
      if (!spot) { this.skipped.space++; continue; }
      const cells = room(spot.x, spot.z, spot.x + 8, spot.z + 7, G - 1, 3, 'tile', z);
      if (this.commit(cells, `Room: ${z}`)) this.built.rooms[z] = n + 1;
    }
  }

  floodlights(n) {
    const G = GROUND_Y;
    const spots = [[28, 36], [92, 36], [28, 84], [92, 84], [28, 60], [92, 60], [60, 30], [60, 90]];
    const cells = [];
    for (let i = 0; i < n; i++) {
      const [x, z] = spots[(this.built.lights + i) % spots.length];
      const off = Math.floor((this.built.lights + i) / spots.length) * 3;
      for (let y = G; y < G + 12; y++) cells.push(x + off, y, z, blockId('steel'), 0);
      cells.push(x + off, G + 12, z, blockId('floodlight'), 0);
    }
    if (this.commit(cells, 'Floodlights')) this.built.lights += n;
  }

  addParking() {
    const G = GROUND_Y;
    // Parking is a complex-wide asset, so it can go anywhere with room.
    const spot = this.findFreeArea(40, 12) || this.findFreeArea(20, 8);
    if (!spot) { this.skipped.space++; return null; }
    const r = this.commit(
      slab(spot.x, spot.z, spot.x + 39, spot.z + 11, G - 1, 'asphalt', 'parking'), 'Parking');
    if (r) this.built.parking++;
    return r;
  }
}

export { slab, room, BID_PACKAGES };
