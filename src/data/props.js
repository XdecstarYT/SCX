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
 * Shorthands for the three orientations of a round part. Equipment is full of
 * poles, posts, rails and rims, and spelling the options object out at every
 * one of them buried the geometry in punctuation.
 */
const ROUND = { shape: 'cyl', seg: 10 };
const ROUND_X = { shape: 'cyl', seg: 10, axis: 'x' };
const ROUND_Z = { shape: 'cyl', seg: 10, axis: 'z' };
const ROUND_FINE = { shape: 'cyl', seg: 14 };
const HOOP = { shape: 'tube', seg: 16 };

/**
 * What each of those materials is made of, for the shader.
 *
 * Equipment was drawn in flat colour while the stadium around it had grain,
 * coursing and ribs, which made a goal frame read as plastic beside a brick
 * wall. Keying the finish off the colour constant means every prop already
 * authored gets its material without any of them being edited.
 */
export const PART_FINISH = {
  [NET]: 'netting',
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
    // The goal mouth is 7.32 x 2.44 and the net rakes back 1.6m to a ground
    // bar, which is the shape that makes it read as a goal rather than a crate.
    parts: [
      [-3.66, 1.22, 0, 0.12, 2.44, 0.12, WHITE, 0, null, ROUND],
      [3.66, 1.22, 0, 0.12, 2.44, 0.12, WHITE, 0, null, ROUND],
      [0, 2.44, 0, 7.44, 0.12, 0.12, WHITE, 0, null, ROUND_X],
      // Net: crossbar down and back to the ground bar, 0.474 rad off vertical.
      [0, 1.22, -0.98, 7.32, 2.74, 0.04, NET, 0, null, { tilt: [0.474, 0, 0] }],
      [0, 0.05, -1.6, 7.32, 0.09, 0.09, WHITE, 0, null, ROUND_X],
      // Side panels close the wedge in from each post.
      [-3.68, 0.75, -0.8, 0.04, 1.5, 1.6, NET],
      [3.68, 0.75, -0.8, 0.04, 1.5, 1.6, NET],
      // Stanchions holding the net clear of the goal line.
      [-3.66, 2.4, -0.5, 0.06, 0.06, 1.0, WHITE, 0, null, ROUND_Z],
      [3.66, 2.4, -0.5, 0.06, 0.06, 1.0, WHITE, 0, null, ROUND_Z],
    ],
  },
  {
    key: 'goal_afl', name: 'AFL Goal Posts', sport: 'afl', group: 'football',
    foot: { w: 10, d: 1 }, provides: 'goal', needs: ['pitch_afl', 'pitch_cricket'], pairs: 2,
    cost: 22_000, maintenance: 8, appearance: 3,
    hint: 'Two 9m goal posts with a behind post either side, as the code requires.',
    parts: [
      [-3.2, 4.6, 0, 0.22, 9.2, 0.22, WHITE, 0, null, ROUND],
      [3.2, 4.6, 0, 0.22, 9.2, 0.22, WHITE, 0, null, ROUND],
      [-9.6, 2.6, 0, 0.18, 5.2, 0.18, WHITE, 0, null, ROUND],
      [9.6, 2.6, 0, 0.18, 5.2, 0.18, WHITE, 0, null, ROUND],
      [-3.2, 0.8, 0, 0.42, 1.6, 0.42, PAD, 0, null, ROUND],
      [3.2, 0.8, 0, 0.42, 1.6, 0.42, PAD, 0, null, ROUND],
    ],
  },
  {
    key: 'goal_rugby', name: 'Rugby Posts', sport: 'rugby', group: 'football',
    foot: { w: 4, d: 1 }, provides: 'goal', needs: ['pitch_rugby', 'pitch_football'], pairs: 2,
    cost: 19_000, maintenance: 7, appearance: 3,
    hint: 'An H frame with the crossbar at 3m and 8m uprights.',
    parts: [
      [-2.8, 4.2, 0, 0.2, 8.4, 0.2, WHITE, 0, null, ROUND],
      [2.8, 4.2, 0, 0.2, 8.4, 0.2, WHITE, 0, null, ROUND],
      [0, 3.0, 0, 5.9, 0.2, 0.2, WHITE, 0, null, ROUND_X],
      [-2.8, 1.0, 0, 0.44, 2.0, 0.44, PAD, 0, null, ROUND],
      [2.8, 1.0, 0, 0.44, 2.0, 0.44, PAD, 0, null, ROUND],
    ],
  },
  {
    key: 'corner_flag', color: 0xd8b13a, name: 'Corner Flag', sport: 'football', group: 'football',
    foot: { w: 1, d: 1 }, provides: 'flag', needs: null, pairs: 4,
    cost: 900, maintenance: 0.6, appearance: 1,
    hint: 'One at each corner of the pitch. Small, but every ground has them.',
    parts: [
      [0, 0.05, 0, 0.3, 0.1, 0.3, PAD, 0, null, ROUND],
      [0, 0.85, 0, 0.05, 1.7, 0.05, WHITE, 0, null, ROUND_FINE],
      // A flag that hangs and creases rather than a flat tab.
      [0.24, 1.5, 0.02, 0.42, 0.3, 0.03, 0xd8b13a, 0, 'fabric', { tilt: [0, 0.12, 0] }],
      [0.24, 1.2, -0.02, 0.42, 0.3, 0.03, 0xd8b13a, 0, 'fabric', { tilt: [0, -0.1, 0] }],
    ],
  },

  // ----------------------------------------------------------- basketball
  {
    key: 'hoop_basketball', color: 0xd9762a, name: 'Basketball Hoop', sport: 'basketball', group: 'indoor',
    foot: { w: 2, d: 2 }, provides: 'hoop', needs: ['court_basketball'], pairs: 2,
    cost: 26_000, maintenance: 9, appearance: 3,
    hint: 'Backboard, rim and stanchion. A court needs one at each end.',
    parts: [
      // Padded round column on a base plate, with a boom out to the board.
      [0, 0.1, -1.5, 1.7, 0.2, 1.5, PAD],
      [0, 1.35, -1.5, 0.46, 2.5, 0.46, PAD, 0, null, ROUND],
      [0, 2.9, -1.5, 0.3, 0.3, 0.3, STEEL, 0, null, ROUND],
      [0, 3.5, -1.1, 0.22, 0.22, 1.0, STEEL, 0, null, ROUND_Z],
      // Braces from the column up to the boom.
      [0, 3.05, -1.16, 0.14, 0.9, 0.14, STEEL, 0, null, { ...ROUND, tilt: [0.62, 0, 0] }],
      // Glass backboard with a painted target square.
      [0, 3.45, -0.62, 1.8, 1.05, 0.06, GLASSY],
      [0, 3.45, -0.66, 1.86, 1.11, 0.04, WHITE],
      [0, 3.12, -0.58, 0.62, 0.46, 0.03, 0xd9762a],
      // The rim is a real ring, hung off the board.
      [0, 3.05, -0.58, 0.14, 0.1, 0.14, RIM, 0, null, ROUND],
      [0, 3.05, -0.28, 0.46, 0.04, 0.46, RIM, 0, null, HOOP],
      [0, 2.82, -0.28, 0.44, 0.42, 0.44, NET, 0, null, { shape: 'tube', seg: 12 }],
    ],
  },
  {
    key: 'net_volley', name: 'Volleyball Net', sport: 'volleyball', group: 'indoor',
    foot: { w: 6, d: 1 }, provides: 'net', needs: ['court_basketball'], pairs: 1,
    cost: 4_200, maintenance: 2, appearance: 1,
    hint: 'Turns a hardwood court over to volleyball between fixtures.',
    parts: [
      [-4.6, 1.2, 0, 0.11, 2.4, 0.11, STEEL, 0, null, ROUND],
      [4.6, 1.2, 0, 0.11, 2.4, 0.11, STEEL, 0, null, ROUND],
      [-4.6, 0.05, 0, 0.5, 0.1, 0.5, PAD, 0, null, ROUND],
      [4.6, 0.05, 0, 0.5, 0.1, 0.5, PAD, 0, null, ROUND],
      [0, 1.85, 0, 9.2, 1.0, 0.04, NET],
      [0, 2.38, 0, 9.2, 0.1, 0.06, WHITE],
      [0, 1.32, 0, 9.2, 0.08, 0.06, WHITE],
      [-4.0, 2.6, 0, 0.04, 1.6, 0.04, RIM, 0, null, ROUND],
      [4.0, 2.6, 0, 0.04, 1.6, 0.04, RIM, 0, null, ROUND],
    ],
  },

  // --------------------------------------------------------------- tennis
  {
    key: 'net_tennis', name: 'Tennis Net', sport: 'tennis', group: 'racquet',
    foot: { w: 7, d: 1 }, provides: 'net', needs: ['court_tennis'], pairs: 1,
    cost: 5_400, maintenance: 2.4, appearance: 1,
    hint: 'A 12.8m net that dips to 0.91m in the middle. One per court.',
    parts: [
      [-6.4, 0.53, 0, 0.12, 1.07, 0.12, PAD, 0, null, ROUND],
      [6.4, 0.53, 0, 0.12, 1.07, 0.12, PAD, 0, null, ROUND],
      // The net dips to 0.91m at the centre, so it is built as three panels
      // with the outer two tilted down toward the middle.
      [-4.6, 0.52, 0, 3.6, 1.02, 0.04, NET, 0, null, { tilt: [0, 0, 0.022] }],
      [0, 0.46, 0, 3.6, 0.92, 0.04, NET],
      [4.6, 0.52, 0, 3.6, 1.02, 0.04, NET, 0, null, { tilt: [0, 0, -0.022] }],
      [0, 0.46, 0, 0.1, 0.92, 0.06, WHITE],
      [-4.6, 1.02, 0, 3.6, 0.05, 0.05, WHITE, 0, null, { ...ROUND_X, tilt: [0, 0, 0.022] }],
      [0, 0.92, 0, 3.6, 0.05, 0.05, WHITE, 0, null, ROUND_X],
      [4.6, 1.02, 0, 3.6, 0.05, 0.05, WHITE, 0, null, { ...ROUND_X, tilt: [0, 0, -0.022] }],
    ],
  },

  // -------------------------------------------------------------- cricket
  {
    key: 'stumps_cricket', color: 0x8a6a44, name: 'Cricket Stumps', sport: 'cricket', group: 'bat',
    foot: { w: 1, d: 1 }, provides: 'stumps', needs: ['pitch_cricket'], pairs: 2,
    cost: 1_600, maintenance: 1.2, appearance: 1,
    hint: 'A set of three stumps and bails. A wicket needs a set at each end.',
    parts: [
      [-0.11, 0.36, 0, 0.038, 0.72, 0.038, WOOD, 0, null, ROUND_FINE],
      [0, 0.36, 0, 0.038, 0.72, 0.038, WOOD, 0, null, ROUND_FINE],
      [0.11, 0.36, 0, 0.038, 0.72, 0.038, WOOD, 0, null, ROUND_FINE],
      [-0.055, 0.745, 0, 0.13, 0.028, 0.028, 0xd8cba0, 0, null, ROUND_X],
      [0.055, 0.745, 0, 0.13, 0.028, 0.028, 0xd8cba0, 0, null, ROUND_X],
      [0, 0.01, 0, 2.4, 0.02, 0.1, WHITE],
    ],
  },
  {
    key: 'sightscreen', name: 'Sight Screen', sport: 'cricket', group: 'bat',
    foot: { w: 5, d: 1 }, provides: 'sightscreen', needs: null, pairs: 2,
    cost: 12_000, maintenance: 4, appearance: 2,
    hint: 'The white screen behind the bowler. Required at both ends for a first-class ground.',
    parts: [
      [0, 2.4, 0, 9.0, 4.4, 0.2, 0xf3f5f7],
      [-4.2, 1.1, 0.4, 0.22, 2.2, 0.22, STEEL, 0, null, ROUND],
      [4.2, 1.1, 0.4, 0.22, 2.2, 0.22, STEEL, 0, null, ROUND],
      [0, 4.66, 0, 9.2, 0.14, 0.14, STEEL, 0, null, ROUND_X],
      [0, 0.2, 0, 9.2, 0.14, 0.14, STEEL, 0, null, ROUND_X],
      // Diagonal braces back to the feet, which is what keeps a nine-metre
      // screen upright in a wind.
      [-4.2, 1.2, 0.95, 0.12, 2.6, 1.2, STEEL, 0, null, { ...ROUND, tilt: [0.44, 0, 0] }],
      [4.2, 1.2, 0.95, 0.12, 2.6, 1.2, STEEL, 0, null, { ...ROUND, tilt: [0.44, 0, 0] }],
      [0, 0.14, 0.55, 8.2, 0.28, 0.1, PAD],
    ],
  },

  // -------------------------------------------------------------- aquatic
  {
    key: 'starting_block', name: 'Starting Block', sport: 'swimming', group: 'aquatic',
    foot: { w: 1, d: 1 }, provides: 'startblock', needs: ['pool_swimming'], pairs: 6,
    cost: 3_400, maintenance: 1.6, appearance: 1,
    hint: 'One per lane at the shallow end. Six lanes need six blocks.',
    parts: [
      [0, 0.05, 0, 0.7, 0.1, 1.3, PAD],
      // The top plate slopes forward, the way a block is stood on.
      [0, 0.34, -0.12, 0.62, 0.06, 0.8, 0xdfe4e8, 0, null, { tilt: [-0.16, 0, 0] }],
      [0, 0.18, -0.3, 0.5, 0.36, 0.12, STEEL],
      [0, 0.16, 0.2, 0.5, 0.32, 0.12, STEEL],
      [0, 0.46, -0.42, 0.44, 0.05, 0.05, STEEL, 0, null, ROUND_X],
      [0, 0.2, 0.34, 0.4, 0.32, 0.18, 0xd8443f, 0, null, { tilt: [0.5, 0, 0] }],
      [0, 0.02, 0, 0.9, 0.04, 1.5, RIM],
    ],
  },
  {
    key: 'lane_rope', name: 'Pool Lane Rope', sport: 'swimming', group: 'aquatic',
    foot: { w: 13, d: 1 }, provides: 'lanerope', needs: ['pool_swimming'], pairs: 5,
    cost: 2_800, maintenance: 1.2, appearance: 1,
    hint: 'Divides the lanes. A 25m pool needs one between each pair of lanes.',
    parts: [
      [-10, 0.12, 0, 5.0, 0.22, 0.22, 0xd8443f, 0, null, ROUND_X],
      [-5, 0.12, 0, 5.0, 0.22, 0.22, 0xf0f2f4, 0, null, ROUND_X],
      [0, 0.12, 0, 5.0, 0.22, 0.22, 0x2f6fd0, 0, null, ROUND_X],
      [5, 0.12, 0, 5.0, 0.22, 0.22, 0xf0f2f4, 0, null, ROUND_X],
      [10, 0.12, 0, 5.0, 0.22, 0.22, 0xd8443f, 0, null, ROUND_X],
      [0, 0.12, 0, 25.6, 0.03, 0.03, STEEL, 0, null, ROUND_X],
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
      [-3.6, 0.53, 0, 0.9, 0.09, 0.04, WHITE],
      [-1.2, 0.53, 0, 0.9, 0.09, 0.04, WHITE],
      [1.2, 0.53, 0, 0.9, 0.09, 0.04, WHITE],
      [3.6, 0.53, 0, 0.9, 0.09, 0.04, WHITE],
      [-3.6, 0.26, 0, 0.05, 0.52, 0.05, STEEL, 0, null, ROUND],
      [-1.2, 0.26, 0, 0.05, 0.52, 0.05, STEEL, 0, null, ROUND],
      [1.2, 0.26, 0, 0.05, 0.52, 0.05, STEEL, 0, null, ROUND],
      [3.6, 0.26, 0, 0.05, 0.52, 0.05, STEEL, 0, null, ROUND],
      // Feet, which is how a hurdle stands up and why it tips instead of
      // breaking a shin.
      [-3.6, 0.03, 0.24, 0.42, 0.05, 0.52, STEEL],
      [-1.2, 0.03, 0.24, 0.42, 0.05, 0.52, STEEL],
      [1.2, 0.03, 0.24, 0.42, 0.05, 0.52, STEEL],
      [3.6, 0.03, 0.24, 0.42, 0.05, 0.52, STEEL],
    ],
  },

  // ----------------------------------------------------- shared match-day
  {
    key: 'dugout', name: 'Player Bench', sport: null, group: 'matchday',
    foot: { w: 4, d: 2 }, provides: 'bench', needs: null, pairs: 2,
    cost: 32_000, maintenance: 12, appearance: 3,
    hint: 'A covered bench for substitutes. Every sport wants one on each side.',
    parts: [
      // A shallow barrel roof, built from three panels tilting over.
      [0, 1.42, -2.2, 8.0, 0.1, 1.1, GLASSY, 0, null, { tilt: [0.28, 0, 0] }],
      [0, 1.56, -1.4, 8.0, 0.1, 0.9, GLASSY],
      [0, 1.42, -0.6, 8.0, 0.1, 1.1, GLASSY, 0, null, { tilt: [-0.28, 0, 0] }],
      [-3.94, 0.75, -1.4, 0.1, 1.5, 2.6, GLASSY],
      [3.94, 0.75, -1.4, 0.1, 1.5, 2.6, GLASSY],
      [-3.94, 0.8, -2.55, 0.12, 1.6, 0.12, STEEL, 0, null, ROUND],
      [3.94, 0.8, -2.55, 0.12, 1.6, 0.12, STEEL, 0, null, ROUND],
      [-3.94, 0.8, -0.3, 0.12, 1.6, 0.12, STEEL, 0, null, ROUND],
      [3.94, 0.8, -0.3, 0.12, 1.6, 0.12, STEEL, 0, null, ROUND],
      [0, 0.7, -2.6, 8.0, 1.4, 0.16, 0x4a525c],
      // Individual seats rather than one long plank.
      [0, 0.48, -1.6, 7.4, 0.1, 0.62, 0x2c6fd8],
      [0, 0.76, -1.95, 7.4, 0.56, 0.1, 0x2c6fd8],
      [-3.4, 0.22, -1.6, 0.08, 0.44, 0.08, STEEL, 0, null, ROUND],
      [0, 0.22, -1.6, 0.08, 0.44, 0.08, STEEL, 0, null, ROUND],
      [3.4, 0.22, -1.6, 0.08, 0.44, 0.08, STEEL, 0, null, ROUND],
    ],
  },
  {
    key: 'coach_box', name: 'Coaches Box', sport: null, group: 'matchday',
    foot: { w: 2, d: 2 }, provides: 'coachbox', needs: null, pairs: 2,
    cost: 24_000, maintenance: 9, appearance: 3,
    hint: 'A raised box with a clear view of the whole field.',
    parts: [
      [-1.3, 1.2, -1.2, 0.24, 2.4, 0.24, STEEL, 0, null, ROUND],
      [1.3, 1.2, -1.2, 0.24, 2.4, 0.24, STEEL, 0, null, ROUND],
      [-1.3, 1.2, 1.2, 0.24, 2.4, 0.24, STEEL, 0, null, ROUND],
      [1.3, 1.2, 1.2, 0.24, 2.4, 0.24, STEEL, 0, null, ROUND],
      [0, 1.6, 0, 2.9, 0.12, 0.12, STEEL, 0, null, ROUND_X],
      [0, 2.55, 0, 3.4, 0.3, 3.0, 0x4a525c],
      // The glazing leans out, the way a press box does so you can see down.
      [0, 3.34, -1.52, 3.4, 1.62, 0.08, GLASSY, 0, null, { tilt: [0.16, 0, 0] }],
      [-1.6, 3.3, 0, 0.14, 1.5, 3.0, 0x4a525c],
      [1.6, 3.3, 0, 0.14, 1.5, 3.0, 0x4a525c],
      [0, 3.3, 1.44, 3.4, 1.5, 0.12, 0x4a525c],
      [0, 4.14, 0, 3.7, 0.18, 3.3, 0x5b6672],
      [0, 4.3, 0, 3.5, 0.14, 3.1, 0x6c7783],
    ],
  },
  {
    key: 'scoreboard_sm', name: 'Scoreboard', sport: null, group: 'matchday',
    foot: { w: 4, d: 1 }, provides: 'scoreboard', needs: null, pairs: 1,
    cost: 120_000, maintenance: 22, power: 0.06, appearance: 6, revenue: 900,
    hint: 'Shows the score and the clock. Fans notice when there is not one.',
    parts: [
      [-2.4, 2.4, 0, 0.32, 4.8, 0.32, STEEL, 0, null, ROUND],
      [2.4, 2.4, 0, 0.32, 4.8, 0.32, STEEL, 0, null, ROUND],
      [0, 3.4, 0, 4.8, 0.14, 0.14, STEEL, 0, null, ROUND_X],
      // Braces up to the box, and a face raked down toward the crowd.
      [-2.4, 4.3, 0.3, 0.12, 1.9, 0.7, STEEL, 0, null, { ...ROUND, tilt: [-0.35, 0, 0] }],
      [2.4, 4.3, 0.3, 0.12, 1.9, 0.7, STEEL, 0, null, { ...ROUND, tilt: [-0.35, 0, 0] }],
      [0, 6.2, 0, 6.4, 3.6, 0.45, 0x14202e],
      [0, 6.16, -0.28, 5.8, 3.06, 0.05, 0x2c6fd8, 1, null, { tilt: [0.06, 0, 0] }],
      [0, 8.2, 0, 6.8, 0.36, 0.7, 0x3a4048],
      [0, 8.48, -0.24, 6.2, 0.2, 0.34, 0x1a2532],
    ],
  },
  {
    key: 'scoreboard_lg', name: 'Big Screen', sport: null, group: 'matchday',
    foot: { w: 7, d: 2 }, provides: 'scoreboard', needs: null, pairs: 1,
    cost: 640_000, maintenance: 70, power: 0.22, appearance: 12, revenue: 4_200,
    unlock: 'broadcast',
    hint: 'A broadcast-grade video wall. Raises prestige and sponsor value.',
    parts: [
      [-5.2, 4.0, 1.0, 0.56, 8.0, 0.56, STEEL, 0, null, ROUND],
      [5.2, 4.0, 1.0, 0.56, 8.0, 0.56, STEEL, 0, null, ROUND],
      [-5.2, 4.0, -0.4, 0.3, 8.0, 0.3, STEEL, 0, null, ROUND],
      [5.2, 4.0, -0.4, 0.3, 8.0, 0.3, STEEL, 0, null, ROUND],
      [0, 4.0, 1.0, 11.0, 0.4, 0.4, STEEL, 0, null, ROUND_X],
      [0, 7.4, 1.0, 11.0, 0.4, 0.4, STEEL, 0, null, ROUND_X],
      // Cross-bracing between the legs, which is what a truss actually is.
      [-5.2, 5.7, 0.3, 0.22, 3.6, 1.6, STEEL, 0, null, { ...ROUND, tilt: [0.42, 0, 0] }],
      [5.2, 5.7, 0.3, 0.22, 3.6, 1.6, STEEL, 0, null, { ...ROUND, tilt: [-0.42, 0, 0] }],
      [0, 11.4, 0, 13.0, 7.4, 0.8, 0x14202e],
      [0, 11.4, -0.45, 12.2, 6.6, 0.06, 0x2c6fd8, 1],
      [0, 15.4, 0.2, 13.4, 0.5, 1.3, 0x3a4048],
      // A hood over the top so the screen is readable in sun.
      [0, 15.3, -0.75, 13.0, 0.14, 1.1, 0x2a323c, 0, null, { tilt: [0.4, 0, 0] }],
    ],
  },
  {
    key: 'bench_crowd', name: 'Spectator Bench', sport: null, group: 'matchday',
    foot: { w: 3, d: 1 }, provides: 'seatbench', needs: null, pairs: 1,
    cost: 3_800, maintenance: 1.4, appearance: 2,
    hint: 'Simple bench seating for a training ground or a park pitch.',
    parts: [
      [0, 0.44, 0, 2.6, 0.1, 0.5, WOOD],
      [0, 0.72, -0.22, 2.6, 0.46, 0.08, WOOD],
      [-1.1, 0.22, 0, 0.1, 0.44, 0.44, STEEL],
      [1.1, 0.22, 0, 0.1, 0.44, 0.44, STEEL],
      [0, 0.03, 0, 2.8, 0.06, 0.6, PAD],
      [0, 0.52, 0, 2.6, 0.06, 0.5, WOOD],
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
      [0, 0.07, 0, 0.5, 0.14, 0.5, PAD],
      [0, 1.6, 0, 0.12, 3.2, 0.12, STEEL],
      [0, 0.9, 0, 0.2, 1.8, 0.2, PAD],
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
      [-1.5, 1.0, -0.5, 0.05, 2.0, 1.0, NET],
      [1.5, 1.0, -0.5, 0.05, 2.0, 1.0, NET],
      [0, 1.96, -0.5, 3.0, 0.05, 1.0, NET],
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
      [0, 2.54, 0, 8.4, 0.12, 0.07, WHITE],
      [-5.1, 0.7, 0, 1.6, 0.04, 0.04, NET],
      [5.1, 0.7, 0, 1.6, 0.04, 0.04, NET],
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
      [-2.55, 0.7, -1.0, 0.12, 1.4, 2.1, PAD],
      [2.55, 0.7, -1.0, 0.12, 1.4, 2.1, PAD],
      [0, 1.68, -1.8, 5.2, 0.09, 0.09, RIM],
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
      [0, 0.1, 0, 3.2, 0.2, 3.2, PAD],
      [0, 2.2, 0, 2.6, 4.4, 2.6, WHITE],
      [0, 4.6, 0, 3.2, 0.3, 3.2, PAD],
      [0, 3.4, 1.35, 2.2, 1.2, 0.1, GLASSY],
      [0, 4.9, 0, 2.4, 0.1, 0.08, STEEL],
      [0, 1.1, 1.4, 1.0, 2.0, 0.12, STEEL],
      [0, 5.4, 0, 1.2, 0.7, 0.12, PAD],
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
      [0, 0.92, 0, 1.2, 0.05, 1.2, PAD],
      [-1.2, 0.62, 0, 1.2, 0.05, 1.2, PAD],
      [1.2, 0.46, 0, 1.2, 0.05, 1.2, PAD],
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
      [0, 3.85, 0, 1.9, 0.07, 0.07, STEEL],
      [0, 0.1, 0, 1.0, 0.2, 1.0, PAD],
      [0.7, 1.7, 0, 0.07, 3.2, 0.5, STEEL],
    ],
  },
  {
    key: 'water_station', name: 'Water Station', sport: null, group: 'outdoor',
    foot: { w: 1, d: 1 }, provides: 'water', pairs: 2,
    cost: 620, maintenance: 1.4, appearance: 1,
    hint: 'Somewhere for a crowd to fill a bottle.',
    parts: [
      [0, 0.06, 0, 0.9, 0.12, 0.7, PAD],
      [0, 0.5, 0, 0.7, 1.0, 0.5, STEEL],
      [0, 1.05, 0, 0.8, 0.12, 0.6, GLASSY],
      [0, 0.78, 0.3, 0.08, 0.22, 0.16, RIM],
    ],
  },
  {
    key: 'bike_rack', name: 'Bike Rack', sport: null, group: 'outdoor',
    foot: { w: 3, d: 1 }, provides: 'bikerack', pairs: 2,
    cost: 480, maintenance: 0.8, appearance: 1,
    hint: 'A crowd that cycles in is a crowd that does not park.',
    parts: [
      [0, 0.06, 0, 2.6, 0.12, 0.8, PAD],
      [-1.0, 0.45, 0, 0.08, 0.9, 0.7, STEEL],
      [0, 0.45, 0, 0.08, 0.9, 0.7, STEEL],
      [1.0, 0.45, 0, 0.08, 0.9, 0.7, STEEL],
      [0, 0.82, 0, 2.3, 0.06, 0.06, STEEL],
    ],
  },
  // ------------------------------------------------------------- barriers
  //
  // Everything below is an EDGE piece: it stands on the boundary between two
  // cells rather than inside one, so a run of them encloses a space without
  // eating two metres of floor on either side the way a wall of blocks does.
  // Geometry is authored on the -z edge of the cell, 2m wide so neighbours
  // meet flush, and the rotation swings it round to any of the four sides.
  {
    key: 'wall_partition', name: 'Interior Wall', sport: null, group: 'barrier',
    edge: true, foot: { w: 1, d: 1 }, provides: 'barrier',
    cost: 340, maintenance: 0.5, appearance: 1,
    hint: 'A plastered stud wall, 2.8m tall. Divides a room without costing you the floor.',
    parts: [
      [0, 1.4, -1, 2.0, 2.8, 0.18, 0xe4e7ea],
      [0, 2.86, -1, 2.0, 0.12, 0.24, 0xd2d6da],
      [0, 0.06, -1, 2.0, 0.12, 0.24, 0xc8ccd2],
    ],
  },
  {
    key: 'wall_brick', name: 'Brick Wall', sport: null, group: 'barrier',
    edge: true, foot: { w: 1, d: 1 }, provides: 'barrier',
    cost: 520, maintenance: 0.7, appearance: 3, safety: 1,
    hint: 'Solid brick with a coping course on top. Good for a boundary you want to look permanent.',
    parts: [
      [0, 1.1, -1, 2.0, 2.2, 0.22, 0x8a4a38, 0, 'brick'],
      [0, 2.26, -1, 2.0, 0.12, 0.3, 0xb9b3aa, 0, 'stone'],
    ],
  },
  {
    key: 'wall_glass', name: 'Glass Partition', sport: null, group: 'barrier',
    edge: true, foot: { w: 1, d: 1 }, provides: 'barrier',
    cost: 980, maintenance: 1.4, appearance: 5, unlock: 'adv_materials',
    hint: 'Floor-to-ceiling glazing in a slim frame. Divides without closing in.',
    parts: [
      [0, 1.45, -1, 1.9, 2.7, 0.05, GLASSY],
      [-0.96, 1.45, -1, 0.08, 2.9, 0.12, STEEL],
      [0.96, 1.45, -1, 0.08, 2.9, 0.12, STEEL],
      [0, 2.88, -1, 2.0, 0.1, 0.12, STEEL],
      [0, 0.05, -1, 2.0, 0.1, 0.12, STEEL],
    ],
  },
  {
    key: 'wall_timber', name: 'Timber Screen', sport: null, group: 'barrier',
    edge: true, foot: { w: 1, d: 1 }, provides: 'barrier',
    cost: 420, maintenance: 1.1, appearance: 4,
    hint: 'Vertical boarding on a frame. Warmer than concrete, and quick to put up.',
    parts: [
      [0, 1.05, -1, 2.0, 2.1, 0.12, WOOD, 0, 'timber'],
      [0, 2.16, -1, 2.0, 0.12, 0.2, 0x6e5436, 0, 'timber'],
      [-0.94, 1.05, -0.96, 0.12, 2.2, 0.12, 0x6e5436, 0, 'timber'],
      [0.94, 1.05, -0.96, 0.12, 2.2, 0.12, 0x6e5436, 0, 'timber'],
    ],
  },
  {
    key: 'railing_steel', name: 'Handrail', sport: null, group: 'barrier',
    edge: true, foot: { w: 1, d: 1 }, provides: 'barrier',
    cost: 260, maintenance: 0.6, appearance: 2, safety: 3,
    hint: 'A 1.1m rail with balusters. What a concourse edge needs before anyone leans on it.',
    parts: [
      [0, 1.1, -1, 2.0, 0.06, 0.06, STEEL, 0, null, ROUND_X],
      [0, 0.62, -1, 2.0, 0.04, 0.04, STEEL, 0, null, ROUND_X],
      [-0.94, 0.55, -1, 0.07, 1.1, 0.07, STEEL, 0, null, ROUND],
      [-0.31, 0.55, -1, 0.04, 1.1, 0.04, STEEL, 0, null, ROUND],
      [0.31, 0.55, -1, 0.04, 1.1, 0.04, STEEL, 0, null, ROUND],
      [0.94, 0.55, -1, 0.07, 1.1, 0.07, STEEL, 0, null, ROUND],
    ],
  },
  {
    key: 'fence_chain', name: 'Chain-link Fence', sport: null, group: 'barrier',
    edge: true, foot: { w: 1, d: 1 }, provides: 'barrier',
    cost: 150, maintenance: 0.4, appearance: 0, safety: 2,
    hint: 'Cheap, quick and see-through. The default way to fence a training pitch.',
    parts: [
      [0, 1.2, -1, 2.0, 2.4, 0.02, NET],
      [-0.96, 1.25, -1, 0.08, 2.5, 0.08, STEEL, 0, null, ROUND],
      [0.96, 1.25, -1, 0.08, 2.5, 0.08, STEEL, 0, null, ROUND],
      [0, 2.44, -1, 2.0, 0.05, 0.05, STEEL, 0, null, ROUND_X],
    ],
  },
  {
    key: 'fence_picket', name: 'Picket Fence', sport: null, group: 'barrier',
    edge: true, foot: { w: 1, d: 1 }, provides: 'barrier',
    cost: 190, maintenance: 0.8, appearance: 3,
    hint: 'A low painted fence. Marks a boundary without hiding what is behind it.',
    parts: [
      [-0.8, 0.5, -1, 0.1, 1.0, 0.05, 0xeef1f4],
      [-0.4, 0.5, -1, 0.1, 1.0, 0.05, 0xeef1f4],
      [0, 0.5, -1, 0.1, 1.0, 0.05, 0xeef1f4],
      [0.4, 0.5, -1, 0.1, 1.0, 0.05, 0xeef1f4],
      [0.8, 0.5, -1, 0.1, 1.0, 0.05, 0xeef1f4],
      [0, 0.78, -1, 2.0, 0.07, 0.04, 0xeef1f4],
      [0, 0.3, -1, 2.0, 0.07, 0.04, 0xeef1f4],
    ],
  },
  {
    key: 'barrier_crowd', name: 'Crowd Barrier', sport: null, group: 'barrier',
    edge: true, foot: { w: 1, d: 1 }, provides: 'barrier',
    cost: 210, maintenance: 0.5, appearance: 0, safety: 4,
    hint: 'Interlocking steel pedestrian barrier. What holds a queue where you want it.',
    parts: [
      [0, 1.1, -1, 2.0, 0.05, 0.05, STEEL, 0, null, ROUND_X],
      [0, 0.72, -1, 2.0, 0.04, 0.04, STEEL, 0, null, ROUND_X],
      [0, 0.34, -1, 2.0, 0.04, 0.04, STEEL, 0, null, ROUND_X],
      [-0.9, 0.56, -1, 0.06, 1.12, 0.06, STEEL, 0, null, ROUND],
      [0.9, 0.56, -1, 0.06, 1.12, 0.06, STEEL, 0, null, ROUND],
      [-0.9, 0.04, -0.78, 0.05, 0.08, 0.5, STEEL],
      [0.9, 0.04, -0.78, 0.05, 0.08, 0.5, STEEL],
    ],
  },
  {
    key: 'hoarding_ad', name: 'Advertising Hoarding', sport: null, group: 'barrier',
    edge: true, foot: { w: 1, d: 1 }, provides: 'barrier',
    cost: 900, maintenance: 1.2, appearance: 1, revenue: 240,
    hint: 'Pitchside advertising. Earns every month, and every broadcast shows it.',
    parts: [
      [0, 0.58, -1, 2.0, 1.05, 0.09, 0x24407a],
      [0, 0.58, -1.06, 1.86, 0.8, 0.02, 0xe8e2d0],
      [0, 1.13, -1, 2.0, 0.07, 0.14, 0x18243c],
      [-0.92, 0.4, -0.82, 0.06, 0.8, 0.5, STEEL, 0, null, { tilt: [0.5, 0, 0] }],
      [0.92, 0.4, -0.82, 0.06, 0.8, 0.5, STEEL, 0, null, { tilt: [0.5, 0, 0] }],
    ],
  },
  {
    key: 'wall_acoustic', name: 'Acoustic Screen', sport: null, group: 'barrier',
    edge: true, foot: { w: 1, d: 1 }, provides: 'barrier',
    cost: 1_400, maintenance: 1.8, appearance: 2, unlock: 'adv_materials',
    hint: 'Absorbent panel on a steel frame. Keeps the noise of an event inside the ground.',
    parts: [
      [0, 1.7, -1, 2.0, 3.4, 0.26, 0x5d6a6f, 0, 'mesh'],
      [-0.95, 1.75, -1, 0.14, 3.5, 0.3, STEEL],
      [0.95, 1.75, -1, 0.14, 3.5, 0.3, STEEL],
      [0, 3.48, -1, 2.0, 0.1, 0.34, STEEL],
    ],
  },
  {
    key: 'wall_gate', name: 'Gateway', sport: null, group: 'barrier',
    edge: true, foot: { w: 1, d: 1 }, provides: 'barrier',
    cost: 700, maintenance: 1.0, appearance: 3,
    hint: 'A doorway through a run of wall, so a room you enclose has a way in.',
    parts: [
      [-0.86, 1.4, -1, 0.28, 2.8, 0.2, 0xe4e7ea],
      [0.86, 1.4, -1, 0.28, 2.8, 0.2, 0xe4e7ea],
      [0, 2.6, -1, 2.0, 0.4, 0.2, 0xe4e7ea],
      [0, 2.86, -1, 2.0, 0.12, 0.26, 0xd2d6da],
      [-0.68, 1.2, -1, 0.08, 2.4, 0.26, WOOD, 0, 'timber'],
      [0.68, 1.2, -1, 0.08, 2.4, 0.26, WOOD, 0, 'timber'],
    ],
  },
  // -------------------------------------------------------- site furniture
  //
  // None of this wins a match. All of it is what the difference between a
  // building site and a place people want to spend an afternoon is made of -
  // and in play mode it is what you walk past.
  {
    key: 'floodlight_mast', name: 'Floodlight Mast', sport: null, group: 'outdoor',
    foot: { w: 2, d: 2 }, provides: 'light', pairs: 4,
    cost: 145_000, maintenance: 28, power: 0.42, appearance: 4,
    hint: 'A 30m mast with a head of lamps. Four corners lights a ground for evening fixtures.',
    parts: [
      [0, 0.35, 0, 2.6, 0.7, 2.6, 0x8d97a3],
      [0, 14, 0, 1.1, 27, 1.1, STEEL, 0, null, { shape: 'cyl', seg: 8 }],
      [0, 27.6, 0, 1.6, 0.5, 1.6, STEEL, 0, null, ROUND],
      // The head: three banks of lamps, raked down at the field.
      [0, 29.2, -0.9, 6.4, 1.3, 0.5, 0x2a323c, 0, null, { tilt: [0.5, 0, 0] }],
      [0, 29.2, -1.24, 6.0, 1.0, 0.12, 0xfff3cf, 1, null, { tilt: [0.5, 0, 0] }],
      [0, 30.5, -0.5, 6.4, 1.3, 0.5, 0x2a323c, 0, null, { tilt: [0.5, 0, 0] }],
      [0, 30.5, -0.84, 6.0, 1.0, 0.12, 0xfff3cf, 1, null, { tilt: [0.5, 0, 0] }],
      [0, 31.8, -0.1, 6.4, 1.3, 0.5, 0x2a323c, 0, null, { tilt: [0.5, 0, 0] }],
      [0, 31.8, -0.44, 6.0, 1.0, 0.12, 0xfff3cf, 1, null, { tilt: [0.5, 0, 0] }],
      [0, 28.4, 0.5, 0.7, 4.4, 0.7, STEEL, 0, null, ROUND],
    ],
  },
  {
    key: 'lamp_path', name: 'Path Light', sport: null, group: 'outdoor',
    foot: { w: 1, d: 1 }, provides: 'light', pairs: 8,
    cost: 2_200, maintenance: 1.4, power: 0.01, appearance: 2, safety: 2,
    hint: 'Lights a route after dark. A concourse nobody can see is a concourse nobody uses.',
    parts: [
      [0, 0.12, 0, 0.46, 0.24, 0.46, 0x3a4048, 0, null, ROUND],
      [0, 2.3, 0, 0.16, 4.4, 0.16, 0x4a525c, 0, null, ROUND],
      [0, 4.5, -0.35, 0.14, 0.14, 0.8, 0x4a525c, 0, null, ROUND_Z],
      [0, 4.36, -0.72, 0.6, 0.22, 0.36, 0x2a323c],
      [0, 4.23, -0.72, 0.5, 0.08, 0.3, 0xfff3cf, 1],
    ],
  },
  {
    key: 'flagpole', name: 'Flagpole', sport: null, group: 'outdoor',
    foot: { w: 1, d: 1 }, provides: 'decor', pairs: 3,
    cost: 4_800, maintenance: 1.6, appearance: 4,
    hint: 'Club colours over the main entrance. Cheap prestige, and every photograph has one in it.',
    parts: [
      [0, 0.2, 0, 0.7, 0.4, 0.7, 0xb9b3aa, 0, 'stone', ROUND],
      [0, 5.2, 0, 0.12, 10, 0.12, 0xeef1f4, 0, null, ROUND_FINE],
      [0, 10.3, 0, 0.2, 0.2, 0.2, 0xd8b13a, 0, null, ROUND],
      [0.9, 9.2, 0.05, 1.7, 1.1, 0.04, 0x2c6fd8, 0, 'fabric', { tilt: [0, 0.1, 0] }],
      [0.9, 8.1, -0.05, 1.7, 1.1, 0.04, 0xeef1f4, 0, 'fabric', { tilt: [0, -0.08, 0] }],
    ],
  },
  {
    key: 'turnstile', name: 'Turnstile', sport: null, group: 'matchday',
    foot: { w: 1, d: 2 }, provides: 'gate', pairs: 8,
    cost: 18_000, maintenance: 6, power: 0.01, appearance: 1, safety: 2,
    hint: 'Counts people in one at a time. More of them is a shorter queue and a faster gate.',
    parts: [
      [0, 0.06, 0, 1.4, 0.12, 2.2, 0x3a4048],
      [-0.62, 0.6, 0, 0.28, 1.1, 2.0, 0x4a525c],
      [0.62, 0.6, 0, 0.28, 1.1, 2.0, 0x4a525c],
      [-0.62, 1.2, -0.7, 0.3, 0.3, 0.3, 0x24407a],
      [0.62, 1.22, -0.7, 0.22, 0.34, 0.22, 0x2fd08a, 1],
      // The three arms of the tripod, on the axis they turn about.
      [0, 0.95, 0, 0.12, 0.12, 1.3, STEEL, 0, null, ROUND_Z],
      [0, 0.95, -0.52, 1.0, 0.07, 0.07, STEEL, 0, null, ROUND_X],
      [0.36, 1.25, -0.52, 0.07, 0.68, 0.07, STEEL, 0, null, { ...ROUND, tilt: [0, 0, -0.5] }],
      [-0.36, 1.25, -0.52, 0.07, 0.68, 0.07, STEEL, 0, null, { ...ROUND, tilt: [0, 0, 0.5] }],
    ],
  },
  {
    key: 'ticket_booth', name: 'Ticket Booth', sport: null, group: 'matchday',
    foot: { w: 2, d: 2 }, provides: 'retail', pairs: 2,
    cost: 26_000, maintenance: 9, power: 0.02, appearance: 3, revenue: 600,
    hint: 'Sells on the day to anyone who turned up without a ticket. It pays for itself.',
    parts: [
      [0, 0.08, 0, 3.2, 0.16, 2.6, 0x6c7783],
      [0, 1.4, 1.2, 3.2, 2.5, 0.16, 0xe4e7ea],
      [-1.52, 1.4, 0, 0.16, 2.5, 2.4, 0xe4e7ea],
      [1.52, 1.4, 0, 0.16, 2.5, 2.4, 0xe4e7ea],
      [0, 2.2, -1.2, 3.2, 0.9, 0.14, 0xe4e7ea],
      [0, 1.2, -1.2, 3.2, 1.1, 0.08, GLASSY],
      [0, 0.6, -1.2, 3.2, 0.1, 0.5, 0xb9b3aa, 0, 'stone'],
      [0, 2.78, 0, 3.6, 0.2, 2.9, 0x3a4048],
      [0, 2.6, -1.7, 3.6, 0.12, 1.0, 0x2c6fd8, 0, null, { tilt: [0.3, 0, 0] }],
    ],
  },
  {
    key: 'kiosk_food', name: 'Food Kiosk', sport: null, group: 'matchday',
    foot: { w: 3, d: 2 }, provides: 'retail', pairs: 4,
    cost: 34_000, maintenance: 14, power: 0.05, appearance: 2, revenue: 1_800,
    hint: 'A serving hatch and a counter. Half-time is fifteen minutes and everybody wants one.',
    parts: [
      [0, 0.08, 0, 5.0, 0.16, 2.8, 0x6c7783],
      [0, 1.5, 1.3, 5.0, 2.7, 0.16, 0xd8443f],
      [-2.42, 1.5, 0, 0.16, 2.7, 2.6, 0xd8443f],
      [2.42, 1.5, 0, 0.16, 2.7, 2.6, 0xd8443f],
      [0, 2.5, -1.3, 5.0, 0.7, 0.14, 0xd8443f],
      [0, 1.0, -1.3, 5.0, 0.16, 0.6, 0xdfe4e8],
      [0, 0.5, -1.15, 4.6, 1.0, 0.12, 0xe4e7ea],
      [0, 3.0, 0, 5.4, 0.2, 3.0, 0x3a4048],
      // The awning over the counter.
      [0, 2.66, -2.0, 5.2, 0.1, 1.5, 0xe8e2d0, 0, 'fabric', { tilt: [0.35, 0, 0] }],
      [-2.3, 2.05, -1.9, 0.07, 1.3, 0.07, STEEL, 0, null, ROUND],
      [2.3, 2.05, -1.9, 0.07, 1.3, 0.07, STEEL, 0, null, ROUND],
    ],
  },
  {
    key: 'speaker_stack', name: 'Speaker Stack', sport: null, group: 'matchday',
    foot: { w: 1, d: 1 }, provides: 'pa', pairs: 4,
    cost: 22_000, maintenance: 7, power: 0.08, appearance: 1,
    hint: 'Public address you can hear at the back. Announcements a crowd cannot hear are a safety problem.',
    parts: [
      [0, 0.1, 0, 1.0, 0.2, 1.0, 0x3a4048],
      [0, 2.2, 0, 0.24, 4.2, 0.24, STEEL, 0, null, ROUND],
      [0, 4.5, -0.2, 0.9, 1.1, 0.7, 0x22272e, 0, null, { tilt: [0.3, 0, 0] }],
      [0, 4.5, -0.55, 0.7, 0.7, 0.1, 0x14181d, 0, 'mesh', { tilt: [0.3, 0, 0] }],
      [0, 5.4, -0.2, 0.9, 0.8, 0.7, 0x22272e, 0, null, { tilt: [0.3, 0, 0] }],
      [0, 5.4, -0.52, 0.66, 0.5, 0.1, 0x14181d, 0, 'mesh', { tilt: [0.3, 0, 0] }],
    ],
  },
  {
    key: 'sign_wayfinding', name: 'Wayfinding Sign', sport: null, group: 'outdoor',
    foot: { w: 1, d: 1 }, provides: 'signage', pairs: 6,
    cost: 3_600, maintenance: 1.2, appearance: 2,
    hint: 'Tells people which way the north stand is. Cheap, and it is what stops a concourse jamming.',
    parts: [
      [0, 0.1, 0, 0.4, 0.2, 0.4, 0x3a4048, 0, null, ROUND],
      [0, 1.4, 0, 0.12, 2.6, 0.12, 0x6c7783, 0, null, ROUND],
      [0.55, 2.5, 0, 1.2, 0.34, 0.06, 0x24407a],
      [-0.55, 2.1, 0, 1.2, 0.34, 0.06, 0x24407a],
      [0.55, 1.7, 0, 1.2, 0.34, 0.06, 0x2fd08a],
    ],
  },
  {
    key: 'bin_litter', name: 'Litter Bin', sport: null, group: 'outdoor',
    foot: { w: 1, d: 1 }, provides: 'decor', pairs: 8,
    cost: 320, maintenance: 0.5, appearance: 1,
    hint: 'Forty thousand people generate a lot of rubbish. Somewhere to put it keeps the place looking run.',
    parts: [
      [0, 0.5, 0, 0.66, 1.0, 0.66, 0x3f4a52, 0, null, { shape: 'cyl', seg: 12 }],
      [0, 1.06, 0, 0.76, 0.12, 0.76, 0x2a323c, 0, null, { shape: 'cyl', seg: 12 }],
      [0, 1.18, 0, 0.6, 0.14, 0.6, 0x22272e, 0, null, { shape: 'cyl', seg: 12 }],
    ],
  },
  {
    key: 'bench_park', name: 'Public Bench', sport: null, group: 'outdoor',
    foot: { w: 2, d: 1 }, provides: 'seatbench', pairs: 6,
    cost: 900, maintenance: 0.9, appearance: 2,
    hint: 'Somewhere to wait. A complex with nowhere to sit outside the ground feels like a car park.',
    parts: [
      [0, 0.44, 0, 2.0, 0.08, 0.52, WOOD, 0, 'timber'],
      [0, 0.75, 0.24, 2.0, 0.52, 0.07, WOOD, 0, 'timber', { tilt: [-0.16, 0, 0] }],
      [-0.85, 0.22, 0, 0.07, 0.44, 0.5, STEEL],
      [0.85, 0.22, 0, 0.07, 0.44, 0.5, STEEL],
      [-0.85, 0.62, 0.2, 0.06, 0.5, 0.06, STEEL, 0, null, ROUND],
      [0.85, 0.62, 0.2, 0.06, 0.5, 0.06, STEEL, 0, null, ROUND],
    ],
  },
  {
    key: 'planter_tree', name: 'Tree Planter', sport: null, group: 'outdoor',
    foot: { w: 2, d: 2 }, provides: 'decor', pairs: 6,
    cost: 2_400, maintenance: 2.2, appearance: 6,
    hint: 'A tree in a raised bed. Softens a hard landscape, and the shade is welcome in August.',
    parts: [
      [0, 0.3, 0, 2.2, 0.6, 2.2, 0xb9b3aa, 0, 'stone'],
      [0, 0.62, 0, 1.9, 0.1, 1.9, 0x4a3a28],
      [0, 2.0, 0, 0.34, 2.8, 0.34, 0x5c4630, 0, 'timber', { shape: 'cyl', seg: 8 }],
      [0, 3.9, 0, 3.4, 2.0, 3.4, 0x3f8f45, 0, null, { shape: 'cyl', seg: 10 }],
      [0, 5.0, 0, 2.4, 1.4, 2.4, 0x4aa050, 0, null, { shape: 'cyl', seg: 10 }],
      [0, 5.8, 0, 1.3, 0.9, 1.3, 0x55b058, 0, null, { shape: 'cyl', seg: 8 }],
    ],
  },
  {
    key: 'statue_club', name: 'Club Statue', sport: null, group: 'outdoor',
    foot: { w: 2, d: 2 }, provides: 'decor', pairs: 1,
    cost: 90_000, maintenance: 3, appearance: 14,
    hint: 'A bronze of somebody who mattered here. Pure prestige, and the meeting point before every match.',
    parts: [
      [0, 0.5, 0, 2.2, 1.0, 2.2, 0xb9b3aa, 0, 'stone'],
      [0, 1.06, 0, 1.9, 0.12, 1.9, 0x9a958c, 0, 'stone'],
      [0, 1.15, -0.6, 1.2, 0.06, 0.5, 0xc8a24a],
      [0, 1.7, 0, 0.5, 1.1, 0.34, 0x8a6a2e, 0, null, { shape: 'cyl', seg: 10 }],
      [0, 2.45, 0, 0.42, 0.42, 0.38, 0x8a6a2e, 0, null, { shape: 'cyl', seg: 10 }],
      [-0.42, 1.85, -0.1, 0.18, 0.9, 0.18, 0x8a6a2e, 0, null, { ...ROUND, tilt: [0, 0, 0.5] }],
      [0.46, 2.1, 0.1, 0.18, 0.9, 0.18, 0x8a6a2e, 0, null, { ...ROUND, tilt: [0.3, 0, -0.9] }],
      [-0.16, 0.98, 0, 0.2, 1.0, 0.2, 0x8a6a2e, 0, null, ROUND],
      [0.16, 0.98, 0, 0.2, 1.0, 0.2, 0x8a6a2e, 0, null, ROUND],
    ],
  },
  {
    key: 'medical_post', name: 'First Aid Point', sport: null, group: 'matchday',
    foot: { w: 2, d: 2 }, provides: 'medical', pairs: 2,
    cost: 14_000, maintenance: 6, power: 0.01, appearance: 1, safety: 6,
    hint: 'A staffed point inside the ground. Reaching a casualty in two minutes rather than ten.',
    parts: [
      [0, 0.08, 0, 3.0, 0.16, 2.4, 0xdfe4e8],
      [0, 1.3, 1.1, 3.0, 2.4, 0.14, 0xf3f5f7],
      [-1.43, 1.3, 0, 0.14, 2.4, 2.2, 0xf3f5f7],
      [1.43, 1.3, 0, 0.14, 2.4, 2.2, 0xf3f5f7],
      [0, 2.62, 0, 3.3, 0.16, 2.7, 0xd8443f],
      [0, 2.0, -1.1, 1.1, 0.3, 0.06, 0xd8443f],
      [0, 2.0, -1.1, 0.3, 1.1, 0.06, 0xd8443f],
      [0, 0.9, -1.1, 2.6, 0.1, 0.5, 0xdfe4e8],
    ],
  },
  {
    key: 'bollard_row', name: 'Bollards', sport: null, group: 'outdoor',
    foot: { w: 3, d: 1 }, provides: 'barrier', pairs: 4,
    cost: 1_400, maintenance: 0.6, appearance: 1, safety: 5,
    hint: 'Keeps vehicles off a pedestrian route. Every venue needs a line of them somewhere.',
    parts: [
      [-1.8, 0.5, 0, 0.24, 1.0, 0.24, 0x3f4a52, 0, null, { shape: 'cyl', seg: 10 }],
      [-0.6, 0.5, 0, 0.24, 1.0, 0.24, 0x3f4a52, 0, null, { shape: 'cyl', seg: 10 }],
      [0.6, 0.5, 0, 0.24, 1.0, 0.24, 0x3f4a52, 0, null, { shape: 'cyl', seg: 10 }],
      [1.8, 0.5, 0, 0.24, 1.0, 0.24, 0x3f4a52, 0, null, { shape: 'cyl', seg: 10 }],
      [-1.8, 0.92, 0, 0.26, 0.1, 0.26, 0xd8b13a, 0, null, { shape: 'cyl', seg: 10 }],
      [-0.6, 0.92, 0, 0.26, 0.1, 0.26, 0xd8b13a, 0, null, { shape: 'cyl', seg: 10 }],
      [0.6, 0.92, 0, 0.26, 0.1, 0.26, 0xd8b13a, 0, null, { shape: 'cyl', seg: 10 }],
      [1.8, 0.92, 0, 0.26, 0.1, 0.26, 0xd8b13a, 0, null, { shape: 'cyl', seg: 10 }],
    ],
  },
  {
    key: 'marquee_hosp', name: 'Hospitality Marquee', sport: null, group: 'matchday',
    foot: { w: 6, d: 5 }, provides: 'retail', pairs: 2,
    cost: 78_000, maintenance: 20, power: 0.03, appearance: 7, revenue: 5_200,
    unlock: 'hospitality',
    hint: 'A tented suite for match-day guests. Quick to put up and it sells for a great deal.',
    parts: [
      [0, 0.1, 0, 11.0, 0.2, 9.0, 0xb9b3aa, 0, 'stone'],
      [0, 1.6, 0, 11.0, 3.0, 0.12, 0xf3f0e6, 0, 'fabric'],
      [0, 1.6, 0, 0.12, 3.0, 9.0, 0xf3f0e6, 0, 'fabric'],
      [-5.44, 1.6, 0, 0.12, 3.0, 9.0, 0xf3f0e6, 0, 'fabric'],
      [5.44, 1.6, 0, 0.12, 3.0, 9.0, 0xf3f0e6, 0, 'fabric'],
      // Two pitched roof slopes meeting at a ridge.
      [0, 3.9, -2.3, 11.2, 0.12, 5.0, 0xf3f0e6, 0, 'fabric', { tilt: [-0.36, 0, 0] }],
      [0, 3.9, 2.3, 11.2, 0.12, 5.0, 0xf3f0e6, 0, 'fabric', { tilt: [0.36, 0, 0] }],
      [0, 4.75, 0, 11.2, 0.16, 0.3, 0xe0dccf, 0, 'fabric'],
      [-5.3, 1.6, -4.3, 0.16, 3.2, 0.16, STEEL, 0, null, ROUND],
      [5.3, 1.6, -4.3, 0.16, 3.2, 0.16, STEEL, 0, null, ROUND],
      [-5.3, 1.6, 4.3, 0.16, 3.2, 0.16, STEEL, 0, null, ROUND],
      [5.3, 1.6, 4.3, 0.16, 3.2, 0.16, STEEL, 0, null, ROUND],
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
  { key: 'outdoor', name: 'Outdoor' },
  { key: 'barrier', name: 'Walls & Fences' },
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
  barrier: 'walls and fences',
  light: 'floodlighting', decor: 'landscaping and decoration',
  signage: 'wayfinding signs', retail: 'places to spend money',
  medical: 'first aid points', pa: 'public address', gate: 'turnstiles',
};
