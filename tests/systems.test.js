import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReferenceStadium, fillBox } from './helpers/buildStadium.js';
import { Game } from '../src/core/game.js';
import { createState } from '../src/core/gameState.js';
import { monthlyFinance, fmtMoney, MAINTENANCE_RATE } from '../src/core/economy.js';
import { detectVenues } from '../src/venues/venueDetection.js';
import { REQUIREMENTS } from '../src/venues/ratings.js';
import { checkRequirements } from '../src/events/eventRequirements.js';
import { instantiate, visibleTiers } from '../src/events/eventGenerator.js';
import { EVENT_TEMPLATES } from '../src/data/events.js';
import { makeRng, hashString } from '../src/core/rng.js';
import { rleEncode, rleDecode, makeSave, deserializeWorld, migrate } from '../src/save/serialization.js';
import { VoxelWorld } from '../src/voxel/world.js';
import { blockId } from '../src/data/blocks.js';

globalThis.performance ??= { now: () => Date.now() };
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');

function gameWithStadium() {
  const g = new Game();
  g.adopt(createState({ seed: 7, complexName: 'Riverside' }), buildReferenceStadium());
  return g;
}

// ----------------------------------------------------------------- economy

test('a 10k-seat ground has meaningful but survivable running costs', () => {
  const g = gameWithStadium();
  const f = monthlyFinance(g.state, g.analysis);
  assert.ok(f.totalExpense > 40_000, `too cheap: ${fmtMoney(f.totalExpense)}`);
  assert.ok(f.totalExpense < 260_000, `too punishing: ${fmtMoney(f.totalExpense)}`);
  // Cash on hand should buy well over a year of runway with no events.
  const months = g.state.cash / f.totalExpense;
  assert.ok(months > 12, `only ${months.toFixed(1)} months of runway`);
});

test('running a deficit costs reputation but does not end the game', () => {
  const g = gameWithStadium();
  g.state.cash = -50_000;
  const rep = g.state.reputation.venue;
  g.skipDay(5);
  assert.ok(g.state.reputation.venue < rep);
  assert.ok(g.state.day > 1, 'the game keeps running');
});

test('one event comfortably outweighs a month of upkeep', () => {
  const g = gameWithStadium();
  g.registerVenue(g.primaryVenue.key, 'Riverside Stadium');
  g.analyze(true);
  const ev = instantiate(EVENT_TEMPLATES.find((t) => t.id === 'regional_final'), g.state, makeRng(4));
  ev.status = 'open';
  ev.bidDeadline = g.state.day + 6;
  ev.eventDay = g.state.day + 8;
  g.state.events.board.push(ev);

  const bid = { amount: ev.bidRange[0], packages: [], terms: [], pricing: 'standard', venueKey: g.primaryVenue.key };
  const projection = g.previewBid(ev.uid, bid).projection;
  const monthly = monthlyFinance(g.state, g.analysis).totalExpense;
  assert.ok(projection.profit > monthly, `event profit ${fmtMoney(projection.profit)} vs upkeep ${fmtMoney(monthly)}`);
});

// ------------------------------------------------------------- progression

test('event tiers unlock with reputation, always showing one to aim at', () => {
  assert.deepEqual(visibleTiers(0), ['local', 'regional']);
  assert.ok(visibleTiers(50).includes('national'));
  assert.ok(visibleTiers(50).includes('international'), 'the next tier up stays visible');
  assert.ok(!visibleTiers(50).includes('world'));
});

test('a bigger venue unlocks requirements a small one fails', () => {
  const g = gameWithStadium();
  const small = g.primaryVenue;
  const state = g.state;
  state.reputation.venue = 80;
  const national = instantiate(EVENT_TEMPLATES.find((t) => t.id === 'national_final'), state, makeRng(2));

  const before = checkRequirements(national, small, state);
  assert.ok(before.blocking > 0, 'a 10k ground should not qualify for a national final');
  const capLine = before.lines.find((l) => /Capacity/.test(l.label));
  assert.equal(capLine.ok, false);
  const measuresBefore = { ...small.ratings.measures };

  // Double the seating and the capacity requirement should clear.
  const world = g.world;
  for (let r = 0; r < 8; r++) {
    const y = 16 + r, x0 = 24 - r, x1 = 105 + r, z0 = 32 - r, z1 = 94 + r;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const band = x <= x0 + 2 || x >= x1 - 2 || z <= z0 + 2 || z >= z1 - 2;
      if (band) {
        for (let yy = 12; yy < y; yy++) world.setBlock(x, yy, z, blockId('concrete'));
        world.setBlock(x, y, z, blockId('seat'));
      }
    }
  }
  g.markWorldDirty();
  g.analyze(true);
  const after = checkRequirements(national, g.primaryVenue, state);
  const capAfter = after.lines.find((l) => /Capacity/.test(l.label));
  assert.equal(capAfter.ok, true, `capacity is now ${g.primaryVenue.capacity.total}`);

  // ...but seats alone are not enough. Provision is measured *per spectator*,
  // so a five-fold capacity jump with no new restrooms, exits or parking must
  // strain requirements that previously passed.
  const failedBefore = new Set(before.lines.filter((l) => !l.ok).map((l) => l.label));
  const newlyFailing = after.lines.filter((l) => !l.ok && !failedBefore.has(l.label));
  assert.ok(newlyFailing.length > 0,
    `growing capacity should strain provision; nothing new failed (${after.lines.filter((l) => !l.ok).map((l) => l.label)})`);

  const v = g.primaryVenue;
  for (const key of ['restroom', 'concession', 'exit', 'parking']) {
    assert.ok(v.ratings.measures[key] < measuresBefore[key],
      `${key} provision per spectator should have fallen`);
  }
  assert.ok(v.ratings.issues.some((i) => /exits|concourse|parking/i.test(i.text)),
    'and the venue report should say what to build next');
});

