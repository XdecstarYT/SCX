import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNationalComplex, buildReferenceStadium } from './helpers/buildStadium.js';
import { Game } from '../src/core/game.js';
import { createState } from '../src/core/gameState.js';
import { Negotiation } from '../src/events/negotiation.js';
import { evaluateBid, contractEffects, bidCostMultiplier } from '../src/events/bidding.js';
import { simulateEvent } from '../src/events/eventSimulation.js';
import { instantiate } from '../src/events/eventGenerator.js';
import { EVENT_TEMPLATES } from '../src/data/events.js';
import { makeRng } from '../src/core/rng.js';

globalThis.performance ??= { now: () => Date.now() };

function bigGame() {
  const g = new Game();
  g.adopt(createState({ seed: 7, complexName: 'Riverside' }), buildNationalComplex());
  g.state.reputation.venue = 70;
  g.state.reputation.organiser = 65;
  g.state.cash = 40_000_000;
  g.analyze(true);
  g.registerVenue(g.primaryVenue.key, 'Riverside Stadium');
  g.analyze(true);
  return g;
}

const bidFor = (g, ev, extra = {}) => ({
  amount: Math.round((ev.bidRange[0] + ev.bidRange[1]) / 2),
  packages: [], terms: [], pricing: 'standard',
  venueKey: g.primaryVenue.key, ...extra,
});

function pushEvent(g, id, seed = 3) {
  const ev = instantiate(EVENT_TEMPLATES.find((t) => t.id === id), g.state, makeRng(seed));
  ev.status = 'open';
  ev.bidDeadline = g.state.day + 8;
  ev.eventDay = g.state.day + 10;
  g.state.events.board.push(ev);
  return ev;
}

test('local events are not worth negotiating over', () => {
  const g = bigGame();
  const ev = pushEvent(g, 'local_friendly');
  assert.equal(g.negotiationFor(ev.uid, bidFor(g, ev)), null);
});

test('a credible national bid opens a multi-round negotiation', () => {
  const g = bigGame();
  const ev = pushEvent(g, 'national_final');
  const session = g.negotiationFor(ev.uid, bidFor(g, ev, { amount: ev.bidRange[1] }));
  assert.ok(session, 'a national final should trigger a negotiation');
  assert.equal(session.rounds.length, 2);
  assert.ok(session.current.demand.length > 20);
  assert.ok(session.currentOptions().length >= 3);
});

test('the same event always asks the same things', () => {
  const g = bigGame();
  const ev = pushEvent(g, 'national_final');
  const a = new Negotiation(ev, g.primaryVenue, g.state).rounds.map((r) => r.id);
  const b = new Negotiation(ev, g.primaryVenue, g.state).rounds.map((r) => r.id);
  assert.deepEqual(a, b);
});

test('conceding raises goodwill and costs money; refusing does the reverse', () => {
  const g = bigGame();
  const ev = pushEvent(g, 'national_final');
  const base = bidFor(g, ev);

  const generous = new Negotiation(ev, g.primaryVenue, g.state);
  while (generous.active) {
    const best = generous.currentOptions().slice().sort((x, y) => y.strength - x.strength)[0];
    generous.answer(best.key);
  }
  const stubborn = new Negotiation(ev, g.primaryVenue, g.state);
  while (stubborn.active) {
    const worst = stubborn.currentOptions().slice().sort((x, y) => x.strength - y.strength)[0];
    stubborn.answer(worst.key);
  }

  const gr = generous.result();
  const st = stubborn.result();
  assert.ok(gr.strength > st.strength, 'conceding buys goodwill');
  assert.ok(gr.cost + gr.extraDays + Math.abs(gr.revenueShare) > 0, 'and it costs something real');

  const evGen = evaluateBid(ev, g.primaryVenue, g.state, { ...base, negotiation: gr });
  const evStub = evaluateBid(ev, g.primaryVenue, g.state, { ...base, negotiation: st });
  assert.ok(evGen.winChance > evStub.winChance,
    `${evGen.winChance.toFixed(3)} should beat ${evStub.winChance.toFixed(3)}`);
});

test('agreed terms actually change the event that gets simulated', () => {
  const g = bigGame();
  const ev = pushEvent(g, 'national_final');
  const base = bidFor(g, ev);

  const negotiation = {
    strength: 0.2, cost: 0.06, fee: 0.2, revenueShare: 0.09,
    extraDays: 2, multiYear: 3, risk: 0, communityBonus: 10, athleteBonus: 3,
    commitments: [],
  };
  const eff = contractEffects({ ...base, negotiation });
  assert.equal(eff.extraDays, 2);
  assert.equal(eff.feeUplift, 0.2);
  assert.ok(bidCostMultiplier({ ...base, negotiation }) >= 0.06);

  const plain = simulateEvent(ev, g.primaryVenue, g.state, base);
  const negotiated = simulateEvent(ev, g.primaryVenue, g.state, { ...base, negotiation });
  assert.equal(negotiated.days, plain.days + 2, 'the venue is tied up longer');
  assert.ok(negotiated.revenue.venueFee > plain.revenue.venueFee, 'the uplifted fee is paid');
  assert.ok(negotiated.costs.packages > plain.costs.packages, 'the commitments cost money');
  assert.ok(negotiated.repDelta.community > plain.repDelta.community, 'the community programme lands');
  assert.ok(negotiated.repDelta.athletes > plain.repDelta.athletes, 'the relaid surface lands');
});

test('promising what the venue cannot deliver is discounted and risky', () => {
  // A modest ground with no hospitality, no broadcast centre and thin security
  // is exactly the venue that gets tempted into over-promising.
  const g = new Game();
  g.adopt(createState({ seed: 11, complexName: 'Riverside' }), buildReferenceStadium());
  g.state.reputation.venue = 70;
  g.analyze(true);
  g.registerVenue(g.primaryVenue.key, 'Riverside Stadium');
  g.analyze(true);
  const ev = pushEvent(g, 'intl_cup');
  assert.ok((g.primaryVenue.ratings.measures.hospitality ?? 0) < 0.4,
    'this venue genuinely cannot host exclusive hospitality');

  const session = new Negotiation(ev, g.primaryVenue, g.state);
  let sawUnsupported = false;
  while (session.active) {
    const opts = session.currentOptions();
    const unsupported = opts.find((o) => o.requires && !o.supported);
    if (unsupported) {
      sawUnsupported = true;
      assert.match(unsupported.warning, /cannot deliver/);
      session.answer(unsupported.key);
    } else {
      session.answer(opts[0].key);
    }
  }
  assert.ok(sawUnsupported, 'the organiser asked for something this venue cannot provide');
  const r = session.result();
  assert.ok(r.risk > 0, 'over-promising adds delivery risk');

  // And the goodwill it buys is discounted, because the promise is hollow.
  const honest = new Negotiation(ev, g.primaryVenue, g.state);
  while (honest.active) {
    const opts = honest.currentOptions();
    honest.answer((opts.find((o) => o.supported && o.strength > 0) || opts[0]).key);
  }
  assert.ok(honest.result().risk < r.risk, 'answering within your means is safer');
});

test('bid resolution stays deterministic once terms are agreed', () => {
  const run = () => {
    const g = bigGame();
    const ev = pushEvent(g, 'national_final');
    const session = new Negotiation(ev, g.primaryVenue, g.state);
    while (session.active) session.answer(session.currentOptions()[0].key);
    return g.submitBid(ev.uid, bidFor(g, ev, { negotiation: session.result() }));
  };
  const a = run(), b = run();
  assert.equal(a.outcome.won, b.outcome.won);
  assert.equal(a.outcome.roll, b.outcome.roll);
});
