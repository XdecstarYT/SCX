import test from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAMMES, PROGRAMME_BY_ID, PROGRAMME_CATEGORIES, programmeSlots } from '../src/data/programmes.js';
import {
  createProgrammeState, available, activeProgrammes, applyEffect,
  tickProgrammes, effectSummary, timesRun, requirementLines,
} from '../src/core/programmes.js';
import { STAFF_CHANNELS } from '../src/data/staff.js';

globalThis.performance ??= { now: () => Date.now() };

test('every programme is a real commitment with a real result', () => {
  const ids = new Set();
  const cats = new Set(PROGRAMME_CATEGORIES.map((c) => c.key));
  const measures = new Set(['field', 'seating', 'restroom', 'concession', 'concourse',
    'entrance', 'exit', 'stairs', 'security', 'medical', 'locker', 'media', 'broadcast',
    'hospitality', 'parking', 'lighting', 'roof', 'retail', 'fanzone', 'training', 'equipment']);
  const ratings = new Set(['functionality', 'crowdFlow', 'accessibility', 'safety',
    'comfort', 'appearance', 'prestige']);

  for (const p of PROGRAMMES) {
    assert.ok(!ids.has(p.id), `two programmes share the id "${p.id}"`);
    ids.add(p.id);
    assert.ok(cats.has(p.category), `${p.id} is in category "${p.category}"`);
    assert.ok(p.name && p.desc && p.desc.length > 20, `${p.id} does not say what it is`);
    assert.ok(p.detail && p.detail.length > 40, `${p.id} has no argument for itself`);
    assert.ok(p.days >= 20 && p.days <= 90, `${p.id} runs for ${p.days} days`);
    assert.ok(p.cost > 0, `${p.id} is free`);
    assert.ok(p.upkeep > 0, `${p.id} costs nothing while it runs`);
    assert.ok(Object.keys(p.effect || {}).length > 0, `${p.id} leaves nothing behind`);

    for (const k of Object.keys(p.effect.measure || {})) {
      assert.ok(measures.has(k), `${p.id} lifts a measure called "${k}", which does not exist`);
    }
    for (const k of Object.keys(p.effect.rating || {})) {
      assert.ok(ratings.has(k), `${p.id} lifts a rating called "${k}", which does not exist`);
    }
    for (const k of Object.keys(p.effect.staff || {})) {
      assert.ok(STAFF_CHANNELS.includes(k), `${p.id} strengthens a department called "${k}"`);
    }
    for (const r of p.req || []) assert.ok(r.label, `${p.id} has an unlabelled requirement`);

    // The total outlay has to be in proportion to what it leaves behind, or it
    // is either free money or a trap.
    const outlay = p.cost + p.upkeep * p.days;
    assert.ok(outlay > 50_000 && outlay < 1_200_000,
      `${p.id} costs ${outlay} in total, which is out of scale with everything else`);
  }
  assert.ok(PROGRAMMES.length >= 20, `only ${PROGRAMMES.length} programmes`);
  for (const c of PROGRAMME_CATEGORIES) {
    assert.ok(PROGRAMMES.some((p) => p.category === c.key), `nothing to do in "${c.name}"`);
  }
});

test('slots are the scarcity the whole system turns on', () => {
  const small = { reputation: { venue: 5 }, staffBonus: {} };
  const big = { reputation: { venue: 100 }, staffBonus: { management: 0.2 } };
  assert.equal(programmeSlots(small), 1, 'a new complex can run more than one thing at a time');
  assert.ok(programmeSlots(big) > programmeSlots(small), 'growing buys no more capacity to act');
  assert.ok(programmeSlots(big) <= 4, 'a large complex can run everything at once');
});

test('a programme runs, costs money every day, and leaves something behind', () => {
  const state = fakeState();
  const def = PROGRAMME_BY_ID.get('ops_training');
  state.programmes.active.push({ id: def.id, startedDay: state.day, endsDay: state.day + def.days });

  let charged = 0;
  for (let d = 0; d < def.days; d++) {
    state.day++;
    const { finished, upkeep } = tickProgrammes(state);
    charged += upkeep;
    if (d < def.days - 1) assert.equal(finished.length, 0, `it finished early, on day ${d}`);
    else assert.equal(finished.length, 1, 'it never finished');
  }
  assert.equal(charged, def.upkeep * def.days, 'the upkeep was not charged every day');
  assert.equal(state.programmes.active.length, 0, 'it is still running after it finished');
  assert.equal(timesRun(state, def.id), 1);
  assert.ok(state.programmes.effects.staff.operations > 0, 'it left nothing behind');
});

