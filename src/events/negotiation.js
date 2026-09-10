import { makeRng, hashString } from '../core/rng.js';
import { NEGOTIATIONS, negotiationsFor, ROUNDS_BY_TIER } from '../data/negotiations.js';

/**
 * A negotiation is a short sequence of organiser demands the player answers
 * before the bid is resolved. Answers change the offer itself - fee, revenue
 * share, days, running costs - and the organiser's goodwill.
 *
 * Deterministic in the event seed, so the same event always asks the same
 * things and a reload cannot fish for an easier set of demands.
 */
export class Negotiation {
  constructor(ev, venue, state) {
    this.ev = ev;
    this.venue = venue;
    const rng = makeRng(hashString(`${ev.seed}:negotiate`));
    const pool = negotiationsFor(ev.tier);
    const rounds = Math.min(ROUNDS_BY_TIER[ev.tier] || 0, pool.length);
    this.rounds = rng.shuffle(pool).slice(0, rounds);
    this.index = 0;
    this.answers = [];
  }

  get active() { return this.index < this.rounds.length; }
  get current() { return this.rounds[this.index] || null; }
  get progress() { return { round: this.index + 1, total: this.rounds.length }; }

  /**
   * Options for the current round, annotated with whether the player's venue
   * can actually back each one up.
   */
  currentOptions() {
    const round = this.current;
    if (!round) return [];
    const m = this.venue?.ratings.measures || {};
    return round.options.map((o) => {
      const backing = o.requires ? (m[o.requires] ?? 0) : 1;
      return {
        ...o,
        supported: backing >= 0.4,
        warning: o.requires && backing < 0.4
          ? `Your ${LABELS[o.requires] || o.requires} provision cannot deliver this.`
          : null,
      };
    });
  }

  answer(optionKey) {
    const round = this.current;
    if (!round) return null;
    const option = this.currentOptions().find((o) => o.key === optionKey);
    if (!option) return null;
    this.answers.push({ id: round.id, option });
    this.index++;
    return option;
  }

  /** Everything the answers add up to. Fed into bidding and the event sim. */
  result() {
    const r = {
      strength: 0, cost: 0, fee: 0, revenueShare: 0,
      extraDays: 0, multiYear: 0, risk: 0,
      communityBonus: 0, athleteBonus: 0,
      commitments: [],
    };
    for (const { id, option } of this.answers) {
      // Promising something the venue cannot deliver only half-counts, and it
      // adds risk on the day.
      const credible = option.supported ? 1 : 0.4;
      r.strength += (option.strength || 0) * (option.strength > 0 ? credible : 1);
      r.cost += option.cost || 0;
      r.fee += option.fee || 0;
      r.revenueShare += option.revenueShare || 0;
      r.extraDays += option.extraDays || 0;
      r.multiYear = Math.max(r.multiYear, option.multiYear || 0);
      r.risk += (option.risk || 0) + (option.supported ? 0 : 0.1);
      r.communityBonus += option.communityBonus || 0;
      r.athleteBonus += option.athleteBonus || 0;
      const def = NEGOTIATIONS.find((n) => n.id === id);
      r.commitments.push({ id, demand: def?.demand, answer: option.label });
    }
    return r;
  }
}

const LABELS = {
  hospitality: 'hospitality', broadcast: 'broadcast', security: 'security',
  parking: 'transport', field: 'playing surface', media: 'media',
};

/** A plain-data summary safe to store on the bid and in saves. */
export function emptyNegotiation() {
  return {
    strength: 0, cost: 0, fee: 0, revenueShare: 0, extraDays: 0,
    multiYear: 0, risk: 0, communityBonus: 0, athleteBonus: 0, commitments: [],
  };
}

export { ROUNDS_BY_TIER };
