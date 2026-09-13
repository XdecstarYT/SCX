import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TEMPLATES } from '../src/data/events.js';
import { EVENT_ANGLES, ANGLE_BY_ID, anglesForBase, eligibleAngles, catalogueSize } from '../src/data/eventAngles.js';
import { compose, mergeRequirements, everyComposition, pickAngle } from '../src/events/eventComposer.js';
import { SPORT_ZONES } from '../src/data/zones.js';
import { makeRng } from '../src/core/rng.js';

globalThis.performance ??= { now: () => Date.now() };

// --------------------------------------------------------------- the catalogue

test('the board draws from far more than three events a sport', () => {
  // The whole point of the angle system. Before it, most sports had exactly
  // three events and you had seen the sport once you had seen them.
  const bySport = {};
  for (const b of EVENT_TEMPLATES) {
    bySport[b.sport] = (bySport[b.sport] || 0) + anglesForBase(b).length;
  }
  for (const [sport, n] of Object.entries(bySport)) {
    // A ceremony is genuinely one occasion, so it is allowed to be thin.
    const floor = sport === 'ceremony' ? 12 : 60;
    assert.ok(n >= floor, `${sport} can only ever produce ${n} distinct events`);
  }
  assert.ok(catalogueSize(EVENT_TEMPLATES) >= 1200,
    `the whole catalogue is only ${catalogueSize(EVENT_TEMPLATES)} events`);
});

test('every angle is well formed and does something', () => {
  const ids = new Set();
  const TIERS = ['local', 'regional', 'national', 'international', 'world'];
  for (const a of EVENT_ANGLES) {
    assert.ok(!ids.has(a.id), `two angles share the id "${a.id}"`);
    ids.add(a.id);
    assert.ok(typeof a.name === 'function', `${a.id} has no name`);
    assert.ok(typeof a.blurb === 'function', `${a.id} has no blurb`);
    assert.ok(a.weight > 0, `${a.id} can never be picked`);
    for (const t of a.tiers || []) assert.ok(TIERS.includes(t), `${a.id} names tier "${t}"`);
    for (const r of a.req || []) assert.ok(r.label, `${a.id} adds an unlabelled requirement`);

    // An angle that changes nothing is noise on the board.
    const changes = Object.keys(a.mult || {}).length > 0
      || (a.req || []).length > 0 || a.days || a.lead;
    assert.ok(a.id === 'plain' || changes, `${a.id} renames an event and changes nothing else`);

    // Multipliers are multipliers, not replacements.
    for (const [k, v] of Object.entries(a.mult || {})) {
      // Community standing is a small integer, so a community angle
      // legitimately multiplies it several times over; nothing needs more.
      assert.ok(typeof v === 'number' && v >= 0 && v <= 5,
        `${a.id} scales ${k} by ${v}, which is not a multiplier`);
    }
  }
  assert.ok(ANGLE_BY_ID.get('plain'), 'there is no unmarked case');
});

test('every composition obeys the rules an authored event obeys', () => {
  // Composed events go down exactly the same path as authored ones, so they
  // have to survive exactly the same sweep.
  const sports = new Set([...SPORT_ZONES.map((z) => z.sport), 'concert', 'ceremony']);
  const all = everyComposition(EVENT_TEMPLATES);
  assert.ok(all.length > 1200, `only ${all.length} compositions`);

  const seen = new Set();
  for (const t of all) {
    assert.ok(!seen.has(t.id), `two compositions share the id ${t.id}`);
    seen.add(t.id);
    assert.ok(sports.has(t.sport), `${t.id} names unknown sport "${t.sport}"`);
    assert.ok(t.name && t.name.length > 3, `${t.id} has no name`);
    assert.ok(t.blurb && t.blurb.length > 20, `${t.id} has no blurb`);
    assert.ok(t.bid[1] > t.bid[0], `${t.id} has an empty bid range`);
    assert.ok(t.days >= 1 && t.days <= 12, `${t.id} runs for ${t.days} days`);
    assert.ok(t.popularity > 0 && t.popularity <= 1.25, `${t.id} has popularity ${t.popularity}`);
    assert.ok(t.prestige > 0, `${t.id} is worth no prestige`);
    assert.ok(t.risk >= 0 && t.risk < 0.9, `${t.id} has risk ${t.risk}`);
    assert.ok(t.base >= 0, `${t.id} has a negative ticket price`);
    assert.ok(t.fee >= 0, `${t.id} pays a negative fee`);
    assert.ok(t.req.length > 0, `${t.id} has no requirements`);
    for (const r of t.req) assert.ok(r.label, `${t.id} has an unlabelled requirement`);
  }
});