test('effects accumulate, and multipliers cannot run away', () => {
  const e = createProgrammeState().effects;
  for (let i = 0; i < 20; i++) {
    applyEffect(e, { costMult: 0.9, gate: 1.25, spend: 1.14, income: 1_000,
      measure: { restroom: 0.05 }, staff: { operations: 0.05 } });
  }
  assert.ok(e.costMult >= 0.55, `running costs fell to ${e.costMult}, which is free`);
  assert.ok(e.gate <= 3, `gate flow reached ${e.gate}`);
  assert.ok(e.spend <= 2, `spend reached ${e.spend}`);
  assert.equal(e.income, 20_000);
  assert.ok(e.measure.restroom > 0 && e.staff.operations > 0);

  // And an unlock is recorded once, not twenty times.
  applyEffect(e, { unlock: 'relaid' });
  applyEffect(e, { unlock: 'relaid' });
  assert.deepEqual(e.unlocked, ['relaid']);
});

test('a programme you cannot afford, cannot reach, or have already run is not offered', () => {
  const state = fakeState();
  const venue = fakeVenue();
  const rows = available(state, venue);
  assert.equal(rows.length, PROGRAMMES.length, 'the list is not the whole catalogue');

  // Nothing is startable with no money.
  state.cash = 0;
  assert.equal(available(state, venue).every((r) => !r.canStart), true,
    'a complex with no money can start a programme');

  // With money, the ones whose requirements are met are startable.
  state.cash = 50_000_000;
  const open = available(state, venue).filter((r) => r.canStart);
  assert.ok(open.length > 0, 'nothing is ever startable');
  for (const r of open) assert.ok(r.lines.every((l) => l.ok), `${r.def.id} offered with unmet requirements`);

  // A slot taken is a slot gone.
  const first = open[0];
  state.programmes.active.push({ id: first.def.id, startedDay: 1, endsDay: 100 });
  const after = available(state, venue);
  assert.equal(after.find((r) => r.def.id === first.def.id).canStart, false,
    'the same programme can be run twice at once');
  if (programmeSlots(state) === 1) {
    assert.equal(after.every((r) => !r.canStart), true,
      'a complex with one slot, full, can still start things');
  }

  // And a one-shot programme, once done, is done. Not the one already in the
  // slot above, or the reason it is blocked is that it is running.
  const once = PROGRAMMES.find((p) => (p.repeat ?? 1) === 1 && p.id !== first.def.id);
  state.programmes.completed.push({ id: once.id, day: 1 });
  const row = available(state, venue).find((r) => r.def.id === once.id);
  assert.equal(row.canStart, false, `${once.id} can be run twice`);
  assert.match(row.blocked, /once|limit/i);
});

test('requirements are read off the live complex, not stored', () => {
  const venue = fakeVenue({ capacity: 3_000 });
  const small = fakeState();
  const gate = PROGRAMME_BY_ID.get('gate_modernisation');
  let lines = requirementLines(small, gate, venue);
  assert.equal(lines.find((l) => l.key === 'capacity').ok, false,
    'a 3,000-seat ground qualifies for gate modernisation');

  const bigVenue = fakeVenue({ capacity: 40_000 });
  lines = requirementLines(small, gate, bigVenue);
  assert.equal(lines.find((l) => l.key === 'capacity').ok, true,
    'a 40,000-seat ground does not qualify');
  // The figures shown are the real ones, so the screen can say what is missing.
  assert.equal(lines.find((l) => l.key === 'capacity').have, 40_000);
});

test('a complex that has run programmes reads back what they did', () => {
  const state = fakeState();
  applyEffect(state.programmes.effects, PROGRAMME_BY_ID.get('energy_retrofit').effect);
  applyEffect(state.programmes.effects, PROGRAMME_BY_ID.get('season_tickets').effect);
  const lines = effectSummary(state);
  assert.ok(lines.length >= 2, 'nothing is reported back');
  assert.ok(lines.some((l) => /income/i.test(l.label)), 'the income is not mentioned');
  assert.ok(lines.some((l) => /running costs/i.test(l.label)), 'the saving is not mentioned');
  assert.equal(effectSummary(fakeState()).length, 0, 'a complex that has run nothing claims results');
});

