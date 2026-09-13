import { CHUNK_Y, GROUND_Y, BLOCK_SIZE } from '../core/constants.js';
import { block, blockId, AIR } from '../data/blocks.js';
import { ZONES, zone, zoneId, ZONE_NONE } from '../data/zones.js';

/**
 * Procedural structure generators.
 *
 * These are the "modular large structures" half of the building system: the
 * player still decides where a stand goes, how big it is and which way it
 * faces, but the engine lays the repetitive rows, supports and vomitories.
 * Building a 40,000-seat bowl by hand would be 130 taps of pure repetition.
 *
 * Every generator returns a PLAN: a flat list of
 *   [x, y, z, blockId, zoneId, ...]
 * so one structure can mix materials. `applyPlan` in buildTools consumes it.
 */
export const PLAN_STRIDE = 5;

const clampY = (y) => Math.max(0, Math.min(CHUNK_Y - 1, y));

/** Highest solid voxel in a column, or GROUND_Y-1 if the column is empty. */
function groundAt(world, x, z) {
  const h = world.heightAt(x, z);
  return h < 0 ? GROUND_Y - 1 : h;
}

function rect(a, b) {
  return {
    x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x),
    z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z),
  };
}

/**
 * A raked seating tier.
 *
 * The long axis of the footprint is the row direction; the short axis is the
 * rake. The stand rises *away* from `facing` (normally the pitch centre) so
 * every row can see over the one in front.
 *
 * @param opts.seatBlock    seating material id
 * @param opts.supportBlock structure under the seats
 * @param opts.rise         voxels of climb per row back (1 = 45 degrees)
 * @param opts.gapEvery     columns between vomitories (0 disables)
 * @param opts.baseY        override the front-row height (for upper tiers)
 * @param opts.facing       {x,z} the stand should look toward
 */
export function generateGrandstand(world, a, b, opts = {}) {
  const r = rect(a, b);
  const width = r.x1 - r.x0 + 1;
  const depth = r.z1 - r.z0 + 1;
  const alongX = width >= depth;

  // Rows run along the long axis; the rake climbs along the short one.
  const rowLen = alongX ? width : depth;
  const rakeLen = alongX ? depth : width;
  if (rowLen < 2 || rakeLen < 1) return { cells: [], meta: { seats: 0 } };

  const seatBlock = opts.seatBlock ?? blockId('seat');
  const supportBlock = opts.supportBlock ?? blockId('concrete');
  const stairBlock = blockId('stair');
  const rise = Math.max(0, opts.rise ?? 1);
  const gapEvery = opts.gapEvery ?? 14;

  // Rake away from whatever the stand faces (the pitch, by default).
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const facing = opts.facing || nearestPitch(world, cx, cz) || { x: cx, z: cz - 1 };
  let rakeSign;
  if (alongX) rakeSign = cz >= facing.z ? 1 : -1;
  else rakeSign = cx >= facing.x ? 1 : -1;

  const cells = [];
  let seats = 0, vomitories = 0;

  const seatZone = zone(block(seatBlock).autoZone || 'seating').id;
  const stairZone = zoneId('stairs');

  for (let row = 0; row < rakeLen; row++) {
    // row 0 is the front (closest to the pitch) when rakeSign is +1.
    const rakeIndex = rakeSign > 0 ? row : rakeLen - 1 - row;
    const y = clampY((opts.baseY ?? null) !== null
      ? opts.baseY + Math.round(row * rise)
      : 0 + Math.round(row * rise));

    for (let col = 0; col < rowLen; col++) {
      const x = alongX ? r.x0 + col : r.x0 + rakeIndex;
      const z = alongX ? r.z0 + rakeIndex : r.z0 + col;

      // Vomitories: a two-wide stairway cut through the full depth of the tier.
      const isGap = gapEvery > 0 && col % gapEvery >= gapEvery - 2 && col > 1 && col < rowLen - 2;

      const base = opts.baseY ?? (groundAt(world, x, z) + 1);
      const top = clampY(base + Math.round(row * rise));

      // Solid support from the ground (or the tier below) up to the seat.
      const fillFrom = opts.baseY ?? (groundAt(world, x, z) + 1);
      for (let yy = fillFrom; yy < top; yy++) {
        cells.push(x, clampY(yy), z, supportBlock, ZONE_NONE);
      }
      if (isGap) {
        cells.push(x, top, z, stairBlock, stairZone);
        if (row === 0) vomitories++;
      } else {
        cells.push(x, top, z, seatBlock, seatZone);
        seats++;
      }
    }
  }

  return {
    cells,
    meta: {
      seats,
      vomitories,
      rows: rakeLen,
      rowLength: rowLen,
      capacity: seats * (zone(seatZone).capacity || 6),
      alongX,
    },
  };
}

