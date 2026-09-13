import { makeRng, hashString } from './rng.js';
import { PHASES, PHASE_KEYS, MATCHDAY_CALLS, CALL_BY_ID } from '../data/matchdayCalls.js';
import { incidentRisks } from '../events/eventSimulation.js';

/**
 * Matchday: the day itself, as something you do rather than something you read.
 *
 * Every other system in this game operates between events. You build, you bid,
 * you hire, you wait - and then the day the whole complex exists for resolved
 * itself in one function call and handed back a number. The biggest moment in
 * the game was the only one the player could not touch.
 *
 * A matchday runs in six phases. Each draws calls from the deck, weighted by
 * what is actually true about this venue on this day: the risk table the
 * simulation will roll from, the weather, how full it is, what tier it is,
 * whether the away end is a problem. Choices accumulate into an `ops` object
 * that the simulation reads - so the day *modifies* the existing model rather
 * than replacing it, and a report from a played day is the same shape as one
 * from a day nobody watched.
 *
 * Which matters, because most days are not watched. The headless sims host
 * hundreds of events, and a system that only worked with a human in front of
 * it would have quietly broken every one of them. So the day always runs: the
 * player takes the calls, or the relevant department head takes them, and how
 * well they choose is what the staff you hired are finally for.
 */

/** A fresh, neutral day's operations. Mutated as calls are decided. */
export function createOps() {
  return {
    guard: {},
    incidents: [],
    gate: 1, fill: 1, spend: 1, price: 1,
    satisfaction: 0, cost: 0, revenue: 0,
    rep: {},
    log: [],
  };
}

/**
 * What is true about this day, for deciding which calls are worth making.
 * Derived, never stored: a matchday is reconstructed from the save rather than
 * carried in it, so a save written mid-day loads as the day it was.
 */
export function dayContext(ev, venue, state) {
  const m = venue.ratings.measures;
  const TIER_RANK = { local: 0, regional: 1, national: 2, international: 3, world: 4 };
  // The crowd the simulation is going to land on, near enough for the day's
  // decisions. The real figure comes out of the simulation at the end.
  const expected = Math.min(1, ev.popularity * (0.62 + state.reputation.venue / 220));
  const best = state.stats?.bestCapacity || 0;
  return {
    fill: expected,
    tierRank: TIER_RANK[ev.tier] ?? 0,
    indoor: !!venue.indoor,
    wet: ['rain', 'storm'].includes(state.weather),
    hot: state.weather === 'heat',
    risky: ev.risk >= 0.24 || ev.angleId === 'derby',
    record: venue.capacity.total * expected > best && best > 0,
    roof: (venue.seatRoofCoverage || 0) > 0.35,
    fanzone: (m.fanzone || 0) > 0.2,
    generator: (state.complex?.generators || 0) > 0
      || (state.research?.completed || []).includes('power_grid'),
    capacity: venue.capacity.total,
  };
}

/** Does this option need something the venue has not got? */
export function optionAvailable(option, ctx) {
  const need = option.effect?.need;
  if (!need) return true;
  return !!ctx[need];
}

/**
 * The calls this day will present, phase by phase.
 *
 * Deterministic from the event's own seed, so the same day always asks the
 * same questions - a matchday you reload is the matchday you left.
 */
export function buildDay(ev, venue, state) {
  const ctx = dayContext(ev, venue, state);
  const risks = incidentRisks(ev, venue, state, {
    congestion: Math.max(0, 1 - venue.ratings.crowdFlow / 100) * ctx.fill,
    soldOut: ctx.fill > 0.985,
    extraRisk: 0,
  });
  const live = new Set(risks.filter((r) => !r.good && r.chance > 0.08).map((r) => r.key));
  const rng = makeRng(hashString(`${ev.uid}:matchday:${ev.seed}`));

  const phases = [];
  for (const phase of PHASES) {
    const pool = MATCHDAY_CALLS.filter((c) => {
      if (c.phase !== phase.key) return false;
      // A call that exists because of a risk is only asked when the risk is
      // real. Without this the day asks about a flooded restroom block in a
      // ground whose plumbing is fine, which teaches the player nothing.
      if (c.need && !live.has(c.need)) return false;
      if (c.when && !c.when(ctx)) return false;
      return true;
    });
    if (!pool.length) continue;

    // One or two calls a phase. More than that and a matchday is a form.
    const want = Math.min(pool.length, rng.chance(0.45) ? 2 : 1);
    const picked = [];
    const bag = [];
    for (const c of pool) for (let i = 0; i < (c.weight || 1); i++) bag.push(c);
    while (picked.length < want && bag.length) {
      const c = rng.pick(bag);
      if (!picked.includes(c)) picked.push(c);
      else if (picked.length && bag.every((x) => picked.includes(x))) break;
    }
    if (picked.length) {
      phases.push({
        key: phase.key,
        name: phase.name,
        desc: phase.desc,
        calls: picked.map((c) => ({
          id: c.id,
          title: c.title,
          text: c.text,
          dept: c.dept,
          options: c.options
            .map((o, i) => ({ index: i, ...o }))
            .filter((o) => optionAvailable(o, ctx)),
        })),
      });
    }
  }
  return { ctx, risks, phases };
}

