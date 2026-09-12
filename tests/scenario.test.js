/**
 * Scenarios.
 *
 * A scenario is the same game with somebody else's starting position, a brief
 * and a clock. The risks are all at the edges: a starting position that does
 * not build, an objective that can never complete, a deadline that never
 * resolves, or a scenario rule that quietly leaks into the sandbox.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { SCENARIOS, SCENARIO_BY_ID, rankFor, YEAR } from '../src/data/scenarios.js';
import { scenarioProgress, scenarioLabel } from '../src/core/scenario.js';

globalThis.performance ??= { now: () => Date.now() };

/** A state where everything a scenario could ask for has been achieved. */
function everythingDone(g) {
  const s = g.state;
  Object.assign(s.stats, {
    eventsHosted: 40, bestRating: 96, bestCapacity: 95_000, bidsWon: 60,
    tiersHosted: ['local', 'regional', 'national', 'international', 'world'],
    sportsHosted: ['ice', 'swimming', 'basketball', 'football'],
    ceremonyHosted: true,
  });
  s.cash = 500_000_000;
  s.loans = [];
  s.reputation.venue = 100;
  for (const r of s.rivals) r.reputation = 10;
  s.league.tenants = ['fc_meridian', 'bb_apex', 'rg_ironside'].map((clubId) => ({
    clubId, venueKey: 'v', siteId: 'site1', rent: 1, gateShare: 0.3,
    homeFixtures: 13, seasonsLeft: 3, fixtures: [],
  }));
  s.league.honours = [{ season: 1, sport: 'football', level: 0, championId: 'fc_meridian' }];
  return s;
}

test('every scenario is described well enough to choose between', () => {
  const ids = new Set();
  for (const def of SCENARIOS) {
    assert.ok(!ids.has(def.id), `duplicate scenario id ${def.id}`);
    ids.add(def.id);
    assert.ok(def.name && def.blurb && def.brief, `${def.id} is missing its copy`);
    assert.ok(def.difficulty >= 1 && def.difficulty <= 5, `${def.id} has no difficulty`);
    assert.ok(def.years > 0 && def.cash > 0, `${def.id} has no clock or no money`);
    assert.ok(def.objectives.length >= 2, `${def.id} has too few objectives to be a brief`);
    for (const o of def.objectives) {
      assert.ok(o.id && o.desc, `${def.id} has a nameless objective`);
      assert.equal(typeof o.progress, 'function');
    }
  }
});

test('every scenario builds a starting position that reads sanely', () => {
  for (const def of SCENARIOS) {
    const g = new Game();
    g.notify = () => {};
    const r = g.startScenario(def.id);
    assert.ok(r.ok, `${def.id}: ${r.error}`);
    assert.equal(g.state.scenario.id, def.id);
    assert.equal(g.state.cash, def.cash, `${def.id} did not start with its own money`);
    assert.equal(g.state.loans.length, def.debt ? 1 : 0, `${def.id} has the wrong debt`);

    const p = scenarioProgress(g.state);
    assert.ok(p, `${def.id} produced no progress`);
    assert.equal(p.total, def.objectives.length);
    for (const o of p.objectives) {
      assert.ok(Number.isFinite(o.value), `${def.id}/${o.id} reports a non-finite progress`);
      assert.ok(!/NaN|undefined|Infinity/.test(String(o.detail)),
        `${def.id}/${o.id} reads "${o.detail}" on day one`);
    }
    assert.ok(scenarioLabel(g.state).includes(def.name));
  }
});

test('a scenario that says you inherit a stadium gives you one', () => {
  const g = new Game();
  g.notify = () => {};
  g.startScenario('white_elephant');
  const v = g.primaryVenue;
  assert.ok(v, 'the white elephant has no stadium in it');
  assert.ok(v.capacity.total > 30_000, `it seats only ${v.capacity.total}`);
  // And it is the problem the brief describes: big, and not fit to hire.
  assert.ok(v.ratings.overall < 45, `a white elephant should not rate ${v.ratings.overall}`);
  assert.equal(v.facilities.restroom, 0, 'it was supposed to have no facilities');
  assert.equal(g.state.loans.length, 1, 'the debt is missing');
});

test('every objective in every scenario can actually be completed', () => {
  for (const def of SCENARIOS) {
    const g = new Game();
    g.notify = () => {};
    g.startScenario(def.id);
    everythingDone(g);
    const p = scenarioProgress(g.state);
    const short = p.objectives.filter((o) => !o.complete);
    assert.deepEqual(short.map((o) => `${o.id} (${o.detail})`), [],
      `${def.id} has objectives nothing can complete`);
  }
});

test('finishing the brief ends the run, ranks it, and says so once', () => {
  const g = new Game();
  const said = [];
  g.notify = (kind, title) => said.push(title);
  g.startScenario('first_season');
  everythingDone(g);
  g.state.day = 100;                       // well inside the deadline
  g.tickScenario();

  const run = g.state.scenario;
  assert.equal(run.finished, true, 'the run never resolved');
  assert.equal(run.outcome, 'won');
  assert.equal(run.rank, 'gold', 'finishing early should not be bronze');
  assert.equal(run.finishedDay, 100);
  assert.equal(said.filter((t) => /First Season/.test(t)).length, 1);

  // And it stays finished, silently.
  g.tickScenario();
  assert.equal(said.filter((t) => /First Season/.test(t)).length, 1,
    'the finish was announced twice');
});

test('running out of time ends the run without ending the game', () => {
  const g = new Game();
  g.notify = () => {};
  g.startScenario('first_season');
  const cash = g.state.cash;
  g.state.day = g.state.scenario.deadlineDay;
  g.tickScenario();

  assert.equal(g.state.scenario.outcome, 'timeout');
  // The complex is untouched: this is a scorecard, not a game over.
  assert.equal(g.state.cash, cash);
  assert.ok(g.world, 'the world was taken away');
  assert.ok(scenarioLabel(g.state).includes('out of time'));
});

test('the rank follows how much of the clock was left', () => {
  assert.equal(rankFor(YEAR * 1, 3).key, 'gold');
  assert.equal(rankFor(YEAR * 2.2, 3).key, 'silver');
  assert.equal(rankFor(YEAR * 2.9, 3).key, 'bronze');
  assert.equal(rankFor(YEAR * 3.5, 3), null, 'a run past the deadline should not rank');
});

test('a scenario rule does not leak into the sandbox', () => {
  const g = new Game();
  g.notify = () => {};
  g.startScenario('tight_site');
  assert.equal(g.state.landLocked, true);
  assert.ok(g.buyLand().error, 'the hemmed-in site sold land anyway');

  // A fresh sandbox is a fresh sandbox.
  g.newGame({ complexName: 'Sandbox' });
  assert.equal(g.state.landLocked, false, 'the no-land rule followed into the sandbox');
  assert.equal(g.state.scenario, null, 'the sandbox thinks it is a scenario');
  assert.equal(scenarioProgress(g.state), null);
});

test('an old save loads as a sandbox rather than a broken scenario', async () => {
  const { migrate } = await import('../src/save/serialization.js');
  const out = migrate({ state: { day: 90, seed: 3 } });
  const s = out.state || out;
  assert.equal(s.scenario, null);
  assert.equal(s.landLocked, false);
});
