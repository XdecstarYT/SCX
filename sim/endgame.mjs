/**
 * Can the game be finished?
 *
 * Thirteen long-term goals are the closest thing this game has to an ending.
 * They are the one part of the design that had never been played to: each was
 * known to be *readable*, and a test checks each reads sanely, but nothing had
 * ever driven a single game to tick all thirteen. A goal that cannot be
 * completed is worse than no goal, because the player spends real time on it.
 *
 * This is a fixture, not a player. It builds complexes straight into the world
 * and grants the money to do it, because the question here is whether the
 * goals are *reachable at all* - `sim/longrun.mjs` is the one that asks
 * whether they can be afforded. Where a goal needs events won and hosted, it
 * wins and hosts them through the real bidding and simulation code.
 *
 *   node sim/endgame.mjs [--verbose]
 */
import { Game } from '../src/core/game.js';
import { buildComplex } from './sports.mjs';
import { SPORT_ZONES } from '../src/data/zones.js';
import { CITIES } from '../src/data/cities.js';
import { LAND_TIERS } from '../src/core/constants.js';
import { EVENT_TEMPLATES } from '../src/data/events.js';
import { instantiate } from '../src/events/eventGenerator.js';
import { checkRequirements } from '../src/events/eventRequirements.js';
import { makeRng } from '../src/core/rng.js';
import { endgameProgress } from '../src/data/endgame.js';
import { fmt } from './strategy.mjs';

globalThis.performance ??= { now: () => Date.now() };
const VERBOSE = process.argv.includes('--verbose');

const zoneFor = (sport) => SPORT_ZONES.find((z) => z.sport === sport);

/**
 * Build the complex each goal needs, then win and host what the rest need.
 * Returns the finished game so a caller can read the goals off it.
 */
