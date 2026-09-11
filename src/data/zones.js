/**
 * Functional zones. Blocks make the shape; zones tell the simulation what the
 * shape is *for*. The venue analyser reads this layer.
 *
 *   group     'sport' surfaces are the anchor of a venue; the rest are support
 *   color     overlay colour in ZONE mode
 *   minArea   voxels below which a zone component is ignored as noise
 *   capacity  spectators per voxel (seating zones only)
 */
export const ZONES = [
  // ------------------------------------------------------------ sport areas
  { key: 'pitch_football',  name: 'Football Pitch',   group: 'sport', color: 0x3fbf5a, sport: 'football',   regulation: { w: 45, d: 28, ideal: { w: 53, d: 34 } }, surfaces: ['turf', 'turf_synth'] },
  // Soccer and football are the same code here, down to the dimensions, so
  // this is a second name for the same sport rather than a second sport. A
  // separate sport would be a dead end: nothing would ever be scheduled on it.
  { key: 'pitch_soccer',    name: 'Soccer Pitch',     group: 'sport', color: 0x35b57e, sport: 'football',   regulation: { w: 45, d: 28, ideal: { w: 53, d: 34 } }, surfaces: ['turf', 'turf_synth'] },
  { key: 'pitch_rugby',     name: 'Rugby Pitch',      group: 'sport', color: 0x2f9e63, sport: 'rugby',      regulation: { w: 50, d: 34, ideal: { w: 60, d: 35 } }, surfaces: ['turf', 'turf_synth'] },
  { key: 'pitch_cricket',   name: 'Cricket Field',    group: 'sport', color: 0x5cbf49, sport: 'cricket',    regulation: { w: 65, d: 65, ideal: { w: 75, d: 75 } }, surfaces: ['turf', 'turf_synth'], oval: true },
  { key: 'pitch_afl',       name: 'Australian Rules Oval', group: 'sport', color: 0x49a83f, sport: 'afl',   regulation: { w: 68, d: 55, ideal: { w: 82, d: 70 } }, surfaces: ['turf', 'turf_synth'], oval: true },
  { key: 'court_basketball',name: 'Basketball Court', group: 'sport', color: 0xe0952f, sport: 'basketball', regulation: { w: 14, d: 8, ideal: { w: 15, d: 8 } },  surfaces: ['hardwood'] },
  { key: 'court_tennis',    name: 'Tennis Court',     group: 'sport', color: 0xd06a3f, sport: 'tennis',     regulation: { w: 12, d: 6, ideal: { w: 18, d: 10 } }, surfaces: ['clay', 'hardwood', 'turf_synth'] },
  { key: 'track_athletics', name: 'Athletics Track',  group: 'sport', color: 0xc9563c, sport: 'athletics',  regulation: { w: 45, d: 30, ideal: { w: 60, d: 40 } }, surfaces: ['track'] },
  { key: 'pool_swimming',   name: 'Swimming Pool',    group: 'sport', color: 0x2fb0d8, sport: 'swimming',   regulation: { w: 25, d: 12, ideal: { w: 25, d: 13 } }, surfaces: ['pool'] },
  { key: 'rink_ice',        name: 'Ice Rink',         group: 'sport', color: 0x9fdcef, sport: 'ice',        regulation: { w: 28, d: 14, ideal: { w: 30, d: 15 } }, surfaces: ['ice'] },
  { key: 'ring_combat',     name: 'Combat Arena Floor',group:'sport', color: 0xb5443f, sport: 'combat',     regulation: { w: 8, d: 8, ideal: { w: 12, d: 12 } },  surfaces: ['rubber', 'hardwood', 'floor_conc'] },
  { key: 'field_baseball',  name: 'Baseball Field',   group: 'sport', color: 0xc79a63, sport: 'baseball',   regulation: { w: 45, d: 45, ideal: { w: 55, d: 55 } }, surfaces: ['turf', 'turf_synth', 'infield'] },
  { key: 'arena_esports',   name: 'Esports Stage',    group: 'sport', color: 0x6f7ae0, sport: 'esports',    regulation: { w: 10, d: 8, ideal: { w: 16, d: 12 } },  surfaces: ['esports', 'stage', 'rubber'] },
  { key: 'stage_event',     name: 'Concert Stage',    group: 'sport', color: 0x9a6bd0, sport: 'concert',    regulation: { w: 14, d: 8, ideal: { w: 22, d: 12 } },  surfaces: ['stage', 'floor_conc', 'hardwood'] },

  // -------------------------------------------------------------- spectator
  { key: 'seating',          name: 'Seating',          group: 'spectator', color: 0x3f7fe0, capacity: 6 },
  { key: 'seating_vip',      name: 'VIP Seating',      group: 'spectator', color: 0x9a63e8, capacity: 2, vip: true },
  { key: 'luxury_box',       name: 'Luxury Box',       group: 'spectator', color: 0xc0a0ff, capacity: 1, vip: true },
  { key: 'seating_standing', name: 'Standing Terrace', group: 'spectator', color: 0x6f7c8c, capacity: 9 },
  { key: 'concourse',        name: 'Concourse',        group: 'spectator', color: 0xc3cad2 },
  { key: 'stairs',           name: 'Stairs / Vomitory',group: 'spectator', color: 0xa2acb8 },
  { key: 'entrance',         name: 'Entrance',         group: 'spectator', color: 0x2fd08a },
  { key: 'exit',             name: 'Emergency Exit',   group: 'spectator', color: 0xe8703f },
  { key: 'fanzone',          name: 'Fan Zone',         group: 'spectator', color: 0x49c5c9 },

  // ------------------------------------------------------------- facilities
  { key: 'restroom',    name: 'Restrooms',        group: 'facility', color: 0x60a9d8 },
  { key: 'concession',  name: 'Concessions',      group: 'facility', color: 0xe8a93f },
  { key: 'restaurant',  name: 'Restaurant',       group: 'facility', color: 0xd88a4f },
  { key: 'retail',      name: 'Retail / Merch',   group: 'facility', color: 0xd85f9a },
  { key: 'hospitality', name: 'Hospitality Suite',group: 'facility', color: 0xc9a13f, vip: true },
  { key: 'locker',      name: 'Locker Room',      group: 'facility', color: 0x4f9ec4 },
  { key: 'medical',     name: 'Medical',          group: 'facility', color: 0xe05555 },
  { key: 'media',       name: 'Media Centre',     group: 'facility', color: 0x8d7fe0 },
  { key: 'broadcast',   name: 'Broadcast Centre', group: 'facility', color: 0x6f5fd0 },
  { key: 'office',      name: 'Offices',          group: 'facility', color: 0x8f98a3 },
  { key: 'security',    name: 'Security',         group: 'facility', color: 0x3f5f8f },
  { key: 'storage',     name: 'Storage',          group: 'facility', color: 0x7a6f5f },
  { key: 'staff',       name: 'Staff Area',       group: 'facility', color: 0x6f8f7a },
  { key: 'training',    name: 'Training Area',    group: 'facility', color: 0x5fbf8f },

  // ---------------------------------------------------------- infrastructure
  { key: 'parking',     name: 'Parking',          group: 'transport', color: 0x707880 },
  { key: 'parking_vip', name: 'VIP Parking',      group: 'transport', color: 0xa08fd0, vip: true },
  { key: 'parking_bus', name: 'Bus / Coach Bay',  group: 'transport', color: 0x5f9fb0 },
  { key: 'road',           name: 'Local Road',       group: 'transport', color: 0x4a5158, traffic: 1.0 },
  { key: 'road_main',      name: 'Main Road',        group: 'transport', color: 0x39424a, traffic: 2.4 },
  { key: 'road_service',   name: 'Service Road',     group: 'transport', color: 0x4f5a48, traffic: 0.6 },
  { key: 'road_vip',       name: 'VIP Access Road',  group: 'transport', color: 0x7a63a0, traffic: 0.8, vip: true },
  { key: 'road_emergency', name: 'Emergency Route',  group: 'transport', color: 0xa04a4a, traffic: 0.5 },
  { key: 'road_bus',       name: 'Bus Lane',         group: 'transport', color: 0x3f7a85, traffic: 1.2 },
  { key: 'parking_staff',  name: 'Staff Parking',    group: 'transport', color: 0x6a7280 },
  { key: 'parking_taxi',   name: 'Taxi / Rideshare', group: 'transport', color: 0xb09a4a },
  { key: 'transit',     name: 'Transit Stop',     group: 'transport', color: 0x3fbfa9 },
];

