import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VoxelWorld } from '../src/voxel/world.js';
import { blockId } from '../src/data/blocks.js';
import { zoneId } from '../src/data/zones.js';
import { GROUND_Y, BLOCK_SIZE } from '../src/core/constants.js';
import { WorldLife } from '../src/world/life.js';

globalThis.performance ??= { now: () => Date.now() };

const G = GROUND_Y;

/**
 * A raked stand with a canopy over it, a paved concourse behind, a road and a
 * car park. The canopy is the point: it is what the first version of the
 * surface scan tripped over.
 */
function ground({ roof = true } = {}) {
  const w = new VoxelWorld(96);
  w.generateTerrain();
  const seat = blockId('seat');
  const conc = blockId('floor_conc');
  const asphalt = blockId('asphalt');
  const steel = blockId('steel');

  // Eight rows of seats, climbing away from the pitch.
  for (let r = 0; r < 8; r++) {
    for (let x = 30; x < 60; x++) {
      for (let y = G; y <= G + r; y++) w.setBlock(x, y, 40 + r, seat, zoneId('seating'));
    }
  }
  // A canopy over the lot, two clear metres above the back row.
  if (roof) {
    for (let x = 30; x < 60; x++) {
      for (let z = 40; z < 48; z++) w.setBlock(x, G + 10, z, steel, 0);
    }
  }
  // Concourse behind the stand, road and parking beyond that.
  for (let x = 30; x < 60; x++) {
    for (let z = 49; z < 55; z++) w.setBlock(x, G - 1, z, conc, zoneId('concourse'));
    for (let z = 56; z < 59; z++) w.setBlock(x, G - 1, z, asphalt, zoneId('road'));
    for (let z = 60; z < 78; z++) w.setBlock(x, G - 1, z, asphalt, zoneId('parking'));
  }
  return w;
}

function life(world) {
  const l = new WorldLife(new THREE.Scene(), world);
  l.rebuild({ venues: [] });
  return l;
}

test('a roof over the stand does not hide the people under it', () => {
  const covered = life(ground({ roof: true }));
  const open = life(ground({ roof: false }));
  assert.ok(covered.seats.length > 0, 'a covered stand still has seats to sit in');
  // Same stand, same seats, whether or not there is a lid on it.
  assert.equal(covered.seats.length, open.seats.length);
});

test('the concourse is walkable even when it is under cover', () => {
  const l = life(ground());
  assert.ok(l.walk.length / 3 >= 30 * 6 * 0.9, 'the paved concourse is walkable');
});

test('seats are the tops of the rows, not the insides of the block', () => {
  const l = life(ground());
  // Row r sits at z = 40 + r and is filled to y = G + r, so a spectator in it
  // stands at G + r + 1. Every seat cell has to be the top of its own row.
  for (let i = 0; i < l.seats.length; i += 3) {
    const z = l.seats[i + 2], y = l.seats[i + 1];
    assert.equal(y, G + (z - 40) + 1, `seat at z=${z} is on top of its row`);
  }
});

test('turnstiles are both walkable and countable as gates', () => {
  const w = ground();
  const conc = blockId('floor_conc');
  for (let x = 40; x < 46; x++) w.setBlock(x, G - 1, 55, conc, zoneId('entrance'));
  const l = life(w);
  assert.equal(l.gates.length / 3, 6, 'six turnstile cells');
  const walkable = new Set();
  for (let i = 0; i < l.walk.length; i += 3) walkable.add(`${l.walk[i]},${l.walk[i + 2]}`);
  for (let i = 0; i < l.gates.length; i += 3) {
    assert.ok(walkable.has(`${l.gates[i]},${l.gates[i + 2]}`), 'people still walk through it');
  }
  // No entrance zoned means no gates, so nothing that needs one can happen.
  assert.equal(life(ground()).gates.length, 0);
});

test('roads, bays and seats are told apart', () => {
  const l = life(ground());
  assert.ok(l.roads.length > 0, 'the road is a road');
  assert.ok(l.parks.length > 0, 'the car park is a car park');
  assert.ok(l.bays.length > 0, 'and some of its bays are parkable');
  assert.ok(l.bays.length < l.parks.length, 'with aisles left between the rows');
});

