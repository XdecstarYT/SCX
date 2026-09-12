import { START_CASH, LAND_TIERS, SECONDS_PER_DAY, DAYS_PER_MONTH } from './constants.js';
import { createRivals } from '../data/rivals.js';
import { STAFF_CHANNELS, STAFF_ROLES } from '../data/staff.js';
import { UTILITY_KEYS, capacityOf, upkeepOf, computeDemand, serviceFactor } from '../data/utilities.js';
import { climateEffects } from '../data/cities.js';
import { createHotbarState } from '../ui/hotbar.js';
import { createLeagueState } from './league.js';

const STAFF_ROLE_MAP = new Map(STAFF_ROLES.map((r) => [r.id, r]));

export const SAVE_VERSION = 4;

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

    // The complex is a set of sites, each its own voxel world. You start with
    // one; buying into another city is an endgame move.
    sites: [{
      id: 'site1',
      name: opts.complexName || 'Riverside',
      cityId: 'meridian',
      landTier: 0,
      boughtDay: 1,
      utilities: Object.fromEntries(UTILITY_KEYS.map((k) => [k, -1])),
    }],
    activeSite: 'site1',

    reputation: { venue: 8, fans: 50, athletes: 50, organiser: 30, community: 60 },

    research: { completed: [], active: null },
    staff: [],
    sponsors: [],
    loans: [],

    construction: [],
    events: { board: [], scheduled: [], history: [], lastGeneratedDay: 0 },
    organiserHistory: {},
    rivals: createRivals(),

    venues: { registered: [] },   // [{ key, name, sport, registeredDay }]
    league: createLeagueState(opts.seed ?? 1),
    // Set when the game was started from an authored scenario rather than as
    // a sandbox. Null is the sandbox, which is still the default.
    scenario: null,
    landLocked: false,
    modifiers: [],                // temporary effects from random events
    pendingRandomEvent: null,
    lastRandomEventDay: 0,

    weather: 'sunny',
    weatherUntilDay: 4,

    achievements: [],
    // Long-term goals that have been completed, and whether the finale for
    // finishing all of them has been shown.
    goalsDone: [],
    legacyShown: false,
    hotbar: createHotbarState(),
    tutorial: { step: 0, dismissed: false, seen: {} },

    finance: { ledger: [], months: [], monthAccum: {}, lastMonth: 0 },

    stats: {
      blocksPlaced: 0, blocksRemoved: 0, moneySpentBuilding: 0,
      venuesDetected: 0, regulationFields: 0,
      equipmentFitted: 0, fullyFittedVenues: 0,
      bidsPlaced: 0, bidsWon: 0, bidsLost: 0,
      eventsHosted: 0, sellouts: 0, totalAttendance: 0,
      lifetimeRevenue: 0, lifetimeCosts: 0, lifetimeProfit: 0,
      bestCapacity: 0, bestRating: 0, bestSatisfaction: 0,
      tiersHosted: [], sportsHosted: [],
    },

    settings: {
      sound: true, music: false, reducedMotion: false, highContrast: false,
      largeText: false, sensitivity: 1, invertY: false, showFps: false,
      autosave: true, handedness: 'right', shadows: 'auto',
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

  // ---------------------------------------------------------- utilities
  // Each site has its own networks. Demand is read out of that site's build.
  const site = activeSite(state);
  state.utilityStatus = utilityStatusFor(state, site, analysis);
  state.utilityUpkeep = state.sites.reduce(
    (sum, st) => sum + UTILITY_KEYS.reduce((a, k) => a + upkeepOf(k, st.utilities[k] ?? -1), 0), 0);
  state.utilityFactors = Object.fromEntries(
    UTILITY_KEYS.map((k) => [k, state.utilityStatus[k].factor]));

  // Kept for the existing power-specific messaging.
  state.powerCapacity = state.utilityStatus.power.capacity;
  state.powerDemand = state.utilityStatus.power.demand;
  state.powerDeficit = state.utilityStatus.power.deficit;

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
    acc.athlete += s.athleteBonus || 0;
    return acc;
  }, { food: 0, merch: 0, sponsor: 0, broadcast: 0, athlete: 0 });

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

/** The site the player is currently standing on. */
export function activeSite(state) {
  return state.sites.find((s) => s.id === state.activeSite) || state.sites[0];
}

export function landInfo(state, site = activeSite(state)) {
  const tier = LAND_TIERS[site.landTier];
  const next = LAND_TIERS[site.landTier + 1] || null;
  return { tier, next, index: site.landTier, max: LAND_TIERS.length - 1, site };
}

/** Reputation is bounded and drifts gently toward its neighbours. */
export function applyReputation(state, delta) {
  for (const [k, v] of Object.entries(delta)) {
    if (!(k in state.reputation)) continue;
    state.reputation[k] = Math.max(0, Math.min(100, state.reputation[k] + v));
  }
}

/**
 * Capacity, demand and service factor for one site's utility networks.
 * Climate matters: an arid site drinks far more water, a cold one spends far
 * more on heating.
 */
export function utilityStatusFor(state, site, analysis) {
  const complex = analysis?.complex || {};
  const climate = climateEffects(site.cityId);
  const raw = computeDemand(
    complex, complex.zoneVoxels || {}, complex.blockVoxels || {},
    analysis?.venues?.reduce((s, v) => s + v.capacity.total, 0) || 0);
  const demand = {
    ...raw,
    water: raw.water * climate.water,
    climate: raw.climate * climate.climate,
  };

  const research = state.research.completed;
  const out = {};
  for (const key of UTILITY_KEYS) {
    const tier = site.utilities?.[key] ?? -1;
    let capacity = capacityOf(key, tier);
    if (key === 'power' && research.includes('power_grid')) capacity += 40;
    if (key === 'data' && research.includes('broadcast')) capacity += 20;
    const d = demand[key] || 0;
    out[key] = {
      demand: d,
      capacity,
      deficit: Math.max(0, d - capacity),
      factor: serviceFactor(d, capacity),
      upkeep: upkeepOf(key, tier),
    };
  }
  return out;
}

export { SECONDS_PER_DAY, DAYS_PER_MONTH, STAFF_ROLE_MAP };
