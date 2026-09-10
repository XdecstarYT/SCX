/**
 * Event catalogue. Entirely fictional leagues, cups and organisers.
 *
 * Each template is a recipe the generator instantiates with a date, an
 * organiser and randomised economics. `req` entries are checked against the
 * player's actual detected venue - that is the link between building and
 * management.
 *
 *   tier        gates which events appear as reputation grows
 *   popularity  0..1 demand multiplier feeding attendance
 *   base        typical gross ticket yield per attendee, before venue quality
 *   bid         [min, max] the organiser will entertain
 *   fee         guaranteed venue fee paid by the organiser
 *   days        how long the venue is occupied
 *   risk        chance-of-problems weighting
 */

const req = {
  cap: (n) => ({ key: 'capacity', min: n, label: `Capacity ${n.toLocaleString()}+` }),
  rating: (n) => ({ key: 'rating', min: n, label: `Venue rating ${n}+` }),
  rep: (n) => ({ key: 'reputation', min: n, label: `Venue reputation ${n}+` }),
  field: (sport) => ({ key: 'field', sport, label: 'Regulation playing surface' }),
  parking: (n) => ({ key: 'parking', min: n, label: `Parking for ${n.toLocaleString()} cars` }),
  m: (measure, min, label) => ({ key: 'measure', measure, min, label }),
};

