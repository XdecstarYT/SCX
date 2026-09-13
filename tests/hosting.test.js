import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPETITIONS, COMPETITION_BY_ID, matchLabel } from '../src/data/competitions.js';
import { NATIONS, side, contendersFor } from '../src/data/nations.js';
import { ZONES } from '../src/data/zones.js';
import { gameYear, dayOfYear, START_YEAR, DAYS_PER_YEAR } from '../src/core/constants.js';
import {
  createHostingState, firstMatchDay, stagedIn, buildSchedule, competitionOffers,
  recordMatch, championOf, standingLine, completeHosting, awardHosting, offerFor,
} from '../src/core/hosting.js';

globalThis.performance ??= { now: () => Date.now() };

// --------------------------------------------------------------- the catalogue

test('every competition is internally consistent and playable', () => {
  const sports = new Set(ZONES.filter((z) => z.group === 'sport').map((z) => z.sport));
  const ids = new Set();
  for (const c of COMPETITIONS) {
    assert.ok(!ids.has(c.id), `two competitions share the id "${c.id}"`);
    ids.add(c.id);
    assert.ok(c.name && c.short, `${c.id} has no name`);
    assert.ok(c.blurb && c.blurb.length > 25, `${c.id} has no useful blurb`);
    assert.ok(c.trophy, `${c.id} awards nothing`);

    // A ceremony is staged in an athletics stadium; everything else is played
    // on a surface the game can actually build.
    assert.ok(sports.has(c.sport) || c.sport === 'ceremony',
      `${c.id} is played on "${c.sport}", which no zone provides`);

    assert.ok(['showpiece', 'series', 'tournament'].includes(c.format), `${c.id} has a bad format`);
    assert.ok(c.matches >= 1, `${c.id} covers no matches`);
    if (c.format === 'showpiece') assert.equal(c.matches, 1, `${c.id} is a showpiece with ${c.matches} matches`);
    if (c.format === 'tournament') {
      assert.ok(c.matches >= 4, `${c.id} is a tournament of only ${c.matches} matches; it cannot play down to a final`);
    }

    // The schedule must fit inside the window it is allowed to be staged in,
    // or the last match of a five-Test series falls into next year.
    const span = (c.matches - 1) * (c.spacing || 0) + (c.matchDays || 1);
    assert.ok(c.window[0] + span <= DAYS_PER_YEAR,
      `${c.id} runs ${span} days from day ${c.window[0]} and falls out of its own year`);
    assert.ok(c.window[1] > c.window[0], `${c.id} has an empty window`);

    // The rights cost real money and the schedule pays real money back.
    assert.ok(c.rights[1] > c.rights[0], `${c.id} has no range to bid in`);
    assert.ok(c.matchFee > 0, `${c.id} pays nothing to stage`);
    assert.ok(c.prestige > 0, `${c.id} is worth no prestige`);
    assert.ok(c.cycle >= 1 && c.cycle <= 4, `${c.id} comes round every ${c.cycle} years`);

    for (const r of c.req) assert.ok(r.label, `${c.id} has an unlabelled requirement`);
    const field = c.req.find((r) => r.key === 'field');
    assert.ok(field, `${c.id} does not require a playing surface`);
  }
});

test('within a sport, a bigger competition asks for a bigger ground', () => {
  // Deliberately per sport, not across the catalogue. Tiers here rank the
  // standing of the competition, not the size of the room: an international
  // tennis final is played in front of 12,000 and a national Grand Final in
  // front of 40,000, and neither is wrong. Comparing them would only force
  // the tennis to grow into a stadium nobody plays tennis in.
  const capOf = (c) => (c.req.find((r) => r.key === 'capacity') || { min: 0 }).min;
  const RANK = { local: 0, regional: 1, national: 2, international: 3, world: 4 };
  const bySport = {};
  for (const c of COMPETITIONS) (bySport[c.sport] = bySport[c.sport] || []).push(c);

  for (const [sport, comps] of Object.entries(bySport)) {
    const sorted = [...comps].sort((a, b) => RANK[a.tier] - RANK[b.tier]);
    for (let i = 1; i < sorted.length; i++) {
      const lo = sorted[i - 1], hi = sorted[i];
      if (RANK[hi.tier] === RANK[lo.tier]) continue;
      assert.ok(capOf(hi) >= capOf(lo),
        `${sport}: ${hi.id} outranks ${lo.id} but asks for a smaller ground `
        + `(${capOf(hi)} vs ${capOf(lo)})`);
      assert.ok(hi.rights[1] >= lo.rights[1],
        `${sport}: ${hi.id} outranks ${lo.id} but its rights cost less`);
    }
  }

  // The rights are in the same world as the fee. This is a typo guard, not an
  // economic claim: most of a staging's money is the gate, and whether each
  // competition actually pays for itself is measured by running one, which is
  // what sim/hosting.mjs does and what the staging test below asserts.
  for (const c of COMPETITIONS) {
    assert.ok(c.rights[1] <= c.matchFee * c.matches * 3,
      `${c.id} rights top out at ${c.rights[1]} against a total fee of ${c.matchFee}`);
    assert.ok(c.rights[0] >= c.matchFee * 0.02,
      `${c.id} can be had for almost nothing`);
  }
});

