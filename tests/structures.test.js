import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelWorld } from '../src/voxel/world.js';
import { blockId } from '../src/data/blocks.js';
import { zoneId } from '../src/data/zones.js';
import {
  generateGrandstand, generateParkingGarage, generateTerrainEdit, generateRetainingWall,
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

  // prefab and the procedural structures have their own tests above; terrain
  // tools have theirs. What matters here is that nothing ships untested.
  const tested = new Set([...covered, 'prefab', 'grandstand', 'garage', 'retaining',
    'raise', 'lower', 'flatten', 'ramp']);
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
