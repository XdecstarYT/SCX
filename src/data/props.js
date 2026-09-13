/**
 * Sports equipment registry.
 *
 * A voxel is one flat colour, so a *rotated* voxel looks identical to an
 * unrotated one. Rotation only means something for objects with a front and a
 * back — goal posts, hoops, dugouts, scoreboards. So orientation lives here,
 * on props, rather than on blocks, which is also how a real voxel game does it.
 *
 * Geometry is a box kit: each part is
 *   [x, y, z, w, h, d, colour, emissive?]
 * in METRES, measured from the centre of the anchor cell at its floor. That
 * puts the rotation pivot exactly on a grid cell centre, so a 90-degree turn
 * maps integer cell offsets to integer cell offsets with no drift.
 *
 * Fields:
 *   foot        {w, d} footprint in blocks (before rotation)
 *   provides    what the venue analyser counts this as
 *   needs       sport zone this belongs to, for the "wrong pitch" warning
 *   cost        construction cost for one
 *   maintenance upkeep weight (scaled by MAINTENANCE_RATE like blocks)
 *   power       MW drawn
 *   appearance  decoration credit toward the appearance rating
 *   revenue     passive revenue per month
 *   unlock      research id required, null = available from the start
 */

const WHITE = 0xeef1f4;
const NET = 0xc8d0d8;
const PAD = 0x2b3038;
const STEEL = 0x8d97a3;
const WOOD = 0x8a6a44;
const RIM = 0xd9762a;
const GLASSY = 0xdfe9f0;
const TURFDARK = 0x2b6b33;

/**
 * What each of those materials is made of, for the shader.
 *
 * Equipment was drawn in flat colour while the stadium around it had grain,
 * coursing and ribs, which made a goal frame read as plastic beside a brick
 * wall. Keying the finish off the colour constant means every prop already
 * authored gets its material without any of them being edited.
 */
export const PART_FINISH = {
  [NET]: 'mesh',
  [STEEL]: 'metal',
  [RIM]: 'metal',
  [WOOD]: 'timber',
  [GLASSY]: 'gloss',
  [TURFDARK]: 'turf',
  [WHITE]: 'matte',
  [PAD]: 'matte',
};

