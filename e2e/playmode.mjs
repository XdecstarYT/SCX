/**
 * The two modes, driven the way a player drives them.
 *
 * Covers the three things this update is: a tap places once and a hold sweeps;
 * the Arrange toolbox repaints and rearranges what is already built without
 * charging for a rebuild; and Play mode is a real mode - the dock, the taps
 * and the reward all change when you walk in.
 */
import { chromium } from 'playwright';

const SHOTS = process.env.SHOTS || '/tmp/shots';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const errors = [];
const fails = [];
const check = (ok, what) => {
  if (ok) console.log(`  ok  ${what}`);
  else { console.log(`  FAIL ${what}`); fails.push(what); }
};

// A phone-shaped, touch-capable context: the action pad only exists there, and
// it is the surface the double-place bug was reported on.
const ctx = await browser.newContext({
  viewport: { width: 430, height: 900 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/ERR_CONNECTION_RESET|MIME type|fonts\.googleapis/.test(t)) errors.push(t);
});

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByRole('button', { name: /Start building/i }).click();
await page.waitForFunction(() => window.__sct?.worldRenderer, null, { timeout: 25000 });
await page.evaluate(() => {
  const a = window.__sct;
  a.game.state.paused = true;
  a.game.state.cash = 60_000_000;
  a.tutorial.dismiss();
});
await page.waitForTimeout(400);

const snap = () => page.evaluate(() => ({
  undos: window.__sct.game.history.undoStack.length,
  cash: Math.round(window.__sct.game.state.cash),
}));

// ==================================================== 1. one tap, one block
console.log('one tap places once...');

// How long the repeat waits before it starts, in ms. Kept here rather than
// imported because the bundle is what is under test.
const REPEAT_DELAY_MS = 340;

// Time the press inside the page rather than trusting the harness to deliver
// one. A loaded machine can turn an intended 60ms tap into half a second by
// the time the pointerup arrives, and at that point two blocks is the correct
// answer - so the assertion has to be made against the press that actually
// happened, not the one that was asked for.
await page.evaluate(() => {
  const btn = document.querySelector('button.abtn.place');
  window.__hold = {};
  btn.addEventListener('pointerdown', () => { window.__hold.down = performance.now(); }, true);
  window.addEventListener('pointerup', () => { window.__hold.up = performance.now(); }, true);
});

const hold = async (ms) => {
  const b = await (await page.$('button.abtn.place')).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const h = await page.evaluate(() => window.__hold);
  return Math.round((h.up ?? 0) - (h.down ?? 0));
};

await page.evaluate(() => {
  const a = window.__sct;
  a.rig.focusOn(60 * 2, 16, 60 * 2, 90);
  a.rig.pitch = 0.8; a.rig.yaw = -0.5;
});
await page.waitForTimeout(400);

let shortPresses = 0;
for (const ms of [40, 110, 300]) {
  const before = await snap();
  const held = await hold(ms);
  const placed = (await snap()).undos - before.undos;
  if (held < REPEAT_DELAY_MS) {
    shortPresses++;
    check(placed === 1, `a ${held}ms tap places exactly once (placed ${placed})`);
  } else {
    // The press overran the delay, so the repeat firing is the design working.
    check(placed >= 1, `press overran to ${held}ms and swept (${placed}) - as designed`);
  }
}
// If every press overran, the tap path was never actually exercised and a
// green run would mean nothing.
check(shortPresses >= 2,
  `at least two presses were genuinely shorter than the repeat delay (${shortPresses} of 3)`);

// ...and a deliberate hold still sweeps, or the tool is useless for walls.
{
  const before = await snap();
  await hold(1500);
  const after = await snap();
  check(after.undos - before.undos >= 3,
    `holding for 1.5s sweeps out a run (placed ${after.undos - before.undos})`);
}

// ======================================================== 2. Arrange: paint
console.log('arrange: repainting a wall...');
await page.evaluate(() => {
  const a = window.__sct, w = a.game.world, id = a.dev.blockId;
  for (let x = 30; x < 42; x++) for (let y = 8; y < 12; y++) w.setBlock(x, y, 30, id('brick'), 0);
  a.game.markWorldDirty();
  a.rig.focusOn(36 * 2, 20, 36 * 2, 46);
  a.rig.pitch = 0.28; a.rig.yaw = 0;
});
await page.waitForTimeout(500);

const blockCount = (k) => page.evaluate((key) => {
  const w = window.__sct.game.world;
  return w.blockCounts.get(window.__sct.dev.blockId(key)) || 0;
}, k);

