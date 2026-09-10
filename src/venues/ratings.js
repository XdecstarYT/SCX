/**
 * Venue rating model.
 *
 * Every rating is derived from measurable geometry, and every rating that
 * falls short produces a specific, actionable note. The player should always
 * be able to answer "what do I build next?" from this output.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const pct = (have, need) => (need <= 0 ? 1 : clamp01(have / need));

/** Recommended provision, expressed in voxels, for a given capacity. */
export const REQUIREMENTS = {
  restroomVoxels:   (cap) => cap / 120,
  concessionVoxels: (cap) => cap / 200,
  concourseVoxels:  (cap) => cap / 13,
  entranceVoxels:   (cap) => cap / 900,   // ~400 people/hr per 2m lane, 2.2hr fill
  exitVoxels:       (cap) => cap / 600,   // 8-minute emergency egress
  stairVoxels:      (cap) => cap / 700,
  securityVoxels:   (cap) => Math.max(6, cap / 2500),
  medicalVoxels:    (cap) => Math.max(6, cap / 4000),
  lockerVoxels:     (cap) => Math.max(20, Math.min(90, 20 + cap / 900)),
  mediaVoxels:      (cap) => Math.max(0, cap / 1200),
  broadcastVoxels:  (cap) => Math.max(0, cap / 2000),
  hospitalityVoxels:(cap) => cap / 900,
  parkingCars:      (cap, transitShare) => (cap * (1 - transitShare)) / 2.6,
  floodlights:      (cap) => Math.max(4, Math.min(24, 4 + cap / 4000)),
};

