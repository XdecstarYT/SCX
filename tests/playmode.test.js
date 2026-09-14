import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelWorld } from '../src/voxel/world.js';
import { blockId } from '../src/data/blocks.js';
import { zoneId } from '../src/data/zones.js';
import { GROUND_Y, BLOCK_SIZE } from '../src/core/constants.js';
import { propId } from '../src/data/props.js';
import {
  siteStops, spotReport, seatReport, sightline, amenityFields,
  walkProgress, reachStop, recordSeat, completeWalk,
  createSiteWalkState, certificateActive, inspectionLift, combineLift,
  CERTIFICATE_DAYS, STOP_RADIUS,
} from '../src/core/siteWalk.js';

globalThis.performance ??= { now: () => Date.now() };

const G = GROUND_Y;

/** A pitch with one stand beside it, and the odd facility. */
function ground(size = 96) {
  const w = new VoxelWorld(size);
  w.generateTerrain();
  const turf = blockId('turf'), seat = blockId('seat'), conc = blockId('floor_conc');
  for (let x = 30; x < 70; x++) {
    for (let z = 30; z < 60; z++) w.setBlock(x, G - 1, z, turf, zoneId('pitch_football'));
  }
  // A raked stand along the south edge, rows climbing away from the pitch.
  for (let r = 0; r < 8; r++) {
    for (let x = 30; x < 70; x++) {
      w.setBlock(x, G + r, 61 + r, seat, zoneId('seating'));
      for (let y = G - 1; y < G + r; y++) w.setBlock(x, y, 61 + r, conc, 0);
    }
  }
  // A few facilities, so there is a walk worth doing.
  for (let x = 30; x < 36; x++) for (let z = 72; z < 76; z++) w.setBlock(x, G - 1, z, conc, zoneId('restroom'));
  for (let x = 40; x < 46; x++) for (let z = 72; z < 76; z++) w.setBlock(x, G - 1, z, conc, zoneId('concession'));
  for (let x = 50; x < 56; x++) for (let z = 72; z < 76; z++) w.setBlock(x, G - 1, z, conc, zoneId('entrance'));
  return w;
}

const venueOf = (w) => {
  // A stand-in venue record with the fields the walk actually reads.
  return { key: 'v', name: 'Test Ground', sportName: 'Football', centre: { x: 50, z: 45 },
           field: { y: G - 1, w: 40, d: 30 }, reach: 80, ratings: { issues: [], overall: 60 } };
};

// ----------------------------------------------------------------- sightline

test('a seat with a clear line to the pitch sees it, and one behind a wall does not', () => {
  const w = ground();
  const v = venueOf(w);
  const seat = { x: 50, y: G + 7, z: 68 };      // top row, looking over everything
  const before = sightline(w, seat, v);
  assert.ok(before.quality > 0.8,
    `the top row of an unobstructed stand should see the pitch, got ${before.clear}/${before.total}`);
  assert.equal(before.restricted, false);

  // Drop a slab of roof across the whole line between that seat and the grass.
  for (let x = 20; x < 80; x++) {
    for (let y = G - 1; y < G + 14; y++) w.setBlock(x, y, 60, blockId('roof_metal'), 0);
  }
  const after = sightline(w, seat, v);
  assert.ok(after.quality < before.quality,
    'putting a wall in front of a seat did not change what it can see');
  assert.ok(after.restricted, `the seat should now be restricted, got ${after.clear}/${after.total}`);
  assert.equal(after.blockedBy, 'Metal Roof', 'the report should name what is in the way');
});

