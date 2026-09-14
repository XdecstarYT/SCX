/**
 * Research unlocks *possibilities*, not stat padding. Every node gates real
 * blocks or real systems.
 */
export const RESEARCH = [
  { id: 'adv_materials', name: 'Advanced Materials', cost: 450_000, days: 12, reqRep: 20,
    desc: 'Unlocks Reinforced Concrete, Glass Roof panels and Curtain Wall glazing.',
    unlocks: ['reinforced', 'roof_glass', 'curtain'] },
  { id: 'hospitality', name: 'Premium Hospitality', cost: 900_000, days: 18, reqRep: 30,
    desc: 'Unlocks VIP Seating and Luxury Box blocks.', unlocks: ['seat_vip', 'seat_box'] },
  { id: 'adv_surfaces', name: 'Advanced Sports Surfaces', cost: 700_000, days: 14, reqRep: 26,
    desc: 'Unlocks Synthetic Turf, which needs far less maintenance.', unlocks: ['turf_synth'] },
  { id: 'canopy', name: 'Long-Span Canopies', cost: 1_600_000, days: 24, reqRep: 40, req: ['adv_materials'],
    desc: 'Unlocks Stadium Canopy panels spanning 28m without support, and lightweight Tensile Fabric.',
    unlocks: ['roof_stadium', 'roof_fabric'] },
  { id: 'broadcast', name: 'Broadcast Technology', cost: 2_100_000, days: 26, reqRep: 45,
    desc: 'Unlocks Digital Screens and raises broadcast revenue by 12%.', unlocks: ['screen'], broadcastBonus: 0.12 },
  { id: 'ice_tech', name: 'Ice Plant Technology', cost: 1_400_000, days: 20, reqRep: 34,
    desc: 'Unlocks Ice Surface for ice arenas, and Synthetic Ice for year-round training rinks.',
    unlocks: ['ice', 'ice_synth'] },
  { id: 'aquatics', name: 'Aquatics Engineering', cost: 1_800_000, days: 22, reqRep: 36,
    desc: 'Unlocks Pool Water for aquatic centres.', unlocks: ['pool'] },
  { id: 'retractable', name: 'Retractable Roof Systems', cost: 6_500_000, days: 40, reqRep: 62, req: ['canopy'],
    desc: 'Unlocks Retractable Roof panels. Weather stops mattering.', unlocks: ['roof_retract'] },
  { id: 'diamond', name: 'Diamond Sports', cost: 950_000, days: 16, reqRep: 28,
    desc: 'Unlocks Baseball Infield and the baseball event circuit.', unlocks: ['infield'] },
  { id: 'esports', name: 'Esports Production', cost: 2_400_000, days: 22, reqRep: 48, req: ['broadcast'],
    desc: 'Unlocks the Esports Stage and championship-tier esports events.', unlocks: ['esports'] },
  { id: 'transport', name: 'Transport Integration', cost: 2_800_000, days: 28, reqRep: 48,
    desc: 'Transit stops carry 60% more spectators, and you may lay Tram Line through the site.',
    transitBonus: 0.6, unlocks: ['tram'] },
  { id: 'power_grid', name: 'Grid Upgrade', cost: 1_200_000, days: 16, reqRep: 22,
    desc: 'Raises site power capacity by 40MW, and unlocks on-site substations and standby generators.',
    powerCapacity: 40, unlocks: ['generator', 'substation'] },
  { id: 'security_tech', name: 'Security Screening Tech', cost: 1_500_000, days: 18, reqRep: 40,
    desc: 'Gates process 35% more spectators per hour.', gateBonus: 0.35 },

  // --- Second wave. Appended, like every other registry in this project. ---
  { id: 'precast', name: 'Precast Concrete Systems', cost: 380_000, days: 10, reqRep: 14,
    desc: 'Unlocks Precast Sections: factory-cast structure that carries far more load than poured concrete.',
    unlocks: ['rebar_conc'] },
  { id: 'rail_seating', name: 'Safe Standing', cost: 850_000, days: 14, reqRep: 30,
    desc: 'Unlocks Rail Seating, which packs a terrace in without losing the safety rating.',
    unlocks: ['seat_rail'] },
  { id: 'velodrome', name: 'Track Cycling Engineering', cost: 1_700_000, days: 22, reqRep: 38, req: ['precast'],
    desc: 'Unlocks Velodrome Boards and the track cycling circuit.', unlocks: ['boards'] },
  { id: 'etfe', name: 'ETFE Cushion Roofs', cost: 3_200_000, days: 28, reqRep: 52, req: ['canopy'],
    desc: 'Unlocks ETFE Cushions: a translucent long-span roof that lets the pitch keep its grass.',
    unlocks: ['roof_etfe'] },
  { id: 'solar', name: 'On-Site Generation', cost: 2_200_000, days: 24, reqRep: 44, req: ['power_grid'],
    desc: 'Unlocks Solar Roof panels and Solar Arrays, which feed power back into the site.',
    unlocks: ['roof_solar', 'solar_panel'] },
  { id: 'pitch_tech', name: 'Pitch Technology', cost: 1_400_000, days: 20, reqRep: 32, req: ['adv_surfaces'],
    desc: 'Undersoil heating, grow lighting and vacuum drainage: a surface that plays in February and recovers under a roof.',
    unlocks: [] },
];

export function researchAvailable(state) {
  return RESEARCH.filter((r) =>
    !state.research.completed.includes(r.id) &&
    state.reputation.venue >= r.reqRep &&
    (!r.req || r.req.every((d) => state.research.completed.includes(d))));
}