test('every match in a competition has a name that says what it is', () => {
  for (const c of COMPETITIONS) {
    const labels = Array.from({ length: c.matches }, (_, i) => matchLabel(c, i));
    for (const l of labels) assert.ok(l && l.length > 2, `${c.id} has an unnamed match`);
    if (c.format === 'tournament') {
      assert.equal(labels[labels.length - 1], 'Final', `${c.id} does not end in a final`);
      assert.ok(labels.some((l) => l.startsWith('Semi-final')), `${c.id} has no semi-finals`);
    }
    if (c.format === 'series' && c.matches > 1) {
      assert.notEqual(labels[0], labels[1], `${c.id} calls two different matches the same thing`);
    }
  }
});

// ------------------------------------------------------------------ calendar

test('the calendar runs in years, and a competition keeps to its own', () => {
  assert.equal(gameYear(1), START_YEAR);
  assert.equal(gameYear(DAYS_PER_YEAR), START_YEAR);
  assert.equal(gameYear(DAYS_PER_YEAR + 1), START_YEAR + 1);
  assert.equal(dayOfYear(1), 1);
  assert.equal(dayOfYear(DAYS_PER_YEAR + 1), 1);

  const annual = COMPETITIONS.find((c) => c.cycle === 1);
  const quad = COMPETITIONS.find((c) => c.cycle === 4);
  assert.ok(stagedIn(annual, START_YEAR) && stagedIn(annual, START_YEAR + 1));
  assert.ok(stagedIn(quad, START_YEAR));
  assert.ok(!stagedIn(quad, START_YEAR + 1), 'a four-yearly competition is being staged every year');
  assert.ok(stagedIn(quad, START_YEAR + 4));

  // The 2028 staging really is in 2028.
  assert.equal(gameYear(firstMatchDay(annual, START_YEAR + 2)), START_YEAR + 2);
});

// ------------------------------------------------------------------ the draw

test('a tournament plays down to a final somebody actually wins', () => {
  const comp = COMPETITIONS.find((c) => c.format === 'tournament' && c.field === 'nations');
  const state = { seed: 9, day: 1, league: null };
  const sched = buildSchedule(state, comp, 2026, 100);
  assert.ok(sched, 'the draw could not be made');
  assert.equal(sched.matches.length, comp.matches);
  assert.ok(sched.sides.length >= 4, 'a tournament needs a field');

  for (const m of sched.matches) {
    assert.notEqual(m.homeId, m.awayId, `${m.label} is a side playing itself`);
  }

  // Days run forward and never land on the same day twice.
  const days = sched.matches.map((m) => m.day);
  for (let i = 1; i < days.length; i++) {
    assert.ok(days[i] > days[i - 1], 'two matches are scheduled for the same day');
  }

  // Play it out: the strongest side wins its group matches, and the final
  // decides the trophy.
  const hosting = {
    ...sched, format: comp.format, sides: sched.sides, wins: {},
    totalAttendance: 0, matches: sched.matches, contested: true,
  };
  for (const s of hosting.sides) hosting.wins[s.id] = 0;
  for (const m of hosting.matches) {
    m.decided = true;
    recordMatch(hosting, m, 3, 1, 10_000);
  }
  const champ = championOf(hosting);
  assert.ok(champ, 'a tournament finished with no champion');
  assert.equal(champ.id, hosting.matches[hosting.matches.length - 1].homeId,
    'the trophy did not go to the side that won the final');
  assert.match(standingLine(hosting), /in the final/,
    'a finished tournament should be quoted by its final, not a win tally');
});

