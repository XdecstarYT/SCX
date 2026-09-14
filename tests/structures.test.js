import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelWorld } from '../src/voxel/world.js';
import { blockId } from '../src/data/blocks.js';
import { zoneId } from '../src/data/zones.js';
import {
  generateGrandstand, generateParkingGarage, generateTerrainEdit, generateRetainingWall,
  generateBowl, generateCanopy,
} from '../src/voxel/structures.js';
import { applyPlan, pricePlan, planPositions } from '../src/voxel/buildTools.js';
import { detectVenues } from '../src/venues/venueDetection.js';
import { GROUND_Y } from '../src/core/constants.js';

globalThis.performance ??= { now: () => Date.now() };

function worldWithPitch(size = 128) {
  const w = new VoxelWorld(size);
  w.generateTerrain();
  for (let x = 40; x < 94; x++) {
    for (let z = 46; z < 81; z++) w.setBlock(x, GROUND_Y - 1, z, blockId('turf'), zoneId('pitch_football'));
  }
  return w;
}

test('a grandstand rakes away from the pitch so every row can see', () => {
  const w = worldWithPitch();
  // North stand: footprint sits above the pitch in -Z.
  const plan = generateGrandstand(w, { x: 36, z: 34 }, { x: 97, z: 44 }, {});
  applyPlan(w, plan.cells, 'stand');

  const seatId = blockId('seat');
  const heightOf = (z) => {
    for (let y = 40; y >= 0; y--) if (w.getBlock(60, y, z) === seatId) return y;
    return -1;
  };
  const front = heightOf(44);   // nearest the pitch
  const back = heightOf(34);    // furthest away
  assert.ok(front > 0 && back > 0, 'both edges have seats');
  assert.ok(back > front, `the back row (${back}) should sit above the front row (${front})`);
});

test('a grandstand builds its own supports and vomitories', () => {
  const w = worldWithPitch();
  const plan = generateGrandstand(w, { x: 36, z: 34 }, { x: 97, z: 44 }, {});
  assert.ok(plan.meta.rows === 11, `rows ${plan.meta.rows}`);
  assert.ok(plan.meta.vomitories > 0, 'stair gaps were cut through the tier');
  assert.ok(plan.meta.capacity > 3000, `capacity ${plan.meta.capacity}`);

  applyPlan(w, plan.cells, 'stand');
  // Nothing should float: under every seat there must be solid support.
  const seatId = blockId('seat');
  let checked = 0;
  for (let x = 40; x < 90; x += 7) {
    for (let z = 34; z <= 44; z += 3) {
      for (let y = 30; y >= 0; y--) {
        if (w.getBlock(x, y, z) === seatId) {
          assert.ok(w.isSolid(x, y - 1, z), `seat at ${x},${y},${z} is unsupported`);
          checked++;
          break;
        }
      }
    }
  }
  assert.ok(checked > 10, 'checked a meaningful sample');
});

test('four generated stands make a detectable regional stadium', () => {
  const w = worldWithPitch();
  const stands = [
    [{ x: 36, z: 34 }, { x: 97, z: 44 }],
    [{ x: 36, z: 83 }, { x: 97, z: 93 }],
    [{ x: 26, z: 46 }, { x: 35, z: 80 }],
    [{ x: 98, z: 46 }, { x: 107, z: 80 }],
  ];
  let generated = 0;
  for (const [a, b] of stands) {
    const plan = generateGrandstand(w, a, b, {});
    generated += plan.meta.capacity;
    applyPlan(w, plan.cells, 'stand');
  }
  const v = detectVenues(w, { powerCapacity: 15 }).venues[0];
  assert.ok(v, 'a venue was detected');
  assert.equal(v.capacity.total, generated,
    'the analyser reads back exactly the capacity the generator laid');
  assert.ok(v.capacity.total > 9000, `capacity ${v.capacity.total}`);
});

test('a parking garage holds far more cars than the same footprint of tarmac', () => {
  const w = worldWithPitch();
  const foot = { a: { x: 6, z: 6 }, b: { x: 40, z: 28 } };
  const garage = generateParkingGarage(w, foot.a, foot.b, { levels: 4 });
  applyPlan(w, garage.cells, 'garage');
  assert.equal(garage.meta.levels, 4);
  assert.ok(garage.meta.spaces > 400, `spaces ${garage.meta.spaces}`);

  const a = detectVenues(w, { powerCapacity: 15 });
  // Surface parking over the same 35x23 footprint would be ~160 cars.
  const surfaceEquivalent = Math.floor((35 * 23) / 5);
  assert.ok(a.complex.parkingCars > surfaceEquivalent * 2,
    `${a.complex.parkingCars} vs ${surfaceEquivalent} on one level`);
});

test('terrain tools raise, lower, flatten and ramp while keeping the surface', () => {
  const w = new VoxelWorld(64);
  w.generateTerrain();
  const grass = blockId('grass');
  assert.equal(w.heightAt(10, 10), GROUND_Y - 1);

  applyPlan(w, generateTerrainEdit(w, { x: 5, z: 5 }, { x: 20, z: 20 }, 'raise', { amount: 4 }).cells, 'raise');
  assert.equal(w.heightAt(10, 10), GROUND_Y + 3);
  assert.equal(w.getBlock(10, GROUND_Y + 3, 10), grass, 'the grass surface came with it');
  assert.equal(w.getBlock(10, GROUND_Y - 1, 10), blockId('dirt'), 'the old surface became fill');

  applyPlan(w, generateTerrainEdit(w, { x: 5, z: 5 }, { x: 20, z: 20 }, 'lower', { amount: 2 }).cells, 'lower');
  assert.equal(w.heightAt(10, 10), GROUND_Y + 1);

  // Flatten levels the rectangle between the two taps to the height of the
  // first one. Raise a plateau, then shave part of it back to grade.
  applyPlan(w, generateTerrainEdit(w, { x: 30, z: 30 }, { x: 45, z: 45 }, 'raise', { amount: 6 }).cells, 'r');
  assert.equal(w.heightAt(42, 35), GROUND_Y + 5, 'the plateau is raised before flattening');
  applyPlan(w, generateTerrainEdit(w, { x: 50, z: 30 }, { x: 40, z: 40 }, 'flatten', {}).cells, 'flatten');
  assert.equal(w.heightAt(42, 35), w.heightAt(50, 30), 'flatten matched the reference column');
  assert.equal(w.heightAt(35, 35), GROUND_Y + 5, 'ground outside the rectangle is untouched');

  // Ramp interpolates between the two ends.
  applyPlan(w, generateTerrainEdit(w, { x: 5, z: 50 }, { x: 25, z: 50 }, 'raise', { amount: 0 }).cells, 'noop');
  applyPlan(w, generateTerrainEdit(w, { x: 5, z: 48 }, { x: 5, z: 55 }, 'raise', { amount: 8 }).cells, 'step');
  const ramp = generateTerrainEdit(w, { x: 5, z: 51 }, { x: 25, z: 51 }, 'ramp', {});
  applyPlan(w, ramp.cells, 'ramp');
  const hLeft = w.heightAt(6, 51), hMid = w.heightAt(15, 51), hRight = w.heightAt(24, 51);
  assert.ok(hLeft > hMid && hMid > hRight, `ramp should descend: ${hLeft} ${hMid} ${hRight}`);
});

