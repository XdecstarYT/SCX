import { ZONE_BY_ID, zone } from '../data/zones.js';
import { block, blockId } from '../data/blocks.js';
import { climateEffects } from '../data/cities.js';

/**
 * ---------------------------------------------------------------------------
 * THE PLAYING SURFACE
 * ---------------------------------------------------------------------------
 * A pitch was one number on the whole complex that drifted up in bad weather
 * and down when you employed a groundskeeper. That is fine as a modifier and
 * useless as a thing to manage: it was the same for every venue on the site,
 * you could not do anything about it on any particular day, and nothing you
 * bought ever changed how it behaved.
 *
 * So each playing surface now has its own condition, its own drainage and its
 * own kit under it. Weather works on it, events tear it up, the ground staff
 * put it back, and what you have installed decides how fast each of those
 * happens. On the morning of a fixture it gets inspected, and a pitch that
 * fails is a fixture that does not happen.
 */

/** Surfaces wear, recover and freeze differently. */
export const SURFACES = {
  turf:       { name: 'Natural turf',   wear: 1.00, recover: 1.00, frost: 1.00, soak: 1.00 },
  turf_synth: { name: 'Synthetic turf', wear: 0.30, recover: 2.60, frost: 0.25, soak: 0.30 },
  hybrid:     { name: 'Hybrid turf',    wear: 0.52, recover: 1.70, frost: 0.70, soak: 0.55 },
  clay:       { name: 'Clay',           wear: 1.30, recover: 1.40, frost: 0.80, soak: 1.60 },
  sand:       { name: 'Sand',           wear: 0.70, recover: 1.80, frost: 0.40, soak: 0.30 },
  sand_court: { name: 'Beach sand',     wear: 0.70, recover: 1.80, frost: 0.40, soak: 0.30 },
  track:      { name: 'Synthetic track',wear: 0.25, recover: 2.00, frost: 0.30, soak: 0.35 },
  hardwood:   { name: 'Hardwood',       wear: 0.30, recover: 1.80, frost: 0.10, soak: 0.10 },
  gym_floor:  { name: 'Sprung floor',   wear: 0.30, recover: 1.80, frost: 0.10, soak: 0.10 },
  ice:        { name: 'Ice',            wear: 0.90, recover: 2.40, frost: 0.00, soak: 0.10 },
  pool:       { name: 'Water',          wear: 0.10, recover: 3.00, frost: 0.20, soak: 0.00 },
};

const DEFAULT_SURFACE = { name: 'Surface', wear: 0.6, recover: 1.6, frost: 0.4, soak: 0.4 };
export const surfaceOf = (key) => SURFACES[key] || DEFAULT_SURFACE;

/**
 * Work you can order on a pitch. Each takes the surface out of use while it
 * happens, which is the whole tension: the week you most want to relay it is
 * the week you have three fixtures.
 */
export const TREATMENTS = [
  {
    id: 'mow', name: 'Mow and mark', days: 1, cost: 900, restore: 0.08, closes: false,
    hint: 'A cut and fresh lines. Cosmetic, quick, and it is what a pitch looks like on television.',
  },
  {
    id: 'aerate', name: 'Aerate and sand', days: 2, cost: 4_200, restore: 0.22, closes: true,
    hint: 'Spikes the surface and dresses it. Helps the ground take water for weeks afterwards.',
    drainDays: 30,
  },
  {
    id: 'reseed', name: 'Reseed worn areas', days: 5, cost: 14_000, restore: 0.45, closes: true,
    hint: 'Patches the goalmouths and the centre circle. The obvious answer to a hard season.',
  },
  {
    id: 'relay', name: 'Relay the whole pitch', days: 14, cost: 120_000, restore: 1, closes: true,
    hint: 'A new surface, end to end. Two weeks with no fixtures and it is as good as the day it was laid.',
  },
];
export const TREATMENT_BY_ID = new Map(TREATMENTS.map((t) => [t.id, t]));

/**
 * Permanent kit. Unlike a treatment, this changes how the pitch behaves from
 * then on rather than putting it back where it was.
 */
