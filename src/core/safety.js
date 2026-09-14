const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * ---------------------------------------------------------------------------
 * THE SAFETY CERTIFICATE
 * ---------------------------------------------------------------------------
 * Capacity was whatever you had built seats for. Every real ground in the
 * world has a second number: the figure the licensing authority will let you
 * actually sell to, which is lower, and which is set by the worst of your
 * exits, your stewarding, your medical cover and your last inspection.
 *
 * That second number is the interesting one, because it is the one you can
 * move without laying a single block - and because losing it is the only
 * thing in the game that takes capacity away from a ground that is still
 * standing.
 *
 * Every figure here is a fraction of built capacity, so the certificate is
 * always "you may sell this much of what you have", never a number invented
 * from nowhere.
 */

/** How long a certificate runs before it has to be renewed. */
export const CERTIFICATE_DAYS = 180;
/**
 * The crowd a ground may hold on nothing but common sense. Below this you
 * need no certificate; above it, the certificate is what lets you sell the
 * rest - so an uncertified stadium is not shut, it is just a small ground
 * until an inspector says otherwise.
 */
export const SMALL_GROUND = 5_000;
/**
 * Below this the ground is closed outright. It is deliberately low: a
 * prohibition notice is for a ground that is dangerous, not merely a poor
 * one, and the ordinary consequence of a poor ground is a small certificate.
 */
export const PROHIBITION_BELOW = 0.1;

/**
 * The things a certificate is assessed on. Each returns 0..1, and the
 * certificate is dragged down by the worst of them rather than the average -
 * a ground with immaculate medical cover and no way out is not a safe ground.
 */
export const CRITERIA = [
  {
    id: 'egress', name: 'Emergency egress', weight: 1.0,
    hint: 'Eight minutes to clear the ground. Exits, and enough separate ones.',
    score: (v) => Math.min(v.ratings.measures.exit ?? 0,
      clamp01((v.facilities.exitGates || 0) / Math.max(2, Math.ceil(v.capacity.total / 9000) + 1))),
  },
  {
    id: 'medical', name: 'Medical provision', weight: 0.8,
    hint: 'A treatment room and staff, scaled to the crowd you let in.',
    score: (v) => clamp01(v.ratings.measures.medical ?? 0),
  },
  {
    id: 'stewarding', name: 'Stewarding', weight: 0.9,
    hint: 'One steward per 250 spectators is the figure an inspector uses.',
    score: (v, s) => clamp01(stewardRatio(v, s)),
  },
  {
    id: 'circulation', name: 'Circulation', weight: 0.7,
    hint: 'Concourse and stairs wide enough that a full house can move.',
    score: (v) => clamp01((v.ratings.measures.concourse ?? 0) * 0.6
      + (v.ratings.measures.stairs ?? 0) * 0.4),
  },
  {
    id: 'structure', name: 'Structural condition', weight: 1.0,
    hint: 'Nothing over the crowd that is not held up.',
    score: (v) => (v.structuralWarnings > 0 ? Math.max(0, 1 - v.structuralWarnings * 0.25) : 1),
  },
  {
    id: 'access', name: 'Emergency access', weight: 0.6,
    hint: 'A route an ambulance and a fire appliance can use without the crowd.',
    score: (v, s, complex) => clamp01((complex?.emergencyRoad || 0)
      / Math.max(30, v.capacity.total / 900)),
  },
];

/** Stewards on duty per spectator, against the one-per-250 standard. */
export function stewardRatio(venue, state) {
  const cap = Math.max(1, venue.capacity.total);
  const employed = (state?.staff || []).filter((r) => r === 'stewards' || r?.roleId === 'stewards').length;
  const teams = employed || 0;
  // One steward team is 40 people; the standard is one per 250 spectators.
  const need = cap / 250;
  const have = teams * 40 + (state?.staffBonus?.security || 0) * 40;
  return need <= 0 ? 1 : have / need;
}

export function createSafetyState() {
  return { byVenue: {}, history: [] };
}

export function certFor(state, key) {
  const s = state.safety || (state.safety = createSafetyState());
  let rec = s.byVenue[key];
  if (!rec) {
    rec = s.byVenue[key] = {
      issuedDay: -1, expiresDay: -1, fraction: 0, capacity: 0,
      prohibited: false, lastScores: null, requestedDay: -1,
    };
  }
  return rec;
}

/**
 * Assess a venue as an inspector would. Pure: safe to call for the screen on
 * every render, and it is the same call that issues a certificate.
 */
