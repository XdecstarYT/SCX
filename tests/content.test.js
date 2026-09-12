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

// ------------------------------------------------------------- the ending
//
// Thirteen long-term goals are the closest thing this game has to an ending.
// Until now they were only ever read: a progress bar moved and nothing told
// you when one filled. A goal that takes hundreds of days and then says
// nothing is not an ending.

test('completing a goal is recorded and announced exactly once', async () => {
  const { Game } = await import('../src/core/game.js');
  const { createState } = await import('../src/core/gameState.js');
  const g = new Game();
  g.adopt(createState({ seed: 5, complexName: 'Riverside' }), new VoxelWorld(128));
  const said = [];
  g.notify = (kind, title) => { if (kind === 'goal') said.push(title); };

  assert.deepEqual(g.state.goalsDone, [], 'a new game has completed nothing');
  g.state.reputation.venue = 100;                 // Untouchable Reputation
  g.checkGoals();
  assert.ok(g.state.goalsDone.includes('reputation'), 'the finished goal was not recorded');
  assert.equal(said.filter((t) => t === 'Untouchable Reputation').length, 1);

  // Checking again says nothing more, and a goal does not un-complete.
  g.checkGoals();
  assert.equal(said.filter((t) => t === 'Untouchable Reputation').length, 1,
    'the same goal was announced twice');
  g.state.reputation.venue = 20;
  g.checkGoals();
  assert.ok(g.state.goalsDone.includes('reputation'),
    'a goal that was completed should stay completed');
});

test('finishing every goal ends the game with a legacy read off the save', async () => {
  const { Game } = await import('../src/core/game.js');
  const { createState } = await import('../src/core/gameState.js');
  const { ENDGAME_GOALS: GOALS } = await import('../src/data/endgame.js');
  const g = new Game();
  g.adopt(createState({ seed: 6, complexName: 'Meridian Park' }), new VoxelWorld(128));
  g.notify = () => {};
  let legacy = null;
  let fired = 0;
  g.bus.on('legacy', (l) => { legacy = l; fired++; });

  // Short of the full set, nothing happens.
  g.state.goalsDone = GOALS.slice(1).map((x) => x.id);
  g.checkGoals();
  assert.equal(fired, 0, 'the finale fired before every goal was complete');

  // Complete them all outright.
  const s = g.state;
  s.stats.bestCapacity = 95_000;
  s.stats.bestRating = 96;
  s.stats.sportsHosted = ['football', 'rugby', 'cricket', 'tennis', 'ice', 'combat'];
  s.stats.totalAttendance = 1_200_000;
  s.stats.lifetimeProfit = 300_000_000;
  s.stats.tiersHosted = ['local', 'world'];
  s.stats.ceremonyHosted = true;
  s.stats.bidsWon = 42;
  s.stats.blocksPlaced = 812_345;
  s.stats.eventsHosted = 61;
  s.reputation = { venue: 100, fans: 95, athletes: 90, organiser: 90, community: 92 };
  for (const r of g.state.rivals) r.reputation = 50;
  s.sites = ['site1', 'site2', 'site3'].map((id, i) => ({
    id, name: id, cityId: ['meridian', 'kestrel_bay', 'ardenne'][i],
    landTier: 3, boughtDay: 1, utilities: {},
  }));
  s.venues.registered = [
    ...Array.from({ length: 4 }, (_, i) => ({ key: `site1:football:${i}:0`, name: `Ground ${i}`, sport: 'football', siteId: 'site1' })),
    { key: 'site2:rugby:0:0', name: 'Two', sport: 'rugby', siteId: 'site2' },
    { key: 'site3:cricket:0:0', name: 'Three', sport: 'cricket', siteId: 'site3' },
  ];
  s.goalsDone = [];
  g.checkGoals();

  assert.equal(fired, 1, 'the finale did not fire on the last goal');
  assert.equal(g.state.goalsDone.length, GOALS.length, 'not every goal was recorded');
  assert.ok(legacy, 'no legacy summary was produced');
  assert.equal(legacy.complexName, 'Meridian Park');
  assert.equal(legacy.cities, 3, 'the legacy miscounted cities');
  assert.equal(legacy.events, 61);
  assert.equal(legacy.blocks, 812_345);
  assert.equal(legacy.attendance, 1_200_000);

  // And it is shown once, not on every tick for the rest of the game.
  g.checkGoals();
  assert.equal(fired, 1, 'the finale fired again after being shown');
});

