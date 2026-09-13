import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReferenceStadium, fillBox } from './helpers/buildStadium.js';
import { Game } from '../src/core/game.js';
import { createState } from '../src/core/gameState.js';
import { monthlyFinance, fmtMoney, MAINTENANCE_RATE } from '../src/core/economy.js';
import { detectVenues } from '../src/venues/venueDetection.js';
import { REQUIREMENTS } from '../src/venues/ratings.js';
import { checkRequirements } from '../src/events/eventRequirements.js';
import { instantiate, visibleTiers } from '../src/events/eventGenerator.js';
import { EVENT_TEMPLATES } from '../src/data/events.js';
import { makeRng, hashString } from '../src/core/rng.js';
import { rleEncode, rleDecode, makeSave, deserializeWorld, migrate } from '../src/save/serialization.js';
import { VoxelWorld } from '../src/voxel/world.js';
import { blockId } from '../src/data/blocks.js';

globalThis.performance ??= { now: () => Date.now() };
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');

function gameWithStadium() {
  const g = new Game();
  g.adopt(createState({ seed: 7, complexName: 'Riverside' }), buildReferenceStadium());
  return g;
}

// ----------------------------------------------------------------- economy

test('a 10k-seat ground has meaningful but survivable running costs', () => {
  const g = gameWithStadium();
  const f = monthlyFinance(g.state, g.analysis);
  assert.ok(f.totalExpense > 40_000, `too cheap: ${fmtMoney(f.totalExpense)}`);
  assert.ok(f.totalExpense < 260_000, `too punishing: ${fmtMoney(f.totalExpense)}`);
  // Cash on hand should buy well over a year of runway with no events.
  const months = g.state.cash / f.totalExpense;
  assert.ok(months > 12, `only ${months.toFixed(1)} months of runway`);
});

test('running a deficit costs reputation but does not end the game', () => {
  const g = gameWithStadium();
  g.state.cash = -50_000;
  const rep = g.state.reputation.venue;
  g.skipDay(5);
  assert.ok(g.state.reputation.venue < rep);
  assert.ok(g.state.day > 1, 'the game keeps running');
});

test('one event comfortably outweighs a month of upkeep', () => {
  const g = gameWithStadium();
  g.registerVenue(g.primaryVenue.key, 'Riverside Stadium');
  g.analyze(true);
  const ev = instantiate(EVENT_TEMPLATES.find((t) => t.id === 'regional_final'), g.state, makeRng(4));
  ev.status = 'open';
  ev.bidDeadline = g.state.day + 6;
  ev.eventDay = g.state.day + 8;
  g.state.events.board.push(ev);

  const bid = { amount: ev.bidRange[0], packages: [], terms: [], pricing: 'standard', venueKey: g.primaryVenue.key };
  const projection = g.previewBid(ev.uid, bid).projection;
  const monthly = monthlyFinance(g.state, g.analysis).totalExpense;
  assert.ok(projection.profit > monthly, `event profit ${fmtMoney(projection.profit)} vs upkeep ${fmtMoney(monthly)}`);
});

// ------------------------------------------------------------- progression

test('event tiers unlock with reputation, always showing one to aim at', () => {
  assert.deepEqual(visibleTiers(0), ['local', 'regional']);
  assert.ok(visibleTiers(50).includes('national'));
  assert.ok(visibleTiers(50).includes('international'), 'the next tier up stays visible');
  assert.ok(!visibleTiers(50).includes('world'));
});