export const PROPS = [
  // ------------------------------------------------------------- football
  {
    key: 'goal_soccer', name: 'Soccer Goal', sport: 'football', group: 'football',
    foot: { w: 5, d: 2 }, provides: 'goal', needs: ['pitch_football'], pairs: 2,
    cost: 14_000, maintenance: 6, appearance: 2,
    hint: 'A regulation 7.3m goal. A soccer pitch needs one at each end.',
    parts: [
      [-3.66, 1.22, 0, 0.24, 2.44, 0.24, WHITE],
      [3.66, 1.22, 0, 0.24, 2.44, 0.24, WHITE],
      [0, 2.44, 0, 7.56, 0.24, 0.24, WHITE],
      [0, 1.3, -0.95, 7.32, 2.5, 0.08, NET],
      [-3.66, 1.3, -0.5, 0.08, 2.5, 1.0, NET],
      [3.66, 1.3, -0.5, 0.08, 2.5, 1.0, NET],
      [0, 0.06, -0.5, 7.32, 0.12, 1.0, NET],
    ],
  },
  {
    key: 'goal_afl', name: 'AFL Goal Posts', sport: 'afl', group: 'football',
    foot: { w: 10, d: 1 }, provides: 'goal', needs: ['pitch_afl', 'pitch_cricket'], pairs: 2,
    cost: 22_000, maintenance: 8, appearance: 3,
    hint: 'Two 9m goal posts with a behind post either side, as the code requires.',
    parts: [
      [-3.2, 4.6, 0, 0.3, 9.2, 0.3, WHITE],
      [3.2, 4.6, 0, 0.3, 9.2, 0.3, WHITE],
      [-9.6, 2.6, 0, 0.26, 5.2, 0.26, WHITE],
      [9.6, 2.6, 0, 0.26, 5.2, 0.26, WHITE],
      [-3.2, 0.35, 0, 0.5, 0.7, 0.5, PAD],
      [3.2, 0.35, 0, 0.5, 0.7, 0.5, PAD],
    ],
  },
  {
    key: 'goal_rugby', name: 'Rugby Posts', sport: 'rugby', group: 'football',
    foot: { w: 4, d: 1 }, provides: 'goal', needs: ['pitch_rugby', 'pitch_football'], pairs: 2,
    cost: 19_000, maintenance: 7, appearance: 3,
    hint: 'An H frame with the crossbar at 3m and 8m uprights.',
    parts: [
      [-2.8, 4.2, 0, 0.28, 8.4, 0.28, WHITE],
      [2.8, 4.2, 0, 0.28, 8.4, 0.28, WHITE],
      [0, 3.0, 0, 5.9, 0.28, 0.28, WHITE],
      [-2.8, 1.0, 0, 0.5, 2.0, 0.5, PAD],
      [2.8, 1.0, 0, 0.5, 2.0, 0.5, PAD],
    ],
  },
  {
    key: 'corner_flag', color: 0xd8b13a, name: 'Corner Flag', sport: 'football', group: 'football',
    foot: { w: 1, d: 1 }, provides: 'flag', needs: null, pairs: 4,
    cost: 900, maintenance: 0.6, appearance: 1,
    hint: 'One at each corner of the pitch. Small, but every ground has them.',
    parts: [
      [0, 0.85, 0, 0.09, 1.7, 0.09, WHITE],
      [0.26, 1.5, 0, 0.44, 0.3, 0.04, 0xd8b13a],
    ],
  },

  // ----------------------------------------------------------- basketball
  {
    key: 'hoop_basketball', color: 0xd9762a, name: 'Basketball Hoop', sport: 'basketball', group: 'indoor',
    foot: { w: 2, d: 2 }, provides: 'hoop', needs: ['court_basketball'], pairs: 2,
    cost: 26_000, maintenance: 9, appearance: 3,
    hint: 'Backboard, rim and stanchion. A court needs one at each end.',
    parts: [
      [0, 1.3, -1.5, 0.5, 2.6, 0.5, PAD],
      [0, 3.6, -1.1, 0.3, 0.3, 1.0, STEEL],
      [0, 3.45, -0.6, 1.8, 1.05, 0.12, GLASSY],
      [0, 3.05, -0.5, 0.9, 0.08, 0.08, RIM],
      [-0.42, 3.05, -0.26, 0.08, 0.08, 0.52, RIM],
      [0.42, 3.05, -0.26, 0.08, 0.08, 0.52, RIM],
      [0, 2.85, -0.26, 0.86, 0.36, 0.5, NET],
      [0, 0.12, -1.5, 1.6, 0.24, 1.4, PAD],
    ],
  },
  {
    key: 'net_volley', name: 'Volleyball Net', sport: 'volleyball', group: 'indoor',
    foot: { w: 6, d: 1 }, provides: 'net', needs: ['court_basketball'], pairs: 1,
    cost: 4_200, maintenance: 2, appearance: 1,
    hint: 'Turns a hardwood court over to volleyball between fixtures.',
    parts: [
      [-4.6, 1.2, 0, 0.14, 2.4, 0.14, STEEL],
      [4.6, 1.2, 0, 0.14, 2.4, 0.14, STEEL],
      [0, 1.85, 0, 9.2, 1.0, 0.06, NET],
    ],
  },

  // --------------------------------------------------------------- tennis
  {
    key: 'net_tennis', name: 'Tennis Net', sport: 'tennis', group: 'racquet',
    foot: { w: 7, d: 1 }, provides: 'net', needs: ['court_tennis'], pairs: 1,
    cost: 5_400, maintenance: 2.4, appearance: 1,
    hint: 'A 12.8m net that dips to 0.91m in the middle. One per court.',
    parts: [
      [-6.4, 0.53, 0, 0.14, 1.07, 0.14, PAD],
      [6.4, 0.53, 0, 0.14, 1.07, 0.14, PAD],
      [-3.2, 0.5, 0, 6.4, 1.0, 0.06, NET],
      [3.2, 0.5, 0, 6.4, 1.0, 0.06, NET],
      [0, 0.46, 0, 0.2, 0.92, 0.1, WHITE],
      [0, 0.98, 0, 12.8, 0.1, 0.08, WHITE],
    ],
  },

  // -------------------------------------------------------------- cricket
  {
    key: 'stumps_cricket', color: 0x8a6a44, name: 'Cricket Stumps', sport: 'cricket', group: 'bat',
    foot: { w: 1, d: 1 }, provides: 'stumps', needs: ['pitch_cricket'], pairs: 2,
    cost: 1_600, maintenance: 1.2, appearance: 1,
    hint: 'A set of three stumps and bails. A wicket needs a set at each end.',
    parts: [
      [-0.11, 0.36, 0, 0.07, 0.72, 0.07, WOOD],
      [0, 0.36, 0, 0.07, 0.72, 0.07, WOOD],
      [0.11, 0.36, 0, 0.07, 0.72, 0.07, WOOD],
      [-0.055, 0.75, 0, 0.13, 0.04, 0.04, 0xd8cba0],
      [0.055, 0.75, 0, 0.13, 0.04, 0.04, 0xd8cba0],
      [0, 0.01, 0, 2.4, 0.02, 0.12, WHITE],
    ],
  },
  {
    key: 'sightscreen', name: 'Sight Screen', sport: 'cricket', group: 'bat',
    foot: { w: 5, d: 1 }, provides: 'sightscreen', needs: null, pairs: 2,
    cost: 12_000, maintenance: 4, appearance: 2,
    hint: 'The white screen behind the bowler. Required at both ends for a first-class ground.',
    parts: [
      [0, 2.4, 0, 9.0, 4.4, 0.2, 0xf3f5f7],
      [-4.2, 1.1, 0.4, 0.3, 2.2, 0.3, STEEL],
      [4.2, 1.1, 0.4, 0.3, 2.2, 0.3, STEEL],
    ],
  },

  // -------------------------------------------------------------- aquatic
  {
    key: 'starting_block', name: 'Starting Block', sport: 'swimming', group: 'aquatic',
    foot: { w: 1, d: 1 }, provides: 'startblock', needs: ['pool_swimming'], pairs: 6,
    cost: 3_400, maintenance: 1.6, appearance: 1,
    hint: 'One per lane at the shallow end. Six lanes need six blocks.',
    parts: [
      [0, 0.32, 0, 0.7, 0.64, 0.7, WHITE],
      [0, 0.68, -0.08, 0.72, 0.08, 0.84, 0x3a4048],
      [0, 0.5, 0.42, 0.16, 0.5, 0.16, STEEL],
    ],
  },
  {
    key: 'lane_rope', name: 'Pool Lane Rope', sport: 'swimming', group: 'aquatic',
    foot: { w: 13, d: 1 }, provides: 'lanerope', needs: ['pool_swimming'], pairs: 5,
    cost: 2_800, maintenance: 1.2, appearance: 1,
    hint: 'Divides the lanes. A 25m pool needs one between each pair of lanes.',
    parts: [
      [-10, 0.12, 0, 5.0, 0.22, 0.22, 0xd8443f],
      [-5, 0.12, 0, 5.0, 0.22, 0.22, 0xf0f2f4],
      [0, 0.12, 0, 5.0, 0.22, 0.22, 0x2f6fd0],
      [5, 0.12, 0, 5.0, 0.22, 0.22, 0xf0f2f4],
      [10, 0.12, 0, 5.0, 0.22, 0.22, 0xd8443f],
    ],
  },

  // ------------------------------------------------------------ athletics
  {
    key: 'lane_marker', name: 'Track Lane Markings', sport: 'athletics', group: 'aquatic',
    foot: { w: 10, d: 4 }, provides: 'lanemark', needs: ['track_athletics'], pairs: 2,
    cost: 6_200, maintenance: 2.2, appearance: 2,
    hint: 'Painted lane lines and a finish line. Lay a couple along the straights.',
    parts: [
      [0, 0.02, -3.0, 20, 0.04, 0.12, WHITE],
      [0, 0.02, -1.5, 20, 0.04, 0.12, WHITE],
      [0, 0.02, 0, 20, 0.04, 0.12, WHITE],
      [0, 0.02, 1.5, 20, 0.04, 0.12, WHITE],
      [0, 0.02, 3.0, 20, 0.04, 0.12, WHITE],
      [-9.6, 0.03, 0, 0.3, 0.05, 7.4, WHITE],
    ],
  },
  {
    key: 'hurdle_set', name: 'Hurdle Set', sport: 'athletics', group: 'aquatic',
    foot: { w: 5, d: 1 }, provides: 'hurdles', needs: ['track_athletics'], pairs: 1,
    cost: 2_400, maintenance: 1.0, appearance: 1,
    hint: 'A row of hurdles across the sprint lanes.',
    parts: [
      [-3.6, 0.53, 0, 0.9, 0.08, 0.1, WHITE],
      [-1.2, 0.53, 0, 0.9, 0.08, 0.1, WHITE],
      [1.2, 0.53, 0, 0.9, 0.08, 0.1, WHITE],
      [3.6, 0.53, 0, 0.9, 0.08, 0.1, WHITE],
      [-3.6, 0.26, 0, 0.06, 0.52, 0.5, STEEL],
      [-1.2, 0.26, 0, 0.06, 0.52, 0.5, STEEL],
      [1.2, 0.26, 0, 0.06, 0.52, 0.5, STEEL],
      [3.6, 0.26, 0, 0.06, 0.52, 0.5, STEEL],
    ],
  },

  // ----------------------------------------------------- shared match-day
  {
    key: 'dugout', name: 'Player Bench', sport: null, group: 'matchday',
    foot: { w: 4, d: 2 }, provides: 'bench', needs: null, pairs: 2,
    cost: 32_000, maintenance: 12, appearance: 3,
    hint: 'A covered bench for substitutes. Every sport wants one on each side.',
    parts: [
      [0, 1.3, -1.4, 8.0, 0.24, 2.6, 0x3a4048],
      [-3.9, 0.65, -1.4, 0.22, 1.3, 2.6, PAD],
      [3.9, 0.65, -1.4, 0.22, 1.3, 2.6, PAD],
      [0, 0.7, -2.6, 8.0, 1.4, 0.2, 0x4a525c],
      [0, 0.5, -1.5, 7.4, 0.16, 0.7, WOOD],
      [0, 0.25, -1.5, 7.4, 0.5, 0.12, WOOD],
    ],
  },
  {
    key: 'coach_box', name: 'Coaches Box', sport: null, group: 'matchday',
    foot: { w: 2, d: 2 }, provides: 'coachbox', needs: null, pairs: 2,
    cost: 24_000, maintenance: 9, appearance: 3,
    hint: 'A raised box with a clear view of the whole field.',
    parts: [
      [0, 1.2, 0, 0.4, 2.4, 0.4, STEEL],
      [-1.2, 1.2, 0, 0.4, 2.4, 0.4, STEEL],
      [1.2, 1.2, 0, 0.4, 2.4, 0.4, STEEL],
      [0, 2.55, 0, 3.4, 0.3, 3.0, 0x4a525c],
      [0, 3.3, -1.4, 3.4, 1.5, 0.16, GLASSY],
      [-1.6, 3.3, 0, 0.16, 1.5, 3.0, 0x4a525c],
      [1.6, 3.3, 0, 0.16, 1.5, 3.0, 0x4a525c],
      [0, 4.15, 0, 3.6, 0.2, 3.2, 0x5b6672],
    ],
  },
  {
    key: 'scoreboard_sm', name: 'Scoreboard', sport: null, group: 'matchday',
    foot: { w: 4, d: 1 }, provides: 'scoreboard', needs: null, pairs: 1,
    cost: 120_000, maintenance: 22, power: 0.06, appearance: 6, revenue: 900,
    hint: 'Shows the score and the clock. Fans notice when there is not one.',
    parts: [
      [-2.4, 2.4, 0, 0.4, 4.8, 0.4, STEEL],
      [2.4, 2.4, 0, 0.4, 4.8, 0.4, STEEL],
      [0, 6.2, 0, 6.4, 3.6, 0.5, 0x14202e],
      [0, 6.2, -0.3, 5.8, 3.0, 0.06, 0x2c6fd8, 1],
      [0, 8.2, 0, 6.8, 0.4, 0.7, 0x3a4048],
    ],
  },
  {
    key: 'scoreboard_lg', name: 'Big Screen', sport: null, group: 'matchday',
    foot: { w: 7, d: 2 }, provides: 'scoreboard', needs: null, pairs: 1,
    cost: 640_000, maintenance: 70, power: 0.22, appearance: 12, revenue: 4_200,
    unlock: 'broadcast',
    hint: 'A broadcast-grade video wall. Raises prestige and sponsor value.',
    parts: [
      [-5.2, 4.0, 1.0, 0.7, 8.0, 0.7, STEEL],
      [5.2, 4.0, 1.0, 0.7, 8.0, 0.7, STEEL],
      [0, 4.0, 1.0, 11.0, 0.5, 0.5, STEEL],
      [0, 11.4, 0, 13.0, 7.4, 0.9, 0x14202e],
      [0, 11.4, -0.5, 12.2, 6.6, 0.08, 0x2c6fd8, 1],
      [0, 15.4, 0.2, 13.4, 0.6, 1.3, 0x3a4048],
    ],
  },
  {
    key: 'bench_crowd', name: 'Spectator Bench', sport: null, group: 'matchday',
    foot: { w: 3, d: 1 }, provides: 'seatbench', needs: null, pairs: 1,
    cost: 3_800, maintenance: 1.4, appearance: 2,
    hint: 'Simple bench seating for a training ground or a park pitch.',
    parts: [
      [0, 0.44, 0, 5.6, 0.14, 0.6, WOOD],
      [0, 0.78, -0.32, 5.6, 0.7, 0.12, WOOD],
      [-2.4, 0.22, 0, 0.16, 0.44, 0.6, STEEL],
      [2.4, 0.22, 0, 0.16, 0.44, 0.6, STEEL],
    ],
  },
  {
    key: 'goal_practice', color: 0x2f6b39, name: 'Practice Net', sport: null, group: 'matchday',
    foot: { w: 4, d: 3 }, provides: 'practice', needs: null, pairs: 1,
    cost: 9_500, maintenance: 3.5, appearance: 1,
    hint: 'A netted practice cage for the training ground.',
    parts: [
      [0, 2.0, -2.4, 8.0, 4.0, 0.1, NET],
      [-3.9, 2.0, -1.0, 0.1, 4.0, 3.0, NET],
      [3.9, 2.0, -1.0, 0.1, 4.0, 3.0, NET],
      [0, 4.0, -1.0, 8.0, 0.1, 3.0, NET],
      [-3.9, 2.0, -2.4, 0.24, 4.0, 0.24, STEEL],
      [3.9, 2.0, -2.4, 0.24, 4.0, 0.24, STEEL],
      [0, 0.4, 0.6, 7.2, 0.8, 0.3, TURFDARK],
    ],
  },
  // --------------------------------------------------------------------------
  // Appended. A prop id is written into every saved world, so nothing above
  // this line ever moves.
  // --------------------------------------------------------------------------
  {
    key: 'post_netball', name: 'Netball Post', sport: 'netball', group: 'indoor',
    foot: { w: 1, d: 1 }, provides: 'hoop', needs: ['court_netball'], pairs: 2,
    cost: 2_600, maintenance: 1.4, appearance: 1,
    hint: 'A ring on a pole at each end. No backboard - that is the difference.',
    parts: [
      [0, 1.6, 0, 0.12, 3.2, 0.12, STEEL],
      [0, 3.05, 0.2, 0.38, 0.06, 0.38, RIM],
      [0, 2.85, 0.2, 0.34, 0.4, 0.34, NET],
    ],
  },
  {
    key: 'goal_handball', name: 'Handball Goal', sport: 'handball', group: 'indoor',
    foot: { w: 3, d: 1 }, provides: 'goal', needs: ['court_handball'], pairs: 2,
    cost: 3_100, maintenance: 1.6,
    hint: 'Three metres by two, padded posts, at each end of the court.',
    parts: [
      [-1.5, 1.0, 0, 0.1, 2.0, 0.1, WHITE],
      [1.5, 1.0, 0, 0.1, 2.0, 0.1, WHITE],
      [0, 2.0, 0, 3.1, 0.1, 0.1, WHITE],
      [0, 1.0, -0.5, 3.0, 2.0, 0.05, NET],
    ],
  },
  {
    key: 'net_beach', name: 'Beach Net', sport: 'beach', group: 'outdoor',
    foot: { w: 5, d: 1 }, provides: 'net', needs: ['court_beach'], pairs: 1,
    cost: 1_900, maintenance: 1.2,
    hint: 'Two poles and a net, over sand.',
    parts: [
      [-4.2, 1.3, 0, 0.12, 2.6, 0.12, WOOD],
      [4.2, 1.3, 0, 0.12, 2.6, 0.12, WOOD],
      [0, 2.0, 0, 8.4, 1.0, 0.05, NET],
    ],
  },
  {
    key: 'holds_climb', name: 'Climbing Holds', sport: 'climbing', group: 'indoor',
    foot: { w: 2, d: 1 }, provides: 'holds', needs: ['wall_climb'], pairs: 4,
    cost: 2_200, maintenance: 2.0, appearance: 2,
    hint: 'A route up the wall. Four sets makes a competition face.',
    parts: [
      [0, 3.0, 0, 3.6, 6.0, 0.3, PAD],
      [-0.8, 1.4, 0.28, 0.3, 0.22, 0.3, RIM],
      [0.7, 2.6, 0.28, 0.28, 0.2, 0.28, 0x3f8fd0],
      [-0.4, 3.9, 0.28, 0.26, 0.2, 0.26, 0x49c58a],
      [0.6, 5.1, 0.28, 0.3, 0.22, 0.3, 0xe0a94f],
    ],
  },
  {
    key: 'ramp_skate', name: 'Quarter Pipe', sport: 'skate', group: 'outdoor',
    foot: { w: 5, d: 3 }, provides: 'ramp', needs: ['park_skate'], pairs: 2,
    cost: 3_400, maintenance: 2.2, appearance: 2,
    hint: 'A transition to drop in on. A park needs at least a couple.',
    parts: [
      [0, 0.6, -1.0, 5.0, 1.2, 2.0, GLASSY],
      [0, 1.4, -1.8, 5.0, 0.5, 0.5, STEEL],
      [0, 0.08, 0.6, 5.0, 0.16, 1.6, PAD],
    ],
  },
  {
    key: 'gate_start', name: 'Start Gate', sport: 'cycling', group: 'outdoor',
    foot: { w: 3, d: 1 }, provides: 'startgate', needs: ['track_cycling'], pairs: 1,
    cost: 5_600, maintenance: 2.6, power: 0.002,
    hint: 'Holds the riders and releases them together.',
    parts: [
      [-1.4, 0.9, 0, 0.14, 1.8, 0.14, STEEL],
      [1.4, 0.9, 0, 0.14, 1.8, 0.14, STEEL],
      [0, 1.75, 0, 3.0, 0.14, 0.5, 0xd04a4a],
      [0, 0.5, 0.3, 2.8, 0.9, 0.08, NET],
    ],
  },
  {
    key: 'timing_tower', name: 'Timing Tower', sport: 'cycling', group: 'outdoor',
    foot: { w: 3, d: 3 }, provides: 'timing', pairs: 1,
    cost: 8_800, maintenance: 4.0, power: 0.006, appearance: 3,
    hint: 'Officials, clocks and the photo finish. Any timed sport wants one.',
    parts: [
      [0, 2.2, 0, 2.6, 4.4, 2.6, WHITE],
      [0, 4.6, 0, 3.2, 0.3, 3.2, PAD],
      [0, 3.4, 1.35, 2.2, 1.2, 0.1, GLASSY],
    ],
  },
  {
    key: 'podium', name: 'Medal Podium', sport: null, group: 'outdoor',
    foot: { w: 3, d: 2 }, provides: 'podium', pairs: 1,
    cost: 1_600, maintenance: 1.0, appearance: 4,
    hint: 'Somewhere to stand at the end. Every ceremony wants one.',
    parts: [
      [0, 0.45, 0, 1.1, 0.9, 1.1, WHITE],
      [-1.2, 0.3, 0, 1.1, 0.6, 1.1, 0xd8d2c0],
      [1.2, 0.22, 0, 1.1, 0.44, 1.1, 0xc79a5c],
    ],
  },
  {
    key: 'camera_platform', name: 'Camera Platform', sport: null, group: 'outdoor',
    foot: { w: 2, d: 2 }, provides: 'camera', pairs: 2,
    cost: 4_200, maintenance: 2.4, power: 0.003, appearance: 1,
    hint: 'Broadcast needs somewhere to put the cameras.',
    parts: [
      [0, 1.6, 0, 0.2, 3.2, 0.2, STEEL],
      [0, 3.3, 0, 1.8, 0.2, 1.8, PAD],
      [0, 3.8, 0, 0.5, 0.7, 0.9, 0x23262b],
    ],
  },
  {
    key: 'water_station', name: 'Water Station', sport: null, group: 'outdoor',
    foot: { w: 1, d: 1 }, provides: 'water', pairs: 2,
    cost: 620, maintenance: 1.4, appearance: 1,
    hint: 'Somewhere for a crowd to fill a bottle.',
    parts: [
      [0, 0.5, 0, 0.7, 1.0, 0.5, STEEL],
      [0, 1.05, 0, 0.8, 0.12, 0.6, GLASSY],
    ],
  },
  {
    key: 'bike_rack', name: 'Bike Rack', sport: null, group: 'outdoor',
    foot: { w: 3, d: 1 }, provides: 'bikerack', pairs: 2,
    cost: 480, maintenance: 0.8, appearance: 1,
    hint: 'A crowd that cycles in is a crowd that does not park.',
    parts: [
      [-1.0, 0.45, 0, 0.08, 0.9, 0.7, STEEL],
      [0, 0.45, 0, 0.08, 0.9, 0.7, STEEL],
      [1.0, 0.45, 0, 0.08, 0.9, 0.7, STEEL],
    ],
  },
];

