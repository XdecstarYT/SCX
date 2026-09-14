/**
 * ---------------------------------------------------------------------------
 * JOBS
 * ---------------------------------------------------------------------------
 * The thing a sports complex does between fixtures is not nothing. Bins fill,
 * a floodlight goes, somebody's child is at the wrong turnstile, a reporter
 * wants two minutes. None of it is a decision about the business - it is the
 * running of the place, and it is what there was previously nothing of.
 *
 * A job is small, it is somewhere in particular, and it goes away whether you
 * deal with it or not. Dealing with it is one tap and usually costs something;
 * letting it lapse costs you a little standing with somebody. That asymmetry
 * is the whole game of it: on a quiet Tuesday you can clear the lot, and on a
 * matchday with six live at once you are choosing which ones matter.
 *
 * Where a job lands comes from the world you actually built - the surfaces
 * WorldLife already scanned for the crowd - so jobs cannot appear on a pitch
 * you have not laid or a concourse you have not paved.
 */

/** Never more than this live at once. A list of twenty is a chore, not a game. */
export const MAX_LIVE = 6;
/**
 * Real seconds between rolls, and every deadline below is in real seconds too.
 *
 * This deliberately does not run on the game clock. A day is twenty seconds of
 * real time, so a job given "eight hours" to live was actually given under
 * seven seconds, and the first thing the system did was miss ninety-eight of
 * them and take the player's reputation to zero. Deadlines are a promise made
 * to a person, and a person is sitting in real time - so a minute means a
 * minute, whatever speed the world is running at.
 */
export const ROLL_SECONDS = 10;
/** Seconds left at which a job is about to lapse. */
export const URGENT_SECONDS = 20;

/**
 * Where a job can land. Each name is a bucket of world positions the caller
 * supplies; a job whose ground does not exist yet simply never comes up.
 */
const SITES = ['walk', 'stand', 'pitch', 'parking', 'gate'];

/**
 * The jobs themselves. Everything here is invented - the names, the clubs
 * they mention, the lot of it.
 *
 * `cost` is what sending somebody costs. `reward` is what you get for it and
 * `penalty` what it costs you to let it lapse; both are reputation deltas
 * unless they name `cash` or `pitch`. `crowd` is how much of a crowd the job
 * needs before it can happen at all - litter needs people to drop it.
 */
