import test from 'node:test';
import assert from 'node:assert/strict';
import { MATCHDAY_CALLS, PHASES, PHASE_KEYS, CALL_BY_ID } from '../src/data/matchdayCalls.js';
import {
  buildDay, createOps, applyOption, finishOps, autoMatchday, autoChoose,
  scoreOption, deptCompetence, dayContext, MatchdaySession,
} from '../src/core/matchday.js';
import { simulateEvent, incidentRisks, NO_OPS } from '../src/events/eventSimulation.js';
import { EVENT_TEMPLATES } from '../src/data/events.js';
import { instantiate } from '../src/events/eventGenerator.js';
import { STAFF_CHANNELS } from '../src/data/staff.js';
import { makeRng } from '../src/core/rng.js';
import { VoxelWorld } from '../src/voxel/world.js';
import { blockId } from '../src/data/blocks.js';
import { zoneId } from '../src/data/zones.js';
import { GROUND_Y } from '../src/core/constants.js';

globalThis.performance ??= { now: () => Date.now() };

// --------------------------------------------------------------------- the deck

test('every call is a real decision with real trade-offs', () => {
  const ids = new Set();
  const riskKeys = new Set();
  for (const c of MATCHDAY_CALLS) {
    assert.ok(!ids.has(c.id), `two calls share the id "${c.id}"`);
    ids.add(c.id);
    assert.ok(PHASE_KEYS.includes(c.phase), `${c.id} lands in phase "${c.phase}"`);
    assert.ok(c.title && c.title.length > 4, `${c.id} has no title`);
    assert.ok(c.text && c.text.length > 20, `${c.id} has no situation`);
    assert.ok(STAFF_CHANNELS.includes(c.dept), `${c.id} belongs to department "${c.dept}"`);
    assert.ok(c.weight > 0, `${c.id} can never be drawn`);
    assert.ok(c.options.length >= 2, `${c.id} offers ${c.options.length} option(s), which is not a decision`);

    let anyCost = false;
    for (const o of c.options) {
      assert.ok(o.label && o.label.length > 2, `${c.id} has an unlabelled option`);
      assert.ok(o.desc && o.desc.length > 8, `${c.id}/${o.label} says nothing about itself`);
      const e = o.effect || {};
      const does = Object.keys(e).filter((k) => k !== 'need').length;
      assert.ok(does > 0, `${c.id}/${o.label} does nothing at all`);
      // Something in every call has to hurt, or it is not a decision.
      if (e.cost > 0 || e.sat < 0 || e.risk || (e.price ?? 1) < 1
        || Object.values(e.rep || {}).some((v) => v < 0)) anyCost = true;
      for (const v of Object.values(e.guard || {})) {
        assert.ok(v > 0 && v <= 0.85, `${c.id}/${o.label} guards by ${v}`);
      }
      if (e.risk) {
        assert.ok(e.risk.key && e.risk.text, `${c.id}/${o.label} invites a nameless failure`);
        assert.ok(e.risk.chance > 0 && e.risk.chance < 1, `${c.id}/${o.label} risk chance ${e.risk.chance}`);
        riskKeys.add(e.risk.key);
      }
    }
    assert.ok(anyCost, `every option in ${c.id} is free; nothing is being traded`);
  }
  assert.ok(MATCHDAY_CALLS.length >= 25, `only ${MATCHDAY_CALLS.length} calls in the deck`);

  // Every phase has something to ask, or it is a screen with nothing on it.
  for (const p of PHASES) {
    assert.ok(MATCHDAY_CALLS.some((c) => c.phase === p.key), `nothing ever happens in "${p.name}"`);
  }
});

test('a call that exists because of a risk names a risk that exists', async () => {
  // A call gated on a failure the simulation cannot produce would never be
  // drawn, which is a whole decision quietly switched off.
  const venue = fakeVenue();
  const ev = someEvent('national');
  const state = fakeState();
  // A ground where everything that can fail is failing, so the sweep sees the
  // whole table rather than the handful one healthy venue happens to produce.
  const worst = fakeVenue({
    crowdFlow: 5, structuralWarnings: 2,
    measures: { lighting: 0, restroom: 0, parking: 0, security: 0 },
  });
  worst.structuralWarnings = 2;
  const bad = fakeState({
    utilityFactors: { sewer: 0.2, water: 0.2, data: 0.2, climate: 0.2 },
    powerDeficit: 12,
  });
  const known = new Set(incidentRisks(ev, worst, bad, { congestion: 1, soldOut: true, extraRisk: 0.3 })
    .map((r) => r.key));
  for (const c of MATCHDAY_CALLS) {
    if (!c.need) continue;
    assert.ok(known.has(c.need),
      `${c.id} waits for a risk called "${c.need}", which nothing ever produces`);
  }
});

