import {
  pitch, bowl, room, garage, stand, prefabAt, floodlights, fit, road, slab,
} from '../core/scenarioBuild.js';

/**
 * Authored starting positions.
 *
 * The sandbox is one long run from an empty field. A scenario is a problem
 * somebody else created and handed to you: a stadium built for a crowd that
 * never came, a site with no room, a ground with three stands and a grass
 * bank. Each has its own clock, and each rewards a different kind of building.
 *
 * Everything here is fictional, and every objective reads off the same state
 * the rest of the game does - nothing is scored on a hidden number.
 */

const YEAR = 360;
const M = 1_000_000;

/** Money in hand, as a fraction of the target. */
const cashTo = (n) => (s) => Math.min(1, Math.max(0, s.cash) / n);

/** Capacity of the biggest single venue. */
const bestCap = (s) => s.stats.bestCapacity || 0;

export const SCENARIOS = [
  {
    id: 'first_season',
    name: 'First Season',
    difficulty: 1,
    blurb: 'A field, a loan and a year and a half. Get a ground up and get the '
      + 'locals through the gate.',
    brief: 'You have bought a field on the edge of Meridian. Nothing on it yet. '
      + 'Build something the regional federation will take seriously, and host '
      + 'enough to prove the place works.',
    years: 1.5,
    cash: 3.5 * M,
    landTier: 0,
    reputation: { venue: 8, community: 60, fans: 50 },
    objectives: [
      { id: 'tier', desc: 'Host a regional-tier event',
        progress: (s) => (s.stats.tiersHosted.includes('regional') ? 1 : 0),
        detail: (s) => (s.stats.tiersHosted.includes('regional') ? 'Done' : 'Not yet') },
      { id: 'events', desc: 'Host six events', target: 6,
        progress: (s) => Math.min(1, s.stats.eventsHosted / 6),
        detail: (s) => `${s.stats.eventsHosted} / 6` },
      { id: 'solvent', desc: 'Finish with $4M in the bank',
        progress: cashTo(4 * M),
        detail: (s) => `$${(Math.max(0, s.cash) / M).toFixed(1)}M / $4M` },
    ],
    build() { /* an empty field is the point */ },
  },

  {
    id: 'white_elephant',
    name: 'The White Elephant',
    difficulty: 3,
    blurb: 'You have inherited a 40,000-seat stadium with no car park, no '
      + 'facilities and a loan against it.',
    brief: 'The previous owner built the stands and ran out of money before '
      + 'anything else. It seats forty thousand and cannot service four. Make '
      + 'it a venue somebody would hire, and clear the debt.',
    years: 3,
    cash: 2 * M,
    debt: 14 * M,
    landTier: 2,
    reputation: { venue: 30, community: 26, fans: 38 },
    objectives: [
      { id: 'rating', desc: 'Bring the ground up to a rating of 72', target: 72,
        progress: (s) => Math.min(1, s.stats.bestRating / 72),
        detail: (s) => `rating ${s.stats.bestRating} / 72` },
      { id: 'debt', desc: 'Clear the loan',
        progress: (s) => ((s.loans || []).length === 0 ? 1 : 0),
        detail: (s) => ((s.loans || []).length === 0 ? 'Cleared'
          : `$${Math.round((s.loans[0].balance || 0) / 1000)}K outstanding`) },
      { id: 'national', desc: 'Host a national-tier event',
        progress: (s) => (s.stats.tiersHosted.includes('national') ? 1 : 0),
        detail: (s) => (s.stats.tiersHosted.includes('national') ? 'Done' : 'Not yet') },
    ],
    build(world, ctx) {
      const c = Math.floor(world.size / 2);
      const p = pitch(world, 'pitch_football', c, c);
      bowl(world, p, 26, { gap: 3 });
      // Stands and nothing else: no restrooms, no concessions, no car park,
      // and one tired set of floodlights. Forty thousand seats and nowhere for
      // any of them to buy a cup of tea.
      floodlights(world, c, c, 58, 4);
      fit(world, 'goal_soccer', p.x0 + 1, c, 2);
      fit(world, 'goal_soccer', p.x0 + p.w - 2, c, 0);
      ctx.register = true;
    },
  },

  {
    id: 'tight_site',
    name: 'No Room To Move',
    difficulty: 4,
    blurb: 'The smallest plot in the game, and the council will not sell you '
      + 'another inch.',
    brief: 'A city-centre site, hemmed in on every side. You cannot buy land '
      + 'here - whatever you want, it has to fit. Build upward and build clever.',
    years: 4,
    cash: 12 * M,
    landTier: 0,
    noLand: true,
    reputation: { venue: 20, community: 55, fans: 50 },
    objectives: [
      { id: 'cap', desc: 'Seat 22,000 on the starting plot', target: 22_000,
        progress: (s) => Math.min(1, bestCap(s) / 22_000),
        detail: (s) => `${bestCap(s).toLocaleString()} / 22,000 seats` },
      { id: 'rating', desc: 'Reach a rating of 70',
        progress: (s) => Math.min(1, s.stats.bestRating / 70),
        detail: (s) => `rating ${s.stats.bestRating} / 70` },
      { id: 'tier', desc: 'Host a national-tier event',
        progress: (s) => (s.stats.tiersHosted.includes('national') ? 1 : 0),
        detail: (s) => (s.stats.tiersHosted.includes('national') ? 'Done' : 'Not yet') },
    ],
    build(world) {
      const c = Math.floor(world.size / 2);
      // A boundary of trees and hedges: the site is visibly fenced in.
      const edge = 3;
      for (let i = edge; i < world.size - edge; i += 2) {
        slab(world, i, edge, 1, 1, 'hedge');
        slab(world, i, world.size - edge - 1, 1, 1, 'hedge');
        slab(world, edge, i, 1, 1, 'hedge');
        slab(world, world.size - edge - 1, i, 1, 1, 'hedge');
      }
      road(world, edge + 1, c - 2, world.size - edge * 2 - 2, 4, 'road_main');
    },
  },

  {
    id: 'the_landlord',
    name: 'The Landlord',
    difficulty: 3,
    blurb: 'Forget one-off events. Build grounds that clubs want to live in.',
    brief: 'There is money in tenants, not tournaments. Sign resident clubs, '
      + 'keep them, and win something with one of them.',
    years: 5,
    cash: 24 * M,
    landTier: 1,
    reputation: { venue: 46, community: 55, fans: 55 },
    objectives: [
      { id: 'tenants', desc: 'House three clubs at once', target: 3,
        progress: (s) => Math.min(1, (s.league?.tenants || []).length / 3),
        detail: (s) => `${(s.league?.tenants || []).length} / 3 resident clubs` },
      { id: 'title', desc: 'A tenant wins its division',
        progress: (s) => (((s.league?.honours) || []).some((h) =>
          (s.league.tenants || []).some((t) => t.clubId === h.championId)) ? 1 : 0),
        detail: (s) => (((s.league?.honours) || []).some((h) =>
          (s.league.tenants || []).some((t) => t.clubId === h.championId))
          ? 'Champions' : 'No title yet') },
      { id: 'rent', desc: 'Bank $40M', progress: cashTo(40 * M),
        detail: (s) => `$${(Math.max(0, s.cash) / M).toFixed(1)}M / $40M` },
    ],
    build(world, ctx) {
      const c = Math.floor(world.size / 2);
      const p = pitch(world, 'pitch_football', c, c - 18);
      bowl(world, p, 8, { gap: 3 });
      room(world, c - 40, c + 24, 12, 10, 'restroom');
      room(world, c - 24, c + 24, 12, 10, 'concession');
      room(world, c - 8, c + 24, 10, 8, 'medical');
      room(world, c + 6, c + 24, 14, 10, 'locker');
      slab(world, c - 42, c + 38, 60, 18, 'asphalt', 'parking');
      road(world, c - 60, c + 58, 120, 4, 'road_main');
      floodlights(world, c, c - 18, 42, 4);
      fit(world, 'goal_soccer', p.x0 + 1, c - 18, 2);
      fit(world, 'goal_soccer', p.x0 + p.w - 2, c - 18, 0);
      ctx.register = true;
    },
  },

  {
    id: 'winter_city',
    name: 'Winter City',
    difficulty: 3,
    blurb: 'A cold northern site. Outdoor crowds will not come — build indoors.',
    brief: 'Nordhavn is freezing eight months a year and the gate shows it. '
      + 'Ice, water and hardwood are what fill here. Build an indoor complex '
      + 'and make it the best in the country.',
    years: 4,
    cash: 20 * M,
    landTier: 1,
    cityId: 'nordhavn',
    reputation: { venue: 34, community: 50, fans: 48 },
    objectives: [
      { id: 'sports', desc: 'Host events in three indoor sports', target: 3,
        progress: (s) => Math.min(1, s.stats.sportsHosted
          .filter((x) => ['ice', 'swimming', 'basketball', 'combat', 'esports'].includes(x)).length / 3),
        detail: (s) => `${s.stats.sportsHosted
          .filter((x) => ['ice', 'swimming', 'basketball', 'combat', 'esports'].includes(x)).length} / 3 indoor sports` },
      { id: 'cap', desc: 'Seat 18,000 under a roof', target: 18_000,
        progress: (s) => Math.min(1, bestCap(s) / 18_000),
        detail: (s) => `${bestCap(s).toLocaleString()} / 18,000 seats` },
      { id: 'rating', desc: 'Reach a rating of 78',
        progress: (s) => Math.min(1, s.stats.bestRating / 78),
        detail: (s) => `rating ${s.stats.bestRating} / 78` },
    ],
    build(world) {
      const c = Math.floor(world.size / 2);
      prefabAt(world, 'gym_medium', c - 40, c - 30);
      prefabAt(world, 'locker_room', c + 10, c - 30);
      slab(world, c - 30, c + 10, 40, 20, 'asphalt', 'parking');
      road(world, c - 60, c + 34, 120, 4, 'road_main');
    },
  },

  {
    id: 'derby',
    name: 'Derby Day',
    difficulty: 4,
    blurb: 'A rival operator across town already has the crowd. Take it.',
    brief: 'The Grand Stadium has run this city for years. You have a better '
      + 'site and a worse ground. Out-build them, out-bid them, and finish '
      + 'ahead of every operator in the country.',
    years: 5,
    cash: 30 * M,
    landTier: 2,
    reputation: { venue: 40, community: 45, fans: 45 },
    rivalBoost: 1.35,
    objectives: [
      { id: 'beat', desc: 'Hold a higher reputation than every rival',
        progress: (s) => {
          const best = Math.max(0, ...s.rivals.map((r) => r.reputation));
          return best === 0 ? 0 : Math.min(1, s.reputation.venue / best);
        },
        detail: (s) => {
          const top = s.rivals.slice().sort((a, b) => b.reputation - a.reputation)[0];
          return top ? `you ${Math.round(s.reputation.venue)} · ${top.name} ${Math.round(top.reputation)}` : '-';
        } },
      { id: 'intl', desc: 'Host an international-tier event',
        progress: (s) => (s.stats.tiersHosted.includes('international') ? 1 : 0),
        detail: (s) => (s.stats.tiersHosted.includes('international') ? 'Done' : 'Not yet') },
      { id: 'bids', desc: 'Win 25 bids', target: 25,
        progress: (s) => Math.min(1, s.stats.bidsWon / 25),
        detail: (s) => `${s.stats.bidsWon} / 25 bids won` },
    ],
    build(world, ctx) {
      const c = Math.floor(world.size / 2);
      const p = pitch(world, 'pitch_football', c, c);
      bowl(world, p, 10, { gap: 3, open: ['e'] });
      room(world, c - 60, c - 50, 14, 12, 'restroom');
      room(world, c - 40, c - 50, 14, 12, 'concession');
      slab(world, c + 40, c - 40, 40, 40, 'asphalt', 'parking');
      road(world, c - 80, c + 54, 160, 4, 'road_main');
      floodlights(world, c, c, 48, 6);
      fit(world, 'goal_soccer', p.x0 + 1, c, 2);
      fit(world, 'goal_soccer', p.x0 + p.w - 2, c, 0);
      ctx.register = true;
    },
  },

  {
    id: 'games_bid',
    name: 'The Games Bid',
    difficulty: 5,
    blurb: 'Six years to build something the whole planet will watch.',
    brief: 'The World Sports Council is taking bids. Nothing you own is close. '
      + 'Build a ground that can hold sixty thousand at a rating of 85, park '
      + 'them, and win the ceremony.',
    years: 6,
    cash: 60 * M,
    landTier: 2,
    reputation: { venue: 62, community: 55, fans: 60 },
    objectives: [
      { id: 'cap', desc: 'Seat 60,000 in one ground', target: 60_000,
        progress: (s) => Math.min(1, bestCap(s) / 60_000),
        detail: (s) => `${bestCap(s).toLocaleString()} / 60,000 seats` },
      { id: 'rating', desc: 'Reach a rating of 85',
        progress: (s) => Math.min(1, s.stats.bestRating / 85),
        detail: (s) => `rating ${s.stats.bestRating} / 85` },
      { id: 'ceremony', desc: 'Host the Games Opening Ceremony',
        progress: (s) => (s.stats.ceremonyHosted ? 1 : 0),
        detail: (s) => (s.stats.ceremonyHosted ? 'Hosted' : 'Not yet') },
    ],
    build(world, ctx) {
      const c = Math.floor(world.size / 2);
      const p = pitch(world, 'track_athletics', c, c);
      bowl(world, p, 6, { gap: 4, concourseEvery: 5 });
      room(world, 12, 12, 16, 14, 'restroom');
      room(world, 32, 12, 16, 14, 'concession');
      room(world, 52, 12, 14, 12, 'media');
      room(world, 70, 12, 14, 12, 'broadcast');
      garage(world, 12, 40, 22, 4);
      road(world, 6, 70, world.size - 12, 4, 'road_main');
      floodlights(world, c, c, 56, 8);
      ctx.register = true;
    },
  },
];

export const SCENARIO_BY_ID = new Map(SCENARIOS.map((s) => [s.id, s]));

/** Gold, silver or bronze, by how much of the clock was left. */
export const RANKS = [
  { key: 'gold', name: 'Gold', within: 0.6 },
  { key: 'silver', name: 'Silver', within: 0.8 },
  { key: 'bronze', name: 'Bronze', within: 1 },
];

export function rankFor(daysUsed, years) {
  const frac = daysUsed / (years * YEAR);
  return RANKS.find((r) => frac <= r.within) || null;
}

export { YEAR };
