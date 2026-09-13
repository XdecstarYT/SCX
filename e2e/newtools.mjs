/**
 * Drives the geometry tools, the two big structure tools and a prefab through
 * the real dock, on the real renderer. The unit tests hold each generator to
 * its own hint; this proves the buttons a player actually taps reach them.
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

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.getByRole('button', { name: /Start building/i }).click();
await page.waitForFunction(() => window.__sct?.worldRenderer, null, { timeout: 15000 });

await page.evaluate(() => {
  const a = window.__sct;
  a.game.state.paused = true;
  // Every research project done, so nothing under test is gated, and enough
  // cash that a failure is a bug rather than an empty wallet.
  a.game.state.cash = 900_000_000;
  a.game.state.research.completed = a.dev.researchIds();
  a.game.state.reputation.venue = 90;
  a.rig.focusOn(66 * 2, 8 * 2, 60 * 2, 235);
  a.rig.pitch = 1.16;
  a.rig.yaw = -0.55;
  a.tutorial.dismiss();
  // Room to work: the starter plot is 128 voxels a side and a bowl around a
  // full pitch wants most of that on its own.
  a.game.buyLand(); a.game.buyLand(); a.game.buyLand();
  a.game.state.cash = 900_000_000;
});
await page.waitForTimeout(600);
const PLOT = await page.evaluate(() => window.__sct.game.world.size);
console.log(`  plot is ${PLOT} voxels a side`);

const frame = async (cx, cz, dist) => {
  await page.evaluate(([x, z, d]) => {
    const a = window.__sct;
    a.rig.focusOn(x * 2, 16, z * 2, d);
    a.rig.pitch = 1.2; a.rig.yaw = -0.4;
  }, [cx, cz, dist]);
  await page.waitForTimeout(280);
};
const tap = async (vx, vy, vz) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const p = await page.evaluate(([x, y, z]) => {
      const q = window.__sct.dev.project(x, y, z);
      const hit = document.elementFromPoint(q.x, q.y);
      return { ...q, overCanvas: hit?.tagName === 'CANVAS' };
    }, [vx, vy, vz]);
    if (p.onScreen && p.overCanvas) {
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(90);
      return;
    }
    await page.evaluate(() => { window.__sct.rig.zoom(1.3); });
    await page.waitForTimeout(180);
  }
  throw new Error(`voxel ${vx},${vy},${vz} could not be tapped`);
};
const pickMode = async (name) => {
  await page.locator('.modebar button', { hasText: new RegExp(`^${name}$`, 'i') }).first().click();
  await page.waitForTimeout(150);
};
const pickTool = async (name) => {
  const b = page.locator(`.toolrow button[aria-label="${name}"]`).first();
  if (!await b.count()) throw new Error(`no tool button labelled "${name}"`);
  await b.click();
  await page.waitForTimeout(120);
};
const openPalette = async () => {
  await page.locator('.toolrow button[aria-label="Open the palette"]').first().click();
  await page.waitForTimeout(280);
};
const pickCategory = async (name) => {
  if (!await page.locator('.sheet-body .catrow').count()) await openPalette();
  await page.locator('.sheet-body .catrow button', { hasText: new RegExp(`^${name}$`, 'i') }).first().click();
  await page.waitForTimeout(150);
};
const pickSwatch = async (name) => {
  if (!await page.locator('.sheet-body .palette').count()) await openPalette();
  await page.locator(`.sheet-body .palette-item[aria-label="${name}"]`).first().click();
  await page.waitForTimeout(320);
};
/** Anything big enough to stage goes up over days; pay to have it now. */
const finishBuilding = async () => {
  await page.evaluate(() => {
    const g = window.__sct.game;
    g.state.cash = 900_000_000;
    for (const p of [...(g.state.construction || [])]) g.rushConstruction(p.id);
    g.analyze(true);
  });
  await page.waitForTimeout(220);
};
const count = (key) => page.evaluate((k) => {
  const w = window.__sct.game.world;
  return w.blockCounts.get(window.__sct.dev.blockId(k)) || 0;
}, key);
const solidAt = (x, y, z) => page.evaluate(([a, b, c]) =>
  window.__sct.game.world.isSolid(a, b, c), [x, y, z]);

const GY = 7;    // top of the terrain; a tap on it places at y = 8
const Y = GY + 1;
const fail = [];
const ok = (msg) => console.log('  ✓ ' + msg);
const check = (cond, msg) => { if (cond) ok(msg); else { fail.push(msg); console.log('  ✗ ' + msg); } };

await frame(90, 70, 320);
await pickMode('BUILD');
await pickCategory('Structure');
await pickSwatch('Concrete');

// ------------------------------------------------------------------ circle
console.log('  Circle...');
await pickTool('Circle');
let before = await count('concrete');
await tap(60, GY, 50);
await tap(79, GY, 69);
await finishBuilding();
const disc = (await count('concrete')) - before;
check(disc > 280 && disc < 330, `Circle filled ${disc} blocks of a 400-block box (expect ~314)`);
check(!(await solidAt(60, Y, 50)), 'the box corner is outside the disc, as it should be');
check(await solidAt(69, Y, 59), 'the middle of the disc is solid');

// ---------------------------------------------------------------- cylinder
console.log('  Cylinder...');
await pickTool('Cylinder');
before = await count('concrete');
await tap(90, GY, 50);
await tap(105, GY, 65);
await finishBuilding();
const tube = (await count('concrete')) - before;
check(tube > 100, `Cylinder raised ${tube} blocks`);
check(await solidAt(97, Y + 2, 50) || await solidAt(98, Y + 2, 50), 'the cylinder wall reaches above the ground');
check(!(await solidAt(97, Y, 57)), 'the cylinder is hollow');

