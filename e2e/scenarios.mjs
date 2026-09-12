/**
 * Scenarios through the real UI: pick one from the splash, read the brief,
 * check the starting position is what it claims to be, and watch the clock
 * and the objective panel move.
 */
import { chromium } from 'playwright';
const SHOTS = process.env.SHOTS || '/tmp/shots';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/ERR_CONNECTION|MIME type|fonts\.googleapis/.test(t)) errors.push(t);
});
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);

// The picker is on the splash, before any game exists.
await page.getByRole('button', { name: /Take on a scenario/i }).click();
await page.waitForTimeout(500);
const cards = await page.locator('.scen').count();
if (cards < 5) throw new Error(`the scenario picker offered only ${cards}`);
console.log(`  ✓ ${cards} scenarios offered`);
await page.screenshot({ path: `${SHOTS}/SC-01-picker.png` });

// Take the white elephant: a stadium somebody else built badly.
await page.locator('.scen', { hasText: /White Elephant/ }).first().click();
await page.waitForFunction(() => window.__sct?.worldRenderer, null, { timeout: 15000 });
await page.waitForTimeout(900);
const brief = await page.locator('.modal').first().innerText().catch(() => '');
if (!/White Elephant/i.test(brief)) throw new Error('no brief was shown when the scenario started');
console.log('  ✓ brief shown:', brief.split('\n').slice(0, 2).join(' | '));
await page.screenshot({ path: `${SHOTS}/SC-02-brief.png` });
await page.getByRole('button', { name: /^Begin$/ }).click();
await page.waitForTimeout(700);

const start = await page.evaluate(() => {
  const a = window.__sct, s = a.game.state;
  const v = a.game.primaryVenue;
  return {
    id: s.scenario?.id, deadline: s.scenario?.deadlineDay,
    cash: s.cash, loans: s.loans.length,
    cap: v?.capacity.total || 0, rating: v?.ratings.overall || 0,
    plot: a.game.world.size,
    chip: document.querySelector('.clockbox .chip')?.textContent || '',
  };
});
if (start.id !== 'white_elephant') throw new Error('the wrong scenario started');
if (start.cap < 30_000) throw new Error(`the inherited ground seats only ${start.cap}`);
if (start.rating > 40) throw new Error(`a white elephant should not rate ${start.rating}`);
if (start.loans !== 1) throw new Error('the inherited debt is missing');
if (!/White Elephant/.test(start.chip)) throw new Error(`the HUD chip reads "${start.chip}"`);
console.log(`  ✓ inherited ${start.cap.toLocaleString()} seats at rating ${start.rating}, `
  + `$${(start.cash / 1e6).toFixed(1)}M and ${start.loans} loan`);
console.log(`  ✓ HUD chip: ${start.chip}`);

// The objective panel opens from that chip.
await page.locator('.clockbox .chip').first().click();
await page.waitForTimeout(500);
const panel = await page.locator('.sheet-body').innerText();
for (const want of ['rating', 'loan', 'national']) {
  if (!new RegExp(want, 'i').test(panel)) throw new Error(`the brief panel never mentions "${want}"`);
}
console.log('  ✓ objectives panel lists the brief');
await page.screenshot({ path: `${SHOTS}/SC-03-objectives.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Land is normal here, but the tight site forbids it. Check the rule bites.
const locked = await page.evaluate(() => {
  const a = window.__sct;
  a.game.startScenario('tight_site');
  a.game.state.cash = 500_000_000;
  const r = a.game.buyLand();
  return { locked: a.game.state.landLocked, error: r?.error || null, size: a.game.world.size };
});
if (!locked.locked || !locked.error) throw new Error('the hemmed-in site let land be bought');
console.log(`  ✓ no-land site refuses expansion: "${locked.error}"`);

// The clock resolves: run past the deadline and the run finishes.
const done = await page.evaluate(() => {
  const a = window.__sct, s = a.game.state;
  s.day = s.scenario.deadlineDay - 1;
  a.game.skipDay(1);
  return { finished: s.scenario.finished, outcome: s.scenario.outcome };
});
if (!done.finished || done.outcome !== 'timeout') throw new Error('the deadline never resolved');
console.log(`  ✓ the deadline resolves the run (${done.outcome})`);

if (errors.length) { console.error('CONSOLE ERRORS:', errors.slice(0, 3)); throw new Error(`${errors.length} console errors`); }
console.log('\nSCENARIOS OK');
await browser.close();
