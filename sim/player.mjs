/**
 * A headless player.
 *
 * It drives the same methods the UI calls - nothing here reaches around the
 * game into raw state - so whatever it finds is something a real player would
 * find too. The point is not to play well; it is to play *plausibly* for three
 * hundred days and show where the economy sags or runs away.
 */
import { generatePrefab, PREFAB_BY_KEY } from '../src/voxel/prefabs.js';
import { generateParkingGarage } from '../src/voxel/structures.js';
import { applyPlan, pricePlan } from '../src/voxel/buildTools.js';
import { blockId, block } from '../src/data/blocks.js';
import { zoneId, SPORT_ZONES } from '../src/data/zones.js';
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

/** Zones that are a playing surface, and so are never built over. */
const SPORT_ZONE_IDS = new Set(SPORT_ZONES.map((sz) => zoneId(sz.key)));

export class SimPlayer {
  constructor(game, opts = {}) {
    this.game = game;
    this.log = opts.log || (() => {});
    this.sport = opts.sport || 'football';
    this.plots = [];              // where the next stand or room goes
    this.built = { stands: 0, rings: 0, rooms: {}, parking: 0, lights: 0, sites: 1 };
    this.roomSlot = 0;
    // Ground kept clear for the bowl to grow into. A player who fills the ring
    // road with sheds can never extend the stands past them.
    this.bowlReserve = 46;
    this.skipped = { cash: 0, space: 0 };
    // Set when the *bowl* runs out of room, which is the only kind of space
    // pressure worth buying land for. A facility that cannot find a slot near
    // the pitch is a placement problem, not a land problem, and must not stop
    // the stadium from growing.
    this.spaceTight = false;
    // Where the player laid its own pitch. The bowl rings this rather than the
    // analyser's largest-rectangle fit, which measures a half-built pitch as a
    // narrow strip while the construction site is still working through it.
    this.pitch = null;
    // The opening complex is laid out on the starting plot's coordinates. A
    // player given a bigger plot builds in the middle of it rather than in one
    // corner, so those coordinates are offset to whatever plot this is.
    this.origin = Math.max(0, (game.world.size - 128) >> 1);
    // Buying land grows the plot around the complex, so everything already
    // standing moves. A player sees that happen; a headless one holding voxel
    // coordinates has to be told, or it rings a pitch that is no longer there.
    game.bus.on('landchange', (off) => {
      if (!off) return;
      this.origin += off;
      if (this.pitch) {
        this.pitch.x0 += off; this.pitch.x1 += off;
        this.pitch.z0 += off; this.pitch.z1 += off;
      }
      if (this.bowl) { this.bowl.cx += off; this.bowl.cz += off; }
    });
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
    const r = this.commit(plan.cells, plan.meta.name, plan.props);
    if (r && !this.pitch && PREFAB_BY_KEY.get(key)?.group === 'field') {
      const f = plan.meta.footprint;
      this.pitch = { x0: x, z0: z, x1: x + f.x - 1, z1: z + f.z - 1 };
    }
    return r;
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
    const near = opts.near || null;      // {x, z} to stay close to
    const maxDist = opts.maxDist ?? Infinity;
    const minDist = opts.minDist ?? 0;    // keep clear of the bowl's future rings

    const free = (x0, z0) => this.freeRect(x0, z0, w, d, margin);

    let best = null, bestD = Infinity;
    for (let z = 2; z + d + margin < size; z += stride) {
      for (let x = 2; x + w + margin < size; x += stride) {
        const cx = x + w / 2, cz = z + d / 2;
        const dist = near ? Math.hypot(cx - near.x, cz - near.z) : 0;
        if (dist > maxDist || dist < minDist) continue;
        if (near && dist >= bestD) continue;      // already have something closer
        if (!free(x, z)) continue;
        if (!near) return { x, z };
        best = { x, z }; bestD = dist;
      }
    }
    return best;
  }

  /**
   * Is this rectangle still natural ground?
   *
   * Testing only the height would count a laid pitch as free - it is flush
   * with the terrain - and the player would cheerfully build a locker room in
   * the centre circle.
   */
  freeRect(x0, z0, w, d, margin = 1) {
    const world = this.game.world;
    const size = world.size;
    const ground = GROUND_Y - 1;
    const grass = blockId('grass'), dirt = blockId('dirt'), sand = blockId('sand');
    for (let z = z0 - margin; z <= z0 + d + margin; z += 2) {
      for (let x = x0 - margin; x <= x0 + w + margin; x += 2) {
        if (x < 0 || z < 0 || x >= size || z >= size) return false;
        if (world.heightAt(x, z) > ground) return false;
        const id = world.getBlock(x, ground, z);
        if (id !== grass && id !== dirt && id !== sand) return false;
      }
    }
    return true;
  }

