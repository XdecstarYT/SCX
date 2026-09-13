/**
 * Representative sides.
 *
 * Clubs play leagues; these play each other. A Test series or a continental
 * final is contested by sides that do not have a home ground of their own,
 * which is exactly why the right to stage one is worth bidding for - somebody
 * has to lend them a stadium, and that somebody gets the gate.
 *
 * Every nation, side and trophy in this game is fictional.
 *
 * `strength` is the side's general standing; `sports` overrides it where a
 * side is famously better or worse at one game than at the rest, which is what
 * makes a series between two of them worth watching rather than a coin toss.
 */
export const NATIONS = [
  { id: 'na_meridia',  name: 'Meridia',            short: 'MER', colour: 0x1f4fa0, strength: 0.78, support: 0.88,
    sports: { cricket: 0.84, football: 0.72, rugby: 0.66, afl: 0.80 } },
  { id: 'na_nordhavn', name: 'Nordhavn',           short: 'NOR', colour: 0x4a5a7a, strength: 0.72, support: 0.70,
    sports: { ice: 0.88, football: 0.76, cricket: 0.44, handball: 0.82 } },
  { id: 'na_ardenne',  name: 'Ardenne',            short: 'ARD', colour: 0x2f7f4f, strength: 0.74, support: 0.74,
    sports: { rugby: 0.86, football: 0.70, cycling: 0.84, handball: 0.70 } },
  { id: 'na_solano',   name: 'Solano',             short: 'SOL', colour: 0xe0952f, strength: 0.70, support: 0.80,
    sports: { football: 0.84, beach: 0.88, volleyball: 0.80, athletics: 0.66 } },
  { id: 'na_kestrel',  name: 'the Kestrel Isles',  short: 'KES', colour: 0xc23a3a, strength: 0.69, support: 0.72,
    sports: { cricket: 0.80, rugby: 0.78, netball: 0.84, athletics: 0.62 } },
  { id: 'na_verdant',  name: 'the Verdant Republic', short: 'VER', colour: 0x357f3c, strength: 0.66, support: 0.64,
    sports: { athletics: 0.86, swimming: 0.78, cycling: 0.68, climbing: 0.80 } },
  { id: 'na_ironhold', name: 'Ironhold',           short: 'IRN', colour: 0x2a2d33, strength: 0.71, support: 0.66,
    sports: { combat: 0.86, rugby: 0.74, basketball: 0.70, esports: 0.66 } },
  { id: 'na_coastal',  name: 'the Coastal Union',  short: 'CST', colour: 0x2fb0d8, strength: 0.64, support: 0.68,
    sports: { swimming: 0.88, beach: 0.82, skate: 0.78, volleyball: 0.70 } },
  { id: 'na_saltmarch',name: 'Saltmarch',          short: 'SAL', colour: 0x5c6b4c, strength: 0.60, support: 0.56,
    sports: { cricket: 0.66, afl: 0.74, tennis: 0.70, baseball: 0.72 } },
  { id: 'na_highvale', name: 'Highvale',           short: 'HGV', colour: 0x7b4fd0, strength: 0.67, support: 0.62,
    sports: { basketball: 0.86, esports: 0.84, tennis: 0.76, skate: 0.72 } },
  { id: 'na_torrent',  name: 'Torrent',            short: 'TOR', colour: 0xb0273f, strength: 0.63, support: 0.60,
    sports: { baseball: 0.84, combat: 0.72, ice: 0.70, cycling: 0.66 } },
  { id: 'na_lowmoor',  name: 'Lowmoor',            short: 'LOW', colour: 0x8a6a44, strength: 0.58, support: 0.54,
    sports: { afl: 0.82, netball: 0.76, tennis: 0.62, climbing: 0.68 } },
];

export const NATION_BY_ID = new Map(NATIONS.map((n) => [n.id, n]));

/**
 * A side as it plays one sport. The shape matches a club deliberately, so the
 * same match engine, the same scoring models and the same fixture pricing run
 * for a Test match and for a Tuesday night league game.
 */
export function side(id, sport) {
  const n = NATION_BY_ID.get(id);
  if (!n) return null;
  return {
    id: n.id,
    name: n.name,
    short: n.short,
    colour: n.colour,
    sport,
    strength: n.sports?.[sport] ?? n.strength,
    support: n.support,
    representative: true,
  };
}

/** The sides that play a sport best, strongest first. Used to fill a draw. */
export function contendersFor(sport, count = 8) {
  return NATIONS
    .map((n) => side(n.id, sport))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, Math.max(2, count));
}
