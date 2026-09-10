import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReferenceStadium, fillBox } from './helpers/buildStadium.js';
import { Game } from '../src/core/game.js';
import { createState } from '../src/core/gameState.js';
import { detectVenues } from '../src/venues/venueDetection.js';
import { instantiate } from '../src/events/eventGenerator.js';
import { EVENT_TEMPLATES } from '../src/data/events.js';
import { makeRng } from '../src/core/rng.js';
import { VoxelWorld } from '../src/voxel/world.js';
import { toolCells, applyEdit, priceEdit, copyRegion } from '../src/voxel/buildTools.js';
import { blockId } from '../src/data/blocks.js';
import { zoneId } from '../src/data/zones.js';
import { History } from '../src/voxel/history.js';
import { meshChunk } from '../src/voxel/mesher.js';

globalThis.performance ??= { now: () => Date.now() };

function gameWithStadium(size = 128) {
  const world = buildReferenceStadium(size);
  const g = new Game();
  g.adopt(createState({ seed: 7, complexName: 'Riverside' }), world);
  return g;
}

// ---------------------------------------------------------------- building

test('blocks can be placed, removed and undone', () => {
  const w = new VoxelWorld(32);
  w.generateTerrain();
  const h = new History(w);
  const cells = toolCells('box', w, { x: 4, y: 8, z: 4 }, { x: 7, y: 10, z: 7 });
  assert.equal(cells.length / 3, 4 * 3 * 4);

  const price = priceEdit(w, cells, 'build', blockId('concrete'));
  assert.equal(price.placed, 48);
  assert.ok(price.cost > 0);

  const batch = applyEdit(w, cells, 'build', blockId('concrete'));
  h.push(batch);
  assert.equal(w.getBlock(5, 9, 5), blockId('concrete'));

  h.undo();
  assert.equal(w.getBlock(5, 9, 5), 0);
  h.redo();
  assert.equal(w.getBlock(5, 9, 5), blockId('concrete'));

  const dem = applyEdit(w, cells, 'demolish', 0);
  assert.ok(dem.refund > 0);
  assert.equal(w.getBlock(5, 9, 5), 0);
});

test('placing a surface auto-zones it, and manual zoning wins', () => {
  const w = new VoxelWorld(32);
  w.generateTerrain();
  w.setBlock(3, 8, 3, blockId('turf'));
  assert.equal(w.getZone(3, 8, 3), zoneId('pitch_football'));
  w.setZone(3, 8, 3, zoneId('pitch_rugby'));
  w.setBlock(3, 8, 3, blockId('turf_synth'));
  assert.equal(w.getZone(3, 8, 3), zoneId('pitch_rugby'), 'hand-painted zone survives a material swap');
});

test('greedy meshing merges coplanar faces', () => {
  const w = new VoxelWorld(32);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) w.setBlock(x, 0, z, blockId('concrete'));
  const chunk = w.getChunk(0, 0);
  const mb = meshChunk(w, chunk);
  const quads = mb.opaque.count / 4;
  assert.ok(quads <= 6, `flat 16x16 slab should mesh to <= 6 quads, got ${quads}`);
});

test('copy and paste reproduce a structure', () => {
  const w = new VoxelWorld(48);
  w.generateTerrain();
  fillBox(w, 4, 8, 4, 6, 10, 6, 'brick');
  const clip = copyRegion(w, { x: 4, y: 8, z: 4 }, { x: 6, y: 10, z: 6 });
  assert.equal(clip.count, 27);
  const cells = toolCells('paste', w, { x: 20, y: 8, z: 20 }, null, { clipboard: clip });
  applyEdit(w, cells, 'paste', 0, { clipboard: clip });
  assert.equal(w.getBlock(21, 9, 21), blockId('brick'));
});

// ---------------------------------------------------------------- detection

