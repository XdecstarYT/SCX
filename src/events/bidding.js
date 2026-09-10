import { makeRng, hashString } from '../core/rng.js';
import { BID_PACKAGES, CONTRACT_TERMS } from '../data/events.js';
import { checkRequirements } from './eventRequirements.js';

export const PRICING_TIERS = [
  { key: 'value',    name: 'Value',    mult: 0.72, elasticity: 1.16, satisfaction: 4 },
  { key: 'standard', name: 'Standard', mult: 1.0,  elasticity: 1.0,  satisfaction: 0 },
  { key: 'premium',  name: 'Premium',  mult: 1.42, elasticity: 0.78, satisfaction: -6 },
];

/**
 * Score a bid. Returns the components as well as the total so the UI can show
 * the player *why* their bid is strong or weak.
 */
export function evaluateBid(ev, venue, state, bid) {
  const check = checkRequirements(ev, venue, state);
  const traits = ev.traits;

  const [lo, hi] = ev.bidRange;
  const money = Math.max(0, Math.min(1, (bid.amount - lo) / Math.max(1, hi - lo)));

  const quality = venue ? venue.ratings.overall / 100 : 0;
  const prestige = venue ? venue.ratings.prestige / 100 : 0;
  const capHeadroom = venue
    ? Math.max(0, Math.min(1, venue.capacity.total / Math.max(1, requiredCapacity(ev) * 1.35)))
    : 0;
  const orgConfidence = state.reputation.organiser / 100;
  const venueRep = state.reputation.venue / 100;

  // Package strength only counts where the venue can actually deliver it.
  let packageStrength = 0;
  const packageNotes = [];
  for (const key of bid.packages) {
    const p = BID_PACKAGES.find((x) => x.key === key);
    if (!p) continue;
    let backing = 1;
    if (p.need && venue) {
      backing = Math.min(1, (venue.ratings.measures[p.need] ?? 0) / 0.5);
      if (backing < 0.5) packageNotes.push(`${p.name}: your venue can barely back this up.`);
    }
    packageStrength += p.strength * (0.35 + backing * 0.65);
  }

  let termStrength = 0;
  for (const key of bid.terms) {
    const t = CONTRACT_TERMS.find((x) => x.key === key);
    if (t) termStrength += t.strength;
  }

  const history = state.organiserHistory?.[ev.organiser] || 0;
  const loyalty = Math.min(0.14, history * 0.045) * traits.loyalty;

  const raw =
    money * (0.30 + traits.priceSensitive * 0.34) +
    quality * (0.18 + traits.prestigeFocus * 0.10) +
    prestige * traits.prestigeFocus * 0.16 +
    capHeadroom * 0.10 +
    orgConfidence * 0.12 +
    venueRep * 0.10 +
    packageStrength +
    termStrength +
    loyalty;

  const strength = clamp(raw, 0.02, 0.97);

  // Rivals bid too. Stronger rivals appear for higher tiers.
  const rivals = rivalBids(ev, state);
  const rivalTotal = rivals.reduce((s, r) => s + r.score, 0);
  const winChance = clamp(strength / (strength + rivalTotal + 0.05), 0.02, 0.96);

  return {
    check,
    strength,
    winChance,
    rivals,
    components: [
      { label: 'Bid amount', value: money * (0.30 + traits.priceSensitive * 0.34) },
      { label: 'Venue quality', value: quality * (0.18 + traits.prestigeFocus * 0.10) },
      { label: 'Prestige', value: prestige * traits.prestigeFocus * 0.16 },
      { label: 'Capacity headroom', value: capHeadroom * 0.10 },
      { label: 'Organiser confidence', value: orgConfidence * 0.12 },
      { label: 'Venue reputation', value: venueRep * 0.10 },
      { label: 'Packages offered', value: packageStrength },
      { label: 'Contract terms', value: termStrength },
      { label: 'Past dealings', value: loyalty },
    ].filter((c) => Math.abs(c.value) > 0.001),
    packageNotes,
  };
}

function requiredCapacity(ev) {
  const r = ev.req.find((x) => x.key === 'capacity');
  return r ? r.min : 1000;
}

/** Which rivals turn up, and how hard they push. */
export function rivalBids(ev, state) {
  const rng = makeRng(hashString(`${ev.uid}:rivals:${state.seed}`));
  const eligible = state.rivals.filter((r) =>
    (r.sports.includes(ev.sport) || ev.sport === 'concert' || ev.sport === 'ceremony')
    && r.capacity >= requiredCapacity(ev) * 0.8);

  const picked = rng.shuffle(eligible).slice(0, ev.rivalCount);
  return picked.map((r) => {
    const quality = r.quality / 100;
    const rep = r.reputation / 100;
    const push = r.aggression * rng.jitter(0.3);
    const score = clamp(quality * 0.42 + rep * 0.34 + push * 0.28, 0.05, 1.1);
    return { id: r.id, name: r.name, score, capacity: r.capacity, reputation: r.reputation };
  });
}

/**
 * Resolve a bid. Deterministic in the event seed and the exact offer, so a
 * reload cannot reroll the outcome.
 */
export function resolveBid(ev, evaluation, bid) {
  // Keyed on the event's own generation seed (stable across saves and
  // reloads) plus the exact offer, so the outcome can never be rerolled.
  const sig = `${ev.seed}:${ev.templateId}:${bid.amount}:${bid.packages.slice().sort().join()}:${bid.terms.slice().sort().join()}:${bid.pricing}`;
  const rng = makeRng(hashString(sig));
  const roll = rng();
  const won = roll < evaluation.winChance;

  let winner = null, margin = 0;
  if (!won && evaluation.rivals.length) {
    const sorted = evaluation.rivals.slice().sort((a, b) => b.score - a.score);
    winner = sorted[0];
    margin = Math.max(0.01, winner.score - evaluation.strength);
  }
  return {
    won, roll, winner,
    margin,
    close: Math.abs(roll - evaluation.winChance) < 0.08,
  };
}

export function bidCostMultiplier(bid) {
  let m = 0;
  for (const key of bid.packages) {
    const p = BID_PACKAGES.find((x) => x.key === key);
    if (p) m += p.cost;
  }
  return m;
}

export function contractEffects(bid) {
  const eff = { revenueShare: 0, multiYear: 0, sponsorPenalty: 0, broadcastBonus: 0 };
  for (const key of bid.terms) {
    const t = CONTRACT_TERMS.find((x) => x.key === key);
    if (!t) continue;
    eff.revenueShare += t.revenueShare || 0;
    eff.multiYear = Math.max(eff.multiYear, t.multiYear || 0);
    eff.sponsorPenalty += t.sponsorPenalty || 0;
    eff.broadcastBonus += t.broadcastBonus || 0;
  }
  return eff;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export { clamp };
