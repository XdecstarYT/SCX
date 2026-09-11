import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/game.js';
import { createState } from '../src/core/gameState.js';
import { buildReferenceStadium, fundInfrastructure } from './helpers/buildStadium.js';
import { makeSave, migrate, deserializeWorlds } from '../src/save/serialization.js';
import { CITIES, city } from '../src/data/cities.js';
import { blockId } from '../src/data/blocks.js';
import { zoneId } from '../src/data/zones.js';
import { GROUND_Y } from '../src/core/constants.js';
import { monthlyFinance } from '../src/core/economy.js';

globalThis.performance ??= { now: () => Date.now() };
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary');

function started() {
  const g = new Game();
  g.adopt(createState({ seed: 21, complexName: 'Riverside' }), buildReferenceStadium());
  g.state.reputation.venue = 70;
  g.state.cash = 200_000_000;
  g.analyze(true);
  g.registerVenue(g.primaryVenue.key, 'Riverside Stadium');
  g.analyze(true);
  return g;
}

test('a new game has exactly one site', () => {
  const g = new Game();
  g.newGame({ seed: 1, complexName: 'Riverside' });
  assert.equal(g.state.sites.length, 1);
  assert.equal(g.siteId, 'site1');
  assert.ok(g.world);
  assert.equal(g.empire().sites.length, 1);
});

test('expanding into a city needs reputation and money', () => {
  const g = new Game();
  g.newGame({ seed: 1 });
  g.state.cash = 500_000_000;
  assert.match(g.buySite('ardenne').error, /reputation of 55/);

  g.state.reputation.venue = 60;
  g.state.cash = 1000;
  assert.match(g.buySite('ardenne').error, /costs/);

  g.state.cash = 500_000_000;
  const r = g.buySite('ardenne');
  assert.ok(r.ok, r.error);
  assert.equal(g.state.sites.length, 2);
  assert.match(g.buySite('ardenne').error, /already operate/);
});

test('each site is a separate world you can travel between', () => {
  const g = started();
  g.buySite('kestrel_bay');
  const second = g.state.sites[1].id;

  // The original site has a stadium; the new one is bare ground.
  assert.ok(g.primaryVenue, 'home site has a venue');
  const homeBlocks = g.analysis.complex.totalBlocks;

  g.switchSite(second);
  assert.equal(g.siteId, second);
  assert.equal(g.analysis.venues.length, 0, 'the new site starts empty');
  assert.notEqual(g.world, g.worlds.get('site1'));

  // Building here does not touch the other site.
  for (let x = 20; x < 40; x++) {
    for (let z = 20; z < 40; z++) g.world.setBlock(x, GROUND_Y, z, blockId('concrete'));
  }
  g.markWorldDirty();
  g.analyze(true);
  g.switchSite('site1');
  assert.equal(g.analysis.complex.totalBlocks, homeBlocks, 'the home site is untouched');
  assert.ok(g.primaryVenue, 'and its venue is still there');
});

test('venues from every site are available to bid with', () => {
  const g = started();
  g.buySite('solano');
  const second = g.state.sites[1].id;
  g.switchSite(second);

  // A second stadium, in the second city.
  const w = g.world;
  for (let x = 30; x < 84; x++) {
    for (let z = 30; z < 65; z++) w.setBlock(x, GROUND_Y - 1, z, blockId('turf'), zoneId('pitch_football'));
  }
  for (let x = 26; x < 88; x++) {
    for (let y = GROUND_Y; y < GROUND_Y + 3; y++) {
      w.setBlock(x, y, 27, blockId('seat'), zoneId('seating'));
      w.setBlock(x, y, 68, blockId('seat'), zoneId('seating'));
    }
  }
  g.markWorldDirty();
  g.analyze(true);
  assert.ok(g.primaryVenue, 'the second site has a venue');
  g.registerVenue(g.primaryVenue.key, 'Solano Stadium');
  g.analyze(true);

  // From either site, both venues are biddable.
  const all = g.allRegisteredVenues();
  assert.equal(all.length, 2, `expected 2 registered venues, got ${all.map((v) => v.name)}`);
  assert.equal(new Set(all.map((v) => v.key)).size, 2, 'venue keys are unique across sites');
  assert.ok(all.every((v) => v.siteId && v.siteName));

  g.switchSite('site1');
  assert.equal(g.allRegisteredVenues().length, 2, 'still both, seen from the home site');
  assert.equal(g.findVenue(all[1].key).name, all[1].name, 'and findable by key');
});

test('running costs cover every site, not just the one you are standing on', () => {
  const g = started();
  const before = monthlyFinance(g.state, g.analysis).expense.maintenance;
  g.buySite('nordhavn');
  g.switchSite(g.state.sites[1].id);
  for (let x = 10; x < 90; x++) {
    for (let z = 10; z < 90; z++) g.world.setBlock(x, GROUND_Y, z, blockId('concrete'));
  }
  g.markWorldDirty();
  g.analyzeAll();
  const after = monthlyFinance(g.state, g.analysis).expense.maintenance;
  assert.ok(after > before, `upkeep should rise with a second site (${before} -> ${after})`);
});