test('a retaining wall matches the ground it holds back', () => {
  const w = new VoxelWorld(64);
  w.generateTerrain();
  applyPlan(w, generateTerrainEdit(w, { x: 20, z: 10 }, { x: 40, z: 40 }, 'raise', { amount: 5 }).cells, 'r');
  const wall = generateRetainingWall(w, { x: 19, z: 12 }, { x: 19, z: 38 }, {});
  applyPlan(w, wall.cells, 'wall');
  assert.ok(w.isSolid(19, GROUND_Y + 4, 12), 'the wall reaches the terrace above it');
  assert.equal(w.getBlock(19, GROUND_Y + 4, 12), blockId('reinforced'));
});

test('plans are priced and reversible like any other edit', () => {
  const w = worldWithPitch();
  const plan = generateGrandstand(w, { x: 36, z: 34 }, { x: 97, z: 44 }, {});
  const price = pricePlan(w, plan.cells);
  assert.ok(price.cost > 0 && price.placed > 0);
  assert.equal(planPositions(plan.cells).length / 3, plan.cells.length / 5);

  const before = w.getBlock(60, GROUND_Y, 40);
  const batch = applyPlan(w, plan.cells, 'stand');
  assert.notEqual(w.getBlock(60, GROUND_Y, 40), before);
  // Roll it back by hand the way History.undo does.
  for (let i = batch.pos.length - 1; i >= 0; i--) {
    const p = batch.pos[i];
    w.setBlock(p & 511, (p >> 18) & 127, (p >> 9) & 511, batch.prevB[i], batch.prevZ[i]);
  }
  assert.equal(w.getBlock(60, GROUND_Y, 40), before, 'the world is back where it started');
});

// ---------------------------------------------------------- construction

test('small edits land immediately, big ones become a project', async () => {
  const { shouldStage, projectDays, createProject, tickConstruction } = await import('../src/core/construction.js');
  const { Game } = await import('../src/core/game.js');
  const { createState } = await import('../src/core/gameState.js');

  assert.equal(shouldStage(12), false, 'placing a doorway should not take three days');
  assert.equal(shouldStage(4000), true);
  assert.ok(projectDays(400) < projectDays(12_000));
  assert.ok(projectDays(200_000) <= 16, 'even enormous projects finish inside a season');

  const g = new Game();
  g.newGame({ seed: 2 });
  const w = g.world;
  const plan = generateGrandstand(w, { x: 30, z: 30 }, { x: 80, z: 44 }, {});
  const project = createProject(g.state, { label: 'Stand', cells: plan.cells, cost: 500_000 });

  // Nothing is built yet.
  assert.equal(project.placed, 0);
  assert.ok(project.total > 400);

  // Foundations come first: the first blocks placed are the lowest.
  g.state.construction.push(project);
  tickConstruction(g.state, w, 0.2);
  const builtYs = [];
  for (let y = 0; y < 30; y++) {
    for (let x = 30; x <= 80; x += 10) if (w.isSolid(x, y, 32)) { builtYs.push(y); break; }
  }
  const topY = Math.max(...builtYs);
  tickConstruction(g.state, w, 0.9);
  let laterTop = 0;
  for (let y = 0; y < 40; y++) if (w.isSolid(55, y, 32)) laterTop = y;
  assert.ok(laterTop >= topY, 'the structure rises rather than appearing at random');

  // It finishes.
  tickConstruction(g.state, w, 20);
  assert.equal(g.state.construction.length, 0);
  assert.equal(project.placed, project.total);
});

test('a project can be rushed for a surcharge or stopped for a refund', async () => {
  const { createProject, tickConstruction } = await import('../src/core/construction.js');
  const { Game } = await import('../src/core/game.js');
  const { createState } = await import('../src/core/gameState.js');

  const g = new Game();
  g.newGame({ seed: 6 });
  const plan = generateGrandstand(g.world, { x: 30, z: 30 }, { x: 80, z: 44 }, {});

  g.state.construction.push(createProject(g.state, { label: 'Stand', cells: plan.cells, cost: 1_000_000 }));
  const cashBefore = g.state.cash;
  const r = g.rushConstruction(g.state.construction[0].id);
  assert.ok(r.ok, r.error);
  assert.ok(r.surcharge > 0, 'rushing costs overtime');
  assert.equal(g.state.cash, cashBefore - r.surcharge);
  assert.equal(g.state.construction.length, 0);
  assert.ok(g.world.isSolid(55, 8, 32), 'and everything is built');

  // Stopping halfway refunds the unbuilt remainder.
  const g2 = new Game();
  g2.newGame({ seed: 6 });
  const plan2 = generateGrandstand(g2.world, { x: 30, z: 30 }, { x: 80, z: 44 }, {});
  g2.state.construction.push(createProject(g2.state, { label: 'Stand', cells: plan2.cells, cost: 1_000_000 }));
  tickConstruction(g2.state, g2.world, 0.5 * g2.state.construction[0].days);
  const cash2 = g2.state.cash;
  const stop = g2.cancelConstruction(g2.state.construction[0].id);
  assert.ok(stop.refund > 300_000 && stop.refund < 700_000, `refund ${stop.refund}`);
  assert.equal(g2.state.cash, cash2 + stop.refund);
});