/** Fold one chosen option into the day's operations. */
export function applyOption(ops, call, option, ctx) {
  const e = option.effect || {};
  for (const [k, v] of Object.entries(e.guard || {})) {
    // Two calls guarding the same risk do not stack to certainty; they take
    // the better of the two, which is what a second plan for the same problem
    // is actually worth.
    ops.guard[k] = Math.max(ops.guard[k] || 0, v);
  }
  ops.gate *= e.gate ?? 1;
  ops.fill *= e.fill ?? 1;
  ops.spend *= e.spend ?? 1;
  ops.price *= e.price ?? 1;
  ops.satisfaction += e.sat || 0;
  ops.cost += e.cost || 0;
  ops.revenue += e.revenue || 0;
  for (const [k, v] of Object.entries(e.rep || {})) ops.rep[k] = (ops.rep[k] || 0) + v;
  // A choice may invite a failure of its own, which the simulation rolls with
  // everything else rather than being told about after the fact.
  if (e.risk) ops.pending = [...(ops.pending || []), e.risk];
  ops.log.push({ call: call.id, title: call.title, option: option.label, dept: call.dept });
  return ops;
}

/**
 * How well a department head decides, 0..1.
 *
 * This is what the staff screen has been for all along. A day run by a good
 * Security Manager is a different day, and until now the only thing their
 * skill moved was a percentage on a summary nobody watched happen.
 */
export function deptCompetence(state, dept) {
  const bonus = state.staffBonus?.[dept] ?? 0;
  const management = state.staffBonus?.management ?? 0;
  // A department with nobody in it is guessing. A fully staffed one under a
  // good general manager is close to taking the right call every time, which
  // is the whole argument for the wage bill.
  return Math.max(0.12, Math.min(0.96, 0.18 + bonus * 2.2 + management * 0.6));
}

/**
 * Score an option as the department head would: what it costs against what it
 * prevents. Deliberately not a lookup of "the right answer" - a weak head
 * genuinely picks worse, rather than picking well and being taxed for it.
 */
export function scoreOption(option, ctx, risks) {
  const e = option.effect || {};
  const byKey = new Map(risks.map((r) => [r.key, r]));
  let score = 0;
  for (const [key, amount] of Object.entries(e.guard || {})) {
    const r = byKey.get(key);
    if (!r) { score += amount * 2; continue; }
    // Worth the expected damage avoided, at the scale of the crowd.
    const harm = Math.abs(r.satisfaction || 0) * 900
      + Math.abs(r.reputation || 0) * 6_000 + (r.cost || 0);
    score += r.chance * amount * harm * 0.001;
  }
  score += (e.sat || 0) * 1.1;
  score += ((e.gate ?? 1) - 1) * 22;
  score += ((e.fill ?? 1) - 1) * 30;
  score += ((e.spend ?? 1) - 1) * 26;
  score += ((e.price ?? 1) - 1) * 34;
  score += (e.revenue || 0) * 0.0006;
  score -= (e.cost || 0) * 0.0005;
  for (const v of Object.values(e.rep || {})) score += v * 1.4;
  if (e.risk) {
    const harm = Math.abs(e.risk.satisfaction || 0) * 1.1
      + Math.abs(e.risk.reputation || 0) * 6 + (e.risk.cost || 0) * 0.0006;
    score -= e.risk.chance * harm * 1.5;
  }
  return score;
}

/**
 * The choice a department head makes. Competence decides how close to the best
 * option they land: at 1.0 they take it, at 0.34 they are barely better than
 * a coin toss, which is roughly what an unstaffed department deserves.
 */
export function autoChoose(call, ctx, risks, competence, rng) {
  const scored = call.options.map((o) => ({ o, s: scoreOption(o, ctx, risks) }));
  scored.sort((a, b) => b.s - a.s);
  if (rng.chance(competence)) return scored[0].o;
  // Not the best one, and flat across the rest rather than nudged toward the
  // top of it. Biasing the fallback meant an unstaffed department reliably
  // took the second-best option, which is barely a mistake - so hiring nobody
  // cost almost nothing and the staff screen stayed decorative.
  const rest = scored.slice(1);
  if (!rest.length) return scored[0].o;
  return rest[Math.min(rest.length - 1, Math.floor(rng() * rest.length))].o;
}