export const PITCH_UPGRADES = [
  {
    id: 'drainage1', name: 'Piped drainage', cost: 60_000, upkeep: 1.2,
    hint: 'Lateral pipes under the surface. Rain drains instead of sitting on it.',
  },
  {
    id: 'drainage2', name: 'Vacuum drainage', cost: 240_000, upkeep: 4.0, needs: 'drainage1',
    unlock: 'pitch_tech',
    hint: 'Pulls standing water off in minutes. A waterlogged pitch stops being a thing that happens to you.',
  },
  {
    id: 'heating', name: 'Undersoil heating', cost: 180_000, upkeep: 6.5, power: 0.12,
    unlock: 'pitch_tech',
    hint: 'Pipes warm water under the surface. Frost stops postponing your fixtures.',
  },
  {
    id: 'growlights', name: 'Grow lighting rigs', cost: 95_000, upkeep: 3.4, power: 0.08,
    unlock: 'pitch_tech',
    hint: 'Grass under a big roof never sees the sun. These are how a covered pitch recovers at all.',
  },
  {
    id: 'hybrid', name: 'Hybrid turf conversion', cost: 320_000, upkeep: 2.2, unlock: 'adv_surfaces',
    hint: 'Stitches synthetic fibres through the root zone. Takes half again as much football before it gives up.',
  },
];
export const UPGRADE_BY_ID = new Map(PITCH_UPGRADES.map((u) => [u.id, u]));

export function createPitchState() {
  return { byVenue: {} };
}

/** The record for one venue, created on first sight. */
export function pitchFor(state, key) {
  const p = state.pitches || (state.pitches = createPitchState());
  let rec = p.byVenue[key];
  if (!rec) {
    rec = p.byVenue[key] = {
      condition: 1, upgrades: [], work: null, drainUntil: 0,
      lastPlayedDay: 0, eventsSince: 0, relaidDay: 0,
    };
  }
  return rec;
}

export const hasUpgrade = (rec, id) => !!rec && rec.upgrades.includes(id);

/** The surface a venue is actually played on, from its own field blocks. */
export function surfaceKeyFor(world, venue) {
  if (!venue?.centre) return 'turf';
  const y = Math.max(0, venue.field?.y ?? 0);
  const id = world.getBlock(Math.round(venue.centre.x), y, Math.round(venue.centre.z));
  return id ? block(id).key : 'turf';
}

/**
 * How well a pitch drains, 0 to 1. Drainage is the difference between a wet
 * week being an inconvenience and a wet week being a postponement.
 */
export function drainage(rec, surface) {
  const base = 1 - surface.soak * 0.55;
  const piped = hasUpgrade(rec, 'drainage1') ? 0.22 : 0;
  const vacuum = hasUpgrade(rec, 'drainage2') ? 0.3 : 0;
  const dressed = rec.drainUntil > 0 ? 0.08 : 0;
  return Math.max(0, Math.min(1, base + piped + vacuum + dressed));
}

/** Plain words for a condition, because 0.62 is not a thing a groundsman says. */
export function grade(condition) {
  if (condition >= 0.9) return 'Immaculate';
  if (condition >= 0.75) return 'Good';
  if (condition >= 0.6) return 'Playable';
  if (condition >= 0.42) return 'Worn';
  if (condition >= 0.25) return 'Poor';
  return 'Unplayable';
}

/**
 * A day of weather and recovery on every detected pitch.
 *
 * Returns the notices worth telling the player about, and the upkeep the
 * installed kit costs, which the caller charges.
 */