export const JOBS = [
  {
    key: 'litter', name: 'Litter on the concourse', icon: '\u{1F5D1}', colour: 0x8a8f98,
    site: 'walk', weight: 10, seconds: 180, crowd: 0.3, cost: 400,
    blurb: 'The bins by the south steps went over an hour ago and it is spreading.',
    action: 'Send a cleaning crew',
    reward: { community: 1 }, penalty: { community: -2, fans: -1 },
  },
  {
    key: 'queue', name: 'Queue building at the turnstiles', icon: '\u{1F6B6}', colour: 0xe8a93f,
    site: 'gate', weight: 9, seconds: 90, crowd: 0.55, cost: 900,
    blurb: 'Two lanes are down and the line is back to the approach road.',
    action: 'Open the reserve lanes',
    reward: { fans: 2 }, penalty: { fans: -3, venue: -1 },
  },
  {
    key: 'spill', name: 'Spillage outside a kiosk', icon: '\u{1F6A7}', colour: 0xd8b13a,
    site: 'walk', weight: 8, seconds: 120, crowd: 0.25, cost: 250,
    blurb: 'A crate of bottles went down and nobody has coned it off.',
    action: 'Cone it and mop it',
    reward: { community: 1 }, penalty: { fans: -2, venue: -2 },
  },
  {
    key: 'lamp', name: 'A floodlight is out', icon: '\u{1F4A1}', colour: 0xf0f2f4,
    site: 'pitch', weight: 7, seconds: 300, crowd: 0, cost: 2200,
    blurb: 'One of the corner masts has dropped a bank. It shows on camera.',
    action: 'Call the contractor out',
    reward: { venue: 1 }, penalty: { venue: -3, organiser: -2 },
  },
  {
    key: 'divot', name: 'Divots in the goalmouth', icon: '\u{1F33F}', colour: 0x2f6b39,
    site: 'pitch', weight: 8, seconds: 300, crowd: 0, cost: 700,
    blurb: 'Training has taken the top off the six-yard box again.',
    action: 'Get the groundstaff on it',
    reward: { pitch: 0.04, athletes: 1 }, penalty: { pitch: -0.05, athletes: -2 },
  },
  {
    key: 'exit', name: 'A fire exit is blocked', icon: '\u{1F6AA}', colour: 0xd8443f,
    site: 'walk', weight: 6, seconds: 120, crowd: 0.1, cost: 0,
    blurb: 'Stacked crates against the east exit. It is two minutes to move them.',
    action: 'Have it cleared now',
    reward: { venue: 1 }, penalty: { venue: -4, community: -2 },
  },
  {
    key: 'lost', name: 'A child at the wrong turnstile', icon: '\u{1F9F8}', colour: 0x49c5c9,
    site: 'gate', weight: 6, seconds: 60, crowd: 0.4, cost: 0,
    blurb: 'Separated from their family somewhere between the car park and gate four.',
    action: 'Put stewards on it',
    reward: { community: 3, fans: 2 }, penalty: { community: -5, fans: -4 },
  },
  {
    key: 'tout', name: 'Touts working the approach', icon: '\u{1F3AB}', colour: 0x9a6bf0,
    site: 'parking', weight: 6, seconds: 150, crowd: 0.5, cost: 600,
    blurb: 'Three of them at the top of the car park, and the prices are silly.',
    action: 'Move them on',
    reward: { fans: 2 }, penalty: { fans: -2, community: -1 },
  },
  {
    key: 'leak', name: 'Water in the undercroft', icon: '\u{1F4A7}', colour: 0x2c6fd8,
    site: 'walk', weight: 5, seconds: 420, crowd: 0, cost: 1800,
    blurb: 'Coming through the slab under the north stand. It will not fix itself.',
    action: 'Get a plumber down',
    reward: { venue: 1 }, penalty: { venue: -3 },
  },
  {
    key: 'scout', name: 'A scout is in the stand', icon: '\u{1F50D}', colour: 0xd85f9a,
    site: 'stand', weight: 5, seconds: 90, crowd: 0.35, cost: 0,
    blurb: 'Down from a bigger club to watch somebody. Worth saying hello.',
    action: 'Go and say hello',
    reward: { athletes: 3, venue: 1 }, penalty: { athletes: -1 },
  },
  {
    key: 'press', name: 'A reporter wants two minutes', icon: '\u{1F399}', colour: 0xd8443f,
    site: 'walk', weight: 5, seconds: 90, crowd: 0.2, cost: 0,
    blurb: 'Local paper, doing a piece on the ground. Two minutes, they say.',
    action: 'Give them the two minutes',
    reward: { venue: 2, community: 2 }, penalty: { venue: -1, community: -2 },
  },
  {
    key: 'busker', name: 'A band wants to play the fan zone', icon: '\u{1F3B8}', colour: 0x2fd08a,
    site: 'walk', weight: 4, seconds: 150, crowd: 0.45, cost: 300,
    blurb: 'Four of them with their own gear, asking for the pitch by the gate.',
    action: 'Let them set up',
    reward: { fans: 2, community: 2 }, penalty: { fans: -1 },
  },
];

export const JOB_BY_KEY = Object.fromEntries(JOBS.map((j) => [j.key, j]));

export function createJobState() {
  return { live: [], nextUid: 1, clock: 0, lastRoll: 0, done: 0, missed: 0 };
}

/**
 * Roll for new jobs and retire the ones that have run out of time.
 *
 * `sites` maps each name in SITES to a flat [x, y, z, x, y, z, ...] array of
 * world positions - the same arrays WorldLife builds for the crowd, so there
 * is one scan of the world and not two.
 */
export function tickJobs(state, { dt = 0, sites = {}, population = 0, event = false, rng } = {}) {
  const s = state.jobs || (state.jobs = createJobState());
  const out = { spawned: [], expired: [] };
  // A paused game is a paused ground. Nothing goes wrong while you are not
  // there, and nothing you have already been given runs out either.
  if (state.paused) return out;
  s.clock += dt;
  const now = s.clock;

  // Expire first, so a job that timed out this hour frees its slot for a new
  // one rather than blocking the roll until the next.
  const live = [];
  for (const j of s.live) {
    if (now < j.dueAt) { live.push(j); continue; }
    const def = JOB_BY_KEY[j.key];
    if (def) {
      applyOutcome(state, def.penalty);
      s.missed++;
      out.expired.push({ ...j, def });
    }
  }
  s.live = live;

  let rolls = Math.floor((now - s.lastRoll) / ROLL_SECONDS);
  if (rolls <= 0) return out;
  // A tab left in the background should not dump a dozen jobs on return.
  rolls = Math.min(rolls, 3);
  s.lastRoll = now;

  for (let r = 0; r < rolls; r++) {
    if (s.live.length >= MAX_LIVE) break;
    // A quiet ground throws up the odd thing; a full one throws up plenty.
    // Roughly one a minute on a normal day, one every twenty seconds when
    // there is a fixture on and thirty thousand people to go wrong around.
    const chance = (event ? 0.42 : 0.16) * (0.35 + population * 0.65);
    if (!rng.chance(chance)) continue;
    const job = rollJob(state, s, { sites, population, event, rng, now });
    if (job) { s.live.push(job); out.spawned.push(job); }
  }
  return out;
}

