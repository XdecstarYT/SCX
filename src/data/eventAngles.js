import { req } from './events.js';

/**
 * Angles: the occasion that makes one fixture different from the next.
 *
 * The board used to be a fixed list. Every sport had three events, and once
 * you had seen them you had seen the sport - the National Basketball Final
 * was the same offer in year nine as in year one, and the only thing that
 * changed was whether you could afford it.
 *
 * An angle is not a new event. It is the reason *this* staging of an event is
 * different: a derby, a title decider, a testimonial, a washout being replayed,
 * a broadcaster wanting it at night, a sponsor's anniversary. It composes onto
 * any base the gates allow, changing the name, the crowd, the money, the risk
 * and often the requirements.
 *
 * Most of them are conditional on the game you are actually playing. `when`
 * reads the save - the season, your tenants, the league table, the weather,
 * who you have dealt with before, what your rivals just lost - so the board
 * describes your complex rather than a catalogue. That is the part that makes
 * it dynamic rather than merely numerous.
 *
 *   tiers      which event tiers it can apply to (omit = all)
 *   sports     restrict to these sports (omit = all)
 *   notSports  never these
 *   when       (state, base) => boolean; a gate on the live save
 *   weight     relative likelihood once it is eligible
 *   name       (base) => the composed name
 *   blurb      (base) => the line the player reads
 *   mult       multipliers on the base's numbers
 *   req        extra requirements the occasion brings
 */

const ALL_TIERS = ['local', 'regional', 'national', 'international', 'world'];
const BIG = ['national', 'international', 'world'];
const SMALL = ['local', 'regional'];

/** Late in the league season, when a table has something to decide. */
const lateSeason = (s) => {
  const l = s.league;
  if (!l) return false;
  const day = s.day - l.startedDay;
  return day > 150 && day < 250;
};
const earlySeason = (s) => {
  const l = s.league;
  if (!l) return false;
  const day = s.day - l.startedDay;
  return day >= 0 && day < 45;
};
const hasTenant = (s) => (s.league?.tenants || []).length > 0;
const dealtWith = (s, base) => (s.organiserHistory?.[base.organiser] || 0) >= 2;
const newVenue = (s) => (s.stats?.eventsHosted || 0) < 6;
const established = (s) => (s.stats?.eventsHosted || 0) >= 25;
const richFans = (s) => s.reputation.fans >= 62;
const goodStanding = (s) => s.reputation.community >= 62;
const poorStanding = (s) => s.reputation.community < 45;
const rivalsClose = (s) => (s.rivals || []).some((r) => r.reputation >= s.reputation.venue - 8);
const hadIncident = (s) => (s.events?.history || []).slice(0, 8).some((h) => (h.incidents || []).length > 0);
const wet = (s) => ['rain', 'storm'].includes(s.weather);
const hot = (s) => s.weather === 'heat';

