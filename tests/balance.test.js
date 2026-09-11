/**
 * Long-run balance.
 *
 * These drive the headless player in sim/ for hundreds of in-game days. They
 * are slower than the rest of the suite and deliberately loose: they assert
 * that the game stays *playable* - solvent, with events to bid on and a route
 * up the tiers - not that it hits particular numbers. Tight assertions here
 * would break on every balance tweak and teach us nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { playOnce, diagnose } from '../sim/longrun.mjs';
import { hostableSports } from '../src/events/eventGenerator.js';
import { EVENT_TEMPLATES } from '../src/data/events.js';

globalThis.performance ??= { now: () => Date.now() };

/**
 * A playthrough takes about twenty seconds, and several tests read the same
 * one, so each (seed, days) pair is played once and shared.
 */
const runs = new Map();
const play = (seed, days) => {
  const k = `${seed}:${days}`;
  if (!runs.has(k)) runs.set(k, playOnce(seed, days));
  return runs.get(k);
};

test('a competently played complex stays solvent for a year', () => {
  const run = play(4242, 360);
  const s = run.summary;
  const { problems } = diagnose(s, run.trace);
  assert.deepEqual(problems, [], `structural problems: ${problems.join('; ')}`);
  assert.ok(s.insolventDays === 0, `spent ${s.insolventDays} days in deficit (worst ${Math.round(s.worstCash)})`);
  assert.ok(s.cash > 1_000_000, `finished a year on ${Math.round(s.cash)}`);
});

test('a year of play climbs at least to the regional tier', () => {
  const run = play(4242, 360);
  const s = run.summary;
  assert.ok(s.hosted >= 8, `only hosted ${s.hosted} events in a year`);
  assert.ok(s.rep >= 30, `reputation only reached ${Math.round(s.rep)}`);
  assert.ok(s.tierFirstSeen.local !== undefined, 'never hosted a local event');
  assert.ok(s.tierFirstSeen.regional !== undefined, 'never reached the regional tier');
});

test('bids are neither hopeless nor a formality', () => {
  const run = play(4242, 360);
  const s = run.summary;
  const bids = s.won + s.lost;
  assert.ok(bids >= 15, `only ${bids} bids in a year - the board is too thin`);
  assert.ok(s.winRate > 0.15, `win rate ${(s.winRate * 100).toFixed(0)}% - bidding is hopeless`);
  assert.ok(s.winRate < 0.9, `win rate ${(s.winRate * 100).toFixed(0)}% - rivals are not competing`);
});

test('the event board offers what the complex can actually host', () => {
  const run = play(4242, 360);
  const s = run.summary;
  // If the board ignored what you built, a football-only complex would spend
  // the year looking at tennis and never place a bid.
  assert.ok(s.won + s.lost >= 10,
    `only ${s.won + s.lost} bids placed - the board is not offering hostable events`);
  assert.ok(s.longestNoBid < 90,
    `${s.longestNoBid} consecutive days with nothing worth bidding on`);
});

test('hostableSports reads the registered venues, and is empty before any', () => {
  assert.equal(hostableSports({ venues: { registered: [] } }).size, 0);
  const set = hostableSports({ venues: { registered: [{ sport: 'football' }] } });
  assert.ok(set.has('football'));
  // Anything with a stage can take a concert, so those ride along.
  assert.ok(set.has('concert'));
  assert.ok(!set.has('tennis'));
});

test('a bigger ground is never punished for hosting a small event', async () => {
  // Setup cost used to scale with the venue's capacity, so every stand you
  // built made local events less affordable. The same event at a bigger ground
  // draws a bigger crowd, so it must not earn less.
  const { simulateEvent } = await import('../src/events/eventSimulation.js');
  const { Game } = await import('../src/core/game.js');
  const { instantiate } = await import('../src/events/eventGenerator.js');
  const { makeRng } = await import('../src/core/rng.js');
  const { SimPlayer } = await import('../sim/player.mjs');

  const game = new Game();
  game.newGame({ complexName: 'Cost probe', seed: 99 });
  game.notify = () => {};
  const b = new SimPlayer(game, {});
  b.openingComplex();
  game.state.cash = 50_000_000;
  for (let d = 0; d < 14; d++) game.skipDay(1);
  game.analyze(true);
  const venue = game.primaryVenue;
  assert.ok(venue, 'the probe complex produced no venue');

  const tpl = EVENT_TEMPLATES.find((t) => t.id === 'local_friendly');
  const ev = instantiate(tpl, game.state, makeRng(7));
  const bid = { amount: ev.bidRange[0], venueKey: venue.key, packages: [], terms: [], pricing: 'standard' };
  const state = { ...game.state, weather: 'sunny', complex: game.analysis.complex };

  const at = (capacity) => {
    const scale = capacity / Math.max(1, venue.capacity.total);
    const v = {
      ...venue,
      capacity: { ...venue.capacity, seated: Math.round(venue.capacity.seated * scale), total: capacity },
    };
    return simulateEvent(ev, v, state, bid);
  };

  const small = at(3_000);
  const mid = at(12_000);
  const big = at(40_000);
  assert.ok(mid.profit > small.profit,
    `a 12,000 ground earned ${Math.round(mid.profit)} where a 3,000 ground earned ${Math.round(small.profit)}`);
  assert.ok(big.profit > mid.profit,
    `a 40,000 ground earned ${Math.round(big.profit)} where a 12,000 ground earned ${Math.round(mid.profit)}`);
  assert.ok(big.profit > 0, `a local event at a big ground lost ${Math.round(big.profit)}`);
});

test('one bad day never costs more than the event was worth', async () => {
  // Incident costs are quoted at national scale. Applied flat, a single
  // 120,000 structural closure wiped out a whole community fixture.
  const { simulateEvent } = await import('../src/events/eventSimulation.js');
  const { Game } = await import('../src/core/game.js');
  const { instantiate } = await import('../src/events/eventGenerator.js');
  const { makeRng } = await import('../src/core/rng.js');
  const { SimPlayer } = await import('../sim/player.mjs');

  const game = new Game();
  game.newGame({ complexName: 'Incident probe', seed: 99 });
  game.notify = () => {};
  const b = new SimPlayer(game, {});
  b.openingComplex();
  game.state.cash = 50_000_000;
  for (let d = 0; d < 14; d++) game.skipDay(1);
  game.analyze(true);
  const venue = game.primaryVenue;
  const tpl = EVENT_TEMPLATES.find((t) => t.id === 'local_friendly');

  // A ground with unsupported roof sections, so incidents actually fire.
  const shaky = { ...venue, structuralWarnings: 4 };

  let sawIncident = false;
  for (let seed = 1; seed <= 40; seed++) {
    const ev = instantiate(tpl, game.state, makeRng(seed));
    const bid = { amount: ev.bidRange[0], venueKey: venue.key, packages: [], terms: [], pricing: 'standard' };
    const sim = simulateEvent(ev, shaky, { ...game.state, weather: 'sunny', complex: game.analysis.complex }, bid);
    if (sim.costs.incidents > 0) sawIncident = true;
    assert.ok(sim.costs.incidents <= sim.totalRevenue * 0.351,
      `an incident cost ${Math.round(sim.costs.incidents)} against ${Math.round(sim.totalRevenue)} of revenue`);
  }
  assert.ok(sawIncident, 'no incident occurred in 40 runs - the probe is not exercising the cap');
});

test('the plot you are given costs nothing to keep', async () => {
  const { block } = await import('../src/data/blocks.js');
  assert.equal(block('grass').maintenance, 0, 'natural ground should not carry upkeep');
  assert.equal(block('dirt').maintenance, 0);
});
