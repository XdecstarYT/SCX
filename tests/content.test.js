import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_BY_ID, BLOCK_BY_KEY, blockId, block } from '../src/data/blocks.js';
import { ZONE_BY_ID, zoneId, zone, SPORT_ZONES } from '../src/data/zones.js';
import { EVENT_TEMPLATES, BID_PACKAGES, CONTRACT_TERMS } from '../src/data/events.js';
import { NEGOTIATIONS } from '../src/data/negotiations.js';
import { RESEARCH } from '../src/data/research.js';
import { ALL_SPONSORS, sponsorRequirementMet } from '../src/data/sponsors.js';
import { UTILITIES } from '../src/data/utilities.js';
import { ENDGAME_GOALS } from '../src/data/endgame.js';
import { STAFF_ROLES, STAFF_CHANNELS } from '../src/data/staff.js';
import { RANDOM_EVENTS } from '../src/data/randomEvents.js';
import { ACHIEVEMENTS } from '../src/data/achievements.js';
import { VoxelWorld } from '../src/voxel/world.js';
import { detectVenues } from '../src/venues/venueDetection.js';
import { GROUND_Y } from '../src/core/constants.js';

globalThis.performance ??= { now: () => Date.now() };

// The content tables are the main way this game grows, so they get checked
// for the mistakes that are easy to make and annoying to find.

test('every block referenced by a zone, research node or sponsor exists', () => {
  for (const z of SPORT_ZONES) {
    for (const key of z.surfaces) {
      assert.ok(BLOCK_BY_KEY.has(key), `zone ${z.key} names a missing surface "${key}"`);
    }
  }
  for (const r of RESEARCH) {
    for (const key of r.unlocks || []) {
      assert.ok(BLOCK_BY_KEY.has(key), `research ${r.id} unlocks a missing block "${key}"`);
    }
  }
  for (const s of ALL_SPONSORS) {
    if (s.needsBlock) assert.ok(BLOCK_BY_KEY.has(s.needsBlock), `sponsor ${s.id} wants a missing block`);
    if (s.needsZone) assert.ok(zoneId(s.needsZone) > 0, `sponsor ${s.id} wants a missing zone "${s.needsZone}"`);
  }
});

test('every locked block is unlocked by exactly one research project', () => {
  const unlockable = new Set(RESEARCH.flatMap((r) => r.unlocks || []));
  const researchIds = new Set(RESEARCH.map((r) => r.id));
  for (const b of BLOCK_BY_ID) {
    if (!b.unlock) continue;
    assert.ok(researchIds.has(b.unlock), `block ${b.key} names an unknown project "${b.unlock}"`);
    assert.ok(unlockable.has(b.key), `block ${b.key} is locked but no project unlocks it`);
  }
});

test('research prerequisites exist and are not circular', () => {
  const ids = new Set(RESEARCH.map((r) => r.id));
  for (const r of RESEARCH) {
    for (const dep of r.req || []) {
      assert.ok(ids.has(dep), `${r.id} requires unknown project "${dep}"`);
      assert.notEqual(dep, r.id);
      const parent = RESEARCH.find((x) => x.id === dep);
      assert.ok(!(parent.req || []).includes(r.id), `${r.id} and ${dep} require each other`);
      assert.ok(parent.reqRep <= r.reqRep, `${r.id} unlocks before its prerequisite ${dep}`);
    }
  }
});

test('every block auto-zones to a zone that exists', () => {
  for (const b of BLOCK_BY_ID) {
    if (!b.autoZone) continue;
    assert.ok(zoneId(b.autoZone) > 0, `block ${b.key} auto-zones to a missing zone "${b.autoZone}"`);
  }
});

test('every sport zone can produce a real venue', () => {
  for (const sz of SPORT_ZONES) {
    const w = new VoxelWorld(128);
    w.generateTerrain();
    const surface = blockId(sz.surfaces[0]);
    const wide = Math.max(sz.regulation.w, sz.regulation.d);
    const deep = Math.min(sz.regulation.w, sz.regulation.d);
    for (let x = 10; x < 10 + wide; x++) {
      for (let z = 10; z < 10 + deep; z++) w.setBlock(x, GROUND_Y - 1, z, surface, sz.id);
    }
    // A ring of seating so it registers as a venue rather than a training pitch.
    for (let x = 8; x < 12 + wide; x++) {
      w.setBlock(x, GROUND_Y, 8, blockId('seat'), zoneId('seating'));
      w.setBlock(x, GROUND_Y, 12 + deep, blockId('seat'), zoneId('seating'));
    }
    const a = detectVenues(w, { powerCapacity: 100 });
    assert.equal(a.venues.length, 1, `${sz.key} produced ${a.venues.length} venues`);
    const v = a.venues[0];
    assert.equal(v.sport, sz.sport);
    assert.equal(v.field.regulation, 1, `${sz.key} at its stated minimum is not regulation`);
    assert.ok(v.field.surfaceOk, `${sz.key} rejects its own first listed surface`);
    assert.ok(v.type && v.type.length > 3, `${sz.key} has no venue type`);
    assert.ok(!/undefined/.test(v.type), `${sz.key} venue type is "${v.type}"`);
  }
});

