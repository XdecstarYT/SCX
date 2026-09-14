import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTicketState, seasonOffer, membershipOffer, sellSeason, eventEffect, summary,
  SEASON_TIERS, MEMBERSHIP_TIERS, CONCESSION_TIERS,
} from '../src/core/ticketing.js';

globalThis.performance ??= { now: () => Date.now() };

const venue = (cap = 30_000) => ({
  key: 'v1', capacity: { total: cap }, ratings: { overall: 70 },
});
const stateWith = (over = {}) => ({
  day: 100, tickets: createTicketState(),
  reputation: { fans: 60, venue: 40 },
  stats: { bestSatisfaction: 70 },
  ...over,
});

// -------------------------------------------------------------- the offers

test('the season tiers trade money now against seats given away', () => {
  const st = stateWith();
  let lastShare = -1, lastDiscount = -1;
  for (const t of SEASON_TIERS) {
    assert.ok(t.hint && t.hint.length > 20, `${t.key} does not say what it is`);
    // Every step sells more of the ground, and every step costs more per seat.
    assert.ok(t.share >= lastShare, `${t.key} sells less of the ground than the tier below`);
    assert.ok(t.discount >= lastDiscount, `${t.key} is dearer per seat than the tier below it`);
    lastShare = t.share; lastDiscount = t.discount;
  }
});

test('a bigger book sells more seats and takes less for each of them', () => {
  const st = stateWith();
  const offers = SEASON_TIERS.map((t) => {
    st.tickets.season = t.key;
    return { key: t.key, ...seasonOffer(st, venue()) };
  });
  const modest = offers.find((o) => o.key === 'modest');
  const full = offers.find((o) => o.key === 'full');
  assert.ok(full.seats > modest.seats, 'selling the house should be more seats');
  assert.ok(full.price < modest.price, 'and a lower price on each of them');
  assert.ok(full.gross > modest.gross, 'but more money up front overall');
  assert.equal(offers[0].seats, 0, 'no season tickets means no season tickets');
});

test('the season book follows the following, not the fixture list', () => {
  const loved = stateWith({ reputation: { fans: 95, venue: 80 } });
  const ignored = stateWith({ reputation: { fans: 10, venue: 10 } });
  loved.tickets.season = 'broad';
  ignored.tickets.season = 'broad';
  assert.ok(seasonOffer(loved, venue()).seats > seasonOffer(ignored, venue()).seats * 1.5,
    'a ground people care about sells far more of its season book');
});

test('memberships are a fee for the right to buy, and the dear one sells less', () => {
  const st = stateWith();
  st.tickets.membership = 'basic';
  const basic = membershipOffer(st, venue());
  st.tickets.membership = 'premium';
  const premium = membershipOffer(st, venue());
  assert.ok(basic.members > premium.members, 'the dearer tier is taken by fewer people');
  assert.ok(premium.tier.loyalty > basic.tier.loyalty, 'but the ones who take it never miss a game');
  st.tickets.membership = 'none';
  assert.equal(membershipOffer(st, venue()).gross, 0);
});

// ------------------------------------------------------------ the trade-off

test('season tickets put a floor under the crowd and take those seats off the gate', () => {
  const st = stateWith();
  const v = venue();
  const none = eventEffect(st, v);
  assert.equal(none.floor, 0);
  assert.equal(none.gateShare, 1, 'with nothing sold in advance every seat is a gate seat');

  st.tickets.season = 'full';
  sellSeason(st, v);
  const sold = eventEffect(st, v);
  assert.ok(sold.floor > 0.3, `a full book should guarantee a crowd, got ${sold.floor}`);
  assert.ok(sold.gateShare < 0.7, 'and those seats cannot be sold twice');
  // The two have to agree: what is committed is exactly what is off the gate.
  assert.ok(Math.abs((1 - sold.gateShare) - sold.committed) < 1e-9);
});

test('the floor is a floor: a season book fills a ground nobody would turn up to', () => {
  const st = stateWith();
  const v = venue();
  st.tickets.season = 'broad';
  sellSeason(st, v);
  const eff = eventEffect(st, v);
  // Whatever demand says, the committed seats are occupied.
  assert.ok(eff.floor > 0.2, 'a wet Tuesday still has the season ticket holders in it');
});

test('concessions cut the price and fill the seats', () => {
  const st = stateWith();
  const v = venue();
  const full = eventEffect(st, v);
  st.tickets.concession = 'wide';
  const wide = eventEffect(st, v);
  assert.ok(wide.priceMult < full.priceMult, 'concessions mean less money per head');
  assert.ok(wide.fillBonus > full.fillBonus, 'and more heads');
  for (const t of CONCESSION_TIERS) {
    assert.ok(t.hint && t.hint.length > 20, `${t.key} does not say what it is`);
  }
});