test('a bigger venue unlocks requirements a small one fails', () => {
  const g = gameWithStadium();
  const small = g.primaryVenue;
  const state = g.state;
  state.reputation.venue = 80;
  const national = instantiate(EVENT_TEMPLATES.find((t) => t.id === 'national_final'), state, makeRng(2));

  const before = checkRequirements(national, small, state);
  assert.ok(before.blocking > 0, 'a 10k ground should not qualify for a national final');
  const capLine = before.lines.find((l) => /Capacity/.test(l.label));
  assert.equal(capLine.ok, false);
  const measuresBefore = { ...small.ratings.measures };

  // Double the seating and the capacity requirement should clear.
  const world = g.world;
  for (let r = 0; r < 8; r++) {
    const y = 16 + r, x0 = 24 - r, x1 = 105 + r, z0 = 32 - r, z1 = 94 + r;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const band = x <= x0 + 2 || x >= x1 - 2 || z <= z0 + 2 || z >= z1 - 2;
      if (band) {
        for (let yy = 12; yy < y; yy++) world.setBlock(x, yy, z, blockId('concrete'));
        world.setBlock(x, y, z, blockId('seat'));
      }
    }
  }
  g.markWorldDirty();
  g.analyze(true);
  const after = checkRequirements(national, g.primaryVenue, state);
  const capAfter = after.lines.find((l) => /Capacity/.test(l.label));
  assert.equal(capAfter.ok, true, `capacity is now ${g.primaryVenue.capacity.total}`);

  // ...but seats alone are not enough. Provision is measured *per spectator*,
  // so a five-fold capacity jump with no new restrooms, exits or parking must
  // strain requirements that previously passed.
  const failedBefore = new Set(before.lines.filter((l) => !l.ok).map((l) => l.label));
  const newlyFailing = after.lines.filter((l) => !l.ok && !failedBefore.has(l.label));
  assert.ok(newlyFailing.length > 0,
    `growing capacity should strain provision; nothing new failed (${after.lines.filter((l) => !l.ok).map((l) => l.label)})`);

  const v = g.primaryVenue;
  for (const key of ['restroom', 'concession', 'exit', 'parking']) {
    assert.ok(v.ratings.measures[key] < measuresBefore[key],
      `${key} provision per spectator should have fallen`);
  }
  assert.ok(v.ratings.issues.some((i) => /exits|concourse|parking/i.test(i.text)),
    'and the venue report should say what to build next');
});

// ------------------------------------------------------------------- saves

test('run-length encoding round-trips chunk data', () => {
  const arr = new Uint8Array(16 * 64 * 16);
  arr.fill(7, 100, 5000);
  arr.fill(3, 5000, 5010);
  const back = rleDecode(rleEncode(arr), arr.length);
  assert.deepEqual(Array.from(back), Array.from(arr));
});

test('a save round-trips the world, the venue and the money', () => {
  const g = gameWithStadium();
  g.registerVenue(g.primaryVenue.key, 'Riverside Stadium');
  g.skipDay(4);
  const before = {
    cap: g.primaryVenue.capacity.total,
    rating: g.primaryVenue.ratings.overall,
    cash: Math.round(g.state.cash),
    day: g.state.day,
  };

  const json = JSON.stringify(makeSave(g.state, g.world));
  assert.ok(json.length < 400_000, `save is ${(json.length / 1024).toFixed(0)}KB`);

  const parsed = migrate(JSON.parse(json));
  const g2 = new Game();
  g2.adopt(parsed.state, deserializeWorld(parsed.world));
  assert.equal(g2.primaryVenue.capacity.total, before.cap);
  assert.equal(g2.primaryVenue.ratings.overall, before.rating);
  assert.equal(Math.round(g2.state.cash), before.cash);
  assert.equal(g2.state.day, before.day);
  assert.equal(g2.state.venues.registered.length, 1);
  assert.equal(g2.primaryVenue.registered, true);
});

test('an empty world produces no venues and no crash', () => {
  const w = new VoxelWorld(64);
  w.generateTerrain();
  const a = detectVenues(w, {});
  assert.equal(a.venues.length, 0);
  assert.equal(a.complex.parkingCars, 0);
});

// ---------------------------------------------------------------- feedback