test('land and utilities are bought per site, at local prices', () => {
  const g = started();
  g.buySite('ardenne');            // land cost multiplier 2.4
  const homeCost = () => {
    const cash = g.state.cash;
    g.buyLand();
    const spent = cash - g.state.cash;
    return spent;
  };
  const meridianSpend = homeCost();
  g.switchSite(g.state.sites[1].id);
  const ardenneSpend = homeCost();
  assert.ok(ardenneSpend > meridianSpend * 2,
    `capital land should cost far more (${meridianSpend} vs ${ardenneSpend})`);

  // Utilities belong to the site they were bought for.
  assert.equal(g.state.sites[0].utilities.water, -1);
  g.upgradeUtility('water');
  assert.equal(g.state.sites[1].utilities.water, 0);
  assert.equal(g.state.sites[0].utilities.water, -1, 'the home site did not get a free upgrade');
});

test('a multi-site empire survives a save and reload', () => {
  const g = started();
  g.buySite('kestrel_bay');
  const second = g.state.sites[1].id;
  g.switchSite(second);
  for (let x = 20; x < 60; x++) {
    for (let z = 20; z < 60; z++) g.world.setBlock(x, GROUND_Y, z, blockId('brick'));
  }
  g.markWorldDirty();
  g.analyzeAll();
  g.switchSite('site1');

  const json = JSON.stringify(makeSave(g.state, g.worlds));
  const save = migrate(JSON.parse(json));
  assert.equal(Object.keys(save.sites).length, 2);

  const g2 = new Game();
  g2.adopt(save.state, deserializeWorlds(save));
  assert.equal(g2.state.sites.length, 2);
  assert.equal(g2.siteId, 'site1');
  assert.ok(g2.primaryVenue, 'the home stadium survived');
  g2.switchSite(second);
  assert.ok((g2.world.blockCounts.get(blockId('brick')) || 0) > 1000, 'so did the second site');
});

test('a single-site save from before the update still loads', () => {
  const g = started();
  const json = JSON.stringify(makeSave(g.state, g.world));

  // Fake an older save: land and utilities at the top level, no sites array.
  const raw = JSON.parse(json);
  delete raw.sites;
  delete raw.state.sites;
  delete raw.state.activeSite;
  raw.state.landTier = 2;
  raw.state.utilities = { power: 1, water: 0, sewer: 0, data: 1, climate: -1 };
  for (const r of raw.state.venues.registered) delete r.siteId;

  const save = migrate(raw);
  assert.equal(save.state.sites.length, 1);
  assert.equal(save.state.sites[0].landTier, 2, 'the old land tier moved onto the site');
  assert.equal(save.state.sites[0].utilities.power, 1, 'so did the utilities');
  assert.equal(save.state.venues.registered[0].siteId, 'site1');

  const g2 = new Game();
  g2.adopt(save.state, deserializeWorlds(save));
  assert.ok(g2.primaryVenue);
  assert.equal(g2.state.venues.registered.length, 1);
});

test('cities are meaningfully different from one another', () => {
  assert.ok(CITIES.length >= 4);
  const costs = new Set(CITIES.map((c) => c.landCost));
  const audiences = new Set(CITIES.map((c) => c.audience));
  assert.ok(costs.size >= 4, 'land prices should vary');
  assert.ok(audiences.size >= 4, 'audience sizes should vary');
  for (const c of CITIES) {
    assert.ok(c.desc.length > 25, `${c.id} needs a description`);
    assert.ok(c.weather.length >= 5, `${c.id} needs a weather table`);
    assert.ok(c.landCost > 0 && c.audience > 0);
  }
  // The capital should be the expensive one with the biggest crowds.
  const capital = city('ardenne');
  assert.equal(capital.landCost, Math.max(...CITIES.map((c) => c.landCost)));
  assert.equal(capital.audience, Math.max(...CITIES.map((c) => c.audience)));
});

test('the city a venue sits in changes who turns up', async () => {
  const { simulateEvent } = await import('../src/events/eventSimulation.js');
  const { instantiate } = await import('../src/events/eventGenerator.js');
  const { EVENT_TEMPLATES } = await import('../src/data/events.js');
  const { makeRng } = await import('../src/core/rng.js');

  const g = started();
  const venue = g.primaryVenue;
  const ev = instantiate(EVENT_TEMPLATES.find((t) => t.id === 'regional_final'), g.state, makeRng(3));
  const bid = { amount: 0, packages: [], terms: [], pricing: 'standard' };

  const home = simulateEvent(ev, { ...venue, audienceMult: city('meridian').audience }, g.state, bid);
  const capital = simulateEvent(ev, { ...venue, audienceMult: city('ardenne').audience }, g.state, bid);
  const coast = simulateEvent(ev, { ...venue, audienceMult: city('kestrel_bay').audience }, g.state, bid);

  assert.ok(capital.attendance > home.attendance, 'the capital draws a bigger crowd');
  assert.ok(coast.attendance < home.attendance, 'the coast draws a smaller one');
  assert.ok(capital.totalRevenue > coast.totalRevenue);
});

