/**
 * Plays the game the way the design brief describes it: walk in, hold a
 * material from the hotbar, place blocks by looking at faces, sweep out a
 * wall by holding the button, eyedropper an existing block, then switch to
 * zoning and paint what the area is for.
 */
import { chromium } from 'playwright';

const SHOTS = process.env.SHOTS || '/tmp/shots';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
const errors = [];
page.on('pageerror', (e) => { errors.push('PAGEERROR: ' + e.message); console.log('PAGEERROR:', e.message); });
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/ERR_CONNECTION_RESET|MIME type|fonts\.googleapis/.test(t)) { errors.push(t); console.log('ERR:', t.slice(0, 200)); }
});

const shot = (n, label) => page.screenshot({ path: `${SHOTS}/FP-${String(n).padStart(2, '0')}-${label}.png` });
const count = (key) => page.evaluate((k) => {
  const w = window.__sct.game.world;
  return w.blockCounts.get(window.__sct.dev.blockId(k)) || 0;
}, key);

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.getByRole('button', { name: /Start building/i }).click();
await page.waitForFunction(() => window.__sct?.worldRenderer, null, { timeout: 15000 });
await page.evaluate(() => { window.__sct.game.state.paused = true; window.__sct.tutorial.dismiss(); });

// ------------------------------------------------------- walk in
await page.getByRole('button', { name: /First camera/i }).click();
await page.waitForTimeout(800);
const walking = await page.evaluate(() => ({
  mode: window.__sct.rig.mode,
  held: window.__sct.held.mesh.visible,
  reach: window.__sct.controller.reach,
  crosshair: getComputedStyle(document.querySelector('.crosshair')).display,
  slots: document.querySelectorAll('.hotbar-bar .slot').length,
  dockVisible: !!document.querySelector('.builddock'),
  chips: [...document.querySelectorAll('.imchip')].map((n) => n.textContent),
}));
console.log('  first person:', JSON.stringify(walking));
if (walking.mode !== 'first') throw new Error('did not enter first person');
if (!walking.held) throw new Error('no block in hand');
if (walking.slots !== 9) throw new Error(`expected 9 hotbar slots, got ${walking.slots}`);
if (walking.dockVisible) throw new Error('the full dock should collapse while walking');
if (walking.crosshair === 'none') throw new Error('no crosshair');
if (walking.reach > 20) throw new Error(`reach should be an arm's length, got ${walking.reach}m`);
await shot(1, 'walking');

// ------------------------------------------------- hotbar selection
const slotName = (i) => page.evaluate((n) => {
  const app = window.__sct;
  const key = app.game.state.hotbar.blocks[n];
  return { key, holding: app.dev.blockId(key) === app.controller.material };
}, i);

await page.locator('.hotbar-bar .slot').nth(2).click();
await page.waitForTimeout(250);
const third = await slotName(2);
console.log('  slot 3 holds', third.key);
if (!third.holding) throw new Error('clicking a slot did not change what is held');

await page.keyboard.press('5');
await page.waitForTimeout(250);
const fifth = await slotName(4);
if (!fifth.holding) throw new Error('number keys do not select hotbar slots');
console.log('  number key 5 holds', fifth.key);
await shot(2, 'hotbar');

// --------------------------------------------- place blocks by looking
await page.locator('.hotbar-bar .slot').nth(0).click();  // concrete
await page.waitForTimeout(200);
const before = await count('concrete');

// Aim down at the ground ahead and tap the canvas a few times, moving between.
const box = await page.locator('canvas').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.evaluate(() => { window.__sct.rig.fPitch = -0.55; });
await page.waitForTimeout(200);
for (let i = 0; i < 4; i++) {
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(120);
  await page.evaluate(() => { window.__sct.rig.fYaw += 0.16; });
  await page.waitForTimeout(120);
}
const afterTaps = await count('concrete');
console.log(`  tapping placed ${afterTaps - before} blocks`);
if (afterTaps <= before) throw new Error('looking at a face and tapping placed nothing');

// Clicking the world in first person grabs the pointer, the way it should.
const locked = await page.evaluate(() => document.pointerLockElement !== null);
console.log('  pointer lock engaged:', locked);
await shot(3, 'placed');