export function rateVenue(v, complex) {
  const cap = Math.max(1, v.capacity.total);
  const f = v.facilities;
  const R = REQUIREMENTS;

  // --- individual measures -------------------------------------------------
  const m = {
    field: v.field ? v.field.regulation * (v.field.surfaceOk ? 1 : 0.55) : 0,
    seating: clamp01(Math.log10(Math.max(cap, 10)) / 5),
    restroom: pct(f.restroom, R.restroomVoxels(cap)),
    concession: pct(f.concession, R.concessionVoxels(cap)),
    concourse: pct(f.concourse + f.stairs * 0.5, R.concourseVoxels(cap)),
    entrance: pct(f.entrance, R.entranceVoxels(cap)),
    exit: pct(f.exit, R.exitVoxels(cap)),
    stairs: pct(f.stairs, R.stairVoxels(cap)),
    security: pct(f.security, R.securityVoxels(cap)),
    medical: pct(f.medical, R.medicalVoxels(cap)),
    locker: pct(f.locker, R.lockerVoxels(cap)),
    media: pct(f.media, R.mediaVoxels(cap)),
    broadcast: pct(f.broadcast, R.broadcastVoxels(cap)),
    hospitality: pct(f.hospitality + v.capacity.vip * 0.3, R.hospitalityVoxels(cap)),
    parking: pct(v.parkingCars, R.parkingCars(cap, complex.transitShare)),
    lighting: pct(v.lighting, R.floodlights(cap)),
    roof: clamp01(v.seatRoofCoverage * 1.1),
    retail: pct(f.retail, cap / 900),
    fanzone: pct(f.fanzone, cap / 500),
    training: pct(f.training, 20),
  };

  // Multiple separate gates matter as much as total width.
  const gateSpread = clamp01(f.entranceGates / Math.max(2, Math.ceil(cap / 12000) + 1));
  const exitSpread = clamp01(f.exitGates / Math.max(2, Math.ceil(cap / 9000) + 1));

  // --- composite ratings ---------------------------------------------------
  const functionality = 100 * (
    m.field * 0.34 + m.seating * 0.16 + m.locker * 0.16 +
    m.concourse * 0.14 + m.lighting * 0.12 + m.medical * 0.08);

  const crowdFlow = 100 * (
    m.entrance * 0.28 + gateSpread * 0.16 + m.concourse * 0.24 +
    m.stairs * 0.16 + m.exit * 0.16);

  const accessibility = 100 * (
    m.entrance * 0.24 + m.parking * 0.3 + m.concourse * 0.2 +
    clamp01(complex.transitShare / 0.4) * 0.16 + gateSpread * 0.1);

  const safety = 100 * (
    m.exit * 0.3 + exitSpread * 0.16 + m.security * 0.22 +
    m.medical * 0.2 + m.lighting * 0.12);

  const comfort = 100 * (
    m.restroom * 0.3 + m.concession * 0.26 + m.roof * 0.18 +
    m.retail * 0.1 + m.concourse * 0.1 + m.fanzone * 0.06);

  // Appearance is decoration density relative to venue footprint, not raw count.
  const footprint = Math.max(200, v.footprintVoxels);
  const decorDensity = clamp01((v.appearance / footprint) * 26);
  const appearance = 100 * clamp01(
    decorDensity * 0.5 + clamp01(v.seatRoofCoverage) * 0.22 +
    clamp01(v.screens / 3) * 0.16 + clamp01(v.heightAboveField / 22) * 0.12);

  const prestige = 100 * clamp01(
    clamp01(Math.log10(Math.max(cap, 100)) / 5.1) * 0.42 +
    (appearance / 100) * 0.22 +
    m.hospitality * 0.16 +
    m.broadcast * 0.12 +
    m.media * 0.08);

  const overall = Math.round(
    functionality * 0.24 + crowdFlow * 0.16 + safety * 0.16 +
    comfort * 0.15 + accessibility * 0.13 + appearance * 0.08 + prestige * 0.08
  );

  // --- feedback ------------------------------------------------------------
  const issues = [];
  const strengths = [];
  const note = (test, bad, good, key, severity = 'warn') => {
    if (m[key] < test) issues.push({ key, severity, text: bad });
    else if (m[key] >= 0.98 && good) strengths.push({ key, text: good });
  };

  if (!v.field) {
    issues.push({ key: 'field', severity: 'error', text: 'No regulation sport surface detected. Paint a sport zone on a playing surface.' });
  } else if (v.field.regulation < 1) {
    issues.push({
      key: 'field', severity: 'error',
      text: `Playing surface is ${v.field.w}x${v.field.d} blocks (${v.field.w * 2}m x ${v.field.d * 2}m) - below the ${v.field.minW}x${v.field.minD} minimum for ${v.sportName}.`,
    });
  } else if (!v.field.surfaceOk) {
    issues.push({ key: 'field', severity: 'warn', text: `The ${v.sportName} zone is not on an approved surface material.` });
  } else {
    strengths.push({ key: 'field', text: `Regulation ${v.sportName} surface (${v.field.w * 2}m x ${v.field.d * 2}m).` });
  }

  note(0.6, 'Insufficient restrooms for this capacity. Zone more Restroom space.', 'Restroom provision exceeds expectations.', 'restroom');
  note(0.6, 'Food facilities are below expectations for a venue this size.', 'Excellent food and beverage provision.', 'concession');
  note(0.7, 'Entrance capacity is too low - expect long queues on event day.', 'Entrance capacity is excellent.', 'entrance');
  note(0.75, 'Insufficient emergency exits for the seated capacity.', 'Emergency egress is well provided for.', 'exit', 'error');
  note(0.6, 'Concourse space is tight; crowd congestion is likely.', 'Excellent pedestrian flow through the concourses.', 'concourse');
  note(0.6, 'Not enough stairs/vomitories connecting concourse to seating.', null, 'stairs');
  note(0.6, 'Parking bottleneck detected. Add parking, bus bays or a transit stop.', 'Transport provision is excellent.', 'parking');
  note(0.6, 'Floodlighting is inadequate for evening or broadcast events.', 'Floodlighting is broadcast grade.', 'lighting');
  note(0.6, 'Athlete facilities are below professional standard. Expand locker rooms.', 'Athlete facilities are excellent.', 'locker');
  note(0.5, 'No dedicated medical facilities of adequate size.', null, 'medical', 'error');
  note(0.5, 'Security provision is thin for this capacity.', null, 'security');
  if (m.media < 0.4) issues.push({ key: 'media', severity: 'info', text: 'Adding a Media Centre would unlock higher-tier events.' });
  if (m.broadcast < 0.4) issues.push({ key: 'broadcast', severity: 'info', text: 'A Broadcast Centre is required for national and international events.' });
  if (m.hospitality < 0.4) issues.push({ key: 'hospitality', severity: 'info', text: 'VIP seating and hospitality suites would raise prestige and revenue.' });
  if (v.seatRoofCoverage > 0.75) strengths.push({ key: 'roof', text: 'Nearly all seating is under cover.' });
  if (v.structuralWarnings > 0) {
    issues.push({ key: 'structure', severity: 'error', text: `${v.structuralWarnings} roof sections lack adequate support. Add columns or beams beneath them.` });
  }

  return {
    functionality: Math.round(functionality),
    crowdFlow: Math.round(crowdFlow),
    accessibility: Math.round(accessibility),
    safety: Math.round(safety),
    comfort: Math.round(comfort),
    appearance: Math.round(appearance),
    prestige: Math.round(prestige),
    overall: Math.max(0, Math.min(100, overall)),
    measures: m,
    issues,
    strengths,
  };
}

/** Highest event tier this venue can credibly host. */
export function eventTier(v) {
  const cap = v.capacity.total;
  const r = v.ratings.overall;
  const f = v.facilities;
  if (cap >= 40000 && r >= 74 && f.broadcast > 0 && f.media > 0 && v.capacity.vip > 0) return 'international';
  if (cap >= 18000 && r >= 62 && f.media > 0) return 'national';
  if (cap >= 6000 && r >= 48) return 'regional';
  if (cap >= 800 && r >= 30) return 'local';
  return 'none';
}

export const TIER_ORDER = ['none', 'local', 'regional', 'national', 'international', 'world'];
export const TIER_LABEL = {
  none: 'Not event ready', local: 'Local', regional: 'Regional',
  national: 'National', international: 'International', world: 'World',
};
export function tierRank(t) { return TIER_ORDER.indexOf(t); }
