/**
 * Builds a working stadium using nothing but the real UI: selecting materials
 * and tools from the dock and tapping the 3D view. Proves the build tooling a
 * human actually touches produces a venue the simulation recognises.
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

// A high, wide view so every target voxel is on screen and unambiguous.
await page.evaluate(() => {
  const a = window.__sct;
  a.game.state.paused = true;                 // build without the clock running
  a.rig.focusOn(66 * 2, 8 * 2, 60 * 2, 235);
  a.rig.pitch = 1.16;
  a.rig.yaw = -0.55;
  a.tutorial.dismiss();
});
await page.waitForTimeout(500);

// ---------------------------------------------------------------- helpers
const frame = async (cx, cz, dist) => {
  await page.evaluate(([x, z, d]) => {
    const a = window.__sct;
    a.rig.focusOn(x * 2, 16, z * 2, d);
    a.rig.pitch = 1.2;
    a.rig.yaw = -0.4;
  }, [cx, cz, dist]);
  await page.waitForTimeout(300);
};

/**
 * Tap a voxel's top face. Verifies the point is actually over the 3D view and
 * not behind a HUD panel - a tap that lands on the dock would silently change
 * the tool instead of placing a block.
 */
const tap = async (vx, vy, vz) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = await page.evaluate(([x, y, z]) => {
      const q = window.__sct.dev.project(x, y, z);
      const hit = document.elementFromPoint(q.x, q.y);
      return { ...q, overCanvas: hit?.tagName === 'CANVAS' };
    }, [vx, vy, vz]);
    if (p.onScreen && p.overCanvas) {
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(70);
      return;
    }
    // Pull the camera back and try again.
    await page.evaluate(() => { window.__sct.rig.zoom(1.28); });
    await page.waitForTimeout(180);
  }
  throw new Error(`voxel ${vx},${vy},${vz} could not be tapped (off screen or behind the HUD)`);
};
const pickMode = async (name) => {
  await page.locator('.modebar button', { hasText: new RegExp(`^${name}$`, 'i') }).first().click();
  await page.waitForTimeout(150);
};
const pickTool = async (name) => {
  await page.locator(`.toolrow button[aria-label="${name}"]`).first().click();
  await page.waitForTimeout(120);
};
const pickCategory = async (name) => {
  await page.locator('.catrow button', { hasText: new RegExp(`^${name}$`, 'i') }).first().click();
  await page.waitForTimeout(120);
};
const pickSwatch = async (name) => {
  // Block swatches are labelled "Name, $N per block"; zone swatches just "Name".
  const sel = `.hotbar button[aria-label="${name}"], .hotbar button[aria-label^="${name}, "]`;
  await page.locator(sel).first().click();
  await page.waitForTimeout(120);
};
const count = (key) => page.evaluate((k) => {
  const w = window.__sct.game.world;
  return w.blockCounts.get(window.__sct.dev.blockId(k)) || 0;
}, key);
const zoneCount = (key) => page.evaluate((k) => {
  const w = window.__sct.game.world;
  return w.zoneCounts.get(window.__sct.dev.zoneId(k)) || 0;
}, key);

const GY = 7;   // top of the terrain; taps on it place at y = 8
const PITCH = { x0: 40, z0: 40, x1: 93, z1: 74 };

// ------------------------------------------------------- 1. the playing area
console.log('  building the pitch...');
await pickMode('BUILD');
await pickCategory('Surfaces');
await pickSwatch('Natural Turf');
await pickTool('Floor');
await tap(PITCH.x0, GY, PITCH.z0);
await tap(PITCH.x1, GY, PITCH.z1);

const turf = await count('turf');
if (turf < 54 * 35 * 0.95) throw new Error(`Floor tool laid only ${turf} turf blocks`);
console.log(`  ✓ Floor tool laid ${turf} turf blocks and auto-zoned them`);
if (await zoneCount('pitch_football') < turf) throw new Error('turf was not auto-zoned as a football pitch');