test('a seat far from the action is graded down even with a clear view', () => {
  // A big plot, so there is room to stand a long way off with nothing between.
  const w = ground(220);
  const v = venueOf(w);
  const close = sightline(w, { x: 50, y: G + 2, z: 45 }, v);
  assert.ok(!close.restricted && close.distance < 60,
    `standing on the halfway line should be a clear, close view, got ${close.grade} at ${close.distance}m`);

  // Same clear line down the open side of the ground, a long way out.
  const far = sightline(w, { x: 190, y: G + 6, z: 45 }, v);
  assert.ok(far.quality >= 0.8, `the far view should still be clear, got ${far.clear}/${far.total}`);
  assert.ok(far.distance > close.distance);
  assert.equal(far.grade, 'Distant',
    `a clear but distant view should read Distant, got ${far.grade} at ${far.distance}m`);
});

// ---------------------------------------------------------------- spotReport

test('standing in a corridor reports the corridor, not the plot', () => {
  const w = new VoxelWorld(64);
  w.generateTerrain();
  const conc = blockId('floor_conc'), wall = blockId('concrete');
  // A 2-block-wide passage running along x.
  for (let x = 10; x < 40; x++) {
    for (let z = 20; z < 22; z++) w.setBlock(x, G - 1, z, conc, zoneId('concourse'));
    for (const z of [19, 22]) for (let y = G; y < G + 3; y++) w.setBlock(x, y, z, wall, 0);
  }
  const fields = amenityFields(w);
  const r = spotReport(w, { x: 25, y: G, z: 20 }, [], fields);
  assert.equal(r.zone.key, 'concourse');
  assert.equal(r.width, 2, `a two-block passage should read 2 wide, got ${r.width}`);
  assert.equal(r.widthMetres, 2 * BLOCK_SIZE);
  assert.ok(r.notes.some((n) => /would not pass/.test(n)),
    `a 4m corridor should be called out, got: ${r.notes.join(' | ')}`);
});

test('the amenity field measures to the nearest one, and says so when there is none', () => {
  const w = new VoxelWorld(64);
  w.generateTerrain();
  const conc = blockId('floor_conc');
  for (let x = 10; x < 13; x++) for (let z = 10; z < 13; z++) {
    w.setBlock(x, G - 1, z, conc, zoneId('restroom'));
  }
  const fields = amenityFields(w);
  const near = spotReport(w, { x: 16, y: G, z: 11 }, [], fields);
  const loo = near.amenities.find((a) => a.key === 'restroom');
  assert.ok(loo.distance >= 3.5 && loo.distance <= 4.5,
    `four blocks from the loos should measure about 4, got ${loo.distance}`);

  const food = near.amenities.find((a) => a.key === 'concession');
  assert.equal(food.distance, null, 'there is no food on this plot');
  assert.ok(food.poor, 'no food at all has to count as poor');

  const far = spotReport(w, { x: 55, y: G, z: 55 }, [], fields);
  const farLoo = far.amenities.find((a) => a.key === 'restroom');
  assert.ok(farLoo.distance > loo.distance, 'the field is not measuring distance at all');
});

test('the verdict actually moves when the place gets worse', () => {
  const w = ground();
  const v = venueOf(w);
  const fields = amenityFields(w);
  const good = spotReport(w, { x: 50, y: G + 7, z: 68 }, [v], fields);
  // Wall the same spot in so it is narrow and blind.
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let y = G + 7; y < G + 10; y++) w.setBlock(50 + dx, y, 68 + dz, blockId('concrete'), 0);
  }
  const bad = spotReport(w, { x: 50, y: G + 7, z: 68 }, [v], fields);
  assert.ok(bad.score < good.score - 10,
    `boxing a seat in should drop its score hard: ${good.score} -> ${bad.score}`);
});

// -------------------------------------------------------------------- stops

test('the walk has one stop per notable zone, not one per voxel', () => {
  const w = ground();
  const stops = siteStops(w, [venueOf(w)]);
  const kinds = stops.map((s) => s.kind);
  assert.equal(new Set(kinds).size, kinds.length, 'the walk repeated a kind of stop');
  assert.ok(kinds.includes('pitch'), 'the field itself is always worth standing on');
  assert.ok(kinds.includes('seating'));
  assert.ok(kinds.includes('concession'));
  // Every stop must be somewhere you could actually stand.
  for (const s of stops) {
    assert.ok(w.inBounds(s.x, s.y, s.z), `${s.name} is off the plot at ${s.x},${s.y},${s.z}`);
  }
});

