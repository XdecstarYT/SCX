import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUND_Y } from '../src/core/constants.js';
import { VoxelWorld } from '../src/voxel/world.js';
import { blockId } from '../src/data/blocks.js';
import { zoneId } from '../src/data/zones.js';
import {
  createPitchState, pitchFor, tickPitches, playEventOn, inspect, conditionEffect,
  orderTreatment, installUpgrade, drainage, surfaceOf, grade, surfaceKeyFor,
  TREATMENTS, PITCH_UPGRADES,
} from '../src/core/groundskeeping.js';

globalThis.performance ??= { now: () => Date.now() };

const G = GROUND_Y;

function pitchWorld(surface = 'turf') {
  const w = new VoxelWorld(96);
  w.generateTerrain();
  for (let x = 30; x < 70; x++) {
    for (let z = 30; z < 60; z++) w.setBlock(x, G - 1, z, blockId(surface), zoneId('pitch_football'));
  }
  return w;
}
const venue = (over = {}) => ({
  key: 'v1', name: 'Test Ground', sportName: 'Football',
  centre: { x: 50, z: 45 }, field: { y: G - 1, w: 40, d: 30 },
  roofCoverage: 0, ...over,
});
const stateAt = (day = 1) => ({ day, pitches: createPitchState() });

const run = (st, w, days, opts = {}) => {
  let last;
  for (let i = 0; i < days; i++) { st.day++; last = tickPitches(st, [venue(opts.venue)], w, opts); }
  return last;
};

// ------------------------------------------------------------------- basics

test('a surface is read from the blocks it is actually made of', () => {
  assert.equal(surfaceKeyFor(pitchWorld('turf'), venue()), 'turf');
  assert.equal(surfaceKeyFor(pitchWorld('clay'), venue()), 'clay');
  // Synthetic wears far more slowly than grass, which is the whole reason to
  // pay for it.
  assert.ok(surfaceOf('turf_synth').wear < surfaceOf('turf').wear * 0.5);
  assert.ok(surfaceOf('turf_synth').recover > surfaceOf('turf').recover);
});

test('staging events wears a pitch out, and a concert wears it out far faster', () => {
  const w = pitchWorld();
  const match = stateAt();
  const gig = stateAt();
  for (let i = 0; i < 3; i++) {
    playEventOn(match, 'v1', { sport: 'football' }, w, venue());
    playEventOn(gig, 'v1', { sport: 'concert' }, w, venue());
  }
  const a = pitchFor(match, 'v1').condition;
  const b = pitchFor(gig, 'v1').condition;
  assert.ok(a < 1, 'three matches should leave a mark');
  assert.ok(b < a - 0.3, `a concert should hurt far more than a match: ${a} vs ${b}`);
  assert.equal(pitchFor(match, 'v1').eventsSince, 3);
});

test('grass grows back, and grass under a roof does not without lighting', () => {
  const w = pitchWorld();
  const open = stateAt();
  const covered = stateAt();
  const lit = stateAt();
  for (const st of [open, covered, lit]) pitchFor(st, 'v1').condition = 0.4;
  installUpgrade(lit, 'v1', 'growlights');

  run(open, w, 20, { weather: 'sunny' });
  run(covered, w, 20, { weather: 'sunny', venue: { roofCoverage: 0.9 } });
  run(lit, w, 20, { weather: 'sunny', venue: { roofCoverage: 0.9 } });

  const o = pitchFor(open, 'v1').condition;
  const c = pitchFor(covered, 'v1').condition;
  const l = pitchFor(lit, 'v1').condition;
  assert.ok(o > 0.4, 'an open pitch should recover in fine weather');
  assert.ok(c < o, `grass in the dark recovers more slowly: covered ${c} vs open ${o}`);
  assert.ok(l > c, `grow lights are what a covered pitch needs: ${c} -> ${l}`);
});

// ------------------------------------------------------------------ weather

