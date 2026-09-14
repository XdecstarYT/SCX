/**
 * ---------------------------------------------------------------------------
 * TICKETING
 * ---------------------------------------------------------------------------
 * Ticket revenue was attendance times a price band chosen per event. That
 * makes every event a fresh transaction with a crowd of strangers, which is
 * not how a ground with a following actually sells.
 *
 * Two things change that. A season ticket is money now against seats you have
 * promised away all year: it fills the ground on a wet Tuesday and it stops
 * you cashing in on the one big fixture, because those seats are already
 * sold. A membership is smaller and softer - a fee for the right to buy, and
 * a reason to come back.
 *
 * Both are decisions with a cost. That is the point: selling out a season in
 * advance is the safe play and the cheap one, and holding seats back for the
 * day is the greedy play that only works if you are actually good.
 */

/** How a season ticket is priced against the gate, and what it does. */
export const SEASON_TIERS = [
  {
    key: 'none', name: 'No season tickets', discount: 0, share: 0, loyalty: 0,
    hint: 'Every seat sold on the day, at whatever the day is worth.',
  },
  {
    key: 'modest', name: 'Modest book', discount: 0.18, share: 0.25, loyalty: 4,
    hint: 'A quarter of the ground sold up front at 18% off. Money in January for seats in August.',
  },
  {
    key: 'broad', name: 'Broad book', discount: 0.26, share: 0.45, loyalty: 9,
    hint: 'Nearly half the ground, at a real discount. A reliable crowd and a much smaller upside.',
  },
  {
    key: 'full', name: 'Sell the house', discount: 0.34, share: 0.65, loyalty: 15,
    hint: 'Two thirds of the ground, a third off. You will never have an empty stand or a big payday.',
  },
];
export const SEASON_BY_KEY = new Map(SEASON_TIERS.map((t) => [t.key, t]));

/** Memberships: a fee for the right to buy, and a habit. */
export const MEMBERSHIP_TIERS = [
  { key: 'none',    name: 'None',       fee: 0,   take: 0,     loyalty: 0, hint: 'Anyone can buy, nobody is committed.' },
  { key: 'basic',   name: 'Supporter',  fee: 40,  take: 0.18,  loyalty: 3, hint: 'A small annual fee for priority on tickets.' },
  { key: 'premium', name: 'Member',     fee: 120, take: 0.09,  loyalty: 7, hint: 'Dearer, so fewer take it, but they are the ones who never miss a game.' },
];
export const MEMBERSHIP_BY_KEY = new Map(MEMBERSHIP_TIERS.map((t) => [t.key, t]));

/** Concessions: who gets in cheaper, and what it buys you. */
export const CONCESSION_TIERS = [
  { key: 'none',  name: 'Full price for all', cut: 0,    reach: 0,    community: 0, hint: 'Simple, and it prices families out.' },
  { key: 'std',   name: 'Under-16s and over-65s', cut: 0.09, reach: 0.06, community: 4, hint: 'The usual arrangement. Costs a little, fills seats that would be empty.' },
  { key: 'wide',  name: 'Wide concessions', cut: 0.17, reach: 0.12, community: 9, hint: 'Students, carers, the unwaged. Noticeably cheaper and noticeably fuller.' },
];
export const CONCESSION_BY_KEY = new Map(CONCESSION_TIERS.map((t) => [t.key, t]));

export function createTicketState() {
  return {
    season: 'none', membership: 'none', concession: 'none',
    soldSeason: 0, members: 0,
    lastRenewalDay: 0, renewalRate: 0,
    history: [],
  };
}

/**
 * How many season tickets the ground could sell, and for how much.
 *
 * Demand for a season ticket is not demand for a match: it is a bet the buyer
 * makes on the year, so it follows reputation and how good last season was
 * far more than it follows the fixture list.
 */
