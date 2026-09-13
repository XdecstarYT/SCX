import { req } from './events.js';

/**
 * Hosting rights: the competitions a venue is remembered for.
 *
 * The event board is a market in single afternoons. A tenancy is the opposite:
 * one club, every other weekend, for years. This is the third thing, and it is
 * the one stadiums are actually famous for - the right to stage a named
 * competition in a named year. The 2028 Grand Final was held *somewhere*, and
 * that somewhere is on a board in the concourse forever.
 *
 * What makes it a different decision from bidding for an event:
 *
 *   - You pay for the rights, up front, rather than being paid a fee. The
 *     money comes back over weeks, through the gate, and only if you can fill
 *     the place match after match.
 *   - It occupies the calendar. A five-match Test series is fifty days of your
 *     ground being unavailable for anything else, and the pitch wears through
 *     every one of them.
 *   - It cannot be repeated at will. Each competition comes round on its own
 *     cycle, so missing the year you were ready for it costs you the year.
 *
 * Every competition, trophy and side named here is fictional.
 *
 *   format     'showpiece' one match; 'series' the same two sides repeatedly;
 *              'tournament' a field playing down to a final
 *   matches    how many match days the rights cover
 *   spacing    days between them
 *   rights     [lo, hi] what the rights cost you to bid
 *   matchFee   broadcast and hosting money per match, paid to you
 *   window     [firstDay, lastDay] of the calendar year it can be staged in
 *   cycle      years between stagings (1 = annual)
 */