/**
 * Play the whole day without a human, as the sims and every unwatched event do.
 * Returns the ops the simulation should read.
 */
export function autoMatchday(ev, venue, state) {
  const day = buildDay(ev, venue, state);
  const ops = createOps();
  const rng = makeRng(hashString(`${ev.uid}:auto:${ev.seed}`));
  for (const phase of day.phases) {
    for (const call of phase.calls) {
      if (!call.options.length) continue;
      const competence = deptCompetence(state, call.dept);
      const chosen = autoChoose(call, day.ctx, day.risks, competence, rng);
      applyOption(ops, call, chosen, day.ctx);
    }
  }
  return finishOps(ops, day);
}

/**
 * Close the day out: turn the failures its own decisions invited into real
 * incident rows the simulation will roll.
 */
export function finishOps(ops, day) {
  const rng = makeRng(hashString(`ops:${(ops.log || []).map((l) => l.option).join('|')}`));
  for (const r of ops.pending || []) {
    if (!rng.chance(r.chance)) continue;
    ops.incidents.push({
      key: r.key, text: r.text,
      satisfaction: r.satisfaction || 0,
      reputation: r.reputation || 0,
      community: r.community || 0,
      cost: r.cost || 0,
      invited: true,
    });
  }
  delete ops.pending;
  ops.phases = (day?.phases || []).length;
  return ops;
}

/**
 * An interactive matchday, held open across turns while the player decides.
 *
 * Only one runs at a time, and it lives on the game rather than in the save:
 * a day half-played is not a thing worth persisting, and reloading mid-event
 * simply resolves it the way an unwatched one would.
 */
export class MatchdaySession {
  constructor(ev, venue, state, contract) {
    this.ev = ev;
    this.venue = venue;
    this.state = state;
    this.contract = contract;
    const day = buildDay(ev, venue, state);
    this.ctx = day.ctx;
    this.risks = day.risks;
    this.phases = day.phases;
    this.ops = createOps();
    this.phaseIndex = 0;
    this.callIndex = 0;
    this.done = this.phases.length === 0;
    this.history = [];
  }

  get phase() { return this.phases[this.phaseIndex] || null; }
  get call() { return this.phase?.calls[this.callIndex] || null; }

  /** How far through the day, for a progress bar that means something. */
  get progress() {
    const total = this.phases.reduce((n, p) => n + p.calls.length, 0) || 1;
    let done = 0;
    for (let i = 0; i < this.phaseIndex; i++) done += this.phases[i].calls.length;
    return Math.min(1, (done + this.callIndex) / total);
  }

  /** What the day looks like so far, for the running readout. */
  summary() {
    return {
      cost: Math.round(this.ops.cost),
      revenue: Math.round(this.ops.revenue),
      satisfaction: this.ops.satisfaction,
      guarded: Object.keys(this.ops.guard).length,
      decisions: this.ops.log.length,
      gate: this.ops.gate,
      fill: this.ops.fill,
    };
  }

  /** Take one decision. Returns what it did, and what comes next. */
  choose(optionIndex) {
    const call = this.call;
    if (!call || this.done) return { error: 'The day is over.' };
    const option = call.options.find((o) => o.index === optionIndex) || call.options[0];
    applyOption(this.ops, call, option, this.ctx);
    this.history.push({ phase: this.phase.name, call: call.title, option: option.label });
    this.advance();
    return { ok: true, option, done: this.done };
  }

  /** Hand this one to the department head. */
  delegate() {
    const call = this.call;
    if (!call || this.done) return { error: 'The day is over.' };
    const rng = makeRng(hashString(`${this.ev.uid}:delegate:${this.ops.log.length}`));
    const chosen = autoChoose(call, this.ctx, this.risks,
      deptCompetence(this.state, call.dept), rng);
    return this.choose(chosen.index);
  }

  /** Walk away and let the staff run the rest of it. */
  delegateRest() {
    let guard = 0;
    while (!this.done && guard++ < 64) this.delegate();
    return this.finish();
  }

  advance() {
    this.callIndex++;
    while (this.phaseIndex < this.phases.length
      && this.callIndex >= this.phases[this.phaseIndex].calls.length) {
      this.phaseIndex++;
      this.callIndex = 0;
    }
    if (this.phaseIndex >= this.phases.length) this.done = true;
  }

  /** The ops to hand the simulation. */
  finish() {
    this.done = true;
    return finishOps(this.ops, { phases: this.phases });
  }
}

export { PHASES, PHASE_KEYS, MATCHDAY_CALLS, CALL_BY_ID };