test('design feedback is specific and actionable, never generic', () => {
  const w = buildReferenceStadium();
  const good = detectVenues(w, {}).venues[0];
  assert.ok(good.ratings.strengths.length > 0);
  assert.ok(good.ratings.issues.every((i) => i.text.length > 20 && /[a-z]/.test(i.text)));

  // Strip the restrooms out and the feedback should call that out by name.
  const bare = new VoxelWorld(128);
  bare.generateTerrain();
  fillBox(bare, 38, 7, 46, 91, 7, 80, 'turf', 'pitch_football');
  fillBox(bare, 30, 8, 40, 100, 8, 42, 'seat', 'seating');
  const v = detectVenues(bare, {}).venues[0];
  const texts = v.ratings.issues.map((i) => i.text).join(' | ');
  assert.match(texts, /restroom/i);
  assert.match(texts, /entrance|exit/i);
  assert.match(texts, /locker|athlete/i);
});

test('recommended provision scales with capacity', () => {
  assert.ok(REQUIREMENTS.restroomVoxels(50_000) > REQUIREMENTS.restroomVoxels(5_000));
  assert.ok(REQUIREMENTS.parkingCars(40_000, 0) > REQUIREMENTS.parkingCars(40_000, 0.4));
});

// ------------------------------------------------------------------- power

test('a power deficit is a real problem, not just a label', async () => {
  const { simulateEvent } = await import('../src/events/eventSimulation.js');
  const g = gameWithStadium();
  g.registerVenue(g.primaryVenue.key, 'Riverside Stadium');
  g.analyze(true);
  assert.equal(g.state.powerDeficit, 0, 'the reference stadium is within capacity');

  // Flood the site with floodlights until demand outstrips the grid.
  const { blockId: bid } = await import('../src/data/blocks.js');
  for (let x = 4; x < 34; x++) for (let z = 100; z < 112; z++) g.world.setBlock(x, 8, z, bid('floodlight'));
  g.markWorldDirty();
  g.analyze(true);
  assert.ok(g.state.powerDeficit > 0, `deficit is ${g.state.powerDeficit}`);

  const v = g.primaryVenue;
  assert.ok(v.ratings.issues.some((i) => i.key === 'utility_power'), 'the venue report flags it');

  // Over many rolls, an overloaded site should produce power incidents.
  const ev = instantiate(EVENT_TEMPLATES.find((t) => t.id === 'regional_final'), g.state, makeRng(6));
  let hits = 0;
  for (let i = 0; i < 20; i++) {
    const r = simulateEvent({ ...ev, seed: 1000 + i }, v, g.state,
      { amount: 0, packages: [], terms: [], pricing: 'standard' });
    if (r.incidents.some((x) => x.key === 'power')) hits++;
  }
  assert.ok(hits > 5, `only ${hits}/20 events hit a power failure`);
});

// --------------------------------------------------------------- utilities

test('utility demand is read out of what the player built', async () => {
  const { buildNationalComplex } = await import('./helpers/buildStadium.js');
  const g = new Game();
  g.adopt(createState({ seed: 3 }), buildNationalComplex());
  g.analyze(true);

  const u = g.state.utilityStatus;
  // A 60,000-seat complex with full facilities should need real infrastructure
  // on every network, not just power.
  for (const key of ['power', 'water', 'sewer', 'data', 'climate']) {
    assert.ok(u[key].demand > 0, `${key} has no demand`);
    assert.ok(u[key].deficit > 0, `${key} should outgrow the starting connection`);
  }
  assert.ok(u.water.demand < 12, `water demand ${u.water.demand} is out of scale`);
  assert.ok(u.data.demand < 200, `data demand ${u.data.demand} is out of scale`);
});

