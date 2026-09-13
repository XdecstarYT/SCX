/**
 * Resident clubs.
 *
 * Every event in the game until now was a one-off: you bid, you host, they
 * leave. A complex with no tenant is a conference centre with a pitch in it.
 * A club is the other half of the business - it arrives with a fixture list, a
 * support that turns up whether or not the match matters, and a league position
 * that makes next season's gate better or worse than this one's.
 *
 * Every club, league and colour here is fictional.
 */

/** League structure per sport: three divisions, top to bottom. */
export const DIVISIONS = [
  { level: 0, name: 'Premier Division', short: 'PRE', prize: 4_200_000, pull: 1.0 },
  { level: 1, name: 'First Division', short: 'D1', prize: 1_400_000, pull: 0.72 },
  { level: 2, name: 'Regional League', short: 'REG', prize: 420_000, pull: 0.48 },
];

/**
 * Clubs, eight per sport per ladder. `strength` drives results, `support`
 * drives how many of them turn up, and both drift across seasons.
 */
export const CLUBS = [
  // ---------------------------------------------------------------- football
  { id: 'fc_meridian',   name: 'Meridian City',        sport: 'football', level: 0, strength: 0.82, support: 0.88, colour: 0x1f4fa0 },
  { id: 'fc_kestrel',    name: 'Kestrel Bay Rovers',   sport: 'football', level: 0, strength: 0.74, support: 0.71, colour: 0xc23a3a },
  { id: 'fc_ardenne',    name: 'Ardenne Athletic',     sport: 'football', level: 0, strength: 0.69, support: 0.76, colour: 0x2f7f4f },
  { id: 'fc_solano',     name: 'Solano United',        sport: 'football', level: 0, strength: 0.64, support: 0.62, colour: 0xe0952f },
  { id: 'fc_nordhavn',   name: 'Nordhavn FC',          sport: 'football', level: 1, strength: 0.57, support: 0.54, colour: 0x4a5a7a },
  { id: 'fc_thornby',    name: 'Thornby Wanderers',    sport: 'football', level: 1, strength: 0.51, support: 0.48, colour: 0x7b4fd0 },
  { id: 'fc_calder',     name: 'Calder Vale',          sport: 'football', level: 1, strength: 0.46, support: 0.41, colour: 0xb0273f },
  { id: 'fc_hallow',     name: 'Hallow Park FC',       sport: 'football', level: 2, strength: 0.38, support: 0.33, colour: 0x3f7a45 },
  { id: 'fc_marden',     name: 'Marden Town',          sport: 'football', level: 2, strength: 0.33, support: 0.29, colour: 0x8a6a44 },

  // -------------------------------------------------------------- basketball
  { id: 'bb_apex',       name: 'Apex Falcons',         sport: 'basketball', level: 0, strength: 0.79, support: 0.74, colour: 0xe8ac2a },
  { id: 'bb_harbour',    name: 'Harbour Lights',       sport: 'basketball', level: 0, strength: 0.71, support: 0.64, colour: 0x2c6fd8 },
  { id: 'bb_foundry',    name: 'Foundry Steel',        sport: 'basketball', level: 1, strength: 0.58, support: 0.49, colour: 0x8d97a3 },
  { id: 'bb_verdant',    name: 'Verdant Pride',        sport: 'basketball', level: 1, strength: 0.49, support: 0.42, colour: 0x2f8f57 },
  { id: 'bb_quarry',     name: 'Quarry Hawks',         sport: 'basketball', level: 2, strength: 0.36, support: 0.28, colour: 0xa8604c },

  // ------------------------------------------------------------------ rugby
  { id: 'rg_ironside',   name: 'Ironside RFC',         sport: 'rugby', level: 0, strength: 0.8,  support: 0.7,  colour: 0x2a2d33 },
  { id: 'rg_westmoor',   name: 'Westmoor Bulls',       sport: 'rugby', level: 0, strength: 0.7,  support: 0.63, colour: 0x94503f },
  { id: 'rg_lantern',    name: 'Lantern Hill',         sport: 'rugby', level: 1, strength: 0.55, support: 0.46, colour: 0x4d7fbe },
  { id: 'rg_saltings',   name: 'The Saltings',         sport: 'rugby', level: 2, strength: 0.37, support: 0.3,  colour: 0x5c6b4c },

  // ---------------------------------------------------------------- cricket
  { id: 'ck_county',     name: 'Meridian County',      sport: 'cricket', level: 0, strength: 0.77, support: 0.6,  colour: 0x1f4fa0 },
  { id: 'ck_orchard',    name: 'Orchard CC',           sport: 'cricket', level: 0, strength: 0.66, support: 0.5,  colour: 0x357f3c },
  { id: 'ck_willow',     name: 'Willowbank',           sport: 'cricket', level: 1, strength: 0.5,  support: 0.38, colour: 0xc9b083 },
  { id: 'ck_downs',      name: 'The Downs XI',         sport: 'cricket', level: 2, strength: 0.34, support: 0.26, colour: 0x8b8b86 },

  // -------------------------------------------------------------------- ice
  { id: 'ic_glacier',    name: 'Glacier Kings',        sport: 'ice', level: 0, strength: 0.78, support: 0.68, colour: 0x9fdcef },
  { id: 'ic_forge',      name: 'Forge City Blades',    sport: 'ice', level: 0, strength: 0.68, support: 0.58, colour: 0xb5443f },
  { id: 'ic_northgate',  name: 'Northgate Frost',      sport: 'ice', level: 1, strength: 0.52, support: 0.43, colour: 0x4a5470 },

  // ------------------------------------------------------------------- afl
  { id: 'af_southern',   name: 'Southern Kites',       sport: 'afl', level: 0, strength: 0.76, support: 0.72, colour: 0x49a83f },
  { id: 'af_redgum',     name: 'Redgum Rules Club',    sport: 'afl', level: 0, strength: 0.67, support: 0.6,  colour: 0xa04a4a },
  { id: 'af_brightwell', name: 'Brightwell',           sport: 'afl', level: 1, strength: 0.5,  support: 0.44, colour: 0xd8b13a },

  // ---------------------------------------------------------------- baseball
  { id: 'bs_pioneers',   name: 'Meridian Pioneers',    sport: 'baseball', level: 0, strength: 0.75, support: 0.66, colour: 0xc23a3a },
  { id: 'bs_dockers',    name: 'Dockyard Nine',        sport: 'baseball', level: 0, strength: 0.64, support: 0.55, colour: 0x2f7fb5 },
  { id: 'bs_prairie',    name: 'Prairie Jacks',        sport: 'baseball', level: 1, strength: 0.48, support: 0.4,  colour: 0xb08a5e },

  // ------------------------------------------------------------- volleyball
  { id: 'vb_summit',     name: 'Summit Spikers',       sport: 'volleyball', level: 0, strength: 0.74, support: 0.52, colour: 0xe0a94f },
  { id: 'vb_tidal',      name: 'Tidal VC',             sport: 'volleyball', level: 0, strength: 0.65, support: 0.45, colour: 0x2f8f9f },
  { id: 'vb_lantern',    name: 'Lantern Court',        sport: 'volleyball', level: 1, strength: 0.5,  support: 0.34, colour: 0x7b4fd0 },

  // ---------------------------------------------------------------- netball
  { id: 'nb_comets',     name: 'Coastal Comets',       sport: 'netball', level: 0, strength: 0.76, support: 0.6,  colour: 0x63b6d8 },
  { id: 'nb_thistle',    name: 'Thistle Netball',      sport: 'netball', level: 0, strength: 0.66, support: 0.51, colour: 0x9a6bf0 },
  { id: 'nb_kestrels',   name: 'Kestrel Netball',      sport: 'netball', level: 1, strength: 0.52, support: 0.4,  colour: 0xc23a3a },

  // --------------------------------------------------------------- handball
  { id: 'hb_foundry',    name: 'Foundry Handball',     sport: 'handball', level: 0, strength: 0.72, support: 0.48, colour: 0x5f8fd0 },
  { id: 'hb_northgate',  name: 'Northgate HC',         sport: 'handball', level: 0, strength: 0.63, support: 0.41, colour: 0x4a5a7a },
  { id: 'hb_marsh',      name: 'Marshfield',           sport: 'handball', level: 1, strength: 0.47, support: 0.31, colour: 0x3f7a45 },

  // ---------------------------------------------------------------- cycling
  { id: 'cy_meridian',   name: 'Meridian Track Team',  sport: 'cycling', level: 0, strength: 0.78, support: 0.5,  colour: 0xd08a4a },
  { id: 'cy_velo',       name: 'Velo Nord',            sport: 'cycling', level: 0, strength: 0.68, support: 0.43, colour: 0x2b3038 },
  { id: 'cy_ardenne',    name: 'Ardenne Wheelers',     sport: 'cycling', level: 1, strength: 0.53, support: 0.35, colour: 0x49a83f },
];