test('a grandstand built through the controller goes up over days', async () => {
  const { Game } = await import('../src/core/game.js');
  const { BuildController } = await import('../src/voxel/buildController.js');
  const g = new Game();
  g.newGame({ seed: 4 });
  g.state.cash = 20_000_000;

  // Minimal stand-in for the scene the controller normally draws into.
  const fakeScene = { add() {}, remove() {} };
  const fakeRig = { ray: () => ({ origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: -1, z: 0 } }), centreRay() { return this.ray(); } };
  const bc = new BuildController(g, fakeScene, fakeRig);
  bc.setTool('grandstand');
  bc.aim = { x: 30, y: GROUND_Y, z: 30 };
  bc.anchor = { x: 30, y: GROUND_Y, z: 30 };
  bc.aim = { x: 80, y: GROUND_Y, z: 44 };
  bc.refreshPreview();
  const result = bc.commit();

  assert.match(String(result), /under construction/);
  assert.equal(g.state.construction.length, 1);
  assert.ok(g.state.cash < 20_000_000, 'it was paid for up front');

  g.skipDay(20);
  assert.equal(g.state.construction.length, 0, 'and it completes on its own');
  g.analyze(true);
  assert.ok((g.world.blockCounts.get(blockId('seat')) || 0) > 100, 'the seats are really there');
});

test('a bowl rings the pitch on all four sides, with the corners closed', () => {
  const w = worldWithPitch();
  // The pitch laid by worldWithPitch spans x 40..93, z 46..80.
  const plan = generateBowl(w, { x: 40, y: GROUND_Y, z: 46 }, { x: 93, y: GROUND_Y, z: 80 },
    { rows: 10 });
  assert.equal(plan.meta.sides, 4, 'a bowl is four tiers, not three');
  applyPlan(w, plan.cells, 'bowl');

  const seat = blockId('seat');
  const seatsIn = (x0, x1, z0, z1) => {
    let n = 0;
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++)
        for (let y = GROUND_Y; y < GROUND_Y + 14; y++) if (w.getBlock(x, y, z) === seat) n++;
    return n;
  };
  assert.ok(seatsIn(40, 93, 36, 45) > 100, 'no north stand');
  assert.ok(seatsIn(40, 93, 81, 90) > 100, 'no south stand');
  assert.ok(seatsIn(30, 39, 46, 80) > 100, 'no west stand');
  assert.ok(seatsIn(94, 103, 46, 80) > 100, 'no east stand');
  // The side stands run the full length, so the corners are seats too rather
  // than four holes where the money should be.
  assert.ok(seatsIn(30, 39, 36, 45) > 20, 'the north-west corner is empty');
  assert.ok(seatsIn(94, 103, 81, 90) > 20, 'the south-east corner is empty');

  // And it is worth more than one stand of the same rake.
  const one = generateGrandstand(w, { x: 40, z: 36 }, { x: 93, z: 45 }, {});
  assert.ok(plan.meta.capacity > one.meta.capacity * 3,
    `a bowl should hold far more than one stand (${plan.meta.capacity} vs ${one.meta.capacity})`);
});

test('a canopy clears what is under it, and the stands below count as covered', () => {
  const w = worldWithPitch();
  const stand = generateGrandstand(w, { x: 40, z: 36 }, { x: 93, z: 45 }, {});
  applyPlan(w, stand.cells, 'stand');

  const bare = detectVenues(w, { complexName: 'T' }).venues[0];
  assert.equal(bare.seatRoofCoverage, 0, 'an open stand should not read as covered');

  const plan = generateCanopy(w, { x: 40, y: GROUND_Y, z: 36 }, { x: 93, y: GROUND_Y, z: 45 },
    { clearance: 4 });
  assert.ok(plan.meta.columns > 0, 'a canopy with no columns is floating');

  // The deck sits above the tallest thing in the footprint, not at the height
  // you happened to be pointing at.
  let highest = 0;
  for (let x = 40; x <= 93; x++) for (let z = 36; z <= 45; z++) highest = Math.max(highest, w.heightAt(x, z));
  assert.equal(plan.meta.height, highest + 4, 'the deck did not clear the stand');

  applyPlan(w, plan.cells, 'canopy');
  const roofed = detectVenues(w, { complexName: 'T' }).venues[0];
  assert.ok(roofed.seatRoofCoverage > 0.5,
    `a deck over the whole stand should cover it, got ${roofed.seatRoofCoverage}`);
});

// ---------------------------------------------------------------- the tools
//
// Every build tool carries a one-line hint that the player reads and trusts.
// This sweep holds each one to what its own hint promises, because a tool that
// quietly does something else is a bug the player blames themselves for.

