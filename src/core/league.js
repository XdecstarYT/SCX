import { DAYS_PER_MONTH } from './constants.js';
import { makeRng, hashString } from './rng.js';
import {
  CLUBS, CLUB_BY_ID, DIVISIONS, LEAGUE_SPORTS, division,
  tenancyRequirements, tenancyTerms,
} from '../data/clubs.js';

/**
 * Leagues, seasons and resident clubs.
 *
 * The event board is a market: organisers appear, you bid, they leave. A
 * tenancy is the opposite of that - a club signs for several seasons, brings a
 * fixture list you did not have to win, and turns the complex from a venue for
 * hire into somebody's home ground. It is also where the long arc lives: the
 * club you signed in the second division either goes up or it does not, and
 * next season's gate follows.
 *
 * Everything here is deterministic from the save's seed, so a league table is
 * the same on reload.
 */
export const SEASON_DAYS = 270;
/** Fixtures are spread over this much of the season; the rest is the break. */
const FIXTURE_WINDOW = 240;

export function createLeagueState(seed = 1) {
  return {
    seed,
    season: 1,
    startedDay: 1,
    // Division, form and support live in the save, never on the CLUBS table.
    // Promotion is a thing that happened in *this* game; writing it back to
    // the module would leak one save's league into every other one in the
    // process - which is exactly what a second tab, or a test suite, is.
    clubs: Object.fromEntries(CLUBS.map((c) => [c.id,
      { level: c.level, strength: c.strength, support: c.support }])),
    tenants: [],      // [{ clubId, venueKey, siteId, rent, gateShare, seasonsLeft, signedDay, fixtures }]
    standings: {},    // `${sport}:${level}` -> { clubId: {p,w,d,l,gf,ga,pts} }
    results: [],      // recent matches, newest first
    lastSeasonTables: null,
    honours: [],      // [{ season, sport, level, championId, ourTenant }]
  };
}

const key = (sport, level) => `${sport}:${level}`;

/** A club as this save knows it: the catalogue entry under this game's form. */
export function clubOf(league, id) {
  const base = CLUB_BY_ID.get(id);
  if (!base) return null;
  const live = league.clubs?.[id];
  return live ? { ...base, ...live } : base;
}

/** Every club in one division, as this save knows them. */
export function leagueClubs(league, sport, level) {
  return CLUBS
    .map((c) => clubOf(league, c.id))
    .filter((c) => c.sport === sport && c.level === level);
}

/** A blank row for every club in a division. */
function blankTable(league, sport, level) {
  const out = {};
  for (const c of leagueClubs(league, sport, level)) {
    out[c.id] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  }
  return out;
}

export function ensureSeason(league) {
  for (const sport of LEAGUE_SPORTS) {
    for (const d of DIVISIONS) {
      const k = key(sport, d.level);
      if (!league.standings[k]) league.standings[k] = blankTable(league, sport, d.level);
    }
  }
  return league;
}

/** Day within the current season, 0-based. */
export function seasonDay(state) {
  return state.day - state.league.startedDay;
}

export function seasonProgress(state) {
  return Math.max(0, Math.min(1, seasonDay(state) / SEASON_DAYS));
}

/**
 * Home fixture days for one tenancy, spread evenly across the season with a
 * little jitter so two tenants do not always play on the same afternoon.
 */
export function fixtureDays(league, clubId, count) {
  const rng = makeRng(hashString(`${league.seed}:${league.season}:${clubId}`));
  const gap = FIXTURE_WINDOW / (count + 1);
  const days = [];
  for (let i = 1; i <= count; i++) {
    days.push(Math.round(gap * i + rng.int(-3, 3)));
  }
  return days.filter((d) => d > 2 && d < FIXTURE_WINDOW).sort((a, b) => a - b);
}

/**
 * Opponents for a season of home fixtures: the division dealt out in order,
 * shuffled once and then cycled. Picking at random each time gave a fixture
 * list with the same visitors four weeks running, which no league has.
 */
export function opponentFor(league, club, index) {
  const pool = leagueClubs(league, club.sport, club.level).filter((c) => c.id !== club.id);
  if (!pool.length) return null;
  const rng = makeRng(hashString(`${league.seed}:${league.season}:${club.id}`));
  const order = rng.shuffle(pool);
  return order[index % order.length];
}