export function assess(venue, state, complex) {
  const scores = CRITERIA.map((c) => ({
    id: c.id, name: c.name, hint: c.hint, weight: c.weight,
    score: clamp01(c.score(venue, state, complex)),
  }));

  // The worst criterion carries most of the weight, because that is how a
  // safety case works: you are as safe as your weakest link, not as safe as
  // your average one.
  const worst = scores.reduce((a, b) => (b.score < a.score ? b : a));
  const mean = scores.reduce((a, b) => a + b.score * b.weight, 0)
    / scores.reduce((a, b) => a + b.weight, 0);
  const blend = clamp01(worst.score * 0.55 + mean * 0.45);
  // Even a poor ground is licensed for something - a smaller crowd, packed
  // into the part of it that works. The certificate is a ceiling on how much
  // of what you built you may sell, and it starts at a third rather than at
  // nothing, so a first stadium is a constraint to work on and not a wall.
  const fraction = clamp01(0.32 + blend * 0.68);

  // A prohibition is about danger rather than provision: something over the
  // crowd that is not held up, or a ground that fails on every count at once.
  const structure = scores.find((c) => c.id === 'structure').score;
  const prohibited = structure < 0.5 || blend < PROHIBITION_BELOW;

  // A certificate never leaves you worse off than not having one: you could
  // always have opened as a small ground, so an inspection that came back
  // under that figure would only be a reason never to book one.
  const floor = Math.min(venue.capacity.total, SMALL_GROUND);
  const capacity = prohibited ? 0
    : Math.max(floor, Math.floor(venue.capacity.total * fraction));

  return {
    scores, worst, blend, prohibited,
    fraction: prohibited ? 0 : capacity / Math.max(1, venue.capacity.total),
    capacity,
    failing: scores.filter((c) => c.score < 0.5),
  };
}

/**
 * Issue or renew a certificate. The capacity is frozen at the moment of
 * issue - that is what a certificate is - so improving the ground does
 * nothing for your permitted capacity until an inspector comes back.
 */
export function issue(state, venue, complex, day = state.day) {
  const rec = certFor(state, venue.key);
  const a = assess(venue, state, complex);
  rec.issuedDay = day;
  rec.expiresDay = day + CERTIFICATE_DAYS;
  rec.fraction = a.fraction;
  rec.capacity = a.capacity;
  rec.prohibited = a.prohibited;
  rec.lastScores = a.scores.map(({ id, score }) => ({ id, score }));
  state.safety.history.unshift({
    day, key: venue.key, name: venue.name || venue.sportName,
    capacity: a.capacity, fraction: a.fraction, prohibited: a.prohibited,
    worst: a.worst.name,
  });
  if (state.safety.history.length > 40) state.safety.history.pop();
  return { ...a, rec };
}

/** The capacity a venue may actually sell today. */
export function permittedCapacity(state, venue) {
  // A save made before certificates existed is not shut down overnight: every
  // ground on it is treated as certified until its first renewal falls due.
  const grand = state.safety?.grandfatherUntil;
  if (grand !== undefined && state.day <= grand) return venue.capacity.total;
  const rec = state.safety?.byVenue?.[venue.key];
  // Uncertified, or lapsed: you are a small ground until an inspector says
  // otherwise, which is a reason to book one rather than a reason to stop.
  if (!rec || rec.issuedDay < 0) return Math.min(venue.capacity.total, SMALL_GROUND);
  if (rec.prohibited) return 0;
  if (state.day > rec.expiresDay) return Math.min(venue.capacity.total, SMALL_GROUND);
  // Never more than what is built, however generous the certificate was: a
  // certificate is a ceiling, not a promise.
  return Math.min(rec.capacity, venue.capacity.total);
}

/** Why a venue cannot open, in a sentence, or null if it can. */
export function blockedReason(state, venue) {
  const grand = state.safety?.grandfatherUntil;
  if (grand !== undefined && state.day <= grand) return null;
  const rec = state.safety?.byVenue?.[venue.key];
  const capped = `Without a certificate you may only sell ${SMALL_GROUND.toLocaleString()} `
    + `of ${venue.capacity.total.toLocaleString()} seats.`;
  if (!rec || rec.issuedDay < 0) {
    return venue.capacity.total <= SMALL_GROUND ? null : `Never inspected. ${capped}`;
  }
  if (rec.prohibited) return 'Under a prohibition notice. The ground is closed until the faults are put right and it is re-inspected.';
  if (state.day > rec.expiresDay) return `The safety certificate has expired. ${capped}`;
  return null;
}

/** Days until renewal is needed, or null when there is nothing to renew. */
export function daysLeft(state, venue) {
  const rec = state.safety?.byVenue?.[venue.key];
  return rec && rec.issuedDay >= 0 ? rec.expiresDay - state.day : null;
}

/**
 * The daily check. A certificate that has run out is not a surprise - the
 * ground staff warn you well before it does.
 */
export function tickSafety(state, venues) {
  const notices = [];
  const s = state.safety || (state.safety = createSafetyState());
  const live = new Set(venues.map((v) => v.key));
  for (const key of Object.keys(s.byVenue)) {
    if (!live.has(key)) { delete s.byVenue[key]; continue; }
    const rec = s.byVenue[key];
    if (rec.issuedDay < 0) continue;
    const left = rec.expiresDay - state.day;
    const v = venues.find((x) => x.key === key);
    const name = v?.name || v?.sportName || 'A venue';
    if (left === 30 || left === 7) {
      notices.push({ key, warn: left <= 7, name,
        text: `The safety certificate expires in ${left} days. Book an inspection.` });
    } else if (left === 0) {
      notices.push({ key, warn: true, name,
        text: 'The safety certificate has expired. The ground cannot open until it is renewed.' });
    }
  }
  return { notices };
}
