/**
 * The calls: what you actually decide on an event day.
 *
 * Everything else in this game happens between events. You build, you bid, you
 * hire, you wait - and then the biggest moment, the one the whole complex
 * exists for, resolved itself in a single function call and handed back a
 * number. The day the ground was built for was the one day you could not touch.
 *
 * A call is one decision on that day. It arrives in a phase, it is drawn
 * because of something true about your venue right now, and every option is a
 * trade: stewards cost money, a price cut fills the ground and empties the
 * till, opening the roof saves the crowd and annoys the broadcaster.
 *
 * The deck is deliberately larger than any one day can show. Which calls come
 * up is decided by the venue's own risk profile and the state of the day, so
 * two events at the same ground are not the same afternoon.
 *
 *   phase     which part of the day it lands in
 *   need      a risk key that must be live for it to be drawn
 *   when      (ctx) => boolean, read against the live day
 *   weight    relative likelihood once eligible
 *   dept      which staff channel decides it well when nobody is watching
 *   options   what you can do. `effect` accumulates into the day's ops.
 *
 * An option's effect may set:
 *   guard    {riskKey: 0..0.85} how far it damps that failure
 *   gate     gate throughput multiplier
 *   fill     how many more (or fewer) people come
 *   price    ticket yield multiplier
 *   spend    concession and merchandise multiplier
 *   sat      satisfaction points
 *   cost     money spent on the day
 *   revenue  money taken on the day
 *   rep      {venue, fans, community, organiser, athletes}
 *   risk     {key, chance, text, satisfaction, ...} a new failure this invites
 */

export const PHASES = [
  { key: 'buildup', name: 'Build-up', desc: 'Four hours out. Nothing has gone wrong yet.' },
  { key: 'gates', name: 'Gates Open', desc: 'The queue is forming and the first decisions are about flow.' },
  { key: 'kickoff', name: 'Kick-off', desc: 'The ground is as full as it is going to get.' },
  { key: 'interval', name: 'Interval', desc: 'Fifteen minutes to fix whatever the first half exposed.' },
  { key: 'second', name: 'Second Half', desc: 'Whatever happens now, happens in front of everybody.' },
  { key: 'egress', name: 'Egress', desc: 'Getting forty thousand people out is its own event.' },
];

export const PHASE_KEYS = PHASES.map((p) => p.key);

/** Shorthand so the deck below reads as decisions rather than as objects. */
const opt = (label, desc, effect) => ({ label, desc, effect });