/**
 * How each sport scores. A football match is two or three goals and turns on
 * one of them; a cricket match is two hundred runs and rarely ties. Using one
 * formula for both produced a league where every game finished 2-2, which is
 * the sort of thing nobody reads a table twice to notice.
 */
const SCORING = {
  football:   { mean: 1.35, low: true },
  ice:        { mean: 3.0,  low: true },
  baseball:   { mean: 4.3,  low: true, noDraw: true },
  rugby:      { mean: 23,  swing: 9,  noise: 7 },
  basketball: { mean: 92,  swing: 11, noise: 9, noDraw: true },
  afl:        { mean: 84,  swing: 18, noise: 14 },
  cricket:    { mean: 245, swing: 48, noise: 38 },

  // Competitions are contested on surfaces no league in this game uses, and
  // every one of them was falling back to the football model. A tennis final
  // that finished 2-2 is not a close match, it is a bug with a scoreline: some
  // of these sports cannot be drawn at all, and the ones scored in sets do not
  // reach two figures.
  tennis:     { mean: 2.1,  low: true, noDraw: true },
  volleyball: { mean: 2.1,  low: true, noDraw: true },
  beach:      { mean: 1.4,  low: true, noDraw: true },
  esports:    { mean: 2.1,  low: true, noDraw: true },
  combat:     { mean: 0.7,  low: true, noDraw: true },
  handball:   { mean: 28,  swing: 6,  noise: 5 },
  netball:    { mean: 52,  swing: 9,  noise: 7, noDraw: true },
  athletics:  { mean: 46,  swing: 14, noise: 11, noDraw: true },
  swimming:   { mean: 38,  swing: 12, noise: 9,  noDraw: true },
  cycling:    { mean: 32,  swing: 10, noise: 8,  noDraw: true },
  skate:      { mean: 86,  swing: 8,  noise: 6,  noDraw: true },
  climbing:   { mean: 74,  swing: 10, noise: 8,  noDraw: true },
};

/** Knuth's method: the right shape for goals, where nil-nil is possible. */
function poisson(rng, mean) {
  const L = Math.exp(-Math.max(0.05, mean));
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L && k < 40);
  return k - 1;
}

/** One match between two clubs. Deterministic, and closer than pure strength. */
export function playMatch(league, home, away, tag) {
  const rng = makeRng(hashString(`${league.seed}:${league.season}:${tag}`));
  // Home advantage is real but small; form is the rest, and form is most of
  // why a league table is worth looking at.
  const h = home.strength * 1.1 + rng.range(-0.18, 0.18);
  const a = away.strength + rng.range(-0.18, 0.18);
  const spread = Math.max(-0.7, Math.min(0.7, h - a));
  const sc = SCORING[home.sport] || SCORING.football;

  let hs, as;
  if (sc.low) {
    // Low-scoring: sample the goals themselves, so a 1-0 and a 4-3 both happen.
    hs = poisson(rng, sc.mean * (1 + spread * 0.9) + 0.25);
    as = poisson(rng, sc.mean * (1 - spread * 0.9));
  } else {
    hs = Math.max(0, Math.round(sc.mean + spread * sc.swing + rng.range(-sc.noise, sc.noise)));
    as = Math.max(0, Math.round(sc.mean - spread * sc.swing + rng.range(-sc.noise, sc.noise)));
  }
  // Some sports play on until somebody wins. Nudging the stronger side is
  // wrong - a decider is the one moment form matters least - so it goes to
  // whoever the deciding point falls to.
  if (hs === as && sc.noDraw) {
    if (rng.chance(0.5 + spread * 0.25)) hs++; else as++;
  }
  return { homeScore: hs, awayScore: as };
}

export function recordResult(league, sport, level, homeId, awayId, hs, as) {
  const table = league.standings[key(sport, level)];
  if (!table || !table[homeId] || !table[awayId]) return;
  const H = table[homeId], A = table[awayId];
  H.p++; A.p++;
  H.gf += hs; H.ga += as; A.gf += as; A.ga += hs;
  if (hs > as) { H.w++; A.l++; H.pts += 3; }
  else if (hs < as) { A.w++; H.l++; A.pts += 3; }
  else { H.d++; A.d++; H.pts++; A.pts++; }
}

/** A division table, sorted the way a league table is sorted. */
export function table(league, sport, level) {
  const rows = league.standings[key(sport, level)] || {};
  return Object.entries(rows)
    .map(([clubId, r]) => ({ clubId, club: clubOf(league, clubId), ...r, gd: r.gf - r.ga }))
    .filter((r) => r.club)
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf
      || a.club.name.localeCompare(b.club.name));
}

