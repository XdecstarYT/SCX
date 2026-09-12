import { BLOCK_SIZE } from '../core/constants.js';

/**
 * Which regulation marking set each sport gets, matching the ids the voxel
 * shader switches on. A sport with no entry simply gets no markings, which is
 * right for a concert stage or an esports floor.
 */
const SPORT_MARKS = {
  football: 1,
  rugby: 2,
  cricket: 3,
  afl: 4,
  basketball: 5,
  tennis: 6,
  athletics: 7,
  swimming: 8,
  ice: 9,
  baseball: 10,
  combat: 11,
};

/**
 * Turn the analyser's venues into the pitch rectangles the shader paints into,
 * in world metres.
 *
 * The rectangle is the fitted playing surface the analyser already measured,
 * so the markings follow whatever the player actually built: enlarge a pitch
 * and the lines move out with it, and a surface too small to be regulation
 * still gets proportionate markings rather than a standard set overhanging
 * its own touchlines.
 */
export function pitchRects(analysis) {
  const out = [];
  for (const v of analysis?.venues || []) {
    const sport = SPORT_MARKS[v.sport];
    if (!sport || !v.field || !v.field.w || !v.field.d) continue;
    // Long axis first, which is how every marking set here is written.
    const long = Math.max(v.field.w, v.field.d), short = Math.min(v.field.w, v.field.d);
    out.push({
      sport,
      cx: (v.centre.x + 0.5) * BLOCK_SIZE,
      cz: (v.centre.z + 0.5) * BLOCK_SIZE,
      halfW: (long * BLOCK_SIZE) / 2,
      halfD: (short * BLOCK_SIZE) / 2,
      area: long * short,
    });
  }
  // Biggest first: the shader keeps eight, and a main stadium matters more
  // than the practice court beside it.
  out.sort((a, b) => b.area - a.area);
  return out;
}

export { SPORT_MARKS };
