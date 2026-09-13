import { PROGRAMMES, PROGRAMME_BY_ID, programmeSlots } from '../data/programmes.js';

/**
 * Running the place between events.
 *
 * A programme is started, occupies a slot for weeks, costs money every day it
 * runs, and then leaves something behind for good. The state it keeps is
 * small on purpose: what is running, what has finished, and the accumulated
 * effects - everything else is derived, so a save is a list of ids rather than
 * a pile of recomputed numbers that can drift out of step with the table.
 */

export function createProgrammeState() {
  return {
    active: [],     // [{ id, startedDay, endsDay, paid }]
    completed: [],  // [{ id, day }]
    effects: {      // the accumulated, permanent result
      measure: {}, rating: {}, staff: {},
      income: 0, costMult: 1, buildMult: 1, gate: 1, spend: 1,
      unlocked: [],
    },
  };
}

/** How many times a programme has already been run here. */
export function timesRun(state, id) {
  return (state.programmes?.completed || []).filter((c) => c.id === id).length;
}

/**
 * Whether the complex meets a programme's entry requirement, and what is
 * missing if it does not. Reads the live analysis rather than a stored copy.
 */
export function requirementLines(state, def, venue) {
  const m = venue?.ratings?.measures || {};
  return (def.req || []).map((r) => {
    let have = 0;
    if (r.key === 'capacity') have = venue?.capacity?.total ?? 0;
    else if (r.key === 'rating') have = venue?.ratings?.overall ?? 0;
    else if (r.key === 'reputation') have = state.reputation?.venue ?? 0;
    else if (r.key === 'events') have = state.stats?.eventsHosted ?? 0;
    else if (r.key === 'measure') have = m[r.measure] ?? 0;
    else if (r.key === 'tenant') have = (state.league?.tenants || []).length;
    return { ...r, have, ok: have >= r.min };
  });
}

/** Everything the player could start right now, with the reason if they cannot. */
export function available(state, venue) {
  const p = state.programmes;
  const running = new Set((p?.active || []).map((a) => a.id));
  const slots = programmeSlots(state);
  const free = slots - (p?.active || []).length;

  return PROGRAMMES.map((def) => {
    const lines = requirementLines(state, def, venue);
    const runs = timesRun(state, def.id);
    const limit = def.repeat ?? 1;
    let blocked = null;
    if (running.has(def.id)) blocked = 'Already running.';
    else if (runs >= limit) {
      blocked = limit === 1 ? 'Done. Once is enough.' : `Run ${runs} times; that is the limit.`;
    } else if (!lines.every((l) => l.ok)) blocked = 'Not yet.';
    else if (free <= 0) blocked = 'No free slot.';
    else if ((state.cash ?? 0) < def.cost) blocked = 'Cannot afford it.';
    return { def, lines, runs, limit, blocked, canStart: !blocked };
  });
}

/** What is running, with how far through it is. */
export function activeProgrammes(state) {
  return (state.programmes?.active || []).map((a) => {
    const def = PROGRAMME_BY_ID.get(a.id);
    const total = Math.max(1, a.endsDay - a.startedDay);
    const done = Math.max(0, state.day - a.startedDay);
    return {
      ...a, def,
      progress: Math.max(0, Math.min(1, done / total)),
      daysLeft: Math.max(0, a.endsDay - state.day),
    };
  });
}

/** Fold a finished programme's effect into the standing totals. */
export function applyEffect(effects, effect = {}) {
  for (const [k, v] of Object.entries(effect.measure || {})) {
    effects.measure[k] = +((effects.measure[k] || 0) + v).toFixed(4);
  }
  for (const [k, v] of Object.entries(effect.rating || {})) {
    effects.rating[k] = (effects.rating[k] || 0) + v;
  }
  for (const [k, v] of Object.entries(effect.staff || {})) {
    effects.staff[k] = +((effects.staff[k] || 0) + v).toFixed(4);
  }
  effects.income += effect.income || 0;
  // Multipliers compound, and are floored so a stack of savings programmes
  // cannot drive a running cost to nothing.
  if (effect.costMult) effects.costMult = Math.max(0.55, effects.costMult * effect.costMult);
  if (effect.buildMult) effects.buildMult = Math.max(0.6, effects.buildMult * effect.buildMult);
  if (effect.gate) effects.gate = Math.min(3, effects.gate * effect.gate);
  if (effect.spend) effects.spend = Math.min(2, effects.spend * effect.spend);
  if (effect.unlock && !effects.unlocked.includes(effect.unlock)) {
    effects.unlocked.push(effect.unlock);
  }
  return effects;
}

/**
 * A day passes. Returns anything that finished, so the game can announce it.
 * The upkeep is charged by the caller, which owns the ledger.
 */
export function tickProgrammes(state) {
  const p = state.programmes;
  if (!p) return { finished: [], upkeep: 0 };
  let upkeep = 0;
  const finished = [];
  const still = [];
  for (const a of p.active) {
    const def = PROGRAMME_BY_ID.get(a.id);
    if (!def) continue;
    upkeep += def.upkeep || 0;
    if (state.day >= a.endsDay) {
      applyEffect(p.effects, def.effect);
      p.completed.push({ id: def.id, day: state.day });
      finished.push(def);
    } else still.push(a);
  }
  p.active = still;
  return { finished, upkeep };
}

/**
 * A one-line summary of what all the finished programmes add up to, for the
 * screen. Reading the effects object directly would be a list of keys; this is
 * the sentence a manager would say.
 */
export function effectSummary(state) {
  const e = state.programmes?.effects;
  if (!e) return [];
  const out = [];
  if (e.income) out.push({ label: 'Programme income', value: `${Math.round(e.income).toLocaleString()} a day` });
  if (e.costMult < 1) out.push({ label: 'Running costs', value: `${Math.round((1 - e.costMult) * 100)}% lower` });
  if (e.buildMult < 1) out.push({ label: 'Construction', value: `${Math.round((1 - e.buildMult) * 100)}% cheaper` });
  if (e.gate > 1) out.push({ label: 'Gate throughput', value: `${Math.round((e.gate - 1) * 100)}% faster` });
  if (e.spend > 1) out.push({ label: 'Spend per head', value: `${Math.round((e.spend - 1) * 100)}% higher` });
  for (const [k, v] of Object.entries(e.rating || {})) {
    if (v) out.push({ label: `${k} rating`, value: `+${v}` });
  }
  const staff = Object.entries(e.staff || {}).filter(([, v]) => v);
  if (staff.length) {
    out.push({ label: 'Departments strengthened', value: staff.map(([k]) => k).join(', ') });
  }
  return out;
}

export { PROGRAMMES, PROGRAMME_BY_ID, programmeSlots };
