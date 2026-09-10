/**
 * Management situations. Each is a real decision with real consequences -
 * never a pure "click OK to continue".
 */
export const RANDOM_EVENTS = [
  {
    id: 'storm', title: 'Storm Warning', weight: 6, minRep: 0,
    body: 'A severe storm front will reach the complex within 48 hours. Your groundstaff want a decision.',
    options: [
      { label: 'Secure the venue ($250K)', cost: 250_000, effects: { }, result: 'Everything was lashed down. The storm passed without damage.' },
      { label: 'Risk it', risk: 0.5, effects: { cash: -900_000, repVenue: -4 }, result: 'Wind tore panels from the stands. Repairs ran to $900K.', goodResult: 'The storm shifted north. You got away with it.' },
      { label: 'Cancel outdoor activity', effects: { repFans: -3, repCommunity: 2 }, result: 'Nothing was damaged, but fans were disappointed.' },
    ],
  },
  {
    id: 'lighting_fail', title: 'Lighting System Failure', weight: 5, minRep: 8,
    body: 'A floodlight control unit has failed. Evening events cannot go ahead until it is fixed.',
    options: [
      { label: 'Emergency repair ($180K)', cost: 180_000, effects: {}, result: 'Fixed inside a day. No events affected.' },
      { label: 'Standard repair ($60K, 5 days)', cost: 60_000, effects: { repOrganiser: -3 }, result: 'Cheaper, but an organiser had to move a fixture.' },
    ],
  },
  {
    id: 'supplier', title: 'Supplier Price Increase', weight: 5, minRep: 0,
    body: 'Your main materials supplier has raised prices by 18% citing shortages.',
    options: [
      { label: 'Accept the increase', effects: { buildCostMult: 0.12, durationDays: 90 }, result: 'Construction costs are up 12% for the next quarter.' },
      { label: 'Switch supplier ($120K transition)', cost: 120_000, effects: {}, result: 'A new supplier was found at the old rate.' },
      { label: 'Negotiate a volume deal', risk: 0.45, effects: { buildCostMult: 0.2, durationDays: 90 }, goodResult: 'They blinked. Prices held.', result: 'Negotiations failed and you lost your priority slot. Costs up 20%.' },
    ],
  },
  {
    id: 'grant', title: 'Government Infrastructure Grant', weight: 3, minRep: 25,
    body: 'The regional authority is offering a transport infrastructure grant for major venues.',
    options: [
      { label: 'Accept ($1.5M, community expectations)', effects: { cash: 1_500_000, repCommunity: -4, obligation: 'community' }, result: 'The money landed. The community expects public access in return.' },
      { label: 'Accept with community programme ($400K)', cost: 400_000, effects: { cash: 1_500_000, repCommunity: 10 }, result: 'You funded a schools programme alongside it. The community is delighted.' },
      { label: 'Decline', effects: {}, result: 'You kept your independence.' },
    ],
  },
  {
    id: 'protest', title: 'Community Protest', weight: 4, minRep: 20,
    body: 'Residents are protesting about matchday traffic and noise from the complex.',
    options: [
      { label: 'Fund a traffic scheme ($600K)', cost: 600_000, effects: { repCommunity: 12 }, result: 'A residents-only parking scheme calmed things down.' },
      { label: 'Public meeting and concessions', effects: { repCommunity: 4, repVenue: -1 }, result: 'You promised earlier finishes. Some organisers grumbled.' },
      { label: 'Ignore it', effects: { repCommunity: -12 }, result: 'The story ran in the local press for a week.' },
    ],
  },
  {
    id: 'viral', title: 'Viral Social Media Moment', weight: 4, minRep: 12,
    body: 'A clip filmed at your venue has been viewed eleven million times.',
    options: [
      { label: 'Lean into it ($80K campaign)', cost: 80_000, effects: { repFans: 8, repVenue: 4 }, result: 'Ticket enquiries tripled for a fortnight.' },
      { label: 'Let it run its course', effects: { repFans: 3 }, result: 'A pleasant, free bump in profile.' },
    ],
  },
  {
    id: 'sponsor_offer', title: 'Emergency Sponsor Offer', weight: 3, minRep: 18,
    body: 'A brand needs immediate visibility and will pay a premium for a short exclusive.',
    options: [
      { label: 'Accept ($700K, blocks new deals 60 days)', effects: { cash: 700_000, sponsorLock: 60 }, result: 'Cash now, no new sponsor deals for two months.' },
      { label: 'Decline', effects: {}, result: 'You kept the inventory free.' },
    ],
  },
  {
    id: 'strike', title: 'Staff Dispute', weight: 4, minRep: 15,
    body: 'Operations staff are threatening to strike over pay.',
    options: [
      { label: 'Raise pay 10%', effects: { salaryMult: 0.10, morale: 18 }, result: 'Settled. Wage bill up 10%.' },
      { label: 'Hold firm', risk: 0.5, effects: { morale: -22, repVenue: -3 }, goodResult: 'The dispute fizzled out.', result: 'A walkout disrupted two event days.' },
      { label: 'One-off bonus ($200K)', cost: 200_000, effects: { morale: 12 }, result: 'A bonus bought goodwill without a permanent rise.' },
    ],
  },
  {
    id: 'rival_opens', title: 'Rival Venue Expansion', weight: 4, minRep: 24,
    body: 'A competing operator has announced a major expansion of their venue.',
    options: [
      { label: 'Acknowledge', effects: { rivalBoost: true }, result: 'They will be harder to beat on future bids.' },
    ],
  },
  {
    id: 'record_crowd', title: 'Record Attendance Interest', weight: 3, minRep: 30,
    body: 'Demand for your next event is far beyond anything you have seen.',
    options: [
      { label: 'Add temporary seating ($450K)', cost: 450_000, effects: { tempSeats: 4000, durationDays: 30 }, result: '4,000 temporary seats installed for the next 30 days.' },
      { label: 'Keep capacity as is', effects: { repFans: -2 }, result: 'Thousands missed out.' },
    ],
  },
  {
    id: 'celebrity', title: 'Celebrity Appearance', weight: 3, minRep: 22,
    body: 'A well-known figure wants to attend your next event, with an entourage and a hospitality request.',
    options: [
      { label: 'Host them ($120K)', cost: 120_000, effects: { repVenue: 5, repFans: 4 }, result: 'The photographs did more for you than a marketing campaign.' },
      { label: 'Politely decline', effects: {}, result: 'A quiet event day.' },
    ],
  },
  {
    id: 'roof_damage', title: 'Roof Damage Found', weight: 4, minRep: 20,
    body: 'A routine inspection found corrosion in roof fixings above the main stand.',
    options: [
      { label: 'Full replacement ($800K)', cost: 800_000, effects: { repVenue: 2 }, result: 'Certified safe for another decade.' },
      { label: 'Patch repair ($150K)', cost: 150_000, effects: { hazard: true }, result: 'It will hold. Probably.' },
      { label: 'Close the affected section', effects: { capacityPenalty: 0.15, durationDays: 45 }, result: '15% of capacity is closed for 45 days.' },
    ],
  },
];
