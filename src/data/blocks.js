/**
 * Data-driven block registry.
 *
 * Every block is pure data: colour, cost, structural role and (optionally) the
 * functional zone it implies. Adding new content = adding a row here.
 *
 * Fields:
 *   key          stable id used in saves
 *   name         display name
 *   category     hotbar grouping
 *   color        base colour (hex int)
 *   cost         construction cost per voxel
 *   maintenance  upkeep weight per voxel (scaled by MAINTENANCE_RATE)
 *   solid        blocks movement / occludes faces
 *   transparent  rendered in the transparent pass, does not occlude
 *   support      structural support strength (columns/beams are high)
 *   spans        how far this block can cantilever from support (roofs)
 *   light        emits floodlight (counts toward lighting rating)
 *   power        MW drawn per voxel. A full-size stadium screen is ~200
 *                voxels, so these are deliberately small numbers.
 *   autoZone     zone key auto-painted when placed (player can repaint)
 *   unlock       research/level id required, null = available from the start
 */

export const BLOCKS = [
  // ---------------------------------------------------------------- natural
  { key: 'grass',      name: 'Grass',            category: 'terrain', color: 0x6d9c56, cost: 12,   maintenance: 0.4, solid: true, support: 4 },
  { key: 'dirt',       name: 'Dirt',             category: 'terrain', color: 0x6b5342, cost: 6,    maintenance: 0,   solid: true, support: 4 },
  { key: 'sand',       name: 'Sand',             category: 'terrain', color: 0xc9b083, cost: 8,    maintenance: 0.1, solid: true, support: 3 },
  { key: 'water',      name: 'Water',            category: 'terrain', color: 0x2f7fb5, cost: 30,   maintenance: 1.2, solid: false, transparent: true, opacity: 0.72, support: 0 },
  { key: 'tree',       name: 'Tree',             category: 'terrain', color: 0x2f6b39, cost: 220,  maintenance: 4,   solid: true, support: 1 },
  { key: 'hedge',      name: 'Hedge',            category: 'terrain', color: 0x3f7a45, cost: 90,   maintenance: 3,   solid: true, support: 1 },

  // ------------------------------------------------------------- structural
  { key: 'concrete',   name: 'Concrete',         category: 'structure', color: 0x9aa0a6, cost: 55,  maintenance: 0.9, solid: true, support: 9 },
  { key: 'reinforced', name: 'Reinforced Conc.', category: 'structure', color: 0x7c838a, cost: 130, maintenance: 1.4, solid: true, support: 16, unlock: 'adv_materials' },
  { key: 'steel',      name: 'Steel',            category: 'structure', color: 0x8d97a3, cost: 165, maintenance: 1.8, solid: true, support: 20 },
  { key: 'beam',       name: 'Structural Beam',  category: 'structure', color: 0x5b6672, cost: 190, maintenance: 2.0, solid: true, support: 26 },
  { key: 'stone',      name: 'Stone',            category: 'structure', color: 0x8b8b86, cost: 70,  maintenance: 0.8, solid: true, support: 11 },
  { key: 'brick',      name: 'Brick',            category: 'structure', color: 0xa8604c, cost: 68,  maintenance: 0.9, solid: true, support: 9 },
  { key: 'metal',      name: 'Metal Panel',      category: 'structure', color: 0xa9b2bb, cost: 92,  maintenance: 1.3, solid: true, support: 7 },

  // --------------------------------------------------------------- exterior
  { key: 'glass',      name: 'Glass',            category: 'exterior', color: 0x9fd4e8, cost: 210, maintenance: 3.0, solid: true, transparent: true, opacity: 0.42, support: 2 },
  { key: 'facade_c',   name: 'Concrete Facade',  category: 'exterior', color: 0xd6d9dd, cost: 120, maintenance: 1.4, solid: true, support: 6, appearance: 2 },
  { key: 'facade_m',   name: 'Metal Facade',     category: 'exterior', color: 0xbcc6d0, cost: 175, maintenance: 1.9, solid: true, support: 6, appearance: 3 },
  { key: 'facade_b',   name: 'Brick Facade',     category: 'exterior', color: 0x94503f, cost: 130, maintenance: 1.2, solid: true, support: 6, appearance: 2 },
  { key: 'facade_s',   name: 'Stone Facade',     category: 'exterior', color: 0xb9b3a6, cost: 155, maintenance: 1.3, solid: true, support: 6, appearance: 3 },

  // --------------------------------------------------------------- flooring
  { key: 'floor_conc', name: 'Concrete Floor',   category: 'surface', color: 0xb0b5ba, cost: 45,  maintenance: 0.6, solid: true, support: 8 },
  { key: 'tile',       name: 'Tile',             category: 'surface', color: 0xdfe4e8, cost: 88,  maintenance: 1.1, solid: true, support: 6, appearance: 2 },
  { key: 'hardwood',   name: 'Hardwood Court',   category: 'surface', color: 0xc8974f, cost: 165, maintenance: 2.4, solid: true, support: 5, autoZone: 'court_basketball' },
  { key: 'rubber',     name: 'Rubber Floor',     category: 'surface', color: 0x4b5158, cost: 95,  maintenance: 1.4, solid: true, support: 5, autoZone: 'training' },
  { key: 'turf',       name: 'Natural Turf',     category: 'surface', color: 0x357f3c, cost: 130, maintenance: 3.6, solid: true, support: 4, autoZone: 'pitch_football' },
  { key: 'turf_synth', name: 'Synthetic Turf',   category: 'surface', color: 0x2f8f57, cost: 175, maintenance: 1.5, solid: true, support: 4, autoZone: 'pitch_football', unlock: 'adv_surfaces' },
  { key: 'clay',       name: 'Clay Court',       category: 'surface', color: 0xc4744a, cost: 120, maintenance: 2.8, solid: true, support: 4, autoZone: 'court_tennis' },
  { key: 'track',      name: 'Running Track',    category: 'surface', color: 0xb4553d, cost: 190, maintenance: 2.2, solid: true, support: 5, autoZone: 'track_athletics' },
  { key: 'ice',        name: 'Ice Surface',      category: 'surface', color: 0xd3ecf5, cost: 240, maintenance: 6.5, solid: true, support: 4, power: 0.004, autoZone: 'rink_ice', unlock: 'ice_tech' },
  { key: 'pool',       name: 'Pool Water',       category: 'surface', color: 0x35a5cf, cost: 260, maintenance: 5.4, solid: true, transparent: true, opacity: 0.62, support: 3, power: 0.002, autoZone: 'pool_swimming', unlock: 'aquatics' },
  { key: 'infield',    name: 'Baseball Infield',  category: 'surface', color: 0xb08a5e, cost: 145, maintenance: 2.6, solid: true, support: 4, autoZone: 'field_baseball', unlock: 'diamond' },
  { key: 'stage',      name: 'Stage Deck',        category: 'surface', color: 0x2a2d33, cost: 210, maintenance: 2.2, solid: true, support: 6, autoZone: 'stage_event' },
  { key: 'esports',    name: 'Esports Stage',     category: 'surface', color: 0x2b2f52, emissive: 0x4455cc, cost: 320, maintenance: 3.4, solid: true, support: 5, power: 0.008, autoZone: 'arena_esports', appearance: 4, unlock: 'esports' },
  { key: 'asphalt',    name: 'Asphalt',          category: 'surface', color: 0x40464c, cost: 38,  maintenance: 0.5, solid: true, support: 7, autoZone: 'parking' },
  { key: 'pavement',   name: 'Pavement',         category: 'surface', color: 0xa5aab0, cost: 42,  maintenance: 0.5, solid: true, support: 7, autoZone: 'concourse' },
  { key: 'road',       name: 'Local Road',       category: 'roads', color: 0x33383d, cost: 60,  maintenance: 1.0, solid: true, support: 7, autoZone: 'road', traffic: 1.0 },
  { key: 'road_main',  name: 'Main Road',        category: 'roads', color: 0x2b3035, cost: 110, maintenance: 1.6, solid: true, support: 7, autoZone: 'road_main', traffic: 2.4 },
  { key: 'road_line',  name: 'Road (Lane Line)', category: 'roads', color: 0xd8d2b4, cost: 66,  maintenance: 1.0, solid: true, support: 7, autoZone: 'road', traffic: 1.0 },
  { key: 'road_service', name: 'Service Road',   category: 'roads', color: 0x3d443b, cost: 72,  maintenance: 1.1, solid: true, support: 7, autoZone: 'road_service', traffic: 0.6 },
  { key: 'road_vip',   name: 'VIP Access Road',  category: 'roads', color: 0x4a3d5c, cost: 145, maintenance: 2.0, solid: true, support: 7, autoZone: 'road_vip', traffic: 0.8, appearance: 2 },
  { key: 'road_emerg', name: 'Emergency Route',  category: 'roads', color: 0x5c3535, cost: 130, maintenance: 1.8, solid: true, support: 7, autoZone: 'road_emergency', traffic: 0.5, safety: 2 },
  { key: 'bus_lane',   name: 'Bus Lane',         category: 'roads', color: 0x2f4a4f, cost: 125, maintenance: 1.7, solid: true, support: 7, autoZone: 'road_bus', traffic: 1.2 },
  { key: 'path',       name: 'Pedestrian Path',  category: 'roads', color: 0xbfae94, cost: 40,  maintenance: 0.4, solid: true, support: 7, autoZone: 'concourse' },
  { key: 'park_staff', name: 'Staff Parking',    category: 'roads', color: 0x4c5158, cost: 42,  maintenance: 0.5, solid: true, support: 7, autoZone: 'parking_staff' },
  { key: 'park_taxi',  name: 'Taxi / Rideshare', category: 'roads', color: 0x6a5c3a, cost: 58,  maintenance: 0.8, solid: true, support: 7, autoZone: 'parking_taxi' },
  { key: 'park_vip',   name: 'VIP Parking',      category: 'roads', color: 0x5a4a70, cost: 96,  maintenance: 1.1, solid: true, support: 7, autoZone: 'parking_vip', appearance: 1 },

  // ---------------------------------------------------------------- seating
  { key: 'seat',       name: 'Seating',          category: 'seating', color: 0x2f6fd0, cost: 320, maintenance: 4.2, solid: true, support: 5, autoZone: 'seating' },
  { key: 'seat_alt',   name: 'Seating (Accent)', category: 'seating', color: 0xd8b13a, cost: 320, maintenance: 4.2, solid: true, support: 5, autoZone: 'seating', appearance: 2 },
  { key: 'seat_box',   name: 'Luxury Box',       category: 'seating', color: 0x8a6ad0, cost: 2600, maintenance: 26.0, solid: true, support: 5, autoZone: 'luxury_box', appearance: 6, revenue: 340, unlock: 'hospitality' },
  { key: 'seat_vip',   name: 'VIP Seating',      category: 'seating', color: 0x7b4fd0, cost: 980, maintenance: 12.0, solid: true, support: 5, autoZone: 'seating_vip', appearance: 3, unlock: 'hospitality' },
  { key: 'terrace',    name: 'Standing Terrace', category: 'seating', color: 0x6c7480, cost: 140, maintenance: 1.8, solid: true, support: 6, autoZone: 'seating_standing' },
  { key: 'stair',      name: 'Stairs',           category: 'seating', color: 0x9b9fa4, cost: 90,  maintenance: 1.0, solid: true, support: 6, autoZone: 'stairs' },

  // ---------------------------------------------------------------- roofing
  { key: 'roof_conc',  name: 'Concrete Roof',    category: 'roof', color: 0x8f959b, cost: 145, maintenance: 1.6, solid: true, support: 3, spans: 5 },
  { key: 'roof_metal', name: 'Metal Roof',       category: 'roof', color: 0xb6bfc8, cost: 175, maintenance: 1.9, solid: true, support: 3, spans: 8, appearance: 2 },
  { key: 'roof_glass', name: 'Glass Roof',       category: 'roof', color: 0xbfe2ef, cost: 320, maintenance: 3.4, solid: true, transparent: true, opacity: 0.4, support: 2, spans: 6, appearance: 4, unlock: 'adv_materials' },
  { key: 'roof_stadium', name: 'Stadium Canopy', category: 'roof', color: 0xe3e8ec, cost: 420, maintenance: 4.2, solid: true, support: 3, spans: 14, appearance: 5, unlock: 'canopy' },
  { key: 'roof_retract', name: 'Retractable Panel', category: 'roof', color: 0xcfd8e0, cost: 980, maintenance: 11.0, solid: true, support: 3, spans: 12, appearance: 7, power: 0.004, unlock: 'retractable' },

  // ------------------------------------------------------------- decorative
  { key: 'team_a',     name: 'Team Colour A',    category: 'decor', color: 0x1f4fa0, cost: 60,  maintenance: 0.7, solid: true, support: 5, appearance: 2 },
  { key: 'team_b',     name: 'Team Colour B',    category: 'decor', color: 0xc23a3a, cost: 60,  maintenance: 0.7, solid: true, support: 5, appearance: 2 },
  { key: 'team_c',     name: 'Team Colour C',    category: 'decor', color: 0xf0f2f4, cost: 60,  maintenance: 0.7, solid: true, support: 5, appearance: 2 },
  { key: 'advert',     name: 'Advertising Panel',category: 'decor', color: 0xe8ac2a, cost: 240, maintenance: 2.0, solid: true, support: 3, appearance: 3, revenue: 55 },
  { key: 'screen',     name: 'Digital Screen',   category: 'decor', color: 0x14202e, emissive: 0x2c6fd8, cost: 1400, maintenance: 16, solid: true, support: 3, appearance: 8, power: 0.015, revenue: 260, unlock: 'broadcast' },
  { key: 'banner',     name: 'Banner',           category: 'decor', color: 0xb0273f, cost: 70,  maintenance: 1.0, solid: true, support: 1, appearance: 3 },
  { key: 'flag',       name: 'Flag',             category: 'decor', color: 0xe4e9ee, cost: 110, maintenance: 1.4, solid: true, support: 1, appearance: 3 },
  { key: 'floodlight', name: 'Floodlight',       category: 'decor', color: 0xf5f1d8, emissive: 0xfff3c0, cost: 1600, maintenance: 22, solid: true, support: 4, appearance: 4, power: 0.3, light: true },
  { key: 'railing',    name: 'Railing',          category: 'decor', color: 0xc2c8ce, cost: 80,  maintenance: 1.1, solid: true, support: 2, appearance: 2, safety: 1 },
  { key: 'bench',      name: 'Bench',            category: 'decor', color: 0x8a6a44, cost: 95,  maintenance: 1.0, solid: true, support: 2, appearance: 2 },
  { key: 'planter',    name: 'Planter',          category: 'decor', color: 0x4d7a4a, cost: 120, maintenance: 2.4, solid: true, support: 2, appearance: 3 },
];

