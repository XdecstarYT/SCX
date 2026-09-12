/**
 * Leagues and tenancies.
 *
 * A tenancy is the one part of the game that plays itself: you sign a club and
 * a season happens whether or not you touch anything. That makes it the part
 * most worth holding to - a fixture list that quietly stops, or a table that
 * never moves, would look like nothing at all rather than like a bug.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { createState } from '../src/core/gameState.js';
import { buildReferenceStadium } from './helpers/buildStadium.js';
import {
  createLeagueState, table, playMatch, rolloverSeason, clubOf, leagueClubs,
  clubOffers, SEASON_DAYS,
} from '../src/core/league.js';
import { CLUBS, CLUB_BY_ID, tenancyRequirements, tenancyTerms, division } from '../src/data/clubs.js';

globalThis.performance ??= { now: () => Date.now() };

function housed() {
  const g = new Game();
  g.adopt(createState({ seed: 21, complexName: 'Riverside' }), buildReferenceStadium());
  g.notify = () => {};
  g.state.reputation.venue = 70;
  g.state.cash = 200_000_000;
  g.analyze(true);
  g.registerVenue(g.primaryVenue.key, 'Riverside Stadium');
  g.analyze(true);
  return g;
}

test('every club is fictional, playable and wants a ground it could fill', () => {
  const ids = new Set();
  for (const c of CLUBS) {
    assert.ok(!ids.has(c.id), `duplicate club id ${c.id}`);
    ids.add(c.id);
    assert.ok(c.name && c.sport && typeof c.strength === 'number');
    assert.ok(c.strength > 0 && c.strength <= 1, `${c.id} has an unplayable strength`);
    const req = tenancyRequirements(c);
    assert.ok(req.minCapacity < req.maxCapacity,
      `${c.name} wants a ground between ${req.minCapacity} and ${req.maxCapacity}`);
    assert.ok(req.minRating < 95, `${c.name} demands a rating no venue can reach`);
    const terms = tenancyTerms(c);
    assert.ok(terms.rentPerSeason > 0 && terms.homeFixtures > 0);
    assert.ok(terms.gateShare > 0 && terms.gateShare < 0.75,
      `${c.name} would take ${terms.gateShare} of the gate`);
  }
  // A bigger club asks for more ground and pays more for it.
  const big = CLUB_BY_ID.get('fc_meridian'), small = CLUB_BY_ID.get('fc_marden');
  assert.ok(tenancyRequirements(big).minCapacity > tenancyRequirements(small).minCapacity);
  assert.ok(tenancyTerms(big).rentPerSeason > tenancyTerms(small).rentPerSeason);
});

test('a league table moves, and is not all draws', () => {
  const league = createLeagueState(7);
  const clubs = leagueClubs(league, 'football', 0);
  assert.ok(clubs.length >= 3, 'the top division is too small to be a league');
  let draws = 0, played = 0;
  for (let i = 0; i < 60; i++) {
    const h = clubs[i % clubs.length], a = clubs[(i + 1) % clubs.length];
    const r = playMatch(league, h, a, `probe:${i}`);
    assert.ok(Number.isInteger(r.homeScore) && r.homeScore >= 0);
    if (r.homeScore === r.awayScore) draws++;
    played++;
  }
  assert.ok(draws < played * 0.6, `${draws} of ${played} matches were draws`);
  assert.ok(draws > 0, 'no match ever finished level, which is its own kind of wrong');
});

test('signing a club fills the calendar and pays the rent up front', () => {
  const g = housed();
  const offers = g.clubOffers();
  assert.ok(offers.length > 0, 'no club would move into a registered stadium');
  const offer = offers[0];
  assert.equal(offer.venue.sport, offer.club.sport, 'a club was offered the wrong sport');

  const before = g.state.cash;
  const r = g.signTenant(offer.club.id);
  assert.ok(r.ok, r.error);
  assert.equal(g.state.league.tenants.length, 1);
  assert.ok(r.tenant.fixtures.length > 0, 'the tenancy came with no fixtures');
  assert.equal(g.state.cash - before, offer.terms.rentPerSeason, 'the first season\'s rent was not paid');

  // The same club cannot be signed twice, nor another club to the same ground.
  assert.ok(g.signTenant(offer.club.id).error, 'signed the same club twice');
  const second = g.clubOffers().find((o) => o.venue.key === offer.venue.key);
  assert.equal(second, undefined, 'a second club was offered a ground that already has one');
});

test('a season plays itself: fixtures are hosted, the table fills, money moves', () => {
  const g = housed();
  const offer = g.clubOffers()[0];
  g.signTenant(offer.club.id);
  const fixtures = g.state.league.tenants[0].fixtures.length;
  const cash = g.state.cash;

  for (let d = 0; d < SEASON_DAYS - 5; d++) g.skipDay(1);

  assert.equal(g.state.stats.eventsHosted >= fixtures, true,
    `only ${g.state.stats.eventsHosted} events for ${fixtures} fixtures`);
  assert.ok(g.state.stats.totalAttendance > 0, 'nobody came to a single fixture');
  assert.ok(g.state.league.results.length >= fixtures * 0.8,
    `only ${g.state.league.results.length} results recorded`);
  assert.notEqual(g.state.cash, cash, 'a whole season passed and the money never moved');

  const rows = g.leagueTable(offer.club.sport, clubOf(g.state.league, offer.club.id).level);
  assert.ok(rows.some((r) => r.p > 0), 'the table never moved');
  assert.ok(rows.every((r) => r.pts === r.w * 3 + r.d), 'the points do not match the results');
});

test('the season rolls over: champions, promotion, and contracts running down', () => {
  const g = housed();
  const offer = g.clubOffers()[0];
  g.signTenant(offer.club.id, undefined, 1);          // a single-season deal
  for (let d = 0; d < SEASON_DAYS + 2; d++) g.skipDay(1);

  assert.equal(g.state.league.season, 2, 'the season never ended');
  assert.ok(g.state.league.honours.length > 0, 'nobody won anything');
  // A one-season deal is over, and they have left.
  assert.equal(g.state.league.tenants.length, 0, 'an expired tenancy stayed on the books');
  // The new season starts from nothing.
  const rows = g.leagueTable('football', 0);
  assert.ok(rows.every((r) => r.p <= 40), 'last season\'s table carried over');
});

test('a promotion is recorded in the save, never on the shared club table', () => {
  // Two games in one process must not share a league. Writing form back to the
  // module would leak one save's promotions into every other one - which is
  // exactly what a second tab, or this test file, is.
  const levels = new Map(CLUBS.map((c) => [c.id, c.level]));
  const a = createLeagueState(1);
  const b = createLeagueState(2);
  a.clubs.fc_marden.level = 0;
  assert.equal(clubOf(a, 'fc_marden').level, 0, 'the save did not record the promotion');
  assert.equal(clubOf(b, 'fc_marden').level, levels.get('fc_marden'),
    'one save\'s promotion leaked into another');
  assert.equal(CLUB_BY_ID.get('fc_marden').level, levels.get('fc_marden'),
    'the shared club table was mutated');

  // And a rollover leaves the catalogue alone too.
  const st = { day: 300, league: a };
  rolloverSeason(st);
  for (const c of CLUBS) {
    assert.equal(c.level, levels.get(c.id), `${c.id} was moved on the shared table`);
  }
});

test('a club will not move into a ground that cannot hold it', () => {
  const league = createLeagueState(3);
  const tiny = { key: 'v1', sport: 'football', siteId: 'site1', name: 'Tiny',
    capacity: { total: 500 }, ratings: { overall: 90 } };
  const rough = { key: 'v2', sport: 'football', siteId: 'site1', name: 'Rough',
    capacity: { total: 80_000 }, ratings: { overall: 12 } };
  const state = { league, day: 1 };
  assert.deepEqual(clubOffers(state, [tiny]), [], 'a club agreed to play in a 500-seat ground');
  assert.deepEqual(clubOffers(state, [rough]), [], 'a club agreed to play at a rating of 12');
});

test('a save written before leagues existed gains one without losing anything', async () => {
  const { migrate } = await import('../src/save/serialization.js');
  const out = migrate({ state: { day: 240, seed: 9, achievements: ['first_event'] } });
  const s = out.state || out;
  assert.ok(s.league, 'no league was created');
  assert.equal(s.league.season, 1);
  assert.deepEqual(s.league.tenants, []);
  assert.equal(s.league.startedDay, 240, 'the first season should start when the save is loaded');
  assert.deepEqual(s.achievements, ['first_event'], 'the old save lost its achievements');
});
