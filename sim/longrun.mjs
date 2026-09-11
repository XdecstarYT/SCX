/**
 * Play the game headlessly for N in-game days and report what the economy did.
 *
 * The point is to turn "long-run balance is unproven" into a number. It drives
 * the real Game methods, so a stall, a bankruptcy or a runaway here is one a
 * player would hit too.
 *
 *   node sim/longrun.mjs [--days 360] [--seeds 5] [--verbose]
 */
import { Game } from '../src/core/game.js';
import { SimPlayer } from './player.mjs';
import { Strategy, fmt } from './strategy.mjs';
import { TIER_ORDER } from '../src/venues/ratings.js';
import { monthlyFinance } from '../src/core/economy.js';

/** Real money out per month, not the raw block weight. */
function monthlyUpkeep(game) {
  try { return monthlyFinance(game.state, game.analysis).totalExpense; } catch { return 0; }
}

globalThis.performance ??= { now: () => Date.now() };

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const DAYS = arg('days', 360);
const SEEDS = arg('seeds', 5);
const VERBOSE = args.includes('--verbose');

/** One full playthrough. Returns the day-by-day trace plus a summary. */
export function playOnce(seed, days = DAYS, opts = {}) {
  const log = opts.verbose ? (m) => console.log('    ' + m) : () => {};
  const game = new Game();
  game.newGame({ complexName: `Sim ${seed}`, seed });
  // The sim is not testing the notification system; silence keeps it fast.
  game.notify = () => {};

  const builder = new SimPlayer(game, { log });
  const strat = new Strategy(game, builder, { log, aggression: opts.aggression ?? 1 });

  builder.openingComplex();
  game.analyze(true);

  const trace = [];
  let worstCash = Infinity;
  let insolventDays = 0;
  let firstRegisterDay = null;
  const tierFirstSeen = {};

  for (let d = 0; d < days; d++) {
    strat.day();
    game.skipDay(1);
    game.analyze(true);

    const s = game.state;
    const v = game.primaryVenue;
    if (s.cash < worstCash) worstCash = s.cash;
    if (s.cash < 0) insolventDays++;
    if (firstRegisterDay === null && s.venues.registered.length) firstRegisterDay = s.day;
    for (const t of s.stats.tiersHosted || []) {
      if (tierFirstSeen[t] === undefined) tierFirstSeen[t] = s.day;
    }

    trace.push({
      day: s.day,
      cash: s.cash,
      rep: s.reputation.venue,
      capacity: v?.capacity.total || 0,
      rating: v?.ratings.overall || 0,
      tier: v?.tier || 'none',
      hosted: s.stats.eventsHosted,
      won: s.stats.bidsWon,
      lost: s.stats.bidsLost,
      upkeep: monthlyUpkeep(game),
      blocks: game.analysis.complex?.totalBlocks || 0,
      backlog: (s.construction || []).length,
      profit: s.stats.lifetimeProfit,
    });
  }

  const s = game.state;
  const last = trace[trace.length - 1];
  const months = s.finance.months;
  return {
    seed,
    trace,
    summary: {
      seed,
      days,
      cash: s.cash,
      worstCash,
      insolventDays,
      rep: s.reputation.venue,
      capacity: last.capacity,
      rating: last.rating,
      tier: last.tier,
      hosted: s.stats.eventsHosted,
      won: s.stats.bidsWon,
      lost: s.stats.bidsLost,
      winRate: s.stats.bidsPlaced ? s.stats.bidsWon / s.stats.bidsPlaced : 0,
      firstRegisterDay,
      tierFirstSeen,
      blocks: last.blocks,
      upkeep: last.upkeep,
      sites: s.sites.length,
      staff: s.staff.length,
      sponsors: s.sponsors.length,
      research: s.research.completed.length,
      actions: strat.actions,
      skipped: builder.skipped,
      longestNoBid: strat.noBidDays,
      lastMonthProfit: months.length ? months[months.length - 1].net : 0,
      sportsHosted: (s.stats.sportsHosted || []).slice(),
    },
  };
}

