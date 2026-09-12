/**
 * Scenario results, kept outside the save.
 *
 * A scenario record belongs to the player, not to a complex: you want to see
 * that you took gold on The White Elephant while you are looking at a
 * completely different game. It lives in its own key so importing somebody
 * else's save cannot hand you their medals.
 */
const KEY = 'sct.scenarios.v1';
const ORDER = { bronze: 1, silver: 2, gold: 3 };

export function loadScenarioRecords() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}

/** Keep the best rank only; a second bronze does not replace a gold. */
export function recordScenario(id, rank) {
  if (!id || !rank) return;
  try {
    const all = loadScenarioRecords();
    if ((ORDER[all[id]] || 0) >= (ORDER[rank] || 0)) return;
    all[id] = rank;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private browsing, a full quota - a medal is not worth throwing for */
  }
}