test('buying capacity clears the shortfall and its penalties', async () => {
  const { buildNationalComplex } = await import('./helpers/buildStadium.js');
  const g = new Game();
  g.adopt(createState({ seed: 3 }), buildNationalComplex());
  g.state.cash = 60_000_000;
  g.analyze(true);

  const before = g.primaryVenue.ratings.measures.restroom;
  assert.ok(g.state.utilityFactors.sewer < 1, 'wastewater starts overloaded');
  assert.ok(g.primaryVenue.ratings.issues.some((i) => i.key === 'utility_sewer'));

  // Restrooms depend on both water and wastewater, so both have to keep pace.
  for (const key of ['sewer', 'water']) {
    for (let i = 0; i < 4 && g.state.utilityStatus[key].deficit > 0; i++) {
      const r = g.upgradeUtility(key);
      assert.ok(r.ok, r.error);
    }
    assert.equal(g.state.utilityStatus[key].deficit, 0, `${key} still short`);
  }
  assert.equal(g.state.utilityFactors.sewer, 1);
  assert.ok(g.primaryVenue.ratings.measures.restroom > before, 'restrooms recover');
  assert.ok(!g.primaryVenue.ratings.issues.some((i) => i.key === 'utility_sewer'));
  assert.ok(g.state.utilityUpkeep > 0, 'and the capacity carries an upkeep cost');
});

test('an overloaded network causes incidents on event day', async () => {
  const { buildNationalComplex } = await import('./helpers/buildStadium.js');
  const { simulateEvent } = await import('../src/events/eventSimulation.js');
  const g = new Game();
  g.adopt(createState({ seed: 3 }), buildNationalComplex());
  g.state.reputation.venue = 70;
  g.analyze(true);
  g.registerVenue(g.primaryVenue.key, 'Riverside');
  g.analyze(true);

  const ev = instantiate(EVENT_TEMPLATES.find((t) => t.id === 'national_final'), g.state, makeRng(8));
  const bid = { amount: 0, packages: [], terms: [], pricing: 'standard' };
  let hits = 0;
  for (let i = 0; i < 20; i++) {
    const r = simulateEvent({ ...ev, seed: 500 + i }, g.primaryVenue, g.state, bid);
    if (r.incidents.some((x) => ['sewer', 'water', 'data', 'climate'].includes(x.key))) hits++;
  }
  assert.ok(hits > 8, `only ${hits}/20 events hit a utility failure while overloaded`);
});

// ------------------------------------------------- community and endgame

test('community standing is built from what the complex actually does', async () => {
  const { communityReport } = await import('../src/core/community.js');
  const { buildNationalComplex, fundInfrastructure } = await import('./helpers/buildStadium.js');
  const { generateParkingGarage } = await import('../src/voxel/structures.js');
  const { applyPlan } = await import('../src/voxel/buildTools.js');
  const g = new Game();
  g.adopt(createState({ seed: 5 }), buildNationalComplex());
  fundInfrastructure(g);

  const before = communityReport(g.state, g.analysis);
  assert.ok(before.jobs > 0, 'a complex this size supports jobs');
  assert.ok(before.positives.length > 0 && before.positives.every((p) => p.label && p.score > 0));
  assert.ok(before.mood.label.length > 0);
  // 60,000 seats against thin parking means cars on residential streets.
  assert.ok(before.negatives.some((n) => n.key === 'traffic'), 'traffic is flagged');

  // Solve the transport problem and the neighbours should soften.
  for (let i = 0; i < 6; i++) {
    const x0 = 6 + (i % 3) * 40;
    const z0 = 122 + Math.floor(i / 3) * 34;
    applyPlan(g.world, generateParkingGarage(
      g.world, { x: x0, z: z0 }, { x: x0 + 34, z: z0 + 28 }, { levels: 6 }).cells, 'garage');
  }
  g.markWorldDirty();
  g.analyze(true);
  const after = communityReport(g.state, g.analysis);
  assert.ok(after.target > before.target,
    `fixing the parking should lift standing (${before.target} -> ${after.target})`);
  const trafficBefore = before.negatives.find((n) => n.key === 'traffic').score;
  const trafficAfter = (after.negatives.find((n) => n.key === 'traffic') || { score: 0 }).score;
  assert.ok(trafficAfter > trafficBefore, 'and the traffic complaint eases');
});