test('a series is quoted as a series, and a drawn one is shared', () => {
  const comp = COMPETITIONS.find((c) => c.format === 'series' && c.sides);
  const state = { seed: 4, day: 1, league: null };
  const sched = buildSchedule(state, comp, 2026, 60);
  const hosting = {
    format: 'series', sides: sched.sides, matches: sched.matches, wins: {},
    totalAttendance: 0, contested: true,
  };
  for (const s of hosting.sides) hosting.wins[s.id] = 0;
  assert.equal(hosting.sides.length, 2, 'a series is between two sides');

  // Two each and one drawn: nobody takes it.
  recordMatch(hosting, hosting.matches[0], 2, 1, 100);
  recordMatch(hosting, hosting.matches[1], 0, 2, 100);
  recordMatch(hosting, hosting.matches[2], 3, 0, 100);
  recordMatch(hosting, hosting.matches[3], 1, 4, 100);
  recordMatch(hosting, hosting.matches[4], 1, 1, 100);
  assert.equal(championOf(hosting), null, 'a two-all series produced a champion');
  assert.match(standingLine(hosting), /2 - 2/, 'the series is not quoted on wins');
  assert.match(standingLine(hosting), /1 drawn/, 'the drawn match went unmentioned');
});

test('every representative side can play every sport it is picked for', () => {
  const compSports = new Set(COMPETITIONS.map((c) => c.sport).filter((s) => s !== 'ceremony'));
  for (const sport of compSports) {
    const field = contendersFor(sport, 8);
    assert.ok(field.length >= 4, `only ${field.length} sides can play ${sport}`);
    for (const s of field) {
      assert.ok(s.strength > 0 && s.strength <= 1, `${s.name} has a nonsense strength at ${sport}`);
      assert.equal(s.sport, sport);
    }
    // The field is not all the same standard, or every match is a coin toss.
    const spread = field[0].strength - field[field.length - 1].strength;
    assert.ok(spread > 0.05, `every side is the same standard at ${sport}`);
  }
  for (const n of NATIONS) {
    assert.ok(side(n.id, 'football'), `${n.id} cannot be picked`);
    for (const [sport, v] of Object.entries(n.sports || {})) {
      assert.ok(v > 0.2 && v <= 1, `${n.name} has a nonsense ${sport} rating`);
    }
  }
});

// ------------------------------------------------------------- through a game