export const EVENT_TEMPLATES = [
  // ------------------------------------------------------------------ local
  {
    id: 'local_friendly', name: 'Community Friendly', sport: 'football', tier: 'local',
    organiser: 'Meridian Amateur League', popularity: 0.35, base: 14, fee: 9_000,
    bid: [1_000, 14_000], days: 1, risk: 0.1, prestige: 2, audience: 'local',
    req: [req.field('football'), req.cap(600), req.rating(24)],
    blurb: 'Two local sides, a warm evening, and a chance to prove the ground works.',
  },
  {
    id: 'school_champs', name: 'Schools Championship', sport: 'athletics', tier: 'local',
    organiser: 'County Schools Board', popularity: 0.3, base: 9, fee: 12_000,
    bid: [1_000, 12_000], days: 2, risk: 0.08, prestige: 2, audience: 'family',
    req: [req.field('athletics'), req.cap(500), req.rating(22)],
    blurb: 'Twelve schools, four hundred athletes, and a lot of proud parents.',
  },
  {
    id: 'local_hoops', name: 'City Basketball Series', sport: 'basketball', tier: 'local',
    organiser: 'Metro Hoops Association', popularity: 0.4, base: 18, fee: 15_000,
    bid: [2_000, 20_000], days: 1, risk: 0.1, prestige: 3, audience: 'local',
    req: [req.field('basketball'), req.cap(900), req.rating(26)],
    blurb: 'A weeknight double-header with a loyal local following.',
  },
  {
    id: 'club_open', name: 'Club Open Day', sport: 'football', tier: 'local',
    organiser: 'Riverside Community Trust', popularity: 0.28, base: 8, fee: 6_000,
    bid: [500, 8_000], days: 1, risk: 0.05, prestige: 1, audience: 'family',
    req: [req.field('football'), req.cap(400), req.rating(18)],
    blurb: 'Low stakes, low fee, and a friendly way to build community goodwill.',
    community: 4,
  },

  // --------------------------------------------------------------- regional
  {
    id: 'regional_final', name: 'Regional Championship Final', sport: 'football', tier: 'regional',
    organiser: 'Northern Regional Federation', popularity: 0.6, base: 34, fee: 180_000,
    bid: [40_000, 320_000], days: 1, risk: 0.18, prestige: 7, audience: 'regional',
    req: [req.field('football'), req.cap(6000), req.rating(46), req.m('locker', 0.5, 'Professional locker rooms'), req.m('lighting', 0.5, 'Floodlighting')],
    blurb: 'The regional showpiece. Win it and organisers start returning your calls.',
  },
  {
    id: 'pro_league', name: 'Professional League Fixture', sport: 'football', tier: 'regional',
    organiser: 'Continental Premier League', popularity: 0.55, base: 38, fee: 220_000,
    bid: [60_000, 400_000], days: 1, risk: 0.15, prestige: 5, audience: 'regional',
    req: [req.field('football'), req.cap(8000), req.rating(50), req.m('media', 0.4, 'Media facilities'), req.m('exit', 0.7, 'Emergency egress')],
    blurb: 'A league side needs a home while their ground is redeveloped.',
    recurring: true,
  },
  {
    id: 'tennis_open', name: 'Regional Tennis Open', sport: 'tennis', tier: 'regional',
    organiser: 'Federated Racquet Tour', popularity: 0.45, base: 42, fee: 160_000,
    bid: [30_000, 260_000], days: 5, risk: 0.2, prestige: 6, audience: 'premium',
    req: [req.field('tennis'), req.cap(3000), req.rating(48), req.m('hospitality', 0.3, 'Hospitality provision')],
    blurb: 'Five days of tennis and a crowd that spends well on hospitality.',
  },
  {
    id: 'hoops_playoff', name: 'Basketball Conference Playoff', sport: 'basketball', tier: 'regional',
    organiser: 'Continental Hoops Conference', popularity: 0.62, base: 46, fee: 240_000,
    bid: [50_000, 380_000], days: 2, risk: 0.16, prestige: 7, audience: 'regional',
    req: [req.field('basketball'), req.cap(7000), req.rating(52), req.m('media', 0.4, 'Media facilities')],
    blurb: 'Two nights of playoff basketball with a national broadcast window.',
  },
  {
    id: 'concert_mid', name: 'Stadium Concert', sport: 'concert', tier: 'regional',
    organiser: 'Halcyon Live', popularity: 0.75, base: 52, fee: 300_000,
    bid: [80_000, 520_000], days: 3, risk: 0.3, prestige: 5, audience: 'family',
    req: [req.cap(12000), req.rating(50), req.m('exit', 0.8, 'Emergency egress'), req.m('concession', 0.6, 'Food and beverage')],
    blurb: 'No pitch required - but the turf will take a beating and the neighbours will notice.',
    community: -8, wear: 2.2,
  },

  // --------------------------------------------------------------- national
  {
    id: 'national_final', name: 'National Championship Final', sport: 'football', tier: 'national',
    organiser: 'National Football Association', popularity: 0.85, base: 78, fee: 1_400_000,
    bid: [400_000, 2_400_000], days: 1, risk: 0.24, prestige: 15, audience: 'national',
    req: [req.field('football'), req.cap(18000), req.rating(62), req.rep(45),
          req.m('broadcast', 0.5, 'Broadcast centre'), req.m('media', 0.6, 'Media centre'),
          req.m('hospitality', 0.4, 'VIP hospitality'), req.m('security', 0.7, 'Security provision'),
          req.parking(4500)],
    blurb: 'The national final. A sell-out, a full broadcast compound, and no room for error.',
  },
  {
    id: 'national_hoops', name: 'National Basketball Final', sport: 'basketball', tier: 'national',
    organiser: 'National Basketball Board', popularity: 0.8, base: 86, fee: 1_200_000,
    bid: [350_000, 2_000_000], days: 2, risk: 0.22, prestige: 14, audience: 'national',
    req: [req.field('basketball'), req.cap(12000), req.rating(65), req.rep(45),
          req.m('broadcast', 0.5, 'Broadcast centre'), req.m('hospitality', 0.5, 'VIP hospitality'),
          req.parking(3000)],
    blurb: 'Twelve thousand seats, exclusive hospitality and a live national feed.',
  },
  {
    id: 'athletics_champs', name: 'National Athletics Championships', sport: 'athletics', tier: 'national',
    organiser: 'National Athletics Union', popularity: 0.68, base: 54, fee: 900_000,
    bid: [250_000, 1_500_000], days: 4, risk: 0.26, prestige: 12, audience: 'national',
    req: [req.field('athletics'), req.cap(15000), req.rating(60), req.rep(40),
          req.m('media', 0.6, 'Media centre'), req.m('medical', 0.8, 'Medical facilities')],
    blurb: 'Four days, thirty-eight events, and a very demanding technical delegate.',
  },
  {
    id: 'cup_final', name: 'National Cup Final', sport: 'football', tier: 'national',
    organiser: 'National Football Association', popularity: 0.9, base: 84, fee: 1_700_000,
    bid: [500_000, 2_800_000], days: 1, risk: 0.25, prestige: 16, audience: 'national',
    req: [req.field('football'), req.cap(24000), req.rating(66), req.rep(52),
          req.m('broadcast', 0.6, 'Broadcast centre'), req.m('hospitality', 0.5, 'VIP hospitality'),
          req.m('crowd', 0.7, 'Crowd flow'), req.parking(6000)],
    blurb: 'The biggest domestic date of the year. Everyone will be watching the queues.',
  },
  {
    id: 'combat_night', name: 'Championship Fight Night', sport: 'combat', tier: 'national',
    organiser: 'Apex Combat Promotions', popularity: 0.78, base: 120, fee: 800_000,
    bid: [200_000, 1_300_000], days: 1, risk: 0.34, prestige: 10, audience: 'premium',
    req: [req.cap(9000), req.rating(58), req.m('security', 0.8, 'High security'), req.m('hospitality', 0.5, 'VIP hospitality'), req.m('broadcast', 0.4, 'Broadcast')],
    blurb: 'Huge per-head spend, a pay-per-view feed, and a security operation to match.',
    community: -4,
  },

  // ---------------------------------------------------------- international
  {
    id: 'intl_friendly', name: 'International Friendly', sport: 'football', tier: 'international',
    organiser: 'Global Football Confederation', popularity: 0.88, base: 92, fee: 2_600_000,
    bid: [700_000, 3_800_000], days: 2, risk: 0.28, prestige: 18, audience: 'international',
    req: [req.field('football'), req.cap(32000), req.rating(70), req.rep(58),
          req.m('broadcast', 0.7, 'Broadcast centre'), req.m('media', 0.7, 'Media centre'),
          req.m('hospitality', 0.6, 'VIP hospitality'), req.m('parking', 0.6, 'Transport capacity'),
          req.m('safety', 0.7, 'Safety rating')],
    blurb: 'Two national sides, a global broadcast, and a delegation that inspects everything.',
  },
  {
    id: 'intl_cup', name: 'Continental Cup Final', sport: 'football', tier: 'international',
    organiser: 'Global Football Confederation', popularity: 0.95, base: 118, fee: 5_500_000,
    bid: [1_800_000, 8_000_000], days: 3, risk: 0.32, prestige: 26, audience: 'international',
    req: [req.field('football'), req.cap(45000), req.rating(76), req.rep(68),
          req.m('broadcast', 0.85, 'Broadcast centre'), req.m('media', 0.8, 'Media centre'),
          req.m('hospitality', 0.7, 'VIP hospitality'), req.m('safety', 0.8, 'Safety rating'),
          req.m('crowd', 0.75, 'Crowd flow'), req.parking(12000)],
    blurb: 'The continental showpiece. Winning this bid changes what your complex is.',
  },
  {
    id: 'world_champs', name: 'World Championship', sport: 'athletics', tier: 'world',
    organiser: 'World Sports Council', popularity: 1.0, base: 104, fee: 9_000_000,
    bid: [3_000_000, 14_000_000], days: 9, risk: 0.38, prestige: 40, audience: 'international',
    req: [req.field('athletics'), req.cap(52000), req.rating(82), req.rep(78),
          req.m('broadcast', 0.9, 'Broadcast centre'), req.m('media', 0.9, 'Media centre'),
          req.m('hospitality', 0.8, 'VIP hospitality'), req.m('safety', 0.85, 'Safety rating'),
          req.m('crowd', 0.8, 'Crowd flow'), req.m('comfort', 0.8, 'Spectator comfort'),
          req.parking(16000)],
    blurb: 'Nine days. Two hundred nations. The single biggest thing a venue can host.',
  },
  {
    id: 'mega_opening', name: 'Games Opening Ceremony', sport: 'ceremony', tier: 'world',
    organiser: 'World Sports Council', popularity: 1.0, base: 165, fee: 12_000_000,
    bid: [4_000_000, 18_000_000], days: 2, risk: 0.42, prestige: 45, audience: 'international',
    req: [req.cap(60000), req.rating(85), req.rep(85),
          req.m('broadcast', 0.95, 'Broadcast centre'), req.m('hospitality', 0.85, 'VIP hospitality'),
          req.m('safety', 0.9, 'Safety rating'), req.m('crowd', 0.85, 'Crowd flow'),
          req.parking(20000)],
    blurb: 'The ceremony the whole planet watches. There is no second chance at this one.',
    community: 10,
  },
];

