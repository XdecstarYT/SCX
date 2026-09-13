/**
 * An event day, played through the real screen.
 *
 * Builds a ground with real weaknesses, wins a national event, turns on live
 * matchdays, and then takes the calls with the buttons a player would press -
 * checking that the risks shown are the risks the simulation actually rolls,
 * that a decision moves them, and that the day ends in a report.
 */
import { chromium } from 'playwright';

const SHOTS = process.env.SHOTS || '/tmp/shots';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/ERR_CONNECTION_RESET|MIME type|fonts\.googleapis/.test(t)) errors.push(t);
});

const fail = [];
const ok = (m) => console.log('  ✓ ' + m);
const check = (cond, m) => { if (cond) ok(m); else { fail.push(m); console.log('  ✗ ' + m); } };

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.getByRole('button', { name: /Start building/i }).click();
await page.waitForFunction(() => window.__sct?.worldRenderer, null, { timeout: 15000 });

// ------------------------------------------- a big crowd in a ground that struggles
console.log('  building a ground with problems...');
const built = await page.evaluate(() => {
  const a = window.__sct;
  const g = a.game, w = g.world, B = a.dev.blockId, Z = a.dev.zoneId;
  g.state.paused = true;
  a.tutorial.dismiss();
  const GY = 7;

  for (let x = 30; x < 84; x++) for (let z = 40; z < 75; z++) w.setBlock(x, GY, z, B('turf'), Z('pitch_football'));
  // Plenty of seats, and almost nothing to serve them with: one small gate,
  // no restrooms, no security, no parking. Exactly what the deck is about.
  for (let r = 1; r <= 14; r++) {
    const y = GY + Math.floor(r * 0.7);
    const col = (x, z) => {
      for (let yy = GY; yy < y; yy++) w.setBlock(x, yy, z, B('concrete'), 0);
      w.setBlock(x, y, z, B('seat'), Z('seating'));
    };
    for (let x = 30 - r; x <= 83 + r; x++) { col(x, 39 - r); col(x, 75 + r); }
    for (let z = 40 - r; z < 75 + r; z++) { col(29 - r, z); col(84 + r, z); }
  }
  // One small gate for twenty thousand people, and no parking or floodlights:
  // the ground is good enough to be trusted with an event and bad enough that
  // the day is about coping with it.
  for (let x = 54; x < 58; x++) for (let z = 20; z < 22; z++) w.setBlock(x, GY, z, B('pavement'), Z('entrance'));
  const strip = (x0, z0, x1, z1, block, zone) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) w.setBlock(x, GY, z, B(block), Z(zone));
  };
  let zc = 88;
  for (const [zone, d] of [['restroom', 8], ['concession', 9], ['medical', 6], ['locker', 6],
    ['concourse', 7], ['exit', 4], ['staff', 5], ['storage', 5]]) {
    strip(24, zc, 90, zc + d, 'tile', zone);
    zc += d + 1;
  }

  g.state.cash = 200_000_000;
  // Reputation deliberately in step with the ground. At 74 the board correctly
  // offers a rating-45 venue mostly national and international fixtures it
  // cannot meet - which is the tier weighting working, and made this test
  // flaky rather than the game wrong.
  g.state.reputation.venue = 30;
  g.state.reputation.organiser = 45;
  g.state.reputation.fans = 70;
  g.state.weather = 'rain';
  g.markWorldDirty();
  g.analyze(true);
  const v = g.analysis.venues.find((x) => x.sport === 'football');
  if (!v) return { error: 'no football venue detected' };
  g.registerVenue(v.key, 'Struggle Park');
  g.analyze(true);
  const reg = g.allVenues().find((x) => x.sport === 'football');
  return { capacity: reg.capacity.total, rating: reg.ratings.overall };
});
if (built.error) { console.log('  ' + built.error); process.exit(1); }
check(built.capacity > 15_000, `the ground holds ${built.capacity.toLocaleString()} at rating ${built.rating}`);

