import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION|MIME|fonts\.googleapis/.test(m.text())) errors.push(m.text()); });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.getByRole('button', { name: /Start building/i }).click();
await page.waitForFunction(() => window.__sct?.worldRenderer, null, { timeout: 15000 });

// A ground good enough for a club to want it.
await page.evaluate(async () => {
  const a = window.__sct;
  a.tutorial.dismiss();
  a.game.state.cash = 300_000_000;
  a.game.state.reputation.venue = 70;
  const { buildReferenceStadium } = await import('/src/../tests/helpers/buildStadium.js').catch(() => ({}));
  return true;
});
// Use the dev API to build a stadium instead (tests/ is not served).
await page.evaluate(() => {
  const a = window.__sct;
  const w = a.game.world, B = a.dev.blockId, Z = a.dev.zoneId, G = 8;
  const cx = 64, cz = 60, pw = 53, pd = 34;
  for (let z = cz - pd / 2; z < cz + pd / 2; z++)
    for (let x = cx - pw / 2; x < cx + pw / 2; x++)
      w.setBlock(Math.round(x), G - 1, Math.round(z), B('turf'), Z('pitch_football'));
  for (let r = 3; r < 16; r++) {
    const y = G + Math.floor((r - 3) * 0.8);
    const x0 = cx - 27 - r, x1 = cx + 26 + r, z0 = cz - 17 - r, z1 = cz + 16 + r;
    const conc = r % 6 === 0;
    const col = (x, z) => {
      for (let yy = G - 1; yy < y; yy++) w.setBlock(x, yy, z, B('concrete'));
      w.setBlock(x, y, z, conc ? B('pavement') : B('seat'), conc ? Z('concourse') : Z('seating'));
    };
    for (let x = x0; x <= x1; x++) { col(x, z0); col(x, z1); }
    for (let z = z0 + 1; z < z1; z++) { col(x0, z); col(x1, z); }
  }
  for (const [zk, bk, x0, z0, w2, d2] of [['restroom','tile',20,20,12,10],['concession','tile',36,20,12,10],
      ['medical','tile',52,20,10,8],['locker','tile',20,96,14,10],['concourse','pavement',36,96,24,10],
      ['entrance','pavement',66,20,10,8],['exit','pavement',66,96,10,8],['parking','asphalt',86,20,26,26]]) {
    for (let z = z0; z < z0 + d2; z++) for (let x = x0; x < x0 + w2; x++) w.setBlock(x, G - 1, z, B(bk), Z(zk));
  }
  a.game.markWorldDirty(); a.game.analyze(true);
  const v = a.game.primaryVenue;
  a.game.registerVenue(v.key, 'Riverside Stadium');
  a.game.analyze(true);
  a.worldRenderer.rebuildAll(); a.worldRenderer.flush(); a.refresh();
});
await page.waitForTimeout(600);

await page.evaluate(() => window.__sct.screens.openMore('Clubs'));
await page.waitForTimeout(600);
const text = await page.locator('.sheet-body').innerText();
console.log('  season card:', text.split('\n').slice(0, 4).join(' | '));
if (!/SEASON/.test(text)) throw new Error('Clubs screen has no season card');

const signBtn = page.locator('.sheet-body button', { hasText: /Sign for 3 seasons/ }).first();
if (!await signBtn.count()) { console.log(text.slice(0, 600)); throw new Error('no club offered a tenancy'); }
const offered = (await page.locator('.sheet-body .card.tight').nth(0).innerText()).split('\n')[0];
await signBtn.click();
await page.waitForTimeout(600);
const after = await page.evaluate(() => {
  const g = window.__sct.game;
  const t = g.tenants()[0];
  return t ? { club: t.club.name, fixtures: t.fixtures.length, rent: t.rent, cash: g.state.cash } : null;
});
if (!after) throw new Error('signing produced no tenant');
console.log(`  ✓ signed ${after.club}: ${after.fixtures} home fixtures, rent $${(after.rent/1e6).toFixed(2)}M`);

// Play a season and see the table fill in.
await page.evaluate(() => { for (let i = 0; i < 290; i++) window.__sct.game.skipDay(1); });
await page.waitForTimeout(400);
await page.evaluate(() => window.__sct.screens.openMore('Clubs'));
await page.waitForTimeout(500);
const body = await page.locator('.sheet-body').innerText();
const played = await page.evaluate(() => {
  const g = window.__sct.game;
  return { season: g.state.league.season, results: g.state.league.results.length,
           hosted: g.state.stats.eventsHosted, att: g.state.stats.totalAttendance };
});
console.log(`  ✓ season ${played.season}, ${played.results} results, ${played.hosted} events, ${played.att.toLocaleString()} through the gates`);
if (played.results < 5) throw new Error(`only ${played.results} fixtures played`);
if (!/RECENT RESULTS/i.test(body)) throw new Error('no results shown on the Clubs screen');
const opponents = new Set((await page.evaluate(() => window.__sct.game.state.league.results.map(r => r.away))));
console.log(`  \u2713 ${opponents.size} different visitors in the fixture list`);
if (opponents.size < 3) throw new Error('the fixture list keeps playing the same club');
await page.screenshot({ path: '/tmp/clubs.png' });
if (errors.length) { console.error('CONSOLE ERRORS:', errors.slice(0, 3)); throw new Error(`${errors.length} console errors`); }
console.log('\nCLUBS OK');
await browser.close();