export const TIER_UNLOCK_REPUTATION = {
  local: 0, regional: 18, national: 42, international: 64, world: 82,
};

/** Fictional organiser flavour used in negotiations. */
export const ORGANISER_TRAITS = {
  'Meridian Amateur League':      { priceSensitive: 0.9, prestigeFocus: 0.2, loyalty: 0.5 },
  'County Schools Board':         { priceSensitive: 0.95, prestigeFocus: 0.1, loyalty: 0.6 },
  'Metro Hoops Association':      { priceSensitive: 0.8, prestigeFocus: 0.3, loyalty: 0.5 },
  'Riverside Community Trust':    { priceSensitive: 0.7, prestigeFocus: 0.1, loyalty: 0.8 },
  'Northern Regional Federation': { priceSensitive: 0.7, prestigeFocus: 0.4, loyalty: 0.5 },
  'Continental Premier League':   { priceSensitive: 0.55, prestigeFocus: 0.6, loyalty: 0.6 },
  'Federated Racquet Tour':       { priceSensitive: 0.5, prestigeFocus: 0.7, loyalty: 0.4 },
  'Continental Hoops Conference': { priceSensitive: 0.6, prestigeFocus: 0.6, loyalty: 0.5 },
  'Halcyon Live':                 { priceSensitive: 0.75, prestigeFocus: 0.4, loyalty: 0.3 },
  'National Football Association':{ priceSensitive: 0.45, prestigeFocus: 0.8, loyalty: 0.5 },
  'National Basketball Board':    { priceSensitive: 0.5, prestigeFocus: 0.75, loyalty: 0.5 },
  'National Athletics Union':     { priceSensitive: 0.55, prestigeFocus: 0.7, loyalty: 0.5 },
  'Apex Combat Promotions':       { priceSensitive: 0.4, prestigeFocus: 0.6, loyalty: 0.2 },
  'Global Football Confederation':{ priceSensitive: 0.3, prestigeFocus: 0.95, loyalty: 0.4 },
  'World Sports Council':         { priceSensitive: 0.25, prestigeFocus: 1.0, loyalty: 0.3 },
};