test('rights are offered, won, staged and remembered', async () => {
  const { Game } = await import('../src/core/game.js');
  const { buildComplex } = await import('../sim/sports.mjs');
  const { SPORT_ZONES } = await import('../src/data/zones.js');

  const comp = COMPETITION_BY_ID.get('autumn_tests');
  const sz = SPORT_ZONES.find((z) => z.sport === 'rugby');
  const g = new Game();
  g.newGame({ complexName: 'Test Park', seed: 5 });
  g.notify = () => {};
  buildComplex(g, sz, { roof: true, screens: true, seats: 34_000 });
  g.state.cash = 200_000_000;
  g.state.reputation.venue = 92;
  g.state.reputation.organiser = 92;
  g.markWorldDirty();
  g.analyze(true);
  const v = g.analysis.venues.find((x) => x.sport === 'rugby');
  g.registerVenue(v.key, 'Test Park');
  g.analyze(true);

  // Nothing is offered before the window opens.
  const start = firstMatchDay(comp, 2026);
  g.skipDay(Math.max(1, start - 200 - g.state.day));
  assert.equal(g.competitionOffers().some((o) => o.compId === comp.id), false,
    'the rights were offered before the bidding window opened');

  g.skipDay(start - 148 - g.state.day);
  const offer = g.competitionOffers().find((o) => o.compId === comp.id);
  assert.ok(offer, 'the rights never opened');
  assert.equal(offer.name, `2026 ${comp.name}`, 'the offer is not stamped with its year');

  const cashBefore = g.state.cash;
  const bid = { amount: offer.bidRange[1], venueKey: v.key, packages: [], terms: [], pricing: 'standard' };
  let r = g.bidForCompetition(offer.uid, bid);
  assert.ok(!r.error, r.error);
  let attempts = 1;
  while (!r.hosting && attempts < 6) {
    g.skipDay(DAYS_PER_YEAR);
    const next = g.competitionOffers().find((o) => o.compId === comp.id);
    if (!next) { g.skipDay(60); continue; }
    r = g.bidForCompetition(next.uid, { ...bid, amount: next.bidRange[1] });
    attempts++;
  }
  assert.ok(r.hosting, `never won the rights in ${attempts} attempts`);
  const h = r.hosting;

  // Paying for rights costs money before it makes any.
  assert.ok(g.state.cash < cashBefore, 'the rights were free');
  assert.equal(h.matches.length, comp.matches);
  assert.equal(g.hostings().length, 1, 'the hosting is not on the calendar');
  assert.equal(g.hostings()[0].remaining, comp.matches);

  // You cannot take the same competition twice, nor a clashing one.
  assert.equal(g.competitionOffers().some((o) => o.compId === comp.id && o.year === h.year), false,
    'the same rights are still being offered after they were won');

  // Run the schedule.
  const last = h.matches[h.matches.length - 1];
  const before = g.state.stats.eventsHosted;
  g.skipDay(last.day - g.state.day + 2);

  assert.equal(g.state.hosting.active.length, 0, 'the hosting never closed');
  const entry = g.state.hosting.history.find((x) => x.id === h.id);
  assert.ok(entry, 'nothing went on the honours board');
  assert.equal(entry.matches, comp.matches);
  assert.ok(entry.attendance > 0, 'nobody came');
  assert.ok(entry.champion || entry.shared, 'nobody was declared champion');
  assert.equal(entry.year, h.year, 'the honours entry lost its year');
  // A staging that cannot pay for itself at a ground built for it is a trap,
  // not a decision: the gate across the schedule has to beat the rights.
  assert.ok(entry.profit > entry.rightsPaid,
    `staging it made ${entry.profit} against rights of ${entry.rightsPaid}`);

  // Every match was a real event, through the real simulation.
  assert.equal(g.state.stats.eventsHosted - before, comp.matches,
    'the matches did not run as events');
  assert.ok(g.state.stats.totalAttendance > 0);

  // And the records board knows what the best day was.
  assert.ok(g.state.hosting.records.crowd?.value > 0, 'no crowd record was kept');
  assert.equal(g.state.hosting.records.crowd.value, entry.bestCrowd);
});

test('a save from before hosting existed loads with an empty honours board', async () => {
  const { makeSave, migrate, deserializeWorld } = await import('../src/save/serialization.js');
  const { Game } = await import('../src/core/game.js');
  const g = new Game();
  g.newGame({ complexName: 'Old', seed: 3 });

  // Exactly what an older save looks like: everything else, and no hosting.
  const blob = JSON.parse(JSON.stringify(makeSave(g.state, g.world)));
  delete blob.state.hosting;

  const back = migrate(blob);
  assert.ok(back.state.hosting, 'the save did not gain a hosting board');
  assert.deepEqual(back.state.hosting.history, []);
  assert.deepEqual(back.state.hosting.active, []);

  const g2 = new Game();
  g2.adopt(back.state, deserializeWorld(back.world));
  assert.deepEqual(g2.honours().history, [], 'an old save invented an honours board');
  assert.deepEqual(g2.hostings(), []);
  // And it can be offered rights from here on, rather than being stuck.
  assert.ok(Array.isArray(g2.competitionOffers()));
});

test('an offer cannot be taken by a venue that cannot hold it', async () => {
  const { Game } = await import('../src/core/game.js');
  const g = new Game();
  g.newGame({ complexName: 'Small', seed: 2 });
  g.notify = () => {};
  g.state.hosting = createHostingState();
  const comp = COMPETITION_BY_ID.get('nations_cup_final');
  const offer = offerFor(g.state, comp, 2026, 1, 100, 150);

  // No venue at all.
  assert.ok(g.bidForCompetition(offer.uid, { venueKey: 'nope', amount: 1 }).error,
    'rights were awarded to a venue that does not exist');

  // A schedule cannot be awarded without a field to contest it.
  const hosting = awardHosting(g.state, offer, { key: 'k', name: 'K' }, 1);
  assert.ok(hosting, 'a nations competition could not find a field');
  assert.ok(hosting.sides.length >= 2);
  assert.equal(hosting.rightsPaid, 1);
});

