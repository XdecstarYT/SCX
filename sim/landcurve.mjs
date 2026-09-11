/**
 * What is each plot size actually worth?
 *
 * Gives the player each land tier for free, lets them build it out, and
 * measures the steady state: how many seats fit, what the complex earns, and
 * which event tier it can reach. Land prices should follow from this rather
 * than being guessed at.
 *
 *   node sim/landcurve.mjs [--days 300]
 */
import { Game } from '../src/core/game.js';
import { SimPlayer } from './player.mjs';
import { Strategy, fmt } from './strategy.mjs';
import { LAND_TIERS } from '../src/core/constants.js';
import { monthlyFinance } from '../src/core/economy.js';

globalThis.performance ??= { now: () => Date.now() };

const args = process.argv.slice(2);
const DAYS = args.includes('--days') ? Number(args[args.indexOf('--days') + 1]) : 300;

/** Run one plot size with money no object, to find what the land can hold. */
function measurePlot(tierIndex, seed, days) {
  const game = new Game();
  game.newGame({ complexName: `Plot${tierIndex}`, seed });
  game.notify = () => {};
  // Hand over the plot and a working float: this measures the land, not the
  // player's ability to save for it.
  const site = game.state.sites[0];
  site.landTier = tierIndex;
  game.world.expandTo(LAND_TIERS[tierIndex].size);
  game.state.cash = 60_000_000;
  game.analyze(true);

  const builder = new SimPlayer(game, {});
  const strat = new Strategy(game, builder, {});
  builder.openingComplex();
  game.analyze(true);

  const eventProfit = [];
  const origApply = game.applyEventReport.bind(game);
  game.applyEventReport = (ev, r) => { eventProfit.push({ tier: ev.tier, profit: r.profit }); return origApply(ev, r); };

  for (let d = 0; d < days; d++) { strat.day(); game.skipDay(1); game.analyze(true); }

  const v = game.primaryVenue;
  const fin = monthlyFinance(game.state, game.analysis);
  const months = days / 30;
  const eventNet = eventProfit.reduce((a, e) => a + e.profit, 0);
  const bestTier = eventProfit.length
    ? eventProfit.map((e) => e.tier).sort((a, b) => TIERS.indexOf(b) - TIERS.indexOf(a))[0] : 'none';
  return {
    tier: tierIndex,
    size: LAND_TIERS[tierIndex].size,
    label: LAND_TIERS[tierIndex].label,
    listedCost: LAND_TIERS[tierIndex].cost,
    capacity: v?.capacity.total || 0,
    rating: v?.ratings.overall || 0,
    venueTier: v?.tier || 'none',
    stands: builder.built.stands,
    recurringNet: fin.net,
    eventNetPerMonth: eventNet / months,
    monthlyNet: fin.net + eventNet / months,
    events: eventProfit.length,
    bestTier,
    spaceTight: builder.spaceTight,
    skippedSpace: builder.skipped.space,
  };
}

const TIERS = ['none', 'local', 'regional', 'national', 'international', 'world'];

console.log(`Land curve: ${DAYS} days per plot, money no object\n`);
console.log('plot            size  seats    rating  venue-tier  recurring/mo  events/mo   net/mo     listed price   payback');
const rows = [];
for (let i = 0; i < LAND_TIERS.length; i++) {
  const r = measurePlot(i, 4242, DAYS);
  rows.push(r);
  const payback = r.monthlyNet > 0 && LAND_TIERS[i + 1]
    ? (LAND_TIERS[i + 1].cost / r.monthlyNet).toFixed(1) + ' mo'
    : LAND_TIERS[i + 1] ? 'never' : '-';
  console.log(
    `${r.label.padEnd(14)} ${String(r.size).padStart(4)}  ${r.capacity.toLocaleString().padStart(7)}  `
    + `${String(r.rating).padStart(6)}  ${r.venueTier.padEnd(10)}  ${fmt(r.recurringNet).padStart(12)}  `
    + `${fmt(r.eventNetPerMonth).padStart(9)}  ${fmt(r.monthlyNet).padStart(9)}  `
    + `${fmt(r.listedCost).padStart(12)}   ${payback}`);
}

console.log('\nWhat the next plot should cost, at a 7-month payback from the plot below it:');
for (let i = 1; i < LAND_TIERS.length; i++) {
  const below = rows[i - 1];
  const suggested = Math.max(1e6, Math.round(below.monthlyNet * 7 / 5e5) * 5e5);
  console.log(`  ${LAND_TIERS[i].label.padEnd(14)} listed ${fmt(LAND_TIERS[i].cost).padStart(9)}   `
    + `earns-at-tier-below ${fmt(below.monthlyNet).padStart(9)}/mo   suggested ${fmt(suggested)}`);
}
