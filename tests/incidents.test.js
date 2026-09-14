import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/core/rng.js';
import {
  JOBS, JOB_BY_KEY, MAX_LIVE, ROLL_SECONDS, URGENT_SECONDS, createJobState,
  tickJobs, handleJob, jobCost, secondsLeft, formatLeft, jobSummary,
} from '../src/core/incidents.js';

/** A state with a ground busy enough for things to go wrong on it. */
function ground(over = {}) {
  return {
    day: 1, dayFraction: 0, cash: 500_000,
    reputation: { venue: 40, fans: 40, community: 40, organiser: 40, athletes: 40 },
    staffBonus: { operations: 1 },
    jobs: createJobState(),
    ...over,
  };
}

const SITES = {
  walk: [10, 8, 10, 12, 8, 10, 14, 8, 10],
  gate: [20, 8, 20],
  stand: [30, 9, 30],
  pitch: [40, 8, 40],
  parking: [50, 8, 50],
};

/** Run `secs` of real time past the place, one roll's worth at a time. */
function run(state, secs, opts = {}, seed = 7) {
  const rng = makeRng(seed);
  const out = { spawned: [], expired: [] };
  const step = ROLL_SECONDS;
  for (let t = 0; t < secs; t += step) {
    const r = tickJobs(state, { dt: step, sites: SITES, rng, ...opts });
    out.spawned.push(...r.spawned);
    out.expired.push(...r.expired);
  }
  return out;
}

/** Tick until something is waiting to be done, and hand it back. */
function untilLive(state, opts = {}, seed = 7) {
  const rng = makeRng(seed);
  for (let i = 0; i < 4000; i++) {
    tickJobs(state, { dt: ROLL_SECONDS, sites: SITES, population: 1, rng, ...opts });
    if (state.jobs.live.length) return state.jobs.live[0];
  }
  return null;
}

test('every job is defined well enough to actually run', () => {
  for (const j of JOBS) {
    assert.ok(j.key && j.name && j.action, `${j.key} is named`);
    assert.ok(j.seconds > 0, `${j.key} has a deadline`);
    assert.ok(j.weight > 0, `${j.key} can be drawn`);
    assert.ok(j.reward && j.penalty, `${j.key} cuts both ways`);
    assert.ok(['walk', 'stand', 'pitch', 'parking', 'gate'].includes(j.site), `${j.key} lands somewhere`);
  }
  assert.equal(new Set(JOBS.map((j) => j.key)).size, JOBS.length, 'keys are unique');
});

test('some jobs cost nothing, so it is not only a money sink', () => {
  const free = JOBS.filter((j) => !j.cost);
  assert.ok(free.length >= 3, 'there is something to do when you are skint');
});

test('a busy ground throws up work', () => {
  const s = ground();
  const out = run(s, 1200, { population: 0.9, event: false });
  assert.ok(out.spawned.length > 5, `got ${out.spawned.length} jobs in twenty minutes`);
});

test('an empty plot with nobody on it does not', () => {
  const s = ground();
  const out = run(s, 1200, { population: 0, event: false, sites: {} });
  // With no crowd and no surfaces, the only jobs that qualify have nowhere
  // to be, so nothing should come up at all.
  assert.equal(out.spawned.length, 0);
});

test('jobs land on ground you actually built', () => {
  const s = ground();
  const out = run(s, 3000, { population: 1 });
  const cells = new Set();
  for (const v of Object.values(SITES)) {
    for (let i = 0; i < v.length; i += 3) cells.add(`${v[i]},${v[i + 1]},${v[i + 2]}`);
  }
  assert.ok(out.spawned.length > 0);
  for (const j of out.spawned) assert.ok(cells.has(`${j.x},${j.y},${j.z}`), `${j.key} is somewhere real`);
});

test('a pitch you have not laid gets no pitch jobs', () => {
  const s = ground();
  const { pitch, ...noPitch } = SITES;
  const rng = makeRng(3);
  for (let i = 0; i < 600; i++) {
    const r = tickJobs(s, { dt: ROLL_SECONDS, sites: noPitch, population: 1, rng });
    for (const j of r.spawned) assert.notEqual(JOB_BY_KEY[j.key].site, 'pitch');
    s.jobs.live = [];   // clear so the roll keeps going
  }
});

test('the list never grows past what a person would read', () => {
  const s = ground();
  run(s, 8000, { population: 1, event: true });
  assert.ok(s.jobs.live.length <= MAX_LIVE, `${s.jobs.live.length} live`);
});

