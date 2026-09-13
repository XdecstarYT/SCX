import { makeRng, hashString } from './rng.js';
import { DAYS_PER_YEAR, gameYear, START_YEAR } from './constants.js';
import { COMPETITIONS, COMPETITION_BY_ID, matchLabel, matchWeight } from '../data/competitions.js';
import { side, contendersFor } from '../data/nations.js';
import { clubOf, leagueClubs, table } from './league.js';

/**
 * Hosting rights, from the offer on the board to the trophy on the wall.
 *
 * The shape of the thing: a competition is offered for a named year, you bid
 * for the rights the same way you bid for anything else, and winning gives you
 * a schedule rather than a date. Each match on that schedule runs through the
 * same event simulation as everything else in the game - the same crowd model,
 * the same weather, the same wear on the pitch - so a five-Test series is five
 * real event days, not one lump sum.
 *
 * What that buys, beyond the money: the venue is *remembered*. Every completed
 * hosting goes on an honours board with its year, its champion and its crowd,
 * and the records it broke stay there when the stand that set them is gone.
 */

/** A competition is offered this far ahead of its first match. */
const LEAD_DAYS = 150;
/** Bidding closes this far ahead of it. */
const CLOSE_DAYS = 55;

export function createHostingState() {
  return {
    offers: [],     // open rights, as event-shaped objects
    active: [],     // awarded contracts, mid-schedule
    history: [],    // completed hostings, newest first
    records: {},    // named records, each with the hosting that set it
    declined: [],   // `${compId}:${year}` that closed without us
  };
}

/** Absolute day the year Y edition of a competition starts on. */
export function firstMatchDay(comp, year) {
  return (year - START_YEAR) * DAYS_PER_YEAR + comp.window[0];
}

/** Is this competition staged in this year at all? */
export function stagedIn(comp, year) {
  return (year - START_YEAR) % Math.max(1, comp.cycle) === 0;
}

/**
 * The sides that will contest one staging. Deterministic from the year, so the
 * same save always sees the same two nations walk out.
 */
export function fieldFor(state, comp, year) {
  const rng = makeRng(hashString(`${state.seed}:comp:${comp.id}:${year}`));

  if (comp.field === 'clubs') {
    // The league's own best, so a competition staged at your ground can be
    // contested by the club that already plays there. That is the moment the
    // two systems are for: your tenant, in the final, at their own home.
    const league = state.league;
    const top = league ? table(league, comp.sport, 0) : [];
    const pool = top.length >= 2
      ? top.map((r) => r.club)
      : (league ? leagueClubs(league, comp.sport, 0) : []);
    if (pool.length >= 2) {
      const n = comp.format === 'tournament' ? Math.min(pool.length, 6) : 2;
      return pool.slice(0, n).map((c) => ({ ...c, isClub: true }));
    }
  }

  if (comp.sides?.length >= 2) return comp.sides.map((id) => side(id, comp.sport)).filter(Boolean);

  const wanted = comp.format === 'tournament' ? Math.min(8, Math.max(4, comp.matches)) : 2;
  const pool = contendersFor(comp.sport, Math.max(wanted, 4));
  return rng.shuffle(pool).slice(0, wanted);
}

/**
 * The draw. A series is the same two sides every match; a tournament pairs its
 * field off and then plays the winners against each other, so the trophy goes
 * to somebody who actually won their way to it.
 */
export function buildSchedule(state, comp, year, startDay) {
  const sides = fieldFor(state, comp, year);
  if (sides.length < 2) return null;
  const rng = makeRng(hashString(`${state.seed}:draw:${comp.id}:${year}`));
  const matches = [];
  const spacing = Math.max(1, comp.spacing || 1);

  for (let i = 0; i < comp.matches; i++) {
    let a, b;
    if (comp.format === 'tournament') {
      // Group matches rotate through the field; the closing matches are filled
      // in once there are results to fill them with.
      a = sides[(i * 2) % sides.length];
      b = sides[(i * 2 + 1) % sides.length];
      if (a.id === b.id) b = sides[(i * 2 + 2) % sides.length];
    } else {
      a = sides[0];
      b = sides[1];
    }
    matches.push({
      index: i,
      day: startDay + i * spacing,
      label: matchLabel(comp, i),
      homeId: a.id, awayId: b.id,
      decided: i < comp.matches - (comp.format === 'tournament' ? 3 : 0),
      played: false,
      homeScore: 0, awayScore: 0,
      attendance: 0,
    });
  }
  return { sides, matches, seed: rng.int(1, 1e9) };
}

