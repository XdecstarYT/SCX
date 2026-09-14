import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assess, issue, permittedCapacity, blockedReason, daysLeft, tickSafety,
  createSafetyState, certFor, stewardRatio, CRITERIA,
  CERTIFICATE_DAYS, PROHIBITION_BELOW, SMALL_GROUND,
} from '../src/core/safety.js';

globalThis.performance ??= { now: () => Date.now() };

/** A venue good enough to be certified, unless something is turned down. */
const venue = (over = {}) => ({
  key: 'v1', name: 'Test Ground', sportName: 'Football',
  capacity: { total: 20_000 },
  facilities: { exitGates: 6 },
  structuralWarnings: 0,
  ratings: { measures: { exit: 1, medical: 1, concourse: 1, stairs: 1 } },
  ...over,
});
const complex = { emergencyRoad: 400 };
const stateWith = (over = {}) => ({
  day: 100, cash: 10e6, safety: createSafetyState(),
  staff: ['stewards', 'stewards', 'stewards'], staffBonus: { security: 0 },
  ...over,
});

// ------------------------------------------------------------- assessment

test('the certificate is dragged down by the worst thing about the ground', () => {
  const good = assess(venue(), stateWith(), complex);
  assert.ok(good.fraction > 0.9, `a sound ground should certify near its full capacity, got ${good.fraction}`);

  // One bad criterion, everything else perfect: the certificate must fall a
  // long way, because a safety case is as strong as its weakest link.
  const noExits = assess(venue({
    ratings: { measures: { exit: 0.05, medical: 1, concourse: 1, stairs: 1 } },
    facilities: { exitGates: 1 },
  }), stateWith(), complex);
  assert.ok(noExits.fraction < good.fraction - 0.25,
    `a ground with no way out must certify far lower: ${good.fraction} vs ${noExits.fraction}`);
  assert.equal(noExits.worst.id, 'egress');
  assert.ok(noExits.failing.some((f) => f.id === 'egress'));
});

test('a permitted capacity is always a fraction of what is actually built', () => {
  const v = venue();
  const a = assess(v, stateWith(), complex);
  assert.ok(a.capacity <= v.capacity.total, 'you cannot be certified for seats you have not built');
  assert.equal(a.capacity, Math.floor(v.capacity.total * a.fraction));
});

test('every criterion is described and actually reads the venue', () => {
  for (const c of CRITERIA) {
    assert.ok(c.name && c.hint && c.hint.length > 20, `${c.id} does not say what it is`);
    assert.ok(c.weight > 0);
    const s = c.score(venue(), stateWith(), complex);
    assert.ok(s >= 0 && s <= 1, `${c.id} returned ${s}, which is not a fraction`);
  }
  // And each one, turned off on its own, moves the answer.
  const base = assess(venue(), stateWith(), complex).fraction;
  const broken = [
    assess(venue({ ratings: { measures: { exit: 0, medical: 1, concourse: 1, stairs: 1 } }, facilities: { exitGates: 0 } }), stateWith(), complex),
    assess(venue({ ratings: { measures: { exit: 1, medical: 0, concourse: 1, stairs: 1 } } }), stateWith(), complex),
    assess(venue(), stateWith({ staff: [] }), complex),
    assess(venue({ ratings: { measures: { exit: 1, medical: 1, concourse: 0, stairs: 0 } } }), stateWith(), complex),
    assess(venue({ structuralWarnings: 4 }), stateWith(), complex),
    assess(venue(), stateWith(), { emergencyRoad: 0 }),
  ];
  for (const b of broken) {
    assert.ok(b.fraction < base - 0.05,
      `turning off ${b.worst.id} did not move the certificate: ${base} -> ${b.fraction}`);
  }
});

// ------------------------------------------------------------ the document

test('a certificate freezes the capacity of the day it was issued', () => {
  const st = stateWith();
  const v = venue();
  const r = issue(st, v, complex);
  assert.ok(r.capacity > 0);
  assert.equal(permittedCapacity(st, v), r.capacity);

  // Building more seats does nothing until an inspector comes back.
  v.capacity.total = 60_000;
  assert.equal(permittedCapacity(st, v), r.capacity,
    'a certificate is a ceiling that does not rise on its own');

  issue(st, v, complex);
  assert.ok(permittedCapacity(st, v) > r.capacity, 'a fresh inspection should recognise the work');
});