// --------------------------------------------------------------------------

export const PROP_BY_ID = [null];
export const PROP_BY_KEY = new Map();

PROPS.forEach((p, i) => {
  const rec = {
    id: i + 1,
    sport: null,
    needs: null,
    pairs: 1,
    cost: 0,
    maintenance: 0,
    power: 0,
    appearance: 0,
    revenue: 0,
    unlock: null,
    hint: '',
    ...p,
    isProp: true,
  };
  // Props sit alongside blocks in the palette, so they need the same shape as
  // a block: one swatch colour. Default to the colour of the biggest piece,
  // which is what the eye reads the object as from a distance.
  rec.color = p.color ?? biggestPartColour(rec.parts);
  rec.height = Math.max(...rec.parts.map((q) => q[1] + q[3 + 1] / 2));
  PROP_BY_ID.push(rec);
  PROP_BY_KEY.set(rec.key, rec);
});

/** Colour of the part with the greatest volume. */
function biggestPartColour(parts) {
  let best = parts[0], bestV = -1;
  for (const q of parts) {
    const v = q[3] * q[4] * q[5];
    if (v > bestV) { bestV = v; best = q; }
  }
  return best[6];
}

export function prop(idOrKey) {
  if (typeof idOrKey === 'number') return PROP_BY_ID[idOrKey] || null;
  return PROP_BY_KEY.get(idOrKey) || null;
}