test('every build tool does what its own hint says it does', async () => {
  const { TOOLS, toolCells, applyEdit, priceEdit, copyRegion, rotateClipboard }
    = await import('../src/voxel/buildTools.js');
  const w = new VoxelWorld(64);
  w.generateTerrain();
  const G = GROUND_Y;
  const conc = blockId('concrete');
  const at = (x, y, z) => ({ x, y, z });
  const cellsOf = (tool, a, b, opts) => toolCells(tool, w, a, b, opts);
  const countOf = (cells) => cells.length / 3;
  const covered = new Set();

  // single: one block, where you tapped.
  {
    const c = cellsOf('single', at(4, G, 4));
    assert.equal(countOf(c), 1);
    assert.deepEqual(c, [4, G, 4]);
    covered.add('single');
  }

  // line: start to end, and nothing off it.
  {
    const c = cellsOf('line', at(4, G, 4), at(9, G, 4));
    assert.equal(countOf(c), 6, 'a six-long line should be six blocks');
    for (let i = 0; i < c.length; i += 3) assert.equal(c[i + 2], 4, 'the line strayed off its axis');
    covered.add('line');
  }

  // wall: the line, extruded up by the wall height.
  {
    const h = 4;
    const c = cellsOf('wall', at(4, G, 4), at(9, G, 4), { wallHeight: h });
    assert.equal(countOf(c), 6 * h, 'a wall is its footprint times its height');
    const tops = new Set();
    for (let i = 0; i < c.length; i += 3) tops.add(c[i + 1]);
    assert.equal(tops.size, h, `wall rose through ${tops.size} levels, expected ${h}`);
    covered.add('wall');
  }

  // floor: flat, one level, whichever corner you started from.
  {
    const c = cellsOf('floor', at(4, G, 4), at(8, G + 5, 7));
    assert.equal(countOf(c), 5 * 4, 'a 5x4 slab is 20 blocks');
    for (let i = 0; i < c.length; i += 3) assert.equal(c[i + 1], G, 'the floor was not flat');
    covered.add('floor');
  }

  // box: solid, corner to corner.
  {
    const c = cellsOf('box', at(4, G, 4), at(6, G + 2, 6));
    assert.equal(countOf(c), 27, 'a 3x3x3 box is 27 blocks');
    covered.add('box');
  }

  // hollow: a shell, and genuinely hollow inside.
  {
    const c = cellsOf('hollow', at(10, G, 10), at(14, G, 14), { wallHeight: 4 });
    const set = new Set();
    for (let i = 0; i < c.length; i += 3) set.add(`${c[i]},${c[i + 1]},${c[i + 2]}`);
    assert.ok(set.has(`10,${G},10`), 'the room has no corner');
    assert.ok(set.has(`12,${G},12`), 'the room has no floor');
    assert.ok(set.has(`12,${G + 4},12`), 'the room has no ceiling');
    assert.ok(!set.has(`12,${G + 2},12`), 'the room is solid, not a room');
    covered.add('hollow');
  }

  // fill: flood the enclosed air, and stop at the walls.
  {
    // A closed box of concrete with air inside it.
    const shell = cellsOf('hollow', at(20, G, 20), at(26, G, 26), { wallHeight: 4 });
    applyEdit(w, shell, 'build', conc);
    const c = cellsOf('fill', at(23, G + 2, 23));
    assert.ok(countOf(c) > 0, 'fill found nothing to fill');
    for (let i = 0; i < c.length; i += 3) {
      assert.ok(c[i] > 20 && c[i] < 26 && c[i + 2] > 20 && c[i + 2] < 26,
        `fill leaked out of the room at ${c[i]},${c[i + 1]},${c[i + 2]}`);
    }
    covered.add('fill');
  }

  // replace: swaps only the material you first tapped, and leaves the rest.
  {
    const brick = blockId('brick');
    applyEdit(w, cellsOf('box', at(30, G, 30), at(33, G, 33)), 'build', conc);
    applyEdit(w, cellsOf('box', at(32, G, 30), at(33, G, 33)), 'build', brick);
    const region = cellsOf('replace', at(30, G, 30), at(33, G, 33));
    const price = priceEdit(w, region, 'build', blockId('steel'), { replaceTarget: conc });
    assert.equal(price.placed, 8, `replace touched ${price.placed} blocks, expected the 8 concrete ones`);
    applyEdit(w, region, 'build', blockId('steel'), { replaceTarget: conc });
    assert.equal(w.getBlock(30, G, 30), blockId('steel'), 'concrete was not replaced');
    assert.equal(w.getBlock(33, G, 30), brick, 'brick was replaced and should not have been');
    covered.add('replace');
  }

  // copy and paste: the same structure, somewhere else, with its materials.
  {
    const src = { x: 30, y: G, z: 30 }, dst = { x: 33, y: G, z: 33 };
    const clip = copyRegion(w, src, dst);
    assert.equal(clip.count, 16, `copied ${clip.count} cells, expected 16`);
    const target = at(40, G, 40);
    const cells = cellsOf('paste', target, null, { clipboard: clip });
    applyEdit(w, cells, 'paste', null, { clipboard: clip });
    assert.equal(w.getBlock(40, G, 40), w.getBlock(30, G, 30), 'paste lost the first block');
    assert.equal(w.getBlock(43, G, 40), w.getBlock(33, G, 30), 'paste lost the materials across the region');
    covered.add('copy');
    covered.add('paste');

    // Rotating the clipboard turns the structure, and keeps every block of it.
    const turned = rotateClipboard(clip);
    assert.equal(turned.count, clip.count, 'rotation lost blocks');
    assert.equal(turned.size.x, clip.size.z, 'rotation did not swap the footprint');
    assert.equal(turned.size.z, clip.size.x);
    // Four quarter-turns is where you started.
    let back = clip;
    for (let i = 0; i < 4; i++) back = rotateClipboard(back);
    assert.deepEqual(back.size, clip.size, 'four quarter-turns did not come back round');
  }

  // circle: an ellipse inscribed in the two corners, and nothing outside it.
  {
    const c = cellsOf('circle', at(10, G, 10), at(29, G, 29));
    const n = countOf(c);
    const area = 20 * 20;
    assert.ok(n > area * 0.72 && n < area * 0.82,
      `a disc in a 20x20 box should be about pi/4 of it, got ${n}/${area}`);
    const set = new Set();
    for (let i = 0; i < c.length; i += 3) {
      assert.equal(c[i + 1], G, 'a circle is flat');
      set.add(`${c[i]},${c[i + 2]}`);
    }
    assert.ok(set.has('19,19'), 'the middle of the disc is missing');
    assert.ok(!set.has('10,10'), 'a corner of the box is outside the ellipse');
    assert.ok(!set.has('29,10'), 'a corner of the box is outside the ellipse');
    covered.add('circle');
  }

  // cylinder: that ellipse as a wall - hollow, and wallHeight tall.
  {
    const h = 5;
    const rim = cellsOf('cylinder', at(10, G, 10), at(29, G, 29), { wallHeight: h });
    const disc = new Set();
    const dc = cellsOf('circle', at(10, G, 10), at(29, G, 29));
    for (let i = 0; i < dc.length; i += 3) disc.add(`${dc[i]},${dc[i + 2]}`);

    const foot = new Set();
    const levels = new Set();
    for (let i = 0; i < rim.length; i += 3) {
      foot.add(`${rim[i]},${rim[i + 2]}`);
      levels.add(rim[i + 1]);
      assert.ok(disc.has(`${rim[i]},${rim[i + 2]}`), 'the wall left the ellipse');
    }
    assert.equal(levels.size, h, 'a cylinder is its rim times its height');
    assert.equal(countOf(rim), foot.size * h);
    assert.ok(!foot.has('19,19'), 'a cylinder is hollow; the middle should be open');
    assert.ok(foot.size < disc.size / 2, 'the rim should be far smaller than the disc');
    covered.add('cylinder');
  }

  // dome: a shell, open underneath, rising to an apex over the middle.
  {
    const c = cellsOf('dome', at(10, G, 10), at(29, G, 29), { domePitch: 1 });
    let top = -1;
    const solid = new Set();
    for (let i = 0; i < c.length; i += 3) {
      assert.ok(c[i + 1] >= G, 'a dome should not dig into the ground');
      top = Math.max(top, c[i + 1]);
      solid.add(`${c[i]},${c[i + 1]},${c[i + 2]}`);
    }
    assert.equal(top, G + 10, 'a dome over a 20-wide box should rise 10');
    assert.ok(solid.has(`19,${G + 10},19`) || solid.has(`20,${G + 10},20`), 'the apex is missing');
    assert.ok(!solid.has(`19,${G + 5},19`), 'a dome is a shell, not a solid lump');
    covered.add('dome');
  }

  // pitched: highest along the ridge, lowest at the eaves, no holes anywhere.
  {
    const c = cellsOf('pitched', at(10, G, 10), at(39, G, 29), { roofPitch: 1 });
    const height = new Map();
    for (let i = 0; i < c.length; i += 3) {
      const k = `${c[i]},${c[i + 2]}`;
      height.set(k, Math.max(height.get(k) ?? -1, c[i + 1]));
    }
    // The long axis is x, so the ridge runs down it and the rake is across z.
    assert.equal(height.size, 30 * 20, 'a pitched roof should cover its whole footprint');
    assert.equal(height.get('20,10'), G, 'the eave should sit at the height you tapped');
    assert.equal(height.get('20,19'), G + 9, 'the ridge should be half the span up');
    assert.equal(height.get('20,20'), G + 9, 'both sides of the ridge should meet');

    // Watertight: every step's riser is filled, so there is no gap to see through.
    const filled = new Set();
    for (let i = 0; i < c.length; i += 3) filled.add(`${c[i]},${c[i + 1]},${c[i + 2]}`);
    for (let z = 11; z <= 19; z++) {
      assert.ok(filled.has(`20,${G + (z - 10) - 1},${z}`) || filled.has(`20,${G + (z - 10)},${z}`),
        `the roof has a hole in the riser at z=${z}`);
    }
    covered.add('pitched');
  }

  // stairs: reaches the height you tapped, one step at a time, solid all the way.
  {
    const c = cellsOf('stairs', at(10, G, 10), at(19, G + 9, 12));
    const height = new Map();
    for (let i = 0; i < c.length; i += 3) {
      const k = `${c[i]},${c[i + 2]}`;
      height.set(k, Math.max(height.get(k) ?? -1, c[i + 1]));
    }
    assert.equal(height.get('10,10'), G, 'the bottom step is not at the bottom');
    assert.equal(height.get('19,10'), G + 9, 'the flight never reached the top');
    for (let i = 0; i <= 9; i++) {
      assert.equal(height.get(`${10 + i},10`), G + i, `step ${i} is at the wrong height`);
    }
    assert.ok(height.has('10,12') && height.has('10,11'),
      'the flight should be as wide as the two taps span');

    // Solid, not floating treads: every voxel under a step is there too.
    const filled = new Set();
    for (let i = 0; i < c.length; i += 3) filled.add(`${c[i]},${c[i + 1]},${c[i + 2]}`);
    for (let y = G; y <= G + 5; y++) {
      assert.ok(filled.has(`15,${y},10`), `the fifth step is hollow at y=${y}`);
    }
    covered.add('stairs');
  }

  // ------------------------------------------------------ the arrange kit
  //
  // Paint, Surface and Area all promise the same thing in different sizes:
  // the shape you built does not change, only what it is made of.

  // paint: the one block you tapped, and only if there is one there.
  {
    const c = cellsOf('paint', at(4, G, 4));
    assert.deepEqual(c, [4, G, 4]);
    covered.add('paint');
  }

  // paintbox: the box, but air inside it is left as air.
  {
    const w2 = new VoxelWorld(64);
    w2.generateTerrain();
    // A three-block pillar with a gap in it.
    w2.setBlock(20, G, 20, conc, 0);
    w2.setBlock(20, G + 2, 20, conc, 0);
    const c = toolCells('paintbox', w2, at(20, G, 20), at(20, G + 2, 20));
    assert.equal(countOf(c), 3, 'the area covers the whole box');
    const price = priceEdit(w2, c, 'paint', blockId('brick'));
    assert.equal(price.placed, 2, 'paint should skip the gap, not fill it');
    applyEdit(w2, c, 'paint', blockId('brick'));
    assert.equal(w2.getBlock(20, G + 1, 20), 0, 'painting filled a hole it should have left alone');
    assert.equal(w2.getBlock(20, G, 20), blockId('brick'), 'the block under the gap was not painted');
    covered.add('paintbox');
  }

  // surface: the connected face of one material, and not the far side of it.
  {
    const w2 = new VoxelWorld(64);
    w2.generateTerrain();
    // A 6x3 brick wall running along x at z=30, with concrete behind it.
    const brick = blockId('brick');
    for (let x = 10; x < 16; x++) {
      for (let y = G; y < G + 3; y++) {
        w2.setBlock(x, y, 30, brick, 0);
        w2.setBlock(x, y, 31, conc, 0);
      }
    }
    // Looking at the wall from -z: the face normal points that way.
    const c = toolCells('surface', w2, at(12, G + 1, 30), null, {
      face: { x: 12, y: G + 1, z: 30, nx: 0, ny: 0, nz: -1 },
    });
    assert.equal(countOf(c), 18, `the whole 6x3 brick face should come back, got ${countOf(c)}`);
    for (let i = 0; i < c.length; i += 3) {
      assert.equal(c[i + 2], 30, 'surface crossed into the wall behind it');
      assert.equal(w2.getBlock(c[i], c[i + 1], c[i + 2]), brick, 'surface picked up a different material');
    }
    covered.add('surface');
  }

  // move and clone carry a fitting rather than emitting cells; they are
  // covered by the build-controller test below and the arrange end-to-end run.
  // sample only reads. None of the three can emit a cell list, and asking
  // toolCells for one must not invent an edit.
  for (const key of ['move', 'clone', 'sample']) {
    const c = cellsOf(key, at(4, G, 4));
    assert.equal(countOf(c), 1, `${key} should resolve to the aimed cell, not a region`);
    covered.add(key);
  }

  // The wall tools lay equipment on cell edges rather than blocks in cells, so
  // they are covered by their own tests below rather than through toolCells.
  covered.add('wallrun');
  covered.add('wallbox');

  // prefab and the procedural structures have their own tests above; terrain
  // tools have theirs. What matters here is that nothing ships untested.
  const tested = new Set([...covered, 'prefab', 'grandstand', 'garage', 'retaining',
    'bowl', 'canopy', 'raise', 'lower', 'flatten', 'ramp']);
  const untested = TOOLS.filter((t) => !tested.has(t.key)).map((t) => t.key);
  assert.deepEqual(untested, [], `tools with no test at all: ${untested.join(', ')}`);
});

