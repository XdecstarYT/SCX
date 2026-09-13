/**
 * Programmes: what the complex does between events.
 *
 * The other half of the same complaint matchday answered. Event days were a
 * number that arrived; the weeks between them were a clock you skipped. You
 * could build, and you could wait, and that was the whole of it - a stadium
 * manager's actual job, the running of the place, was not in the game.
 *
 * A programme is a piece of that job. It takes weeks, it costs money every one
 * of them, it occupies one of a small number of slots, and it leaves something
 * behind: a permanent lift to a rating the analyser reads, a standing discount,
 * a department that decides better on event day, a stream of income that did
 * not exist before.
 *
 * They are deliberately not upgrades you buy. Each one competes for the same
 * scarce slots and the same weeks, so running the safety overhaul is a decision
 * not to run the season-ticket drive, and a complex that tries everything
 * finishes nothing.
 *
 *   days       how long it runs
 *   cost       up front
 *   upkeep     per day while it runs
 *   req        what the complex must already be, to start it
 *   effect     what it leaves behind, applied for good when it completes
 *   repeat     how many times it can ever be run (default 1)
 *   category   for the screen
 *
 * An effect may set:
 *   measure     {key: +delta} a permanent lift to a venue measure
 *   rating      {key: +delta} a permanent lift to a rating
 *   staff       {channel: +delta} a standing bonus to a department
 *   income      money per day, for good
 *   costMult    a standing multiplier on running costs
 *   buildMult   a standing multiplier on construction cost
 *   gate        a standing multiplier on gate throughput
 *   spend       a standing multiplier on concession and merchandise
 *   rep         one-off reputation
 *   unlock      a flag other systems can read
 */

export const PROGRAMME_CATEGORIES = [
  { key: 'safety', name: 'Safety & Compliance' },
  { key: 'commercial', name: 'Commercial' },
  { key: 'community', name: 'Community' },
  { key: 'sporting', name: 'Sporting' },
  { key: 'people', name: 'People' },
  { key: 'estate', name: 'Estate' },
];

const req = {
  cap: (n) => ({ key: 'capacity', min: n, label: `Capacity ${n.toLocaleString()}+` }),
  rating: (n) => ({ key: 'rating', min: n, label: `Venue rating ${n}+` }),
  rep: (n) => ({ key: 'reputation', min: n, label: `Venue reputation ${n}+` }),
  events: (n) => ({ key: 'events', min: n, label: `${n} events hosted` }),
  measure: (m, v, label) => ({ key: 'measure', measure: m, min: v, label }),
  tenant: () => ({ key: 'tenant', min: 1, label: 'A resident club' }),
};

