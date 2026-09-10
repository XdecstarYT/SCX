/**
 * Drives the real UI through the whole core loop:
 *   place blocks -> build a stadium -> venue detected -> register ->
 *   bid -> win/lose -> host -> event report.
 * Fails loudly on any console error.
 */
import { chromium } from 'playwright';

const SHOTS = process.env.SHOTS || '/tmp/shots';
const URL = process.env.URL || 'http://localhost:4173/';
const VIEWPORT = process.env.WIDE ? { width: 1280, height: 800 } : { width: 390, height: 844 };

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/ERR_CONNECTION_RESET|MIME type|fonts\.googleapis/.test(t)) errors.push(t);
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

const step = async (n, label) => {
  await page.screenshot({ path: `${SHOTS}/${String(n).padStart(2, '0')}-${label}.png` });
  console.log(`  ✓ ${label}`);
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await step(1, 'splash');

await page.getByRole('button', { name: /Start building/i }).click();
await page.waitForFunction(() => window.__sct?.worldRenderer, null, { timeout: 15000 });
await page.waitForTimeout(1200);
await step(2, 'empty-plot');

// ---------------------------------------------------------- real tap input
const before = await page.evaluate(() => window.__sct.game.state.stats.blocksPlaced);
const box = await page.locator('canvas').boundingBox();
for (const [dx, dy] of [[0, -60], [30, -60], [60, -60], [0, -30]]) {
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await page.waitForTimeout(120);
}
const after = await page.evaluate(() => window.__sct.game.state.stats.blocksPlaced);
console.log(`  taps placed ${after - before} blocks`);
if (after <= before) throw new Error('tapping the canvas did not place any blocks');
await step(3, 'first-blocks');

// -------------------------------------------- build a stadium (fast path)
// Uses the same public tool API the UI calls, just without 400 taps.
await page.evaluate(() => {
  const app = window.__sct;
  const { game } = app;
  const w = game.world;
  const B = (k) => window.__sct.dev.blockId(k);
  const Z = (k) => window.__sct.dev.zoneId(k);
  const G = 8;
  const fillBox = (x0, y0, z0, x1, y1, z1, key, zk) => {
    const id = B(key), z = zk ? Z(zk) : undefined;
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let zz = Math.min(z0, z1); zz <= Math.max(z0, z1); zz++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) w.setBlock(x, y, zz, id, z);
  };
  const ring = (x0, z0, x1, z1, t, y0, y1, key, zk) => {
    const id = B(key), z = zk ? Z(zk) : undefined;
    for (let y = y0; y <= y1; y++)
      for (let zz = z0; zz <= z1; zz++)
        for (let x = x0; x <= x1; x++)
          if (x < x0 + t || x > x1 - t || zz < z0 + t || zz > z1 - t) w.setBlock(x, y, zz, id, z);
  };
  const px0 = 38, pz0 = 46, px1 = px0 + 53, pz1 = pz0 + 34;
  fillBox(px0, G - 1, pz0, px1, G - 1, pz1, 'turf', 'pitch_football');
  for (let r = 0; r < 4; r++) {
    const y = G + r, x0 = px0 - 2 - r * 2, x1 = px1 + 2 + r * 2, z0 = pz0 - 2 - r * 2, z1 = pz1 + 2 + r * 2;
    ring(x0, z0, x1, z1, 2, G - 1, y - 1, 'concrete');
    ring(x0, z0, x1, z1, 2, y, y, 'seat', 'seating');
  }
  const bx0 = px0 - 10, bx1 = px1 + 10, bz0 = pz0 - 10, bz1 = pz1 + 10;
  ring(bx0 - 6, bz0 - 6, bx1 + 6, bz1 + 6, 6, G - 1, G - 1, 'pavement', 'concourse');
  for (const [gx, gz] of [[px0 + 20, bz0 - 6], [px0 + 20, bz1 + 6], [bx0 - 6, pz0 + 14], [bx1 + 6, pz0 + 14]])
    fillBox(gx - 3, G - 1, gz - 1, gx + 3, G - 1, gz + 1, 'tile', 'entrance');
  for (const [gx, gz] of [[px0 + 5, bz0 - 6], [px1 - 5, bz0 - 6], [px0 + 5, bz1 + 6], [px1 - 5, bz1 + 6]])
    fillBox(gx - 3, G - 1, gz - 1, gx + 3, G - 1, gz + 1, 'tile', 'exit');
  for (const sx of [px0 + 8, px0 + 26, px0 + 44]) {
    fillBox(sx, G, bz0 - 1, sx + 1, G + 3, bz0 + 5, 'stair', 'stairs');
    fillBox(sx, G, bz1 - 5, sx + 1, G + 3, bz1 + 1, 'stair', 'stairs');
  }
  const bh = (x, z, wd, dp, blk, zk) => fillBox(x, G, z, x + wd - 1, G + 2, z + dp - 1, blk, zk);
  bh(bx0 - 5, pz0 - 2, 6, 7, 'tile', 'locker');
  bh(bx0 - 5, pz0 + 7, 6, 7, 'tile', 'locker');
  bh(bx0 - 5, pz0 + 16, 4, 4, 'tile', 'medical');
  bh(bx0 - 5, pz0 + 22, 5, 5, 'tile', 'media');
  bh(bx0 - 5, pz0 + 29, 4, 5, 'tile', 'broadcast');
  bh(bx1 + 1, pz0 + 2, 4, 5, 'tile', 'security');
  for (let i = 0; i < 6; i++) {
    bh(bx0 + 4 + i * 11, bz0 - 5, 7, 4, 'tile', 'restroom');
    bh(bx0 + 4 + i * 11, bz1 + 2, 7, 4, 'tile', 'restroom');
  }
  for (let i = 0; i < 5; i++) {
    bh(bx0 + 6 + i * 12, bz0 - 9, 6, 3, 'tile', 'concession');
    bh(bx0 + 6 + i * 12, bz1 + 7, 6, 3, 'tile', 'concession');
  }
  bh(bx1 + 1, pz0 + 12, 5, 6, 'tile', 'retail');
  for (const [fx, fz] of [[bx0 - 2, bz0 - 2], [bx1 + 2, bz0 - 2], [bx0 - 2, bz1 + 2], [bx1 + 2, bz1 + 2]]) {
    fillBox(fx, G, fz, fx, G + 12, fz, 'steel');
    fillBox(fx, G + 13, fz, fx, G + 13, fz, 'floodlight');
  }
  fillBox(6, G - 1, 6, 110, G - 1, 30, 'asphalt', 'parking');
  fillBox(6, G - 1, 32, 110, G - 1, 34, 'road', 'road');

  game.markWorldDirty();
  game.analyze(true);
  app.worldRenderer.rebuildAll();
  app.worldRenderer.flush();
  app.flyToVenue(game.primaryVenue);
  app.refresh();
});
await page.waitForTimeout(1500);
await step(4, 'stadium-built');

