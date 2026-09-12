import { makeRng, hashString } from '../core/rng.js';
import { division } from '../data/clubs.js';

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