export const MATCHDAY_CALLS = [
  // ============================================================== build-up
  {
    id: 'briefing', phase: 'buildup', weight: 10, dept: 'events',
    title: 'The staff briefing',
    text: 'Everyone is in the room. You get one message and they will remember about half of it.',
    options: [
      opt('Flow and gates', 'Everything is about getting people in.',
        { guard: { congestion: 0.35 }, gate: 1.1 }),
      opt('Safety and stewarding', 'Nothing goes wrong on my watch.',
        { guard: { security: 0.4, structure: 0.2 }, sat: 1 }),
      opt('Sell, sell, sell', 'Every kiosk open, every upsell taken.',
        { spend: 1.14, sat: -2 }),
      opt('Keep it short', 'They know their jobs. Let them do them.',
        { cost: -2_000, sat: 1 }),
    ],
  },
  {
    id: 'pitch_check', phase: 'buildup', weight: 8, dept: 'operations',
    when: (c) => !c.indoor,
    title: 'The pitch inspection',
    text: 'The referee walks the surface with the groundstaff. It is passable. Barely.',
    options: [
      opt('Pass it and play', 'It will cut up, but it will hold.',
        { risk: { key: 'surface', chance: 0.3, text: 'The surface broke up badly and the players said so afterwards.', satisfaction: -8, reputation: -3, dept: 'operations' } }),
      opt('Work on it now', 'Sand, roll and reseed the worst of it before anyone arrives.',
        { cost: 14_000, sat: 3, rep: { athletes: 2 } }),
      opt('Move the kick-off back an hour', 'Buy the groundstaff time. Annoy everybody else.',
        { sat: -5, rep: { organiser: -2 }, guard: { congestion: 0.25 } }),
    ],
  },
  {
    id: 'weather_call', phase: 'buildup', weight: 12, dept: 'operations',
    when: (c) => c.wet && !c.indoor,
    title: 'The forecast has changed',
    text: 'It is going to come down hard from about an hour in.',
    options: [
      opt('Close the roof', 'If you have one, this is what it was for.',
        { need: 'roof', sat: 10, guard: { restroom: 0.2 }, rep: { fans: 2 } }),
      opt('Cover what you can', 'Tarpaulins on the uncovered blocks, ponchos at the gates.',
        { cost: 9_000, sat: 4 }),
      opt('Say nothing and hope', 'The forecast has been wrong before.',
        { risk: { key: 'washout', chance: 0.45, text: 'The rain arrived as promised and the uncovered stands emptied by half-time.', satisfaction: -14, reputation: -2, dept: 'operations' } }),
    ],
  },
  {
    id: 'heat_call', phase: 'buildup', weight: 12, dept: 'operations',
    when: (c) => c.hot,
    title: 'It is thirty-eight degrees',
    text: 'The medical lead wants to talk to you before anybody comes through a turnstile.',
    options: [
      opt('Free water everywhere', 'Every tap open, bottles at every gate.',
        { cost: 11_000, sat: 6, guard: { medical: 0.5 }, rep: { community: 2 } }),
      opt('Shade and cooling breaks', 'Open the concourses, agree breaks with the officials.',
        { cost: 4_000, sat: 3, rep: { athletes: 2 } }),
      opt('Sell them the water', 'It is a hot day and people will pay.',
        { spend: 1.22, sat: -8, rep: { community: -4, fans: -3 } }),
    ],
  },
  {
    id: 'overtime', phase: 'buildup', weight: 9, dept: 'finance',
    title: 'The overtime sheet',
    text: 'Your operations lead wants forty more staff on shift than the budget allows.',
    options: [
      opt('Approve all of it', 'Better over-staffed than explaining why not.',
        { cost: 26_000, guard: { congestion: 0.3, restroom: 0.35, security: 0.2 }, sat: 3 }),
      opt('Approve half', 'Cover the gates and the restrooms, nothing else.',
        { cost: 13_000, guard: { congestion: 0.2, restroom: 0.2 } }),
      opt('Refuse it', 'The rota was signed off for a reason.',
        { cost: -4_000, sat: -3, risk: { key: 'understaffed', chance: 0.35, text: 'Too few staff on shift. Queues everywhere and nobody to ask.', satisfaction: -11, dept: 'operations' } }),
    ],
  },
  {
    id: 'vip_arrivals', phase: 'buildup', weight: 7, dept: 'hospitality',
    when: (c) => c.tierRank >= 2,
    title: 'The guest list has grown',
    text: 'The organiser has added thirty names to hospitality since yesterday.',
    options: [
      opt('Find the room', 'Open the second lounge and staff it.',
        { cost: 8_000, revenue: 22_000, rep: { organiser: 3 } }),
      opt('Squeeze them in', 'It will be tight and they will notice.',
        { revenue: 14_000, sat: -2, rep: { organiser: -1 } }),
      opt('Tell them no', 'The contract says what the contract says.',
        { rep: { organiser: -4 }, sat: 1 }),
    ],
  },
  {
    id: 'broadcast_check', phase: 'buildup', weight: 8, dept: 'events',
    need: 'data',
    title: 'The broadcaster is unhappy',
    text: 'They have been testing the feed all morning and it keeps dropping.',
    options: [
      opt('Give them the whole network', 'Throttle everything else on site to get them clean.',
        { guard: { data: 0.7 }, sat: -4, rep: { organiser: 3 } }),
      opt('Bring in a satellite truck', 'Expensive, and it will work.',
        { cost: 34_000, guard: { data: 0.85 }, rep: { organiser: 2 } }),
      opt('It is their problem', 'The contract covers the room, not the signal.',
        { rep: { organiser: -5 } }),
    ],
  },
  {
    id: 'transport_plan', phase: 'buildup', weight: 8, dept: 'operations',
    need: 'parking',
    title: 'Parking is going to overflow',
    text: 'On these numbers you are two thousand spaces short by an hour before kick-off.',
    options: [
      opt('Lay on shuttle buses', 'Park them out of town and bus them in.',
        { cost: 18_000, guard: { parking: 0.6 }, rep: { community: 3 } }),
      opt('Open the overflow field', 'It will be a mudbath but it is legal.',
        { cost: 5_000, guard: { parking: 0.35 }, sat: -2 }),
      opt('Let them find their own way', 'The residents will complain either way.',
        { rep: { community: -5 } }),
    ],
  },

  // ================================================================= gates
  {
    id: 'queue_building', phase: 'gates', weight: 14, dept: 'security',
    need: 'congestion',
    title: 'The queue is not moving',
    text: 'Twenty minutes to kick-off and the north approach is backed up to the road.',
    options: [
      opt('Open the reserve gates', 'Every turnstile you have, staffed or not.',
        { gate: 1.45, guard: { congestion: 0.65 }, cost: 6_000 }),
      opt('Relax the searches', 'Faster in, and you will think about this later.',
        { gate: 1.3, guard: { congestion: 0.5 }, risk: { key: 'search', chance: 0.3, text: 'Relaxed searching let something in that should not have been.', satisfaction: -10, reputation: -4, cost: 60_000, dept: 'security' } }),
      opt('Hold the line', 'They will get in. They will be late, but they will get in.',
        { sat: -6 }),
    ],
  },
  {
    id: 'gate_fault', phase: 'gates', weight: 9, dept: 'operations',
    title: 'A turnstile bank has failed',
    text: 'Six gates on the east side are reading every ticket as invalid.',
    options: [
      opt('Manual entry', 'Staff on the door with a list and a torch.',
        { cost: 3_000, gate: 0.94, guard: { congestion: 0.2 } }),
      opt('Divert to the west', 'Send them round. It is a long walk.',
        { sat: -5, gate: 0.85 }),
      opt('Open the gates and count later', 'Nobody pays, everybody gets in.',
        { gate: 1.2, price: 0.94, sat: 4 }),
    ],
  },
  {
    id: 'ticketless', phase: 'gates', weight: 8, dept: 'security',
    when: (c) => c.fill > 0.9,
    title: 'People without tickets',
    text: 'A few hundred have turned up hoping. The ground is nearly full.',
    options: [
      opt('Sell them standing room', 'There is space on the terrace if you are honest about it.',
        { revenue: 28_000, sat: -2, risk: { key: 'overcrowd', chance: 0.28, text: 'A section went over its safe limit and had to be held back.', satisfaction: -14, reputation: -5, dept: 'security' } }),
      opt('Turn them away politely', 'Staff on the approach, signs up, no argument.',
        { cost: 2_000, rep: { fans: -1 } }),
      opt('Let them into the fan zone', 'No seat, but a screen and a beer.',
        { need: 'fanzone', revenue: 12_000, sat: 3, rep: { community: 2, fans: 2 } }),
    ],
  },
  {
    id: 'away_arrival', phase: 'gates', weight: 8, dept: 'security',
    when: (c) => c.risky,
    title: 'The away coaches are early',
    text: 'Three thousand of them, an hour ahead of schedule, and nowhere to put them.',
    options: [
      opt('Open their end now', 'Get them inside and contained.',
        { cost: 4_000, guard: { security: 0.45 } }),
      opt('Hold them in the coach park', 'Segregated, supervised, and furious.',
        { sat: -3, guard: { security: 0.25 }, rep: { fans: -1 } }),
      opt('Let them walk in with everybody else', 'It is a sporting event, not a siege.',
        { risk: { key: 'disorder', chance: 0.4, text: 'Rival supporters mixed on the concourse and it turned.', satisfaction: -16, reputation: -5, cost: 70_000, dept: 'security' } }),
    ],
  },
  {
    id: 'late_release', phase: 'gates', weight: 7, dept: 'marketing',
    when: (c) => c.fill < 0.78,
    title: 'There are empty seats',
    text: 'It is not going to sell out. The cameras will see the gaps.',
    options: [
      opt('Release cheap tickets now', 'Half price for the next hour.',
        { fill: 1.16, price: 0.86, sat: 2 }),
      opt('Give them to local schools', 'Free, and they will remember it.',
        { fill: 1.1, price: 0.93, cost: 2_000, rep: { community: 5, fans: 2 } }),
      opt('Move everyone to one side', 'Close the far stand and fill the camera side.',
        { cost: 3_000, sat: 2, rep: { organiser: 2 } }),
      opt('Leave it', 'The gaps are the gaps.',
        { rep: { organiser: -2 } }),
    ],
  },
  {
    id: 'accreditation', phase: 'gates', weight: 6, dept: 'events',
    when: (c) => c.tierRank >= 2,
    title: 'The media gate is a mess',
    text: 'Forty photographers, thirty passes, and a deadline.',
    options: [
      opt('Print more passes', 'Sort it out and apologise.',
        { cost: 2_500, rep: { organiser: 2 } }),
      opt('First thirty in', 'The list is the list.',
        { rep: { organiser: -2, venue: -1 } }),
      opt('Let them all in', 'Nobody is checking pitchside anyway.',
        { risk: { key: 'pitchside', chance: 0.3, text: 'Too many people pitchside; the officials complained formally.', satisfaction: -4, reputation: -3, dept: 'events' } }),
    ],
  },

  // =============================================================== kick-off
  {
    id: 'anthem', phase: 'kickoff', weight: 8, dept: 'events',
    when: (c) => c.tierRank >= 2,
    title: 'The pre-match',
    text: 'You have four minutes of everybody in the ground looking at the same thing.',
    options: [
      opt('A proper show', 'Pyro, the screens, the lot.',
        { cost: 22_000, sat: 8, rep: { fans: 3, organiser: 2 },
          risk: { key: 'pyro', chance: 0.12, text: 'The pyrotechnics set off a smoke alarm and a stand was briefly evacuated.', satisfaction: -12, reputation: -3, cost: 40_000, dept: 'security' } }),
      opt('Local schoolchildren', 'Cheap, charming, and the neighbours love it.',
        { cost: 2_000, sat: 4, rep: { community: 5 } }),
      opt('Straight to the whistle', 'Nobody came for a ceremony.',
        { sat: 1 }),
    ],
  },
  {
    id: 'full_house', phase: 'kickoff', weight: 7, dept: 'events',
    when: (c) => c.fill > 0.96,
    title: 'It is absolutely full',
    text: 'Every seat. The noise is extraordinary and the concourses are impassable.',
    options: [
      opt('Open the concourse gates', 'Let the pressure out before it builds.',
        { guard: { congestion: 0.5, overcrowd: 0.6 }, cost: 3_000 }),
      opt('Ride it out', 'It is atmosphere. That is what they came for.',
        { sat: 5, risk: { key: 'crush', chance: 0.2, text: 'A crush developed on a stairway. Nobody was badly hurt, which was luck.', satisfaction: -20, reputation: -8, cost: 140_000, dept: 'security' } }),
    ],
  },
  {
    id: 'power_flicker', phase: 'kickoff', weight: 10, dept: 'operations',
    need: 'power',
    title: 'The lights dipped',
    text: 'Only for a second, and everybody saw it.',
    options: [
      opt('Shed load now', 'Kill the screens, the kiosk fridges, anything but the floodlights.',
        { guard: { power: 0.7 }, spend: 0.88, sat: -3 }),
      opt('Start the generators', 'That is what they were bought for.',
        { need: 'generator', guard: { power: 0.85 }, cost: 6_000 }),
      opt('Nothing', 'It was a flicker. Spend nothing and find out.',
        { risk: { key: 'blackout', chance: 0.3, text: 'The lights went out properly in the second half, and stayed out for eleven minutes.', satisfaction: -16, reputation: -4, cost: 70_000, dept: 'operations' } }),
    ],
  },

  // =============================================================== interval
  {
    id: 'queue_kiosks', phase: 'interval', weight: 12, dept: 'hospitality',
    title: 'The kiosk queues are enormous',
    text: 'Fifteen minutes, and most of the people in those queues will not be served.',
    options: [
      opt('Open every till and take cash', 'Speed over accounting.',
        { spend: 1.25, cost: 4_000, sat: 4 }),
      opt('Sellers in the stands', 'Take it to them instead.',
        { spend: 1.15, cost: 6_000, sat: 5 }),
      opt('Nothing to be done', 'It is fifteen minutes. They will survive.',
        { sat: -4 }),
    ],
  },
  {
    id: 'restroom_fail', phase: 'interval', weight: 11, dept: 'operations',
    need: 'restroom',
    title: 'A restroom block has flooded',
    text: 'The west concourse is closed and there is a queue at everything else.',
    options: [
      opt('Portable units, now', 'Call it in and pay the premium.',
        { cost: 12_000, guard: { restroom: 0.6, sewer: 0.3 } }),
      opt('Open the staff facilities', 'It is undignified but it works.',
        { guard: { restroom: 0.35 }, sat: 1 }),
      opt('Close it and say nothing', 'By the time they complain they will be at home.',
        { sat: -8, rep: { fans: -2 } }),
    ],
  },
  {
    id: 'medical_call', phase: 'interval', weight: 8, dept: 'operations',
    title: 'Somebody has collapsed in the upper tier',
    text: 'The medical team need a clear route and they need it now.',
    options: [
      opt('Stop the queues and clear a lane', 'Everything else waits.',
        { sat: 2, rep: { community: 3 }, guard: { medical: 0.6 } }),
      opt('Send them the long way round', 'It is slower but nothing else stops.',
        { sat: -3, risk: { key: 'medical', chance: 0.3, text: 'A medical response was delayed by the crowd. It was reported.', satisfaction: -12, reputation: -6, dept: 'operations' } }),
    ],
  },
  {
    id: 'pitch_invasion_warning', phase: 'interval', weight: 6, dept: 'security',
    when: (c) => c.risky && c.fill > 0.85,
    title: 'They are talking about going on at the final whistle',
    text: 'Your stewards have heard it in three separate parts of the ground.',
    options: [
      opt('Ring the pitch', 'Every steward you have, on the perimeter, now.',
        { cost: 9_000, guard: { disorder: 0.6, pitchinvasion: 0.7 } }),
      opt('Announce the consequences', 'Bans, prosecutions, the whole speech.',
        { sat: -3, guard: { pitchinvasion: 0.35 } }),
      opt('Let them have it', 'It is a celebration, not a riot.',
        { sat: 6, risk: { key: 'pitchinvasion', chance: 0.55, text: 'The pitch went at the whistle. Nobody was hurt; the surface was not so lucky.', satisfaction: -4, reputation: -5, cost: 55_000, dept: 'security' } }),
    ],
  },
  {
    id: 'sponsor_activation', phase: 'interval', weight: 7, dept: 'marketing',
    title: 'The sponsor wants the interval',
    text: 'Fifteen minutes of the pitch, the screens and everybody’s attention.',
    options: [
      opt('Give them all of it', 'They are paying for it.',
        { revenue: 34_000, sat: -4, rep: { fans: -2 } }),
      opt('Screens only', 'Keep the pitch clear and the branding loud.',
        { revenue: 18_000 }),
      opt('Nothing during the interval', 'The crowd gets its fifteen minutes.',
        { sat: 3, rep: { fans: 2 } }),
    ],
  },

  // ============================================================ second half
  {
    id: 'atmosphere_push', phase: 'second', weight: 8, dept: 'events',
    title: 'The ground has gone quiet',
    text: 'It is a poor game and you can hear individual voices.',
    options: [
      opt('Big screen replays and the sound system', 'Manufacture some of it.',
        { sat: 4, cost: 1_500 }),
      opt('Hand the microphone to the crowd', 'Riskier and much better when it works.',
        { sat: 6, risk: { key: 'mic', chance: 0.15, text: 'The crowd microphone found somebody with strong opinions and a live feed.', satisfaction: -6, reputation: -3, dept: 'events' } }),
      opt('It is not your job to entertain them', 'They came for the sport.',
        { sat: -1 }),
    ],
  },
  {
    id: 'floodlight_fail', phase: 'second', weight: 10, dept: 'operations',
    need: 'lighting',
    title: 'A floodlight bank has gone',
    text: 'A quarter of the pitch is in shadow and the officials have noticed.',
    options: [
      opt('Play on under what is left', 'It is legal. Just.',
        { sat: -5, rep: { organiser: -2 } }),
      opt('Suspend play and fix it', 'Twenty minutes and an electrician who will not be cheap.',
        { cost: 16_000, sat: -3, guard: { lighting: 0.7 } }),
      opt('Abandon and refund', 'Nobody can see. Send them home.',
        { price: 0.2, sat: -12, rep: { organiser: -8, fans: -6, venue: -4 } }),
    ],
  },
  {
    id: 'weather_turns', phase: 'second', weight: 9, dept: 'operations',
    when: (c) => c.wet && !c.indoor,
    title: 'It is coming down properly now',
    text: 'The uncovered blocks are emptying and the surface is standing water.',
    options: [
      opt('Move them under cover', 'Reseat the uncovered blocks wherever there is room.',
        { need: 'roof', sat: 8, cost: 2_000 }),
      opt('Fork the surface at the next stoppage', 'Buy the game twenty more minutes.',
        { cost: 5_000, guard: { surface: 0.5 } }),
      opt('Nothing', 'It is rain. It happens.',
        { sat: -6 }),
    ],
  },
  {
    id: 'record_crowd', phase: 'second', weight: 5, dept: 'marketing',
    when: (c) => c.record,
    title: 'This is the biggest crowd this ground has held',
    text: 'Somebody in the press box has done the arithmetic.',
    options: [
      opt('Announce it', 'Put the number on the screens.',
        { sat: 6, rep: { venue: 3, fans: 3 },
          risk: { key: 'certificate', chance: 0.22, text: 'The safety officer read the announced figure, compared it with the certificate, and wrote to you about it.', satisfaction: -4, reputation: -5, cost: 45_000, dept: 'security' } }),
      opt('Keep it quiet', 'Safety certificates are read by people who notice this sort of thing.',
        { guard: { overcrowd: 0.3 }, sat: -2 }),
    ],
  },

  // ================================================================ egress
  {
    id: 'egress_plan', phase: 'egress', weight: 12, dept: 'security',
    title: 'Everybody wants to leave at once',
    text: 'The whole ground stood up within ten seconds of the whistle.',
    options: [
      opt('Stagger the exits', 'Hold the upper tiers back five minutes at a time.',
        { cost: 4_000, guard: { crush: 0.6, congestion: 0.4 }, sat: -2 }),
      opt('Open everything', 'Every gate, every door, let them go.',
        { guard: { congestion: 0.35 }, sat: 3,
          risk: { key: 'egress', chance: 0.2, text: 'The exit crush outside the ground blocked a main road for an hour.', satisfaction: -6, community: -6, dept: 'security' } }),
      opt('Keep them in for the post-match', 'Interviews on the big screen. Some will stay.',
        { spend: 1.1, sat: -3, guard: { egress: 0.4 } }),
    ],
  },
  {
    id: 'transport_out', phase: 'egress', weight: 9, dept: 'operations',
    title: 'The last trains are in twenty minutes',
    text: 'Half the crowd is trying to make them and the station is ten minutes away.',
    options: [
      opt('Lay on extra buses', 'Call the operator and pay for it.',
        { cost: 14_000, sat: 5, rep: { community: 4 } }),
      opt('Marshal the route', 'Staff on every corner between here and the platform.',
        { cost: 5_000, sat: 3, rep: { community: 2 } }),
      opt('They knew the timetable', 'It is not your railway.',
        { sat: -4, rep: { community: -3 } }),
    ],
  },
  {
    id: 'cleanup', phase: 'egress', weight: 8, dept: 'operations',
    title: 'The ground is a tip',
    text: 'The cleaning crew want to know whether this is a tonight job or a tomorrow job.',
    options: [
      opt('Tonight, all of it', 'Overtime, and the place is spotless by morning.',
        { cost: 11_000, sat: 2, rep: { community: 3, organiser: 2 } }),
      opt('The concourses tonight, the rest tomorrow', 'A reasonable compromise.',
        { cost: 5_000 }),
      opt('Tomorrow', 'It will still be there in the morning.',
        { cost: -3_000, rep: { community: -3 } }),
    ],
  },
  {
    id: 'debrief', phase: 'egress', weight: 10, dept: 'events',
    title: 'The organiser wants a word',
    text: 'They are waiting in the tunnel and their expression is hard to read.',
    options: [
      opt('Take the blame for everything', 'Own it, list the fixes, ask for the rebook.',
        { rep: { organiser: 5 }, sat: 1 }),
      opt('Point out what went well', 'Steer them to the crowd, the pitch, the noise.',
        { rep: { organiser: 2, venue: 2 } }),
      opt('Talk about next year’s fee', 'Strike while they are still buzzing.',
        { revenue: 26_000, rep: { organiser: -3 } }),
    ],
  },
  {
    id: 'aftermatch_hospitality', phase: 'egress', weight: 6, dept: 'hospitality',
    when: (c) => c.tierRank >= 2,
    title: 'The lounges are still full',
    text: 'Nobody in hospitality shows any sign of going home.',
    options: [
      opt('Keep the bars open', 'Two more hours, and the till keeps running.',
        { revenue: 31_000, cost: 6_000, rep: { organiser: 2 } }),
      opt('Last orders', 'Wind it down kindly.',
        { revenue: 9_000 }),
      opt('Clear the room', 'The cleaners need it and you need to sleep.',
        { cost: -2_000, rep: { organiser: -2 } }),
    ],
  },
];

export const CALL_BY_ID = new Map(MATCHDAY_CALLS.map((c) => [c.id, c]));

/** Calls that could land in a phase, before the live day narrows them. */
export function callsForPhase(phase) {
  return MATCHDAY_CALLS.filter((c) => c.phase === phase);
}
