import test from 'node:test';
import assert from 'node:assert/strict';
import { VoxelWorld } from '../src/voxel/world.js';
import { blockId, block } from '../src/data/blocks.js';
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
