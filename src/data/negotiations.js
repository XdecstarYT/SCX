/**
 * Organiser negotiations.
 *
 * Once a bid for a serious event is competitive, the organiser stops treating
 * it as a form and starts asking for things. Every response is a real trade:
 * goodwill costs money, and holding firm costs goodwill.
 *
 *   strength       shift in bid strength (organiser goodwill)
 *   cost           extra cost as a fraction of the event's gross revenue
 *   fee            change to the venue fee the organiser pays you
 *   revenueShare   positive = you keep more of the gate
 *   extraDays      more days the venue is tied up
 *   requires       a venue measure that must be >= 0.4 for the option to work
 */
export const NEGOTIATIONS = [
  {
    id: 'extra_days',
    tiers: ['national', 'international', 'world'],
    speaker: 'Event Director',
    demand: 'We need the venue for two extra days either side for rehearsals and broadcast rigging.',
    options: [
      { key: 'accept', label: 'Agree to the extra days', desc: 'The venue is tied up longer, but they get what they asked for.', strength: 0.10, extraDays: 2 },
      { key: 'charge', label: 'Agree, but raise the venue fee 20%', desc: 'Reasonable, and they may still take it.', strength: -0.02, extraDays: 2, fee: 0.2 },
      { key: 'one', label: 'Offer one day only', desc: 'A compromise that costs you less.', strength: 0.02, extraDays: 1 },
      { key: 'refuse', label: 'Refuse - the calendar is full', desc: 'Protects your schedule at the cost of goodwill.', strength: -0.09 },
    ],
  },
  {
    id: 'hospitality',
    tiers: ['national', 'international', 'world'],
    speaker: 'Commercial Director',
    demand: 'Our partners expect exclusive access to every hospitality suite on the day.',
    options: [
      { key: 'accept', label: 'Grant exclusive access', desc: 'You lose your own hospitality income for the event.', strength: 0.12, cost: 0.05, requires: 'hospitality' },
      { key: 'split', label: 'Offer half the suites', desc: 'You keep some inventory to sell.', strength: 0.04, cost: 0.02 },
      { key: 'upsell', label: 'Offer exclusivity for a fee', desc: 'They pay for the privilege.', strength: -0.04, fee: 0.15 },
      { key: 'refuse', label: 'Keep your hospitality', desc: 'Your suites, your customers.', strength: -0.10 },
    ],
  },
  {
    id: 'branding',
    tiers: ['regional', 'national', 'international', 'world'],
    speaker: 'Brand Manager',
    demand: 'All existing venue sponsorship must be covered for the duration of the event.',
    options: [
      { key: 'accept', label: 'Cover all sponsor signage', desc: 'Your sponsors will not be pleased.', strength: 0.11, cost: 0.04 },
      { key: 'partial', label: 'Cover pitch-side boards only', desc: 'A common compromise.', strength: 0.04, cost: 0.015 },
      { key: 'refuse', label: 'Your sponsors stay visible', desc: 'Protects your commercial deals.', strength: -0.12 },
    ],
  },
  {
    id: 'tickets',
    tiers: ['national', 'international', 'world'],
    speaker: 'Ticketing Lead',
    demand: 'We want a 30% allocation of seats at face value for our member associations.',
    options: [
      { key: 'accept', label: 'Grant the full allocation', desc: 'A large slice of the gate at cost.', strength: 0.13, cost: 0.08 },
      { key: 'fifteen', label: 'Offer 15%', desc: 'Half of what they asked for.', strength: 0.05, cost: 0.04 },
      { key: 'trade', label: 'Trade it for a bigger revenue share', desc: 'They get seats, you get a better split.', strength: -0.03, cost: 0.06, revenueShare: 0.09 },
      { key: 'refuse', label: 'No allocation', desc: 'Every seat stays yours to sell.', strength: -0.11 },
    ],
  },
  {
    id: 'broadcast',
    tiers: ['national', 'international', 'world'],
    speaker: 'Broadcast Producer',
    demand: 'Our host broadcaster needs the full compound, a camera platform and unrestricted access.',
    options: [
      { key: 'accept', label: 'Build the platform and give access', desc: 'A real construction cost, but it stays yours afterwards.', strength: 0.14, cost: 0.04, requires: 'broadcast' },
      { key: 'existing', label: 'Offer what you already have', desc: 'Works only if your broadcast centre is up to standard.', strength: 0.03, requires: 'broadcast' },
      { key: 'charge', label: 'Build it, but they pay for it', desc: 'Fair, and slightly abrasive.', strength: -0.05, fee: 0.18 },
    ],
  },
  {
    id: 'pitch',
    tiers: ['national', 'international', 'world'],
    speaker: 'Technical Delegate',
    demand: 'The playing surface must be relaid to championship specification before we arrive.',
    options: [
      { key: 'accept', label: 'Relay the surface', desc: 'Expensive, and it raises your venue standard permanently.', strength: 0.12, cost: 0.06, athleteBonus: 3 },
      { key: 'inspect', label: 'Invite them to inspect it first', desc: 'Risky if your surface is not up to it.', strength: 0.04, requires: 'field' },
      { key: 'refuse', label: 'The surface is already regulation', desc: 'Stands on your own assessment.', strength: -0.08 },
    ],
  },
  {
    id: 'security',
    tiers: ['international', 'world'],
    speaker: 'Head of Safety',
    demand: 'We require accredited screening on every gate and a dedicated control room.',
    options: [
      { key: 'accept', label: 'Meet the standard in full', desc: 'A serious operation, and a safer event.', strength: 0.15, cost: 0.05, requires: 'security' },
      { key: 'partial', label: 'Screening on main gates only', desc: 'Cheaper, and a visible gap.', strength: 0.02, cost: 0.02, risk: 0.12 },
      { key: 'refuse', label: 'Your existing arrangements stand', desc: 'They will not like this.', strength: -0.16 },
    ],
  },
  {
    id: 'multiyear',
    tiers: ['regional', 'national', 'international'],
    speaker: 'Event Director',
    demand: 'We would consider making this a fixture here for three years running.',
    options: [
      { key: 'accept', label: 'Commit to three years at a 6% discount', desc: 'Guaranteed future events, at a lower fee.', strength: 0.13, fee: -0.06, multiYear: 3 },
      { key: 'two', label: 'Two years at full rate', desc: 'A shorter commitment, no discount.', strength: 0.06, multiYear: 2 },
      { key: 'decline', label: 'One year for now', desc: 'Keeps your calendar free.', strength: -0.02 },
    ],
  },
  {
    id: 'transport',
    tiers: ['national', 'international', 'world'],
    speaker: 'Operations Manager',
    demand: 'Teams, officials and media all need dedicated transport and parking separated from the public.',
    options: [
      { key: 'accept', label: 'Provide dedicated transport', desc: 'Shuttles, secure parking, the lot.', strength: 0.10, cost: 0.04 },
      { key: 'parking', label: 'Reserve parking only', desc: 'Works if you have the capacity.', strength: 0.04, requires: 'parking' },
      { key: 'refuse', label: 'They can use the public facilities', desc: 'Cheap, and it reads as amateur.', strength: -0.13, communityBonus: 2 },
    ],
  },
  {
    id: 'community',
    tiers: ['regional', 'national', 'international', 'world'],
    speaker: 'Community Liaison',
    demand: 'The local authority wants a community programme attached to the event.',
    options: [
      { key: 'accept', label: 'Fund a schools and clubs programme', desc: 'Costs money, buys real local goodwill.', strength: 0.06, cost: 0.03, communityBonus: 10 },
      { key: 'tickets', label: 'Donate a block of tickets', desc: 'Cheaper, and still welcome.', strength: 0.03, cost: 0.012, communityBonus: 5 },
      { key: 'refuse', label: 'Decline', desc: 'The council will remember.', strength: -0.04, communityBonus: -6 },
    ],
  },
];

/** Which negotiations an event can raise, in a stable order. */
export function negotiationsFor(tier) {
  return NEGOTIATIONS.filter((n) => n.tiers.includes(tier));
}

/** How many rounds an event of this tier opens with. */
export const ROUNDS_BY_TIER = {
  local: 0, regional: 1, national: 2, international: 3, world: 3,
};