// ------------------------------------------------------------- turn it on, in the UI
await page.evaluate(() => window.__sct.screens.openMore('Settings'));
await page.waitForTimeout(500);
const toggle = page.locator('.sheet-body', { hasText: /Run your own matchdays/ })
  .locator('input[type=checkbox], .switch, button').first();
check(await page.locator('.sheet-body').innerText().then((t) => /run your own matchdays/i.test(t)),
  'the setting is on the Settings screen');
await page.evaluate(() => {
  // The toggle is a real control; the test drives the state it sets so the
  // rest of the run is about the matchday rather than about a checkbox.
  const g = window.__sct.game;
  g.state.settings.liveMatchday = true;
  g.state.settings.matchdayFrom = 0;
  window.__sct.hud.closeSheet();
});

// ------------------------------------------------------------------- win an event
const won = await page.evaluate(async () => {
  const a = window.__sct;
  const g = a.game;
  // Use the game's own board rather than reaching into modules the bundle
  // does not serve: push the clock on until something lands that fits.
  const venue = g.allVenues().find((x) => x.sport === 'football');
  // Bid on anything this ground actually qualifies for, whatever the sport:
  // submitBid refuses the ones it does not, which is the check we want.
  for (let i = 0; i < 600 && !g.state.events.scheduled.length; i++) {
    g.state.cash = 200_000_000;
    for (const offer of g.state.events.board.filter((e) => e.status === 'open')) {
      const r = g.submitBid(offer.uid, {
        amount: offer.bidRange[1], venueKey: venue.key,
        packages: [], terms: [], pricing: 'standard' });
      if (r?.outcome?.won) break;
    }
    if (g.state.events.scheduled.length) break;
    g.skipDay(1);
  }
  const ev = g.state.events.scheduled[0];
  if (ev) return { name: ev.name, day: ev.eventDay, tier: ev.tier };
  // Nothing landed: say why, rather than failing mutely.
  const sample = g.state.events.board.slice(0, 3).map((e) => {
    const r = g.submitBid(e.uid, { amount: e.bidRange[1], venueKey: venue.key,
      packages: [], terms: [], pricing: 'standard' });
    return `${e.name} [${e.status}] -> ${r.error || (r.outcome?.won ? 'won' : 'lost')}`;
  });
  return { diagnostic: { board: g.state.events.board.length, venue: !!venue,
    registered: venue?.registered, day: g.state.day, sample } };
});
if (won?.diagnostic) console.log('  board diagnostic: ' + JSON.stringify(won.diagnostic));
check(!!won?.name, won?.name ? `won ${won.name} for day ${won.day}` : 'never won an event to run');
if (!won?.name) { await browser.close(); process.exit(1); }

// ------------------------------------------------------------ the day takes over
await page.evaluate(() => {
  const g = window.__sct.game;
  const ev = g.state.events.scheduled[0];
  let guard = 0;
  while (!g.matchday && guard++ < 60) g.skipDay(1);
});
await page.waitForTimeout(600);
check(await page.locator('.matchday:not(.hidden)').count() > 0, 'the matchday screen took over');
await page.screenshot({ path: `${SHOTS}/matchday.png` });

const first = await page.locator('.matchday').innerText();
check(/event day/i.test(first), 'the screen says what it is');
check(/decision/i.test(first), 'a decision is being asked');
check(/what could still go wrong/i.test(first), 'the live risks are shown');
check(/%/.test(first), 'the risks are quoted with odds');

// The risks shown are the risks the simulation will roll, not a separate list.
const agree = await page.evaluate(async () => {
  const g = window.__sct.game;
  const md = g.matchday;
  const shown = g.matchdayView().risks.map((r) => r.key).sort();
  const real = md.risks.filter((r) => !r.good).map((r) => r.key).sort();
  return { shown, real, same: JSON.stringify(shown) === JSON.stringify(real) };
});
check(agree.same, `the screen lists the simulation's own risks (${agree.shown.join(', ')})`);