export function tickPitches(state, venues, world, opts = {}) {
  const p = state.pitches || (state.pitches = createPitchState());
  const climate = climateEffects(opts.cityId || 'meridian');
  const weather = opts.weather || 'sunny';
  const groundsBonus = opts.operations || 0;
  const notices = [];
  let upkeep = 0;
  let power = 0;

  // Rain that has nowhere to go is what actually ruins a surface; frost is the
  // other half, and heat the third.
  const rainToday = { storm: 0.9, rain: 0.55, cloudy: 0.06, sunny: 0, heat: 0 }[weather] ?? 0;
  const frostToday = weather === 'cold' || weather === 'snow' ? 0.7 : 0;
  const heatToday = weather === 'heat' ? 0.5 : 0;

  const live = new Set();
  for (const v of venues) {
    if (!v.key) continue;
    live.add(v.key);
    const rec = pitchFor(state, v.key);
    const surface = surfaceOf(hasUpgrade(rec, 'hybrid') ? 'hybrid' : surfaceKeyFor(world, v));
    if (rec.drainUntil > 0) rec.drainUntil--;

    // Work in progress finishes on its day.
    if (rec.work) {
      rec.work.daysLeft--;
      if (rec.work.daysLeft <= 0) {
        const t = TREATMENT_BY_ID.get(rec.work.id);
        rec.condition = Math.min(1, rec.condition + (t?.restore ?? 0));
        if (t?.id === 'relay') { rec.condition = 1; rec.relaidDay = state.day; rec.eventsSince = 0; }
        if (t?.drainDays) rec.drainUntil = t.drainDays;
        notices.push({ key: v.key, name: v.name || v.sportName, text: `${t?.name} finished. The surface is ${grade(rec.condition).toLowerCase()}.` });
        rec.work = null;
      }
      continue;     // nothing else happens to a pitch that is being worked on
    }

    const drain = drainage(rec, surface);
    const covered = v.roofCoverage || 0;
    const exposure = 1 - covered * 0.85;

    // Damage.
    let damage = 0;
    damage += rainToday * (1 - drain) * 0.12 * exposure * climate.pitchWear;
    damage += heatToday * 0.05 * exposure * (1 - (surface.soak < 0.4 ? 0.5 : 0));
    if (frostToday && !hasUpgrade(rec, 'heating')) damage += frostToday * surface.frost * 0.09 * exposure;

    // Recovery. Grass under a roof does not grow without help.
    const lightPenalty = covered > 0.6 && !hasUpgrade(rec, 'growlights') ? 0.45 : 1;
    const recovery = (0.018 + groundsBonus * 0.06) * surface.recover * lightPenalty;

    const before = rec.condition;
    rec.condition = Math.max(0, Math.min(1, rec.condition + recovery - damage));

    // Tell the player when it crosses a line, not every day.
    if (before >= 0.42 && rec.condition < 0.42) {
      notices.push({ key: v.key, name: v.name || v.sportName, warn: true,
        text: 'The surface has gone. It will not pass an inspection in this state.' });
    }
  }

  // Forget pitches whose venue no longer exists, so a demolished ground does
  // not go on costing money for ever.
  for (const key of Object.keys(p.byVenue)) {
    if (!live.has(key)) { delete p.byVenue[key]; continue; }
    for (const id of p.byVenue[key].upgrades) {
      const u = UPGRADE_BY_ID.get(id);
      if (u) { upkeep += u.upkeep || 0; power += u.power || 0; }
    }
  }
  return { notices, upkeep, power };
}

/** Wear from staging an event, applied when one is played. */
export function playEventOn(state, venueKey, ev, world, venue) {
  const rec = pitchFor(state, venueKey);
  const surface = surfaceOf(hasUpgrade(rec, 'hybrid') ? 'hybrid' : surfaceKeyFor(world, venue));
  // A concert on the grass is far worse than a match on it: the stage and the
  // standing crowd sit on the same square for three days.
  const heavy = ev?.sport === 'concert' || ev?.template?.sport === 'concert';
  const wear = (heavy ? 0.26 : 0.07) * surface.wear;
  rec.condition = Math.max(0, rec.condition - wear);
  rec.lastPlayedDay = state.day;
  rec.eventsSince++;
  return rec.condition;
}

/**
 * The morning inspection. A referee walks the pitch and decides, and what he
 * decides depends on the surface, the weather and what you have under it.
 */