test('rain ruins a pitch that cannot drain, and drainage is what stops it', () => {
  const w = pitchWorld();
  const bare = stateAt();
  const piped = stateAt();
  installUpgrade(piped, 'v1', 'drainage1');
  installUpgrade(piped, 'v1', 'drainage2');

  run(bare, w, 14, { weather: 'storm' });
  run(piped, w, 14, { weather: 'storm' });

  const a = pitchFor(bare, 'v1').condition;
  const b = pitchFor(piped, 'v1').condition;
  assert.ok(a < 0.9, `a fortnight of storms should tell: ${a}`);
  assert.ok(b > a, `drainage should hold the surface together: bare ${a} vs drained ${b}`);
  // Each tier has to earn its own money, not hide behind the one above it.
  const turf = surfaceOf('turf');
  const none = drainage(pitchFor(stateAt(), 'v1'), turf);
  const one = stateAt(); installUpgrade(one, 'v1', 'drainage1');
  const two = stateAt(); installUpgrade(two, 'v1', 'drainage1'); installUpgrade(two, 'v1', 'drainage2');
  const d1 = drainage(pitchFor(one, 'v1'), turf);
  const d2 = drainage(pitchFor(two, 'v1'), turf);
  assert.ok(d1 > none + 0.05, `piped drainage should matter on its own: ${none} -> ${d1}`);
  assert.ok(d2 > d1 + 0.05, `vacuum drainage should matter on top of it: ${d1} -> ${d2}`);
});

test('undersoil heating is what stops frost taking the surface', () => {
  const w = pitchWorld();
  const cold = stateAt();
  const heated = stateAt();
  installUpgrade(heated, 'v1', 'heating');
  run(cold, w, 12, { weather: 'cold' });
  run(heated, w, 12, { weather: 'cold' });
  assert.ok(pitchFor(heated, 'v1').condition > pitchFor(cold, 'v1').condition,
    'a heated pitch should come through a cold snap better');
});

// ---------------------------------------------------------------- treatment

test('ordered work takes the pitch out of use and then puts it right', () => {
  const w = pitchWorld();
  const st = stateAt();
  pitchFor(st, 'v1').condition = 0.3;

  const r = orderTreatment(st, 'v1', 'reseed');
  assert.ok(r.ok);
  assert.equal(orderTreatment(st, 'v1', 'mow').error !== undefined, true,
    'two jobs cannot run on one pitch at once');

  // While it runs the surface cannot be played on at all.
  assert.equal(inspect(st, 'v1', {}).pass, false);
  run(st, w, r.treatment.days, { weather: 'sunny' });
  assert.equal(pitchFor(st, 'v1').work, null, 'the work should finish on its day');
  assert.ok(pitchFor(st, 'v1').condition >= 0.3 + r.treatment.restore - 0.01);
});

test('a relay gives a perfect surface back, whatever state it was in', () => {
  const w = pitchWorld();
  const st = stateAt();
  pitchFor(st, 'v1').condition = 0.05;
  pitchFor(st, 'v1').eventsSince = 40;
  const r = orderTreatment(st, 'v1', 'relay');
  run(st, w, r.treatment.days, { weather: 'storm' });
  const rec = pitchFor(st, 'v1');
  assert.equal(rec.condition, 1);
  assert.equal(rec.eventsSince, 0, 'a new pitch has had nothing played on it');
});

test('every treatment restores something and costs something', () => {
  for (const t of TREATMENTS) {
    assert.ok(t.cost > 0, `${t.id} is free, which cannot be right`);
    assert.ok(t.restore > 0, `${t.id} does nothing`);
    assert.ok(t.days >= 1, `${t.id} takes no time`);
    assert.ok(t.hint && t.hint.length > 20, `${t.id} does not say what it is`);
  }
  // And they are ordered: more time and money buys more surface back.
  const byCost = [...TREATMENTS].sort((a, b) => a.cost - b.cost);
  for (let i = 1; i < byCost.length; i++) {
    assert.ok(byCost[i].restore >= byCost[i - 1].restore,
      `${byCost[i].id} costs more than ${byCost[i - 1].id} and does less`);
  }
});