test('a full stand seats everybody once', () => {
  const l = life(ground());
  const seats = l.seats.length / 3;
  l.update(0.1, { population: 1, stands: 1, night: 0 });
  assert.equal(l.crowd.count, Math.min(seats, 2600));

  // Whatever shape the stand is, the seat each spectator gets handed has to
  // be their own - stacking two people into one seat is one person you paid
  // for and cannot see.
  const m = new THREE.Matrix4();
  const at = new Set();
  for (let i = 0; i < l.crowd.count; i++) {
    l.crowd.getMatrixAt(i, m);
    at.add(`${Math.round(m.elements[12])},${Math.round(m.elements[14])}`);
  }
  assert.equal(at.size, l.crowd.count, 'no two spectators in the same seat');
});

test('the crowd grows with the ticket sales, and an empty ground is empty', () => {
  const l = life(ground());
  l.update(0.1, { population: 1, stands: 0, night: 0 });
  assert.equal(l.crowd.count, 0);
  l.update(0.1, { population: 1, stands: 0.5, night: 0 });
  const half = l.crowd.count;
  l.update(0.1, { population: 1, stands: 1, night: 0 });
  assert.ok(l.crowd.count > half * 1.5, 'a sell-out is visibly fuller than half a house');
});

test('night empties the place and dims what is left', () => {
  const l = life(ground());
  l.update(0.1, { population: 1, stands: 0, night: 0 });
  const day = l.people.count;
  const bright = l.people.material.color.r;
  l.update(0.1, { population: 1, stands: 0, night: 1 });
  assert.ok(l.people.count < day, 'fewer people about at three in the morning');
  assert.ok(l.people.material.color.r < bright, 'and they are not glowing');
});

test('walkers stay on the surfaces they are allowed on', () => {
  const l = life(ground());
  l.update(0.1, { population: 1, stands: 0, night: 0 });
  assert.ok(l.people.count > 0);
  const allowed = new Set();
  for (let i = 0; i < l.walk.length; i += 3) {
    allowed.add(`${l.walk[i]},${l.walk[i + 1]},${l.walk[i + 2]}`);
  }
  // Walk them for a while, then check nobody has wandered onto the grass.
  for (let i = 0; i < 200; i++) l.update(0.1, { population: 1, stands: 0, night: 0 });
  for (const a of l.peopleData) {
    for (const at of [a.from, a.to]) {
      const k = `${l.walk[at]},${l.walk[at + 1]},${l.walk[at + 2]}`;
      assert.ok(allowed.has(k), `a walker is standing on ${k}`);
    }
  }
});

test('a walker cannot step off a roof onto the floor below it', () => {
  const w = ground();
  const conc = blockId('floor_conc');
  // A paved deck four metres above the concourse, overhanging it. Walking off
  // the edge has to be refused rather than teleporting somebody downstairs.
  for (let x = 40; x < 46; x++) {
    for (let z = 50; z < 54; z++) w.setBlock(x, G + 3, z, conc, zoneId('concourse'));
  }
  const l = life(w);
  const upper = l.walkIndex(42, 51, G + 4);
  assert.ok(upper >= 0, 'the upper deck is walkable');
  assert.equal(l.walk[upper + 1], G + 4);
  // From up there, the cell just past the edge is out of reach.
  assert.equal(l.walkIndex(42, 49, G + 4), -1, 'no stepping into thin air');
  // From the concourse it is right there.
  const lower = l.walkIndex(42, 49, G);
  assert.ok(lower >= 0 && l.walk[lower + 1] === G, 'the concourse below is fine');
});

test('people are placed in the world, not at the origin', () => {
  const l = life(ground());
  l.update(0.1, { population: 1, stands: 0, night: 0 });
  const m = new THREE.Matrix4();
  l.people.getMatrixAt(0, m);
  const x = m.elements[12], z = m.elements[14];
  assert.ok(x > 30 * BLOCK_SIZE && x < 60 * BLOCK_SIZE, `x=${x} is on the site`);
  assert.ok(z > 40 * BLOCK_SIZE && z < 80 * BLOCK_SIZE, `z=${z} is on the site`);
});

test('a bare plot has nobody on it and does not fall over', () => {
  const w = new VoxelWorld(48);
  w.generateTerrain();
  const l = life(w);
  l.update(0.1, { population: 1, stands: 1, night: 0 });
  assert.equal(l.crowd.count, 0);
  assert.equal(l.people.count, 0, 'nobody wanders an empty field');
});