/**
 * Which clubs are looking for a ground, and which of the player's venues each
 * would accept. A club only moves for a ground that can hold its support and
 * is good enough for its division.
 */
export function clubOffers(state, venues) {
  const league = state.league;
  const taken = new Set(league.tenants.map((t) => t.clubId));
  const housed = new Set(league.tenants.map((t) => t.venueKey));
  const out = [];
  for (const base of CLUBS) {
    const club = clubOf(league, base.id);
    if (taken.has(club.id)) continue;
    const req = tenancyRequirements(club);
    for (const v of venues) {
      if (v.sport !== club.sport) continue;
      if (housed.has(v.key)) continue;
      if (v.capacity.total < req.minCapacity) continue;
      if (v.capacity.total > req.maxCapacity) continue;
      if (v.ratings.overall < req.minRating) continue;
      out.push({ club, venue: v, req, terms: tenancyTerms(club) });
      break;
    }
  }
  // Best clubs first: that is the order a player cares about.
  return out.sort((a, b) => (b.club.support + b.club.strength) - (a.club.support + a.club.strength));
}

/** Everything the UI needs about one signed tenancy. */
export function tenantSummary(state, t) {
  const club = clubOf(state.league, t.clubId);
  if (!club) return null;
  const d = division(club.level);
  const rows = table(state.league, club.sport, club.level);
  const pos = rows.findIndex((r) => r.clubId === club.id) + 1;
  const row = rows[pos - 1];
  return {
    ...t, club, division: d, position: pos, row,
    played: row?.p || 0,
    remaining: (t.fixtures || []).filter((f) => !f.played).length,
  };
}

/**
 * End of season: prize money, promotion and relegation, contracts wound down,
 * and a fresh set of tables. Returns a report the game turns into notices.
 */
export function rolloverSeason(state) {
  const league = state.league;
  const report = { season: league.season, champions: [], moved: [], prize: 0, expired: [] };

  for (const sport of LEAGUE_SPORTS) {
    for (const d of DIVISIONS) {
      const rows = table(league, sport, d.level);
      if (rows.length < 2) continue;
      const champ = rows[0];
      report.champions.push({ sport, level: d.level, clubId: champ.clubId, name: champ.club.name });
      league.honours.unshift({ season: league.season, sport, level: d.level, championId: champ.clubId });

      // Prize money follows the club, and a tenant's prize money follows the
      // ground: a title-winning tenant is worth real money to its landlord.
      const tenant = league.tenants.find((t) => t.clubId === champ.clubId);
      if (tenant) report.prize += Math.round(d.prize * 0.25);

      // Up and down between adjacent divisions.
      const below = DIVISIONS[d.level + 1];
      if (!below) continue;
      const lower = table(league, sport, below.level);
      if (lower.length < 2) continue;
      const down = rows.slice(-1);
      const up = lower.slice(0, 1);
      for (const r of down) {
        league.clubs[r.clubId].level = below.level;
        report.moved.push({ name: r.club.name, to: below.name, up: false });
      }
      for (const r of up) {
        league.clubs[r.clubId].level = d.level;
        report.moved.push({ name: r.club.name, to: d.name, up: true });
      }
    }
  }
  if (league.honours.length > 60) league.honours.length = 60;

  // Form drifts, so last season's table is not next season's.
  const rng = makeRng(hashString(`${league.seed}:drift:${league.season}`));
  for (const c of CLUBS) {
    const live = league.clubs[c.id] || (league.clubs[c.id] = { ...c });
    live.strength = Math.max(0.2, Math.min(0.95, live.strength + rng.range(-0.05, 0.05)));
    live.support = Math.max(0.15, Math.min(0.95, live.support + rng.range(-0.04, 0.05)));
  }

  // Contracts tick down; anything expired leaves.
  league.tenants = league.tenants.filter((t) => {
    t.seasonsLeft--;
    if (t.seasonsLeft > 0) { t.fixtures = []; return true; }
    report.expired.push(clubOf(league, t.clubId)?.name || t.clubId);
    return false;
  });

  league.lastSeasonTables = league.standings;
  league.standings = {};
  ensureSeason(league);
  league.season++;
  league.startedDay = state.day;
  return report;
}

export { DIVISIONS, CLUB_BY_ID, LEAGUE_SPORTS, division, tenancyRequirements, tenancyTerms };