// --------------------------------------------------------------------------

export const AIR = 0;

/** Numeric id <-> block. Index 0 is reserved for air. */
export const BLOCK_BY_ID = [
  { id: 0, key: 'air', name: 'Air', category: 'none', color: 0x000000, cost: 0, maintenance: 0, solid: false, transparent: true, support: 0 },
];
export const BLOCK_BY_KEY = new Map();

BLOCKS.forEach((b, i) => {
  const rec = {
    id: i + 1,
    support: 5,
    spans: 2,
    maintenance: 0,
    cost: 0,
    solid: true,
    transparent: false,
    opacity: 1,
    appearance: 0,
    power: 0,
    revenue: 0,
    safety: 0,
    light: false,
    autoZone: null,
    unlock: null,
    ...b,
  };
  BLOCK_BY_ID.push(rec);
  BLOCK_BY_KEY.set(rec.key, rec);
});

export function block(idOrKey) {
  if (typeof idOrKey === 'number') return BLOCK_BY_ID[idOrKey] || BLOCK_BY_ID[0];
  return BLOCK_BY_KEY.get(idOrKey) || BLOCK_BY_ID[0];
}

export function blockId(key) {
  const b = BLOCK_BY_KEY.get(key);
  return b ? b.id : 0;
}

export const BLOCK_CATEGORIES = [
  { key: 'structure', name: 'Structure' },
  { key: 'exterior',  name: 'Exterior' },
  { key: 'surface',   name: 'Surfaces' },
  { key: 'roads',     name: 'Roads & Parking' },
  { key: 'seating',   name: 'Seating' },
  { key: 'roof',      name: 'Roofing' },
  { key: 'decor',     name: 'Decor' },
  { key: 'terrain',   name: 'Terrain' },
];

export function blocksInCategory(cat) {
  return BLOCK_BY_ID.filter((b) => b.category === cat);
}