test('through a game: a programme is paid for, runs, and changes the venue', async () => {
  const { Game } = await import('../src/core/game.js');
  const { blockId } = await import('../src/data/blocks.js');
  const { zoneId } = await import('../src/data/zones.js');
  const { GROUND_Y } = await import('../src/core/constants.js');

  const g = new Game();
  g.newGame({ complexName: 'Prog', seed: 4 });
  g.notify = () => {};
  const w = g.world, B = blockId, Z = zoneId, GY = GROUND_Y;
  for (let x = 30; x < 84; x++) for (let z = 40; z < 75; z++) w.setBlock(x, GY, z, B('turf'), Z('pitch_football'));
  for (let r = 1; r <= 16; r++) {
    const y = GY + Math.floor(r * 0.7);
    const col = (x, z) => {
      for (let yy = GY; yy < y; yy++) w.setBlock(x, yy, z, B('concrete'), 0);
      w.setBlock(x, y, z, B('seat'), Z('seating'));
    };
    for (let x = 30 - r; x <= 83 + r; x++) { col(x, 39 - r); col(x, 75 + r); }
    for (let z = 40 - r; z < 75 + r; z++) { col(29 - r, z); col(84 + r, z); }
  }
  g.state.cash = 50_000_000;
  g.state.reputation.venue = 70;
  g.markWorldDirty();
  g.analyze(true);

  const before = g.primaryVenue.ratings.crowdFlow;
  const cashBefore = g.state.cash;
  const r = g.startProgramme('crowd_modelling');
  assert.ok(!r.error, r.error);
  assert.ok(g.state.cash < cashBefore, 'the programme was free');
  assert.equal(g.programmes().used, 1);

  // Running it costs money every day, and nothing changes until it finishes.
  g.skipDay(5);
  assert.equal(g.programmes().active[0].daysLeft > 0, true);
  assert.equal(g.primaryVenue.ratings.crowdFlow, before, 'it paid out before it finished');

  g.skipDay(30);
  assert.equal(g.programmes().used, 0, 'it never finished');
  assert.equal(g.state.programmes.completed.length, 1);
  g.analyze(true);
  assert.ok(g.primaryVenue.ratings.crowdFlow > before,
    `the crowd flow study changed nothing (${before} -> ${g.primaryVenue.ratings.crowdFlow})`);
  assert.ok(g.state.staffBonus.security > 0, 'the department it trained is no better at its job');
});

test('an old save gains an empty programme board and nothing else', async () => {
  const { makeSave, migrate, deserializeWorld } = await import('../src/save/serialization.js');
  const { Game } = await import('../src/core/game.js');
  const g = new Game();
  g.newGame({ complexName: 'Old', seed: 2 });
  const blob = JSON.parse(JSON.stringify(makeSave(g.state, g.world)));
  delete blob.state.programmes;

  const back = migrate(blob);
  assert.ok(back.state.programmes, 'the save did not gain a programme board');
  assert.deepEqual(back.state.programmes.active, []);
  assert.deepEqual(back.state.programmes.completed, []);
  assert.equal(back.state.programmes.effects.costMult, 1, 'an old save was given a discount');

  const g2 = new Game();
  g2.adopt(back.state, deserializeWorld(back.world));
  assert.equal(g2.programmes().used, 0);
  assert.deepEqual(g2.programmes().effects, []);
});

function fakeState(over = {}) {
  return {
    day: 100, cash: 5_000_000,
    reputation: { venue: 60, fans: 60, community: 60, organiser: 60, athletes: 60 },
    staffBonus: Object.fromEntries(STAFF_CHANNELS.map((c) => [c, 0])),
    stats: { eventsHosted: 12 },
    league: { tenants: [{ clubId: 'fc_meridian' }] },
    programmes: createProgrammeState(),
    ...over,
  };
}

function fakeVenue(over = {}) {
  return {
    capacity: { total: over.capacity ?? 20_000 },
    ratings: {
      overall: over.overall ?? 60,
      measures: {
        concession: 0.6, hospitality: 0.4, retail: 0.4, training: 0.4,
        medical: 0.5, locker: 0.5, entrance: 0.5,
        ...(over.measures || {}),
      },
    },
  };
}