// ------------------------------------------------------------------- the day

test('the day only asks about problems this ground actually has', () => {
  const good = fakeVenue({ crowdFlow: 92, measures: { lighting: 1, restroom: 1, parking: 1, security: 1 } });
  const bad = fakeVenue({ crowdFlow: 20, measures: { lighting: 0.1, restroom: 0.1, parking: 0.1, security: 0.1 } });
  const ev = someEvent('national');
  const state = fakeState();

  const goodDay = buildDay(ev, good, state);
  const badDay = buildDay(ev, bad, state);
  const idsOf = (d) => d.phases.flatMap((p) => p.calls.map((c) => c.id));

  const goodIds = idsOf(goodDay);
  for (const id of goodIds) {
    const need = CALL_BY_ID.get(id)?.need;
    if (!need) continue;
    const live = goodDay.risks.find((r) => r.key === need);
    assert.ok(live && live.chance > 0.08,
      `a well-run ground was asked about "${need}", which is not one of its problems`);
  }
  assert.ok(badDay.risks.filter((r) => !r.good && r.chance > 0.2).length >= 3,
    'a ground with nothing working has no live risks');

  // And the day is a day, not a form: a handful of calls, not thirty.
  const n = idsOf(badDay).length;
  assert.ok(n >= 3 && n <= 12, `a matchday asked ${n} questions`);
});

test('the same day always asks the same questions', () => {
  const venue = fakeVenue();
  const ev = someEvent('national');
  const state = fakeState();
  const a = buildDay(ev, venue, state);
  const b = buildDay(ev, venue, state);
  assert.deepEqual(
    a.phases.flatMap((p) => p.calls.map((c) => c.id)),
    b.phases.flatMap((p) => p.calls.map((c) => c.id)),
    'a matchday reloaded is a different matchday');
});

test('an option that needs something the ground has not got is never offered', () => {
  const noRoof = fakeVenue({ seatRoofCoverage: 0 });
  const ev = someEvent('national');
  const state = fakeState({ weather: 'storm' });
  const day = buildDay(ev, noRoof, state);
  for (const p of day.phases) {
    for (const c of p.calls) {
      for (const o of c.options) {
        assert.notEqual(o.effect?.need, 'roof',
          `${c.id} offered to close a roof the ground has not got`);
      }
    }
  }
  // With a roof, it is offered.
  const roofed = fakeVenue({ seatRoofCoverage: 0.8 });
  const day2 = buildDay(ev, roofed, state);
  const hasRoofOption = day2.phases.some((p) => p.calls.some((c) =>
    c.options.some((o) => o.effect?.need === 'roof')));
  const askedAboutWeather = day2.phases.some((p) => p.calls.some((c) => c.id === 'weather_call'));
  if (askedAboutWeather) assert.ok(hasRoofOption, 'a roofed ground was not offered its own roof');
});

// --------------------------------------------------------------- the outcome

test('decisions change the day, and the report says what they were', () => {
  const venue = fakeVenue({ crowdFlow: 22, measures: { lighting: 0.2, restroom: 0.2, parking: 0.2, security: 0.2 } });
  const ev = someEvent('national');
  const state = fakeState();
  const contract = { amount: 0, venueKey: venue.key, packages: [], terms: [], pricing: 'standard' };
  const day = buildDay(ev, venue, state);

  const play = (pick) => {
    const ops = createOps();
    for (const p of day.phases) for (const c of p.calls) {
      if (c.options.length) applyOption(ops, c, pick(c), day.ctx);
    }
    return simulateEvent(ev, venue, state, contract, finishOps(ops, day));
  };
  const rank = (dir) => (c) => [...c.options]
    .sort((a, b) => dir * (scoreOption(b, day.ctx, day.risks) - scoreOption(a, day.ctx, day.risks)))[0];

  const best = play(rank(1));
  const worst = play(rank(-1));
  const untouched = simulateEvent(ev, venue, state, contract);

  assert.ok(best.attendance >= worst.attendance,
    `taking the right calls let fewer people in (${best.attendance} vs ${worst.attendance})`);
  assert.ok(best.satisfaction > worst.satisfaction || best.attendance > worst.attendance,
    'the best day and the worst day came out the same');

  // The report is an account of the day, not just a number.
  assert.ok(best.ops, 'a played day is not recorded as one');
  assert.equal(best.ops.calls.length, day.phases.flatMap((p) => p.calls).length);
  assert.ok(best.ops.calls.every((c) => c.title && c.option), 'the log does not say what was decided');
  assert.equal(untouched.ops, null, 'an unplayed day claims to have been played');
});