test('community standing drifts rather than jumping', async () => {
  const { driftCommunity } = await import('../src/core/community.js');
  const g = new Game();
  g.newGame({ seed: 9 });
  g.state.reputation.community = 20;
  const target = driftCommunity(g.state, g.analysis).target;
  assert.ok(Math.abs(g.state.reputation.community - 20) < 2, 'one day moves it only slightly');
  for (let i = 0; i < 200; i++) driftCommunity(g.state, g.analysis);
  assert.ok(Math.abs(g.state.reputation.community - target) < 2, 'but it does get there');
});

test('endgame goals report real progress and never throw', async () => {
  const { endgameProgress, ENDGAME_GOALS } = await import('../src/data/endgame.js');
  const fresh = new Game();
  fresh.newGame({ seed: 2 });
  const early = endgameProgress(fresh.state);
  assert.equal(early.total, ENDGAME_GOALS.length);
  assert.equal(early.complete, 0);
  assert.ok(early.goals.every((g) => typeof g.detail === 'string' && g.value >= 0 && g.value <= 1));

  fresh.state.stats.bestCapacity = 90_000;
  fresh.state.stats.tiersHosted.push('world');
  const later = endgameProgress(fresh.state);
  assert.ok(later.complete >= 2);
  assert.ok(later.overall > early.overall);
});

test('rival standings rank the player against the competition', () => {
  const g = new Game();
  g.newGame({ seed: 4 });
  const table = g.standings();
  assert.equal(table.length, g.state.rivals.length + 1);
  assert.equal(table.filter((r) => r.you).length, 1);
  assert.deepEqual(table.map((r) => r.rank), table.map((_, i) => i + 1));
  // Nobody shares the player's default complex name.
  const you = table.find((r) => r.you);
  assert.equal(table.filter((r) => r.name === you.name).length, 1);
});

// ----------------------------------------------------------------- weather

test('weather wears an open pitch and slows a building site', async () => {
  const g = new Game();
  g.adopt(createState({ seed: 12 }), buildReferenceStadium());
  g.analyze(true);
  const dry = g.primaryVenue.ratings.measures.field;

  // Force a run of storms and let the days pass.
  g.state.weather = 'storm';
  g.state.weatherUntilDay = 9999;
  assert.equal(g.weatherBuildFactor(), 0.35, 'a storm should stop most work');
  for (let i = 0; i < 12; i++) g.skipDay();
  assert.ok(g.state.pitchWear > 0.2, `wear is only ${g.state.pitchWear}`);
  g.analyze(true);
  const wet = g.primaryVenue.ratings.measures.field;
  assert.ok(wet < dry, `an open pitch should suffer (${dry} -> ${wet})`);
  assert.ok(g.primaryVenue.ratings.issues.some((i) => i.key === 'pitch_condition'), 'and say so');

  // Fine weather brings it back, but slowly - a battered pitch takes weeks.
  g.state.weather = 'sunny';
  const worst = g.state.pitchWear;
  for (let i = 0; i < 10; i++) g.skipDay();
  assert.ok(g.state.pitchWear < worst, 'it starts recovering');
  for (let i = 0; i < 60; i++) g.skipDay();
  assert.equal(g.state.pitchWear, 0, 'and gets there eventually');
  assert.equal(g.weatherBuildFactor(), 1);
  g.analyze(true);
  assert.ok(g.primaryVenue.ratings.measures.field >= dry - 0.001, 'the surface is as good as new');
});

// ------------------------------------------------------------------ hotbar

