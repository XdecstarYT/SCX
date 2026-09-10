/**
 * Rival venue operators. They are an economic pressure, not an antagonist:
 * they bid against the player, improve over time, and occasionally announce
 * expansions that reset the bar.
 */
export const RIVAL_SEEDS = [
  { id: 'kestrel_park',   name: 'Kestrel Sports Park', capacity: 12_000, reputation: 38, quality: 52, funds: 6_000_000, sports: ['football', 'athletics'], aggression: 0.55 },
  { id: 'metro_arena',    name: 'Metro Arena',           capacity: 16_500, reputation: 46, quality: 61, funds: 11_000_000, sports: ['basketball', 'combat', 'concert'], aggression: 0.7 },
  { id: 'national_centre',name: 'National Sports Centre',capacity: 34_000, reputation: 62, quality: 70, funds: 28_000_000, sports: ['football', 'athletics', 'ceremony'], aggression: 0.6 },
  { id: 'grand_stadium',  name: 'The Grand Stadium',     capacity: 58_000, reputation: 74, quality: 79, funds: 62_000_000, sports: ['football', 'concert', 'ceremony'], aggression: 0.5 },
  { id: 'coastal_complex',name: 'Coastal Sports Complex',capacity: 9_000,  reputation: 31, quality: 44, funds: 4_200_000, sports: ['tennis', 'swimming', 'football'], aggression: 0.8 },
  { id: 'ironworks',      name: 'Ironworks Arena',       capacity: 21_000, reputation: 54, quality: 66, funds: 18_000_000, sports: ['basketball', 'combat', 'ice'], aggression: 0.65 },
];

export function createRivals() {
  return RIVAL_SEEDS.map((r) => ({ ...r, eventsWon: 0, lastExpansion: 0, news: [] }));
}