test('every event template is bid-able and internally consistent', () => {
  const sports = new Set([...SPORT_ZONES.map((z) => z.sport), 'concert', 'ceremony']);
  const ids = new Set();
  for (const t of EVENT_TEMPLATES) {
    assert.ok(!ids.has(t.id), `duplicate event id ${t.id}`);
    ids.add(t.id);
    assert.ok(sports.has(t.sport), `event ${t.id} names unknown sport "${t.sport}"`);
    assert.ok(t.bid[1] > t.bid[0], `event ${t.id} has an empty bid range`);
    assert.ok(t.days >= 1 && t.days <= 12, `event ${t.id} runs for ${t.days} days`);
    assert.ok(t.popularity > 0 && t.popularity <= 1);
    assert.ok(t.prestige > 0);
    assert.ok(t.blurb && t.blurb.length > 20, `event ${t.id} needs a blurb`);
    assert.ok(t.req.length > 0, `event ${t.id} has no requirements`);
    for (const r of t.req) {
      assert.ok(r.label, `event ${t.id} has an unlabelled requirement`);
      if (r.key === 'field' && r.sport) {
        assert.ok(sports.has(r.sport), `event ${t.id} requires unknown sport surface`);
      }
    }
  }
});

test('higher tiers demand more than lower ones', () => {
  const capOf = (t) => (t.req.find((r) => r.key === 'capacity') || { min: 0 }).min;
  const order = ['local', 'regional', 'national', 'international', 'world'];
  const byTier = {};
  for (const t of EVENT_TEMPLATES) {
    byTier[t.tier] = byTier[t.tier] || [];
    byTier[t.tier].push(capOf(t));
  }
  let previousMax = -1;
  for (const tier of order) {
    if (!byTier[tier]) continue;
    const min = Math.min(...byTier[tier]);
    assert.ok(min >= previousMax * 0.6,
      `${tier} events can be smaller than the tier below (${min} vs ${previousMax})`);
    previousMax = Math.max(...byTier[tier]);
  }
});

test('negotiation options are balanced trade-offs, not free wins', () => {
  for (const n of NEGOTIATIONS) {
    assert.ok(n.options.length >= 3, `${n.id} needs at least three answers`);
    assert.ok(n.demand.length > 25, `${n.id} needs a real demand`);
    const keys = new Set();
    for (const o of n.options) {
      assert.ok(!keys.has(o.key), `${n.id} has duplicate option key ${o.key}`);
      keys.add(o.key);
      assert.ok(o.label && o.desc, `${n.id}/${o.key} needs a label and description`);
      // Anything that buys real goodwill must cost something.
      if (o.strength >= 0.08) {
        const cost = (o.cost || 0) + (o.extraDays || 0) + Math.max(0, -(o.fee || 0))
          + Math.max(0, -(o.revenueShare || 0)) + (o.multiYear ? 0.05 : 0);
        assert.ok(cost > 0, `${n.id}/${o.key} buys ${o.strength} goodwill for nothing`);
      }
    }
    assert.ok(n.options.some((o) => o.strength > 0), `${n.id} has no cooperative answer`);
    assert.ok(n.options.some((o) => o.strength < 0), `${n.id} has no way to hold firm`);
  }
});

test('utility tiers only ever go up, and cost more as they do', () => {
  for (const u of UTILITIES) {
    let lastCap = u.base, lastCost = 0;
    for (const t of u.tiers) {
      assert.ok(t.capacity > lastCap, `${u.key} tier does not increase capacity`);
      assert.ok(t.cost > lastCost, `${u.key} tier is not more expensive`);
      assert.ok(t.upkeep > 0, `${u.key} capacity should carry an upkeep`);
      lastCap = t.capacity; lastCost = t.cost;
    }
  }
});

test('staff, sponsors, random events and achievements are well formed', () => {
  for (const r of STAFF_ROLES) {
    assert.ok(STAFF_CHANNELS.includes(r.channel), `staff ${r.id} uses unknown channel ${r.channel}`);
    assert.ok(r.salary > 0 && r.desc);
  }
  for (const s of ALL_SPONSORS) {
    assert.ok(s.annual > 0 && s.perEvent > 0 && s.years > 0);
    assert.ok(s.bonus && s.bonus.length > 10, `sponsor ${s.id} does not say what it does`);
  }
  for (const e of RANDOM_EVENTS) {
    assert.ok(e.options.length >= 1 && e.body.length > 25, `random event ${e.id} is thin`);
    for (const o of e.options) assert.ok(o.label && (o.result || o.goodResult));
  }
  const ids = new Set();
  for (const a of ACHIEVEMENTS) {
    assert.ok(!ids.has(a.id), `duplicate achievement ${a.id}`);
    ids.add(a.id);
    assert.equal(typeof a.check, 'function');
  }
  for (const g of ENDGAME_GOALS) {
    assert.equal(typeof g.progress, 'function');
    assert.equal(typeof g.detail, 'function');
    assert.ok(['build', 'operate', 'compete'].includes(g.tier));
  }
});