test('the hotbar starts with a usable set of blocks and zones', async () => {
  const { createHotbarState, SLOTS, DEFAULT_BLOCK_SLOTS, DEFAULT_ZONE_SLOTS, isPropSlot } =
    await import('../src/ui/hotbar.js');
  const { BLOCK_BY_KEY } = await import('../src/data/blocks.js');
  const { ZONE_BY_KEY } = await import('../src/data/zones.js');
  const { PROP_BY_KEY } = await import('../src/data/props.js');

  const h = createHotbarState();
  assert.equal(h.blocks.length, SLOTS);
  assert.equal(h.zones.length, SLOTS);
  assert.equal(h.active, 0);

  for (const key of DEFAULT_BLOCK_SLOTS) {
    // A slot holds either a material or a piece of equipment.
    const b = isPropSlot(key) ? PROP_BY_KEY.get(key.slice(1)) : BLOCK_BY_KEY.get(key);
    assert.ok(b, `default hotbar entry "${key}" does not exist`);
    assert.ok(!b.unlock, `default hotbar entry "${key}" is locked behind research`);
  }
  for (const key of DEFAULT_ZONE_SLOTS) {
    assert.ok(ZONE_BY_KEY.has(key), `default hotbar zone "${key}" does not exist`);
  }
  // The starting set should cover the first stadium: a surface, seats and a gate.
  assert.ok(DEFAULT_BLOCK_SLOTS.includes('turf'));
  assert.ok(DEFAULT_BLOCK_SLOTS.includes('seat'));
  assert.ok(DEFAULT_ZONE_SLOTS.includes('entrance'));
});

test('a save without a hotbar gets one on load', async () => {
  const { migrate } = await import('../src/save/serialization.js');
  const g = new Game();
  g.newGame({ seed: 3 });
  const raw = { version: 4, state: { ...g.state }, world: { size: 8, chunks: [] } };
  delete raw.state.hotbar;
  const save = migrate(raw);
  assert.equal(save.state.hotbar.blocks.length, 9);
  assert.equal(save.state.hotbar.zones.length, 9);

  // A partially-written hotbar is repaired rather than crashing.
  const partial = migrate({ version: 4, state: { ...g.state, hotbar: { blocks: ['turf'] } }, world: { size: 8, chunks: [] } });
  assert.equal(partial.state.hotbar.zones.length, 9);
  assert.equal(partial.state.hotbar.active, 0);
});

// ------------------------------------------------------- the save format
//
// A block, zone or prop's numeric id is its index in its registry array, and
// the world is saved as raw ids. That makes these three arrays a file format,
// not just a list: insert a row in the middle and every id after it shifts by
// one, so every existing save silently reinterprets its seating as roofing.
// Nothing catches that at runtime - the save loads, it is just wrong.
//
// New content goes on the end of its array. These manifests are the record of
// what has shipped; extend them, never reorder them.

const BLOCK_IDS = [
  'grass', 'dirt', 'sand', 'water', 'tree', 'hedge', 'concrete',
  'reinforced', 'steel', 'beam', 'stone', 'brick', 'metal', 'glass',
  'facade_c', 'facade_m', 'facade_b', 'facade_s', 'floor_conc', 'tile',
  'hardwood', 'rubber', 'turf', 'turf_synth', 'clay', 'track', 'ice',
  'pool', 'infield', 'stage', 'esports', 'asphalt', 'pavement', 'road',
  'road_main', 'road_line', 'road_service', 'road_vip', 'road_emerg',
  'bus_lane', 'path', 'park_staff', 'park_taxi', 'park_vip', 'seat',
  'seat_alt', 'seat_box', 'seat_vip', 'terrace', 'stair', 'roof_conc',
  'roof_metal', 'roof_glass', 'roof_stadium', 'roof_retract', 'team_a',
  'team_b', 'team_c', 'advert', 'screen', 'banner', 'flag', 'floodlight',
  'railing', 'bench', 'planter', 'timber', 'window', 'door', 'fence',
  'granite', 'truss', 'rebar_conc', 'mesh', 'curtain', 'perforated',
  'louvre', 'arch', 'carpet', 'crumb', 'sand_court', 'gravel', 'boards',
  'skate_conc', 'gym_floor', 'ice_synth', 'cycle_lane', 'tram',
  'crossing', 'dropoff', 'seat_rail', 'seat_pad', 'seat_press',
  'seat_acc', 'roof_etfe', 'roof_fabric', 'roof_solar', 'roof_louvre',
  'statue', 'fountain', 'clocktower', 'turnstile', 'kiosk', 'cctv',
  'speaker', 'mural', 'pine', 'solar_panel', 'water_tank', 'generator',
  'hvac', 'substation', 'recycling',
];