const pickMode = async (name) => {
  await page.locator('.modebar button', { hasText: new RegExp(`^${name}$`, 'i') }).first().click();
  await page.waitForTimeout(180);
};
const pickTool = async (label) => {
  await page.locator(`.toolrow button[aria-label="${label}"]`).first().click();
  await page.waitForTimeout(150);
};

await pickMode('Arrange');
check(await page.locator('.toolrow button[aria-label="Paint"]').count() > 0,
  'the Arrange mode has a Paint tool');

await pickTool('Surface');
await page.evaluate(() => { window.__sct.controller.setMaterial(window.__sct.dev.blockId('glass')); });
const brick0 = await blockCount('brick');
const glass0 = await blockCount('glass');
const solid0 = await page.evaluate(() => window.__sct.game.world.blockCounts
  ? [...window.__sct.game.world.blockCounts.values()].reduce((a, b) => a + b, 0) : 0);

// Aim at the face of the wall and tap it.
await page.evaluate(() => {
  const a = window.__sct;
  a.lastNdc = null;
  a.controller.updateAim(null);
});
{
  const p = await page.evaluate(() => window.__sct.dev.project(36, 10, 29));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(500);
}
const brick1 = await blockCount('brick');
const glass1 = await blockCount('glass');
const solid1 = await page.evaluate(() => [...window.__sct.game.world.blockCounts.values()].reduce((a, b) => a + b, 0));
check(glass1 - glass0 >= 12 && brick0 - brick1 === glass1 - glass0,
  `one tap repainted a whole face: ${brick0 - brick1} brick became ${glass1 - glass0} glass`);
check(solid1 === solid0, 'painting changed no block count overall, only what they are');

// ======================================================== 3. Arrange: move
console.log('arrange: moving a fitting...');
await page.evaluate(() => {
  const a = window.__sct;
  a.dev.prop('scoreboard_sm', 50, 8, 50, 0);
  a.game.markWorldDirty();
  a.rig.focusOn(50 * 2, 16, 50 * 2, 40);
  a.rig.pitch = 0.5; a.rig.yaw = 0.3;
});
await page.waitForTimeout(500);
await pickTool('Move');
const cashBefore = (await snap()).cash;
const undosBefore = (await snap()).undos;
{
  const p = await page.evaluate(() => window.__sct.dev.projectProp(50, 8, 50));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(350);
}
check(await page.evaluate(() => window.__sct.controller.isCarrying),
  'tapping a fitting in Move mode picks it up');
{
  const p = await page.evaluate(() => window.__sct.dev.project(54, 7, 53));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
}
const moved = await page.evaluate(() => {
  const l = window.__sct.game.world.props;
  return { gone: !l.at(50, 8, 50), count: l.size,
           where: [...l.byAnchor.values()].map((r) => `${r.x},${r.y},${r.z}`) };
});
const after3 = await snap();
check(moved.where.length === 1 && moved.where[0] !== '50,8,50',
  `the fitting moved rather than being duplicated (now at ${moved.where.join(' + ')})`);
check(after3.cash === cashBefore, `moving something you own is free (cash ${cashBefore} -> ${after3.cash})`);
check(after3.undos - undosBefore === 1, 'the move is a single undo step');

// ============================================================ 4. Play mode
console.log('play mode...');
await page.evaluate(() => {
  const a = window.__sct;
  a.game.state.cash = 60_000_000;
  a.dev.prefab('pitch_soccer', 60, 8, 60, 0);
  a.dev.prefab('grandstand_sm', 60, 8, 44, 0);
  a.dev.prefab('entrance_gate', 42, 8, 62, 0);
  a.dev.prefab('car_park', 34, 8, 86, 0);
  const w = a.game.world, zid = a.dev.zoneId, bid = a.dev.blockId;
  const patch = (zk, x0, z0, wd, dp) => {
    for (let x = x0; x < x0 + wd; x++) for (let z = z0; z < z0 + dp; z++) {
      w.setBlock(x, 8, z, bid('floor_conc'), zid(zk));
    }
  };
  patch('restroom', 50, 40, 5, 4);
  patch('concession', 58, 40, 5, 4);
  patch('concourse', 48, 36, 26, 3);
  patch('exit', 80, 42, 3, 4);
  a.game.markWorldDirty();
  a.game.analyze(true);
});
await page.waitForTimeout(1200);
check((await page.evaluate(() => window.__sct.game.analysis.venues.length)) > 0,
  'the test ground is a venue the game recognises');

await page.getByRole('tab', { name: 'Play' }).click();
await page.waitForTimeout(900);

check(await page.evaluate(() => window.__sct.tab) === 'play', 'the Play tab actually switches mode');
check(await page.evaluate(() => window.__sct.rig.isWalking), 'play mode puts you on your feet');
check(await page.evaluate(() => !window.__sct.controller.ghost.visible || window.__sct.controller.ghost.count === 0),
  'the build ghost is gone in play mode');