// Read off the registry rather than listed by hand: a hand-written list here
// silently stopped covering baseball, esports and the concert stage, and every
// sport added since would have had stands that faced the wrong way.
const SPORT_ZONE_IDS = new Set(
  ZONES.filter((z) => z.group === 'sport').map((z) => zoneId(z.key)));

/** Find the centre of the nearest sport surface, so stands face the action. */
function nearestPitch(world, cx, cz) {
  const sportIds = SPORT_ZONE_IDS;

  let sx = 0, sz = 0, n = 0;
  const step = Math.max(1, Math.floor(world.size / 90));
  const radius = 70;
  for (let x = Math.max(0, cx - radius); x < Math.min(world.size, cx + radius); x += step) {
    for (let z = Math.max(0, cz - radius); z < Math.min(world.size, cz + radius); z += step) {
      const top = world.heightAt(x | 0, z | 0);
      if (top < 0) continue;
      if (sportIds.has(world.getZone(x | 0, top, z | 0))) { sx += x; sz += z; n++; }
    }
  }
  return n > 0 ? { x: sx / n, z: sz / n } : null;
}

/**
 * A multi-level parking structure: decks, perimeter railings, support columns
 * and a ramp bay. One of these holds far more cars than the same footprint of
 * surface parking, which is exactly the trade-off big venues face.
 */
export function generateParkingGarage(world, a, b, opts = {}) {
  const r = rect(a, b);
  const width = r.x1 - r.x0 + 1;
  const depth = r.z1 - r.z0 + 1;
  if (width < 4 || depth < 4) return { cells: [], meta: { levels: 0, spaces: 0 } };

  const levels = Math.max(1, Math.min(6, opts.levels ?? 3));
  const deckBlock = blockId('floor_conc');
  const columnBlock = blockId('reinforced');
  const railBlock = blockId('railing');
  const rampBlock = blockId('asphalt');
  const parkZone = zoneId(opts.vip ? 'parking_vip' : 'parking');
  const LEVEL_H = 3;

  const cells = [];
  let deckVoxels = 0;
  const base = groundAt(world, r.x0, r.z0) + 1;

  for (let lv = 0; lv < levels; lv++) {
    const y = clampY(base + lv * LEVEL_H);
    for (let x = r.x0; x <= r.x1; x++) {
      for (let z = r.z0; z <= r.z1; z++) {
        const edge = x === r.x0 || x === r.x1 || z === r.z0 || z === r.z1;
        // Keep a ramp bay clear along one edge so the decks connect.
        const rampBay = x >= r.x1 - 2 && z >= r.z0 + 1 && z <= r.z1 - 1;

        if (lv === 0 && !rampBay) {
          cells.push(x, clampY(y - 1), z, deckBlock, ZONE_NONE);
        }
        if (rampBay) {
          cells.push(x, y, z, rampBlock, ZONE_NONE);
          continue;
        }
        cells.push(x, y, z, deckBlock, parkZone);
        deckVoxels++;

        if (edge && lv < levels) {
          cells.push(x, clampY(y + 1), z, railBlock, ZONE_NONE);
        }
        // Columns on a grid, carried up through the level above.
        if (!edge && (x - r.x0) % 6 === 3 && (z - r.z0) % 6 === 3) {
          for (let k = 1; k < LEVEL_H; k++) cells.push(x, clampY(y + k), z, columnBlock, ZONE_NONE);
        }
      }
    }
  }

  return {
    cells,
    meta: { levels, deckVoxels, spaces: Math.floor(deckVoxels / 5), height: levels * LEVEL_H },
  };
}

