/**
 * Hosting rights, driven through the real screen.
 *
 * Builds a ground big enough for a Test series out of real blocks, registers
 * it, opens the Hosting tab, bids for the rights with the button a player
 * would press, then runs the schedule and checks the honours board fills in.
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
/** Achievements and notices open modals over the sheet; clear them first. */
const clearModals = async () => {
  await page.evaluate(() => {
    window.__sct.hud?.closeModal?.();
    for (const m of document.querySelectorAll('.modal')) m.remove();
  });
  await page.waitForTimeout(120);
};
/** Re-open the tab from scratch, so what is read is what was just rendered. */
const openHosting = async () => {
  await clearModals();
  await page.evaluate(() => {
    window.__sct.hud?.closeSheet?.();
    window.__sct.screens.openMore('Hosting');
  });
  await page.waitForTimeout(500);
};
const ok = (m) => console.log('  ✓ ' + m);
const check = (cond, m) => { if (cond) ok(m); else { fail.push(m); console.log('  ✗ ' + m); } };

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.getByRole('button', { name: /Start building/i }).click();
await page.waitForFunction(() => window.__sct?.worldRenderer, null, { timeout: 15000 });

// ---------------------------------------------------- a ground worth staging at
//
// Built straight into the world rather than tapped out block by block: this
// script is about the hosting screen, and e2e/newtools.mjs already proves the
// build tools reach the world.
console.log('  building a Test ground...');
const built = await page.evaluate(() => {
  const a = window.__sct;
  const g = a.game, w = g.world, B = a.dev.blockId, Z = a.dev.zoneId;
  g.state.paused = true;
  a.tutorial.dismiss();

  const GY = 7;
  g.state.cash = 900_000_000;
  g.buyLand(); g.buyLand(); g.buyLand();   // room for a 30,000-seat bowl
  const size = w.size, c = Math.floor(size / 2);

  // The pitch.
  const P = { x0: c - 30, x1: c + 30, z0: c - 20, z1: c + 20 };
  for (let x = P.x0; x <= P.x1; x++)
    for (let z = P.z0; z <= P.z1; z++) w.setBlock(x, GY, z, B('turf'), Z('pitch_rugby'));

  // Twenty raked rings around it, with a concourse every sixth one.
  for (let r = 2; r <= 22; r++) {
    const y = GY + Math.floor((r - 2) * 0.8);
    const conc = r % 6 === 0;
    const col = (x, z) => {
      for (let yy = GY; yy < y; yy++) w.setBlock(x, yy, z, B('concrete'), 0);
      w.setBlock(x, y, z, conc ? B('pavement') : B('seat'), conc ? Z('concourse') : Z('seating'));
    };
    for (let x = P.x0 - r; x <= P.x1 + r; x++) { col(x, P.z0 - r); col(x, P.z1 + r); }
    for (let z = P.z0 - r + 1; z < P.z1 + r; z++) { col(P.x0 - r, z); col(P.x1 + r, z); }
  }

  // Everything the requirements ask for, in a compact grid behind the south
  // stand. Laid in one long run they walked straight off the edge of the plot
  // and counted for nothing, which is a mistake a player makes too.
  const strip = (x0, z0, x1, z1, block, zone) => {
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) w.setBlock(x, GY, z, B(block), Z(zone));
  };
  const FACILITIES = ['broadcast', 'media', 'medical', 'hospitality', 'restroom', 'concession',
    'security', 'locker', 'entrance', 'exit', 'retail', 'fanzone', 'training', 'stairs',
    'staff', 'office'];
  FACILITIES.forEach((zone, i) => {
    const x0 = 42 + (i % 4) * 40, z0 = 178 + Math.floor(i / 4) * 14;
    strip(x0, z0, x0 + 34, z0 + 11, 'tile', zone);
  });
  // Broadcast and media are measured against capacity, so a 32,000-seat ground
  // needs more of both than one strip each.
  strip(42, 232, 130, 250, 'tile', 'broadcast');
  strip(132, 232, 214, 250, 'tile', 'media');

  // Roof over the stands, screens, floodlights, parking and a road in.
  for (let x = P.x0 - 23; x <= P.x1 + 23; x++)
    for (let z = P.z0 - 23; z <= P.z1 + 23; z++) {
      const inPitch = x >= P.x0 - 1 && x <= P.x1 + 1 && z >= P.z0 - 1 && z <= P.z1 + 1;
      if (!inPitch) w.setBlock(x, GY + 20, z, B('roof_stadium'), 0);
    }
  for (const x of [P.x0, c, P.x1]) w.setBlock(x, GY + 21, P.z0 - 23, B('screen'), 0);
  for (const [x, z] of [[P.x0 - 24, P.z0 - 24], [P.x1 + 24, P.z0 - 24],
    [P.x0 - 24, P.z1 + 24], [P.x1 + 24, P.z1 + 24],
    [c, P.z0 - 24], [c, P.z1 + 24], [P.x0 - 24, c], [P.x1 + 24, c]]) {
    for (let y = GY; y < GY + 24; y++) w.setBlock(x, y, z, B('steel'), 0);
    w.setBlock(x, GY + 24, z, B('floodlight'), 0);
  }
  strip(20, 20, 236, 78, 'asphalt', 'parking');
  strip(42, 80, 214, 82, 'road_main', 'road_main');

  // The pitch's own equipment.
  const prop = (key, x, z, rot) => a.dev.prop(key, x, GY + 1, z, rot);
  prop('goal_rugby', c, P.z0 + 1, 2);
  prop('goal_rugby', c, P.z1 - 1, 0);
  for (const [x, z] of [[P.x0, P.z0], [P.x1, P.z0], [P.x0, P.z1], [P.x1, P.z1]]) {
    prop('corner_flag', x, z, 0);
  }

  g.markWorldDirty();
  g.analyze(true);
  // Buy the networks out. Broadcast and media are multiplied by the data
  // network's service factor, so a ground with no data capacity reads as
  // having no broadcast centre however much of one it has built.
  for (const key of ['power', 'water', 'sewer', 'data', 'climate']) {
    for (let t = 0; t < 4; t++) if (g.upgradeUtility(key)?.error) break;
  }
  g.analyze(true);
  const v = g.analysis.venues.find((x) => x.sport === 'rugby');
  if (!v) return { error: 'no rugby venue was detected' };
  g.registerVenue(v.key, 'Test Park');
  g.analyze(true);
  const reg = g.allVenues().find((x) => x.sport === 'rugby');

  g.state.cash = 300_000_000;
  g.state.reputation.venue = 92;
  g.state.reputation.organiser = 92;
  g.state.reputation.fans = 85;
  return { capacity: reg.capacity.total, rating: reg.ratings.overall };
});
if (built.error) { console.log('  ' + built.error); process.exit(1); }
check(built.capacity > 25_000, `the ground holds ${built.capacity.toLocaleString()} at rating ${built.rating}`);