export const CLUB_BY_ID = new Map(CLUBS.map((c) => [c.id, c]));

/** Sports that have a league at all. */
export const LEAGUE_SPORTS = [...new Set(CLUBS.map((c) => c.sport))];

export function clubsInLeague(sport, level) {
  return CLUBS.filter((c) => c.sport === sport && c.level === level);
}

export function division(level) {
  return DIVISIONS[Math.max(0, Math.min(DIVISIONS.length - 1, level))];
}

/**
 * What a club needs from a ground before it will move in. A Premier Division
 * side is not going to play in front of four thousand people, and a regional
 * club cannot fill - or afford - a sixty-thousand-seat bowl.
 */
export function tenancyRequirements(club) {
  const d = division(club.level);
  return {
    minCapacity: Math.round(2_500 + club.support * 44_000 * d.pull),
    maxCapacity: Math.round(18_000 + club.support * 150_000),
    minRating: Math.round(22 + d.pull * 46),
  };
}

/**
 * The money. Rent is guaranteed and paid up front each season; the gate share
 * is what the club keeps of the ticket revenue on its own matchdays, so a big
 * name costs you more of the door but brings far more of it.
 */
export function tenancyTerms(club) {
  const d = division(club.level);
  const pull = d.pull * (0.6 + club.support * 0.8);
  return {
    rentPerSeason: Math.round(900_000 * pull + club.support * 1_800_000 * d.pull),
    gateShare: +(0.18 + d.pull * 0.22).toFixed(2),
    homeFixtures: club.sport === 'cricket' ? 9 : club.sport === 'baseball' ? 18 : 13,
  };
}