test('a hand-built stadium is recognised as a football stadium', () => {
  const world = buildReferenceStadium();
  const a = detectVenues(world, { complexName: 'Riverside' });
  assert.equal(a.venues.length, 1);
  const v = a.venues[0];
  assert.equal(v.sport, 'football');
  assert.match(v.type, /Football Stadium/);
  assert.equal(v.field.regulation, 1, 'pitch meets regulation dimensions');
  assert.ok(v.field.surfaceOk, 'pitch is on turf');
  assert.ok(v.capacity.total > 5000, `capacity ${v.capacity.total}`);
  assert.ok(v.ratings.overall > 55, `rating ${v.ratings.overall}`);
  assert.ok(['regional', 'national'].includes(v.tier), `tier ${v.tier}`);
});

test('an undersized pitch is rejected with a specific reason', () => {
  const w = new VoxelWorld(64);
  w.generateTerrain();
  fillBox(w, 10, 7, 10, 29, 7, 25, 'turf', 'pitch_football');   // 20 x 16, too small
  fillBox(w, 8, 8, 8, 8, 8, 27, 'seat', 'seating');
  const a = detectVenues(w, {});
  assert.equal(a.venues.length, 1);
  const v = a.venues[0];
  assert.ok(v.field.regulation < 1);
  assert.equal(v.tier, 'none');
  const issue = v.ratings.issues.find((i) => i.key === 'field');
  assert.ok(issue && /below the 45x28 minimum/.test(issue.text), issue?.text);
});

test('adding seating raises capacity and the event tier', () => {
  const world = buildReferenceStadium();
  const before = detectVenues(world, {}).venues[0];
  // Add an upper tier all the way round.
  for (let r = 0; r < 4; r++) {
    const y = 16 + r;
    const x0 = 26 - r, x1 = 103 + r, z0 = 34 - r, z1 = 92 + r;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const band = x <= x0 + 1 || x >= x1 - 1 || z <= z0 + 1 || z >= z1 - 1;
      if (band) {
        for (let yy = 12; yy < y; yy++) world.setBlock(x, yy, z, blockId('concrete'));
        world.setBlock(x, y, z, blockId('seat'));
      }
    }
  }
  const after = detectVenues(world, {}).venues[0];
  assert.ok(after.capacity.total > before.capacity.total * 1.3,
    `${before.capacity.total} -> ${after.capacity.total}`);
});

// ------------------------------------------------------------------- events

test('event requirements are checked against the real venue', () => {
  const g = gameWithStadium();
  const v = g.primaryVenue;
  g.registerVenue(v.key, 'Riverside Stadium');
  g.analyze(true);

  const local = instantiate(EVENT_TEMPLATES.find((t) => t.id === 'local_friendly'), g.state, makeRng(1));
  const world = instantiate(EVENT_TEMPLATES.find((t) => t.id === 'world_champs'), g.state, makeRng(2));

  const okCheck = g.previewBid(addToBoard(g, local).uid, baseBid(g, 8000));
  assert.ok(okCheck.evaluation.check.ok, JSON.stringify(okCheck.evaluation.check.lines));

  const bigCheck = g.previewBid(addToBoard(g, world).uid, baseBid(g, 4_000_000));
  assert.equal(bigCheck.evaluation.check.ok, false);
  assert.ok(bigCheck.evaluation.check.blocking >= 3);
});

test('winning a bid schedules the event, hosting it pays out', () => {
  const g = gameWithStadium();
  const v = g.primaryVenue;
  g.registerVenue(v.key, 'Riverside Stadium');
  g.analyze(true);

  const ev = addToBoard(g, instantiate(EVENT_TEMPLATES.find((t) => t.id === 'regional_final'), g.state, makeRng(11)));
  const bid = baseBid(g, ev.bidRange[1]);           // bid the top of the range
  const preview = g.previewBid(ev.uid, bid);
  assert.ok(preview.evaluation.check.ok, JSON.stringify(preview.evaluation.check.lines.filter(l => !l.ok)));
  assert.ok(preview.evaluation.winChance > 0.3, `win chance ${preview.evaluation.winChance}`);

  const cashBefore = g.state.cash;
  const res = g.submitBid(ev.uid, bid);
  assert.ok(res.ok);

  if (res.outcome.won) {
    assert.equal(g.state.cash, cashBefore - bid.amount);
    assert.equal(g.state.events.scheduled.length, 1);
    // Run the clock until event day.
    while (g.state.events.scheduled.length) g.skipDay();
    const report = g.state.events.history[0];
    assert.ok(report, 'an event report was produced');
    assert.ok(report.attendance > 0);
    assert.ok(report.totalRevenue > 0);
    assert.ok(report.totalCost > 0);
    assert.equal(g.state.stats.eventsHosted, 1);
    assert.ok(g.state.reputation.venue > 8, 'reputation moved');
  } else {
    assert.equal(g.state.cash, cashBefore, 'a lost bid costs nothing');
    assert.ok(res.outcome.winner, 'a rival took it');
  }
});