// ------------------------------------------------------------- 2. the stands
console.log('  building the stands...');
await pickCategory('Seating');
await pickSwatch('Seating');
await pickTool('Floor');
const strips = [
  [PITCH.x0 - 3, PITCH.z0 - 3, PITCH.x1 + 3, PITCH.z0 - 2],
  [PITCH.x0 - 3, PITCH.z1 + 2, PITCH.x1 + 3, PITCH.z1 + 3],
  [PITCH.x0 - 3, PITCH.z0 - 1, PITCH.x0 - 2, PITCH.z1 + 1],
  [PITCH.x1 + 2, PITCH.z0 - 1, PITCH.x1 + 3, PITCH.z1 + 1],
];
for (const [x0, z0, x1, z1] of strips) {
  await tap(x0, GY, z0);
  await tap(x1, GY, z1);
}
// A second tier, tapped on top of the first.
for (const [x0, z0, x1, z1] of strips) {
  await tap(x0, GY + 1, z0);
  await tap(x1, GY + 1, z1);
}
const seats = await count('seat');
console.log(`  ✓ ${seats} seating blocks placed across two tiers`);
if (seats < 600) throw new Error(`only ${seats} seating blocks`);

// -------------------------------------------------------- 3. back of house
console.log('  building rooms with the Room tool...');
await pickCategory('Surfaces');
await pickSwatch('Tile');
await pickTool('Room');
const rooms = [
  [PITCH.x0 - 12, PITCH.z0 + 2, PITCH.x0 - 6, PITCH.z0 + 10],   // locker
  [PITCH.x0 - 12, PITCH.z0 + 14, PITCH.x0 - 7, PITCH.z0 + 19],  // medical
  [PITCH.x1 + 6, PITCH.z0 + 2, PITCH.x1 + 12, PITCH.z0 + 10],   // restrooms
  [PITCH.x1 + 6, PITCH.z0 + 14, PITCH.x1 + 12, PITCH.z0 + 22],  // concessions
  [PITCH.x0 - 12, PITCH.z0 + 23, PITCH.x0 - 7, PITCH.z0 + 28],  // media
];
for (const [x0, z0, x1, z1] of rooms) {
  await tap(x0, GY, z0);
  await tap(x1, GY, z1);
}
const tiles = await count('tile');
console.log(`  ✓ Room tool built 5 rooms (${tiles} blocks)`);
if (tiles < 200) throw new Error(`Room tool produced only ${tiles} blocks`);

// -------------------------------------------------- 4. parking and approach
console.log('  laying parking and roads...');
await frame(62, 52, 340);   // pull back to reach the plot edges
await pickCategory('Roads & Parking');
await pickSwatch('Local Road');
await pickTool('Floor');
await tap(10, GY, 26);
await tap(115, GY, 28);
await pickSwatch('Main Road');
await tap(10, GY, 29);
await tap(115, GY, 31);
await pickSwatch('Emergency Route');
await tap(10, GY, 24);
await tap(60, GY, 25);

await pickCategory('Surfaces');
await pickSwatch('Asphalt');
await pickTool('Rectangle');
await tap(10, GY, 6);
await tap(115, GY, 22);
console.log('  \u2713 ' + (await count('asphalt')) + ' parking blocks, ' +
  (await count('road')) + ' local + ' + (await count('road_main')) + ' main + ' +
  (await count('road_emerg')) + ' emergency road blocks');

// ------------------------------------------------------- 5. zone the rooms
console.log('  zoning through ZONE mode...');
await frame(66, 58, 250);
await pickMode('ZONE');
await pickTool('Rectangle');
const zoneJobs = [
  ['Facilities', 'Locker Room', rooms[0]],
  ['Facilities', 'Medical', rooms[1]],
  ['Facilities', 'Restrooms', rooms[2]],
  ['Facilities', 'Concessions', rooms[3]],
  ['Facilities', 'Media Centre', rooms[4]],
];
for (const [cat, zoneName, [x0, z0, x1, z1]] of zoneJobs) {
  await pickCategory(cat);
  await pickSwatch(zoneName);
  await tap(x0, GY + 1, z0);
  await tap(x1, GY + 3, z1);
}
// Gates and emergency exits painted on the ground.
await pickCategory('Spectator');
await pickTool('Floor');
await pickSwatch('Entrance');
for (const [gx, gz] of [[52, 32], [80, 32], [52, 82], [80, 82]]) {
  await tap(gx - 3, GY, gz);
  await tap(gx + 3, GY, gz + 1);
}
await pickSwatch('Emergency Exit');
for (const [gx, gz] of [[36, 32], [96, 32], [36, 82], [96, 82]]) {
  await tap(gx - 2, GY, gz);
  await tap(gx + 2, GY, gz + 1);
}
await pickSwatch('Concourse');
await tap(30, GY, 34);
await tap(103, GY, 38);