test('an unplayed day is exactly the day it always was', () => {
  // The whole system rides on top of the existing simulation. If passing no
  // operations changed the result, every balance figure in the game would have
  // moved the day this shipped.
  const venue = fakeVenue();
  const state = fakeState();
  const contract = { amount: 0, venueKey: venue.key, packages: [], terms: [], pricing: 'standard' };
  for (const tier of ['local', 'regional', 'national']) {
    const ev = someEvent(tier);
    const a = simulateEvent(ev, venue, state, contract);
    const b = simulateEvent(ev, venue, state, contract, NO_OPS);
    assert.equal(a.attendance, b.attendance);
    assert.equal(a.satisfaction, b.satisfaction);
    assert.equal(Math.round(a.profit), Math.round(b.profit));
  }
});

test('guarding a risk lowers it without ever ruling it out', () => {
  const venue = fakeVenue({ crowdFlow: 10 });
  const ev = someEvent('national');
  const state = fakeState();
  const contract = { amount: 0, venueKey: venue.key, packages: [], terms: [], pricing: 'standard' };

  let bare = 0, guarded = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const e = { ...ev, uid: `g${i}`, seed: 9000 + i };
    if (simulateEvent(e, venue, state, contract).incidents.some((x) => x.key === 'congestion')) bare++;
    const ops = { ...NO_OPS, guard: { congestion: 0.85 } };
    if (simulateEvent(e, venue, state, contract, ops).incidents.some((x) => x.key === 'congestion')) guarded++;
  }
  assert.ok(bare > N * 0.3, `congestion should be common on this ground, saw ${bare}/${N}`);
  assert.ok(guarded < bare * 0.4, `guarding barely helped: ${guarded} vs ${bare}`);
  assert.ok(guarded > 0, 'a plan made a failure impossible, which no plan does');
});

// ----------------------------------------------------------------- the staff

test('who you hired decides the days you do not watch', () => {
  const venue = fakeVenue({ crowdFlow: 24, measures: { lighting: 0.2, restroom: 0.2, parking: 0.2, security: 0.2 } });
  const contract = { amount: 0, venueKey: venue.key, packages: [], terms: [], pricing: 'standard' };
  const bare = fakeState();
  const staffed = fakeState({ staffBonus: Object.fromEntries(STAFF_CHANNELS.map((c) => [c, 0.35])) });
  bare.staffBonus = Object.fromEntries(STAFF_CHANNELS.map((c) => [c, 0]));

  let bareScore = 0, goodScore = 0;
  const N = 60;
  for (let i = 0; i < N; i++) {
    const ev = { ...someEvent('national'), uid: `s${i}`, seed: 4000 + i };
    bareScore += simulateEvent(ev, venue, bare, contract, autoMatchday(ev, venue, bare)).satisfaction;
    goodScore += simulateEvent(ev, venue, staffed, contract, autoMatchday(ev, venue, staffed)).satisfaction;
  }
  assert.ok(goodScore > bareScore,
    `a fully staffed operation ran no better than an empty one (${goodScore} vs ${bareScore})`);

  // And competence really is a range, not a constant.
  assert.ok(deptCompetence(bare, 'security') < 0.3, 'an empty department is confident');
  assert.ok(deptCompetence(staffed, 'security') > 0.7, 'a full department is not');
});