test('a save from before goal tracking loads without losing anything', async () => {
  const { migrate } = await import('../src/save/serialization.js');
  const save = { state: { day: 40, achievements: ['first_event'] } };
  const s = migrate(save).state ?? migrate(save);
  const st = s.state || s;
  assert.deepEqual(st.goalsDone, [], 'goal tracking should start empty on an old save');
  assert.equal(st.legacyShown, false);
  assert.deepEqual(st.achievements, ['first_event'], 'the old save lost its achievements');
});

// ------------------------------------------------- two bugs the ending found
//
// Neither of these showed up as an error. Both simply meant something the
// player built counted for nothing, which is the worst kind: you pay for it,
// you can see it standing there, and the rating does not move.

test('a roof over the stands counts as cover', () => {
  const G = GROUND_Y;
  const build = (roofY) => {
    const w = new VoxelWorld(96);
    w.generateTerrain();
    for (let x = 30; x < 84; x++) {
      for (let z = 30; z < 65; z++) w.setBlock(x, G - 1, z, blockId('turf'), zoneId('pitch_football'));
    }
    for (let x = 26; x < 88; x++) {
      for (const z of [26, 27, 67, 68]) w.setBlock(x, G, z, blockId('seat'), zoneId('seating'));
    }
    if (roofY) {
      for (let x = 26; x < 88; x++) {
        for (const z of [26, 27, 67, 68]) w.setBlock(x, roofY, z, blockId('roof_stadium'));
      }
    }
    return detectVenues(w, { complexName: 'R' }).venues[0];
  };

  assert.equal(build(0).seatRoofCoverage, 0, 'open stands should not read as covered');
  // Coverage used to be measured upward from the top of the column, so a
  // canopy - which is itself the top of the column - looked for a roof above
  // the roof, found nothing, and reported every covered seat as open air.
  assert.equal(build(GROUND_Y + 6).seatRoofCoverage, 1, 'a canopy over the stands is cover');
  assert.equal(build(GROUND_Y + 1).seatRoofCoverage, 1, 'a low canopy is cover too');
  // And it has to actually move the rating, or roofing is decoration.
  assert.ok(build(GROUND_Y + 6).ratings.comfort > build(0).ratings.comfort,
    'roofing the stands did not improve spectator comfort');
});

test('a facility counts for the venue that reaches it, not the one that is nearest', () => {
  // A media centre built for a stadium, standing a step closer to the small
  // arena next door but outside that arena's reach, used to count for neither:
  // the nearest venue was chosen first and only then tested for reach. Putting
  // a second ground on your plot silently cost the first one its rating.
  const G = GROUND_Y;
  const stadium = (w) => {
    for (let x = 60; x < 114; x++) {
      for (let z = 40; z < 75; z++) w.setBlock(x, G - 1, z, blockId('turf'), zoneId('pitch_football'));
    }
    for (let x = 54; x < 120; x++) {
      for (let z = 32; z < 40; z++) w.setBlock(x, G, z, blockId('seat'), zoneId('seating'));
    }
  };
  // Out at the edge of the site: 81 voxels from the stadium centre, well
  // inside its reach, and 56 from the court's - which is outside the court's.
  const media = (w) => {
    for (let x = 2; x < 12; x++) {
      for (let z = 66; z < 76; z++) w.setBlock(x, G - 1, z, blockId('tile'), zoneId('media'));
    }
  };

  const alone = new VoxelWorld(160);
  alone.generateTerrain();
  stadium(alone);
  media(alone);
  const before = detectVenues(alone, { complexName: 'A' }).venues
    .find((v) => v.sport === 'football');
  assert.ok(before.facilities.media > 0, 'the stadium never had its own media centre');

  // Now drop a small court right next to that media centre.
  const shared = new VoxelWorld(160);
  shared.generateTerrain();
  stadium(shared);
  media(shared);
  for (let x = 30; x < 45; x++) {
    for (let z = 20; z < 28; z++) shared.setBlock(x, G - 1, z, blockId('hardwood'), zoneId('court_basketball'));
  }
  const court = detectVenues(shared, { complexName: 'A' }).venues
    .find((v) => v.sport === 'basketball');
  assert.ok(court, 'the probe did not produce a second venue');
  const d = Math.hypot(7 - court.centre.x, 71 - court.centre.z);
  assert.ok(d > court.reach,
    `the probe is not testing the right case: the media centre is ${d.toFixed(0)} away `
    + `and the court reaches ${court.reach.toFixed(0)}`);
  const after = detectVenues(shared, { complexName: 'A' }).venues
    .find((v) => v.sport === 'football');
  assert.equal(after.facilities.media, before.facilities.media,
    'building a court nearby took the stadium\'s media centre away from it');
});
