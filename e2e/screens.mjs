/** Opens every management screen against a fully-built complex and checks the
 *  content actually renders. Catches template errors the unit tests cannot. */
import { chromium } from 'playwright';
const SHOTS = process.env.SHOTS || '/tmp/shots';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 460, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/ERR_CONNECTION_RESET|MIME type|fonts\.googleapis/.test(t)) errors.push(t);
});

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.getByRole('button', { name: /Start building/i }).click();
await page.waitForFunction(() => window.__sct?.worldRenderer, null, { timeout: 15000 });

// A complex with enough going on that every screen has something to show.
await page.evaluate(() => {
  const app = window.__sct, w = app.game.world, s = app.game.state;
  const B = app.dev.blockId, Z = app.dev.zoneId, G = 8;
  const box = (x0, y0, z0, x1, y1, z1, k, zk) => {
    const id = B(k), z = zk ? Z(zk) : undefined;
    for (let y = y0; y <= y1; y++) for (let zz = z0; zz <= z1; zz++) for (let x = x0; x <= x1; x++) w.setBlock(x, y, zz, id, z);
  };
  box(38, G - 1, 46, 91, G - 1, 80, 'turf', 'pitch_football');
  for (let r = 0; r < 5; r++) {
    const y = G + r, x0 = 34 - r * 2, x1 = 95 + r * 2, z0 = 42 - r * 2, z1 = 84 + r * 2;
    for (let zz = z0; zz <= z1; zz++) for (let x = x0; x <= x1; x++) {
      if (x < x0 + 2 || x > x1 - 2 || zz < z0 + 2 || zz > z1 - 2) {
        for (let yy = G - 1; yy < y; yy++) w.setBlock(x, yy, zz, B('concrete'));
        w.setBlock(x, y, zz, B('seat'), Z('seating'));
      }
    }
  }
  box(20, G - 1, 20, 40, G - 1, 30, 'tile', 'restroom');
  box(44, G - 1, 20, 60, G - 1, 30, 'tile', 'concession');
  box(64, G - 1, 20, 78, G - 1, 30, 'tile', 'locker');
  box(82, G - 1, 20, 92, G - 1, 28, 'tile', 'medical');
  box(96, G - 1, 20, 108, G - 1, 30, 'tile', 'media');
  box(20, G - 1, 92, 34, G - 1, 100, 'tile', 'broadcast');
  box(38, G - 1, 92, 50, G - 1, 100, 'tile', 'security');
  box(54, G - 1, 92, 70, G - 1, 100, 'tile', 'hospitality');
  box(74, G - 1, 92, 90, G - 1, 100, 'tile', 'training');
  box(94, G - 1, 92, 110, G - 1, 104, 'tile', 'fanzone');
  box(10, G - 1, 34, 118, G - 1, 40, 'tile', 'entrance');
  box(10, G - 1, 104, 118, G - 1, 108, 'tile', 'exit');
  box(6, G - 1, 6, 118, G - 1, 18, 'asphalt', 'parking');
  box(6, G - 1, 110, 118, G - 1, 116, 'road_main', 'road_main');
  box(6, G - 1, 118, 60, G - 1, 120, 'road_emerg', 'road_emergency');
  box(62, G - 1, 118, 118, G - 1, 120, 'bus_lane', 'road_bus');
  box(6, G - 1, 122, 40, G - 1, 126, 'pavement', 'transit');
  for (const [fx, fz] of [[32, 40], [96, 40], [32, 86], [96, 86]]) {
    for (let y = G; y < G + 12; y++) w.setBlock(fx, y, fz, B('steel'));
    w.setBlock(fx, G + 12, fz, B('floodlight'));
  }

  app.game.markWorldDirty();
  app.game.analyze(true);
  app.game.registerVenue(app.game.primaryVenue.key, 'Riverside Stadium');

  // Give the management screens some history to display.
  s.reputation.venue = 58;
  s.cash = 25_000_000;
  s.stats.bidsWon = 6;
  s.stats.eventsHosted = 5;
  s.stats.totalAttendance = 148_000;
  s.stats.lifetimeProfit = 9_400_000;
  s.stats.sportsHosted = ['football', 'basketball'];
  s.rivals[0].news = [{ day: 3, text: 'Expanded to 15,400 seats.' }];
  // Real transactions so the ledger has something to show.
  app.game.spendConstruction(1_250_000);
  app.game.record('tickets', 820_000);
  app.game.record('staff', -140_000);
  app.game.analyze(true);
  app.worldRenderer.rebuildAll();
  app.worldRenderer.flush();
  app.refresh();
});
await page.waitForTimeout(1200);