export function propId(key) {
  const p = PROP_BY_KEY.get(key);
  return p ? p.id : 0;
}

export const PROP_GROUPS = [
  { key: 'football', name: 'Goals & Posts' },
  { key: 'indoor', name: 'Court' },
  { key: 'racquet', name: 'Racquet' },
  { key: 'bat', name: 'Cricket' },
  { key: 'aquatic', name: 'Pool & Track' },
  { key: 'matchday', name: 'Match Day' },

];

export function propsInGroup(g) {
  return PROPS.map((p) => PROP_BY_KEY.get(p.key)).filter((p) => p.group === g);
}

/**
 * What each sport expects to see on the field before the analyser will call it
 * properly equipped. `need` is how many of that item a complete venue has.
 *
 * This is deliberately a bonus rather than a gate: complexes built before
 * equipment existed keep working exactly as they did, and fitting them out
 * raises the functionality score instead of being punished for its absence.
 */
export const SPORT_EQUIPMENT = {
  football:   [{ provides: 'goal', need: 2 }, { provides: 'flag', need: 4 }, { provides: 'bench', need: 2 }],
  rugby:      [{ provides: 'goal', need: 2 }, { provides: 'flag', need: 4 }, { provides: 'bench', need: 2 }],
  afl:        [{ provides: 'goal', need: 2 }, { provides: 'bench', need: 2 }],
  basketball: [{ provides: 'hoop', need: 2 }, { provides: 'bench', need: 2 }],
  tennis:     [{ provides: 'net', need: 1 }, { provides: 'bench', need: 2 }],
  cricket:    [{ provides: 'stumps', need: 2 }, { provides: 'sightscreen', need: 2 }, { provides: 'bench', need: 2 }],
  swimming:   [{ provides: 'startblock', need: 6 }, { provides: 'lanerope', need: 5 }],
  athletics:  [{ provides: 'lanemark', need: 2 }, { provides: 'hurdles', need: 1 }],
  baseball:   [{ provides: 'bench', need: 2 }],
  ice:        [{ provides: 'bench', need: 2 }],
  combat:     [{ provides: 'bench', need: 2 }],
  esports:    [{ provides: 'scoreboard', need: 1 }],
  concert:    [{ provides: 'scoreboard', need: 1 }],
  volleyball: [{ provides: 'net', need: 1 }, { provides: 'bench', need: 2 }],
  beach:      [{ provides: 'net', need: 1 }],
  netball:    [{ provides: 'hoop', need: 2 }, { provides: 'bench', need: 2 }],
  handball:   [{ provides: 'goal', need: 2 }, { provides: 'bench', need: 2 }],
  cycling:    [{ provides: 'startgate', need: 1 }, { provides: 'timing', need: 1 }],
  skate:      [{ provides: 'ramp', need: 2 }],
  climbing:   [{ provides: 'holds', need: 4 }],
};

/** Every sport benefits from a scoreboard, so it is listed once here. */
export const UNIVERSAL_EQUIPMENT = [{ provides: 'scoreboard', need: 1 }];

export const PROVIDES_LABEL = {
  goal: 'goal posts', hoop: 'basketball hoops', net: 'a net',
  stumps: 'sets of stumps', sightscreen: 'sight screens', flag: 'corner flags',
  bench: 'player benches', coachbox: 'coaches boxes', scoreboard: 'a scoreboard',
  startblock: 'starting blocks', lanerope: 'lane ropes',
  lanemark: 'track lane markings', hurdles: 'hurdles', practice: 'practice nets',
  seatbench: 'spectator benches', holds: 'climbing routes', ramp: 'ramps',
  startgate: 'a start gate', timing: 'a timing tower', podium: 'a medal podium',
  camera: 'camera platforms', water: 'water stations', bikerack: 'bike racks',
};