// ------------------------------------------------------- progress and reward

function walkState(day = 10) {
  return { day, siteWalk: createSiteWalkState(), reputation: { venue: 40 } };
}

test('a walk pays out once it is finished, and not for doing it again straight away', () => {
  const w = ground();
  const stops = siteStops(w, [venueOf(w)]);
  assert.ok(stops.length >= 3, 'need a few stops to test the reward');
  const st = walkState();

  assert.equal(completeWalk(st, stops), null, 'an unfinished walk cannot be filed');
  for (const s of stops) reachStop(st, s);
  assert.ok(walkProgress(st, stops).done);

  const first = completeWalk(st, stops);
  assert.ok(first.reputation > 0, 'the first inspection is worth something');
  assert.equal(st.siteWalk.visited.length, 0, 'the next walk starts from scratch');
  assert.ok(certificateActive(st));

  // Immediately again: the certificate is still in date, so no second payment.
  for (const s of stops) reachStop(st, s);
  const second = completeWalk(st, stops);
  assert.equal(second.reputation, 0, 'walking twice in a week should not pay twice');
  assert.ok(second.repeat);

  // Once it has run out, it is worth doing again.
  st.day += CERTIFICATE_DAYS + 1;
  assert.equal(certificateActive(st), false, 'the certificate should expire');
  for (const s of stops) reachStop(st, s);
  assert.ok(completeWalk(st, stops).reputation > 0);
});

test('reaching the same stop twice only counts once', () => {
  const w = ground();
  const stops = siteStops(w, [venueOf(w)]);
  const st = walkState();
  assert.ok(reachStop(st, stops[0]));
  assert.equal(reachStop(st, stops[0]), null, 'walking past a marker again is not a second inspection');
  assert.equal(walkProgress(st, stops).visited, 1);
});

test('an in-date certificate lifts the venue, and expires on its own', () => {
  const st = walkState();
  assert.equal(inspectionLift(st), null, 'no walk, no lift');
  st.siteWalk.completedDay = st.day;
  const lift = inspectionLift(st);
  assert.ok(lift.rating.safety > 0 && lift.rating.comfort > 0);

  st.day += CERTIFICATE_DAYS;
  assert.equal(inspectionLift(st), null, 'the lift outlived the certificate');
});

test('combining lifts adds them without touching either original', () => {
  const programme = { rating: { safety: 3 }, measure: { seats: 1 }, income: 400 };
  const walk = { rating: { safety: 2, comfort: 1 } };
  const both = combineLift(programme, walk);
  assert.equal(both.rating.safety, 5);
  assert.equal(both.rating.comfort, 1);
  assert.equal(both.income, 400, 'combining dropped the rest of the programme effect');
  assert.equal(programme.rating.safety, 3, 'combining mutated the programme effects');
  assert.deepEqual(combineLift(programme, null), programme);
});

test('a seat that gets fixed comes off the restricted list', () => {
  const st = walkState();
  const bad = { x: 1, y: 2, z: 3, quality: 0.1, restricted: true, distance: 50, grade: 'Restricted' };
  recordSeat(st, bad);
  assert.equal(st.siteWalk.restricted.length, 1);
  recordSeat(st, bad);
  assert.equal(st.siteWalk.restricted.length, 1, 'the same seat was filed twice');

  recordSeat(st, { ...bad, quality: 1, restricted: false, grade: 'Very good' });
  assert.equal(st.siteWalk.restricted.length, 0, 'fixing a seat did not clear it');
  assert.ok(st.siteWalk.best, 'a good seat should be remembered as the best so far');
  assert.equal(st.siteWalk.seatsChecked, 3);
});

// ------------------------------------------------------- the arrange toolbox