test('a weak department genuinely picks badly, rather than picking well and paying for it', () => {
  const venue = fakeVenue({ crowdFlow: 20 });
  const ev = someEvent('national');
  const state = fakeState();
  const day = buildDay(ev, venue, state);
  const call = day.phases.flatMap((p) => p.calls).find((c) => c.options.length >= 3);
  assert.ok(call, 'no call with a real spread of options');

  const bestOption = [...call.options]
    .sort((a, b) => scoreOption(b, day.ctx, day.risks) - scoreOption(a, day.ctx, day.risks))[0];
  const rng = makeRng(7);
  let bestTakenWeak = 0, bestTakenStrong = 0;
  for (let i = 0; i < 400; i++) {
    if (autoChoose(call, day.ctx, day.risks, 0.15, rng) === bestOption) bestTakenWeak++;
    if (autoChoose(call, day.ctx, day.risks, 0.95, rng) === bestOption) bestTakenStrong++;
  }
  assert.ok(bestTakenStrong > bestTakenWeak * 2,
    `competence barely matters: ${bestTakenStrong} vs ${bestTakenWeak} best calls taken`);
  assert.ok(bestTakenWeak < 200, 'a department with nobody in it still takes the best call half the time');
});

// ------------------------------------------------------------- through a game

test('a live matchday stops the clock and a resolved one starts it again', async () => {
  const { Game } = await import('../src/core/game.js');
  const g = await gameWithGround();
  const venue = g.allVenues().find((x) => x.sport === 'football');
  g.state.settings.liveMatchday = true;
  g.state.settings.matchdayFrom = 0;

  const ev = instantiate(EVENT_TEMPLATES.find((t) => t.sport === 'football' && t.tier === 'local'),
    g.state, makeRng(3));
  ev.eventDay = g.state.day;
  ev.bidDeadline = g.state.day;
  ev.status = 'open';
  g.state.events.board.push(ev);
  const r = g.submitBid(ev.uid, { amount: ev.bidRange[1], venueKey: venue.key,
    packages: [], terms: [], pricing: 'standard' });
  assert.ok(r.outcome?.won, r.error || 'the bid was lost');

  const before = g.state.stats.eventsHosted;
  g.skipDay(1);
  assert.ok(g.matchday, 'the day did not open');
  assert.equal(g.state.paused, true, 'the clock kept running through a live matchday');
  assert.equal(g.state.stats.eventsHosted, before, 'the event resolved without being played');

  const view = g.matchdayView();
  assert.ok(view.call, 'nothing is being asked');
  assert.ok(view.risks.length >= 0);
  assert.equal(view.event.name, ev.name);

  // Play it out through the same calls the screen uses.
  let guard = 0;
  while (g.matchday && guard++ < 40) {
    const v = g.matchdayView();
    if (!v?.call) break;
    g.matchdayChoose(v.call.options[0].index);
  }
  assert.equal(g.matchday, null, 'the day never closed');
  assert.equal(g.state.stats.eventsHosted, before + 1, 'the event was never hosted');
  assert.equal(g.state.paused, false, 'the clock never restarted');
  assert.equal(g.state.events.scheduled.some((e) => e.uid === ev.uid), false,
    'the event is still on the schedule after being played');
  assert.ok(g.state.events.history[0].ops, 'the report does not record the day');
});

test('league fixtures and competition matches never interrupt', async () => {
  const g = await gameWithGround();
  const venue = g.allVenues().find((x) => x.sport === 'football');
  g.state.settings.liveMatchday = true;
  g.state.settings.matchdayFrom = 0;
  for (const kind of ['fixture', 'competition-match']) {
    const ev = { ...someEvent('national'), kind };
    assert.equal(g.shouldOpenMatchday(ev, venue), false,
      `a ${kind} would have stopped the clock`);
  }
  // And the tier floor is respected.
  g.state.settings.matchdayFrom = 3;
  assert.equal(g.shouldOpenMatchday(someEvent('regional'), venue), false);
  assert.equal(g.shouldOpenMatchday(someEvent('world'), venue), true);
  // Off entirely means off.
  g.state.settings.liveMatchday = false;
  assert.equal(g.shouldOpenMatchday(someEvent('world'), venue), false);
});

test('delegating the whole day resolves it the way the staff would', () => {
  const venue = fakeVenue({ crowdFlow: 30 });
  const ev = someEvent('national');
  const state = fakeState();
  const session = new MatchdaySession(ev, venue, state,
    { amount: 0, venueKey: venue.key, packages: [], terms: [], pricing: 'standard' });
  const total = session.phases.flatMap((p) => p.calls).length;
  const ops = session.delegateRest();
  assert.equal(session.done, true);
  assert.equal(ops.log.length, total, 'delegating skipped some of the day');
  assert.ok(session.progress >= 1 || total === 0);
});

// ------------------------------------------------------------------ fixtures

