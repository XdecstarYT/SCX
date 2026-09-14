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
 *   finish       how the surface catches light: 'matte' (default), 'turf' for
 *                mown grass, 'gloss' for glass, metal, ice and water
 */

export const BLOCKS = [
  // ---------------------------------------------------------------- natural
  // Natural ground costs nothing to keep: the plot arrives covered in it, and
  // billing upkeep on the lawn you were given made it the single largest line
  // on an early complex's books.
  { key: 'grass',      name: 'Grass',            category: 'terrain', color: 0x6d9c56, cost: 12,   maintenance: 0,   solid: true, support: 4, finish: 'turf' },
  { key: 'dirt',       name: 'Dirt',             category: 'terrain', color: 0x6b5342, cost: 6,    maintenance: 0,   solid: true, support: 4, finish: 'gravel' },
  { key: 'sand',       name: 'Sand',             category: 'terrain', color: 0xc9b083, cost: 8,    maintenance: 0.1, solid: true, support: 3, finish: 'sand' },
  { key: 'water',      name: 'Water',            category: 'terrain', color: 0x2f7fb5, cost: 30,   maintenance: 1.2, solid: false, transparent: true, opacity: 0.72, support: 0, finish: 'water' },
  { key: 'tree',       name: 'Tree',             category: 'terrain', color: 0x2f6b39, cost: 220,  maintenance: 4,   solid: true, support: 1 },
  { key: 'hedge',      name: 'Hedge',            category: 'terrain', color: 0x3f7a45, cost: 90,   maintenance: 3,   solid: true, support: 1 },

  // ------------------------------------------------------------- structural
  { key: 'concrete',   name: 'Concrete',         category: 'structure', color: 0x9aa0a6, cost: 55,  maintenance: 0.9, solid: true, support: 9 },
  { key: 'reinforced', name: 'Reinforced Conc.', category: 'structure', color: 0x7c838a, cost: 130, maintenance: 1.4, solid: true, support: 16, unlock: 'adv_materials' },
  { key: 'steel',      name: 'Steel',            category: 'structure', color: 0x8d97a3, cost: 165, maintenance: 1.8, solid: true, support: 20, finish: 'metal' },
  { key: 'beam',       name: 'Structural Beam',  category: 'structure', color: 0x5b6672, cost: 190, maintenance: 2.0, solid: true, support: 26 },
  { key: 'stone',      name: 'Stone',            category: 'structure', color: 0x8b8b86, cost: 70,  maintenance: 0.8, solid: true, support: 11, finish: 'stone' },
  { key: 'brick',      name: 'Brick',            category: 'structure', color: 0xa8604c, cost: 68,  maintenance: 0.9, solid: true, support: 9, finish: 'brick' },
  { key: 'metal',      name: 'Metal Panel',      category: 'structure', color: 0xa9b2bb, cost: 92,  maintenance: 1.3, solid: true, support: 7, finish: 'metal' },

  // --------------------------------------------------------------- exterior
  { key: 'glass',      name: 'Glass',            category: 'exterior', color: 0x9fd4e8, cost: 210, maintenance: 3.0, solid: true, transparent: true, opacity: 0.42, support: 2, finish: 'gloss' },
  { key: 'facade_c',   name: 'Concrete Facade',  category: 'exterior', color: 0xd6d9dd, cost: 120, maintenance: 1.4, solid: true, support: 6, appearance: 2 },
  { key: 'facade_m',   name: 'Metal Facade',     category: 'exterior', color: 0xbcc6d0, cost: 175, maintenance: 1.9, solid: true, support: 6, appearance: 3, finish: 'metal' },
  { key: 'facade_b',   name: 'Brick Facade',     category: 'exterior', color: 0x94503f, cost: 130, maintenance: 1.2, solid: true, support: 6, appearance: 2, finish: 'brick' },
  { key: 'facade_s',   name: 'Stone Facade',     category: 'exterior', color: 0xb9b3a6, cost: 155, maintenance: 1.3, solid: true, support: 6, appearance: 3, finish: 'stone' },

  // --------------------------------------------------------------- flooring
  { key: 'floor_conc', name: 'Concrete Floor',   category: 'surface', color: 0xb0b5ba, cost: 45,  maintenance: 0.6, solid: true, support: 8 },
  { key: 'tile',       name: 'Tile',             category: 'surface', color: 0xdfe4e8, cost: 88,  maintenance: 1.1, solid: true, support: 6, appearance: 2, finish: 'gloss' },
  { key: 'hardwood',   name: 'Hardwood Court',   category: 'surface', color: 0xc8974f, cost: 165, maintenance: 2.4, solid: true, support: 5, autoZone: 'court_basketball', finish: 'timber' },
  { key: 'rubber',     name: 'Rubber Floor',     category: 'surface', color: 0x4b5158, cost: 95,  maintenance: 1.4, solid: true, support: 5, autoZone: 'training', finish: 'gravel' },
  { key: 'turf',       name: 'Natural Turf',     category: 'surface', color: 0x357f3c, cost: 130, maintenance: 3.6, solid: true, support: 4, autoZone: 'pitch_football', finish: 'turf' },
  { key: 'turf_synth', name: 'Synthetic Turf',   category: 'surface', color: 0x2f8f57, cost: 175, maintenance: 1.5, solid: true, support: 4, autoZone: 'pitch_football', unlock: 'adv_surfaces', finish: 'turf' },
  { key: 'clay',       name: 'Clay Court',       category: 'surface', color: 0xc4744a, cost: 120, maintenance: 2.8, solid: true, support: 4, autoZone: 'court_tennis', finish: 'gravel' },
  { key: 'track',      name: 'Running Track',    category: 'surface', color: 0xb4553d, cost: 190, maintenance: 2.2, solid: true, support: 5, autoZone: 'track_athletics', finish: 'track' },
  { key: 'ice',        name: 'Ice Surface',      category: 'surface', color: 0xd3ecf5, cost: 240, maintenance: 6.5, solid: true, support: 4, power: 0.004, autoZone: 'rink_ice', unlock: 'ice_tech', finish: 'gloss' },
  { key: 'pool',       name: 'Pool Water',       category: 'surface', color: 0x35a5cf, cost: 260, maintenance: 5.4, solid: true, transparent: true, opacity: 0.62, support: 3, power: 0.002, autoZone: 'pool_swimming', unlock: 'aquatics', finish: 'gloss' },
  { key: 'infield',    name: 'Baseball Infield',  category: 'surface', color: 0xb08a5e, cost: 145, maintenance: 2.6, solid: true, support: 4, autoZone: 'field_baseball', unlock: 'diamond', finish: 'turf' },
  { key: 'stage',      name: 'Stage Deck',        category: 'surface', color: 0x2a2d33, cost: 210, maintenance: 2.2, solid: true, support: 6, autoZone: 'stage_event' },
  { key: 'esports',    name: 'Esports Stage',     category: 'surface', color: 0x2b2f52, emissive: 0x4455cc, cost: 320, maintenance: 3.4, solid: true, support: 5, power: 0.008, autoZone: 'arena_esports', appearance: 4, unlock: 'esports' },
  { key: 'asphalt',    name: 'Asphalt',          category: 'surface', color: 0x40464c, cost: 38,  maintenance: 0.5, solid: true, support: 7, autoZone: 'parking', finish: 'asphalt' },
  { key: 'pavement',   name: 'Pavement',         category: 'surface', color: 0xa5aab0, cost: 42,  maintenance: 0.5, solid: true, support: 7, autoZone: 'concourse' },
  { key: 'road',       name: 'Local Road',       category: 'roads', color: 0x33383d, cost: 60,  maintenance: 1.0, solid: true, support: 7, autoZone: 'road', traffic: 1.0, finish: 'asphalt' },
  { key: 'road_main',  name: 'Main Road',        category: 'roads', color: 0x2b3035, cost: 110, maintenance: 1.6, solid: true, support: 7, autoZone: 'road_main', traffic: 2.4, finish: 'asphalt' },
  { key: 'road_line',  name: 'Road (Lane Line)', category: 'roads', color: 0xd8d2b4, cost: 66,  maintenance: 1.0, solid: true, support: 7, autoZone: 'road', traffic: 1.0 },
  { key: 'road_service', name: 'Service Road',   category: 'roads', color: 0x3d443b, cost: 72,  maintenance: 1.1, solid: true, support: 7, autoZone: 'road_service', traffic: 0.6, finish: 'asphalt' },
  { key: 'road_vip',   name: 'VIP Access Road',  category: 'roads', color: 0x4a3d5c, cost: 145, maintenance: 2.0, solid: true, support: 7, autoZone: 'road_vip', traffic: 0.8, appearance: 2, finish: 'asphalt' },
  { key: 'road_emerg', name: 'Emergency Route',  category: 'roads', color: 0x5c3535, cost: 130, maintenance: 1.8, solid: true, support: 7, autoZone: 'road_emergency', traffic: 0.5, safety: 2, finish: 'asphalt' },
  { key: 'bus_lane',   name: 'Bus Lane',         category: 'roads', color: 0x2f4a4f, cost: 125, maintenance: 1.7, solid: true, support: 7, autoZone: 'road_bus', traffic: 1.2, finish: 'asphalt' },
  { key: 'path',       name: 'Pedestrian Path',  category: 'roads', color: 0xbfae94, cost: 40,  maintenance: 0.4, solid: true, support: 7, autoZone: 'concourse', finish: 'timber' },
  { key: 'park_staff', name: 'Staff Parking',    category: 'roads', color: 0x4c5158, cost: 42,  maintenance: 0.5, solid: true, support: 7, autoZone: 'parking_staff', finish: 'asphalt' },
  { key: 'park_taxi',  name: 'Taxi / Rideshare', category: 'roads', color: 0x6a5c3a, cost: 58,  maintenance: 0.8, solid: true, support: 7, autoZone: 'parking_taxi', finish: 'asphalt' },
  { key: 'park_vip',   name: 'VIP Parking',      category: 'roads', color: 0x5a4a70, cost: 96,  maintenance: 1.1, solid: true, support: 7, autoZone: 'parking_vip', appearance: 1, finish: 'asphalt' },

  // ---------------------------------------------------------------- seating
  { key: 'seat',       name: 'Seating',          category: 'seating', color: 0x39628f, cost: 320, maintenance: 4.2, solid: true, support: 5, autoZone: 'seating', finish: 'seat' },
  { key: 'seat_alt',   name: 'Seating (Accent)', category: 'seating', color: 0xd8b13a, cost: 320, maintenance: 4.2, solid: true, support: 5, autoZone: 'seating', appearance: 2, finish: 'seat' },
  { key: 'seat_box',   name: 'Luxury Box',       category: 'seating', color: 0x8a6ad0, cost: 2600, maintenance: 26.0, solid: true, support: 5, autoZone: 'luxury_box', appearance: 6, revenue: 340, unlock: 'hospitality', finish: 'seat' },
  { key: 'seat_vip',   name: 'VIP Seating',      category: 'seating', color: 0x7b4fd0, cost: 980, maintenance: 12.0, solid: true, support: 5, autoZone: 'seating_vip', appearance: 3, unlock: 'hospitality', finish: 'seat' },
  { key: 'terrace',    name: 'Standing Terrace', category: 'seating', color: 0x6c7480, cost: 140, maintenance: 1.8, solid: true, support: 6, autoZone: 'seating_standing', finish: 'seat' },
  { key: 'stair',      name: 'Stairs',           category: 'seating', color: 0x9b9fa4, cost: 90,  maintenance: 1.0, solid: true, support: 6, autoZone: 'stairs' },

  // ---------------------------------------------------------------- roofing
  { key: 'roof_conc',  name: 'Concrete Roof',    category: 'roof', color: 0x8f959b, cost: 145, maintenance: 1.6, solid: true, support: 3, spans: 5 },
  { key: 'roof_metal', name: 'Metal Roof',       category: 'roof', color: 0xb6bfc8, cost: 175, maintenance: 1.9, solid: true, support: 3, spans: 8, appearance: 2, finish: 'metal' },
  { key: 'roof_glass', name: 'Glass Roof',       category: 'roof', color: 0xbfe2ef, cost: 320, maintenance: 3.4, solid: true, transparent: true, opacity: 0.4, support: 2, spans: 6, appearance: 4, unlock: 'adv_materials', finish: 'gloss' },
  { key: 'roof_stadium', name: 'Stadium Canopy', category: 'roof', color: 0xe3e8ec, cost: 420, maintenance: 4.2, solid: true, support: 3, spans: 14, appearance: 5, unlock: 'canopy', finish: 'gloss' },
  { key: 'roof_retract', name: 'Retractable Panel', category: 'roof', color: 0xcfd8e0, cost: 980, maintenance: 11.0, solid: true, support: 3, spans: 12, appearance: 7, power: 0.004, unlock: 'retractable', finish: 'gloss' },

  // ------------------------------------------------------------- decorative
  { key: 'team_a',     name: 'Team Colour A',    category: 'decor', color: 0x1f4fa0, cost: 60,  maintenance: 0.7, solid: true, support: 5, appearance: 2 },
  { key: 'team_b',     name: 'Team Colour B',    category: 'decor', color: 0xc23a3a, cost: 60,  maintenance: 0.7, solid: true, support: 5, appearance: 2 },
  { key: 'team_c',     name: 'Team Colour C',    category: 'decor', color: 0xf0f2f4, cost: 60,  maintenance: 0.7, solid: true, support: 5, appearance: 2 },
  { key: 'advert',     name: 'Advertising Panel',category: 'decor', color: 0xe8ac2a, cost: 240, maintenance: 2.0, solid: true, support: 3, appearance: 3, revenue: 55 },
  { key: 'screen',     name: 'Digital Screen',   category: 'decor', color: 0x14202e, emissive: 0x2c6fd8, cost: 1400, maintenance: 16, solid: true, support: 3, appearance: 8, power: 0.015, revenue: 260, unlock: 'broadcast', finish: 'gloss' },
  { key: 'banner',     name: 'Banner',           category: 'decor', color: 0xb0273f, cost: 70,  maintenance: 1.0, solid: true, support: 1, appearance: 3, finish: 'fabric' },
  { key: 'flag',       name: 'Flag',             category: 'decor', color: 0xe4e9ee, cost: 110, maintenance: 1.4, solid: true, support: 1, appearance: 3, finish: 'fabric' },
  { key: 'floodlight', name: 'Floodlight',       category: 'decor', color: 0xf5f1d8, emissive: 0xfff3c0, cost: 1600, maintenance: 22, solid: true, support: 4, appearance: 4, power: 0.3, light: true },
  { key: 'railing',    name: 'Railing',          category: 'decor', color: 0xc2c8ce, cost: 80,  maintenance: 1.1, solid: true, support: 2, appearance: 2, safety: 1, finish: 'metal' },
  { key: 'bench',      name: 'Bench',            category: 'decor', color: 0x8a6a44, cost: 95,  maintenance: 1.0, solid: true, support: 2, appearance: 2, finish: 'timber' },
  { key: 'planter',    name: 'Planter',          category: 'decor', color: 0x4d7a4a, cost: 120, maintenance: 2.4, solid: true, support: 2, appearance: 3 },

  // --------------------------------------------------------------------------
  // Added after release. A block's id is its index in this array and the world
  // is saved as raw ids, so new blocks go on the end: inserting one in the
  // middle renumbers every block after it and turns the seating in every
  // existing save into roofing. The hotbar groups by `category`, not by
  // position here, so appending costs nothing in the UI.
  // --------------------------------------------------------------------------
  { key: 'timber',     name: 'Timber Frame',     category: 'structure', color: 0xa9793f, cost: 34,  maintenance: 1.6, solid: true, support: 5, appearance: 1, finish: 'timber' },
  { key: 'window',     name: 'Window',           category: 'exterior', color: 0xbfe0ef, cost: 190, maintenance: 2.6, solid: true, transparent: true, opacity: 0.34, support: 3, appearance: 3, finish: 'gloss' },
  // A doorway is a hole you can walk through, so it does not block movement,
  // and it zones itself as an entrance: the analyser counts each separate run
  // of entrance zone as a gate, and gates are most of what crowd flow and
  // safety are scored on. Cutting doors into a facade is a real decision.
  { key: 'door',       name: 'Doorway',          category: 'exterior', color: 0x6f4c30, cost: 240, maintenance: 2.2, solid: false, transparent: true, opacity: 0.9, support: 2, appearance: 2, autoZone: 'entrance', finish: 'timber' },
  { key: 'fence',      name: 'Perimeter Fence',  category: 'decor', color: 0x707880, cost: 46,  maintenance: 0.8, solid: true, support: 1, appearance: 1, safety: 1, finish: 'netting' },

  // --------------------------------------------------------------------------
  // The second materials pass. Still appended, still never reordered.
  // --------------------------------------------------------------------------

  // Structure
  { key: 'granite',    name: 'Granite',          category: 'structure', color: 0x6f7278, cost: 145, maintenance: 0.7, solid: true, support: 14, appearance: 2, finish: 'stone' },
  { key: 'truss',      name: 'Steel Truss',      category: 'structure', color: 0x6c7681, cost: 240, maintenance: 2.2, solid: true, support: 32, spans: 4, finish: 'metal' },
  { key: 'rebar_conc', name: 'Precast Section',  category: 'structure', color: 0x878d94, cost: 180, maintenance: 1.1, solid: true, support: 18, unlock: 'precast' },
  { key: 'mesh',       name: 'Steel Mesh',       category: 'structure', color: 0x9aa3ad, cost: 58,  maintenance: 1.0, solid: true, transparent: true, opacity: 0.45, support: 3, finish: 'netting' },

  // Exterior
  { key: 'curtain',    name: 'Curtain Wall',     category: 'exterior', color: 0x8fc3dc, cost: 285, maintenance: 3.4, solid: true, transparent: true, opacity: 0.38, support: 3, appearance: 5, finish: 'gloss', unlock: 'adv_materials' },
  { key: 'perforated', name: 'Perforated Panel', category: 'exterior', color: 0xa8b2bd, cost: 160, maintenance: 1.6, solid: true, support: 5, appearance: 4, finish: 'mesh' },
  { key: 'louvre',     name: 'Louvre Screen',    category: 'exterior', color: 0xc2c9d1, cost: 175, maintenance: 1.8, solid: true, support: 4, appearance: 4, finish: 'metal' },
  { key: 'arch',       name: 'Entrance Arch',    category: 'exterior', color: 0xe2e6ea, cost: 320, maintenance: 2.4, solid: true, support: 12, appearance: 7 },

  // Surfaces
  { key: 'carpet',     name: 'Carpet',           category: 'surface', color: 0x6d4550, cost: 64,  maintenance: 1.4, solid: true, support: 5, appearance: 2, finish: 'fabric' },
  { key: 'crumb',      name: 'Rubber Crumb',     category: 'surface', color: 0x3c4147, cost: 110, maintenance: 1.2, solid: true, support: 4, autoZone: 'training', finish: 'gravel' },
  { key: 'sand_court', name: 'Beach Court Sand', category: 'surface', color: 0xe0c48d, cost: 96,  maintenance: 1.8, solid: true, support: 3, autoZone: 'court_beach', finish: 'sand' },
  { key: 'gravel',     name: 'Gravel',           category: 'surface', color: 0x8c8880, cost: 26,  maintenance: 0.4, solid: true, support: 6, finish: 'gravel' },
  { key: 'boards',     name: 'Velodrome Boards', category: 'surface', color: 0xc79a5c, cost: 230, maintenance: 2.6, solid: true, support: 5, autoZone: 'track_cycling', unlock: 'velodrome', finish: 'boards' },
  { key: 'skate_conc', name: 'Skate Concrete',   category: 'surface', color: 0x9ea4a9, cost: 120, maintenance: 1.0, solid: true, support: 8, autoZone: 'park_skate', finish: 'asphalt' },
  { key: 'gym_floor',  name: 'Sprung Floor',     category: 'surface', color: 0xd2a566, cost: 185, maintenance: 2.0, solid: true, support: 5, autoZone: 'court_volleyball', finish: 'boards' },
  { key: 'ice_synth',  name: 'Synthetic Ice',    category: 'surface', color: 0xdfeef5, cost: 175, maintenance: 2.2, solid: true, support: 4, autoZone: 'rink_ice', finish: 'gloss', unlock: 'ice_tech' },

  // Roads and access
  { key: 'cycle_lane', name: 'Cycle Lane',       category: 'roads', color: 0x2f6a54, cost: 64,  maintenance: 0.7, solid: true, support: 7, autoZone: 'cycle_route', traffic: 0.4, finish: 'asphalt' },
  { key: 'tram',       name: 'Tram Line',        category: 'roads', color: 0x4a4f58, cost: 240, maintenance: 2.4, solid: true, support: 7, autoZone: 'transit', traffic: 2.0, unlock: 'transport', finish: 'asphalt' },
  { key: 'crossing',   name: 'Crossing',         category: 'roads', color: 0xdad5c2, cost: 72,  maintenance: 0.9, solid: true, support: 7, autoZone: 'road', traffic: 0.8, safety: 1 },
  { key: 'dropoff',    name: 'Drop-off Bay',     category: 'roads', color: 0x585f68, cost: 86,  maintenance: 0.9, solid: true, support: 7, autoZone: 'parking_taxi', traffic: 1.0, finish: 'asphalt' },

  // Seating
  { key: 'seat_rail',  name: 'Rail Seating',     category: 'seating', color: 0x3f6f5e, cost: 360, maintenance: 4.0, solid: true, support: 5, autoZone: 'seating', safety: 2, finish: 'seat', unlock: 'rail_seating' },
  { key: 'seat_pad',   name: 'Padded Seating',   category: 'seating', color: 0x59405f, cost: 430, maintenance: 5.0, solid: true, support: 5, autoZone: 'seating', appearance: 2, finish: 'seat' },
  { key: 'seat_press', name: 'Press Seating',    category: 'seating', color: 0x4a5764, cost: 480, maintenance: 5.2, solid: true, support: 5, autoZone: 'media', finish: 'seat' },
  { key: 'seat_acc',   name: 'Accessible Bay',   category: 'seating', color: 0x3a7ba0, cost: 520, maintenance: 4.4, solid: true, support: 5, autoZone: 'seating', safety: 2, appearance: 1, finish: 'seat' },

  // Roofing
  { key: 'roof_etfe',  name: 'ETFE Cushion',     category: 'roof', color: 0xe8f2f7, cost: 520, maintenance: 4.6, solid: true, transparent: true, opacity: 0.5, support: 3, spans: 16, appearance: 7, finish: 'gloss', unlock: 'etfe' },
  { key: 'roof_fabric',name: 'Tensile Fabric',   category: 'roof', color: 0xf0eee6, cost: 340, maintenance: 3.8, solid: true, support: 2, spans: 12, appearance: 5, unlock: 'canopy', finish: 'fabric' },
  { key: 'roof_solar', name: 'Solar Roof',       category: 'roof', color: 0x1d2733, cost: 610, maintenance: 4.0, solid: true, support: 3, spans: 6, appearance: 3, power: -0.014, finish: 'gloss', unlock: 'solar' },
  { key: 'roof_louvre',name: 'Louvred Roof',     category: 'roof', color: 0xb9c2cb, cost: 400, maintenance: 3.6, solid: true, support: 3, spans: 9, appearance: 5, finish: 'metal' },

  // Decoration
  { key: 'statue',     name: 'Statue',           category: 'decor', color: 0xb9a87c, cost: 1_400, maintenance: 3.0, solid: true, support: 3, appearance: 9 },
  { key: 'fountain',   name: 'Fountain',         category: 'decor', color: 0x7fbcd6, cost: 900,  maintenance: 5.5, solid: true, support: 2, appearance: 7, finish: 'gloss' },
  { key: 'clocktower', name: 'Clock Face',       category: 'decor', color: 0xf1ece0, cost: 1_100, maintenance: 3.2, solid: true, support: 4, appearance: 8 },
  { key: 'turnstile',  name: 'Turnstile',        category: 'decor', color: 0x757d86, cost: 380,  maintenance: 2.6, solid: true, support: 3, autoZone: 'entrance', safety: 1, finish: 'metal' },
  { key: 'kiosk',      name: 'Ticket Kiosk',     category: 'decor', color: 0xc8a75a, cost: 520,  maintenance: 3.0, solid: true, support: 3, autoZone: 'box_office', revenue: 40, appearance: 2, finish: 'metal' },
  { key: 'cctv',       name: 'Camera Mast',      category: 'decor', color: 0x6b737c, cost: 640,  maintenance: 4.0, solid: true, support: 3, power: 0.004, safety: 3 },
  { key: 'speaker',    name: 'Speaker Stack',    category: 'decor', color: 0x23262b, cost: 700,  maintenance: 4.2, solid: true, support: 3, power: 0.006, appearance: 2 },
  { key: 'mural',      name: 'Mural Panel',      category: 'decor', color: 0xd4634a, cost: 190,  maintenance: 1.4, solid: true, support: 3, appearance: 5 },
  { key: 'pine',       name: 'Pine Tree',        category: 'terrain', color: 0x2b5a37, cost: 240,  maintenance: 3.4, solid: true, support: 1, appearance: 3 },

  // Plant and service. These are the first blocks that pay their way on the
  // utility networks rather than on the gate: a roof of solar panels genuinely
  // reduces what the grid has to supply.
  { key: 'solar_panel',name: 'Solar Array',      category: 'service', color: 0x16202c, cost: 480, maintenance: 2.4, solid: true, support: 3, power: -0.012, finish: 'gloss', unlock: 'solar' },
  { key: 'water_tank', name: 'Water Tank',       category: 'service', color: 0x8d99a4, cost: 520, maintenance: 2.8, solid: true, support: 6, finish: 'gloss' },
  { key: 'generator',  name: 'Standby Generator',category: 'service', color: 0x3d444c, cost: 860, maintenance: 6.0, solid: true, support: 5, power: -0.02, safety: 2, unlock: 'power_grid' },
  { key: 'hvac',       name: 'Plant Unit',       category: 'service', color: 0x7c858e, cost: 640, maintenance: 5.0, solid: true, support: 4, power: 0.01 },
  { key: 'substation', name: 'Substation',       category: 'service', color: 0x555c64, cost: 980, maintenance: 5.6, solid: true, support: 6, power: -0.03, unlock: 'power_grid' },
  { key: 'recycling',  name: 'Recycling Point',  category: 'service', color: 0x3f7a52, cost: 220, maintenance: 1.6, solid: true, support: 3, autoZone: 'waste', appearance: 1 },
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
    finish: 'matte',
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
  { key: 'service',   name: 'Plant & Service' },
  { key: 'terrain',   name: 'Terrain' },
];

export function blocksInCategory(cat) {
  return BLOCK_BY_ID.filter((b) => b.category === cat);
}
