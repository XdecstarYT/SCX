import { VoxelWorld } from '../../src/voxel/world.js';
import { blockId } from '../../src/data/blocks.js';
import { zoneId } from '../../src/data/zones.js';
import { GROUND_Y } from '../../src/core/constants.js';
import { generateParkingGarage } from '../../src/voxel/structures.js';
import { applyPlan } from '../../src/voxel/buildTools.js';

/** Fill a solid box of one block type (and optional zone). */
export function fillBox(w, x0, y0, z0, x1, y1, z1, key, zkey) {
  const id = blockId(key);
  const zid = zkey ? zoneId(zkey) : undefined;
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
        w.setBlock(x, y, z, id, zid);
}

/** Fill a hollow rectangular band `t` voxels thick between two Y levels. */
export function fillRing(w, x0, z0, x1, z1, t, y0, y1, key, zkey) {
  const id = blockId(key);
  const zid = zkey ? zoneId(zkey) : undefined;
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const inBand = x < x0 + t || x > x1 - t || z < z0 + t || z > z1 - t;
        if (inBand) w.setBlock(x, y, z, id, zid);
      }
}

/**
 * Hand-built reference stadium used by the tests: a regulation pitch, a raked
 * bowl of seating, gates, concourse, back-of-house rooms, parking and lights.
 */
export function buildReferenceStadium(size = 128) {
  const w = new VoxelWorld(size);
  w.generateTerrain();
  const G = GROUND_Y;

  // Pitch: 54 x 35 voxels = 108m x 70m, regulation football.
  const px0 = 38, pz0 = 46, px1 = px0 + 53, pz1 = pz0 + 34;
  fillBox(w, px0, G - 1, pz0, px1, G - 1, pz1, 'turf', 'pitch_football');

  // Bowl: 4 rings of seating stepping up and outward on all four sides.
  // Each ring is a hollow band (2 voxels deep) so the pitch is never buried.
  for (let r = 0; r < 4; r++) {
    const y = G + r;
    const x0 = px0 - 2 - r * 2, x1 = px1 + 2 + r * 2;
    const z0 = pz0 - 2 - r * 2, z1 = pz1 + 2 + r * 2;
    fillRing(w, x0, z0, x1, z1, 2, G - 1, y - 1, 'concrete');       // support
    fillRing(w, x0, z0, x1, z1, 2, y, y, 'seat', 'seating');        // seats
  }

  const bx0 = px0 - 10, bx1 = px1 + 10, bz0 = pz0 - 10, bz1 = pz1 + 10;

  fillRing(w, bx0 - 6, bz0 - 6, bx1 + 6, bz1 + 6, 6, G - 1, G - 1, 'pavement', 'concourse');

  const gates = [[px0 + 20, bz0 - 6], [px0 + 20, bz1 + 6], [bx0 - 6, pz0 + 14], [bx1 + 6, pz0 + 14]];
  for (const [gx, gz] of gates) fillBox(w, gx - 3, G - 1, gz - 1, gx + 3, G - 1, gz + 1, 'tile', 'entrance');
  const exits = [[px0 + 5, bz0 - 6], [px1 - 5, bz0 - 6], [px0 + 5, bz1 + 6], [px1 - 5, bz1 + 6]];
  for (const [gx, gz] of exits) fillBox(w, gx - 3, G - 1, gz - 1, gx + 3, G - 1, gz + 1, 'tile', 'exit');

  for (const sx of [px0 + 8, px0 + 26, px0 + 44]) {
    fillBox(w, sx, G, bz0 - 1, sx + 1, G + 3, bz0 + 5, 'stair', 'stairs');
    fillBox(w, sx, G, bz1 - 5, sx + 1, G + 3, bz1 + 1, 'stair', 'stairs');
  }

  const bh = (x, z, wd, dp, blk, zk) => fillBox(w, x, G, z, x + wd - 1, G + 2, z + dp - 1, blk, zk);
  bh(bx0 - 5, pz0 - 2, 6, 7, 'tile', 'locker');
  bh(bx0 - 5, pz0 + 7, 6, 7, 'tile', 'locker');
  bh(bx0 - 5, pz0 + 16, 4, 4, 'tile', 'medical');
  bh(bx0 - 5, pz0 + 22, 5, 5, 'tile', 'media');
  bh(bx0 - 5, pz0 + 29, 4, 5, 'tile', 'broadcast');
  bh(bx1 + 1, pz0 + 2, 4, 5, 'tile', 'security');

  for (let i = 0; i < 6; i++) {
    const x = bx0 + 4 + i * 11;
    bh(x, bz0 - 5, 7, 4, 'tile', 'restroom');
    bh(x, bz1 + 2, 7, 4, 'tile', 'restroom');
  }
  for (let i = 0; i < 5; i++) {
    const x = bx0 + 6 + i * 12;
    bh(x, bz0 - 9, 6, 3, 'tile', 'concession');
    bh(x, bz1 + 7, 6, 3, 'tile', 'concession');
  }
  bh(bx1 + 1, pz0 + 12, 5, 6, 'tile', 'retail');

  for (const [fx, fz] of [[bx0 - 2, bz0 - 2], [bx1 + 2, bz0 - 2], [bx0 - 2, bz1 + 2], [bx1 + 2, bz1 + 2]]) {
    fillBox(w, fx, G, fz, fx, G + 12, fz, 'steel');
    fillBox(w, fx, G + 13, fz, fx, G + 13, fz, 'floodlight');
  }

  fillBox(w, 6, G - 1, 6, 110, G - 1, 30, 'asphalt', 'parking');
  fillBox(w, 6, G - 1, 32, 110, G - 1, 34, 'road', 'road');

  return w;
}