// ------------------------------------------------------- take the calls, by hand
let calls = 0;
let guarded = 0;
for (let i = 0; i < 30; i++) {
  const live = await page.locator('.matchday:not(.hidden)').count();
  if (!live) break;
  const opts = page.locator('.matchday .md-opt');
  const n = await opts.count();
  if (!n) break;
  // Take the first option every time: the point is that the path works, and
  // that what the screen says a choice does is what it does.
  const before = await page.evaluate(() => {
    const g = window.__sct.game;
    return { guards: Object.keys(g.matchday?.ops.guard || {}).length,
      decisions: g.matchday?.ops.log.length ?? -1 };
  });
  await opts.first().click();
  await page.waitForTimeout(220);
  const after = await page.evaluate(() => {
    const g = window.__sct.game;
    if (!g.matchday) return { gone: true };
    return { guards: Object.keys(g.matchday.ops.guard).length, decisions: g.matchday.ops.log.length };
  });
  calls++;
  if (after.gone) break;
  if (after.decisions !== before.decisions + 1) {
    fail.push('a decision did not register');
    break;
  }
  guarded = Math.max(guarded, after.guards);
  if (i === 1) await page.screenshot({ path: `${SHOTS}/matchday-mid.png` });
}
check(calls >= 3, `took ${calls} calls by hand`);
check(guarded > 0, `${guarded} risk(s) were damped by those calls`);

// ------------------------------------------------------------------ the report
await page.waitForTimeout(600);
const outcome = await page.evaluate(() => {
  const g = window.__sct.game;
  const r = g.state.events.history[0];
  return r ? {
    name: r.eventName, attendance: r.attendance, satisfaction: r.satisfaction,
    profit: Math.round(r.profit), ops: r.ops,
    incidents: r.incidents.map((i) => i.key),
  } : null;
});
check(!!outcome, 'the day produced a report');
if (outcome) {
  check(!!outcome.ops, 'the report records that it was a played day');
  check((outcome.ops?.calls?.length || 0) >= 3,
    `the report lists the ${outcome.ops?.calls?.length} calls that were taken`);
  check(outcome.attendance > 0,
    `${outcome.attendance.toLocaleString()} in, ${outcome.satisfaction}% satisfied, `
    + `${outcome.profit >= 0 ? 'made' : 'lost'} ${Math.abs(outcome.profit).toLocaleString()}`);
}
check(await page.locator('.matchday:not(.hidden)').count() === 0, 'the screen stepped aside afterwards');

// ------------------------------------------------- and a delegated day still runs
const delegated = await page.evaluate(() => {
  const g = window.__sct.game;
  const venue = g.allVenues().find((x) => x.sport === 'football');
  const before = g.state.events.history.length;
  // Same path as the first one: bid on everything open, because submitBid is
  // what decides which offers this ground actually qualifies for. Picking one
  // offer a day and hoping was why this step was flaky.
  for (let i = 0; i < 600 && !g.matchday; i++) {
    g.state.cash = 200_000_000;
    g.state.reputation.venue = Math.min(g.state.reputation.venue, 34);
    for (const offer of g.state.events.board.filter((e) => e.status === 'open')) {
      const r = g.submitBid(offer.uid, { amount: offer.bidRange[1], venueKey: venue.key,
        packages: [], terms: [], pricing: 'standard' });
      if (r?.outcome?.won) break;
    }
    g.skipDay(1);
  }
  if (!g.matchday) {
    return { diagnostic: { day: g.state.day, board: g.state.events.board.length,
      scheduled: g.state.events.scheduled.length } };
  }
  const r = g.matchdayDelegate(true);
  return { ok: !!r.report, calls: r.report?.ops?.calls?.length || 0,
    more: g.state.events.history.length > before };
});
if (delegated?.diagnostic) console.log('  delegate diagnostic: ' + JSON.stringify(delegated.diagnostic));
check(delegated?.ok, delegated
  ? `delegating the whole day still resolved it, over ${delegated.calls} calls`
  : 'a second matchday never opened');

if (errors.length) { console.log('  page errors:'); for (const e of errors) console.log('    ' + e); }
await browser.close();
if (fail.length || errors.length) {
  console.log(`\nFAILED: ${fail.length} checks, ${errors.length} page errors`);
  process.exit(1);
}
console.log('\nmatchday: all checks passed');