test('a doorway is a way in, not a decoration', () => {
  // Doors zone themselves as entrance, and the analyser counts each separate
  // run of entrance zone as a gate. Cutting doors into a facade is therefore a
  // real decision about crowd flow rather than a cosmetic one.
  const build = (doors) => {
    const w = worldWithPitch();
    const G = GROUND_Y;
    for (let x = 38; x < 96; x++) {
      for (let z = 42; z < 46; z++) w.setBlock(x, G, z, blockId('seat'), zoneId('seating'));
    }
    for (let x = 44; x < 90; x++) {
      for (let y = G; y < G + 3; y++) w.setBlock(x, y, 38, blockId('facade_c'));
    }
    for (const x of doors) {
      for (let y = G; y < G + 2; y++) {
        w.setBlock(x, y, 38, blockId('door'));
        w.setBlock(x + 1, y, 38, blockId('door'));
      }
    }
    return w;
  };

  const shut = detectVenues(build([]), { complexName: 'T' }).venues[0];
  assert.equal(shut.facilities.entranceGates, 0, 'a blank wall is not a way in');

  const open = detectVenues(build([50, 60, 70, 80]), { complexName: 'T' }).venues[0];
  assert.equal(open.facilities.entranceGates, 4,
    `four doorways in a wall should read as four gates, got ${open.facilities.entranceGates}`);
  assert.equal(open.capacity.total, shut.capacity.total, 'doors should not change capacity');

  // And you can actually walk through one.
  const w = build([50]);
  assert.equal(w.isSolid(50, GROUND_Y, 38), false, 'the doorway is solid; nobody is getting in');
  assert.equal(w.isSolid(52, GROUND_Y, 38), true, 'the wall beside it should still be solid');
});