test('a certificate runs out, and the ground shuts when it does', () => {
  const st = stateWith();
  const v = venue();
  issue(st, v, complex);
  assert.equal(blockedReason(st, v), null);
  assert.equal(daysLeft(st, v), CERTIFICATE_DAYS);

  st.day += CERTIFICATE_DAYS + 1;
  assert.equal(permittedCapacity(st, v), SMALL_GROUND,
    'a lapsed certificate drops you back to a small ground, it does not shut you');
  assert.match(blockedReason(st, v), /expired/i);
});

test('a ground is warned a month before its certificate runs out, not on the day', () => {
  const st = stateWith();
  const v = venue();
  issue(st, v, complex);
  const seen = [];
  for (let i = 0; i <= CERTIFICATE_DAYS; i++) {
    st.day++;
    for (const n of tickSafety(st, [v]).notices) seen.push({ left: v && daysLeft(st, v), warn: n.warn });
  }
  assert.equal(seen.length, 3, `expected warnings at 30, 7 and 0 days, got ${seen.length}`);
  assert.deepEqual(seen.map((x) => x.left), [30, 7, 0]);
  assert.deepEqual(seen.map((x) => x.warn), [false, true, true]);
});

test('a ground that fails badly enough is prohibited, not merely reduced', () => {
  const st = stateWith({ staff: [] });
  const wreck = venue({
    ratings: { measures: { exit: 0, medical: 0, concourse: 0, stairs: 0 } },
    facilities: { exitGates: 0 }, structuralWarnings: 6,
  });
  const r = issue(st, wreck, { emergencyRoad: 0 });
  assert.equal(r.prohibited, true, `expected a prohibition, got ${r.blend}`);
  assert.equal(r.capacity, 0, 'a prohibited ground sells nothing at all');
  assert.equal(permittedCapacity(st, wreck), 0);
  assert.match(blockedReason(st, wreck), /prohibition/i);
});

test('an uncertified ground is a small ground, not a shut one', () => {
  const st = stateWith();
  const small = venue({ key: 'small', capacity: { total: SMALL_GROUND - 1 } });
  const big = venue({ key: 'big', capacity: { total: 40_000 } });
  // Below the threshold nothing is needed and nothing is said.
  assert.equal(permittedCapacity(st, small), small.capacity.total);
  assert.equal(blockedReason(st, small), null);
  // Above it, the certificate is what unlocks the rest of the seats. A player
  // who has just built their first stadium can still open it.
  assert.equal(permittedCapacity(st, big), SMALL_GROUND);
  assert.match(blockedReason(st, big), /only sell/i);
  issue(st, big, complex);
  assert.ok(permittedCapacity(st, big) > SMALL_GROUND, 'an inspection is what sells the ground out');
});

test('stewarding is measured against one per two hundred and fifty', () => {
  const v = venue({ capacity: { total: 10_000 } });
  // 10,000 spectators needs 40 stewards' worth; one team is 40 people.
  assert.ok(Math.abs(stewardRatio(v, stateWith({ staff: ['stewards'] })) - 1) < 0.01);
  assert.ok(stewardRatio(v, stateWith({ staff: [] })) === 0);
  assert.ok(stewardRatio(v, stateWith({ staff: ['stewards', 'stewards'] })) > 1);
});

test('a poor ground is licensed small; only a dangerous one is closed', () => {
  const poor = assess(venue({
    ratings: { measures: { exit: 0.2, medical: 0.2, concourse: 0.2, stairs: 0.2 } },
    facilities: { exitGates: 1 },
  }), stateWith({ staff: [] }), { emergencyRoad: 0 });
  assert.equal(poor.prohibited, false, 'poor provision is a small certificate, not a closure');
  assert.ok(poor.capacity > 0 && poor.fraction < 0.5);

  // Something over the crowd that is not held up is a different matter.
  const unsafe = assess(venue({ structuralWarnings: 3 }), stateWith(), complex);
  assert.equal(unsafe.prohibited, true, 'unsupported structure closes a ground outright');
  assert.equal(unsafe.capacity, 0);
});

test('an inspection never leaves a ground worse off than no inspection', () => {
  const st = stateWith({ staff: [] });
  const shabby = venue({
    capacity: { total: 40_000 }, facilities: { exitGates: 1 },
    ratings: { measures: { exit: 0.1, medical: 0.1, concourse: 0.1, stairs: 0.1 } },
  });
  const before = permittedCapacity(st, shabby);
  const r = issue(st, shabby, { emergencyRoad: 0 });
  assert.ok(!r.prohibited);
  assert.ok(permittedCapacity(st, shabby) >= before,
    `booking an inspection cut the capacity from ${before} to ${r.capacity}, `
    + 'which would make never booking one the right move');
});

