import { TIER_LABEL } from '../venues/ratings.js';

/**
 * Check an event's requirements against a *detected* venue.
 * Every line is reported with the actual measured value so the player can see
 * exactly what to build next.
 *
 * @returns {{ok:boolean, lines:Array, blocking:number}}
 */
export function checkRequirements(ev, venue, state) {
  const lines = [];
  if (!venue) {
    return { ok: false, blocking: 1, lines: [{ label: 'A registered venue', ok: false, have: 'none', need: 'build one' }] };
  }
  const m = venue.ratings.measures;

  for (const r of ev.req) {
    switch (r.key) {
      case 'capacity':
        lines.push(row(r.label, venue.capacity.total >= r.min,
          venue.capacity.total.toLocaleString(), r.min.toLocaleString()));
        break;
      case 'rating':
        lines.push(row(r.label, venue.ratings.overall >= r.min, venue.ratings.overall, r.min));
        break;
      case 'reputation':
        lines.push(row(r.label, state.reputation.venue >= r.min,
          Math.round(state.reputation.venue), r.min));
        break;
      case 'field': {
        const ok = !!venue.field && venue.field.regulation >= 1 && venue.field.surfaceOk
          && (!r.sport || venue.sport === r.sport);
        const have = venue.field
          ? `${venue.sportName} ${venue.field.w * 2}m x ${venue.field.d * 2}m`
          : 'none';
        lines.push(row(r.label, ok, have, r.sport ? sportName(r.sport) : 'regulation'));
        break;
      }
      case 'parking': {
        const cars = venue.parkingCars + Math.round(venue.capacity.total * state.transitShare / 2.6);
        lines.push(row(r.label, cars >= r.min, cars.toLocaleString(), r.min.toLocaleString()));
        break;
      }
      case 'measure': {
        const have = measureValue(venue, r.measure);
        // Compare at the precision the player is shown. Comparing raw values
        // produced lines that read "have 50%, need 50%" and still failed,
        // which is unarguable from the player's side of the screen.
        lines.push(row(r.label, Math.round(have * 100) >= Math.round(r.min * 100),
          pctText(have), pctText(r.min)));
        break;
      }
      default:
        lines.push(row(r.label || r.key, true, '-', '-'));
    }
  }

  const blocking = lines.filter((l) => !l.ok).length;
  return { ok: blocking === 0, blocking, lines };
}

function measureValue(venue, key) {
  const m = venue.ratings.measures;
  if (key === 'crowd') return venue.ratings.crowdFlow / 100;
  if (key === 'safety') return venue.ratings.safety / 100;
  if (key === 'comfort') return venue.ratings.comfort / 100;
  if (key === 'appearance') return venue.ratings.appearance / 100;
  return m[key] ?? 0;
}

const row = (label, ok, have, need) => ({ label, ok, have: String(have), need: String(need) });
const pctText = (v) => `${Math.round(v * 100)}%`;

const SPORT_NAMES = {
  football: 'Football', rugby: 'Rugby', cricket: 'Cricket', afl: 'Australian Rules',
  basketball: 'Basketball', tennis: 'Tennis', athletics: 'Athletics',
  swimming: 'Swimming', ice: 'Ice', combat: 'Combat', baseball: 'Baseball',
  esports: 'Esports', concert: 'Any surface', ceremony: 'Any surface',
};
export function sportName(s) { return SPORT_NAMES[s] || s; }

/** Pick the player venue best suited to an event. */
export function bestVenueFor(ev, venues, state) {
  let best = null, bestScore = -1, bestCheck = null;
  for (const v of venues) {
    const sportOk = !ev.req.some((r) => r.key === 'field') || v.sport === ev.sport;
    const c = checkRequirements(ev, v, state);
    const score = (c.ok ? 1000 : 0) - c.blocking * 10 + (sportOk ? 50 : 0)
      + v.ratings.overall / 10 + Math.min(20, v.capacity.total / 5000);
    if (score > bestScore) { bestScore = score; best = v; bestCheck = c; }
  }
  return { venue: best, check: bestCheck };
}

export { TIER_LABEL };