test('every material in the palette can be bought, placed and taken back out', async () => {
  const { BLOCK_BY_ID } = await import('../src/data/blocks.js');
  const { priceEdit, applyEdit } = await import('../src/voxel/buildTools.js');
  const { History } = await import('../src/voxel/history.js');
  const w = new VoxelWorld(32);
  const history = new History(w);
  w.generateTerrain();
  const G = GROUND_Y;
  let x = 1, z = 1;
  for (const b of BLOCK_BY_ID.slice(1)) {        // index 0 is air
    const cells = [x, G, z];
    const price = priceEdit(w, cells, 'build', b.id);
    assert.equal(price.blocked, 0, `${b.key} could not be placed on open ground`);
    assert.ok(price.cost > 0, `${b.key} costs nothing to build`);
    history.push(applyEdit(w, cells, 'build', b.id));
    assert.equal(w.getBlock(x, G, z), b.id, `${b.key} did not go down`);
    // Everything is reversible, including the blocks added most recently.
    history.undo();
    assert.notEqual(w.getBlock(x, G, z), b.id, `${b.key} survived an undo`);
    if (++x > 28) { x = 1; z += 1; }
  }
});

// ------------------------------------------------------------- how it looks
//
// The mesher decides what the world looks like as much as the shader does, so
// the two things it now carries - corner occlusion and surface finish - are
// worth holding to, especially the merging, which is what keeps the triangle
// count sane.

test('corner occlusion darkens what is tucked into a corner, and nothing else', async () => {
  const { meshChunk } = await import('../src/voxel/mesher.js');
  const { CHUNK_X } = await import('../src/core/constants.js');
  const G = GROUND_Y;

  // Up-facing vertices only, as {x, z, ao} in world metres. Merging means
  // vertices exist at quad corners rather than at every voxel, so the test
  // reads the spread of values rather than looking any one of them up.
  const topVerts = (w) => {
    const built = meshChunk(w, w.chunkAt(8, 8, false));
    const { pos, nor, ao } = built.opaque;
    const out = [];
    for (let i = 0; i < ao.length; i++) {
      if (nor[i * 3 + 1] !== 1) continue;
      if (pos[i * 3 + 1] !== G * 2) continue;            // the ground surface
      out.push({ x: pos[i * 3], z: pos[i * 3 + 2], ao: ao[i] });
    }
    return out;
  };

  // Open ground: nothing is occluded anywhere.
  const open = new VoxelWorld(CHUNK_X * 2);
  open.generateTerrain();
  const flat = topVerts(open);
  assert.ok(flat.length > 0, 'the probe found no ground to measure');
  assert.ok(flat.every((v) => v.ao === 3), 'flat open ground should have no occlusion');

  // Now stand a wall on it. Ground tucked against the foot of the wall must
  // come out darker; ground well away from it must not.
  const walled = new VoxelWorld(CHUNK_X * 2);
  walled.generateTerrain();
  for (let z = 2; z < 14; z++) {
    for (let y = G; y < G + 4; y++) walled.setBlock(8, y, z, blockId('concrete'));
  }
  const shaded = topVerts(walled);
  const wallX = 8 * 2;
  const near = shaded.filter((v) => Math.abs(v.x - wallX) <= 4 && v.z > 4 && v.z < 26);
  const far = shaded.filter((v) => Math.abs(v.x - wallX) > 12);
  assert.ok(near.length > 0 && far.length > 0, 'the probe missed its samples');
  assert.ok(Math.min(...near.map((v) => v.ao)) < 3,
    'the ground at the foot of a wall should be occluded');
  assert.ok(far.every((v) => v.ao === 3),
    'ground well away from the wall should be untouched');
});