export const COMPETITIONS = [
  // ------------------------------------------------------------- showpieces
  {
    id: 'grand_final', name: 'Premiership Grand Final', short: 'Grand Final',
    sport: 'afl', tier: 'national', format: 'showpiece', field: 'clubs',
    matches: 1, spacing: 0, cycle: 1, window: [250, 300],
    rights: [420_000, 3_400_000], matchFee: 2_600_000, prestige: 26,
    trophy: 'the Premiership Cup',
    organiser: 'National Rules Commission',
    req: [req.field('afl'), req.cap(40_000), req.rating(74), req.rep(58),
          req.m('broadcast', 0.6, 'Broadcast centre'),
          req.m('hospitality', 0.5, 'VIP hospitality'),
          req.parking(6_000)],
    blurb: 'One afternoon, one trophy, and a ground that will be named in every report of it.',
    legacy: 'staged the Grand Final',
  },
  {
    id: 'nations_cup_final', name: 'Nations Cup Final', short: 'Cup Final',
    sport: 'football', tier: 'international', format: 'showpiece', field: 'nations',
    matches: 1, spacing: 0, cycle: 2, window: [140, 200],
    rights: [900_000, 6_500_000], matchFee: 5_200_000, prestige: 32,
    trophy: 'the Nations Cup',
    organiser: 'Continental Football Union',
    req: [req.field('football'), req.cap(58_000), req.rating(80), req.rep(70),
          req.m('broadcast', 0.7, 'Broadcast centre'),
          req.m('hospitality', 0.6, 'VIP hospitality'),
          req.m('media', 0.6, 'Media centre'), req.parking(9_000)],
    blurb: 'Two nations, ninety minutes, and the only match of the year everyone watches.',
    legacy: 'staged the Nations Cup Final',
  },
  {
    id: 'title_night', name: 'Undisputed Title Night', short: 'Title Night',
    sport: 'combat', tier: 'international', format: 'showpiece', field: 'nations',
    matches: 1, spacing: 0, cycle: 1, window: [60, 320],
    rights: [180_000, 1_900_000], matchFee: 1_700_000, prestige: 18,
    trophy: 'the unified belt',
    organiser: 'Global Combat Promotions',
    req: [req.field('combat'), req.cap(18_000), req.rating(70), req.rep(52),
          req.m('broadcast', 0.6, 'Broadcast centre'),
          req.m('security', 0.5, 'Security operation')],
    blurb: 'One night, two fighters, and a gate that arrives in the last four minutes of it.',
    legacy: 'staged an undisputed title fight',
  },
  {
    id: 'games_opening', name: 'Continental Games Opening Ceremony', short: 'Opening Ceremony',
    sport: 'ceremony', tier: 'world', format: 'showpiece', field: 'nations',
    // Nobody wins a ceremony. Without this it was scored like a match and the
    // report read "Ardenne 1 - Ironhold 0", which is not what happened.
    contested: false,
    matches: 1, spacing: 0, cycle: 4, window: [120, 210],
    rights: [2_200_000, 14_000_000], matchFee: 12_000_000, prestige: 48,
    trophy: 'the Games flame',
    organiser: 'Continental Games Committee',
    req: [req.field('athletics'), req.cap(62_000), req.rating(86), req.rep(82),
          req.m('broadcast', 0.8, 'Broadcast centre'),
          req.m('hospitality', 0.7, 'VIP hospitality'),
          req.m('media', 0.8, 'Media centre'),
          req.m('security', 0.7, 'Security operation'), req.parking(12_000)],
    blurb: 'Every four years, one stadium is the one everybody sees. This is the bid for it.',
    legacy: 'opened the Continental Games',
  },

  // ----------------------------------------------------------------- series
  {
    id: 'urn_series', name: 'The Meridian Urn', short: 'the Urn',
    sport: 'cricket', tier: 'international', format: 'series', field: 'nations',
    matches: 5, spacing: 11, cycle: 2, window: [20, 140],
    sides: ['na_meridia', 'na_kestrel'],
    rights: [260_000, 2_400_000], matchFee: 880_000, prestige: 30,
    trophy: 'the Urn', matchDays: 4,
    organiser: 'Meridian Cricket Board',
    req: [req.field('cricket'), req.cap(22_000), req.rating(72), req.rep(56),
          req.m('broadcast', 0.6, 'Broadcast centre'),
          req.m('hospitality', 0.45, 'VIP hospitality')],
    blurb: 'Five Tests across a summer. Whoever holds the Urn keeps it until they lose it.',
    legacy: 'staged the Urn series',
  },
  {
    id: 'autumn_tests', name: 'Autumn Test Series', short: 'Autumn Tests',
    sport: 'rugby', tier: 'international', format: 'series', field: 'nations',
    matches: 4, spacing: 7, cycle: 1, window: [230, 320],
    rights: [180_000, 1_500_000], matchFee: 1_150_000, prestige: 20,
    trophy: 'the Autumn Shield',
    organiser: 'Northern Rugby Alliance',
    req: [req.field('rugby'), req.cap(26_000), req.rating(70), req.rep(52),
          req.m('broadcast', 0.55, 'Broadcast centre'), req.m('medical', 0.6, 'Medical')],
    blurb: 'Four Saturdays, four touring sides, and a ground that has to drain.',
    legacy: 'staged the Autumn Tests',
  },
  {
    id: 'championship_series', name: 'Championship Finals Series', short: 'Finals Series',
    sport: 'basketball', tier: 'national', format: 'series', field: 'clubs',
    matches: 5, spacing: 3, cycle: 1, window: [200, 300],
    rights: [150_000, 1_300_000], matchFee: 760_000, prestige: 18,
    trophy: 'the Championship Trophy',
    organiser: 'National Basketball Conference',
    req: [req.field('basketball'), req.cap(14_000), req.rating(68), req.rep(48),
          req.m('broadcast', 0.5, 'Broadcast centre'),
          req.m('hospitality', 0.4, 'VIP hospitality')],
    blurb: 'Best of five on neutral boards. Two of them will go to the last possession.',
    legacy: 'staged the Finals Series',
  },
  {
    id: 'winter_classic', name: 'Winter Cup Finals', short: 'Winter Cup',
    sport: 'ice', tier: 'national', format: 'series', field: 'clubs',
    matches: 3, spacing: 4, cycle: 1, window: [300, 359],
    rights: [110_000, 900_000], matchFee: 560_000, prestige: 14,
    trophy: 'the Winter Cup',
    organiser: 'Ice Hockey Federation',
    req: [req.field('ice'), req.cap(11_000), req.rating(66), req.rep(44),
          req.m('broadcast', 0.45, 'Broadcast centre')],
    blurb: 'Three games for the Cup, on ice that has to hold for every one of them.',
    legacy: 'staged the Winter Cup finals',
  },
  {
    id: 'ocean_series', name: 'Trans-Ocean Series', short: 'Ocean Series',
    sport: 'cricket', tier: 'national', format: 'series', field: 'nations',
    matches: 3, spacing: 4, cycle: 1, window: [30, 150],
    sides: ['na_solano', 'na_coastal'],
    rights: [90_000, 780_000], matchFee: 540_000, prestige: 12,
    trophy: 'the Ocean Trophy', matchDays: 1,
    organiser: 'Meridian Cricket Board',
    req: [req.field('cricket'), req.cap(12_000), req.rating(60), req.rep(40),
          req.m('concession', 0.5, 'Food and beverage')],
    blurb: 'Three one-day matches under lights, and a crowd that stays for the fireworks.',
    legacy: 'staged the Ocean Series',
  },

  // ------------------------------------------------------------- tournaments
  {
    id: 'continental_cup', name: 'Continental Cup Finals', short: 'Continental Cup',
    sport: 'football', tier: 'international', format: 'tournament', field: 'nations',
    matches: 8, spacing: 3, cycle: 2, window: [90, 200],
    rights: [700_000, 5_400_000], matchFee: 1_450_000, prestige: 34,
    trophy: 'the Continental Cup',
    organiser: 'Continental Football Union',
    req: [req.field('football'), req.cap(42_000), req.rating(76), req.rep(64),
          req.m('broadcast', 0.65, 'Broadcast centre'),
          req.m('media', 0.6, 'Media centre'),
          req.m('restroom', 0.6, 'Restrooms'), req.parking(7_000)],
    blurb: 'Eight matches in a month: a group stage, two semi-finals and the final itself.',
    legacy: 'staged the Continental Cup finals',
  },
  {
    id: 'world_rules', name: 'World Rules Championship', short: 'World Rules',
    sport: 'afl', tier: 'international', format: 'tournament', field: 'nations',
    matches: 6, spacing: 4, cycle: 3, window: [150, 260],
    rights: [480_000, 3_900_000], matchFee: 1_250_000, prestige: 24,
    trophy: 'the World Rules Shield',
    organiser: 'International Rules Council',
    // Deliberately above the Grand Final's 40,000: a world championship that
    // could be staged at a smaller ground than the domestic final would read
    // to the player as the rankings being the wrong way round.
    req: [req.field('afl'), req.cap(42_000), req.rating(76), req.rep(62),
          req.m('broadcast', 0.6, 'Broadcast centre'), req.m('medical', 0.55, 'Medical')],
    blurb: 'Six sides who each play it slightly differently, on one very large oval.',
    legacy: 'staged the World Rules Championship',
  },
  {
    id: 'court_masters', name: 'Court Masters Finals', short: 'Court Masters',
    sport: 'tennis', tier: 'international', format: 'tournament', field: 'nations',
    matches: 7, spacing: 1, cycle: 1, window: [180, 300],
    rights: [220_000, 1_800_000], matchFee: 690_000, prestige: 20,
    trophy: 'the Masters Salver',
    organiser: 'World Tennis Tour',
    req: [req.field('tennis'), req.cap(12_000), req.rating(70), req.rep(50),
          req.m('hospitality', 0.55, 'VIP hospitality'),
          req.m('broadcast', 0.5, 'Broadcast centre')],
    blurb: 'Eight players, seven days, and a crowd that pays for every one of them.',
    legacy: 'staged the Court Masters',
  },
  {
    id: 'aquatics_worlds', name: 'World Aquatics Championships', short: 'Aquatics Worlds',
    sport: 'swimming', tier: 'world', format: 'tournament', field: 'nations',
    matches: 6, spacing: 1, cycle: 2, window: [120, 250],
    rights: [340_000, 2_700_000], matchFee: 1_080_000, prestige: 26,
    trophy: 'the Aquatics title',
    organiser: 'World Aquatics Association',
    req: [req.field('swimming'), req.cap(14_000), req.rating(76), req.rep(62),
          req.m('broadcast', 0.6, 'Broadcast centre'),
          req.m('medical', 0.5, 'Medical'), req.m('restroom', 0.55, 'Restrooms')],
    blurb: 'Six nights of finals, and a pool that has to be exactly right for all of them.',
    legacy: 'staged the Aquatics World Championships',
  },
  {
    id: 'athletics_worlds', name: 'World Athletics Championships', short: 'Athletics Worlds',
    sport: 'athletics', tier: 'world', format: 'tournament', field: 'nations',
    matches: 7, spacing: 1, cycle: 2, window: [150, 280],
    rights: [800_000, 6_200_000], matchFee: 2_300_000, prestige: 38,
    trophy: 'the World Championship',
    organiser: 'World Athletics Council',
    req: [req.field('athletics'), req.cap(48_000), req.rating(82), req.rep(72),
          req.m('broadcast', 0.7, 'Broadcast centre'),
          req.m('media', 0.7, 'Media centre'),
          req.m('hospitality', 0.55, 'VIP hospitality'), req.parking(9_000)],
    blurb: 'Seven evenings of finals. Whatever else the stadium does, it is judged on this.',
    legacy: 'staged the World Athletics Championships',
  },
  {
    id: 'esports_worlds_comp', name: 'Esports World Series', short: 'Esports Worlds',
    sport: 'esports', tier: 'international', format: 'tournament', field: 'nations',
    matches: 5, spacing: 2, cycle: 1, window: [60, 300],
    rights: [260_000, 2_100_000], matchFee: 900_000, prestige: 22,
    trophy: 'the World Series title',
    organiser: 'Global Esports League',
    req: [req.field('esports'), req.cap(16_000), req.rating(72), req.rep(54),
          req.m('broadcast', 0.7, 'Broadcast centre'), req.m('media', 0.5, 'Media centre')],
    blurb: 'Five days of it, sold out in an hour, and every seat filled by someone under 25.',
    legacy: 'staged the Esports World Series',
  },
  {
    id: 'track_worlds_comp', name: 'World Track Cycling Championships', short: 'Track Worlds',
    sport: 'cycling', tier: 'international', format: 'tournament', field: 'nations',
    matches: 5, spacing: 1, cycle: 2, window: [40, 180],
    rights: [190_000, 1_600_000], matchFee: 720_000, prestige: 20,
    trophy: 'the rainbow jersey',
    organiser: 'Global Cycling Federation',
    req: [req.field('cycling'), req.cap(14_000), req.rating(70), req.rep(52),
          req.m('broadcast', 0.55, 'Broadcast centre'), req.m('medical', 0.5, 'Medical')],
    blurb: 'Five nights on the boards, and a velodrome that finally gets the crowd it was built for.',
    legacy: 'staged the Track World Championships',
  },
  {
    id: 'beach_masters', name: 'Beach Masters Finals', short: 'Beach Masters',
    sport: 'beach', tier: 'national', format: 'tournament', field: 'nations',
    matches: 4, spacing: 1, cycle: 1, window: [60, 180],
    rights: [70_000, 620_000], matchFee: 340_000, prestige: 11,
    trophy: 'the Masters title',
    organiser: 'Coastal Sport Collective',
    req: [req.field('beach'), req.cap(7_000), req.rating(58), req.rep(38),
          req.m('concession', 0.55, 'Food and beverage')],
    blurb: 'Four days on a temporary stadium court, and half the crowd stays for the music.',
    legacy: 'staged the Beach Masters',
  },
  {
    id: 'netball_worlds', name: 'World Netball Cup', short: 'Netball Cup',
    sport: 'netball', tier: 'international', format: 'tournament', field: 'nations',
    matches: 6, spacing: 2, cycle: 3, window: [100, 250],
    rights: [140_000, 1_200_000], matchFee: 560_000, prestige: 17,
    trophy: 'the World Netball Cup',
    organiser: 'World Netball Council',
    req: [req.field('netball'), req.cap(12_000), req.rating(66), req.rep(46),
          req.m('broadcast', 0.5, 'Broadcast centre'), req.m('medical', 0.5, 'Medical')],
    blurb: 'Six matches, an arena that sells out for every one, and nobody outside it expects that.',
    legacy: 'staged the World Netball Cup',
  },
];

