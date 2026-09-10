/** Fictional sponsors. Every deal is a trade-off, never a pure upgrade. */
export const SPONSORS = [
  { id: 'northgate', name: 'Northgate Mutual', sector: 'Insurance', annual: 240_000, perEvent: 18_000, years: 3,
    reqRep: 12, reqCap: 1_000, bonus: 'Reliable, unglamorous money for a young venue.', prestige: 0 },
  { id: 'verdant', name: 'Verdant Foods', sector: 'Catering', annual: 380_000, perEvent: 26_000, years: 3,
    reqRep: 20, reqCap: 3_000, bonus: '+12% food and beverage revenue.', foodBonus: 0.12, prestige: 1 },
  { id: 'stride', name: 'Stride Athletic', sector: 'Sportswear', annual: 900_000, perEvent: 64_000, years: 4,
    reqRep: 34, reqCap: 8_000, bonus: '+15% merchandise revenue and +2 athlete reputation per event.', merchBonus: 0.15, athleteBonus: 2, prestige: 3 },
  { id: 'meridian_bank', name: 'Meridian Bank', sector: 'Finance', annual: 1_800_000, perEvent: 120_000, years: 5,
    reqRep: 45, reqCap: 15_000, bonus: 'Naming rights. Your main venue is renamed.', naming: true, prestige: 6 },
  { id: 'global_energy', name: 'Global Energy', sector: 'Utilities', annual: 4_500_000, perEvent: 300_000, years: 5,
    reqRep: 60, reqCap: 30_000, bonus: '+10% sponsorship revenue, but branding covers the venue.', sponsorBonus: 0.10, community: -6, prestige: 8 },
  { id: 'aether', name: 'Aether Telecom', sector: 'Telecoms', annual: 6_200_000, perEvent: 420_000, years: 6,
    reqRep: 72, reqCap: 45_000, bonus: 'Funds a broadcast upgrade; +18% broadcasting revenue.', broadcastBonus: 0.18, prestige: 10 },
  { id: 'solaris', name: 'Solaris Airlines', sector: 'Aviation', annual: 8_800_000, perEvent: 640_000, years: 6,
    reqRep: 84, reqCap: 60_000, bonus: 'Global naming partner. Huge money, total brand takeover.', naming: true, sponsorBonus: 0.15, community: -10, prestige: 14 },
];

/**
 * Facility sponsorships sit alongside the venue-wide deals: smaller money, but
 * they stack, and each one wants a specific thing to exist before it will pay
 * for its name to be on it.
 */
export const FACILITY_SPONSORS = [
  { id: 'harvest', name: 'Harvest Kitchen', sector: 'Catering', scope: 'Food court naming',
    annual: 320_000, perEvent: 24_000, years: 3, reqRep: 16, reqCap: 2_000,
    needsZone: 'concession', needsVoxels: 60, foodBonus: 0.10,
    bonus: 'Names your food court. +10% food and beverage revenue.', prestige: 1 },
  { id: 'quarry', name: 'Quarry Outfitters', sector: 'Retail', scope: 'Merchandise store naming',
    annual: 260_000, perEvent: 20_000, years: 3, reqRep: 18, reqCap: 3_000,
    needsZone: 'retail', needsVoxels: 30, merchBonus: 0.12,
    bonus: 'Names the club store. +12% merchandise revenue.', prestige: 1 },
  { id: 'lumen', name: 'Lumen Displays', sector: 'Technology', scope: 'Screen and signage partner',
    annual: 780_000, perEvent: 55_000, years: 4, reqRep: 34, reqCap: 12_000,
    needsBlock: 'screen', needsVoxels: 20, sponsorBonus: 0.08,
    bonus: 'Sponsors every screen on site. +8% sponsorship revenue.', prestige: 3 },
  { id: 'atlas_health', name: 'Atlas Health', sector: 'Healthcare', scope: 'Medical centre naming',
    annual: 340_000, perEvent: 18_000, years: 4, reqRep: 24, reqCap: 6_000,
    needsZone: 'medical', needsVoxels: 20, athleteBonus: 3,
    bonus: 'Names the medical centre. Athletes rate the venue more highly.', prestige: 2 },
  { id: 'cobalt', name: 'Cobalt Lounge', sector: 'Hospitality', scope: 'Hospitality suite naming',
    annual: 1_400_000, perEvent: 96_000, years: 5, reqRep: 48, reqCap: 20_000,
    needsZone: 'hospitality', needsVoxels: 60,
    bonus: 'Names your hospitality level. Substantial guaranteed income.', prestige: 5 },
  { id: 'northwind', name: 'Northwind Transit', sector: 'Transport', scope: 'Transport partner',
    annual: 900_000, perEvent: 40_000, years: 5, reqRep: 40, reqCap: 18_000,
    needsZone: 'transit', needsVoxels: 60, community: 6,
    bonus: 'Funds the transport interchange. The local authority approves.', prestige: 3 },
];

export const ALL_SPONSORS = [...SPONSORS, ...FACILITY_SPONSORS];

/** A facility sponsor will only sign if the thing they want to name exists. */
export function sponsorRequirementMet(sponsor, complex) {
  if (sponsor.needsZone) {
    return (complex?.zoneVoxels?.[sponsor.needsZone] || 0) >= (sponsor.needsVoxels || 1);
  }
  if (sponsor.needsBlock) {
    const id = complex?.blockKeyCounts?.[sponsor.needsBlock] || 0;
    return id >= (sponsor.needsVoxels || 1);
  }
  return true;
}

export function availableSponsors(state, bestCapacity, complex) {
  return ALL_SPONSORS.filter((s) =>
    state.reputation.venue >= s.reqRep &&
    bestCapacity >= s.reqCap &&
    sponsorRequirementMet(s, complex) &&
    !state.sponsors.some((x) => x.id === s.id));
}

/** Sponsors the player qualifies for on reputation but cannot yet satisfy. */
export function blockedSponsors(state, bestCapacity, complex) {
  return ALL_SPONSORS.filter((s) =>
    state.reputation.venue >= s.reqRep &&
    bestCapacity >= s.reqCap &&
    !sponsorRequirementMet(s, complex) &&
    !state.sponsors.some((x) => x.id === s.id));
}