test('registering a venue sticks without waiting for the next analysis', () => {
  const g = started();
  g.buySite('kestrel_bay');
  // A fresh detection pass, then register without re-analysing.
  g.analyze(true);
  const v = g.primaryVenue;
  g.state.venues.registered = [];
  g.analyze(true);
  assert.equal(g.registeredVenues().length, 0);

  g.registerVenue(g.primaryVenue.key, 'Riverside Stadium');
  assert.equal(g.registeredVenues().length, 1,
    'the venue is biddable immediately, not only after the next scan');
  assert.equal(g.registeredVenues()[0].name, 'Riverside Stadium');

  g.renameVenue(g.primaryVenue.key, 'The Riverside');
  assert.equal(g.registeredVenues()[0].name, 'The Riverside');
});

// -------------------------------------------------------------- buying land
//
// New land wraps the old plot on every side. Anything else leaves a complex
// built in the middle of the starting plot stranded in a corner of the
// largest one, with half of every future purchase out of its reach.

test('buying land grows the plot around the complex, not away from it', () => {
  const g = started();
  const before = g.world.size;
  const centre = { x: g.primaryVenue.centre.x, z: g.primaryVenue.centre.z };
  const offCentreBefore = Math.hypot(centre.x - before / 2, centre.z - before / 2);
  const cap = g.primaryVenue.capacity.total;
  // Terrain grows with the plot, so count what the player built instead.
  const built = g.world.blockCounts.get(blockId('seat'));
  const props = g.world.props.size;

  assert.ok(g.buyLand().ok);
  g.analyze(true);

  const after = g.world.size;
  assert.ok(after > before, 'the plot got bigger');
  // Everything that was standing is still standing, and still one venue.
  assert.equal(g.world.blockCounts.get(blockId('seat')), built, 'no seats lost or gained');
  assert.equal(g.world.props.size, props, 'equipment came along');
  assert.equal(g.primaryVenue.capacity.total, cap, 'capacity is unchanged');
  // And it is no further from the middle of the plot than it was before.
  const v = g.primaryVenue;
  const offCentreAfter = Math.hypot(v.centre.x - after / 2, v.centre.z - after / 2);
  assert.ok(offCentreAfter <= offCentreBefore + 1,
    `complex stayed centred (was ${offCentreBefore.toFixed(1)}, now ${offCentreAfter.toFixed(1)})`);
  // There is new buildable ground on every side of it, not just two.
  const G = GROUND_Y;
  const grass = blockId('grass');
  assert.equal(g.world.getBlock(1, G - 1, Math.floor(after / 2)), grass, 'ground to the west');
  assert.equal(g.world.getBlock(after - 2, G - 1, Math.floor(after / 2)), grass, 'ground to the east');
  assert.equal(g.world.getBlock(Math.floor(after / 2), G - 1, 1), grass, 'ground to the north');
  assert.equal(g.world.getBlock(Math.floor(after / 2), G - 1, after - 2), grass, 'ground to the south');
});

test('a venue stays registered, and keeps its name, across a land purchase', () => {
  const g = started();
  const name = g.primaryVenue.name;
  assert.equal(g.state.venues.registered.length, 1);
  assert.ok(g.buyLand().ok);
  g.analyze(true);
  assert.equal(g.state.venues.registered.length, 1, 'still registered');
  assert.equal(g.primaryVenue.registered, true);
  assert.equal(g.primaryVenue.name, name, 'kept its name');
  assert.equal(g.state.venues.registered[0].key, g.primaryVenue.key, 'relinked to the moved venue');
});

test('work under construction moves with the plot and still finishes where it belongs', () => {
  const g = started();
  const w = g.world;
  const G = GROUND_Y;
  // Order a stand big enough that the game stages it rather than building it
  // outright, so there is a real backlog to carry through the purchase.
  const x0 = 10, z0 = 10, side = 24;
  const cells = [];
  const seat = blockId('seat'), seating = zoneId('seating');
  for (let z = z0; z < z0 + side; z++) {
    for (let x = x0; x < x0 + side; x++) cells.push(x, G, z, seat, seating);
  }
  const r = g.stageOrApply({ label: 'Test stand', cells, cost: 50_000, count: cells.length / 5 });
  assert.ok(r, 'the stand became a construction site');
  const queued = g.state.construction[0].total;

  assert.ok(g.buyLand().ok);
  const off = (g.world.size - 128) >> 1;
  const p = g.state.construction[0];
  assert.equal(p.total, queued, 'the same number of blocks is still queued');
  assert.equal(p.cells[0], x0 + off, 'and they are queued at the moved coordinates');
  assert.equal(p.cells[2], z0 + off);

  // Let it finish, and check it landed on the moved ground rather than the old.
  g.rushConstruction(p.id);
  assert.equal(w.getBlock(x0 + off, G, z0 + off), seat, 'built where the plan now points');
});
