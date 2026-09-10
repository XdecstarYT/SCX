/**
 * Cities you can expand into.
 *
 * Each is a different set of trade-offs rather than a straight upgrade: cheap
 * land in a small market, expensive land where the crowds are, a climate that
 * ruins outdoor events, a place with transport already in the ground.
 */
export const CITIES = [
  {
    id: 'meridian', name: 'Meridian', region: 'Home city',
    landCost: 1, audience: 1, transitBase: 0, climate: 'temperate',
    weather: ['sunny', 'sunny', 'cloudy', 'cloudy', 'rain', 'heat', 'storm'],
    desc: 'Where you started. Average in every respect, which is its own kind of advantage.',
    buyCost: 0,
  },
  {
    id: 'kestrel_bay', name: 'Kestrel Bay', region: 'Coastal',
    landCost: 0.7, audience: 0.78, transitBase: 0.04, climate: 'maritime',
    weather: ['cloudy', 'cloudy', 'rain', 'rain', 'storm', 'sunny', 'sunny'],
    desc: 'Cheap coastal land and a smaller crowd. It rains, and storms come off the sea.',
    buyCost: 18_000_000,
  },
  {
    id: 'ardenne', name: 'Ardenne', region: 'Capital',
    landCost: 2.4, audience: 1.45, transitBase: 0.14, climate: 'continental',
    weather: ['sunny', 'cloudy', 'cloudy', 'rain', 'sunny', 'heat', 'storm'],
    desc: 'The capital. Land is brutally expensive, the crowds are enormous, and the metro is already there.',
    buyCost: 65_000_000,
  },
  {
    id: 'solano', name: 'Solano', region: 'Southern plain',
    landCost: 0.95, audience: 1.12, transitBase: 0.02, climate: 'arid',
    weather: ['sunny', 'sunny', 'sunny', 'heat', 'heat', 'cloudy', 'storm'],
    desc: 'Hot, dry and reliably clear. Wonderful for a schedule, hard on a pitch and a water bill.',
    buyCost: 34_000_000,
  },
  {
    id: 'nordhavn', name: 'Nordhavn', region: 'Northern port',
    landCost: 1.15, audience: 0.95, transitBase: 0.08, climate: 'cold',
    weather: ['cloudy', 'cloudy', 'rain', 'sunny', 'storm', 'cloudy', 'rain'],
    desc: 'Cold and grey, with real appetite for indoor sport and a port that moves anything.',
    buyCost: 42_000_000,
  },
];

export function city(id) {
  return CITIES.find((c) => c.id === id) || CITIES[0];
}

/** Climate nudges: what the place does to your operation. */
export const CLIMATE_EFFECTS = {
  temperate:   { water: 1.0, climate: 1.0, pitchWear: 1.0 },
  maritime:    { water: 0.8, climate: 1.1, pitchWear: 1.15 },
  continental: { water: 1.0, climate: 1.25, pitchWear: 1.0 },
  arid:        { water: 1.6, climate: 1.35, pitchWear: 1.3 },
  cold:        { water: 0.85, climate: 1.5, pitchWear: 1.1 },
};

export function climateEffects(cityId) {
  return CLIMATE_EFFECTS[city(cityId).climate] || CLIMATE_EFFECTS.temperate;
}