const problems = [];
const openTab = async (name) => {
  await page.locator('.tabs button', { hasText: new RegExp(`^${name}$`) }).first().click();
  await page.waitForTimeout(450);
};

// Home, Finance and the whole Management stack.
await page.getByRole('tab', { name: 'Home' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/S-home.png` });

await page.getByRole('tab', { name: 'Finance' }).click();
await page.waitForTimeout(500);
for (const t of ['Summary', 'Ledger', 'Loans']) {
  await openTab(t);
  const text = await page.locator('.sheet-body').innerText();
  const hasEmptyState = await page.locator('.sheet-body .emptystate').count();
  if (text.trim().length < 40 && !hasEmptyState) problems.push(`Finance/${t} rendered almost nothing`);
  await page.screenshot({ path: `${SHOTS}/S-finance-${t.toLowerCase()}.png` });
}

await page.getByRole('tab', { name: 'More' }).click();
await page.waitForTimeout(500);
for (const t of ['Clubs', 'Hosting', 'Programmes', 'Staff', 'Sponsors', 'Research', 'Infra', 'Rivals', 'Community', 'Goals', 'Awards', 'Settings']) {
  await openTab(t);
  const text = await page.locator('.sheet-body').innerText();
  const hasEmptyState = await page.locator('.sheet-body .emptystate').count();
  if (text.trim().length < 40 && !hasEmptyState) problems.push(`More/${t} rendered almost nothing`);
  await page.screenshot({ path: `${SHOTS}/S-more-${t.toLowerCase()}.png` });
  console.log(`  ✓ ${t}`);
}

// The infrastructure screen must actually be able to buy something.
await openTab('Infra');
const upgradeBtn = page.locator('.sheet-body button', { hasText: /Upgrade to/ }).first();
if (await upgradeBtn.count()) {
  const tiers = () => page.evaluate(() => ({ ...window.__sct.game.site.utilities }));
  const before = await tiers();
  await upgradeBtn.click();
  await page.waitForTimeout(500);
  const after = await tiers();
  console.log('  \u2713 utility upgrade purchased (' + JSON.stringify(after) + ')');
  if (!Object.keys(after).some((k) => after[k] > before[k])) problems.push('no utility tier changed');
} else {
  problems.push('no utility upgrade button offered');
}

// The empire screen should list the site you are on, and let you expand.
await openTab('Empire');
const empireText = await page.locator('.sheet-body').innerText();
if (!/Riverside/.test(empireText)) problems.push('Empire tab does not list your site');
if (!/reputation of 55|Buy land in/.test(empireText)) problems.push('Empire tab does not explain expansion');
await page.screenshot({ path: `${SHOTS}/S-more-empire.png` });

await page.evaluate(() => {
  const app = window.__sct;
  app.game.state.reputation.venue = 70;
  app.game.state.cash = 300_000_000;
  app.screens.openMore('Empire');
});
await page.waitForTimeout(500);
const buy = page.locator('.sheet-body button', { hasText: /Buy land in/ }).first();
if (!await buy.count()) {
  problems.push('no city available to buy into');
} else {
  await buy.click();
  await page.waitForTimeout(600);
  const sites = await page.evaluate(() => window.__sct.game.state.sites.length);
  if (sites !== 2) problems.push('expected 2 sites after buying, got ' + sites);
  else console.log('  \u2713 bought land in a second city');
  await page.screenshot({ path: `${SHOTS}/S-more-empire-2.png` });

  const travel = page.locator('.sheet-body button', { hasText: /^Travel here$/ }).first();
  if (!await travel.count()) {
    problems.push('cannot travel to the new site');
  } else {
    await travel.click();
    await page.waitForTimeout(1400);
    const at = await page.evaluate(() => ({
      site: window.__sct.game.siteId,
      blocks: window.__sct.game.analysis.complex.totalBlocks,
      chunks: window.__sct.worldRenderer.meshes.size,
    }));
    if (at.site === 'site1') problems.push('travel did not switch sites');
    console.log('  \u2713 travelled to ' + at.site + ' (' + at.chunks + ' chunks, ' + at.blocks + ' blocks)');
    await page.screenshot({ path: `${SHOTS}/S-second-site.png` });

    await page.evaluate(() => window.__sct.travelTo('site1'));
    await page.waitForTimeout(1400);
    const home = await page.evaluate(() => ({
      site: window.__sct.game.siteId,
      venue: window.__sct.game.primaryVenue?.name,
      cap: window.__sct.game.primaryVenue?.capacity.total,
    }));
    if (home.site !== 'site1' || !home.venue) problems.push('the home site did not come back');
    console.log('  \u2713 returned home to ' + home.venue + ' (' + home.cap + ' capacity)');

    // Buying a bigger plot grows the land around what is already standing, so
    // the stadium keeps its place on the plot and the view stays on it. If it
    // did not, every parcel after the first would be half wasted.
    const land = await page.evaluate(async () => {
      const a = window.__sct;
      const before = {
        size: a.game.world.size,
        cap: a.game.primaryVenue.capacity.total,
        centre: { ...a.game.primaryVenue.centre },
        cam: { x: a.rig.focus.x, z: a.rig.focus.z },
        registered: a.game.state.venues.registered.length,
        name: a.game.primaryVenue.name,
      };
      a.game.state.cash = 300_000_000;
      const r = a.game.buyLand();
      await new Promise((res) => setTimeout(res, 600));
      const v = a.game.primaryVenue;
      return {
        ok: !!r.ok, before,
        after: {
          size: a.game.world.size,
          cap: v.capacity.total,
          centre: { ...v.centre },
          cam: { x: a.rig.focus.x, z: a.rig.focus.z },
          registered: a.game.state.venues.registered.length,
          name: v.name,
          meshes: a.worldRenderer.meshes.size,
        },
      };
    });
    const b = land.before, af = land.after;
    if (!land.ok) problems.push('could not buy a bigger plot');
    else if (af.size <= b.size) problems.push('the plot did not get bigger');
    else {
      const offset = (af.size - b.size) / 2;
      const moved = af.centre.x - b.centre.x;
      if (Math.abs(moved - offset) > 2) {
        problems.push('the stadium did not stay put on its plot: expected it to move '
          + offset + ' voxels, it moved ' + moved);
      }
      if (af.cap !== b.cap) problems.push('capacity changed on a land purchase: ' + b.cap + ' -> ' + af.cap);
      if (af.registered !== b.registered || af.name !== b.name) {
        problems.push('the venue lost its registration or its name when the plot grew');
      }
      const camMoved = af.cam.x - b.cam.x;
      if (Math.abs(camMoved - offset * 2) > 4) {
        problems.push('the camera did not follow the complex (moved ' + camMoved.toFixed(0) + 'm)');
      }
      console.log('  \u2713 the plot grew to ' + af.size + ' around the stadium; ' + af.cap
        + ' seats kept, ' + af.meshes + ' chunks redrawn');
      await page.screenshot({ path: `${SHOTS}/S-bigger-plot.png` });
    }
  }
}

if (errors.length) { console.error('CONSOLE ERRORS:', errors); throw new Error(`${errors.length} console errors`); }
if (problems.length) { console.error('PROBLEMS:', problems); throw new Error(`${problems.length} screen problems`); }
console.log('\nSCREENS OK');
await browser.close();