const ZONE_IDS = [
  'pitch_football', 'pitch_soccer', 'pitch_rugby', 'pitch_cricket',
  'pitch_afl', 'court_basketball', 'court_tennis', 'track_athletics',
  'pool_swimming', 'rink_ice', 'ring_combat', 'field_baseball',
  'arena_esports', 'stage_event', 'seating', 'seating_vip', 'luxury_box',
  'seating_standing', 'concourse', 'stairs', 'entrance', 'exit',
  'fanzone', 'restroom', 'concession', 'restaurant', 'retail',
  'hospitality', 'locker', 'medical', 'media', 'broadcast', 'office',
  'security', 'storage', 'staff', 'training', 'parking', 'parking_vip',
  'parking_bus', 'road', 'road_main', 'road_service', 'road_vip',
  'road_emergency', 'road_bus', 'parking_staff', 'parking_taxi',
  'transit', 'court_volleyball', 'court_beach', 'court_netball',
  'court_handball', 'track_cycling', 'park_skate', 'wall_climb',
  'box_office', 'physio', 'gym_public', 'creche', 'press_room', 'tunnel',
  'plant', 'waste', 'cycle_route', 'bike_park',
];

const PROP_IDS = [
  'goal_soccer', 'goal_afl', 'goal_rugby', 'corner_flag',
  'hoop_basketball', 'net_volley', 'net_tennis', 'stumps_cricket',
  'sightscreen', 'starting_block', 'lane_rope', 'lane_marker',
  'hurdle_set', 'dugout', 'coach_box', 'scoreboard_sm', 'scoreboard_lg',
  'bench_crowd', 'goal_practice', 'post_netball', 'goal_handball',
  'net_beach', 'holds_climb', 'ramp_skate', 'gate_start', 'timing_tower',
  'podium', 'camera_platform', 'water_station', 'bike_rack',
];

test('block, zone and prop ids never move, because saves are written in them', async () => {
  const blocks = await import('../src/data/blocks.js');
  const zones = await import('../src/data/zones.js');
  const props = await import('../src/data/props.js');

  const check = (name, manifest, rows, idOf) => {
    // Everything that has shipped keeps the id it shipped with.
    for (let i = 0; i < manifest.length; i++) {
      const key = manifest[i];
      assert.equal(rows[i]?.key, key,
        `${name} id ${idOf(i)} was "${key}" and is now "${rows[i]?.key}". `
        + 'Inserting or reordering a row here rewrites every existing save. '
        + 'Add new entries to the end of the array instead.');
    }
    // Anything added since is on the end, where it belongs.
    assert.ok(rows.length >= manifest.length,
      `${name} lost ${manifest.length - rows.length} entr(y/ies); removing one shifts ids too`);
    const added = rows.slice(manifest.length).map((r) => r.key);
    if (added.length) {
      assert.ok(true, `${name} gained ${added.join(', ')} on the end`);
    }
  };

  // Block id 0 is air, so the array index is one less than the id.
  check('block', BLOCK_IDS, blocks.BLOCKS, (i) => i + 1);
  check('zone', ZONE_IDS, zones.ZONES, (i) => i + 1);
  check('prop', PROP_IDS, props.PROPS, (i) => i + 1);

  // And the manifests agree with the lookup the game actually uses.
  assert.equal(blocks.blockId('concrete'), BLOCK_IDS.indexOf('concrete') + 1);
  assert.equal(zones.zoneId('seating'), ZONE_IDS.indexOf('seating') + 1);
  assert.equal(props.propId('goal_soccer'), PROP_IDS.indexOf('goal_soccer') + 1);
});
