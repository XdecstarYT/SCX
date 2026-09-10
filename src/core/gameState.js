import { START_CASH, LAND_TIERS, SECONDS_PER_DAY, DAYS_PER_MONTH } from './constants.js';
import { createRivals } from '../data/rivals.js';
import { STAFF_CHANNELS, STAFF_ROLES } from '../data/staff.js';

const STAFF_ROLE_MAP = new Map(STAFF_ROLES.map((r) => [r.id, r]));

export const SAVE_VERSION = 3;

export function createState(opts = {}) {
  return {
    version: SAVE_VERSION,
    seed: opts.seed ?? Math.floor(Math.random() * 1e9),
    complexName: opts.complexName || 'Riverside',
    createdAt: Date.now(),
    lastPlayed: Date.now(),

    day: 1,
    dayFraction: 0,
    paused: false,
    speed: 1,

    cash: opts.cash ?? START_CASH,
    landTier: 0,

    reputation: { venue: 8, fans: 50, athletes: 50, organiser: 30, community: 60 },

    research: { completed: [], active: null },
    staff: [],
    sponsors: [],
    loans: [],

    events: { board: [], scheduled: [], history: [], lastGeneratedDay: 0 },
    organiserHistory: {},
    rivals: createRivals(),

    venues: { registered: [] },   // [{ key, name, sport, registeredDay }]
    modifiers: [],                // temporary effects from random events
    pendingRandomEvent: null,
    lastRandomEventDay: 0,

    weather: 'sunny',
    weatherUntilDay: 4,

    achievements: [],
    tutorial: { step: 0, dismissed: false, seen: {} },

    finance: { ledger: [], months: [], monthAccum: {}, lastMonth: 0 },

    stats: {
      blocksPlaced: 0, blocksRemoved: 0, moneySpentBuilding: 0,
      venuesDetected: 0, regulationFields: 0,
      bidsPlaced: 0, bidsWon: 0, bidsLost: 0,
      eventsHosted: 0, sellouts: 0, totalAttendance: 0,
      lifetimeRevenue: 0, lifetimeCosts: 0, lifetimeProfit: 0,
      bestCapacity: 0, bestRating: 0, bestSatisfaction: 0,
      tiersHosted: [], sportsHosted: [],
    },

    settings: {
      sound: true, music: false, reducedMotion: false, highContrast: false,
      largeText: false, sensitivity: 1, invertY: false, showFps: false,
      autosave: true, handedness: 'right',
    },
  };
}

/** Values recomputed from the world each analysis pass; never saved. */
export function attachDerived(state, analysis) {
  const venues = analysis?.venues || [];
  const best = venues[0];
  state.derived = {
    bestCapacity: best ? best.capacity.total : 0,
    bestRating: best ? best.ratings.overall : 0,
    totalCapacity: venues.reduce((s, v) => s + v.capacity.total, 0),
    trainingVoxels: venues.reduce((s, v) => s + v.facilities.training, 0),
    venueCount: venues.length,
  };
  state.complex = analysis?.complex || { powerDemand: 0, maintenance: 0, adverts: 0, passiveRevenue: 0 };
  state.transitShare = (analysis?.complex.transitShare || 0)
    * (1 + (state.research.completed.includes('transport') ? 0.6 : 0));
  state.bestCapacityHint = state.derived.bestCapacity || 8000;

  // Staff bonuses, per channel, scaled by skill and morale.
  const bonus = {};
  for (const c of STAFF_CHANNELS) bonus[c] = 0;
  for (const h of state.staff) {
    const role = STAFF_ROLE_MAP.get(h.roleId);
    if (!role) continue;
    bonus[role.channel] += role.effect * (h.skill / 70) * (0.6 + h.morale / 250);
  }
  const mgmt = bonus.management;
  for (const c of STAFF_CHANNELS) {
    if (c !== 'management') bonus[c] *= 1 + mgmt * 0.5;
    bonus[c] = Math.min(1.2, bonus[c]);
  }
  state.staffBonus = bonus;

  // Sponsor per-event contribution and modifiers.
  state.sponsorPerEvent = state.sponsors.reduce((s, x) => s + x.perEvent, 0);
  state.sponsorBonuses = state.sponsors.reduce((acc, s) => {
    acc.food += s.foodBonus || 0;
    acc.merch += s.merchBonus || 0;
    acc.sponsor += s.sponsorBonus || 0;
    acc.broadcast += s.broadcastBonus || 0;
    return acc;
  }, { food: 0, merch: 0, sponsor: 0, broadcast: 0 });

  // Active temporary modifiers.
  const mods = state.modifiers.filter((m) => m.untilDay > state.day);
  state.modifiers = mods;
  state.buildCostMult = 1 + mods.reduce((s, m) => s + (m.buildCostMult || 0), 0);
  state.salaryMult = 1 + mods.reduce((s, m) => s + (m.salaryMult || 0), 0);
  state.wearFactor = 1 + mods.reduce((s, m) => s + (m.wear || 0), 0) - state.staffBonus.operations * 0.1;
  state.capacityPenalty = mods.reduce((s, m) => s + (m.capacityPenalty || 0), 0);
  state.tempSeats = mods.reduce((s, m) => s + (m.tempSeats || 0), 0);
  state.sponsorLocked = mods.some((m) => m.sponsorLock);
  return state;
}

export const LAND = LAND_TIERS;
export function landInfo(state) {
  const tier = LAND_TIERS[state.landTier];
  const next = LAND_TIERS[state.landTier + 1] || null;
  return { tier, next, index: state.landTier, max: LAND_TIERS.length - 1 };
}

/** Reputation is bounded and drifts gently toward its neighbours. */
export function applyReputation(state, delta) {
  for (const [k, v] of Object.entries(delta)) {
    if (!(k in state.reputation)) continue;
    state.reputation[k] = Math.max(0, Math.min(100, state.reputation[k] + v));
  }
}

export { SECONDS_PER_DAY, DAYS_PER_MONTH, STAFF_ROLE_MAP };