check(await page.locator('.modebar').count() === 0, 'the build dock is replaced, not just covered');
check(await page.locator('.playdock').count() === 1, 'the play dock is up');

const stops = await page.evaluate(() => window.__sct.walkStops.length);
check(stops >= 5, `the walk found ${stops} places worth standing`);

const spot = await page.evaluate(() => {
  const r = window.__sct.spot;
  return r && { zone: r.zone?.name, score: r.score, width: r.widthMetres, notes: r.notes.length,
                amen: r.amenities.filter((a) => a.distance !== null).length };
});
check(!!spot && spot.score >= 0 && spot.notes > 0, `standing at the gate reads: ${JSON.stringify(spot)}`);
check(spot.amen >= 2, 'the amenity distances are measured, not guessed');

// A tap in play mode reads, it does not build.
const beforeTap = await snap();
{
  const p = await page.evaluate(() => window.__sct.dev.project(60, 8, 60));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
}
check((await snap()).undos === beforeTap.undos && (await snap()).cash === beforeTap.cash,
  'tapping the world in play mode changes nothing');

await page.screenshot({ path: `${SHOTS}/play-mode.png` });

// Walk the whole site and file the report.
const list = await page.evaluate(() => window.__sct.walkStops.map((s) => [s.x, s.y, s.z]));
for (const [x, y, z] of list) {
  await page.evaluate(([x, y, z]) => {
    const a = window.__sct;
    a.rig.pos.set((x + 0.5) * 2, (y + 1) * 2 + 0.1, (z + 0.5) * 2);
    a.rig.vel.set(0, 0, 0);
    a.updatePlay(true);
  }, [x, y, z]);
  await page.waitForTimeout(70);
}
const done = await page.evaluate(() => {
  const a = window.__sct;
  return a.game.state.siteWalk.visited.length === a.walkStops.length;
});
check(done, 'walking to every stop ticks the whole list off');

const rep0 = await page.evaluate(() => window.__sct.game.state.reputation.venue);
const safety0 = await page.evaluate(() => {
  const a = window.__sct; a.game.analyze(true);
  return a.game.analysis.venues[0].ratings.safety;
});
await page.locator('.playdock button[aria-label="File the inspection report"]').first().click();
await page.waitForTimeout(600);
const rep1 = await page.evaluate(() => window.__sct.game.state.reputation.venue);
const safety1 = await page.evaluate(() => {
  const a = window.__sct;
  a.game.analyze(true);
  return a.game.analysis.venues[0].ratings.safety;
});
check(rep1 > rep0, `filing the inspection is worth something (rep ${rep0} -> ${rep1})`);
check(safety1 > safety0, `the certificate lifts safety while it is in date (${safety0} -> ${safety1})`);

// Back to building, and everything works again.
await page.getByRole('tab', { name: 'Build' }).click();
await page.waitForTimeout(600);
check(await page.evaluate(() => window.__sct.tab) === 'build', 'you can leave play mode again');
// Still on foot, so the dock is the compact walking one - that is the right
// dock for the camera, and the hotbar has to be under it either way.
check(await page.locator('.immersive').count() === 1, 'building on foot keeps the compact dock');
check(await page.locator('.hotbar-bar').count() === 1, 'the hotbar comes back with it');
await page.evaluate(() => {
  const a = window.__sct;
  a.setCamera('free');
  a.rig.focusOn(20 * 2, 16, 20 * 2, 70);
  a.rig.pitch = 0.8; a.rig.yaw = -0.5;
});
await page.waitForTimeout(500);
check(await page.locator('.modebar').count() === 1, 'the full build dock comes back with the free camera');
{
  await page.evaluate(() => { window.__sct.controller.setMode('build'); window.__sct.controller.setTool('single'); });
  await page.waitForTimeout(200);
  const before = await snap();
  const held = await hold(60);
  const placed = (await snap()).undos - before.undos;
  // The point here is that building works again at all, so accept whatever a
  // press of this length should produce.
  const want = held < REPEAT_DELAY_MS ? placed === 1 : placed >= 1;
  check(want, `building still works after a round trip through play mode (${held}ms press placed ${placed})`);
}

await page.screenshot({ path: `${SHOTS}/arrange-mode.png` });

// ---------------------------------------------------------------------------
await browser.close();
if (errors.length) { console.error('page errors:\n' + errors.join('\n')); process.exit(1); }
if (fails.length) { console.error(`\n${fails.length} check(s) failed:\n - ` + fails.join('\n - ')); process.exit(1); }
console.log('\nplay + arrange: all checks passed');