export const EVENT_ANGLES = [
  // ------------------------------------------------------------ the ordinary
  // The unmarked case. Without it every event on the board is a special
  // occasion, which makes none of them one.
  {
    id: 'plain', weight: 26, tiers: ALL_TIERS,
    name: (b) => b.name,
    blurb: (b) => b.blurb,
    mult: {},
  },

  // ------------------------------------------------------------- the fixture
  {
    id: 'derby', weight: 9, tiers: ALL_TIERS,
    notSports: ['ceremony', 'concert'],
    name: (b) => `${b.name}: the Derby`,
    blurb: () => 'Two sides from the same three streets. Sell the segregation plan first, the tickets second.',
    mult: { pop: 1.22, base: 1.18, risk: 1.55, fee: 1.1, prestige: 1.1, community: 0.6 },
    req: [req.m('security', 0.55, 'Security operation')],
  },
  {
    id: 'decider', weight: 8, tiers: ALL_TIERS, when: lateSeason,
    notSports: ['ceremony', 'concert'],
    name: (b) => `${b.name}: Title Decider`,
    blurb: () => 'Whoever wins this wins the lot. Nobody is leaving early.',
    mult: { pop: 1.3, base: 1.25, fee: 1.2, prestige: 1.35, risk: 1.15 },
  },
  {
    id: 'playoff', weight: 7, tiers: ['regional', 'national', 'international'], when: lateSeason,
    notSports: ['ceremony', 'concert'],
    name: (b) => `${b.name} Play-Off`,
    blurb: () => 'One match, one promotion, and a losing dressing room nobody wants to walk past.',
    mult: { pop: 1.18, base: 1.2, fee: 1.15, prestige: 1.2 },
  },
  {
    id: 'preseason', weight: 7, tiers: SMALL, when: earlySeason,
    notSports: ['ceremony'],
    name: (b) => `Pre-Season ${b.name}`,
    blurb: () => 'Nobody is fit and everybody is relaxed. A gentle way to find out what breaks.',
    mult: { pop: 0.72, base: 0.68, fee: 0.7, risk: 0.6, prestige: 0.6, wear: 0.7 },
  },
  {
    id: 'doubleheader', weight: 6, tiers: ALL_TIERS,
    notSports: ['ceremony'],
    name: (b) => `${b.name} Double-Header`,
    blurb: () => 'Two matches, one ticket, one very long day for the ground staff.',
    mult: { pop: 1.16, base: 1.14, fee: 1.5, risk: 1.2, wear: 1.8, prestige: 1.1 },
    days: 1,
    req: [req.m('restroom', 0.5, 'Restrooms'), req.m('concession', 0.5, 'Food and beverage')],
  },
  {
    id: 'replay', weight: 5, tiers: ALL_TIERS,
    notSports: ['ceremony', 'concert'],
    name: (b) => `${b.name} Replay`,
    blurb: () => 'The first one finished level. This one will not.',
    mult: { pop: 0.92, base: 0.96, fee: 0.85, prestige: 0.9 },
  },
  {
    id: 'rescheduled', weight: 5, tiers: ALL_TIERS, when: wet,
    notSports: ['ceremony'],
    name: (b) => `${b.name} (Rearranged)`,
    blurb: () => 'Washed out somewhere else at short notice. They need a ground that drains.',
    mult: { pop: 0.86, base: 0.9, fee: 1.12, risk: 1.1 },
    lead: [3, 9],
    req: [req.rating(34)],
  },

  // --------------------------------------------------------------- the crowd
  {
    id: 'night', weight: 8, tiers: ALL_TIERS,
    notSports: ['ceremony'],
    name: (b) => `${b.name} Under Lights`,
    blurb: () => 'An evening kick-off for the cameras. The floodlights had better be broadcast grade.',
    mult: { pop: 1.14, base: 1.12, fee: 1.12, prestige: 1.05 },
    req: [req.m('lighting', 0.6, 'Floodlighting')],
  },
  {
    id: 'family', weight: 7, tiers: SMALL,
    notSports: ['combat'],
    name: (b) => `${b.name} Family Day`,
    blurb: () => 'Cheap seats, a lot of children, and a queue for everything.',
    mult: { pop: 1.2, base: 0.6, fee: 0.9, community: 2.4, risk: 0.8 },
    req: [req.m('restroom', 0.55, 'Restrooms'), req.m('concession', 0.5, 'Food and beverage')],
  },
  {
    id: 'charity', weight: 6, tiers: ALL_TIERS, when: goodStanding,
    name: (b) => `${b.name} Charity Match`,
    blurb: () => 'The gate goes to the hospital. What you get is the goodwill, and it is worth having.',
    mult: { pop: 1.06, base: 0.72, fee: 0.45, community: 3.4, prestige: 0.8, risk: 0.8 },
  },
  {
    id: 'outreach', weight: 5, tiers: SMALL, when: poorStanding,
    name: (b) => `${b.name} Community Open Day`,
    blurb: () => 'The neighbours are not keen on you. This is the olive branch, and it is cheap.',
    mult: { pop: 0.9, base: 0.5, fee: 0.5, community: 4.2, prestige: 0.6, risk: 0.7 },
  },
  {
    id: 'testimonial', weight: 5, tiers: ALL_TIERS, when: hasTenant,
    notSports: ['ceremony', 'concert'],
    name: (b) => `${b.name}: Testimonial`,
    blurb: () => 'Twenty years at one club. Everybody who ever played alongside them is turning up.',
    mult: { pop: 1.12, base: 0.88, fee: 0.8, community: 2.6, risk: 0.7, prestige: 0.9 },
  },
  {
    id: 'anniversary', weight: 5, tiers: ALL_TIERS, when: established,
    name: (b) => `${b.name} Centenary`,
    blurb: () => 'A hundred years of the competition, and they want a ground worth the photographs.',
    mult: { pop: 1.18, base: 1.15, fee: 1.2, prestige: 1.4 },
    req: [req.m('hospitality', 0.45, 'VIP hospitality'), req.rating(52)],
  },
  {
    id: 'soldout', weight: 4, tiers: BIG, when: richFans,
    name: (b) => `${b.name} (Sell-Out Expected)`,
    blurb: () => 'It went in an hour. Every seat you have will be filled and then some.',
    mult: { pop: 1.34, base: 1.2, risk: 1.25, fee: 1.05 },
    req: [req.m('exit', 0.6, 'Emergency exits'), req.m('entrance', 0.55, 'Entrance gates')],
  },
  {
    id: 'closeddoors', weight: 3, tiers: ALL_TIERS,
    notSports: ['ceremony', 'concert'],
    name: (b) => `${b.name} (Behind Closed Doors)`,
    blurb: () => 'No crowd. The broadcast fee is the whole of it, and nobody will forgive a bad picture.',
    mult: { pop: 0.06, base: 0, fee: 1.9, risk: 0.5, community: 0, prestige: 0.7 },
    req: [req.m('broadcast', 0.5, 'Broadcast centre')],
  },

  // ----------------------------------------------------------- the broadcast
  {
    id: 'primetime', weight: 7, tiers: BIG,
    name: (b) => `${b.name}: Prime Time`,
    blurb: () => 'Live to a national audience in the evening slot. Everything has to work on camera.',
    mult: { pop: 1.12, base: 1.1, fee: 1.45, prestige: 1.25, risk: 1.1 },
    req: [req.m('broadcast', 0.65, 'Broadcast centre'), req.m('media', 0.5, 'Media centre'),
          req.m('lighting', 0.65, 'Floodlighting')],
  },
  {
    id: 'worldfeed', weight: 5, tiers: ['international', 'world'],
    name: (b) => `${b.name}: World Feed`,
    blurb: () => 'Forty territories, eight languages, and a truck park the size of the pitch.',
    mult: { pop: 1.08, base: 1.06, fee: 1.7, prestige: 1.35 },
    req: [req.m('broadcast', 0.75, 'Broadcast centre'), req.m('media', 0.7, 'Media centre'),
          req.parking(2_500)],
  },
  {
    id: 'documentary', weight: 4, tiers: ALL_TIERS, when: established,
    name: (b) => `${b.name} (Documentary Crew)`,
    blurb: () => 'A film crew with access all areas. Whatever goes wrong, it goes wrong on camera.',
    mult: { fee: 1.2, prestige: 1.3, risk: 1.3 },
    req: [req.m('media', 0.45, 'Media centre')],
  },

  // -------------------------------------------------------------- the money
  {
    id: 'sponsorlaunch', weight: 6, tiers: ALL_TIERS,
    name: (b) => `${b.name} presented by a new backer`,
    blurb: () => 'A sponsor launching a campaign around the day. They will want the place spotless.',
    mult: { fee: 1.35, base: 1.05, prestige: 1.1 },
    req: [req.rating(46), req.m('hospitality', 0.35, 'VIP hospitality')],
  },
  {
    id: 'corporate', weight: 6, tiers: ['regional', 'national', 'international'],
    name: (b) => `${b.name} Corporate Day`,
    blurb: () => 'Half the ground is on somebody’s expense account. They expect a table and a view.',
    mult: { base: 1.45, pop: 0.94, fee: 1.15, prestige: 1.1 },
    req: [req.m('hospitality', 0.6, 'VIP hospitality'), req.m('restaurant', 0.35, 'Catering')],
  },
  {
    id: 'lowbudget', weight: 6, tiers: SMALL,
    name: (b) => `${b.name} (Reduced Terms)`,
    blurb: () => 'They have no money and they are honest about it. The gate is yours, though.',
    mult: { fee: 0.35, base: 1.1, bid: 0.4, prestige: 0.8 },
  },
  {
    id: 'lastminute', weight: 5, tiers: ALL_TIERS,
    name: (b) => `${b.name} (Short Notice)`,
    blurb: () => 'Their first choice fell through this morning. They will pay for the favour.',
    mult: { fee: 1.4, pop: 0.86, risk: 1.25, bid: 0.7 },
    lead: [2, 6],
  },
  {
    id: 'returnleg', weight: 5, tiers: ALL_TIERS, when: dealtWith,
    name: (b) => `${b.name}: Return Fixture`,
    blurb: () => 'You have worked with them before and it went well. They came back.',
    mult: { fee: 1.12, bid: 0.82, risk: 0.85, prestige: 1.05 },
  },
  {
    id: 'poached', weight: 4, tiers: BIG, when: rivalsClose,
    name: (b) => `${b.name} (Venue Change)`,
    blurb: () => 'It was going somewhere else. Something went wrong there, and here you are.',
    mult: { fee: 1.25, pop: 1.06, prestige: 1.2, risk: 1.15 },
    lead: [4, 12],
  },

  // ------------------------------------------------------ the ground itself
  {
    id: 'testevent', weight: 7, tiers: ['local'], when: newVenue,
    name: (b) => `${b.name}: Test Event`,
    blurb: () => 'A deliberately small crowd, to find out what your ground does under load.',
    mult: { pop: 0.5, base: 0.7, fee: 0.7, risk: 0.5, prestige: 0.7, community: 1.6 },
  },
  {
    id: 'inspection', weight: 5, tiers: ['national', 'international'],
    name: (b) => `${b.name} (Licensing Inspection)`,
    blurb: () => 'The governing body is watching this one. Pass and the bigger fixtures follow.',
    mult: { prestige: 1.45, fee: 0.95, risk: 1.2 },
    req: [req.m('medical', 0.6, 'Medical'), req.m('exit', 0.6, 'Emergency exits'),
          req.m('security', 0.5, 'Security operation')],
  },
  {
    id: 'safetyreview', weight: 4, tiers: ALL_TIERS, when: hadIncident,
    name: (b) => `${b.name} (Under Review)`,
    blurb: () => 'After what happened last time, they want to see the stewarding plan in writing.',
    mult: { fee: 0.9, risk: 0.75, prestige: 1.15, community: 1.4 },
    req: [req.m('security', 0.6, 'Security operation'), req.m('medical', 0.55, 'Medical')],
  },
  {
    id: 'heatwave', weight: 4, tiers: ALL_TIERS, when: hot,
    notSports: ['ice'],
    name: (b) => `${b.name} (Heat Protocol)`,
    blurb: () => 'Thirty-eight degrees at kick-off. Shade and water are not optional.',
    mult: { pop: 0.88, risk: 1.3, fee: 1.05, wear: 1.3 },
    req: [req.m('medical', 0.6, 'Medical'), req.m('restroom', 0.5, 'Restrooms')],
  },
  {
    id: 'wetweather', weight: 4, tiers: ALL_TIERS, when: wet,
    notSports: ['ice', 'esports'],
    name: (b) => `${b.name} (Weather Warning)`,
    blurb: () => 'It is going to rain all day. A covered stand is worth more than a cheap ticket.',
    mult: { pop: 0.84, risk: 1.25, wear: 1.5, fee: 1.0 },
  },

  // ----------------------------------------------------------- the occasion
  {
    id: 'opening', weight: 5, tiers: ALL_TIERS,
    name: (b) => `${b.name}: Opening Night`,
    blurb: () => 'The first of the season. Everyone turns up hopeful and the pitch is perfect.',
    mult: { pop: 1.15, base: 1.08, prestige: 1.1, fee: 1.05, wear: 0.8 },
  },
  {
    id: 'closing', weight: 5, tiers: ALL_TIERS, when: lateSeason,
    name: (b) => `${b.name}: Season Finale`,
    blurb: () => 'The last one before the break, with a presentation afterwards.',
    mult: { pop: 1.12, base: 1.1, prestige: 1.15, fee: 1.08, community: 1.3 },
  },
  {
    id: 'farewell', weight: 4, tiers: ALL_TIERS, when: established,
    name: (b) => `${b.name}: Farewell`,
    blurb: () => 'Somebody’s last appearance. A sentimental crowd is a generous one.',
    mult: { pop: 1.2, base: 1.12, community: 2.0, prestige: 1.1 },
  },
  {
    id: 'invitational', weight: 6, tiers: ['regional', 'national', 'international'],
    name: (b) => `${b.name} Invitational`,
    blurb: () => 'Invited sides only, no qualification, and a purse that explains why they came.',
    mult: { pop: 1.05, fee: 1.25, base: 1.1, prestige: 1.15 },
  },
  {
    id: 'exhibition', weight: 6, tiers: ALL_TIERS,
    notSports: ['ceremony'],
    name: (b) => `${b.name} Exhibition`,
    blurb: () => 'Nothing at stake, everything on show. They came to entertain, not to win.',
    mult: { pop: 0.95, base: 1.06, risk: 0.7, prestige: 0.85, wear: 0.8, community: 1.4 },
  },
  {
    id: 'qualifier', weight: 7, tiers: SMALL,
    notSports: ['ceremony', 'concert'],
    name: (b) => `${b.name} Qualifier`,
    blurb: () => 'The first rung. Whoever wins here goes somewhere better next month.',
    mult: { pop: 0.82, base: 0.86, fee: 0.8, prestige: 0.8 },
  },
  {
    id: 'masters', weight: 5, tiers: ['regional', 'national'],
    notSports: ['ceremony', 'concert', 'esports'],
    name: (b) => `${b.name}: Veterans` + '’ Match',
    blurb: () => 'Slower, funnier, and better attended than anybody involved expected.',
    mult: { pop: 0.9, base: 0.8, fee: 0.75, risk: 0.6, community: 2.2, wear: 0.6 },
  },
  {
    id: 'youth', weight: 6, tiers: SMALL,
    notSports: ['ceremony', 'concert', 'combat'],
    name: (b) => `Youth ${b.name}`,
    blurb: () => 'Under-eighteens, and a stand full of parents filming all of it.',
    mult: { pop: 0.62, base: 0.5, fee: 0.55, risk: 0.5, community: 3.0, wear: 0.5 },
  },
  {
    id: 'womens', weight: 8, tiers: ALL_TIERS,
    notSports: ['ceremony', 'concert'],
    name: (b) => `Women’s ${b.name}`,
    blurb: () => 'A fixture the competition has been building for years, and the crowd has followed.',
    mult: { pop: 0.94, base: 0.92, fee: 0.95, prestige: 1.05, community: 1.5 },
  },
  {
    id: 'para', weight: 6, tiers: ALL_TIERS,
    notSports: ['ceremony', 'concert'],
    name: (b) => `Para ${b.name}`,
    blurb: () => 'Accessible seating is the whole question here, and everyone will notice the answer.',
    mult: { pop: 0.8, base: 0.86, fee: 0.95, prestige: 1.15, community: 2.4 },
    req: [req.m('entrance', 0.5, 'Entrance gates'), req.m('restroom', 0.55, 'Restrooms')],
  },
  {
    id: 'international_squad', weight: 6, tiers: ['national', 'international'],
    notSports: ['ceremony', 'concert'],
    name: (b) => `${b.name}: International Select`,
    blurb: () => 'A scratch side of the best available, which is better than it sounds.',
    mult: { pop: 1.1, fee: 1.2, base: 1.1, prestige: 1.2 },
    req: [req.m('locker', 0.5, 'Changing rooms'), req.m('medical', 0.5, 'Medical')],
  },
  {
    id: 'festival', weight: 6, tiers: ALL_TIERS,
    name: (b) => `${b.name} Festival`,
    blurb: () => 'Three days of it, with music between sessions and a fan zone that never empties.',
    mult: { pop: 1.15, base: 1.1, fee: 1.35, wear: 1.6, community: 1.8, risk: 1.15 },
    days: 2,
    req: [req.m('fanzone', 0.4, 'Fan zone'), req.m('concession', 0.6, 'Food and beverage'),
          req.m('restroom', 0.6, 'Restrooms')],
  },
  {
    id: 'memorial', weight: 4, tiers: ALL_TIERS,
    name: (b) => `${b.name} Memorial`,
    blurb: () => 'Named after somebody the sport misses. It is played harder than a friendly.',
    mult: { pop: 1.02, base: 0.95, fee: 0.9, community: 2.2, prestige: 1.05 },
  },
  {
    id: 'tourstop', weight: 6, tiers: ['regional', 'national', 'international'],
    notSports: ['ceremony'],
    name: (b) => `${b.name}: Tour Stop`,
    blurb: () => 'One city on a circuit of twelve. If it goes well they come back every year.',
    mult: { pop: 1.05, fee: 1.15, prestige: 1.1 },
    req: [req.m('locker', 0.4, 'Changing rooms'), req.parking(1_200)],
  },
];

export const ANGLE_BY_ID = new Map(EVENT_ANGLES.map((a) => [a.id, a]));

/** Angles that could ever apply to a base, ignoring the live save. */
export function anglesForBase(base) {
  return EVENT_ANGLES.filter((a) => {
    if (a.tiers && !a.tiers.includes(base.tier)) return false;
    if (a.sports && !a.sports.includes(base.sport)) return false;
    if (a.notSports && a.notSports.includes(base.sport)) return false;
    return true;
  });
}

/** Angles that apply to a base *in this save*, which is the dynamic half. */
export function eligibleAngles(state, base) {
  return anglesForBase(base).filter((a) => !a.when || a.when(state, base));
}

/**
 * Every distinct event the catalogue can produce: each base under each angle
 * it allows. This is the number the board is drawing from, and a test holds
 * it above a floor so the variety cannot quietly collapse again.
 */
export function catalogueSize(templates) {
  let n = 0;
  for (const b of templates) n += anglesForBase(b).length;
  return n;
}