/**
 * Competitions open for bidding right now, as event-shaped objects.
 *
 * They are event-shaped on purpose: `checkRequirements`, `evaluateBid` and the
 * whole bid screen already know how to read one, so hosting rights go through
 * the machinery the player has already learned rather than beside it.
 */
export function competitionOffers(state, hostableSports) {
  const out = [];
  const day = state.day;
  const thisYear = gameYear(day);
  const decided = new Set(state.hosting?.declined || []);
  const held = new Set((state.hosting?.active || []).map((h) => `${h.compId}:${h.year}`));
  const done = new Set((state.hosting?.history || []).map((h) => `${h.compId}:${h.year}`));

  for (const comp of COMPETITIONS) {
    for (const year of [thisYear, thisYear + 1]) {
      if (!stagedIn(comp, year)) continue;
      const key = `${comp.id}:${year}`;
      if (decided.has(key) || held.has(key) || done.has(key)) continue;

      const start = firstMatchDay(comp, year);
      const posted = start - LEAD_DAYS;
      const closes = start - CLOSE_DAYS;
      if (day < posted || day > closes) continue;

      // Organisers approach venues that could plausibly stage it. A complex
      // with no registered venue at all is approached by nobody, and one with
      // no surface for the sport never sees that sport's rights - otherwise
      // the board fills with world championships nobody could take up.
      if (!hostableSports || !hostableSports.size) continue;
      if (!hostableSports.has(comp.sport)
        && !(comp.sport === 'ceremony' && hostableSports.has('athletics'))) continue;

      out.push(offerFor(state, comp, year, posted, closes, start));
    }
  }
  return out.sort((a, b) => a.eventDay - b.eventDay);
}

/** One competition, dressed as an event so the rest of the game can read it. */
export function offerFor(state, comp, year, posted, closes, start) {
  const rng = makeRng(hashString(`${state.seed}:offer:${comp.id}:${year}`));
  const jitter = rng.jitter(0.14);
  return {
    uid: `C-${comp.id}-${year}`,
    kind: 'competition',
    compId: comp.id,
    year,
    templateId: comp.id,
    name: `${year} ${comp.name}`,
    sport: comp.sport,
    tier: comp.tier,
    organiser: comp.organiser,
    traits: { priceSensitive: 0.55, prestigeFocus: 0.85, loyalty: 0.7 },
    // A competition's own pull, before the individual match weights.
    popularity: 0.9,
    base: 0,
    // You are buying the rights, not being paid a fee to turn up. The money
    // comes back over the schedule, which is the whole shape of the decision.
    fee: 0,
    bidRange: [Math.round(comp.rights[0] * jitter), Math.round(comp.rights[1] * jitter)],
    matchFee: comp.matchFee,
    matches: comp.matches,
    days: comp.matches * (comp.matchDays || 1),
    risk: 0.12,
    prestige: comp.prestige,
    audience: comp.tier === 'world' || comp.tier === 'international' ? 'international' : 'national',
    blurb: comp.blurb,
    req: comp.req,
    community: 2,
    postedDay: posted,
    bidDeadline: closes,
    eventDay: start,
    status: 'open',
    seed: rng.int(1, 1e9),
    rivalCount: 0,
    estRevenue: comp.matchFee * comp.matches,
    estCost: 0,
  };
}

/** Turn a won bid into a schedule the calendar will run. */
export function awardHosting(state, offer, venue, paid) {
  const comp = COMPETITION_BY_ID.get(offer.compId);
  if (!comp) return null;
  const schedule = buildSchedule(state, comp, offer.year, offer.eventDay);
  if (!schedule) return null;
  const hosting = {
    id: `${comp.id}:${offer.year}`,
    compId: comp.id,
    year: offer.year,
    name: offer.name,
    sport: comp.sport,
    format: comp.format,
    trophy: comp.trophy,
    venueKey: venue.key,
    venueName: venue.name,
    siteId: state.activeSite,
    rightsPaid: paid,
    matchFee: comp.matchFee,
    contested: comp.contested !== false,
    awardedDay: state.day,
    sides: schedule.sides.map((s) => ({ id: s.id, name: s.name, short: s.short || null, isClub: !!s.isClub })),
    matches: schedule.matches,
    wins: {},
    totalAttendance: 0,
    totalRevenue: 0,
    totalProfit: 0,
    complete: false,
  };
  for (const s of hosting.sides) hosting.wins[s.id] = 0;
  return hosting;
}

