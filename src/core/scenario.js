import { SCENARIO_BY_ID, rankFor, YEAR } from '../data/scenarios.js';

/**
 * Scenario runtime.
 *
 * A scenario is the same game with three differences: somebody else built the
 * starting position, there is a list of things to achieve, and there is a
 * clock. Nothing here changes the rules - every objective reads the same state
 * the rest of the game does, so a scenario cannot be scored on a number the
 * player is not shown.
 *
 * Running out of time is not a game over. The complex is still yours and the
 * sandbox carries on; you simply did not do it inside the deadline, and the
 * scorecard says so.
 */
export function createScenarioState(def) {
  return {
    id: def.id,
    startedDay: 1,
    deadlineDay: Math.round(def.years * YEAR) + 1,
    done: [],              // objective ids completed, in order
    finished: false,
    outcome: null,         // 'won' | 'timeout'
    rank: null,
    finishedDay: null,
  };
}

/** Progress on every objective, in the order the brief lists them. */
export function scenarioProgress(state) {
  const run = state.scenario;
  if (!run) return null;
  const def = SCENARIO_BY_ID.get(run.id);
  if (!def) return null;
  const objectives = def.objectives.map((o) => {
    let value = 0;
    try { value = Math.max(0, Math.min(1, o.progress(state) || 0)); } catch { value = 0; }
    let detail = '';
    try { detail = o.detail ? o.detail(state) : ''; } catch { detail = ''; }
    return { ...o, value, detail, complete: value >= 1 };
  });
  const complete = objectives.filter((o) => o.complete).length;
  return {
    def,
    run,
    objectives,
    complete,
    total: objectives.length,
    overall: objectives.reduce((s, o) => s + o.value, 0) / objectives.length,
    daysLeft: Math.max(0, run.deadlineDay - state.day),
    daysUsed: state.day - run.startedDay,
    expired: state.day >= run.deadlineDay,
  };
}

/**
 * Advance the scenario by a day. Returns an event worth telling the player
 * about - an objective ticked off, the clock run out, the whole thing won -
 * or null on the great majority of days when nothing happened.
 */
export function tickScenario(state) {
  const run = state.scenario;
  if (!run || run.finished) return null;
  const p = scenarioProgress(state);
  if (!p) return null;

  for (const o of p.objectives) {
    if (o.complete && !run.done.includes(o.id)) {
      run.done.push(o.id);
      if (p.complete < p.total) return { kind: 'objective', objective: o, left: p.total - p.complete };
    }
  }

  if (p.complete === p.total) {
    run.finished = true;
    run.outcome = 'won';
    run.finishedDay = state.day;
    run.rank = rankFor(p.daysUsed, p.def.years)?.key || 'bronze';
    return { kind: 'won', rank: run.rank, days: p.daysUsed, def: p.def };
  }
  if (p.expired) {
    run.finished = true;
    run.outcome = 'timeout';
    run.finishedDay = state.day;
    return { kind: 'timeout', complete: p.complete, total: p.total, def: p.def };
  }
  return null;
}

/** A one-line scorecard for the HUD. */
export function scenarioLabel(state) {
  const p = scenarioProgress(state);
  if (!p) return null;
  if (p.run.finished) {
    return p.run.outcome === 'won'
      ? `${p.def.name} — ${p.run.rank.toUpperCase()}`
      : `${p.def.name} — out of time`;
  }
  const yearsLeft = p.daysLeft / YEAR;
  return `${p.def.name} · ${p.complete}/${p.total} · `
    + (yearsLeft >= 1 ? `${yearsLeft.toFixed(1)} years left` : `${p.daysLeft} days left`);
}

export { SCENARIO_BY_ID, rankFor, YEAR };