// -------------------------------------------------------------------- dome
console.log('  Dome...');
await pickTool('Dome');
before = await count('concrete');
await tap(60, GY, 80);
await tap(79, GY, 99);
await finishBuilding();
const shell = (await count('concrete')) - before;
check(shell > 150, `Dome laid a ${shell}-block shell`);
check(await solidAt(69, Y + 9, 89) || await solidAt(70, Y + 9, 90), 'the dome has an apex');
check(!(await solidAt(69, Y + 4, 89)), 'the dome is a shell, not a solid lump');

// ------------------------------------------------------------------- gable
console.log('  Gable...');
await pickTool('Gable');
before = await count('concrete');
await tap(90, GY, 80);
await tap(119, GY, 99);
await finishBuilding();
const roof = (await count('concrete')) - before;
check(roof > 500, `Gable laid ${roof} blocks`);
check(await solidAt(105, Y + 9, 89) || await solidAt(105, Y + 9, 90), 'the ridge is at the top of the pitch');
check(await solidAt(105, Y, 80), 'the eave sits at the height it was tapped');

// ------------------------------------------------------------------ stairs
console.log('  Stairs...');
await pickTool('Stairs');
before = await count('concrete');
await tap(130, GY, 50);
await tap(139, GY, 52);
await finishBuilding();
check((await count('concrete')) - before > 30, 'Stairs built a flight');
check(await solidAt(130, Y, 50) && !(await solidAt(130, Y + 3, 50)), 'the bottom step is one block high');

await frame(95, 75, 340);
await page.screenshot({ path: `${SHOTS}/tools-geometry.png` });

// ------------------------------------------------- a pitch, then a bowl
console.log('  Bowl around a pitch...');
await pickCategory('Surfaces');
await pickSwatch('Natural Turf');
await pickTool('Floor');
await frame(128, 170, 340);
await tap(100, GY, 150);
await tap(155, GY, 185);
await finishBuilding();
check(await count('turf') > 1300, `the pitch is ${await count('turf')} turf blocks`);

await pickCategory('Seating');
await pickSwatch('Seating');
await pickTool('Bowl');
await frame(128, 170, 480);
await tap(100, GY, 150);
await tap(155, GY, 185);
await finishBuilding();
const seats = await count('seat');
check(seats > 1500, `the bowl laid ${seats} seating blocks`);

const sides = await page.evaluate(() => {
  const w = window.__sct.game.world;
  const seat = window.__sct.dev.blockId('seat');
  const box = (x0, x1, z0, z1) => {
    let n = 0;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++)
      for (let y = 8; y < 30; y++) if (w.getBlock(x, y, z) === seat) n++;
    return n;
  };
  return {
    north: box(100, 155, 138, 149), south: box(100, 155, 186, 197),
    west: box(88, 99, 150, 185), east: box(156, 167, 150, 185),
    corner: box(88, 99, 138, 149),
  };
});
for (const [k, v] of Object.entries(sides)) check(v > 20, `the bowl's ${k} tier has ${v} seats`);

const cap = await page.evaluate(() => {
  window.__sct.game.analyze(true);
  return window.__sct.game.analysis?.venues?.[0]?.capacity?.total || 0;
});
check(cap > 8000, `the analyser reads the bowl as ${cap.toLocaleString()} spectators`);

// ------------------------------------------------------------------ canopy
console.log('  Canopy over the north tier...');
const coverBefore = await page.evaluate(() =>
  window.__sct.game.analysis?.venues?.[0]?.seatRoofCoverage ?? 0);
await pickCategory('Roofing');
await pickSwatch('Metal Roof');
await pickTool('Canopy');
await tap(100, GY, 138);
await tap(155, GY, 149);
await finishBuilding();
const coverAfter = await page.evaluate(() => {
  window.__sct.game.analyze(true);
  return window.__sct.game.analysis?.venues?.[0]?.seatRoofCoverage ?? 0;
});
check(coverAfter > coverBefore, `roof coverage went ${coverBefore.toFixed(2)} -> ${coverAfter.toFixed(2)}`);

await frame(128, 168, 480);
await page.screenshot({ path: `${SHOTS}/tools-bowl.png` });

// ------------------------------------------------------------------ prefab
console.log('  Prefab library...');
await pickMode('BLUEPRINT');
await page.locator('.toolrow button[aria-label="Open the structure library"]').first().click();
await page.waitForTimeout(500);
const card = page.locator('.sheet-body button.card', { hasText: /Netball Court/i }).first();
check(await card.count() > 0, 'the Netball Court prefab is listed');
if (await card.count()) {
  await card.click();
  await page.waitForTimeout(300);
  await frame(180, 70, 260);
  await tap(170, GY, 60);
  await finishBuilding();
  const netball = await page.evaluate(() => {
    const w = window.__sct.game.world;
    return w.zoneCounts.get(window.__sct.dev.zoneId('court_netball')) || 0;
  });
  check(netball > 100, `the netball court laid ${netball} zoned voxels`);
}

await page.screenshot({ path: `${SHOTS}/tools-prefab.png` });

if (errors.length) { console.log('  page errors:'); for (const e of errors) console.log('    ' + e); }
await browser.close();
if (fail.length || errors.length) {
  console.log(`\nFAILED: ${fail.length} checks, ${errors.length} page errors`);
  process.exit(1);
}
console.log('\nnew build tools: all checks passed');
