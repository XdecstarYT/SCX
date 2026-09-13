import { ANGLE_BY_ID, eligibleAngles, anglesForBase } from '../data/eventAngles.js';

/**
 * Compose a concrete event out of a base fixture and an occasion.
 *
 * The base says what sport it is, roughly how big, and who runs it. The angle
 * says what *this* one is: a derby, a testimonial, a washout being replayed, a
 * broadcaster wanting it at night. The composition is where the board stopped
 * being a list of sixty-nine things and became a few thousand.
 *
 * Everything a template exposes is produced here, so `instantiate` and the
 * whole bid path downstream cannot tell a composed event from an authored one.
 * That is deliberate: it means angles cost nothing to add and nothing to trust.
 */

/** Multiply a number by an angle's factor, keeping it sane. */
const scale = (v, f, fallback = 1) => (v || 0) * (f ?? fallback);

/**
 * Requirements merge rather than append: two angles both asking for Medical
 * should leave one line at the stricter of the two, not two lines the player
 * has to read twice.
 */
export function mergeRequirements(...lists) {
  const out = [];
  const index = new Map();
  for (const list of lists) {
    for (const r of list || []) {
      const key = r.key === 'measure' ? `measure:${r.measure}` : r.key;
      const at = index.get(key);
      if (at === undefined) { index.set(key, out.length); out.push({ ...r }); continue; }
      const prev = out[at];
      // Same kind of requirement twice: keep whichever asks for more.
      if (typeof r.min === 'number' && typeof prev.min === 'number' && r.min > prev.min) {
        out[at] = { ...r };
      }
    }
  }
  return out;
}

/**
 * Apply an angle to a base. Returns a template-shaped object; it never mutates
 * the base, because the base is shared module data and a composed event that
 * wrote back into it would leak into every other game in the process.
 */
export function compose(base, angle) {
  if (!angle || angle.id === 'plain') {
    // The requirement list is copied even though nothing is being added to it:
    // spreading the base would hand back the shared table's own array, and
    // anything that later edited it would edit every game in the process.
    return {
      ...base, req: base.req.map((r) => ({ ...r })),
      angleId: 'plain', baseId: base.id, id: `${base.id}`,
    };
  }
  const m = angle.mult || {};
  const days = Math.max(1, (base.days || 1) + (angle.days || 0));
  return {
    ...base,
    id: `${base.id}+${angle.id}`,
    baseId: base.id,
    angleId: angle.id,
    name: angle.name ? angle.name(base) : base.name,
    blurb: angle.blurb ? angle.blurb(base) : base.blurb,
    popularity: Math.min(1.25, scale(base.popularity, m.pop)),
    base: Math.max(1, Math.round(scale(base.base, m.base))),
    fee: Math.max(0, Math.round(scale(base.fee, m.fee))),
    bid: [
      Math.max(0, Math.round(scale(base.bid[0], m.bid))),
      Math.max(1, Math.round(scale(base.bid[1], m.bid))),
    ],
    days,
    risk: Math.min(0.85, scale(base.risk, m.risk)),
    prestige: Math.max(1, Math.round(scale(base.prestige, m.prestige))),
    community: Math.round(scale(base.community || 0, m.community, 1)),
    wear: +scale(base.wear || 1, m.wear).toFixed(2),
    req: mergeRequirements(base.req, angle.req),
    lead: angle.lead || null,
  };
}

/**
 * Pick an angle for a base, weighted, from the ones this save allows.
 *
 * The weighting is not uniform on purpose. "Plain" carries the heaviest weight
 * of any single angle, because a board where every fixture is a derby or a
 * testimonial is a board where none of them reads as an occasion.
 */
export function pickAngle(state, base, rng) {
  const pool = eligibleAngles(state, base);
  if (!pool.length) return ANGLE_BY_ID.get('plain');
  const total = pool.reduce((n, a) => n + (a.weight || 1), 0);
  let roll = rng.range(0, total);
  for (const a of pool) {
    roll -= (a.weight || 1);
    if (roll <= 0) return a;
  }
  return pool[pool.length - 1];
}

/** Base plus a weighted angle, ready for `instantiate`. */
export function composeEvent(state, base, rng) {
  return compose(base, pickAngle(state, base, rng));
}

/**
 * Every event the catalogue can produce, as composed templates. Used by the
 * tests to hold each one to the same rules an authored template obeys, and by
 * the sim to sweep the whole space rather than the sixty-nine it started from.
 */
export function everyComposition(templates) {
  const out = [];
  for (const base of templates) {
    for (const angle of anglesForBase(base)) out.push(compose(base, angle));
  }
  return out;
}