export function inspect(state, venueKey, opts = {}) {
  const rec = pitchFor(state, venueKey);
  const weather = opts.weather || 'sunny';
  const surface = surfaceOf(hasUpgrade(rec, 'hybrid') ? 'hybrid' : (opts.surfaceKey || 'turf'));
  const drain = drainage(rec, surface);

  if (rec.work && TREATMENT_BY_ID.get(rec.work.id)?.closes) {
    return { pass: false, risk: 1, reason: `${TREATMENT_BY_ID.get(rec.work.id).name} is still in progress.` };
  }

  // Risk of being called off, before the weather on the day.
  let risk = rec.condition >= 0.6 ? 0 : (0.6 - rec.condition) * 1.4;
  if (weather === 'storm') risk += (1 - drain) * 0.35;
  else if (weather === 'rain') risk += (1 - drain) * 0.16;
  if ((weather === 'cold' || weather === 'snow') && !hasUpgrade(rec, 'heating')) {
    risk += surface.frost * 0.3;
  }
  risk = Math.max(0, Math.min(0.95, risk));

  const reason = risk <= 0 ? null
    : rec.condition < 0.42 ? 'The surface is too worn to be safe.'
    : weather === 'storm' || weather === 'rain' ? 'Standing water on a pitch that cannot take it.'
    : 'Frost, and nothing under the surface to lift it.';
  return { pass: risk < 0.5, risk, reason, condition: rec.condition, drainage: drain };
}

/**
 * What the surface is worth to an event held on it. A poor pitch is a poor
 * spectacle and a more dangerous one, and everybody watching can tell.
 */
export function conditionEffect(condition) {
  const c = Math.max(0, Math.min(1, condition));
  return {
    quality: -0.22 + c * 0.28,              // -0.22 unplayable .. +0.06 immaculate
    satisfaction: Math.round((c - 0.75) * 14),
    injuryRisk: Math.max(0, (0.7 - c)) * 0.5,
  };
}

/** Order work on a pitch. The caller charges for it. */
export function orderTreatment(state, venueKey, id) {
  const t = TREATMENT_BY_ID.get(id);
  if (!t) return { error: 'No such work.' };
  const rec = pitchFor(state, venueKey);
  if (rec.work) return { error: `${TREATMENT_BY_ID.get(rec.work.id)?.name} is already under way.` };
  if (rec.condition >= 0.995 && t.id !== 'mow') return { error: 'The surface is already perfect.' };
  rec.work = { id, daysLeft: t.days, startedDay: state.day };
  return { ok: true, treatment: t, cost: t.cost };
}

/** Install permanent kit under or over a pitch. The caller charges for it. */
export function installUpgrade(state, venueKey, id) {
  const u = UPGRADE_BY_ID.get(id);
  if (!u) return { error: 'No such installation.' };
  const rec = pitchFor(state, venueKey);
  if (hasUpgrade(rec, id)) return { error: `${u.name} is already installed.` };
  if (u.needs && !hasUpgrade(rec, u.needs)) {
    return { error: `${UPGRADE_BY_ID.get(u.needs)?.name} has to go in first.` };
  }
  rec.upgrades.push(id);
  if (id === 'hybrid') { rec.condition = 1; rec.relaidDay = state.day; }
  return { ok: true, upgrade: u, cost: u.cost };
}

/** Everything the pitches screen needs, in one call. */
export function pitchReport(state, venues, world) {
  return venues.map((v) => {
    const rec = pitchFor(state, v.key);
    const surfaceKey = hasUpgrade(rec, 'hybrid') ? 'hybrid' : surfaceKeyFor(world, v);
    const surface = surfaceOf(surfaceKey);
    return {
      key: v.key,
      name: v.name || v.suggestedName || v.sportName,
      sport: v.sportName,
      condition: rec.condition,
      grade: grade(rec.condition),
      surface: surface.name,
      surfaceKey,
      drainage: drainage(rec, surface),
      covered: (v.roofCoverage || 0) > 0.6,
      upgrades: rec.upgrades.slice(),
      work: rec.work ? { ...rec.work, def: TREATMENT_BY_ID.get(rec.work.id) } : null,
      eventsSince: rec.eventsSince,
    };
  });
}