// ------------------------------------- hold to sweep out a run of blocks
const beforeHold = await count('concrete');
await page.evaluate(() => {
  const app = window.__sct;
  app.rig.fPitch = -0.7;                 // look at the ground ahead
  app.input.beginHold(0);                // as if the place button were held
});
// Walk sideways while holding, the way you would sweep out a wall.
//
// Long enough that the answer cannot depend on the frame rate: the repeat
// waits a third of a second before it starts and then fires every 110ms, and
// SwiftShader renders this scene at about five frames a second, so a short
// sweep can come down to whether one more frame happened to land.
for (let i = 0; i < 24; i++) {
  await page.evaluate(() => { window.__sct.rig.pos.x += 2.2; });
  await page.waitForTimeout(160);
}
await page.evaluate(() => window.__sct.input.releaseHold());
await page.waitForTimeout(200);
const afterHold = await count('concrete');
console.log(`  holding placed a further ${afterHold - beforeHold} blocks`);
if (afterHold - beforeHold < 4) throw new Error('holding the button did not repeat placement');
// And the delay before the repeat starts is what stops a tap placing twice,
// so check the other end of the same mechanism while we are here.
{
  const beforeTap = await count('concrete');
  await page.evaluate(() => {
    const app = window.__sct;
    app.rig.pos.x += 40;                 // fresh ground, nothing already on it
    app.input.beginHold(0);
    app.onTap(null, 0, true);            // the press fires one action itself
  });
  await page.waitForTimeout(220);        // a long tap, meant to stay under the delay
  // Measure what the press actually was. On a loaded machine the round trip
  // that releases it can overrun the delay, and then the repeat firing is the
  // design working rather than the bug coming back - so assert against the
  // press that happened, not the one that was asked for.
  const held = await page.evaluate(() => {
    const s = window.__sct.input.holdSeconds;
    window.__sct.input.releaseHold();
    return s;
  });
  await page.waitForTimeout(200);
  const placed = (await count('concrete')) - beforeTap;
  console.log(`  a ${Math.round(held * 1000)}ms tap placed ${placed} block(s)`);
  if (held < 0.34 && placed !== 1) {
    throw new Error(`a tap shorter than the repeat delay should place one block, placed ${placed}`);
  }
  if (placed < 1) throw new Error('the press placed nothing at all');
}
await shot(4, 'swept');

// ------------------------------------------------------ pick block
await page.evaluate(() => {
  const app = window.__sct;
  const w = app.game.world;
  // Put something distinctive right in front of the player and look at it.
  const vx = Math.floor(app.rig.pos.x / 2);
  const vz = Math.floor(app.rig.pos.z / 2);
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    w.setBlock(vx + dx, 8, vz + dz, app.dev.blockId('brick'));
  }
  app.game.markWorldDirty();
  app.worldRenderer.flush();
  app.rig.fPitch = -1.2;
});
await page.waitForTimeout(400);
await page.evaluate(() => window.__sct.pickBlock());
await page.waitForTimeout(300);
const picked = await page.evaluate(() => {
  const app = window.__sct;
  return { holding: app.dev.blockId('brick') === app.controller.material,
           slots: app.game.state.hotbar.blocks };
});
console.log('  pick block ->', picked.holding ? 'holding brick' : 'FAILED');
if (!picked.holding) throw new Error('pick block did not pick up what was underfoot');
await shot(5, 'picked');

// ------------------------------------------------- zone it, in first person
// Escape hands the cursor back so the on-screen controls are reachable again.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
if (await page.evaluate(() => document.pointerLockElement !== null)) {
  throw new Error('Escape did not release the pointer');
}
await page.locator('.imchip', { hasText: /^Zone$/ }).click();
await page.waitForTimeout(400);
const zoneState = await page.evaluate(() => ({
  mode: window.__sct.controller.mode,
  slot0: window.__sct.game.state.hotbar.zones[0],
  heldVisible: window.__sct.held.mesh.visible,
}));
console.log('  zone mode:', JSON.stringify(zoneState));
if (zoneState.mode !== 'zone') throw new Error('the Zone chip did not switch mode');
if (!zoneState.heldVisible) throw new Error('nothing in hand while zoning');

