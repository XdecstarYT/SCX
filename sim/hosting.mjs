/**
 * Can you actually stage every competition?
 *
 * For each set of hosting rights in the catalogue: build a venue good enough
 * for it, wait for the offer to appear, bid, and then run the calendar all the
 * way to the trophy. A competition that ships with requirements no venue can
 * meet, a draw that cannot be filled, or a schedule that never completes is a
 * dead end the player pays for before finding out.
 *
 *   node sim/hosting.mjs [--verbose]
 */
import { Game } from '../src/core/game.js';
import { COMPETITIONS } from '../src/data/competitions.js';
import { SPORT_ZONES } from '../src/data/zones.js';
import { buildComplex } from './sports.mjs';
import { firstMatchDay } from '../src/core/hosting.js';

const verbose = process.argv.includes('--verbose');
const fmt = (v) => {
  const a = Math.abs(Math.round(v));
  const s = v < 0 ? '-' : '';
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${s}$${Math.round(a / 1000)}K`;
  return `${s}$${a}`;
};

/** A complex built for the sport a competition is played on. */
function venueFor(comp) {
  // A ceremony is staged in an athletics stadium; everything else plays on
  // its own surface.
  const sport = comp.sport === 'ceremony' ? 'athletics' : comp.sport;
  const sz = SPORT_ZONES.find((z) => z.sport === sport);
  if (!sz) return null;

  const game = new Game();
  game.newGame({ complexName: `${comp.short} Arena`, seed: 31 });
  game.notify = () => {};
  const capReq = (comp.req.find((r) => r.key === 'capacity') || { min: 0 }).min;
  buildComplex(game, sz, { roof: true, screens: true, seats: Math.round(capReq * 1.3) });
  game.state.cash = 400_000_000;
  game.state.reputation.venue = 95;
  game.state.reputation.organiser = 95;
  game.state.reputation.fans = 90;
  game.markWorldDirty();
  game.analyze(true);
  const v = game.analysis.venues.find((x) => x.sport === sport) || game.primaryVenue;
  if (!v) return null;
  game.registerVenue(v.key, `${comp.short} Arena`);
  game.analyze(true);
  return { game, venue: game.allVenues().find((x) => x.sport === sport) || null };
}

export function auditCompetition(comp) {
  const result = { id: comp.id, name: comp.name, problems: [], staged: null };
  const built = venueFor(comp);
  if (!built?.venue) { result.problems.push('no venue could be built for its sport'); return result; }
  const { game, venue } = built;
  result.capacity = venue.capacity.total;
  result.rating = venue.ratings.overall;

  // Wind the clock to the day the rights open, then look for them.
  //
  // Not simply the first year the competition is staged: rights are awarded
  // 150 days ahead, so a competition played early in the calendar has its 2026
  // bidding window in 2025 - before the game began. The first staging a player
  // can actually bid for is the first one whose window has not already closed.
  let year = 2026, opens = 0;
  for (let y = 2026; y <= 2026 + 8; y++) {
    if ((y - 2026) % Math.max(1, comp.cycle) !== 0) continue;
    const o = firstMatchDay(comp, y) - 150;
    if (o >= 1) { year = y; opens = o; break; }
  }
  if (!opens) { result.problems.push('no staging is ever biddable'); return result; }
  result.firstYear = year;
  game.skipDay(Math.max(1, opens + 2 - game.state.day));

  const offer = game.competitionOffers().find((o) => o.compId === comp.id);
  if (!offer) {
    result.problems.push(`the rights never appear (looked on day ${game.state.day})`);
    return result;
  }

  // Bid the top of the range: this harness asks whether it is *possible* to
  // stage, not whether it is cheap.
  const bid = { amount: offer.bidRange[1], venueKey: venue.key, packages: [], terms: [], pricing: 'standard' };
  let r = game.bidForCompetition(offer.uid, bid);
  if (r.error) { result.problems.push(`cannot bid: ${r.error}`); return result; }

  // Rivals bid too, so keep trying the next staging until one lands. A
  // competition that cannot be won in five attempts is over-contested.
  let attempts = 1;
  while (!r.hosting && attempts < 6) {
    game.skipDay(365);
    const next = game.competitionOffers().find((o) => o.compId === comp.id);
    if (!next) { game.skipDay(120); continue; }
    r = game.bidForCompetition(next.uid,
      { ...bid, amount: next.bidRange[1] });
    if (r.error) { result.problems.push(`cannot bid: ${r.error}`); return result; }
    attempts++;
  }
  if (!r.hosting) { result.problems.push(`never won the rights in ${attempts} attempts`); return result; }

  const hosting = r.hosting;
  result.attempts = attempts;
  result.rights = hosting.rightsPaid;
  const last = hosting.matches[hosting.matches.length - 1];

  // Run the calendar to the end of the schedule.
  const cashBefore = game.state.cash;
  game.skipDay(last.day - game.state.day + 2);

  const entry = game.state.hosting.history.find((h) => h.id === hosting.id);
  if (!entry) {
    const stillOpen = game.state.hosting.active.find((h) => h.id === hosting.id);
    result.problems.push(stillOpen
      ? `the schedule never completed (${stillOpen.matches.filter((m) => m.played).length}/${stillOpen.matches.length} played)`
      : 'the hosting vanished without a result');
    return result;
  }

  result.staged = entry;
  result.net = game.state.cash - cashBefore;
  if (!entry.attendance) result.problems.push('nobody came to any of it');
  // A ceremony has no winner by design; everything else must produce one, or
  // say in as many words that the trophy was shared.
  if (!entry.ceremonial && !entry.champion && !entry.shared) {
    result.problems.push('nobody was declared champion');
  }
  if (entry.matches !== comp.matches) {
    result.problems.push(`staged ${entry.matches} matches, the rights cover ${comp.matches}`);
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Every competition, bid for and staged to the trophy\n');
  let bad = 0;
  for (const comp of COMPETITIONS) {
    const r = auditCompetition(comp);
    const e = r.staged;
    const head = `${comp.short.padEnd(20)} cap ${String(r.capacity ?? 0).padStart(7)}  `
      + (e
        ? `${String(e.matches).padStart(2)} matches  ${e.attendance.toLocaleString().padStart(9)} in  `
          + `rights ${fmt(r.rights).padStart(7)}  net ${fmt(r.net).padStart(8)}`
        : 'NOT STAGED');
    console.log(head);
    if (e) {
      const outcome = e.ceremonial ? `staged, uncontested`
        : e.shared ? `${comp.trophy} shared`
        : `${e.champion} lifted ${comp.trophy}`;
      console.log(`   ${outcome}  ·  ${e.scoreline}`);
      if (verbose) for (const m of []) console.log(m);
    }
    for (const p of r.problems) { bad++; console.log(`   ! ${p}`); }
  }
  console.log(bad ? `\n${bad} problem(s) across the catalogue`
    : '\nevery competition can be won, staged and won by somebody');
}