test('occlusion does not stop a flat wall merging into a handful of quads', async () => {
  const { meshChunk } = await import('../src/voxel/mesher.js');
  const { CHUNK_X } = await import('../src/core/constants.js');
  const G = GROUND_Y;
  // A large unbroken slab, floating clear of anything that could occlude it.
  const w = new VoxelWorld(CHUNK_X * 2);
  for (let z = 0; z < CHUNK_X; z++) {
    for (let x = 0; x < CHUNK_X; x++) w.setBlock(x, G + 6, z, blockId('concrete'));
  }
  const built = meshChunk(w, w.chunkAt(4, 4, false));
  const quads = built.opaque.count / 4;
  // 16x16 of unoccluded slab: a top, a bottom and four thin sides. If the
  // occlusion pass had broken merging, this would be hundreds.
  assert.ok(quads <= 8, `a flat slab meshed into ${quads} quads; merging is broken`);
});

test('every block carries a surface finish the shader knows', async () => {
  const { BLOCK_BY_ID } = await import('../src/data/blocks.js');
  // Read off the shader's own table rather than a list written out here. The
  // list version of this went stale the moment there were more than four
  // finishes, and a guard that has to be edited alongside the thing it guards
  // is not guarding it.
  const { FINISH_ID, SPORTS_BIT } = await import('../src/voxel/mesher.js');
  const known = new Set(Object.keys(FINISH_ID));
  for (const b of BLOCK_BY_ID.slice(1)) {
    assert.ok(known.has(b.finish), `${b.key} has finish "${b.finish}", which the shader cannot render`);
  }

  // The finish id and the playing-surface flag share one vertex attribute.
  // When the flag sat at 8 and an eighth finish was added, turf-plus-flag read
  // as a seat and a pitch came out looking like terracing.
  for (const [name, id] of Object.entries(FINISH_ID)) {
    assert.ok(id >= 0 && id < SPORTS_BIT,
      `finish "${name}" is id ${id}, which collides with the playing-surface flag at ${SPORTS_BIT}`);
  }

  // And the ones that obviously should differ, do.
  const finishOf = (k) => BLOCK_BY_ID.find((b) => b.key === k).finish;
  assert.equal(finishOf('turf'), 'turf');
  assert.equal(finishOf('glass'), 'gloss');
  assert.equal(finishOf('seat'), 'seat');
  assert.equal(finishOf('concrete'), 'matte');
  assert.equal(finishOf('brick'), 'brick');
  assert.equal(finishOf('timber'), 'timber');
  assert.equal(finishOf('asphalt'), 'asphalt');
  assert.equal(finishOf('water'), 'water');

  // Every finish the shader can draw is actually used by something, or it is
  // dead code in a hot loop.
  const used = new Set(BLOCK_BY_ID.slice(1).map((b) => b.finish));
  for (const name of known) {
    assert.ok(used.has(name), `no block uses the "${name}" finish`);
  }
});

test('pitch markings follow the surface the player actually built', async () => {
  const { pitchRects, SPORT_MARKS } = await import('../src/world/pitchMarks.js');
  const { BLOCK_SIZE } = await import('../src/core/constants.js');
  const G = GROUND_Y;

  // A football pitch and a basketball court on the same plot.
  const w = new VoxelWorld(128);
  w.generateTerrain();
  for (let x = 40; x < 94; x++) {
    for (let z = 46; z < 81; z++) w.setBlock(x, G - 1, z, blockId('turf'), zoneId('pitch_football'));
  }
  for (let x = 10; x < 25; x++) {
    for (let z = 10; z < 18; z++) w.setBlock(x, G - 1, z, blockId('hardwood'), zoneId('court_basketball'));
  }
  const rects = pitchRects(detectVenues(w, { complexName: 'M' }));
  assert.equal(rects.length, 2, `expected two marked surfaces, got ${rects.length}`);

  // Biggest first, so a main stadium wins the eight slots the shader keeps.
  assert.equal(rects[0].sport, SPORT_MARKS.football);
  assert.equal(rects[1].sport, SPORT_MARKS.basketball);

  // The rectangle is the pitch, in world metres, long axis first.
  const p = rects[0];
  assert.ok(p.halfW >= p.halfD, 'the long axis should come first');
  assert.ok(Math.abs(p.halfW - 54 * BLOCK_SIZE / 2) <= BLOCK_SIZE,
    `half-width ${p.halfW}m does not match a 54-voxel pitch`);
  assert.ok(Math.abs(p.cx - 67 * BLOCK_SIZE) <= 2 * BLOCK_SIZE,
    `the marked centre ${p.cx}m is not on the pitch`);

  // Enlarge the pitch; the markings must grow with it rather than stay put.
  for (let x = 34; x < 100; x++) {
    for (let z = 42; z < 85; z++) w.setBlock(x, G - 1, z, blockId('turf'), zoneId('pitch_football'));
  }
  const bigger = pitchRects(detectVenues(w, { complexName: 'M' }))
    .find((r) => r.sport === SPORT_MARKS.football);
  assert.ok(bigger.halfW > p.halfW, 'the marking rectangle did not follow the enlarged pitch');
});