test('a requirement asked for twice is one line, at the stricter figure', () => {
  // Two angles both wanting Medical should not leave the player reading the
  // same line twice, nor quietly drop the stricter of the two.
  const merged = mergeRequirements(
    [{ key: 'measure', measure: 'medical', min: 0.4, label: 'Medical' },
      { key: 'capacity', min: 5_000, label: 'Capacity 5,000+' }],
    [{ key: 'measure', measure: 'medical', min: 0.7, label: 'Medical' },
      { key: 'measure', measure: 'security', min: 0.5, label: 'Security' }],
  );
  const medical = merged.filter((r) => r.measure === 'medical');
  assert.equal(medical.length, 1, 'Medical was asked for twice');
  assert.equal(medical[0].min, 0.7, 'the looser requirement won');
  assert.equal(merged.length, 3);

  // And a real composition never repeats a line either.
  for (const t of everyComposition(EVENT_TEMPLATES)) {
    const keys = t.req.map((r) => (r.key === 'measure' ? `m:${r.measure}` : r.key));
    assert.equal(new Set(keys).size, keys.length, `${t.id} lists a requirement twice`);
  }
});

test('composing never writes back into the shared template table', () => {
  // The base templates are module data. A composition that mutated one would
  // leak into every other game in the process, which is exactly what a second
  // tab and a test suite both are.
  const before = JSON.stringify(EVENT_TEMPLATES);
  const all = everyComposition(EVENT_TEMPLATES);
  for (const t of all) { t.name = 'x'; t.req.push({ key: 'capacity', min: 1, label: 'x' }); }
  assert.equal(JSON.stringify(EVENT_TEMPLATES), before,
    'composing an event changed the template it was composed from');
});

// ------------------------------------------------------------- the dynamic half

test('the board reflects the save, not just the catalogue', () => {
  const base = EVENT_TEMPLATES.find((t) => t.sport === 'football' && t.tier === 'national');
  const blank = {
    day: 5, weather: 'sunny', reputation: { venue: 40, fans: 40, community: 50 },
    stats: { eventsHosted: 0 }, organiserHistory: {}, rivals: [],
    league: { startedDay: 1, tenants: [] }, events: { history: [] },
  };

  const idsOf = (s) => new Set(eligibleAngles(s, base).map((a) => a.id));
  const early = idsOf(blank);
  assert.ok(early.has('plain'), 'the unmarked case is never available');
  assert.ok(!early.has('decider'), 'a title decider was offered on day five of the season');
  assert.ok(!early.has('testimonial'), 'a testimonial was offered with no resident club');
  assert.ok(!early.has('anniversary'), 'a centenary was offered to a ground with no history');

  // Late in a season, with a tenant, a title decider is on.
  const late = { ...blank, day: 200, league: { startedDay: 1, tenants: [{ clubId: 'fc_meridian' }] } };
  const lateIds = idsOf(late);
  assert.ok(lateIds.has('decider'), 'no title decider late in the season');
  assert.ok(lateIds.has('testimonial'), 'no testimonial with a resident club');

  // Weather opens and closes its own angles.
  const storm = { ...blank, weather: 'storm' };
  assert.ok(idsOf(storm).has('wetweather'), 'a storm does not change what is offered');
  assert.ok(!idsOf(blank).has('wetweather'), 'a weather angle was offered in the sun');
  const heat = { ...blank, weather: 'heat' };
  assert.ok(idsOf(heat).has('heatwave'), 'a heatwave does not change what is offered');

  // A ground with a history is offered things a new one is not.
  const old = { ...blank, stats: { eventsHosted: 60 } };
  assert.ok(idsOf(old).has('anniversary'), 'an established ground is offered no centenary');
  assert.ok(!idsOf(old).has('testevent'), 'a test event was offered to an established ground');
  assert.ok(idsOf(blank).has('testevent') === false || base.tier === 'local',
    'a test event was offered above local tier');
});

