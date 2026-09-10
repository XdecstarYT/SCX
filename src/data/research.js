/**
 * Research unlocks *possibilities*, not stat padding. Every node gates real
 * blocks or real systems.
 */
export const RESEARCH = [
  { id: 'adv_materials', name: 'Advanced Materials', cost: 450_000, days: 12, reqRep: 20,
    desc: 'Unlocks Reinforced Concrete and Glass Roof panels.', unlocks: ['reinforced', 'roof_glass'] },
  { id: 'hospitality', name: 'Premium Hospitality', cost: 900_000, days: 18, reqRep: 30,
    desc: 'Unlocks VIP Seating and Luxury Box blocks.', unlocks: ['seat_vip', 'seat_box'] },
  { id: 'adv_surfaces', name: 'Advanced Sports Surfaces', cost: 700_000, days: 14, reqRep: 26,
    desc: 'Unlocks Synthetic Turf, which needs far less maintenance.', unlocks: ['turf_synth'] },
  { id: 'canopy', name: 'Long-Span Canopies', cost: 1_600_000, days: 24, reqRep: 40, req: ['adv_materials'],
    desc: 'Unlocks Stadium Canopy panels spanning 28m without support.', unlocks: ['roof_stadium'] },
  { id: 'broadcast', name: 'Broadcast Technology', cost: 2_100_000, days: 26, reqRep: 45,
    desc: 'Unlocks Digital Screens and raises broadcast revenue by 12%.', unlocks: ['screen'], broadcastBonus: 0.12 },
  { id: 'ice_tech', name: 'Ice Plant Technology', cost: 1_400_000, days: 20, reqRep: 34,
    desc: 'Unlocks Ice Surface for ice arenas.', unlocks: ['ice'] },
  { id: 'aquatics', name: 'Aquatics Engineering', cost: 1_800_000, days: 22, reqRep: 36,
    desc: 'Unlocks Pool Water for aquatic centres.', unlocks: ['pool'] },
  { id: 'retractable', name: 'Retractable Roof Systems', cost: 6_500_000, days: 40, reqRep: 62, req: ['canopy'],
    desc: 'Unlocks Retractable Roof panels. Weather stops mattering.', unlocks: ['roof_retract'] },
  { id: 'diamond', name: 'Diamond Sports', cost: 950_000, days: 16, reqRep: 28,
    desc: 'Unlocks Baseball Infield and the baseball event circuit.', unlocks: ['infield'] },
  { id: 'esports', name: 'Esports Production', cost: 2_400_000, days: 22, reqRep: 48, req: ['broadcast'],
    desc: 'Unlocks the Esports Stage and championship-tier esports events.', unlocks: ['esports'] },
  { id: 'transport', name: 'Transport Integration', cost: 2_800_000, days: 28, reqRep: 48,
    desc: 'Transit stops carry 60% more spectators.', transitBonus: 0.6 },
  { id: 'power_grid', name: 'Grid Upgrade', cost: 1_200_000, days: 16, reqRep: 22,
    desc: 'Raises site power capacity by 40MW.', powerCapacity: 40 },
  { id: 'security_tech', name: 'Security Screening Tech', cost: 1_500_000, days: 18, reqRep: 40,
    desc: 'Gates process 35% more spectators per hour.', gateBonus: 0.35 },
];

export function researchAvailable(state) {
  return RESEARCH.filter((r) =>
    !state.research.completed.includes(r.id) &&
    state.reputation.venue >= r.reqRep &&
    (!r.req || r.req.every((d) => state.research.completed.includes(d))));
}