const zones = {};
for (const k of ['locker', 'medical', 'restroom', 'concession', 'media', 'entrance', 'exit', 'concourse']) {
  zones[k] = await zoneCount(k);
}
console.log('  ✓ zones painted:', JSON.stringify(zones));
for (const [k, v] of Object.entries(zones)) {
  if (v === 0) throw new Error(`zone "${k}" was not painted by the UI`);
}

// -------------------------------------------------- 6. a generated stand
console.log('  raising a grandstand with the Stand tool...');
await pickMode('BUILD');
await frame(66, 58, 250);
await pickCategory('Seating');
await pickSwatch('Seating');
await pickTool('Stand');
await tap(PITCH.x0 - 10, GY, PITCH.z0 - 12);
await tap(PITCH.x1 + 10, GY, PITCH.z0 - 5);
await page.waitForTimeout(400);
const staged = await page.evaluate(() => window.__sct.game.construction());
console.log(`  \u2713 ${staged.count} project(s) under construction, ${staged.blocks} blocks queued`);
if (staged.count === 0) throw new Error('the Stand tool did not queue a construction project');
await page.screenshot({ path: `${SHOTS}/H-03-construction.png` });
await page.evaluate(() => {
  const app = window.__sct;
  app.game.state.cash = 40_000_000;
  app.game.rushConstruction(app.game.state.construction[0].id);
  app.worldRenderer.rebuildAll(); app.worldRenderer.flush();
});
await page.waitForTimeout(600);
const standSeats = await count('seat');
console.log(`  \u2713 grandstand finished; ${standSeats} seating blocks on site`);
if (standSeats <= seats) throw new Error('the grandstand added no seats');

// --------------------------------------------------------- 7. floodlights
await pickMode('BUILD');
await pickCategory('Decor');
await pickSwatch('Floodlight');
await pickTool('Block');
for (const [fx, fz] of [[34, 34], [99, 34], [34, 80], [99, 80]]) await tap(fx, GY, fz);

await page.evaluate(() => window.__sct.game.analyze(true));
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/H-01-built.png` });

// ------------------------------------------------------- 7. the verdict
const venue = await page.evaluate(() => {
  const v = window.__sct.game.primaryVenue;
  return v && {
    type: v.type, capacity: v.capacity.total, rating: v.ratings.overall, tier: v.tier,
    regulation: v.field.regulation, surfaceOk: v.field.surfaceOk,
    pitch: `${v.field.w * 2}m x ${v.field.d * 2}m`,
    parking: v.parkingCars,
    issues: v.ratings.issues.map((i) => i.text),
  };
});
console.log('\n  DETECTED:', JSON.stringify(venue, null, 2).replace(/\n/g, '\n  '));
if (!venue) throw new Error('nothing was detected after building through the UI');
if (venue.regulation < 1) throw new Error('the hand-tapped pitch is not regulation');
if (venue.capacity < 3000) throw new Error(`capacity is only ${venue.capacity}`);
if (venue.tier === 'none') throw new Error('the venue is not event ready');

// Undo/redo through the rail buttons.
const before = await count('floodlight');
await page.getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(200);
if (await count('floodlight') !== before - 1) throw new Error('undo did not remove the last block');
await page.getByRole('button', { name: 'Redo' }).click();
await page.waitForTimeout(200);
if (await count('floodlight') !== before) throw new Error('redo did not restore the block');
console.log('  ✓ undo and redo work from the UI');

// Zone overlay renders.
await page.evaluate(() => { window.__sct.controller.setMode('zone'); window.__sct.syncZoneOverlay(); });
await page.waitForTimeout(500);
const overlay = await page.evaluate(() => window.__sct.worldRenderer.zoneMeshes.size);
if (overlay === 0) throw new Error('zone overlay produced no meshes');
await page.screenshot({ path: `${SHOTS}/H-02-zones.png` });
console.log(`  ✓ zone overlay drew ${overlay} chunk meshes`);

if (errors.length) { console.error('CONSOLE ERRORS:', errors); throw new Error(`${errors.length} console errors`); }
console.log('\nHAND-BUILD OK');
await browser.close();