const detected = await page.evaluate(() => {
  const v = window.__sct.game.primaryVenue;
  return v && { type: v.type, cap: v.capacity.total, rating: v.ratings.overall, tier: v.tier, registered: v.registered };
});
console.log('  detected:', JSON.stringify(detected));
if (!detected || detected.tier === 'none') throw new Error('venue was not detected as event-ready');

// ------------------------------------------------------------ venue report
await page.getByRole('tab', { name: 'Home' }).click();
await page.waitForTimeout(600);
await step(5, 'home-venue');

await page.getByRole('button', { name: 'Register venue' }).first().click();
await page.waitForTimeout(400);
await step(6, 'register-modal');
await page.getByRole('button', { name: 'Register', exact: true }).click();
await page.waitForTimeout(600);

const registered = await page.evaluate(() => window.__sct.game.state.venues.registered.length);
if (registered !== 1) throw new Error('venue registration failed');
console.log('  ✓ venue registered');

// ------------------------------------------------------------------ events
await page.getByRole('tab', { name: 'Events' }).click();
await page.waitForTimeout(700);
await step(7, 'events-board');

/**
 * Run one full bid: open the event, push the offer to the top of the range,
 * work through any negotiation, and read the outcome. Losing a bid is a real
 * outcome, so this retries with a fresh event until one lands.
 */
