import { DAYS_PER_MONTH } from './constants.js';

/**
 * How the surrounding area feels about the complex.
 *
 * The brief asks for both sides of this: jobs, tourism and local facilities
 * pull community standing up, while traffic, noise and congestion pull it
 * down. Every term is derived from something the player did, so the screen
 * doubles as an explanation of why the number is moving.
 */
export function communityReport(state, analysis) {
  const complex = analysis?.complex || {};
  const venues = analysis?.venues || [];
  const capacity = state.derived?.totalCapacity || 0;
  const zoneVox = complex.zoneVoxels || {};

  const recent = (state.events.history || []).filter((r) => r.day > state.day - 90);
  const attendancePerMonth = recent.reduce((s, r) => s + r.attendance, 0) / 3;

  // ------------------------------------------------------------- positives
  const jobs = Math.round(
    state.staff.length * 4
    + capacity * 0.012
    + ((zoneVox.retail || 0) + (zoneVox.concession || 0) + (zoneVox.restaurant || 0)) * 0.35);

  const tourism = Math.round(
    recent.reduce((s, r) => s + r.attendance * TOURIST_SHARE[r.tier] || 0, 0) / 3);

  const localFacilities = (zoneVox.training || 0) + (zoneVox.fanzone || 0);
  const communityEvents = recent.filter((r) => ['local', 'regional'].includes(r.tier)).length;
  const economicBoost = Math.round(tourism * 42 + attendancePerMonth * 8);

  const positives = [
    { key: 'jobs', label: 'Jobs supported', value: jobs, score: clamp(jobs / 900, 0, 1) * 26 },
    { key: 'tourism', label: 'Visitors from outside the area', value: tourism, score: clamp(tourism / 12000, 0, 1) * 20 },
    { key: 'facilities', label: 'Public sport and fan facilities', value: `${localFacilities} blocks`, score: clamp(localFacilities / 300, 0, 1) * 18 },
    { key: 'events', label: 'Local and regional events hosted', value: communityEvents, score: clamp(communityEvents / 6, 0, 1) * 14 },
    { key: 'economy', label: 'Local spend generated', value: economicBoost, money: true, score: clamp(economicBoost / 900_000, 0, 1) * 12 },
  ];

  // ------------------------------------------------------------- negatives
  // Cars with nowhere to go end up on residential streets.
  const parkingShortfall = venues.length
    ? Math.max(0, 1 - (venues[0].ratings.measures.parking ?? 1))
    : 0;
  const trafficPressure = clamp(parkingShortfall * (capacity / 25000), 0, 1);
  const noise = clamp(attendancePerMonth / 90_000, 0, 1) * (venues.some((v) => v.indoor) ? 0.6 : 1);
  const congestion = clamp((1 - (complex.roadServiceRatio ?? 1)) * 1.2, 0, 1);
  const buildDisruption = clamp((state.recentConstruction || 0) / 40_000, 0, 1);
  const brandTakeover = state.sponsors.reduce((s, x) => s + Math.abs(x.community || 0), 0) / 20;

  const negatives = [
    { key: 'traffic', label: 'Matchday traffic on local roads', value: pctText(trafficPressure), score: -trafficPressure * 30 },
    { key: 'noise', label: 'Noise and late finishes', value: pctText(noise), score: -noise * 18 },
    { key: 'congestion', label: 'Approach road congestion', value: pctText(congestion), score: -congestion * 16 },
    { key: 'construction', label: 'Ongoing construction disruption', value: pctText(buildDisruption), score: -buildDisruption * 12 },
    { key: 'branding', label: 'Commercial branding across the site', value: pctText(clamp(brandTakeover, 0, 1)), score: -clamp(brandTakeover, 0, 1) * 10 },
  ];

  const base = 50;
  const target = clamp(
    base + positives.reduce((s, p) => s + p.score, 0) + negatives.reduce((s, n) => s + n.score, 0),
    0, 100);

  return {
    target: Math.round(target),
    current: Math.round(state.reputation.community),
    positives: positives.filter((p) => p.score > 0.4),
    negatives: negatives.filter((n) => n.score < -0.4),
    jobs, tourism, economicBoost,
    mood: moodFor(state.reputation.community),
  };
}

/**
 * Community standing drifts toward what the complex actually deserves rather
 * than jumping, so a single bad event day does not wreck years of goodwill.
 */
export function driftCommunity(state, analysis) {
  const report = communityReport(state, analysis);
  const gap = report.target - state.reputation.community;
  state.reputation.community = clamp(
    state.reputation.community + gap * (1 / (DAYS_PER_MONTH * 1.5)), 0, 100);
  return report;
}

export const MOODS = [
  { min: 82, label: 'Proud of the place', tone: 'good' },
  { min: 64, label: 'Broadly supportive', tone: 'good' },
  { min: 46, label: 'Tolerant', tone: 'info' },
  { min: 28, label: 'Frustrated', tone: 'warn' },
  { min: 0, label: 'Actively opposed', tone: 'error' },
];

function moodFor(v) { return MOODS.find((m) => v >= m.min) || MOODS[MOODS.length - 1]; }

const TOURIST_SHARE = {
  local: 0.02, regional: 0.12, national: 0.35, international: 0.6, world: 0.75,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pctText = (v) => `${Math.round(v * 100)}%`;