export const COMPETITION_BY_ID = new Map(COMPETITIONS.map((c) => [c.id, c]));

/** What each match in a competition is called, so a schedule reads properly. */
export function matchLabel(comp, index) {
  const n = comp.matches;
  if (comp.format === 'showpiece') return comp.short;
  if (comp.format === 'series') {
    const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'];
    const unit = comp.sport === 'cricket' ? 'Test' : comp.sport === 'rugby' ? 'Test' : 'Game';
    return `${ordinals[index] || `Game ${index + 1}`} ${unit}`;
  }
  // A tournament plays down: the last match is the final, the two before it
  // are the semi-finals, and everything earlier is the group stage.
  if (index === n - 1) return 'Final';
  if (n >= 4 && index >= n - 3) return `Semi-final ${index - (n - 3) + 1}`;
  if (n >= 6 && index >= n - 5) return `Quarter-final ${index - (n - 5) + 1}`;
  return `Group match ${index + 1}`;
}

/** How much bigger a crowd this match pulls than the competition's average. */
export function matchWeight(comp, index) {
  if (comp.format === 'showpiece') return 1.25;
  if (comp.format === 'series') {
    // A live series that reaches the last match is the biggest day of it.
    return index === comp.matches - 1 ? 1.12 : 0.94 + index * 0.02;
  }
  if (index === comp.matches - 1) return 1.3;
  if (index >= comp.matches - 3) return 1.08;
  return 0.85;
}