test('a surface with no regulation marking set is left alone', async () => {
  const { pitchRects } = await import('../src/world/pitchMarks.js');
  const G = GROUND_Y;
  const w = new VoxelWorld(96);
  w.generateTerrain();
  // A concert stage: a real venue, but nothing to paint on it.
  for (let x = 30; x < 52; x++) {
    for (let z = 30; z < 42; z++) w.setBlock(x, G - 1, z, blockId('stage'), zoneId('stage_event'));
  }
  const a = detectVenues(w, { complexName: 'S' });
  assert.ok(a.venues.length > 0, 'the probe built no venue');
  assert.deepEqual(pitchRects(a), [], 'a stage should not get pitch markings');
});


// ------------------------------------------------------------------- walls
//
// A wall is not a voxel: it sits on the boundary between two cells so a room
// keeps its floor. These hold that promise and the one that follows from it -
// that the same physical edge cannot hold two walls.

test('a wall run follows the drag rather than facing it', async () => {
  const { generateWallRun } = await import('../src/voxel/structures.js');
  const { propId } = await import('../src/data/props.js');
  const w = new VoxelWorld(64);
  w.generateTerrain();
  const typeId = propId('wall_partition');

  // Six cells east: six panels, all on the same edge of their own cell, all
  // in the same row. A wall dragged east runs east.
  const run = generateWallRun(w, { x: 10, y: GROUND_Y, z: 20 }, { x: 15, y: GROUND_Y, z: 20 }, { typeId });
  assert.equal(run.cells.length, 0, 'a wall run should place no blocks at all');
  assert.equal(run.props.length, 6, `six cells should give six panels, got ${run.props.length}`);
  for (const p of run.props) {
    assert.equal(p.z, 20, 'the run wandered off its row');
    assert.equal(p.rot, 0, 'every panel in an east-west run sits on the same edge');
  }
  assert.equal(run.meta.metres, 12, 'six 2m panels is twelve metres of wall');

  // An L: out east, then south. The corner cell carries both directions.
  const bent = generateWallRun(w, { x: 10, y: GROUND_Y, z: 20 }, { x: 14, y: GROUND_Y, z: 24 }, { typeId });
  const rots = new Set(bent.props.map((p) => p.rot));
  assert.equal(rots.size, 2, 'a bent run should turn a corner, not stay on one edge');
});

test('a room is walled all the way round, and its inside is left alone', async () => {
  const { generateWallBox } = await import('../src/voxel/structures.js');
  const { propId } = await import('../src/data/props.js');
  const w = new VoxelWorld(64);
  w.generateTerrain();
  const typeId = propId('wall_partition');

  // A 4x3 room: 4 panels along each long side, 3 along each short one.
  const box = generateWallBox(w, { x: 10, y: GROUND_Y, z: 20 }, { x: 13, y: GROUND_Y, z: 22 }, { typeId });
  assert.equal(box.cells.length, 0);
  assert.equal(box.props.length, 4 + 4 + 3 + 3, `a 4x3 room needs 14 panels, got ${box.props.length}`);
  assert.deepEqual(box.meta.room, { x: 4, z: 3 });

  // Nothing is placed inside: the floor of the room stays yours to furnish.
  const inside = box.props.filter((p) => p.x > 10 && p.x < 13 && p.z > 20 && p.z < 22);
  assert.equal(inside.length, 0, 'walls were laid through the middle of the room');
});

test('one edge holds one wall, whichever side you build it from', async () => {
  const { canonicalEdge } = await import('../src/voxel/props.js');
  const { propId } = await import('../src/data/props.js');
  const w = new VoxelWorld(64);
  w.generateTerrain();
  const layer = w.props;
  const id = propId('wall_partition');

  // The +z side of one cell and the -z side of its neighbour are one edge.
  const a = canonicalEdge(10, GROUND_Y, 20, 2);
  const b = canonicalEdge(10, GROUND_Y, 21, 0);
  assert.deepEqual(a, b, 'the same edge should reduce to the same record');

  assert.equal(layer.canPlace(w, id, 10, GROUND_Y, 20, 2).ok, true);
  layer.add(id, 10, GROUND_Y, 20, 2);
  assert.equal(layer.size, 1);
  assert.equal(layer.canPlace(w, id, 10, GROUND_Y, 21, 0).ok, false,
    'the far side of an edge that already has a wall is not free');

  // Four walls round one cell, which is what a corner needs.
  for (const rot of [0, 1, 3]) {
    assert.equal(layer.canPlace(w, id, 10, GROUND_Y, 20, rot).ok, true, `edge ${rot} should be free`);
    layer.add(id, 10, GROUND_Y, 20, rot);
  }
  assert.equal(layer.size, 4, 'a cell should take a wall on each of its four sides');

  // And the cell itself is still free for something to stand in.
  assert.equal(layer.at(10, GROUND_Y, 20), null, 'walls should not claim the cell they border');
  const bench = propId('bench_crowd');
  assert.equal(layer.canPlace(w, bench, 10, GROUND_Y, 20, 0).ok, true,
    'a wall along a cell edge should not stop a bench standing in that cell');
});

test('removing a wall takes the right one off the right edge', async () => {
  const { propId } = await import('../src/data/props.js');
  const w = new VoxelWorld(64);
  w.generateTerrain();
  const layer = w.props;
  const id = propId('fence_picket');
  for (const rot of [0, 1, 2, 3]) layer.add(id, 10, GROUND_Y, 20, rot);
  assert.equal(layer.size, 4);

  layer.remove(10, GROUND_Y, 20, 1);
  assert.equal(layer.size, 3, 'removing one edge should take exactly one wall');
  assert.equal(layer.edgeAt(10, GROUND_Y, 20, 1), null, 'that edge should now be empty');
  assert.ok(layer.edgeAt(10, GROUND_Y, 20, 0), 'the other edges should be untouched');

  // Digging out the floor brings the walls standing on it down too.
  w.setBlock(10, GROUND_Y - 1, 20, 0);
  const dropped = layer.onBlockRemoved(10, GROUND_Y - 1, 20);
  assert.ok(dropped.length >= 3, `the floor going should drop its walls, dropped ${dropped.length}`);
});