test('bid packages and contract terms all do something', () => {
  for (const p of BID_PACKAGES) {
    assert.ok(p.cost > 0 && p.strength > 0, `package ${p.key} is free goodwill`);
    assert.ok(p.desc.length > 15);
  }
  for (const t of CONTRACT_TERMS) {
    const effect = (t.revenueShare || 0) + (t.multiYear || 0) + (t.sponsorPenalty || 0) + (t.broadcastBonus || 0);
    assert.notEqual(effect, 0, `term ${t.key} has no mechanical effect`);
    assert.notEqual(t.strength, 0, `term ${t.key} does not move the organiser`);
  }
});

test('every endgame goal reads sanely and can actually be completed', async () => {
  const { ENDGAME_GOALS, endgameProgress } = await import('../src/data/endgame.js');
  const { Game } = await import('../src/core/game.js');

  // A brand new game: every goal should read 0-ish and never NaN.
  const fresh = new Game();
  fresh.newGame({ complexName: 'Fresh', seed: 1 });
  for (const g of endgameProgress(fresh.state).goals) {
    assert.ok(Number.isFinite(g.value), `${g.id} reports a non-finite progress on a new game`);
    assert.ok(!/NaN|undefined|Infinity/.test(g.detail), `${g.id} reads "${g.detail}" on a new game`);
  }

  // A complex that has done everything: every goal should be complete. This is
  // what catches a goal reading a field that moved - the Mega Sports District
  // goal read state.landTier long after land moved onto sites, so it sat at
  // NaN forever.
  const done = new Game();
  done.newGame({ complexName: 'Done', seed: 1 });
  const s = done.state;
  Object.assign(s.stats, {
    bestCapacity: 95_000, bestRating: 96, totalAttendance: 2_000_000,
    lifetimeProfit: 500_000_000, bidsWon: 90, bidsPlaced: 100,
    sportsHosted: ['football', 'rugby', 'cricket', 'tennis', 'ice', 'swimming'],
    tiersHosted: ['local', 'regional', 'national', 'international', 'world'],
    ceremonyHosted: true,
  });
  s.reputation.venue = 100;
  s.reputation.community = 100;
  s.reputation.fans = 100;
  s.sites = [
    { id: 'site1', cityId: 'meridian', landTier: 3, utilities: {} },
    { id: 'site2', cityId: 'harbour', landTier: 2, utilities: {} },
    { id: 'site3', cityId: 'summit', landTier: 1, utilities: {} },
  ];
  s.venues.registered = [
    { key: 'a', siteId: 'site1' }, { key: 'b', siteId: 'site1' },
    { key: 'c', siteId: 'site1' }, { key: 'd', siteId: 'site1' },
    { key: 'e', siteId: 'site2' }, { key: 'f', siteId: 'site3' },
  ];
  for (const r of s.rivals) r.reputation = 20;

  const report = endgameProgress(s);
  const incomplete = report.goals.filter((g) => !g.complete);
  assert.deepEqual(incomplete.map((g) => `${g.id} (${g.detail})`), [],
    'a complex that has done everything still has unreachable goals');
  assert.equal(report.complete, ENDGAME_GOALS.length);
});

test('every achievement can be earned', async () => {
  const { ACHIEVEMENTS } = await import('../src/data/achievements.js');
  const { Game } = await import('../src/core/game.js');
  const g = new Game();
  g.newGame({ complexName: 'Done', seed: 1 });
  const s = g.state;
  Object.assign(s.stats, {
    blocksPlaced: 50_000, blocksRemoved: 100, regulationFields: 3, venuesDetected: 4,
    equipmentFitted: 40, fullyFittedVenues: 2, bidsPlaced: 100, bidsWon: 90,
    eventsHosted: 60, sellouts: 12, totalAttendance: 2_000_000,
    lifetimeProfit: 500_000_000, bestCapacity: 95_000, bestRating: 96,
    bestSatisfaction: 97, sportsHosted: ['football', 'rugby', 'cricket'],
    tiersHosted: ['local', 'regional', 'national', 'international', 'world'],
  });
  s.reputation.venue = 100;
  s.sites = [{ id: 'site1', cityId: 'meridian', landTier: 3, utilities: {} },
    { id: 'site2', cityId: 'harbour', landTier: 0, utilities: {} }];
  s.venues.registered = [{ key: 'a', siteId: 'site1' }];
  s.sponsors = [{ id: 'x', naming: true }];

  const unearned = ACHIEVEMENTS.filter((a) => !a.check(s));
  assert.deepEqual(unearned.map((a) => `${a.id}: ${a.desc}`), [],
    'a complex that has done everything still has unearned achievements');
});