export function seasonOffer(state, venue) {
  const tier = SEASON_BY_KEY.get(state.tickets?.season || 'none');
  if (!tier || !tier.share) return { tier, seats: 0, price: 0, gross: 0 };

  const cap = venue?.capacity?.total || 0;
  const appetite = Math.max(0.2, Math.min(1.15,
    0.35 + state.reputation.fans / 160 + state.reputation.venue / 260));
  const seats = Math.round(cap * tier.share * appetite);
  // A season ticket is priced off a typical gate for the ground, not off one
  // fixture, so a big ground charges more per seat.
  const perMatch = 18 + (venue?.ratings?.overall || 50) * 0.35;
  const matches = 19;
  const price = Math.round(perMatch * matches * (1 - tier.discount));
  return { tier, seats, price, gross: seats * price, perMatch, matches };
}

/** Members, and what they pay a year. */
export function membershipOffer(state, venue) {
  const tier = MEMBERSHIP_BY_KEY.get(state.tickets?.membership || 'none');
  if (!tier || !tier.fee) return { tier, members: 0, gross: 0 };
  const cap = venue?.capacity?.total || 0;
  const reach = 0.6 + state.reputation.fans / 180;
  const members = Math.round(cap * tier.take * reach);
  return { tier, members, gross: members * tier.fee };
}

/**
 * Sell the year's books. Called once a season; returns the money and the
 * commitment it creates.
 */
export function sellSeason(state, venue) {
  const t = state.tickets || (state.tickets = createTicketState());
  const season = seasonOffer(state, venue);
  const members = membershipOffer(state, venue);

  // Renewals: how many of last year's holders come back tells you what they
  // thought of the year they just had.
  const satisfaction = state.stats?.bestSatisfaction ?? 55;
  t.renewalRate = Math.max(0.35, Math.min(0.97, 0.45 + satisfaction / 190));

  t.soldSeason = season.seats;
  t.members = members.members;
  t.lastRenewalDay = state.day;
  t.history.unshift({
    day: state.day, seats: season.seats, price: season.price,
    gross: season.gross + members.gross, members: members.members,
  });
  if (t.history.length > 12) t.history.pop();
  return { season, members, gross: season.gross + members.gross, renewalRate: t.renewalRate };
}

/**
 * What the ticketing arrangements do to one event.
 *
 * Season tickets guarantee a floor on attendance and take the same seats out
 * of the gate, so the effect on revenue is real and two-sided. Memberships
 * and concessions pull the floor up a little and the price down a little.
 */
export function eventEffect(state, venue) {
  const t = state.tickets || createTicketState();
  const season = SEASON_BY_KEY.get(t.season) || SEASON_TIERS[0];
  const member = MEMBERSHIP_BY_KEY.get(t.membership) || MEMBERSHIP_TIERS[0];
  const conc = CONCESSION_BY_KEY.get(t.concession) || CONCESSION_TIERS[0];

  const cap = Math.max(1, venue?.capacity?.total || 1);
  // The share of the house already sold, which turns up whatever the weather.
  const committed = Math.min(0.8, (t.soldSeason || 0) / cap);

  return {
    // A floor under the fill: those seats are paid for and mostly occupied.
    floor: committed * 0.88,
    // ...and they cannot be sold again at the gate.
    gateShare: 1 - committed,
    // Season money was banked in the summer, so the day's take is smaller.
    priceMult: (1 - conc.cut) * (1 + (member.key === 'premium' ? 0.03 : 0)),
    // Cheaper seats and a committed following both fill the ground.
    fillBonus: conc.reach + (member.loyalty + season.loyalty) / 400,
    committed,
    labels: { season: season.name, membership: member.name, concession: conc.name },
  };
}

/** A one-line summary for the screen. */
export function summary(state, venue) {
  const t = state.tickets || createTicketState();
  const eff = eventEffect(state, venue);
  const cap = venue?.capacity?.total || 0;
  return {
    season: SEASON_BY_KEY.get(t.season) || SEASON_TIERS[0],
    membership: MEMBERSHIP_BY_KEY.get(t.membership) || MEMBERSHIP_TIERS[0],
    concession: CONCESSION_BY_KEY.get(t.concession) || CONCESSION_TIERS[0],
    soldSeason: t.soldSeason || 0,
    members: t.members || 0,
    committedPct: Math.round(eff.committed * 100),
    capacity: cap,
    renewalRate: t.renewalRate || 0,
    nextOffer: seasonOffer(state, venue),
    memberOffer: membershipOffer(state, venue),
  };
}