// -------------------------------------------------------------- the season

test('renewals reflect what the year was like', () => {
  const happy = stateWith({ stats: { bestSatisfaction: 95 } });
  const miserable = stateWith({ stats: { bestSatisfaction: 20 } });
  happy.tickets.season = 'broad';
  miserable.tickets.season = 'broad';
  const a = sellSeason(happy, venue()).renewalRate;
  const b = sellSeason(miserable, venue()).renewalRate;
  assert.ok(a > b + 0.2, `a good year should renew far better: ${a} vs ${b}`);
  assert.ok(b >= 0.35 && a <= 0.97, 'and neither extreme is absolute');
});

test('selling the season banks the money and records what was promised', () => {
  const st = stateWith();
  st.tickets.season = 'modest';
  st.tickets.membership = 'basic';
  const r = sellSeason(st, venue());
  assert.ok(r.gross > 0);
  assert.equal(st.tickets.soldSeason, r.season.seats);
  assert.equal(st.tickets.members, r.members.members);
  assert.equal(st.tickets.history.length, 1);
  assert.equal(st.tickets.history[0].gross, r.gross);
});

test('a season book is felt in the event itself: a floor under the crowd, and less at the gate', async () => {
  const { simulateEvent } = await import('../src/events/eventSimulation.js');
  const { instantiate } = await import('../src/events/eventGenerator.js');
  const { EVENT_TEMPLATES } = await import('../src/data/events.js');
  const { makeRng } = await import('../src/core/rng.js');

  // A venue with plenty of turnstiles, so the gate is not what limits it and
  // demand is what we are actually measuring.
  const v = {
    key: 'v1', capacity: { total: 30_000, seated: 30_000, vip: 0, standing: 0, boxes: 0 },
    ratings: {
      overall: 70, comfort: 70, crowdFlow: 70, appearance: 70, accessibility: 70, safety: 70,
      measures: { concession: 0.6, retail: 0.5, hospitality: 0.2, locker: 0.6, medical: 0.6, media: 0.3, broadcast: 0.2 },
    },
    facilities: { entrance: 40, entranceGates: 40, exitGates: 8 }, field: { regulation: 1 }, indoor: false,
    parkingCars: 1000, screens: 2, roofCoverage: 0, structuralWarnings: 0,
  };
  const base = {
    day: 200, weather: 'sunny', cash: 1e6,
    reputation: { venue: 55, fans: 60, athletes: 50, organiser: 40, community: 60 },
    staffBonus: { marketing: 0, security: 0, operations: 0, events: 0, hospitality: 0, finance: 0, management: 0 },
    sponsorBonuses: { food: 0, merch: 0, sponsor: 0, broadcast: 0, athlete: 0 },
    sponsorPerEvent: 0, transitShare: 0.2, complex: { adverts: 0 },
    stats: { bestSatisfaction: 70 }, tickets: createTicketState(),
    programmes: { effects: {} }, research: { completed: [] },
    safety: undefined, pitches: undefined,
  };
  const ev = instantiate(EVENT_TEMPLATES[0], base, makeRng(11));
  const contract = { amount: 0, venueKey: 'v1', packages: [], terms: [], pricing: 'standard' };

  const bare = JSON.parse(JSON.stringify(base));
  const booked = JSON.parse(JSON.stringify(base));
  booked.tickets.season = 'full';
  sellSeason(booked, v);

  const a = simulateEvent(ev, v, bare, contract);
  const b = simulateEvent(ev, v, booked, contract);

  assert.ok(b.attendance > a.attendance,
    `a season book should put a floor under the crowd: ${a.attendance} vs ${b.attendance}`);
  assert.ok(b.revenue.tickets < a.revenue.tickets,
    `and take those seats off the gate: ${a.revenue.tickets} vs ${b.revenue.tickets}`);
});

test('the summary says what is committed as a share of the ground', () => {
  const st = stateWith();
  const v = venue(20_000);
  st.tickets.season = 'broad';
  sellSeason(st, v);
  const sum = summary(st, v);
  assert.equal(sum.capacity, 20_000);
  assert.ok(sum.committedPct > 10 && sum.committedPct < 80, `got ${sum.committedPct}%`);
  assert.equal(sum.soldSeason, st.tickets.soldSeason);
  assert.ok(sum.season.name && sum.membership.name && sum.concession.name);
});