async function controllerOn(g) {
  const { BuildController } = await import('../src/voxel/buildController.js');
  const scene = { add() {}, remove() {} };
  const rig = { ray: () => ({ origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: -1, z: 0 } }), centreRay() { return this.ray(); } };
  return new BuildController(g, scene, rig);
}

test('painting changes what a wall is made of without changing its shape', async () => {
  const { Game } = await import('../src/core/game.js');
  const g = new Game();
  g.newGame({ seed: 7 });
  g.state.cash = 5_000_000;
  const brick = blockId('brick'), glass = blockId('glass');
  for (let x = 20; x < 26; x++) for (let y = G; y < G + 3; y++) g.world.setBlock(x, y, 30, brick, 0);
  const solidBefore = countSolid(g.world, 18, 28, G - 1, G + 4, 28, 32);

  const bc = await controllerOn(g);
  bc.setMode('arrange');
  bc.setTool('surface');
  bc.setMaterial(glass);
  bc.aim = { x: 22, y: G + 1, z: 30 };
  bc.aimFace = { x: 22, y: G + 1, z: 30, nx: 0, ny: 0, nz: -1 };
  bc.refreshPreview();

  const cash = g.state.cash;
  const msg = bc.commit();
  assert.match(String(msg), /repainted/);
  assert.ok(g.state.cash < cash, 'repainting a wall in glass is not free');
  assert.equal(countSolid(g.world, 18, 28, G - 1, G + 4, 28, 32), solidBefore,
    'painting added or removed blocks');
  assert.equal(g.world.getBlock(22, G + 1, 30), glass, 'the wall was not painted');
  assert.equal(g.world.getBlock(22, G + 1, 31), 0, 'paint leaked into the air behind the wall');
});

test('paint refuses to build: aiming at nothing costs nothing', async () => {
  const { Game } = await import('../src/core/game.js');
  const g = new Game();
  g.newGame({ seed: 8 });
  g.state.cash = 1_000_000;
  const bc = await controllerOn(g);
  bc.setMode('arrange');
  bc.setTool('paint');
  bc.setMaterial(blockId('brick'));
  // Point at a voxel well above the ground: empty air.
  bc.aim = { x: 20, y: G + 20, z: 20 };
  bc.aimFace = null;
  bc.refreshPreview();
  const cash = g.state.cash;
  bc.commit();
  assert.equal(g.state.cash, cash, 'painting thin air charged for it');
  assert.equal(g.world.getBlock(20, G + 20, 20), 0, 'painting thin air built a block');
});

test('moving a fitting is free and undoes in one step', async () => {
  const { Game } = await import('../src/core/game.js');
  const g = new Game();
  g.newGame({ seed: 9 });
  g.state.cash = 1_000_000;
  const goal = propId('goal_soccer');
  g.world.props.add(goal, 40, G, 40, 0);

  const bc = await controllerOn(g);
  bc.setMode('arrange');
  bc.setTool('move');
  const cash = g.state.cash;
  const undos = g.history.undoStack.length;

  bc.aim = { x: 40, y: G, z: 40 };
  bc.aimProp = g.world.props.at(40, G, 40);
  assert.match(String(bc.act(0)), /Carrying/);
  assert.ok(bc.isCarrying);

  bc.aim = { x: 46, y: G, z: 44 };
  bc.aimProp = null;
  assert.match(String(bc.act(0)), /moved/);

  assert.equal(g.state.cash, cash, 'moving something you already own should be free');
  assert.equal(g.world.props.at(40, G, 40), null, 'the fitting is still in the old place');
  assert.ok(g.world.props.at(46, G, 44), 'the fitting never arrived');
  assert.equal(g.history.undoStack.length, undos + 1, 'a move should be one undo step, not two');

  g.history.undo();
  assert.ok(g.world.props.at(40, G, 40), 'undo did not put it back');
  assert.equal(g.world.props.at(46, G, 44), null, 'undo left a copy behind');
});