await page.locator('.hotbar-bar .slot').nth(1).click();   // seating zone
await page.waitForTimeout(250);
const zonedBefore = await page.evaluate(() => {
  const w = window.__sct.game.world;
  return w.zoneCounts.get(window.__sct.dev.zoneId('seating')) || 0;
});
await page.evaluate(() => { window.__sct.input.heldAction = 0; window.__sct.rig.fPitch = -1.1; });
for (let i = 0; i < 14; i++) {
  await page.evaluate(() => { window.__sct.rig.pos.z += 2.2; });
  await page.waitForTimeout(90);
}
await page.evaluate(() => window.__sct.input.releaseHold());
await page.waitForTimeout(300);
const zonedAfter = await page.evaluate(() => {
  const w = window.__sct.game.world;
  return w.zoneCounts.get(window.__sct.dev.zoneId('seating')) || 0;
});
console.log(`  painting zoned ${zonedAfter - zonedBefore} blocks as seating`);
if (zonedAfter <= zonedBefore) throw new Error('zone painting placed no zones');
await shot(6, 'zoning');

// ------------------------------------------------ palette assigns to a slot
await page.locator('.imchip', { hasText: /^Build$/ }).click();
await page.waitForTimeout(300);
await page.locator('.imchip', { hasText: /^Palette$/ }).click();
await page.waitForTimeout(500);
await shot(7, 'palette');
const paletteItems = await page.locator('.palette-item').count();
const lockedItems = await page.locator('.palette-item.locked').count();
if (paletteItems < 5) throw new Error(`palette showed only ${paletteItems} materials`);
console.log(`  palette: ${paletteItems} materials, ${lockedItems} still locked by research`);

const slotBefore = await page.evaluate(() => {
  const app = window.__sct;
  return app.game.state.hotbar.blocks[app.game.state.hotbar.active];
});
// Pick something actually available - locked materials should refuse.
const choice = page.locator('.palette-item:not(.locked)').nth(2);
const choiceName = (await choice.innerText()).split('\n')[0];
await choice.click();
await page.waitForTimeout(400);
const assigned = await page.evaluate(() => {
  const app = window.__sct;
  const slot = app.game.state.hotbar.active;
  return { slot, key: app.game.state.hotbar.blocks[slot],
           holding: app.dev.blockId(app.game.state.hotbar.blocks[slot]) === app.controller.material };
});
if (assigned.key === slotBefore) throw new Error(`slot did not change (still ${slotBefore})`);
console.log(`  chose "${choiceName}" from the palette`);
console.log('  palette assigned', assigned.key, 'to slot', assigned.slot + 1);
if (!assigned.holding) throw new Error('choosing from the palette did not change what is held');
const sheetState = await page.evaluate(() => ({
  hidden: document.querySelector('.sheet').classList.contains('hidden'),
  display: getComputedStyle(document.querySelector('.sheet')).display,
}));
console.log('  sheet after assigning:', JSON.stringify(sheetState));
if (!sheetState.hidden) throw new Error('the palette stayed open after choosing');

// ------------------------------------------------- back to the overview
await page.locator('.imchip', { hasText: /Overview/ }).click();
await page.waitForTimeout(600);
const backOut = await page.evaluate(() => ({
  mode: window.__sct.rig.mode,
  dock: !!document.querySelector('.builddock'),
  hotbar: document.querySelectorAll('.hotbar-bar .slot').length,
  held: window.__sct.held.mesh.visible,
}));
console.log('  overview:', JSON.stringify(backOut));
if (backOut.mode !== 'free') throw new Error('did not return to the free camera');
if (!backOut.dock) throw new Error('the full dock should come back with the overview camera');
if (backOut.hotbar !== 9) throw new Error('the hotbar should stay available in the overview');
if (backOut.held) throw new Error('the held block should hide outside first person');
await shot(8, 'overview');

if (errors.length) { console.error('CONSOLE ERRORS:', errors); throw new Error(`${errors.length} console errors`); }
console.log('\nFIRST-PERSON BUILD OK');
await browser.close();