/**
 * Terrain shaping. All four modes work on a rectangle and respect the material
 * already on top of each column, so raising grass gives you more grass.
 *
 * @param mode 'raise' | 'lower' | 'flatten' | 'ramp'
 */
export function generateTerrainEdit(world, a, b, mode, opts = {}) {
  const r = rect(a, b);
  const amount = Math.max(1, opts.amount ?? 1);
  const cells = [];
  let raised = 0, lowered = 0;

  // Flatten and ramp need a reference height first.
  let targetAt;
  if (mode === 'flatten') {
    const target = opts.level ?? groundAt(world, a.x, a.z);
    targetAt = () => target;
  } else if (mode === 'ramp') {
    const h0 = groundAt(world, a.x, a.z);
    const h1 = groundAt(world, b.x, b.z);
    const spanX = (b.x - a.x) || 1;
    const spanZ = (b.z - a.z) || 1;
    const useX = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z);
    targetAt = (x, z) => {
      const t = useX ? (x - a.x) / spanX : (z - a.z) / spanZ;
      return Math.round(h0 + (h1 - h0) * Math.max(0, Math.min(1, t)));
    };
  }

  for (let x = r.x0; x <= r.x1; x++) {
    for (let z = r.z0; z <= r.z1; z++) {
      if (!world.inBounds(x, 0, z)) continue;
      const top = groundAt(world, x, z);
      const surfaceId = world.getBlock(x, top, z) || blockId('grass');
      const fillId = blockId('dirt');

      let target;
      if (mode === 'raise') target = top + amount;
      else if (mode === 'lower') target = top - amount;
      else target = targetAt(x, z);
      target = clampY(Math.max(1, target));

      if (target > top) {
        // Grow the column: dirt beneath, the original surface on top.
        for (let y = top + 1; y <= target; y++) {
          cells.push(x, y, z, y === target ? surfaceId : fillId, ZONE_NONE);
        }
        // The block that used to be the surface becomes fill.
        cells.push(x, top, z, fillId, ZONE_NONE);
        raised += target - top;
      } else if (target < top) {
        for (let y = top; y > target; y--) cells.push(x, y, z, AIR, ZONE_NONE);
        cells.push(x, target, z, surfaceId, ZONE_NONE);
        lowered += top - target;
      }
    }
  }
  return { cells, meta: { raised, lowered, columns: (r.x1 - r.x0 + 1) * (r.z1 - r.z0 + 1) } };
}

/**
 * A retaining wall along the edge of a terrace, from the ground up to the
 * height of the terrain behind it.
 */
export function generateRetainingWall(world, a, b, opts = {}) {
  const wallBlock = opts.block ?? blockId('reinforced');
  const cells = [];
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z)) + 1;
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const x = Math.round(a.x + (b.x - a.x) * t);
    const z = Math.round(a.z + (b.z - a.z) * t);
    const here = groundAt(world, x, z);
    // Match the tallest neighbour so the wall actually retains something.
    let tallest = here;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!world.inBounds(x + dx, 0, z + dz)) continue;
      tallest = Math.max(tallest, groundAt(world, x + dx, z + dz));
    }
    for (let y = Math.max(1, here - 2); y <= tallest; y++) {
      cells.push(x, clampY(y), z, wallBlock, ZONE_NONE);
    }
  }
  return { cells, meta: { length: steps } };
}

/**
 * A full seating bowl around a playing surface.
 *
 * The player taps the *pitch*, not the stadium: the four tiers are laid
 * outside that rectangle, each one facing in, with the side stands run long
 * so the corners close rather than leaving four holes. It is four calls to
 * the grandstand generator, which is the point - one bowl and four separately
 * placed stands produce identical voxels, so nothing here is a second way of
 * building a stand.
 */
