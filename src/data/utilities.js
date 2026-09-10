/**
 * Site utility networks.
 *
 * The design brief is explicit that the player should not place individual
 * pipes and cables. Instead each network is a capacity-versus-demand system:
 * demand is read out of what you have built, capacity is bought in tiers, and
 * a shortfall degrades something specific and visible.
 */
export const UTILITIES = [
  {
    key: 'power', name: 'Power Grid', unit: 'MW', icon: '⚡',
    base: 15,
    desc: 'Floodlights, screens, ice plant and pumps.',
    shortfall: 'Equipment fails during events and floodlights cut out.',
    tiers: [
      { capacity: 25, cost: 900000, upkeep: 6000 },
      { capacity: 45, cost: 2600000, upkeep: 16000 },
      { capacity: 90, cost: 6800000, upkeep: 34000 },
      { capacity: 180, cost: 15000000, upkeep: 68000 },
    ],
  },
  {
    key: 'water', name: 'Water Supply', unit: 'ML/day', icon: '☗',
    base: 3,
    desc: 'Pitch irrigation, pools, restrooms and catering.',
    shortfall: 'The playing surface deteriorates and restrooms run dry.',
    tiers: [
      { capacity: 6, cost: 700000, upkeep: 4000 },
      { capacity: 14, cost: 1900000, upkeep: 11000 },
      { capacity: 30, cost: 4400000, upkeep: 24000 },
      { capacity: 60, cost: 9000000, upkeep: 46000 },
    ],
  },
  {
    key: 'sewer', name: 'Wastewater', unit: 'ML/day', icon: '☵',
    base: 3,
    desc: 'Restrooms, kitchens and surface drainage.',
    shortfall: 'Restrooms close mid-event and the council takes an interest.',
    tiers: [
      { capacity: 6, cost: 650000, upkeep: 4000 },
      { capacity: 14, cost: 1800000, upkeep: 10000 },
      { capacity: 30, cost: 4200000, upkeep: 22000 },
      { capacity: 60, cost: 8600000, upkeep: 44000 },
    ],
  },
  {
    key: 'data', name: 'Data & Connectivity', unit: 'Gbps', icon: '≡',
    base: 12,
    desc: 'Broadcast feeds, press workrooms, ticketing and screens.',
    shortfall: 'Broadcast and media facilities cannot operate at full standard.',
    tiers: [
      { capacity: 40, cost: 900000, upkeep: 6000 },
      { capacity: 100, cost: 2400000, upkeep: 15000 },
      { capacity: 240, cost: 5400000, upkeep: 31000 },
      { capacity: 600, cost: 11000000, upkeep: 58000 },
    ],
  },
  {
    key: 'climate', name: 'Heating & Cooling', unit: 'MW', icon: '❄',
    base: 5,
    desc: 'Enclosed spaces, hospitality suites, ice plant and pool halls.',
    shortfall: 'Indoor spaces are uncomfortable and fans notice.',
    tiers: [
      { capacity: 14, cost: 1100000, upkeep: 7000 },
      { capacity: 34, cost: 2800000, upkeep: 18000 },
      { capacity: 70, cost: 6200000, upkeep: 35000 },
      { capacity: 150, cost: 13000000, upkeep: 64000 },
    ],
  },
];

export const UTILITY_KEYS = UTILITIES.map((u) => u.key);

/** Capacity of a network at a given purchased tier (-1 = nothing bought). */
export function capacityOf(key, tier) {
  const u = UTILITIES.find((x) => x.key === key);
  if (!u) return 0;
  if (tier < 0) return u.base;
  return u.tiers[Math.min(tier, u.tiers.length - 1)].capacity;
}

export function upkeepOf(key, tier) {
  const u = UTILITIES.find((x) => x.key === key);
  if (!u || tier < 0) return 0;
  return u.tiers[Math.min(tier, u.tiers.length - 1)].upkeep;
}

export function nextTier(key, tier) {
  const u = UTILITIES.find((x) => x.key === key);
  if (!u) return null;
  const idx = tier + 1;
  return idx < u.tiers.length ? { index: idx, ...u.tiers[idx] } : null;
}

/**
 * Demand read straight out of the built world. Every term traces back to
 * something the player placed.
 */
export function computeDemand(complex, zoneVox, blockVox, capacity) {
  const turf = (zoneVox.pitch_football || 0) + (zoneVox.pitch_soccer || 0)
    + (zoneVox.pitch_rugby || 0) + (zoneVox.pitch_cricket || 0);
  const pool = zoneVox.pool_swimming || 0;
  const ice = zoneVox.rink_ice || 0;
  const restroom = zoneVox.restroom || 0;
  const food = (zoneVox.concession || 0) + (zoneVox.restaurant || 0);
  const media = zoneVox.media || 0;
  const broadcast = zoneVox.broadcast || 0;
  const hospitality = zoneVox.hospitality || 0;
  const indoor = complex.roofedVoxels || 0;

  // Calibrated so a 60,000-seat complex with full facilities sits at roughly
  // 70% of the third capacity tier on every network.
  return {
    power: complex.powerDemand || 0,
    water: turf * 0.00008 + pool * 0.002 + restroom * 0.0017 + food * 0.0007 + capacity * 0.000004,
    sewer: restroom * 0.0016 + food * 0.0007 + capacity * 0.000002,
    data: media * 0.022 + broadcast * 0.08 + (complex.screens || 0) * 0.0075 + capacity * 0.00009,
    climate: indoor * 0.00067 + ice * 0.008 + pool * 0.005 + hospitality * 0.0017,
  };
}

/**
 * A shortfall does not switch a network off; it degrades it. 1.0 = fine,
 * falling toward 0.4 as demand outruns supply.
 */
export function serviceFactor(demand, capacity) {
  if (demand <= capacity || demand <= 0) return 1;
  return Math.max(0.4, capacity / demand);
}
