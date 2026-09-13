import { EVENT_TEMPLATES, TIER_UNLOCK_REPUTATION, ORGANISER_TRAITS } from '../data/events.js';
import { makeRng, hashString } from '../core/rng.js';
import { TIER_ORDER } from '../venues/ratings.js';
import { composeEvent } from './eventComposer.js';

let nextId = 1;
export function resetEventIds(n = 1) { nextId = n; }

/**
 * Which tiers are visible at a given reputation. Players always see one tier
 * above what they can reach, so there is a visible target to build toward.
 */
export function visibleTiers(reputation) {
  const tiers = Object.entries(TIER_UNLOCK_REPUTATION)
    .filter(([, r]) => reputation >= r)
    .map(([t]) => t);
  const highest = tiers[tiers.length - 1] || 'local';
  const idx = TIER_ORDER.indexOf(highest);
  const next = TIER_ORDER[idx + 1];
  if (next && next !== 'none') tiers.push(next);
  return tiers;
}

/**
 * Roll a new event opportunity. Returns null when nothing suitable comes up,
 * which keeps the board from filling with noise.
 */
export function generateEvent(state, seedSalt = 0) {
  const rng = makeRng(hashString(`${state.seed}:${state.day}:${seedSalt}`));
  const tiers = visibleTiers(state.reputation.venue);
  const pool = EVENT_TEMPLATES.filter((t) => tiers.includes(t.tier));
  if (pool.length === 0) return null;

  // Organisers approach venues that could plausibly host them, so the board
  // leans toward the sports you have actually built for. Without this a
  // football-only complex spends whole months looking at tennis and basketball
  // opportunities it can never bid on.
  const hosted = hostableSports(state);

  // Weight toward the player's current level: reachable events are common,
  // stretch events are rare but visible, and events the complex has long
  // outgrown thin out rather than staying as common as the rest.
  //
  // Treating every tier at or below the player's as equally likely looked
  // harmless while there were fewer templates, but it means a world-class
  // ground is offered the same flood of club nights as a starter plot - and
  // with two world templates against sixty-odd others, the ceremony the
  // endgame is named after could go unoffered for years.
  const weighted = [];
  const TIER_WEIGHT = { 0: 6, '-1': 4, '-2': 2 };
  for (const t of pool) {
    const gap = TIER_ORDER.indexOf(t.tier) - TIER_ORDER.indexOf(currentTier(state.reputation.venue));
    const tierW = gap > 0 ? (gap === 1 ? 2 : 1) : (TIER_WEIGHT[gap] ?? 1);
    // A quarter of the board stays outside what you have built: that is the
    // visible argument for adding a second sport.
    const sportW = hosted.size === 0 || hosted.has(t.sport) ? 4 : 1;
    for (let i = 0; i < tierW * sportW; i++) weighted.push(t);
  }
  const base = rng.pick(weighted);
  // The base says what sport and roughly how big; the angle says what *this*
  // staging of it is. Composing here rather than authoring every combination
  // is what turns three events per sport into a hundred.
  return instantiate(composeEvent(state, base, rng), state, rng);
}

/**
 * Sports the player has a registered venue for. Concerts and ceremonies are
 * included once any venue exists, because a stage goes into whatever you have.
 */
export function hostableSports(state) {
  const out = new Set();
  for (const r of state.venues?.registered || []) {
    if (r.sport) out.add(r.sport);
  }
  if (out.size > 0) { out.add('concert'); out.add('ceremony'); }
  return out;
}

function currentTier(rep) {
  let cur = 'local';
  for (const [t, r] of Object.entries(TIER_UNLOCK_REPUTATION)) if (rep >= r) cur = t;
  return cur;
}

export function instantiate(tpl, state, rng) {
  const jitter = rng.jitter(0.22);
  const LEAD = { local: [3, 9], regional: [6, 16], national: [10, 26], international: [14, 34], world: [20, 46] };
  // An angle may override the notice period: a fixture offered because
  // somebody else's ground fell through this morning is the whole point of it.
  const [lmin, lmax] = tpl.lead || LEAD[tpl.tier] || [6, 18];
  const leadDays = rng.int(lmin, lmax);
  const bidLo = Math.round(tpl.bid[0] * jitter);
  const bidHi = Math.round(tpl.bid[1] * jitter);
  const traits = ORGANISER_TRAITS[tpl.organiser] || { priceSensitive: 0.6, prestigeFocus: 0.5, loyalty: 0.5 };

  const ev = {
    uid: `E${nextId++}`,
    templateId: tpl.id,
    baseId: tpl.baseId || tpl.id,
    angleId: tpl.angleId || 'plain',
    name: tpl.name,
    sport: tpl.sport,
    tier: tpl.tier,
    organiser: tpl.organiser,
    traits,
    popularity: +(tpl.popularity * rng.jitter(0.12)).toFixed(3),
    base: Math.round(tpl.base * rng.jitter(0.18)),
    fee: Math.round(tpl.fee * jitter),
    bidRange: [bidLo, bidHi],
    days: tpl.days,
    risk: tpl.risk,
    prestige: tpl.prestige,
    audience: tpl.audience,
    blurb: tpl.blurb,
    req: tpl.req,
    community: tpl.community || 0,
    wear: tpl.wear || 1,
    postedDay: state.day,
    bidDeadline: state.day + Math.max(2, leadDays - 2),
    eventDay: state.day + leadDays,
    status: 'open',            // open | bid | won | lost | scheduled | hosted | expired
    seed: rng.int(1, 1e9),
    rivalCount: rng.int(1, Math.min(4, 1 + TIER_ORDER.indexOf(tpl.tier))),
  };

  // Expected economics shown to the player before bidding.
  const est = estimateRevenue(ev, state);
  ev.estRevenue = est;
  ev.estCost = Math.round(est * (0.32 + ev.risk * 0.25));
  return ev;
}

/** Rough revenue projection used for the event card (not the live sim). */
export function estimateRevenue(ev, state) {
  const cap = state.bestCapacityHint || 10000;
  const attend = Math.min(cap, cap * (0.5 + ev.popularity * 0.45));
  return Math.round(attend * ev.base * 1.7 + ev.fee);
}

/**
 * How many event slots the board should hold, and how often a new one lands.
 * Bigger complexes attract more interest.
 */
export function boardCapacity(state) {
  return Math.min(8, 3 + Math.floor(state.reputation.venue / 22));
}