// ------------------------------------------------------ wind on to the offers
const wound = await page.evaluate(() => {
  const g = window.__sct.game;
  // Autumn Tests open 150 days before day 230.
  g.skipDay(84);
  g.state.cash = 300_000_000;
  return { day: g.state.day, offers: g.competitionOffers().map((o) => o.name) };
});
check(wound.offers.length > 0, `day ${wound.day}: ${wound.offers.length} set(s) of rights open — ${wound.offers.join(', ')}`);

await openHosting();
check(await page.locator('.tabs button', { hasText: /^Hosting$/ }).count() > 0,
  'the Hosting tab exists');
await page.screenshot({ path: `${SHOTS}/hosting-offers.png` });

const listed = await page.locator('.sheet-body').innerText();
check(/autumn test series/i.test(listed), 'the Autumn Test Series is listed with its year');
check(/2026/.test(listed), 'the offer is stamped with its year');
check(/rights/i.test(listed), 'the rights fee is shown');

// ------------------------------------------------------------------ take them
const bidBtn = page.locator('.sheet-body button', { hasText: /Everything/ }).first();
check(await bidBtn.count() > 0, 'there is a button to bid with');
let hosting = null;
for (let attempt = 0; attempt < 6 && !hosting; attempt++) {
  const b = page.locator('.sheet-body button', { hasText: /Everything/ }).first();
  if (!await b.count()) {
    // Lost it; wind on a year and try the next staging.
    await page.evaluate(() => { window.__sct.game.skipDay(360); window.__sct.game.state.cash = 300_000_000; });
    await openHosting();
    continue;
  }
  await clearModals();
  await b.click();
  await page.waitForTimeout(600);
  hosting = await page.evaluate(() => {
    const h = window.__sct.game.hostings()[0];
    return h ? { name: h.name, matches: h.matches.length, standing: h.standing, venue: h.venueName } : null;
  });
  if (!hosting) {
    await page.evaluate(() => { window.__sct.game.skipDay(360); window.__sct.game.state.cash = 300_000_000; });
    await openHosting();
  }
}
check(!!hosting, hosting
  ? `won the rights: ${hosting.name}, ${hosting.matches} matches at ${hosting.venue}`
  : 'never won the rights through the UI');

if (hosting) {
  await openHosting();
  const calendar = await page.locator('.sheet-body').innerText();
  if (process.env.DUMP) console.log('--- CALENDAR ---\n' + calendar + '\n---');
  check(/on the calendar/i.test(calendar), 'the staging shows on the calendar');
  check(/first test/i.test(calendar), 'the schedule names its matches');
  await page.screenshot({ path: `${SHOTS}/hosting-active.png` });

  // --------------------------------------------------------- run the schedule
  const staged = await page.evaluate(() => {
    const g = window.__sct.game;
    const h = g.hostings()[0];
    const last = h.matches[h.matches.length - 1];
    g.skipDay(last.day - g.state.day + 2);
    const e = g.state.hosting.history[0];
    return e && {
      name: e.name, champion: e.champion, shared: e.shared, scoreline: e.scoreline,
      attendance: e.attendance, best: e.bestCrowd, profit: Math.round(e.profit),
      records: Object.keys(g.state.hosting.records || {}),
    };
  });
  check(!!staged, 'the schedule ran to the end');
  if (staged) {
    check(staged.attendance > 0, `${staged.attendance.toLocaleString()} through the gates across the series`);
    check(!!(staged.champion || staged.shared), `${staged.champion || 'nobody'} took it — ${staged.scoreline}`);
    check(staged.records.length > 0, `records kept: ${staged.records.join(', ')}`);

    await openHosting();
    const board = await page.locator('.sheet-body').innerText();
    if (process.env.DUMP) console.log('--- BOARD ---\n' + board + '\n---');
    check(/staged here/i.test(board), 'the honours board appeared');
    check(/records/i.test(board), 'the records board appeared');
    check(new RegExp(staged.champion ? staged.champion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : 'shared').test(board),
      'the champion is named on the board');
    await page.screenshot({ path: `${SHOTS}/hosting-honours.png` });
  }
}

if (errors.length) { console.log('  page errors:'); for (const e of errors) console.log('    ' + e); }
await browser.close();
if (fail.length || errors.length) {
  console.log(`\nFAILED: ${fail.length} checks, ${errors.length} page errors`);
  process.exit(1);
}
console.log('\nhosting rights: all checks passed');
