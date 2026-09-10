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