test('the same job does not stack on itself', () => {
  const s = ground();
  run(s, 4000, { population: 1, event: true });
  const keys = s.jobs.live.map((j) => j.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('handling one costs the money and pays the reputation', () => {
  const s = ground();
  const job = untilLive(s);
  assert.ok(job, 'something came up');
  const def = JOB_BY_KEY[job.key];
  const cash = s.cash;
  const before = { ...s.reputation };
  const r = handleJob(s, job.uid);
  assert.ok(r && !r.error);
  assert.equal(s.cash, cash - jobCost(s, def));
  for (const [k, v] of Object.entries(def.reward)) {
    if (k in before) assert.equal(s.reputation[k], Math.min(100, before[k] + v), `${k} moved`);
  }
  assert.ok(!s.jobs.live.some((j) => j.uid === job.uid), 'and it is off the list');
  assert.equal(s.jobs.done, 1);
});

test('a job you cannot afford is refused rather than sending you overdrawn', () => {
  const s = ground({ cash: 10 });
  let paid = null;
  const rng = makeRng(4);
  for (let i = 0; i < 4000 && !paid; i++) {
    tickJobs(s, { dt: ROLL_SECONDS, sites: SITES, population: 1, rng });
    paid = s.jobs.live.find((j) => JOB_BY_KEY[j.key].cost > 100) || null;
  }
  assert.ok(paid, 'something that costs money came up');
  const r = handleJob(s, paid.uid);
  assert.ok(r.error, 'refused');
  assert.equal(s.cash, 10, 'and the money is untouched');
  assert.ok(s.jobs.live.some((j) => j.uid === paid.uid), 'still on the list to do later');
});

test('letting one lapse costs you, and it goes away by itself', () => {
  const s = ground();
  const job = untilLive(s);
  assert.ok(job, 'something came up');
  const def = JOB_BY_KEY[job.key];
  const before = { ...s.reputation };
  // Sit on our hands until well past the deadline.
  run(s, def.seconds + 30, { population: 0 });
  assert.ok(!s.jobs.live.some((j) => j.uid === job.uid), 'gone');
  assert.ok(s.jobs.missed >= 1);
  const hurt = Object.entries(def.penalty).some(([k, v]) => k in before && s.reputation[k] < before[k] && v < 0);
  assert.ok(hurt, `${def.key} lapsing cost something`);
});

test('handling one is always better than ignoring it', () => {
  // Otherwise the correct play is to never touch anything, which is the same
  // as not having the system at all.
  for (const def of JOBS) {
    const score = (o) => Object.entries(o).reduce((a, [k, v]) => a + (k === 'cash' ? v / 1000 : k === 'pitch' ? v * 50 : v), 0);
    assert.ok(score(def.reward) > score(def.penalty), `${def.key} is worth doing`);
  }
});

test('a well-run place gets the same job done cheaper', () => {
  const def = JOBS.find((j) => j.cost > 0);
  const poor = ground({ staffBonus: { operations: 0.8 } });
  const good = ground({ staffBonus: { operations: 1.4 } });
  assert.ok(jobCost(good, def) < jobCost(poor, def));
});

test('the clock counts down and the summary says what is urgent', () => {
  const s = ground();
  const j = untilLive(s);
  assert.ok(j, 'something came up');
  const left = secondsLeft(s, j);
  assert.ok(left > 0 && left <= JOB_BY_KEY[j.key].seconds);
  run(s, ROLL_SECONDS, { population: 0 });
  assert.ok(secondsLeft(s, j) < left, 'the clock moves');
  const sum = jobSummary(s);
  assert.equal(sum.live, s.jobs.live.length);
  assert.ok(sum.urgent <= sum.live);
});

test('a matchday is busier than a Tuesday', () => {
  const quiet = ground();
  const match = ground();
  const a = run(quiet, 3000, { population: 0.6, event: false }, 11);
  const b = run(match, 3000, { population: 0.6, event: true }, 11);
  assert.ok(b.spawned.length > a.spawned.length,
    `matchday ${b.spawned.length} vs quiet ${a.spawned.length}`);
});

test('a tab left in the background does not dump a dozen jobs on return', () => {
  const s = ground();
  const rng = makeRng(5);
  // One tick carrying ten minutes of real time, as happens when the tab was
  // backgrounded and the frame loop stalled.
  const out = tickJobs(s, { dt: 600, sites: SITES, population: 1, event: true, rng });
  assert.ok(out.spawned.length <= 3, `${out.spawned.length} at once`);
});

test('a paused game is a paused ground', () => {
  const s = ground();
  const job = untilLive(s);
  assert.ok(job);
  const left = secondsLeft(s, job);
  s.paused = true;
  const rng = makeRng(9);
  for (let i = 0; i < 200; i++) tickJobs(s, { dt: ROLL_SECONDS, sites: SITES, population: 1, rng });
  assert.equal(secondsLeft(s, job), left, 'the clock did not move');
  assert.ok(s.jobs.live.some((j) => j.uid === job.uid), 'and nothing lapsed');
});

test('deadlines are a promise to a person, so they are in real seconds', () => {
  // A day of game time is twenty real seconds. Every deadline here has to be
  // long enough that somebody can actually read the card and press the button.
  for (const j of JOBS) {
    assert.ok(j.seconds >= 60, `${j.key} gives you ${j.seconds}s, which is not enough`);
    assert.ok(j.seconds <= 600, `${j.key} lingers for ${j.seconds}s`);
  }
  assert.equal(formatLeft(45), '45s left');
  assert.equal(formatLeft(180), '3m left');
});

test('jobs arrive at a pace a person can keep up with', () => {
  // The first version rolled on the game clock and threw up six a minute,
  // which missed ninety-eight of them and took reputation to nothing.
  const quiet = ground();
  run(quiet, 600, { population: 0.6, event: false }, 21);
  const perMinute = (quiet.jobs.done + quiet.jobs.missed + quiet.jobs.live.length) / 10;
  assert.ok(perMinute <= 2, `${perMinute.toFixed(2)} jobs a minute on a quiet day`);
  assert.ok(perMinute >= 0.2, `${perMinute.toFixed(2)} a minute is not enough to do`);
});