export const PROGRAMMES = [
  // -------------------------------------------------------------- safety
  {
    id: 'safety_overhaul', name: 'Safety Certificate Review', category: 'safety',
    days: 40, cost: 180_000, upkeep: 900,
    desc: 'A full re-inspection with the safety officer, and the work it throws up.',
    detail: 'Nobody enjoys this and everybody is glad of it afterwards. The certificate '
      + 'is the difference between a full house and a closed upper tier.',
    req: [req.events(4)],
    effect: { rating: { safety: 6 }, measure: { exit: 0.08 }, staff: { security: 0.04 } },
  },
  {
    id: 'steward_training', name: 'Steward Accreditation', category: 'safety',
    days: 30, cost: 96_000, upkeep: 700,
    desc: 'Put every steward through the national accreditation, and pay them for the time.',
    detail: 'The difference between a steward who knows the plan and one who is wearing '
      + 'the jacket shows up exactly once, on the day it matters.',
    req: [req.events(2)],
    effect: { staff: { security: 0.09 }, rating: { safety: 3 } },
    repeat: 2,
  },
  {
    id: 'gate_modernisation', name: 'Gate Modernisation', category: 'safety',
    days: 50, cost: 420_000, upkeep: 1_400,
    desc: 'Replace the turnstiles, add scanners, and re-time the whole entry plan.',
    detail: 'Most grounds are not short of gates. They are short of gates that work.',
    req: [req.cap(8_000), req.measure('entrance', 0.3, 'Entrance gates')],
    effect: { gate: 1.25, rating: { crowdFlow: 5 }, measure: { entrance: 0.06 } },
  },
  {
    id: 'medical_partnership', name: 'Hospital Partnership', category: 'safety',
    days: 34, cost: 140_000, upkeep: 1_100,
    desc: 'A standing arrangement with the local trust: staff on site, a route kept clear.',
    detail: 'It is cheaper than the alternative and the alternative is a headline.',
    req: [req.measure('medical', 0.3, 'Medical facilities')],
    effect: { measure: { medical: 0.12 }, staff: { operations: 0.04 }, rep: { community: 6 } },
  },
  {
    id: 'crowd_modelling', name: 'Crowd Flow Study', category: 'safety',
    days: 28, cost: 210_000, upkeep: 800,
    desc: 'Consultants with cameras and a model of every stairwell you own.',
    detail: 'They will tell you three things you knew and one you did not, and the one '
      + 'you did not is why you paid them.',
    req: [req.cap(15_000)],
    effect: { rating: { crowdFlow: 7 }, staff: { security: 0.05 } },
  },

  // ---------------------------------------------------------- commercial
  {
    id: 'season_tickets', name: 'Season Ticket Drive', category: 'commercial',
    days: 45, cost: 130_000, upkeep: 1_600,
    desc: 'Sell the whole year up front, at a discount, to people who would have come anyway.',
    detail: 'Money now instead of money later, and a base of support that turns up in '
      + 'the rain. The discount is real and so is the certainty.',
    req: [req.tenant()],
    effect: { income: 5_200, measure: { seating: 0.02 }, rep: { fans: 5 } },
    repeat: 3,
  },
  {
    id: 'catering_retender', name: 'Catering Re-tender', category: 'commercial',
    days: 36, cost: 85_000, upkeep: 600,
    desc: 'Put the concession contract out to the market and take the better half of it.',
    detail: 'The incumbent will improve their offer the week you announce it, which is '
      + 'the first thing the exercise tells you about the incumbent.',
    req: [req.measure('concession', 0.25, 'Concessions')],
    effect: { spend: 1.14, income: 1_400 },
    repeat: 2,
  },
  {
    id: 'hospitality_refit', name: 'Hospitality Refit', category: 'commercial',
    days: 55, cost: 620_000, upkeep: 2_400,
    desc: 'Strip the lounges back and rebuild them as somewhere people want to be.',
    detail: 'Hospitality is the only part of a stadium where the customer is comparing '
      + 'you with a restaurant rather than with another stadium.',
    req: [req.measure('hospitality', 0.2, 'Hospitality'), req.rating(52)],
    effect: { measure: { hospitality: 0.16 }, staff: { hospitality: 0.08 }, income: 3_100 },
  },
  {
    id: 'merch_line', name: 'Own-Brand Merchandise', category: 'commercial',
    days: 40, cost: 190_000, upkeep: 1_100,
    desc: 'Design, produce and stock a range with the complex’s own name on it.',
    detail: 'Margins on your own line are roughly double the concession deal, and every '
      + 'shirt sold is somebody advertising you for a year.',
    req: [req.measure('retail', 0.2, 'Retail'), req.rep(38)],
    effect: { spend: 1.1, income: 2_600, rep: { venue: 3 } },
  },
  {
    id: 'naming_campaign', name: 'Naming Rights Campaign', category: 'commercial',
    days: 60, cost: 260_000, upkeep: 1_800,
    desc: 'A serious approach to the sponsors who could put their name on the roof.',
    detail: 'Nobody buys naming rights from a venue that has not asked properly.',
    req: [req.cap(20_000), req.rep(48)],
    effect: { staff: { marketing: 0.09 }, income: 4_400, rep: { organiser: 4 } },
  },
  {
    id: 'dynamic_pricing', name: 'Dynamic Pricing Rollout', category: 'commercial',
    days: 32, cost: 150_000, upkeep: 900,
    desc: 'Price every seat for the match it is sold for, rather than for the season.',
    detail: 'It fills the difficult fixtures and charges properly for the good ones. '
      + 'Supporters notice the second part.',
    req: [req.events(10)],
    effect: { income: 3_400, staff: { marketing: 0.06 }, rep: { fans: -3 } },
  },

  // ----------------------------------------------------------- community
  {
    id: 'school_programme', name: 'Schools Programme', category: 'community',
    days: 50, cost: 70_000, upkeep: 1_200,
    desc: 'Coaching, tours and free tickets across every school in the district.',
    detail: 'The slowest return in the game and the one that compounds: these are the '
      + 'people who will still be coming in twenty years.',
    req: [],
    effect: { rep: { community: 14, fans: 4 }, income: 400 },
    repeat: 3,
  },
  {
    id: 'transport_pact', name: 'Transport Agreement', category: 'community',
    days: 42, cost: 240_000, upkeep: 1_500,
    desc: 'A formal deal with the operators: extra services, and a ticket that covers both.',
    detail: 'Every supporter on a train is a car not parked across somebody’s drive.',
    req: [req.cap(12_000)],
    effect: { measure: { parking: 0.1 }, rep: { community: 10 }, staff: { operations: 0.05 } },
  },
  {
    id: 'noise_mitigation', name: 'Noise & Light Mitigation', category: 'community',
    days: 38, cost: 300_000, upkeep: 1_000,
    desc: 'Baffles, shielded floodlights and a curfew you actually keep to.',
    detail: 'The complaints do not come from the people at the match. They come from the '
      + 'people who can hear it.',
    req: [req.cap(10_000)],
    effect: { rep: { community: 12 }, rating: { appearance: 3 } },
  },
  {
    id: 'open_access', name: 'Community Use Agreement', category: 'community',
    days: 60, cost: 110_000, upkeep: 2_200,
    desc: 'The facilities open to local clubs on the days nothing else is happening.',
    detail: 'It wears the pitch and it buys you something no amount of money does, which '
      + 'is the council on your side at the planning meeting.',
    req: [req.measure('training', 0.15, 'Training facilities')],
    effect: { rep: { community: 16 }, income: 1_900, unlock: 'community_use' },
  },

  // ------------------------------------------------------------ sporting
  {
    id: 'pitch_relay', name: 'Full Pitch Relay', category: 'sporting',
    days: 45, cost: 480_000, upkeep: 1_800,
    desc: 'Lift the surface, rebuild the drainage beneath it, and lay it again.',
    detail: 'The only real answer to a pitch that has stopped draining. Everything else '
      + 'is forking it at half-time and hoping.',
    req: [req.events(6)],
    effect: { measure: { field: 0.05 }, rating: { safety: 2 }, rep: { athletes: 8 }, unlock: 'relaid' },
    repeat: 4,
  },
  {
    id: 'academy', name: 'Academy Partnership', category: 'sporting',
    days: 70, cost: 340_000, upkeep: 2_800,
    desc: 'Host a club’s youth setup: pitches, classrooms and a physio room.',
    detail: 'It fills the training facilities on a Tuesday and it makes the club very '
      + 'difficult to prise away from you.',
    req: [req.tenant(), req.measure('training', 0.2, 'Training facilities')],
    effect: { staff: { sports: 0.12 }, rep: { athletes: 10, community: 6 }, income: 2_200 },
  },
  {
    id: 'sports_science', name: 'Sports Science Suite', category: 'sporting',
    days: 48, cost: 410_000, upkeep: 2_100,
    desc: 'Testing, recovery and analysis, built into the back of the changing rooms.',
    detail: 'Athletes choose venues for this more than anybody outside the sport believes.',
    req: [req.measure('locker', 0.3, 'Changing rooms'), req.rep(44)],
    effect: { measure: { locker: 0.12, medical: 0.06 }, staff: { sports: 0.1 }, rep: { athletes: 12 } },
  },

  // -------------------------------------------------------------- people
  {
    id: 'ops_training', name: 'Operations Training Block', category: 'people',
    days: 30, cost: 88_000, upkeep: 900,
    desc: 'Take the whole operations team off the floor for a month and teach them the job.',
    detail: 'Expensive in the month it runs and invisible afterwards, which is why nobody '
      + 'does it until something has gone wrong.',
    req: [],
    effect: { staff: { operations: 0.09 } },
    repeat: 3,
  },
  {
    id: 'retention', name: 'Retention Review', category: 'people',
    days: 36, cost: 160_000, upkeep: 1_300,
    desc: 'Pay review, shift patterns, and somewhere decent for staff to sit down.',
    detail: 'The people who run your event days have been doing it for a wage that has '
      + 'not moved since you opened.',
    req: [req.events(8)],
    effect: { staff: { management: 0.07, operations: 0.05 }, costMult: 0.97 },
    repeat: 2,
  },
  {
    id: 'graduate_scheme', name: 'Graduate Scheme', category: 'people',
    days: 65, cost: 120_000, upkeep: 2_000,
    desc: 'Take on six graduates across every department and actually train them.',
    detail: 'Two will be gone in a year, one will run the place in ten.',
    req: [req.rep(40)],
    effect: { staff: { management: 0.05, events: 0.05, marketing: 0.05, finance: 0.05 } },
  },
  {
    id: 'procurement', name: 'Procurement Review', category: 'people',
    days: 34, cost: 130_000, upkeep: 700,
    desc: 'Go through every supplier contract the complex has, line by line.',
    detail: 'Deeply tedious, reliably profitable, and nobody will thank you for it.',
    req: [req.events(6)],
    effect: { costMult: 0.94, staff: { finance: 0.08 } },
    repeat: 2,
  },

  // -------------------------------------------------------------- estate
  {
    id: 'energy_retrofit', name: 'Energy Retrofit', category: 'estate',
    days: 55, cost: 520_000, upkeep: 1_600,
    desc: 'LED everything, insulate the enclosed spaces, and meter every circuit.',
    detail: 'A stadium is mostly empty and mostly lit. Fixing that is the largest saving '
      + 'available anywhere on the site.',
    req: [req.cap(8_000)],
    effect: { costMult: 0.92, rating: { appearance: 2 }, rep: { community: 5 } },
  },
  {
    id: 'accessibility', name: 'Accessibility Programme', category: 'estate',
    days: 44, cost: 380_000, upkeep: 1_200,
    desc: 'Platforms, lifts, sightlines and a properly staffed assistance scheme.',
    detail: 'The law says the minimum. The minimum is not what this is about.',
    req: [req.cap(6_000)],
    effect: { rating: { accessibility: 9 }, measure: { entrance: 0.05, restroom: 0.05 },
      rep: { community: 9, fans: 6 } },
  },
  {
    id: 'maintenance_backlog', name: 'Clear the Maintenance Backlog', category: 'estate',
    days: 40, cost: 290_000, upkeep: 2_600,
    desc: 'Every deferred repair on the list, done, in one block.',
    detail: 'The list only ever gets longer. At some point you stop adding to it and '
      + 'spend a month at the other end.',
    req: [req.events(5)],
    effect: { costMult: 0.95, rating: { safety: 4, appearance: 4 } },
    repeat: 4,
  },
  {
    id: 'digital_infra', name: 'Connected Venue Rollout', category: 'estate',
    days: 50, cost: 450_000, upkeep: 2_000,
    desc: 'Wi-fi that works in a full ground, and the ticketing and payments to use it.',
    detail: 'Forty thousand phones in one building is a harder networking problem than '
      + 'most data centres, and the crowd judges you on it.',
    req: [req.cap(14_000), req.rep(42)],
    effect: { measure: { broadcast: 0.06, media: 0.06 }, spend: 1.08, staff: { events: 0.06 } },
  },
  {
    id: 'groundskeeping', name: 'Groundskeeping Investment', category: 'estate',
    days: 32, cost: 170_000, upkeep: 1_400,
    desc: 'Machinery, lighting rigs and two more people who know what they are doing.',
    detail: 'The surface is the product. Everything else is the room it is in.',
    req: [],
    effect: { staff: { operations: 0.07 }, measure: { field: 0.03 }, rep: { athletes: 5 } },
    repeat: 2,
  },
];

export const PROGRAMME_BY_ID = new Map(PROGRAMMES.map((p) => [p.id, p]));

/**
 * How many programmes can run at once. A small complex can hold one thing in
 * its head; a large one with a general manager can hold four. This is the
 * scarcity the whole system turns on - without it every programme is simply
 * bought and the ordering stops being a decision.
 */
export function programmeSlots(state) {
  const rep = state.reputation?.venue ?? 0;
  const gm = (state.staffBonus?.management ?? 0) > 0.05 ? 1 : 0;
  return Math.max(1, Math.min(4, 1 + Math.floor(rep / 34) + gm));
}