export function generateBowl(world, a, b, opts = {}) {
  const r = rect(a, b);
  const rows = Math.max(2, Math.min(opts.rows ?? 12, 40));
  const facing = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
  const lim = world.size - 1;
  const clamp = (v) => Math.max(0, Math.min(lim, v));

  // North and south run the width of the pitch; east and west run the full
  // length including the corners, so the ring closes.
  const sides = [
    { x0: r.x0, x1: r.x1, z0: clamp(r.z0 - rows), z1: r.z0 - 1 },
    { x0: r.x0, x1: r.x1, z0: r.z1 + 1, z1: clamp(r.z1 + rows) },
    { x0: clamp(r.x0 - rows), x1: r.x0 - 1, z0: clamp(r.z0 - rows), z1: clamp(r.z1 + rows) },
    { x0: r.x1 + 1, x1: clamp(r.x1 + rows), z0: clamp(r.z0 - rows), z1: clamp(r.z1 + rows) },
  ];

  const cells = [];
  let seats = 0, capacity = 0, built = 0;
  for (const sd of sides) {
    if (sd.x1 < sd.x0 || sd.z1 < sd.z0) continue;
    if (sd.x0 < 0 || sd.z0 < 0 || sd.x1 > lim || sd.z1 > lim) continue;
    const out = generateGrandstand(world,
      { x: sd.x0, y: a.y, z: sd.z0 }, { x: sd.x1, y: a.y, z: sd.z1 },
      { ...opts, facing });
    if (!out.meta.seats) continue;
    built++;
    seats += out.meta.seats;
    capacity += out.meta.capacity;
    for (let i = 0; i < out.cells.length; i++) cells.push(out.cells[i]);
  }
  return { cells, meta: { seats, capacity, rows, sides: built } };
}

/**
 * A roof deck on columns, spanning whatever is underneath it.
 *
 * Roof coverage over the stands is a rating in its own right, and placing it
 * by hand means laying a slab twenty voxels in the air with nothing to aim at.
 * This finds the tallest thing in the footprint, clears it, and drops columns
 * down to the ground only where they will not land on a seat.
 */
export function generateCanopy(world, a, b, opts = {}) {
  const r = rect(a, b);
  const roofBlock = opts.block ?? blockId('roof_metal');
  const columnBlock = opts.columnBlock ?? blockId('steel');
  const clearance = Math.max(1, opts.clearance ?? 4);
  const spacing = Math.max(2, opts.spacing ?? 8);

  let highest = GROUND_Y - 1;
  for (let z = r.z0; z <= r.z1; z++) {
    for (let x = r.x0; x <= r.x1; x++) {
      if (!world.inBounds(x, 0, z)) continue;
      highest = Math.max(highest, groundAt(world, x, z));
    }
  }
  const deckY = clampY(highest + clearance);

  const cells = [];
  let panels = 0, columns = 0;
  for (let z = r.z0; z <= r.z1; z++) {
    for (let x = r.x0; x <= r.x1; x++) {
      if (!world.inBounds(x, deckY, z)) continue;
      cells.push(x, deckY, z, roofBlock, ZONE_NONE);
      panels++;

      // A column only on the grid, only on the rim, and only where the drop
      // is clear - a post through the middle of a tier is worse than no roof.
      const onRim = x === r.x0 || x === r.x1 || z === r.z0 || z === r.z1;
      if (!onRim || (x % spacing !== 0 && z % spacing !== 0)) continue;
      const foot = groundAt(world, x, z) + 1;
      if (deckY - foot < 2) continue;
      for (let y = foot; y < deckY; y++) cells.push(x, clampY(y), z, columnBlock, ZONE_NONE);
      columns++;
    }
  }
  return { cells, meta: { panels, columns, height: deckY, area: panels } };
}

export const STRUCTURES = {
  grandstand: generateGrandstand,
  garage: generateParkingGarage,
  retaining: generateRetainingWall,
  bowl: generateBowl,
  canopy: generateCanopy,
};

export const TERRAIN_MODES = ['raise', 'lower', 'flatten', 'ramp'];
