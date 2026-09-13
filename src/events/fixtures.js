import { makeRng, hashString } from '../core/rng.js';
import { division } from '../data/clubs.js';
import { matchWeight } from '../data/competitions.js';

/**
 * A league fixture, shaped as an event.
 *
 * A tenancy is not a different economy bolted on beside the event one: a home
 * match is an event, and it runs through the same simulation a bid event does.
 * The crowd is decided by the same comfort and accessibility ratings, the same
 * weather spoils it, the same staff work it and the same pitch wears out. The
 * only difference is where the demand comes from - a club brings its own
 * support rather than an organiser's - and that is exactly what `popularity`
 * is for.
 */
export function fixtureEvent(state, club, opponent, venue) {
  const d = division(club.level);
  const rng = makeRng(hashString(`${club.id}:${opponent.id}:${state.day}`));

  // A club's own following, plus a lift for a good opponent and for form: a
  // top-of-the-table match fills a ground a midweek fixture does not.
  const rivalry = 0.5 + opponent.support * 0.5;
  const quality = (club.strength + opponent.strength) / 2;
  const popularity = +Math.min(1.05,
    (0.30 + club.support * 0.62) * d.pull * (0.82 + rivalry * 0.22) * (0.86 + quality * 0.3)).toFixed(3);

  // Ticket prices follow the division, not the size of the ground.
  const base = Math.round((14 + d.pull * 46) * rng.jitter(0.08));

  return {
    uid: `fx-${club.id}-${state.day}`,
    templateId: `fixture_${club.sport}`,
    kind: 'fixture',
    name: `${club.name} v ${opponent.name}`,
    sport: club.sport,
    tier: d.level === 0 ? 'national' : d.level === 1 ? 'regional' : 'local',
    organiser: `${d.name}`,
    traits: { priceSensitive: 0.5, prestigeFocus: 0.5, loyalty: 1 },
    popularity,
    base,
    // A tenant pays rent, not a fee per match; the money is in the gate.
    fee: 0,
    bidRange: [0, 0],
    days: club.sport === 'cricket' ? 2 : 1,
    // A routine league match is a well-drilled operation, not a one-off.
    risk: 0.1 + d.pull * 0.06,
    prestige: Math.round(1 + d.pull * 4),
    audience: d.level === 0 ? 'national' : 'local',
    blurb: `${d.name} fixture.`,
    req: [],
    community: d.level === 2 ? 2 : 1,
    wear: club.sport === 'cricket' ? 1.4 : 1,
    postedDay: state.day,
    bidDeadline: state.day,
    eventDay: state.day,
    status: 'scheduled',
    seed: rng.int(1, 1e9),
    rivalCount: 0,
    estRevenue: 0,
    estCost: 0,
  };
}

/**
 * One match of a competition the venue has won the rights to.
 *
 * Same idea as a league fixture, different source of demand. A league match
 * brings a club's own support; a Test match or a semi-final brings whoever
 * wants to be there, which is a function of what the match is rather than who
 * lives nearby. That difference is entirely in `popularity` and `base`, so
 * everything downstream - crowd, weather, wear, staffing, satisfaction - is
 * the code that already runs for every other event in the game.
 */
export function competitionFixture(state, comp, hosting, match, home, away) {
  const rng = makeRng(hashString(`${hosting.id}:${match.index}:${state.day}`));
  const weight = matchWeight(comp, match.index);

  // A world final pulls a crowd a group match does not, and two strong sides
  // pull one that a mismatch does not.
  const TIER_PULL = { local: 0.5, regional: 0.66, national: 0.84, international: 0.96, world: 1.04 };
  const quality = ((home?.strength ?? 0.6) + (away?.strength ?? 0.6)) / 2;
  const following = ((home?.support ?? 0.6) + (away?.support ?? 0.6)) / 2;
  const popularity = +Math.min(1.15,
    (TIER_PULL[comp.tier] || 0.8) * weight * (0.78 + following * 0.3) * (0.86 + quality * 0.28)
  ).toFixed(3);

  // Rights matches are priced as the occasion, not as the division.
  const TIER_PRICE = { local: 22, regional: 34, national: 62, international: 96, world: 128 };
  const base = Math.round((TIER_PRICE[comp.tier] || 50) * weight * rng.jitter(0.08));
  const days = comp.matchDays || 1;

  return {
    uid: `cm-${hosting.id}-${match.index}`,
    templateId: comp.id,
    kind: 'competition-match',
    compId: comp.id,
    hostingId: hosting.id,
    matchIndex: match.index,
    name: comp.contested === false
      ? `${comp.name}, ${hosting.year}`
      : `${match.label}: ${home?.name || 'TBC'} v ${away?.name || 'TBC'}`,
    sport: comp.sport,
    tier: comp.tier,
    organiser: comp.organiser,
    traits: { priceSensitive: 0.5, prestigeFocus: 0.8, loyalty: 1 },
    popularity,
    base,
    // The competition pays a hosting and broadcast fee per match; the rights
    // themselves were paid for up front, when the bid was won.
    fee: Math.round(comp.matchFee / comp.matches),
    bidRange: [0, 0],
    days,
    // A staged competition is drilled, but the stakes make an incident worse.
    risk: 0.09 + (comp.tier === 'world' ? 0.06 : comp.tier === 'international' ? 0.04 : 0.02),
    prestige: Math.max(1, Math.round(comp.prestige / comp.matches)),
    audience: comp.tier === 'world' || comp.tier === 'international' ? 'international' : 'national',
    blurb: `${comp.name}, ${hosting.year}.`,
    req: [],
    community: 1,
    wear: days * (comp.sport === 'cricket' ? 1.3 : 1.1),
    postedDay: state.day,
    bidDeadline: state.day,
    eventDay: state.day,
    status: 'scheduled',
    seed: rng.int(1, 1e9),
    rivalCount: 0,
    estRevenue: 0,
    estCost: 0,
  };
}