/**
 * A genuinely national-standard complex: a big two-tier bowl, VIP and
 * hospitality, media and broadcast, security, multi-level parking and a
 * transit interchange. Used by the tests that need a venue an organiser
 * would actually take seriously.
 */
export function buildNationalComplex(size = 200) {
  const w = buildReferenceStadium(size);
  const G = GROUND_Y;

  // Upper tier all the way round, on top of the existing bowl.
  for (let r = 0; r < 9; r++) {
    const y = 16 + r, x0 = 24 - r, x1 = 105 + r, z0 = 32 - r, z1 = 94 + r;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const band = x <= x0 + 2 || x >= x1 - 2 || z <= z0 + 2 || z >= z1 - 2;
        if (!band) continue;
        for (let yy = 12; yy < y; yy++) w.setBlock(x, yy, z, blockId('concrete'));
        w.setBlock(x, y, z, blockId('seat'), zoneId('seating'));
      }
    }
  }

  // A VIP level and hospitality suites behind the west stand.
  fillBox(w, 22, 14, 44, 25, 14, 82, 'seat_vip', 'seating_vip');
  fillBox(w, 16, 14, 44, 21, 16, 82, 'tile', 'hospitality');

  // Media, broadcast and security scaled to the new capacity.
  fillBox(w, 16, G, 96, 30, G + 2, 104, 'tile', 'media');
  fillBox(w, 32, G, 96, 44, G + 2, 104, 'tile', 'broadcast');
  fillBox(w, 46, G, 96, 56, G + 2, 102, 'tile', 'security');

  // Extra restrooms and concessions for the upper tier.
  for (let i = 0; i < 8; i++) {
    fillBox(w, 20 + i * 12, G, 106, 28 + i * 12, G + 2, 112, 'tile', 'restroom');
    fillBox(w, 20 + i * 12, G, 114, 28 + i * 12, G + 2, 118, 'tile', 'concession');
  }

  // Six four-level parking structures instead of an endless tarmac plain.
  for (let i = 0; i < 6; i++) {
    const x0 = 6 + (i % 3) * 40;
    const z0 = 122 + Math.floor(i / 3) * 34;
    const plan = generateParkingGarage(w, { x: x0, z: z0 }, { x: x0 + 34, z: z0 + 28 }, { levels: 4 });
    applyPlan(w, plan.cells, 'garage');
  }

  // A transit interchange and coach bays on the approach.
  fillBox(w, 120, G - 1, 40, 145, G - 1, 58, 'pavement', 'transit');
  fillBox(w, 120, G - 1, 62, 145, G - 1, 74, 'asphalt', 'parking_bus');
  fillBox(w, 116, G - 1, 30, 150, G - 1, 38, 'road', 'road');

  // A wide concourse ring and generous egress for 60,000 people.
  fillRing(w, 8, 22, 121, 106, 5, G - 1, G - 1, 'pavement', 'concourse');
  for (let i = 0; i < 10; i++) {
    fillBox(w, 12 + i * 11, G - 1, 20, 20 + i * 11, G - 1, 21, 'tile', 'exit');
    fillBox(w, 12 + i * 11, G - 1, 107, 20 + i * 11, G - 1, 108, 'tile', 'exit');
  }
  for (let i = 0; i < 6; i++) {
    fillBox(w, 14 + i * 18, G - 1, 16, 24 + i * 18, G - 1, 18, 'tile', 'entrance');
  }
  // Internal road network serving the garages.
  for (let i = 0; i < 4; i++) fillBox(w, 4, G - 1, 116 + i * 18, 150, G - 1, 118 + i * 18, 'road', 'road');
  fillBox(w, 2, G - 1, 20, 4, G - 1, 170, 'road', 'road');

  // Floodlight masts and two big screens.
  const masts = [];
  for (let i = 0; i < 10; i++) masts.push([14 + i * 11, 24], [14 + i * 11, 104]);
  for (const [fx, fz] of masts) {
    fillBox(w, fx, G, fz, fx, G + 18, fz, 'steel');
    fillBox(w, fx, G + 19, fz, fx, G + 19, fz, 'floodlight');
  }
  fillBox(w, 52, 20, 30, 76, 30, 30, 'screen');
  fillBox(w, 52, 20, 96, 76, 30, 96, 'screen');

  return w;
}


/**
 * Buy every utility network up to the point where it keeps pace with demand.
 * A complex this size genuinely needs the infrastructure behind it.
 */
export function fundInfrastructure(game) {
  const before = game.state.cash;
  game.state.cash = Math.max(game.state.cash, 80_000_000);
  for (const key of ['power', 'water', 'sewer', 'data', 'climate']) {
    for (let i = 0; i < 5; i++) {
      if ((game.state.utilityStatus?.[key]?.deficit ?? 0) <= 0) break;
      if (!game.upgradeUtility(key).ok) break;
    }
  }
  game.state.cash = before;
  game.analyze(true);
  return game;
}