test('bid resolution is deterministic for the same offer', () => {
  const mk = () => {
    const g = gameWithStadium();
    g.registerVenue(g.primaryVenue.key, 'Riverside Stadium');
    g.analyze(true);
    const ev = addToBoard(g, instantiate(EVENT_TEMPLATES.find((t) => t.id === 'pro_league'), g.state, makeRng(5)));
    return g.submitBid(ev.uid, baseBid(g, 200_000));
  };
  const a = mk(), b = mk();
  assert.equal(a.outcome.won, b.outcome.won);
  assert.equal(a.outcome.roll, b.outcome.roll);
});

test('a stronger bid is never weaker than a weak one', () => {
  const g = gameWithStadium();
  g.registerVenue(g.primaryVenue.key, 'Riverside Stadium');
  g.analyze(true);
  const ev = addToBoard(g, instantiate(EVENT_TEMPLATES.find((t) => t.id === 'regional_final'), g.state, makeRng(9)));
  const low = g.previewBid(ev.uid, baseBid(g, ev.bidRange[0]));
  const high = g.previewBid(ev.uid, { ...baseBid(g, ev.bidRange[1]), packages: ['hospitality', 'transport'] });
  assert.ok(high.evaluation.strength > low.evaluation.strength);
});

// ------------------------------------------------------------------ economy

test('construction spends cash and demolition refunds part of it', () => {
  const g = gameWithStadium();
  const start = g.state.cash;
  const cells = toolCells('box', g.world, { x: 2, y: 8, z: 2 }, { x: 6, y: 10, z: 6 });
  const price = priceEdit(g.world, cells, 'build', blockId('steel'));
  assert.ok(g.spendConstruction(price.net));
  assert.ok(g.state.cash < start);
  const batch = applyEdit(g.world, cells, 'build', blockId('steel'));
  assert.ok(batch.cost > 0);

  const mid = g.state.cash;
  const dem = applyEdit(g.world, cells, 'demolish', 0);
  g.refund(dem.refund);
  assert.ok(g.state.cash > mid);
  assert.ok(g.state.cash < start, 'demolition is not a full refund');
});

test('the daily clock keeps running finances and generates events', () => {
  const g = gameWithStadium();
  g.registerVenue(g.primaryVenue.key, 'Riverside Stadium');
  const startDay = g.state.day;
  for (let i = 0; i < 30; i++) g.skipDay();
  assert.equal(g.state.day, startDay + 30);
  assert.ok(g.state.finance.ledger.length > 0);
  assert.ok(g.state.events.board.length > 0);
});

test('land expansion grows the world and costs money', () => {
  const g = gameWithStadium();
  g.state.cash = 50_000_000;
  const before = g.world.size;
  const r = g.buyLand();
  assert.ok(r.ok, r.error);
  assert.ok(g.world.size > before);
  assert.ok(g.state.cash < 50_000_000);
});

// ------------------------------------------------------------------ helpers

function addToBoard(g, ev) {
  ev.status = 'open';
  ev.bidDeadline = g.state.day + 10;
  ev.eventDay = g.state.day + 12;
  g.state.events.board.push(ev);
  return ev;
}

function baseBid(g, amount) {
  const v = g.registeredVenues()[0] || g.primaryVenue;
  return { amount, packages: [], terms: [], pricing: 'standard', venueKey: v?.key };
}