// --------------------------------------------------------------- inspection

test('a worn pitch fails its inspection, and a good one passes in the rain', () => {
  const st = stateAt();
  pitchFor(st, 'v1').condition = 1;
  assert.equal(inspect(st, 'v1', { weather: 'sunny' }).pass, true);
  assert.equal(inspect(st, 'v1', { weather: 'rain' }).pass, true,
    'a sound pitch plays in the rain');

  pitchFor(st, 'v1').condition = 0.15;
  const bad = inspect(st, 'v1', { weather: 'sunny' });
  assert.equal(bad.pass, false);
  assert.ok(bad.risk > 0.5 && bad.reason, 'a failure should say why');
});

test('a storm on an undrained pitch is a postponement, and drainage answers it', () => {
  const bare = stateAt();
  const drained = stateAt();
  for (const st of [bare, drained]) pitchFor(st, 'v1').condition = 0.8;
  installUpgrade(drained, 'v1', 'drainage1');
  installUpgrade(drained, 'v1', 'drainage2');

  const a = inspect(bare, 'v1', { weather: 'storm' });
  const b = inspect(drained, 'v1', { weather: 'storm' });
  assert.ok(a.risk > b.risk, `drainage should cut the risk: ${a.risk} vs ${b.risk}`);
  assert.ok(b.risk < a.risk * 0.6, 'vacuum drainage should more or less answer a storm');
});

// ------------------------------------------------------------------ effects

test('the condition of the surface changes what the event is worth', () => {
  const perfect = conditionEffect(1);
  const ruined = conditionEffect(0.1);
  assert.ok(perfect.satisfaction > ruined.satisfaction, 'a good pitch is a better afternoon');
  assert.equal(perfect.injuryRisk, 0, 'nobody turns an ankle on a perfect surface');
  assert.ok(ruined.injuryRisk > 0.2, 'a ruined one is dangerous');
  assert.ok(perfect.quality > ruined.quality);
});

test('the grades read like something a groundsman would say', () => {
  assert.equal(grade(1), 'Immaculate');
  assert.equal(grade(0.05), 'Unplayable');
  // And they only ever get worse as the number does.
  const order = ['Immaculate', 'Good', 'Playable', 'Worn', 'Poor', 'Unplayable'];
  let last = -1;
  for (let c = 1; c >= 0; c -= 0.05) {
    const i = order.indexOf(grade(c));
    assert.ok(i >= last, `grade went back up at ${c.toFixed(2)}`);
    last = i;
  }
});

test('installed kit is bought once, in order, and never twice', () => {
  const st = stateAt();
  assert.ok(installUpgrade(st, 'v1', 'drainage2').error, 'vacuum needs pipes under it first');
  assert.ok(installUpgrade(st, 'v1', 'drainage1').ok);
  assert.ok(installUpgrade(st, 'v1', 'drainage1').error, 'you cannot buy it twice');
  assert.ok(installUpgrade(st, 'v1', 'drainage2').ok);

  for (const u of PITCH_UPGRADES) {
    assert.ok(u.cost > 0 && u.hint && u.hint.length > 20, `${u.id} is not described`);
  }
});

test('a demolished venue stops costing money for its drainage', () => {
  const w = pitchWorld();
  const st = stateAt();
  installUpgrade(st, 'v1', 'drainage1');
  const withVenue = tickPitches(st, [venue()], w, {});
  assert.ok(withVenue.upkeep > 0, 'installed kit costs upkeep');

  const gone = tickPitches(st, [], w, {});
  assert.equal(gone.upkeep, 0, 'a pitch that no longer exists should not be billed for');
  assert.deepEqual(st.pitches.byVenue, {}, 'and it should be forgotten');
});
