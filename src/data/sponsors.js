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

export function availableSponsors(state, bestCapacity) {
  return SPONSORS.filter((s) =>
    state.reputation.venue >= s.reqRep &&
    bestCapacity >= s.reqCap &&
    !state.sponsors.some((x) => x.id === s.id));
}