/** Read a run and say what, if anything, is wrong with it. */
export function diagnose(sum, trace) {
  const problems = [];
  const notes = [];

  if (sum.insolventDays > sum.days * 0.25) {
    problems.push(`insolvent on ${sum.insolventDays}/${sum.days} days (worst ${fmt(sum.worstCash)})`);
  } else if (sum.insolventDays > 0) {
    notes.push(`${sum.insolventDays} day(s) in deficit, worst ${fmt(sum.worstCash)}`);
  }

  if (sum.hosted === 0) problems.push('hosted no events at all');
  else if (sum.hosted < sum.days / 60) problems.push(`only ${sum.hosted} events in ${sum.days} days`);

  if (sum.firstRegisterDay === null) problems.push('never built anything the analyser would register');
  else if (sum.firstRegisterDay > 30) notes.push(`took ${sum.firstRegisterDay} days to register a venue`);

  // Runaway: cash compounding with nothing left to spend it on.
  const half = trace[Math.floor(trace.length / 2)];
  if (sum.cash > 5e8 && sum.cash > half.cash * 6) {
    problems.push(`runaway wealth: ${fmt(half.cash)} at halfway -> ${fmt(sum.cash)} at the end`);
  }

  // Stall: reputation flat across the back half.
  const backStart = trace[Math.floor(trace.length * 0.55)];
  if (sum.rep - backStart.rep < 1 && sum.rep < 70) {
    notes.push(`reputation stalled at ${sum.rep.toFixed(0)} from day ${backStart.day}`);
  }

  if (sum.winRate < 0.15 && sum.won + sum.lost > 10) {
    notes.push(`win rate ${(sum.winRate * 100).toFixed(0)}% over ${sum.won + sum.lost} bids`);
  }
  if (sum.winRate > 0.85 && sum.won + sum.lost > 10) {
    notes.push(`win rate ${(sum.winRate * 100).toFixed(0)}% - rivals are not competing`);
  }
  if (sum.longestNoBid > 60) notes.push(`${sum.longestNoBid} days with nothing worth bidding on`);
  if (sum.skipped.cash > 40) notes.push(`${sum.skipped.cash} builds skipped for lack of cash`);
  if (sum.skipped.space > 20) notes.push(`${sum.skipped.space} builds skipped for lack of room`);

  const reached = TIER_ORDER.filter((t) => sum.tierFirstSeen[t] !== undefined);
  if (!reached.length) notes.push('never hosted a tiered event');

  return { problems, notes, reached };
}

function bar(v, max, width = 22) {
  const n = Math.max(0, Math.min(width, Math.round((v / (max || 1)) * width)));
  return '█'.repeat(n) + '·'.repeat(width - n);
}

function printRun(run) {
  const s = run.summary;
  const { problems, notes, reached } = diagnose(s, run.trace);
  console.log(`\nseed ${s.seed}  ${s.days} days`);
  console.log(`  cash ${fmt(s.cash).padStart(9)}   worst ${fmt(s.worstCash).padStart(9)}   `
    + `rep ${s.rep.toFixed(0).padStart(3)}   rating ${String(s.rating).padStart(3)}   cap ${s.capacity.toLocaleString().padStart(7)}`);
  console.log(`  events ${String(s.hosted).padStart(3)} hosted   bids ${s.won}W/${s.lost}L `
    + `(${(s.winRate * 100).toFixed(0)}%)   tier ${s.tier}   sports ${s.sportsHosted.join(',') || '-'}`);
  console.log(`  blocks ${s.blocks.toLocaleString()}   upkeep ${fmt(s.upkeep)}/month   `
    + `sites ${s.sites}   staff ${s.staff}   sponsors ${s.sponsors}   research ${s.research}`);
  console.log(`  built ${s.actions.builds}  land ${s.actions.land}  utils ${s.actions.upgrades}  `
    + `skipped ${s.skipped.cash} cash / ${s.skipped.space} space`);
  console.log(`  tiers reached: ${reached.map((t) => `${t}@d${s.tierFirstSeen[t]}`).join(' ') || 'none'}`);

  // Cash and capacity curves, sampled.
  const step = Math.max(1, Math.floor(run.trace.length / 12));
  const pts = run.trace.filter((_, i) => i % step === 0);
  const maxCash = Math.max(...pts.map((p) => Math.abs(p.cash)), 1);
  const maxCap = Math.max(...pts.map((p) => p.capacity), 1);
  console.log('  day    cash                      capacity');
  for (const p of pts) {
    console.log(`  ${String(p.day).padStart(4)}  ${bar(p.cash, maxCash)} ${fmt(p.cash).padStart(8)}  `
      + `${bar(p.capacity, maxCap)} ${p.capacity.toLocaleString().padStart(7)}`);
  }
  for (const p of problems) console.log(`  PROBLEM  ${p}`);
  for (const n of notes) console.log(`  note     ${n}`);
  return problems.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`Long-run balance: ${SEEDS} seed(s) x ${DAYS} days`);
  let failures = 0;
  const summaries = [];
  for (let i = 0; i < SEEDS; i++) {
    const t0 = Date.now();
    const run = playOnce(1000 + i * 7919, DAYS, { verbose: VERBOSE });
    failures += printRun(run);
    summaries.push(run.summary);
    console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }

  const avg = (f) => summaries.reduce((a, s) => a + f(s), 0) / summaries.length;
  console.log('\n=== across all seeds ===');
  console.log(`  median-ish cash ${fmt(avg((s) => s.cash))}   rep ${avg((s) => s.rep).toFixed(0)}   `
    + `capacity ${Math.round(avg((s) => s.capacity)).toLocaleString()}   rating ${avg((s) => s.rating).toFixed(0)}`);
  console.log(`  events ${avg((s) => s.hosted).toFixed(1)}   win rate ${(avg((s) => s.winRate) * 100).toFixed(0)}%   `
    + `insolvent days ${avg((s) => s.insolventDays).toFixed(1)}`);
  console.log(failures ? `\n${failures} problem(s) found` : '\nno structural problems found');
  process.exit(failures ? 1 : 0);
}