function rollJob(state, s, { sites, population, event, rng, now }) {
  const rep = state.reputation?.venue ?? 0;
  const pool = [];
  for (const def of JOBS) {
    if (population < def.crowd) continue;
    if (def.minRep && rep < def.minRep) continue;
    const at = sites[def.site];
    if (!at || at.length < 3) continue;
    // Don't stack two of the same thing - "litter" twice reads as a bug.
    if (s.live.some((j) => j.key === def.key)) continue;
    let w = def.weight;
    if (event && (def.site === 'gate' || def.site === 'stand')) w *= 2;
    for (let i = 0; i < w; i++) pool.push(def);
  }
  if (!pool.length) return null;
  const def = rng.pick(pool);
  const at = sites[def.site];
  const cell = rng.int(0, at.length / 3 - 1) * 3;
  return {
    uid: s.nextUid++,
    key: def.key,
    x: at[cell], y: at[cell + 1], z: at[cell + 2],
    bornAt: now,
    dueAt: now + def.seconds,
  };
}

/** Send somebody. Returns what happened, or null if it is not there to do. */
export function handleJob(state, uid) {
  const s = state.jobs;
  if (!s) return null;
  const i = s.live.findIndex((j) => j.uid === uid);
  if (i < 0) return null;
  const job = s.live[i];
  const def = JOB_BY_KEY[job.key];
  if (!def) return null;
  const cost = jobCost(state, def);
  if (cost > state.cash) return { error: 'Not enough cash to see to that.' };
  s.live.splice(i, 1);
  s.done++;
  if (cost) state.cash -= cost;
  applyOutcome(state, def.reward);
  return { job, def, cost, reward: def.reward };
}

/** Well-run places handle the same job for less. */
export function jobCost(state, def) {
  const ops = state.staffBonus?.operations ?? 1;
  return Math.round((def.cost || 0) / Math.max(0.6, ops));
}

/** Real seconds left before a job lapses. */
export function secondsLeft(state, job) {
  return Math.max(0, job.dueAt - (state.jobs?.clock || 0));
}

/** That same clock as something to put on a card. */
export function formatLeft(secs) {
  if (secs >= 90) return `${Math.round(secs / 60)}m left`;
  return `${Math.max(0, Math.round(secs))}s left`;
}

/**
 * Apply a reward or a penalty. Reputation keys go to reputation, and the two
 * that are not reputation - cash and pitch condition - are named explicitly so
 * a typo in a job definition cannot silently do nothing.
 */
function applyOutcome(state, out) {
  if (!out) return;
  for (const [k, v] of Object.entries(out)) {
    if (k === 'cash') { state.cash += v; continue; }
    if (k === 'pitch') { nudgePitches(state, v); continue; }
    if (state.reputation && k in state.reputation) {
      state.reputation[k] = Math.max(0, Math.min(100, state.reputation[k] + v));
    }
  }
}

function nudgePitches(state, v) {
  const by = state.pitches?.byVenue;
  if (!by) return;
  for (const p of Object.values(by)) {
    p.condition = Math.max(0, Math.min(1, (p.condition ?? 0.8) + v));
  }
}

/** What to put on a chip: how many are live and whether any is urgent. */
export function jobSummary(state) {
  const s = state.jobs;
  if (!s || !s.live.length) return { live: 0, urgent: 0, done: s?.done || 0, missed: s?.missed || 0 };
  let urgent = 0;
  for (const j of s.live) if (secondsLeft(state, j) <= URGENT_SECONDS) urgent++;
  return { live: s.live.length, urgent, done: s.done, missed: s.missed };
}