  /**
   * Lay a patch of one zone on free ground at a given bearing from the pitch,
   * walking outward until it finds room.
   *
   * Bearings are the point: several of the game's measures count *separate*
   * pieces spread around the ground rather than total area, because eight
   * exits on one side of a bowl empty it no faster than one. Dropping every
   * patch in the first gap the search finds stacks them all together.
   */
  patchAt(bearing, w, d, zoneKey, blockKey = 'tile') {
    const c = this.pitchCentre;
    const v = this.game.primaryVenue;
    const maxR = v ? v.reach * 0.95 : 90;
    for (let r = this.bowlReserve; r < maxR; r += 3) {
      const x = Math.round(c.x + Math.cos(bearing) * r) - (w >> 1);
      const z = Math.round(c.z + Math.sin(bearing) * r) - (d >> 1);
      if (!this.freeRect(x, z, w, d)) continue;
      const cells = slab(x, z, x + w - 1, z + d - 1, GROUND_Y - 1, blockKey, zoneKey);
      if (this.commit(cells, `Zone: ${zoneKey}`)) return true;
      return false;                      // it fit but could not be paid for
    }
    return false;
  }

  /**
   * Exits and gates, spread around the bowl rather than stacked on one side.
   * Each one is laid at its own bearing so the analyser counts them as
   * separate ways out, which is what the safety score is actually measuring.
   */
  spreadExits(zoneKey, n) {
    let built = 0;
    for (let i = 0; i < n; i++) {
      const bearing = ((this.built.bearings || 0) + i) * (Math.PI * 2 / 9) + 0.3;
      if (this.patchAt(bearing, 7, 5, zoneKey, 'pavement')) built++;
    }
    this.built.bearings = (this.built.bearings || 0) + n;
    return built;
  }

  /**
   * A dedicated emergency route around the outside of the complex. The bowl
   * paves over the one the opening complex laid as it grows past it, and
   * without one the blue lights share the approach with the whole crowd.
   */
  emergencyRoad() {
    const c = this.pitchCentre;
    const v = this.game.primaryVenue;
    const r = Math.min(v ? v.reach * 0.92 : 90, this.bowlReserve + 8);
    for (const bearing of [0.9, 2.4, 3.9, 5.4]) {
      const x = Math.round(c.x + Math.cos(bearing) * r) - 14;
      const z = Math.round(c.z + Math.sin(bearing) * r) - 2;
      if (!this.freeRect(x, z, 28, 3)) continue;
      const cells = slab(x, z, x + 27, z + 2, GROUND_Y - 1, 'road_emerg', 'road_emergency');
      if (this.commit(cells, 'Emergency route')) return true;
      return false;
    }
    return false;
  }

  /** Where the analyser thinks the main venue is, in voxels. */
  get pitchCentre() {
    const v = this.game.primaryVenue;
    return v ? { x: v.centre.x, z: v.centre.z } : { x: 60, z: 58 };
  }