/** Optional extras a bidder can attach to strengthen an offer. */
export const BID_PACKAGES = [
  { key: 'training',   name: 'Free Training Facilities', cost: 0.04, strength: 0.06, need: 'training',    desc: 'Open your training areas to the competing teams.' },
  { key: 'hospitality',name: 'Enhanced VIP Hospitality', cost: 0.07, strength: 0.09, need: 'hospitality', desc: 'Dedicated suites and catering for the organiser delegation.' },
  { key: 'transport',  name: 'Transport & Shuttles',     cost: 0.05, strength: 0.07, need: null,          desc: 'Shuttle buses from the city centre and team transfers.' },
  { key: 'security',   name: 'Uplifted Security',        cost: 0.06, strength: 0.08, need: 'security',    desc: 'Additional accredited stewards and screening lanes.' },
  { key: 'marketing',  name: 'Joint Marketing Campaign', cost: 0.05, strength: 0.06, need: null,          desc: 'City-wide promotion funded from your own budget.' },
  { key: 'fanzone',    name: 'Outdoor Fan Zone',         cost: 0.04, strength: 0.05, need: 'fanzone',     desc: 'A ticketed fan village outside the main gates.' },
  { key: 'media',      name: 'Media Workspace',          cost: 0.05, strength: 0.07, need: 'media',       desc: 'Fully fitted press workroom and mixed zone.' },
  { key: 'accom',      name: 'Accommodation Support',    cost: 0.08, strength: 0.06, need: null,          desc: 'Subsidised hotel block for officials and teams.' },
];

/** Contract levers. Each trades money against organiser goodwill. */
export const CONTRACT_TERMS = [
  { key: 'revshare_up',  name: 'Demand +10% revenue share', strength: -0.12, revenueShare: 0.10, desc: 'You keep more of the gate. Organisers hate it.' },
  { key: 'revshare_down',name: 'Concede 8% revenue share',  strength: 0.11,  revenueShare: -0.08, desc: 'A sweetener that costs you at the turnstile.' },
  { key: 'multiyear',    name: 'Offer a 3-year agreement',  strength: 0.10,  multiYear: 3, desc: 'Locks in a recurring fixture at a 6% discount.' },
  { key: 'exclusive',    name: 'Grant exclusive branding',  strength: 0.08,  sponsorPenalty: 0.25, desc: 'Organiser branding overrides your sponsor signage for the event.' },
  { key: 'broadcast',    name: 'Keep broadcasting rights',  strength: -0.15, broadcastBonus: 0.5, desc: 'Doubles your broadcast income if they agree.' },
];