/** Matches of every awarded hosting that fall on this day. */
export function hostingsDue(state, day) {
  const out = [];
  for (const h of state.hosting?.active || []) {
    for (const m of h.matches) {
      if (!m.played && m.day <= day) out.push({ hosting: h, match: m });
    }
  }
  return out;
}

/**
 * Fill in a knockout match whose contestants were not known when the draw was
 * made: the two sides with the most wins so far, which is what a semi-final
 * and a final are for.
 */
export function resolvePairing(hosting, match) {
  if (match.decided) return match;
  const ranked = [...hosting.sides].sort((a, b) =>
    (hosting.wins[b.id] || 0) - (hosting.wins[a.id] || 0) || a.id.localeCompare(b.id));
  const isFinal = match.index === hosting.matches.length - 1;
  const pair = isFinal ? [ranked[0], ranked[1]] : [ranked[match.index % 2], ranked[2 + (match.index % 2)]];
  if (pair[0] && pair[1] && pair[0].id !== pair[1].id) {
    match.homeId = pair[0].id;
    match.awayId = pair[1].id;
  }
  match.decided = true;
  return match;
}

/** Record a played match against the standing, and return what it means. */
export function recordMatch(hosting, match, homeScore, awayScore, attendance) {
  match.played = true;
  if (hosting.contested === false) {
    match.attendance = attendance;
    hosting.totalAttendance += attendance;
    return null;
  }
  match.homeScore = homeScore;
  match.awayScore = awayScore;
  match.attendance = attendance;
  hosting.totalAttendance += attendance;
  const winnerId = homeScore > awayScore ? match.homeId
    : awayScore > homeScore ? match.awayId : null;
  if (winnerId) hosting.wins[winnerId] = (hosting.wins[winnerId] || 0) + 1;
  match.winnerId = winnerId;
  return winnerId;
}

/** The scoreline of a series, as a series is actually quoted. */
export function standingLine(hosting) {
  const played = hosting.matches.filter((m) => m.played).length;
  if (!played) return 'Not started';
  if (hosting.contested === false) {
    return `Staged before ${hosting.totalAttendance.toLocaleString()}`;
  }
  const ranked = [...hosting.sides].sort((a, b) => (hosting.wins[b.id] || 0) - (hosting.wins[a.id] || 0));
  if (hosting.format === 'series' && hosting.sides.length === 2) {
    const [a, b] = hosting.sides;
    const drawn = played - (hosting.wins[a.id] || 0) - (hosting.wins[b.id] || 0);
    return `${a.name} ${hosting.wins[a.id] || 0} - ${hosting.wins[b.id] || 0} ${b.name}`
      + (drawn ? ` (${drawn} drawn)` : '');
  }
  // A tournament is not decided on a win tally, it is decided in the final.
  // Quoting the tally read "the Coastal Union 2 · Solano 2" beside a line
  // saying Solano had won it, which is two different stories about one day.
  const last = hosting.matches[hosting.matches.length - 1];
  if (last?.played && last.winnerId) {
    const won = hosting.sides.find((s) => s.id === last.winnerId);
    const lostId = last.winnerId === last.homeId ? last.awayId : last.homeId;
    const lost = hosting.sides.find((s) => s.id === lostId);
    const hi = Math.max(last.homeScore, last.awayScore);
    const lo = Math.min(last.homeScore, last.awayScore);
    return `${won?.name || 'The winner'} beat ${lost?.name || 'the runner-up'} ${hi}-${lo} in the final`;
  }
  return ranked.slice(0, 2)
    .map((s) => `${s.name} ${hosting.wins[s.id] || 0}`)
    .join(' · ');
}