  /** The opening complex: a pitch, a stand, a way in and somewhere to park. */
  openingComplex() {
    const G = GROUND_Y;
    const o = this.origin;
    this.prefab('pitch_soccer', o + 32, o + 40, 0);
    this.prefab('grandstand_sm', o + 34, o + 26, 0);   // north stand, looking south
    this.prefab('entrance_gate', o + 38, o + 14, 0);
    this.prefab('locker_room', o + 14, o + 44, 0);
    this.prefab('car_park', o + 60, o + 6, 0);
    // Roads to the gate, so the parking is actually reachable.
    this.commit(slab(o + 4, o + 4, o + 120, o + 5, G - 1, 'road_main', 'road_main'), 'Approach road');
    this.commit(slab(o + 4, o + 96, o + 120, o + 97, G - 1, 'road_emerg', 'road_emergency'), 'Emergency route');
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
      const p = this.pitch;
      this.bowl = p ? {
        cx: Math.round((p.x0 + p.x1) / 2),
        cz: Math.round((p.z0 + p.z1) / 2),
        halfW: Math.ceil((p.x1 - p.x0 + 1) / 2),
        halfD: Math.ceil((p.z1 - p.z0 + 1) / 2),
      } : {
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
    // A ring that runs off one side of the plot still has three good sides.
    // Clamping rather than abandoning is what lets the bowl keep growing after
    // buying land, instead of stopping at whichever edge it met first.
    const lo = 2, hi = w.size - 3;
    const cx0 = Math.max(lo, x0), cx1 = Math.min(hi, x1);
    const cz0 = Math.max(lo, z0), cz1 = Math.min(hi, z1);
    if (y >= 58 || cx1 - cx0 < 4 || cz1 - cz0 < 4) {
      this.skipped.space++; this.spaceTight = true; return null;
    }
    // Every fifth ring is a concourse rather than seats, so the crowd can move.
    const concourse = this.built.rings > 0 && this.built.rings % 5 === 0;
    const topKey = concourse ? 'pavement' : 'seat';
    const topZone = concourse ? 'concourse' : 'seating';
    const cells = [];
    const conc = blockId('concrete');
    const top = blockId(topKey), tz = zoneId(topZone);
    const column = (x, z) => {
      // Never pave the playing surface: a ring that ate into the pitch would
      // cost the venue the regulation rating the whole complex is built on.
      if (SPORT_ZONE_IDS.has(w.getZone(x, G - 1, z))) return;
      // Anything standing here is a building, a gate or a mast, and the bowl
      // goes around it. Flat ground is fair game whatever it is made of: the
      // approach road and the flat car park that made sense three tiers ago
      // get paved over, the way they would be on a real site. Leaving those
      // alone is what turns a bowl into a ring of disconnected fragments.
      if (w.heightAt(x, z) > G - 1) return;
      for (let yy = G - 1; yy < y; yy++) cells.push(x, yy, z, conc, 0);
      cells.push(x, y, z, top, tz);
    };
    for (let x = cx0; x <= cx1; x++) {
      if (z0 >= lo) column(x, z0);
      if (z1 <= hi) column(x, z1);
    }
    for (let z = Math.max(cz0, z0 + 1); z <= Math.min(cz1, z1 - 1); z++) {
      if (x0 >= lo) column(x0, z);
      if (x1 <= hi) column(x1, z);
    }
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
    if (r) {
      this.built.rings++;
      // Keep the next few rings' worth of ground clear as the bowl grows.
      this.bowlReserve = Math.max(this.bowlReserve,
        Math.max(halfW, halfD) + this.built.rings + 12);
    }
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
      minDist: this.bowlReserve,
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
  /** Build one block of each facility asked for. Returns how many went up. */
  rooms(zones) {
    const G = GROUND_Y;
    let built = 0;
    for (const z of zones) {
      const n = this.built.rooms[z] || 0;
      // Facilities count toward the nearest venue, so they stay in reach too.
      const v = this.game.primaryVenue;
      const spot = this.findFreeArea(9, 8, {
        near: this.pitchCentre, minDist: this.bowlReserve, maxDist: v ? v.reach : 70,
      }) || this.findFreeArea(9, 8, { near: this.pitchCentre, minDist: this.bowlReserve });
      if (!spot) { this.skipped.space++; continue; }
      const cells = room(spot.x, spot.z, spot.x + 8, spot.z + 7, G - 1, 3, 'tile', z);
      if (this.commit(cells, `Room: ${z}`)) { this.built.rooms[z] = n + 1; built++; }
    }
    return built;
  }

  /**
   * A canopy over the top rings of the bowl.
   *
   * Cover is worth more than the seats it shades: spectator comfort and
   * appearance are both asked for directly by the top two tiers of event, and
   * an uncovered ground loses gate to the weather on every wet event day. The
   * outer wall of the bowl is carried up to meet it, so the canopy is
   * supported at its outer edge and cantilevers inward within the span the
   * material allows - which is what the structural check is looking for.
   */
  addRoof() {
    const w = this.game.world;
    const rings = this.built.rings;
    if (!this.bowl || rings < 10) return false;
    const G = GROUND_Y;
    const { cx, cz, halfW, halfD } = this.bowl;
    const done = this.s.research?.completed || [];
    const key = done.includes('canopy') ? 'roof_stadium' : 'roof_metal';
    const span = block(blockId(key)).spans;
    const roof = blockId(key), steel = blockId('steel');
    const outer = rings - 1 + 3;
    const top = G + Math.floor((rings - 1) * 0.8);
    const y = top + 3;
    if (y >= 62) return false;
    const depth = Math.min(span, Math.max(4, Math.floor(rings * 0.4)));
    const lo = 2, hi = w.size - 3;
    const cells = [];
    const seen = new Set();
    for (let k = 0; k < depth; k++) {
      const r = outer - k;
      const x0 = cx - halfW - r, x1 = cx + halfW + r;
      const z0 = cz - halfD - r, z1 = cz + halfD + r;
      const panel = (x, z) => {
        if (x < lo || z < lo || x > hi || z > hi) return;
        const id = (x << 9) | z;
        if (seen.has(id)) return;
        seen.add(id);
        if (w.getBlock(x, y, z) === roof) return;
        cells.push(x, y, z, roof, 0);
        // Carry the outermost ring up to meet the canopy it holds.
        if (k === 0) for (let yy = top + 1; yy < y; yy++) cells.push(x, yy, z, steel, 0);
      };
      for (let x = Math.max(lo, x0); x <= Math.min(hi, x1); x++) { panel(x, z0); panel(x, z1); }
      for (let z = Math.max(lo, z0 + 1); z <= Math.min(hi, z1 - 1); z++) { panel(x0, z); panel(x1, z); }
    }
    if (!cells.length) return false;
    if (!this.commit(cells, 'Stadium canopy')) return false;
    this.built.roofRings = rings;
    return true;
  }

  floodlights(n) {
    const G = GROUND_Y;
    const spots = [[28, 36], [92, 36], [28, 84], [92, 84], [28, 60], [92, 60], [60, 30], [60, 90]];
    const o = this.origin;
    const cells = [];
    for (let i = 0; i < n; i++) {
      const [x, z] = spots[(this.built.lights + i) % spots.length];
      const off = Math.floor((this.built.lights + i) / spots.length) * 3;
      for (let y = G; y < G + 12; y++) cells.push(o + x + off, y, o + z, blockId('steel'), 0);
      cells.push(o + x + off, G + 12, o + z, blockId('floodlight'), 0);
    }
    if (!this.commit(cells, 'Floodlights')) return false;
    this.built.lights += n;
    return true;
  }

  /**
   * A multi-level car park, using the same generator the in-game Garage tool
   * drives. Flat asphalt cannot park an international crowd on any plot the
   * game sells - stacking it is the intended answer.
   */
  addGarage(levels = 5) {
    const spot = this.findFreeArea(26, 26, { near: this.pitchCentre, minDist: this.bowlReserve })
      || this.findFreeArea(26, 26);
    if (!spot) { this.skipped.space++; return null; }
    const plan = generateParkingGarage(this.game.world,
      { x: spot.x, z: spot.z }, { x: spot.x + 25, z: spot.z + 25 }, { levels });
    if (!plan.cells.length) { this.skipped.space++; return null; }
    const r = this.commit(plan.cells, 'Parking garage');
    if (r) this.built.garages = (this.built.garages || 0) + 1;
    return r;
  }

  /** A transit interchange, bus bays and taxi ranks. */
  addTransit() {
    const G = GROUND_Y;
    const jobs = [
      [22, 12, 'transit', 'pavement'],
      [18, 8, 'parking_bus', 'bus_lane'],
      [16, 8, 'parking_taxi', 'park_taxi'],
      [30, 4, 'road_bus', 'bus_lane'],
    ];
    let built = 0;
    for (const [fw, fd, zk, bk] of jobs) {
      const spot = this.findFreeArea(fw, fd, { near: this.pitchCentre, minDist: this.bowlReserve })
        || this.findFreeArea(fw, fd);
      if (!spot) { this.skipped.space++; continue; }
      const cells = slab(spot.x, spot.z, spot.x + fw - 1, spot.z + fd - 1, G - 1, bk, zk);
      if (this.commit(cells, `Transit: ${zk}`)) built++;
    }
    return built ? { built } : null;
  }

  addParking() {
    const G = GROUND_Y;
    // Parking is a complex-wide asset, so it can go anywhere clear of the bowl.
    const spot = this.findFreeArea(40, 12, { near: this.pitchCentre, minDist: this.bowlReserve })
      || this.findFreeArea(20, 8, { near: this.pitchCentre, minDist: this.bowlReserve });
    if (!spot) { this.skipped.space++; return null; }
    const r = this.commit(
      slab(spot.x, spot.z, spot.x + 39, spot.z + 11, G - 1, 'asphalt', 'parking'), 'Parking');
    if (r) this.built.parking++;
    return r;
  }
}

export { slab, room, BID_PACKAGES };