// ------------------------------------------------------------------- saves

test('run-length encoding round-trips chunk data', () => {
  const arr = new Uint8Array(16 * 64 * 16);
  arr.fill(7, 100, 5000);
  arr.fill(3, 5000, 5010);
  const back = rleDecode(rleEncode(arr), arr.length);
  assert.deepEqual(Array.from(back), Array.from(arr));
});

test('a save round-trips the world, the venue and the money', () => {
  const g = gameWithStadium();
  g.registerVenue(g.primaryVenue.key, 'Riverside Stadium');
  g.skipDay(4);
  const before = {
    cap: g.primaryVenue.capacity.total,
    rating: g.primaryVenue.ratings.overall,
    cash: Math.round(g.state.cash),
    day: g.state.day,
  };

  const json = JSON.stringify(makeSave(g.state, g.world));
  assert.ok(json.length < 400_000, `save is ${(json.length / 1024).toFixed(0)}KB`);

  const parsed = migrate(JSON.parse(json));
  const g2 = new Game();
  g2.adopt(parsed.state, deserializeWorld(parsed.world));
  assert.equal(g2.primaryVenue.capacity.total, before.cap);
  assert.equal(g2.primaryVenue.ratings.overall, before.rating);
  assert.equal(Math.round(g2.state.cash), before.cash);
  assert.equal(g2.state.day, before.day);
  assert.equal(g2.state.venues.registered.length, 1);
  assert.equal(g2.primaryVenue.registered, true);
});

test('an empty world produces no venues and no crash', () => {
  const w = new VoxelWorld(64);
  w.generateTerrain();
  const a = detectVenues(w, {});
  assert.equal(a.venues.length, 0);
  assert.equal(a.complex.parkingCars, 0);
});

// ---------------------------------------------------------------- feedback

test('design feedback is specific and actionable, never generic', () => {
  const w = buildReferenceStadium();
  const good = detectVenues(w, {}).venues[0];
  assert.ok(good.ratings.strengths.length > 0);
  assert.ok(good.ratings.issues.every((i) => i.text.length > 20 && /[a-z]/.test(i.text)));

  // Strip the restrooms out and the feedback should call that out by name.
  const bare = new VoxelWorld(128);
  bare.generateTerrain();
  fillBox(bare, 38, 7, 46, 91, 7, 80, 'turf', 'pitch_football');
  fillBox(bare, 30, 8, 40, 100, 8, 42, 'seat', 'seating');
  const v = detectVenues(bare, {}).venues[0];
  const texts = v.ratings.issues.map((i) => i.text).join(' | ');
  assert.match(texts, /restroom/i);
  assert.match(texts, /entrance|exit/i);
  assert.match(texts, /locker|athlete/i);
});

test('recommended provision scales with capacity', () => {
  assert.ok(REQUIREMENTS.restroomVoxels(50_000) > REQUIREMENTS.restroomVoxels(5_000));
  assert.ok(REQUIREMENTS.parkingCars(40_000, 0) > REQUIREMENTS.parkingCars(40_000, 0.4));
});

// ------------------------------------------------------------------- power

test('a power deficit is a real problem, not just a label', async () => {
  const { simulateEvent } = await import('../src/events/eventSimulation.js');
  const g = gameWithStadium();
  g.registerVenue(g.primaryVenue.key, 'Riverside Stadium');
  g.analyze(true);
  assert.equal(g.state.powerDeficit, 0, 'the reference stadium is within capacity');

  // Flood the site with floodlights until demand outstrips the grid.
  const { blockId: bid } = await import('../src/data/blocks.js');
  for (let x = 4; x < 34; x++) for (let z = 100; z < 112; z++) g.world.setBlock(x, 8, z, bid('floodlight'));
  g.markWorldDirty();
  g.analyze(true);
  assert.ok(g.state.powerDeficit > 0, `deficit is ${g.state.powerDeficit}`);

  const v = g.primaryVenue;
  assert.ok(v.ratings.issues.some((i) => i.key === 'power'), 'the venue report flags it');

  // Over many rolls, an overloaded site should produce power incidents.
  const ev = instantiate(EVENT_TEMPLATES.find((t) => t.id === 'regional_final'), g.state, makeRng(6));
  let hits = 0;
  for (let i = 0; i < 20; i++) {
    const r = simulateEvent({ ...ev, seed: 1000 + i }, v, g.state,
      { amount: 0, packages: [], terms: [], pricing: 'standard' });
    if (r.incidents.some((x) => x.key === 'power')) hits++;
  }
  assert.ok(hits > 5, `only ${hits}/20 events hit a power failure`);
});