function fakeVenue(over = {}) {
  const measures = {
    field: 1, seating: 0.9, restroom: 0.7, concession: 0.7, concourse: 0.8, entrance: 0.7,
    exit: 0.7, stairs: 0.8, security: 0.7, medical: 0.8, locker: 0.8, media: 0.6,
    broadcast: 0.6, hospitality: 0.5, parking: 0.7, lighting: 0.8, roof: 0.5,
    retail: 0.5, fanzone: 0.4, training: 0.5, equipment: 0.9,
    ...(over.measures || {}),
  };
  return {
    key: 'v1', name: 'Test Park', type: 'Stadium', sport: 'football',
    capacity: { total: 30_000, vip: 400, boxes: 10 },
    ratings: {
      overall: over.overall ?? 62, comfort: 60, crowdFlow: over.crowdFlow ?? 60,
      appearance: 60, safety: 60, accessibility: 60, prestige: 55, measures,
    },
    facilities: { entrance: over.entranceGates ?? 6 },
    field: { regulation: 1 },
    parkingCars: 3_000,
    screens: 2,
    indoor: false,
    seatRoofCoverage: over.seatRoofCoverage ?? 0.4,
    structuralWarnings: 0,
    audienceMult: 1,
  };
}

function fakeState(over = {}) {
  return {
    day: 100, seed: 5, weather: over.weather || 'sunny',
    reputation: { venue: 60, fans: 60, athletes: 55, organiser: 60, community: 60 },
    // Every channel, because the real state always has every channel and a
    // partial one multiplies undefined into the attendance model.
    staffBonus: over.staffBonus
      || Object.fromEntries(['management', 'finance', 'events', 'operations',
        'hospitality', 'marketing', 'security', 'sports'].map((c) => [c, 0.1])),
    sponsorBonuses: { food: 0, merch: 0, sponsor: 0, broadcast: 0, athlete: 0 },
    sponsorPerEvent: 20_000, transitShare: 0.2,
    research: { completed: [] },
    complex: { powerDemand: 4, adverts: 10 },
    utilityFactors: {}, powerDeficit: 0,
    stats: { eventsHosted: 20, bestCapacity: 20_000 },
    league: { startedDay: 1, tenants: [] },
    events: { history: [] },
    organiserHistory: {}, rivals: [],
    ...over,
  };
}

function someEvent(tier) {
  const tpl = EVENT_TEMPLATES.find((t) => t.tier === tier && t.sport === 'football')
    || EVENT_TEMPLATES.find((t) => t.tier === tier);
  return instantiate(tpl, fakeState(), makeRng(11));
}

async function gameWithGround() {
  const { Game } = await import('../src/core/game.js');
  const g = new Game();
  g.newGame({ complexName: 'MD', seed: 6 });
  g.notify = () => {};
  const w = g.world, B = blockId, Z = zoneId, GY = GROUND_Y;
  for (let x = 30; x < 84; x++) for (let z = 40; z < 75; z++) w.setBlock(x, GY, z, B('turf'), Z('pitch_football'));
  for (let r = 1; r <= 10; r++) {
    const y = GY + Math.floor(r * 0.7);
    const col = (x, z) => {
      for (let yy = GY; yy < y; yy++) w.setBlock(x, yy, z, B('concrete'), 0);
      w.setBlock(x, y, z, B('seat'), Z('seating'));
    };
    for (let x = 30 - r; x <= 83 + r; x++) { col(x, 39 - r); col(x, 75 + r); }
    for (let z = 40 - r; z < 75 + r; z++) { col(29 - r, z); col(84 + r, z); }
  }
  const strip = (x0, z0, x1, z1, block, zone) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) w.setBlock(x, GY, z, B(block), Z(zone));
  };
  strip(54, 20, 60, 22, 'pavement', 'entrance');
  let zc = 88;
  for (const [zone, d] of [['restroom', 8], ['concession', 8], ['medical', 6], ['locker', 6], ['exit', 4]]) {
    strip(24, zc, 90, zc + d, 'tile', zone);
    zc += d + 1;
  }
  g.state.cash = 100_000_000;
  g.state.reputation.venue = 60;
  g.state.reputation.organiser = 60;
  g.markWorldDirty();
  g.analyze(true);
  const v = g.analysis.venues.find((x) => x.sport === 'football');
  g.registerVenue(v.key, 'MD Park');
  g.analyze(true);
  return g;
}