export const ZONE_NONE = 0;
export const ZONE_BY_ID = [{ id: 0, key: 'none', name: 'No Zone', group: 'none', color: 0x000000 }];
export const ZONE_BY_KEY = new Map();

ZONES.forEach((z, i) => {
  const rec = { id: i + 1, minArea: 4, capacity: 0, vip: false, ...z };
  ZONE_BY_ID.push(rec);
  ZONE_BY_KEY.set(rec.key, rec);
});

export function zone(idOrKey) {
  if (typeof idOrKey === 'number') return ZONE_BY_ID[idOrKey] || ZONE_BY_ID[0];
  return ZONE_BY_KEY.get(idOrKey) || ZONE_BY_ID[0];
}
export function zoneId(key) {
  const z = ZONE_BY_KEY.get(key);
  return z ? z.id : 0;
}

export const ZONE_GROUPS = [
  { key: 'sport', name: 'Sport Surfaces' },
  { key: 'spectator', name: 'Spectator' },
  { key: 'facility', name: 'Facilities' },
  { key: 'transport', name: 'Transport' },
];

export function zonesInGroup(g) {
  return ZONE_BY_ID.filter((z) => z.group === g);
}

/** Sport zones keyed by sport id, used by venue detection. */
export const SPORT_ZONES = ZONE_BY_ID.filter((z) => z.group === 'sport');