test('only a complex with a registered venue is approached at all', () => {
  const state = {
    seed: 1, day: 200, hosting: createHostingState(), league: null,
  };
  assert.deepEqual(competitionOffers(state, new Set()), [],
    'a complex with nothing registered was offered hosting rights');
  const football = competitionOffers(state, new Set(['football']));
  for (const o of football) {
    assert.ok(o.sport === 'football' || o.sport === 'ceremony',
      `a football-only complex was offered ${o.sport} rights`);
  }
});

test('a ceremony is staged, not won', () => {
  const comp = COMPETITIONS.find((c) => c.contested === false);
  assert.ok(comp, 'no competition is uncontested');
  const state = { seed: 1, day: 1, league: null, activeSite: 'site1' };
  const offer = offerFor(state, comp, 2026, 1, 10, 120);
  const hosting = awardHosting(state, offer, { key: 'k', name: 'Stadium' }, 100);
  assert.equal(hosting.contested, false);
  recordMatch(hosting, hosting.matches[0], 0, 0, 80_000);
  assert.equal(championOf(hosting), null, 'somebody won a ceremony');
  assert.match(standingLine(hosting), /80,000/, 'a ceremony should be quoted by its crowd');

  state.hosting = createHostingState();
  const entry = completeHosting(state, hosting);
  assert.equal(entry.ceremonial, true);
  assert.equal(entry.shared, false, 'a ceremony was recorded as a shared trophy');
});

test('a ground staging a competition is not free for anything else', async () => {
  const { Game } = await import('../src/core/game.js');
  const { buildComplex } = await import('../sim/sports.mjs');
  const { SPORT_ZONES } = await import('../src/data/zones.js');
  const { EVENT_TEMPLATES } = await import('../src/data/events.js');
  const { instantiate } = await import('../src/events/eventGenerator.js');
  const { makeRng } = await import('../src/core/rng.js');

  const g = new Game();
  g.newGame({ complexName: 'Busy', seed: 8 });
  g.notify = () => {};
  buildComplex(g, SPORT_ZONES.find((z) => z.sport === 'rugby'), { roof: true, screens: true, seats: 34_000 });
  g.state.cash = 300_000_000;
  g.state.reputation.venue = 92;
  g.state.reputation.organiser = 92;
  g.markWorldDirty();
  g.analyze(true);
  const v = g.analysis.venues.find((x) => x.sport === 'rugby');
  g.registerVenue(v.key, 'Busy Park');
  g.analyze(true);
  const venue = g.allVenues().find((x) => x.sport === 'rugby');

  const comp = COMPETITION_BY_ID.get('autumn_tests');
  g.skipDay(firstMatchDay(comp, 2026) - 148 - g.state.day);
  let hosting = null;
  for (let i = 0; i < 6 && !hosting; i++) {
    const offer = g.competitionOffers().find((o) => o.compId === comp.id);
    if (!offer) { g.skipDay(360); continue; }
    g.state.cash = 300_000_000;
    const r = g.bidForCompetition(offer.uid,
      { amount: offer.bidRange[1], venueKey: venue.key, packages: [], terms: [], pricing: 'standard' });
    hosting = r.hosting || null;
    if (!hosting) g.skipDay(360);
  }
  assert.ok(hosting, 'never won the rights');

  // The days the competition occupies are named, and there are as many as
  // there are unplayed matches.
  const busyDays = g.venueCommitments(venue.key);
  assert.equal(busyDays.length, comp.matches, 'the calendar does not know about every match');

  // An event booked onto one of those days is refused, with the reason.
  const tpl = EVENT_TEMPLATES.find((t) => t.sport === 'rugby' && t.tier === 'regional');
  const ev = instantiate(tpl, g.state, makeRng(77));
  ev.eventDay = hosting.matches[0].day;
  ev.bidDeadline = ev.eventDay;
  ev.status = 'open';
  g.state.events.board.push(ev);
  const blocked = g.submitBid(ev.uid, {
    amount: ev.bidRange[1], venueKey: venue.key, packages: [], terms: [], pricing: 'standard' });
  assert.ok(blocked.error, 'an event was booked into a ground mid-series');
  assert.match(blocked.error, /staging/, `the refusal does not say why: "${blocked.error}"`);

  // A day the competition does not want is still free.
  const free = hosting.matches[hosting.matches.length - 1].day + 30;
  assert.equal(g.venueBusy(venue.key, free, 1), null, 'a clear day reads as busy');
});