test('the certificate actually caps the crowd at an event, not just on a screen', async () => {
  const { simulateEvent } = await import('../src/events/eventSimulation.js');
  const { instantiate } = await import('../src/events/eventGenerator.js');
  const { EVENT_TEMPLATES } = await import('../src/data/events.js');
  const { makeRng } = await import('../src/core/rng.js');
  const { createTicketState } = await import('../src/core/ticketing.js');

  // Plenty of turnstiles, so the certificate is what limits the crowd rather
  // than the queue. This is the test that was missing when the cap was wired
  // into the screen but never into the simulation.
  const v = {
    key: 'v1', capacity: { total: 40_000, seated: 40_000, vip: 0, standing: 0, boxes: 0 },
    ratings: {
      overall: 75, comfort: 75, crowdFlow: 75, appearance: 70, accessibility: 70, safety: 75,
      measures: { concession: 0.6, retail: 0.5, hospitality: 0.2, locker: 0.6, medical: 1, media: 0.3, broadcast: 0.2, exit: 1, concourse: 1, stairs: 1 },
    },
    facilities: { entrance: 60, entranceGates: 60, exitGates: 10 },
    field: { regulation: 1 }, indoor: false, parkingCars: 2000, screens: 2,
    roofCoverage: 0, seatRoofCoverage: 0, structuralWarnings: 0,
  };
  const base = () => ({
    day: 200, weather: 'sunny', cash: 1e6,
    reputation: { venue: 70, fans: 80, athletes: 50, organiser: 50, community: 60 },
    staffBonus: { marketing: 0, security: 0, operations: 0, events: 0, hospitality: 0, finance: 0, management: 0 },
    sponsorBonuses: { food: 0, merch: 0, sponsor: 0, broadcast: 0, athlete: 0 },
    sponsorPerEvent: 0, transitShare: 0.2, complex: { adverts: 0 },
    stats: { bestSatisfaction: 70 }, tickets: createTicketState(),
    programmes: { effects: {} }, research: { completed: [] },
    safety: createSafetyState(), staff: ['stewards', 'stewards', 'stewards', 'stewards'],
  });

  const ev = instantiate(EVENT_TEMPLATES[0], base(), makeRng(5));
  const contract = { amount: 0, venueKey: 'v1', packages: [], terms: [], pricing: 'standard' };

  // Uncertified: a small ground however many seats are standing.
  const uncertified = base();
  const small = simulateEvent(ev, v, uncertified, contract);
  assert.ok(small.attendance <= SMALL_GROUND,
    `an uncertified ground cannot admit more than ${SMALL_GROUND}, admitted ${small.attendance}`);

  // Certified: the ground fills.
  const certified = base();
  issue(certified, v, { emergencyRoad: 500 });
  const big = simulateEvent(ev, v, certified, contract);
  assert.ok(big.attendance > small.attendance * 2,
    `a certificate should let the ground fill: ${small.attendance} vs ${big.attendance}`);
  assert.ok(big.revenue.tickets > small.revenue.tickets, 'and be worth money');

  // Prohibited: nobody comes in at all.
  const closed = base();
  issue(closed, { ...v, structuralWarnings: 8 }, { emergencyRoad: 500 });
  const none = simulateEvent(ev, v, closed, contract);
  assert.equal(none.attendance, 0, 'a prohibited ground admits nobody');
});

test('a demolished venue stops holding a certificate', () => {
  const st = stateWith();
  issue(st, venue(), complex);
  assert.ok(certFor(st, 'v1').issuedDay >= 0);
  tickSafety(st, []);
  assert.deepEqual(st.safety.byVenue, {}, 'a ground that is gone should not stay on the register');
});

test('a save made before certificates existed is not shut down overnight', () => {
  const st = stateWith({ safety: { ...createSafetyState(), grandfatherUntil: 190 } });
  const v = venue();
  assert.equal(permittedCapacity(st, v), v.capacity.total, 'existing grounds keep trading');
  assert.equal(blockedReason(st, v), null);
  st.day = 191;
  assert.equal(permittedCapacity(st, v), SMALL_GROUND, 'and the grace period does end');
});