export function playToTheEnd(opts = {}) {
  const log = opts.verbose ? (m) => console.log('  ' + m) : () => {};
  const game = new Game();
  game.newGame({ complexName: 'Meridian Park', seed: opts.seed ?? 77 });
  game.notify = () => {};
  game.state.cash = 2e9;
  game.state.reputation.venue = 100;
  game.state.reputation.organiser = 100;

  const registerAll = () => {
    game.markWorldDirty();
    game.analyze(true);
    for (const v of game.analysis.venues) {
      if (!v.registered && v.tier !== 'none') game.registerVenue(v.key, v.suggestedName);
    }
    game.analyze(true);
  };

  // ----------------------------------------------------------- the flagship
  // "The Largest Stadium" wants one venue holding 90,000 and "World-Class
  // Venue" wants a rating of 95, which needs a roofed, screened, fully fitted
  // bowl with nothing else competing for its facilities. It gets a plot to
  // itself: facilities belong to the nearest venue that can reach them, so a
  // second ground on the same site takes the broadcast centre this one needs.
  const TOP = LAND_TIERS.length - 1;
  buildComplex(game, zoneFor('football'),
    { seats: 92_000, roof: true, screens: 3, landTier: TOP });
  registerAll();
  const flagship = game.primaryVenue;
  log(`flagship: ${flagship.capacity.total.toLocaleString()} seats, `
    + `rating ${flagship.ratings.overall}, plot ${game.world.size}`);

  // ------------------------------------------------------------ other cities
  // Each of the remaining goals gets the site it needs. "Mega Sports District"
  // wants four registered venues together on a largest-tier plot, so that city
  // gets four moderate grounds rather than one huge one; "A Group, Not A
  // Ground" wants three cities live; "Every Sport Under One Roof" wants six
  // sports hosted; and the World Championship wants an athletics stadium big
  // enough for 52,000.
  const plan = [
    { sports: [['rugby', { x: 60, z: 60 }], ['basketball', { x: 196, z: 60 }],
               ['swimming', { x: 60, z: 196 }], ['ice', { x: 196, z: 196 }]],
      seats: 12_000, landTier: TOP, label: 'district' },
    { sports: [['athletics', null]], seats: 62_000, label: 'athletics' },
    { sports: [['cricket', null]], seats: 24_000, label: 'cricket' },
    { sports: [['tennis', null]], seats: 24_000, label: 'tennis' },
  ];
  for (const step of plan) {
    const city = CITIES.filter((c) => !game.state.sites.some((x) => x.cityId === c.id))[0];
    if (!city) { log(`no city left for ${step.label}`); break; }
    const r = game.buySite(city.id, `${city.name} Park`);
    if (r?.error) { log(`could not buy ${city.name}: ${r.error}`); break; }
    game.switchSite(game.state.sites[game.state.sites.length - 1].id);
    for (const [sport, at] of step.sports) {
      buildComplex(game, zoneFor(sport),
        { seats: step.seats, roof: true, screens: 1, at, landTier: step.landTier });
    }
    registerAll();
    log(`${city.name}: ${step.label}, ${game.analysis.venues.length} venue(s), `
      + `plot ${game.world.size}`);
  }
  game.switchSite('site1');
  game.analyze(true);

  // ------------------------------------------------------------ win and host
  // Everything left is earned through the real bidding and event code: bids
  // won, spectators through the gates, profit banked, tiers and sports hosted.
  const venues = () => game.allVenues().filter((v) => v.registered);
  let attempts = 0;
  const wanted = ['football', 'basketball', 'swimming', 'ice', 'tennis', 'athletics',
    'cricket', 'combat', 'ceremony', 'concert'];
  // Cheapest-first within each sport, so the ladder is climbed rather than
  // skipped: a venue that can host the final can host the friendly too.
  const pool = EVENT_TEMPLATES
    .filter((t) => wanted.includes(t.sport))
    .sort((a, b) => a.bid[0] - b.bid[0]);

  while (attempts < (opts.rounds ?? 400)) {
    attempts++;
    const st = endgameProgress(game.state);
    if (st.complete === st.total) break;
    const tpl = pool[attempts % pool.length];
    const ev = instantiate(tpl, game.state, makeRng(1000 + attempts));
    const v = venues().find((x) => checkRequirements(ev, x, game.state).ok);
    if (!v) continue;
    // Push it onto the board, bid at the top of the range, and play the day.
    game.state.events.board.push(ev);
    const bid = { amount: ev.bidRange[1], venueKey: v.key, packages: [], terms: [], pricing: 'standard' };
    const res = game.submitBid(ev.uid, bid);
    if (!res?.ok || !res.outcome.won) continue;
    // Run the clock to the event and through it.
    let guard = 0;
    while (game.state.events.scheduled.some((e) => e.uid === ev.uid) && guard++ < 90) {
      game.state.cash = Math.max(game.state.cash, 5e8);
      game.skipDay(1);
    }
  }

  // --------------------------------------------------------------- a tenant
  // "A Home, Not A Venue" wants a top-division club living here and winning
  // the title under this roof. Everything else on the list can be bought or
  // built; this one has to be played for.
  for (let i = 0; i < 8; i++) {
    const offers = game.clubOffers();
    if (!offers.length) break;
    const top = offers.find((o) => o.club.level === 0) || offers[0];
    game.state.cash = 5e8;
    if (game.signTenant(top.club.id, top.venue.key, 6)?.error) break;
    log(`signed ${top.club.name} at ${top.venue.name}`);
    if (top.club.level === 0) break;
  }
  // Play out the seasons the title needs.
  for (let d = 0; d < (opts.seasons ?? 4) * 270; d++) {
    if (endgameProgress(game.state).complete === endgameProgress(game.state).total) break;
    game.state.cash = Math.max(game.state.cash, 5e8);
    game.skipDay(1);
  }
  log(`league: season ${game.state.league.season}, `
    + `${game.state.league.tenants.length} tenant(s), ${game.state.league.honours.length} honours`);

  // ------------------------------------------------------- the neighbourhood
  // "Part Of The Furniture" is the one goal that cannot be bought or built in
  // an afternoon: community standing drifts toward what the complex deserves,
  // a forty-fifth of the gap a day, and what it deserves is jobs, public
  // facilities and events the locals can actually get to. A calendar of world
  // finals is worth nothing here - those are the ones that bring the noise.
  for (let i = 0; i < 24; i++) {
    const c = game.candidates(3)[0];
    if (!c) break;
    game.state.cash = 5e8;
    if (game.hire(c.role.id, c.hire)?.error) break;
  }
  log(`staff: ${game.state.staff.length}`);

  const local = pool.filter((t) => t.tier === 'local' || t.tier === 'regional');
  let settle = 0;
  while (game.state.reputation.community < 90 && settle++ < (opts.settle ?? 600)) {
    const tpl = local[settle % local.length];
    const ev = instantiate(tpl, game.state, makeRng(9000 + settle));
    const v = venues().find((x) => checkRequirements(ev, x, game.state).ok);
    if (v) {
      game.state.events.board.push(ev);
      const bid = { amount: ev.bidRange[1], venueKey: v.key, packages: [], terms: [], pricing: 'standard' };
      const res = game.submitBid(ev.uid, bid);
      if (res?.ok && res.outcome.won) {
        let guard = 0;
        while (game.state.events.scheduled.some((e) => e.uid === ev.uid) && guard++ < 90) {
          game.state.cash = Math.max(game.state.cash, 5e8);
          game.skipDay(1);
        }
        continue;
      }
    }
    game.state.cash = Math.max(game.state.cash, 5e8);
    game.skipDay(1);
  }
  log(`community settled at ${Math.round(game.state.reputation.community)} after ${settle} days`);

  game.analyze(true);
  return { game, attempts };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  const { game, attempts } = playToTheEnd({ verbose: VERBOSE });
  const s = game.state;
  const p = endgameProgress(s);
  console.log('\nPlayed to the end of the goal list\n');
  for (const g of p.goals) {
    console.log(`  ${g.complete ? '✓' : '✗'} ${g.name.padEnd(34)} `
      + `${String(Math.round(g.value * 100)).padStart(3)}%  ${g.detail}`);
  }
  console.log(`\n  ${p.complete} / ${p.total} goals complete after ${attempts} bidding rounds`);
  console.log(`  day ${s.day}   ${s.stats.eventsHosted} events   `
    + `${s.stats.totalAttendance.toLocaleString()} through the gates   `
    + `${fmt(s.stats.lifetimeProfit)} lifetime profit`);
  console.log(`  achievements ${s.achievements.length}/${game.achievements?.length ?? '?'}`);
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  const missing = p.goals.filter((g) => !g.complete);
  if (missing.length) {
    console.log(`\n${missing.length} goal(s) could not be completed:`);
    for (const g of missing) console.log(`  - ${g.name}: ${g.desc} (${g.detail})`);
  }
  process.exit(missing.length ? 1 : 0);
}