async function bidForEvent(templateId, seed, shotBase) {
  const uid = await page.evaluate(([id, sd]) => {
    const app = window.__sct;
    const ev = app.dev.makeEvent(id, sd);
    ev.bidDeadline = app.game.state.day + 8;
    ev.eventDay = app.game.state.day + 4;
    app.game.state.events.board.push(ev);
    app.eventsUi.openBoard();
    return ev.uid;
  }, [templateId, seed]);
  await page.waitForTimeout(300);
  await page.evaluate((u) => window.__sct.eventsUi.openBid(u), uid);
  await page.waitForTimeout(600);

  if (shotBase) {
    const info = await page.evaluate(() => ({
      hasStrength: /Bid strength/i.test(document.body.innerText),
      hasReqs: /Requirements checked/i.test(document.body.innerText),
    }));
    if (!info.hasStrength || !info.hasReqs) throw new Error('bid screen is missing its core sections');
    await step(shotBase, 'bid-screen');
  }

  // Push the offer to the top of the organiser's range using the real slider.
  await page.locator('.sheet-body input[type="range"]').first().evaluate((el) => {
    el.value = el.max;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(350);
  await page.locator('.sheet-body').evaluate((n) => n.scrollTo(0, n.scrollHeight));
  await page.waitForTimeout(250);
  if (shotBase) await step(shotBase + 1, 'bid-strength');

  await page.getByRole('button', { name: /Submit bid/i }).click();
  await page.waitForTimeout(700);

  // A regional-or-better organiser negotiates before deciding.
  let rounds = 0;
  while (await page.locator('.modal-panel', { hasText: /NEGOTIATION/ }).count()) {
    rounds++;
    if (shotBase && rounds === 1) await step(shotBase + 2, 'negotiation');
    const best = await page.locator('.modal-panel .opt').evaluateAll((nodes) => {
      let bestIdx = 0, bestVal = -Infinity;
      nodes.forEach((n, i) => {
        const v = parseInt(n.querySelector('.x')?.textContent || '0', 10);
        if (v > bestVal) { bestVal = v; bestIdx = i; }
      });
      return bestIdx;
    });
    await page.locator('.modal-panel .opt').nth(best).click();
    await page.waitForTimeout(400);
    if (rounds > 5) throw new Error('negotiation did not terminate');
  }
  if (rounds) {
    if (!await page.locator('.modal-panel', { hasText: /TERMS AGREED/ }).count()) {
      throw new Error('no terms summary after the negotiation');
    }
    if (shotBase) await step(shotBase + 3, 'negotiation-terms');
    await page.getByRole('button', { name: /Submit the bid/i }).click();
    await page.waitForTimeout(800);
  }

  const state = await page.evaluate(() => ({
    won: window.__sct.game.state.stats.bidsWon,
    lost: window.__sct.game.state.stats.bidsLost,
    scheduled: window.__sct.game.state.events.scheduled.length,
  }));
  await page.getByRole('button', { name: /Prepare the venue|Back to the board/ }).click();
  await page.waitForTimeout(300);
  return { ...state, rounds };
}

let outcome = { won: 0, lost: 0, scheduled: 0 };
for (let attempt = 0; attempt < 5 && outcome.scheduled === 0; attempt++) {
  outcome = await bidForEvent('regional_final', 12345 + attempt * 7919, attempt === 0 ? 8 : null);
  console.log(`  attempt ${attempt + 1}: ${outcome.rounds} negotiation round(s), ` +
    `${outcome.scheduled ? 'WON' : 'lost'} (${outcome.won}W / ${outcome.lost}L)`);
  if (outcome.scheduled === 0) await page.evaluate(() => window.__sct.eventsUi.openBoard());
}
if (outcome.won + outcome.lost === 0) throw new Error('no bid resolved at all');
await step(12, 'bid-result');


// -------------------------------------------------------------- host a day
if (outcome.scheduled > 0) {
  await page.evaluate(() => {
    const app = window.__sct;
    const ev = app.game.state.events.scheduled[0];
    app.fastForwardTo(ev.eventDay);
  });
  await page.waitForTimeout(2200);
  await step(13, 'event-day-crowd');

  const showing = await page.evaluate(() => !!window.__sct.show?.active);
  console.log('  crowd show active:', showing);

  await page.evaluate(() => window.__sct.show?.skip());
  await page.waitForTimeout(1400);
  await step(14, 'event-report');

  const report = await page.evaluate(() => {
    const r = window.__sct.game.state.events.history[0];
    return r && { attendance: r.attendance, revenue: r.totalRevenue, profit: r.profit, satisfaction: r.satisfaction };
  });
  console.log('  report:', JSON.stringify(report));
  if (!report || report.attendance <= 0) throw new Error('no event report was produced');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(400);
} else {
  console.log('  (bid lost - hosting path exercised by the unit tests)');
}

// ------------------------------------------------------- remaining screens
for (const [tab, name, n] of [['Finance', 'finance', 15], ['More', 'management', 16]]) {
  await page.getByRole('tab', { name: tab }).click();
  await page.waitForTimeout(700);
  await step(n, name);
}
await page.getByRole('tab', { name: 'Build' }).click();
await page.waitForTimeout(400);

// Zone mode overlay
await page.evaluate(() => { window.__sct.controller.setMode('zone'); window.__sct.worldRenderer.setZoneMode(true); window.__sct.dock.render(); });
await page.waitForTimeout(900);
await step(17, 'zone-mode');

// First person
await page.evaluate(() => { window.__sct.controller.setMode('build'); window.__sct.worldRenderer.setZoneMode(false); window.__sct.setCamera('first'); });
await page.waitForTimeout(1400);
await step(18, 'first-person');

// ------------------------------------------------------- save / reload trip
const beforeReload = await page.evaluate(async () => {
  const app = window.__sct;
  await app.saveNow(true);
  return { day: app.game.state.day, cap: app.game.primaryVenue?.capacity.total, cash: Math.round(app.game.state.cash) };
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /^Continue$/ }).click();
await page.waitForFunction(() => window.__sct?.game?.primaryVenue, null, { timeout: 15000 });
await page.waitForTimeout(1500);
const afterReload = await page.evaluate(() => ({
  day: window.__sct.game.state.day,
  cap: window.__sct.game.primaryVenue?.capacity.total,
  cash: Math.round(window.__sct.game.state.cash),
}));
console.log('  save/reload:', JSON.stringify(beforeReload), '->', JSON.stringify(afterReload));
if (afterReload.cap !== beforeReload.cap) throw new Error('the stadium did not survive a reload');
await step(19, 'after-reload');

const perf = await page.evaluate(() => ({
  calls: window.__sct.renderer.info.render.calls,
  tris: window.__sct.renderer.info.render.triangles,
  chunks: window.__sct.worldRenderer.meshes.size,
}));
console.log('  render:', JSON.stringify(perf));

if (errors.length) { console.error('CONSOLE ERRORS:', errors); throw new Error(`${errors.length} console errors`); }
console.log('\nPLAYTHROUGH OK');
await browser.close();