test('an organiser you have worked with comes back', () => {
  const base = EVENT_TEMPLATES.find((t) => t.tier === 'regional');
  const cold = {
    day: 50, weather: 'sunny', reputation: { venue: 40, fans: 40, community: 50 },
    stats: { eventsHosted: 10 }, organiserHistory: {}, rivals: [],
    league: { startedDay: 1, tenants: [] }, events: { history: [] },
  };
  assert.ok(!eligibleAngles(cold, base).some((a) => a.id === 'returnleg'),
    'a return fixture was offered by an organiser you have never met');

  const warm = { ...cold, organiserHistory: { [base.organiser]: 3 } };
  assert.ok(eligibleAngles(warm, base).some((a) => a.id === 'returnleg'),
    'an organiser you have worked with three times never comes back');

  // And the return is cheaper to win than the first one was.
  const plain = compose(base, ANGLE_BY_ID.get('plain'));
  const ret = compose(base, ANGLE_BY_ID.get('returnleg'));
  assert.ok(ret.bid[1] < plain.bid[1], 'a return fixture costs more to win, not less');
  assert.ok(ret.fee > plain.fee, 'a return fixture pays no better than a cold call');
});

test('the unmarked case stays the most common thing on the board', () => {
  // A board where every fixture is a derby is a board where none of them is.
  const base = EVENT_TEMPLATES.find((t) => t.sport === 'football' && t.tier === 'regional');
  const state = {
    day: 200, weather: 'rain', reputation: { venue: 70, fans: 70, community: 70 },
    stats: { eventsHosted: 40 }, organiserHistory: { [base.organiser]: 4 },
    rivals: [{ reputation: 70 }],
    league: { startedDay: 1, tenants: [{ clubId: 'fc_meridian' }] },
    events: { history: [] },
  };
  const tally = {};
  const rng = makeRng(99);
  for (let i = 0; i < 4000; i++) {
    const a = pickAngle(state, base, rng);
    tally[a.id] = (tally[a.id] || 0) + 1;
  }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  assert.equal(top[0], 'plain', `"${top[0]}" is more common than an ordinary fixture`);
  assert.ok(tally.plain / 4000 < 0.45,
    'the ordinary fixture crowds everything else off the board');
  assert.ok(Object.keys(tally).length >= 12,
    `only ${Object.keys(tally).length} angles ever came up`);
});

test('a played game is offered a varied board, and every offer is coherent', async () => {
  const { Game } = await import('../src/core/game.js');
  const { generateEvent } = await import('../src/events/eventGenerator.js');
  const g = new Game();
  g.newGame({ complexName: 'Varied', seed: 21 });
  g.notify = () => {};
  g.state.reputation.venue = 60;
  g.state.venues.registered = [{ key: 'a', sport: 'football', siteId: 'site1' }];

  const names = new Set();
  const angles = new Set();
  for (let day = 1; day <= 500; day++) {
    g.state.day = day;
    g.state.weather = ['sunny', 'rain', 'heat', 'storm', 'cloudy'][day % 5];
    for (let k = 0; k < 2; k++) {
      const ev = generateEvent(g.state, k);
      if (!ev) continue;
      names.add(ev.name);
      angles.add(ev.angleId);
      // Whatever came out has to be a real offer.
      assert.ok(ev.name && ev.blurb, `an event came out nameless: ${ev.templateId}`);
      assert.ok(ev.bidRange[1] >= ev.bidRange[0], `${ev.name} has an inverted bid range`);
      assert.ok(ev.eventDay > ev.postedDay, `${ev.name} happens before it is offered`);
      assert.ok(ev.bidDeadline <= ev.eventDay, `${ev.name} takes bids after it is played`);
      assert.ok(ev.days >= 1, `${ev.name} lasts no days`);
      assert.ok(Number.isFinite(ev.estRevenue), `${ev.name} has no revenue estimate`);
    }
  }
  assert.ok(names.size > 200, `only ${names.size} distinct events over 500 days`);
  assert.ok(angles.size >= 18, `only ${angles.size} different angles ever appeared`);
});