/** Who lifted it. A final decides a tournament; a series is decided on wins. */
export function championOf(hosting) {
  if (hosting.contested === false) return null;
  const last = hosting.matches[hosting.matches.length - 1];
  if (hosting.format !== 'series' && last?.winnerId) {
    return hosting.sides.find((s) => s.id === last.winnerId) || null;
  }
  const ranked = [...hosting.sides].sort((a, b) => (hosting.wins[b.id] || 0) - (hosting.wins[a.id] || 0));
  if (!ranked.length) return null;
  if (ranked.length > 1 && (hosting.wins[ranked[0].id] || 0) === (hosting.wins[ranked[1].id] || 0)) {
    // A drawn series: the holder keeps the trophy, and in this game nobody
    // holds it until somebody wins it, so it is shared and said to be shared.
    return null;
  }
  return ranked[0];
}

/**
 * Close a finished hosting: write the honours entry, update the records, and
 * hand back what the game should tell the player.
 */
export function completeHosting(state, hosting) {
  hosting.complete = true;
  const champion = championOf(hosting);
  const entry = {
    compId: hosting.compId,
    id: hosting.id,
    name: hosting.name,
    year: hosting.year,
    sport: hosting.sport,
    format: hosting.format,
    trophy: hosting.trophy,
    venueKey: hosting.venueKey,
    venueName: hosting.venueName,
    championId: champion?.id || null,
    champion: champion?.name || null,
    ceremonial: hosting.contested === false,
    shared: !champion && hosting.contested !== false,
    scoreline: standingLine(hosting),
    matches: hosting.matches.length,
    attendance: hosting.totalAttendance,
    bestCrowd: hosting.matches.reduce((m, x) => Math.max(m, x.attendance || 0), 0),
    profit: Math.round(hosting.totalProfit),
    rightsPaid: hosting.rightsPaid,
    day: state.day,
  };
  state.hosting.history.unshift(entry);
  if (state.hosting.history.length > 80) state.hosting.history.pop();
  updateRecords(state, hosting, entry);
  return entry;
}

/**
 * The records board. A record is not a stat: it is a named day, at a named
 * ground, that the complex keeps even after the stand that held them is gone.
 */
export function updateRecords(state, hosting, entry) {
  const rec = state.hosting.records || (state.hosting.records = {});
  const best = hosting.matches.reduce((a, b) => (b.attendance > (a?.attendance || 0) ? b : a), null);
  const put = (key, value, label, detail) => {
    if (!rec[key] || value > rec[key].value) {
      rec[key] = { value, label, detail, year: entry.year, day: state.day, venue: entry.venueName };
    }
  };
  if (best) {
    put('crowd', best.attendance, 'Largest crowd',
      `${best.label}, ${entry.name}`);
  }
  put('series', hosting.totalAttendance, 'Largest aggregate',
    `${entry.matches} matches, ${entry.name}`);
  put('takings', Math.round(hosting.totalProfit), 'Most profitable staging', entry.name);
  return rec;
}

/**
 * Honours in the order a board in a concourse lists them: most recent first,
 * with the competitions a venue has staged more than once grouped by name.
 */
export function honours(state) {
  const rows = state.hosting?.history || [];
  const byComp = new Map();
  for (const h of rows) {
    if (!byComp.has(h.compId)) byComp.set(h.compId, { compId: h.compId, name: COMPETITION_BY_ID.get(h.compId)?.name || h.name, years: [], entries: [] });
    const g = byComp.get(h.compId);
    g.years.push(h.year);
    g.entries.push(h);
  }
  return [...byComp.values()].sort((a, b) => Math.max(...b.years) - Math.max(...a.years));
}

/** One line for the legacy screen: what this complex will be remembered for. */
export function hostingLegacy(state) {
  const rows = state.hosting?.history || [];
  if (!rows.length) return null;
  const best = rows.reduce((a, b) => (b.attendance > a.attendance ? b : a), rows[0]);
  const named = rows
    .map((h) => COMPETITION_BY_ID.get(h.compId))
    .filter(Boolean);
  return {
    count: rows.length,
    biggest: best,
    lines: named.slice(0, 6).map((c, i) => `${rows[i].year} ${c.short || c.name}`),
  };
}

export { COMPETITIONS, COMPETITION_BY_ID, matchWeight, matchLabel };