test('cloning a fitting charges for the copy and leaves the original alone', async () => {
  const { Game } = await import('../src/core/game.js');
  const g = new Game();
  g.newGame({ seed: 11 });
  g.state.cash = 1_000_000;
  g.world.props.add(propId('goal_soccer'), 40, G, 40, 0);

  const bc = await controllerOn(g);
  bc.setMode('arrange');
  bc.setTool('clone');
  bc.aim = { x: 40, y: G, z: 40 };
  bc.aimProp = g.world.props.at(40, G, 40);
  assert.match(String(bc.act(0)), /Copied/);

  const cash = g.state.cash;
  bc.aim = { x: 50, y: G, z: 44 };
  bc.aimProp = null;
  bc.refreshPreview();
  bc.act(0);
  assert.ok(g.state.cash < cash, 'a cloned fitting should be paid for');
  assert.ok(g.world.props.at(40, G, 40), 'cloning removed the original');
  assert.ok(g.world.props.at(50, G, 44), 'the clone never landed');
});

test('a carried fitting is put back when the tool or mode changes', async () => {
  const { Game } = await import('../src/core/game.js');
  const g = new Game();
  g.newGame({ seed: 12 });
  g.world.props.add(propId('goal_soccer'), 40, G, 40, 0);
  const bc = await controllerOn(g);
  bc.setMode('arrange');
  bc.setTool('move');
  bc.aim = { x: 40, y: G, z: 40 };
  bc.aimProp = g.world.props.at(40, G, 40);
  bc.act(0);
  assert.ok(bc.isCarrying);
  bc.setMode('build');
  assert.equal(bc.isCarrying, false, 'walking away still carrying the goal');
  assert.ok(g.world.props.at(40, G, 40), 'the fitting vanished when the mode changed');
});

test('the build plane follows the level you are working at, so a first floor is buildable', async () => {
  const { Game } = await import('../src/core/game.js');
  const { BuildController } = await import('../src/voxel/buildController.js');
  const g = new Game();
  g.newGame({ seed: 21 });
  g.state.cash = 5_000_000;

  // A ray that can be pointed either at the ground or out at open sky.
  const ray = { origin: { x: 40, y: 200, z: 40 }, dir: { x: 0, y: -1, z: 0 } };
  const scene = { add() {}, remove() {} };
  const rig = { ray: () => ray, centreRay: () => ray };
  const bc = new BuildController(g, scene, rig);

  assert.equal(bc.planeY, G, 'a fresh site works at ground level');

  // Build a pillar up to the first floor, aiming straight down at it.
  for (let y = G; y < G + 5; y++) g.world.setBlock(20, y, 20, blockId('concrete'), 0);
  // Point straight down at the top of the pillar.
  ray.origin = { x: 20 * 2 + 1, y: 200, z: 20 * 2 + 1 };
  ray.dir = { x: 0, y: -1, z: 0 };
  bc.updateAim(null);
  assert.equal(bc.aim.y, G + 5, 'aiming at the top of the pillar should target the space above it');
  assert.equal(bc.planeY, G + 5, 'the working level did not follow the block being built on');

  // Now swing out over open ground where there is nothing to aim at: the tap
  // should land on that same level, not back down on the grass.
  ray.origin = { x: 60 * 2 + 1, y: (G + 5) * 2 + 40, z: 60 * 2 + 1 };
  ray.dir = { x: 0, y: -1, z: 0 };
  // Clear the terrain under it so the ray reaches nothing solid.
  for (let y = 0; y < 40; y++) g.world.setBlock(60, y, 60, 0, 0);
  bc.updateAim(null);
  assert.ok(bc.aim, 'aiming at open air should still resolve a target');
  assert.equal(bc.aim.y, G + 5,
    `a tap over open air should land on the working level, got ${bc.aim.y} rather than ${G + 5}`);
});

function countSolid(w, x0, x1, y0, y1, z0, z1) {
  let n = 0;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
    if (w.getBlock(x, y, z) !== 0) n++;
  }
  return n;
}
