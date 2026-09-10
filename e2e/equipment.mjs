/**
 * Drives the equipment and prefab systems through the real UI: choose a piece
 * of equipment from the palette, turn it, place it, place a whole prefabricated
 * facility, and prove a careless demolition asks before it takes a scoreboard.
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
  a.game.state.cash = 80_000_000;      // this test is about building, not budgets
  a.rig.focusOn(64 * 2, 16, 60 * 2, 250);
  a.rig.pitch = 1.16;
  a.rig.yaw = -0.5;
  a.tutorial.dismiss();
  a.refresh();
});
await page.waitForTimeout(400);

const tap = async (vx, vy, vz) => {
  for (let attempt = 0; attempt < 4; attempt++) {
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
    await page.evaluate(() => { window.__sct.rig.zoom(1.28); });
    await page.waitForTimeout(180);
  }
  throw new Error(`voxel ${vx},${vy},${vz} could not be tapped`);
};
const pickMode = async (name) => {
  await page.locator('.modebar button', { hasText: new RegExp(`^${name}$`, 'i') }).first().click();
  await page.waitForTimeout(150);
};
const propCount = () => page.evaluate(() => window.__sct.game.world.props.size);
const state = () => page.evaluate(() => {
  const a = window.__sct;
  return {
    rotation: a.controller.rotation,
    propKey: a.controller.propKey,
    prefabKey: a.controller.prefabKey,
    props: a.game.world.props.size,
    drawn: [...a.propRenderer.meshes.values()].reduce((s, m) => s + m.count, 0),
    cash: Math.round(a.game.state.cash),
  };
});

const problems = [];

// ------------------------------------------------ 1. lay a pitch to fit out
console.log('  laying a pitch by hand...');
await page.evaluate(() => {
  const a = window.__sct, w = a.game.world, B = a.dev.blockId, Z = a.dev.zoneId;
  for (let x = 36; x <= 92; x++) for (let z = 40; z <= 76; z++) w.setBlock(x, 7, z, B('turf'), Z('pitch_football'));
  a.game.markWorldDirty(); a.game.analyze(true);
  a.worldRenderer.flush(); a.refresh();
});
await page.waitForTimeout(500);

// -------------------------------------- 2. choose equipment from the palette
console.log('  choosing a goal from the palette...');
await pickMode('BUILD');
await page.locator('.toolrow button[aria-label="Open the palette"]').first().click();
await page.waitForTimeout(320);
// Materials and Equipment are two halves of the same palette.
await page.locator('.sheet-body .tabs button', { hasText: /^Equipment$/ }).first().click();
await page.waitForTimeout(200);
await page.locator('.sheet-body .catrow button', { hasText: /^Goals & Posts$/ }).first().click();
await page.waitForTimeout(180);
if (!await page.locator('.sheet-body .palette-item[aria-label="Soccer Goal"]').count()) {
  throw new Error('the palette has no Soccer Goal');
}
await page.locator('.sheet-body .palette-item[aria-label="Soccer Goal"]').first().click();
await page.waitForTimeout(400);

let s = await state();
if (s.propKey !== 'goal_soccer') problems.push(`palette did not put the goal in hand (${s.propKey})`);
console.log('  ✓ holding ' + s.propKey);

// --------------------------------------------------- 3. rotation is visible
const rotBtn = page.locator('.toolrow button[aria-label="Rotate 90 degrees"]').first();
if (!await rotBtn.count()) throw new Error('no rotate button appeared while holding equipment');
const beforeRot = (await state()).rotation;
await rotBtn.click();
await page.waitForTimeout(200);
const afterRot = (await state()).rotation;
if (afterRot !== (beforeRot + 1) % 4) problems.push(`rotate button did not turn the piece (${beforeRot} -> ${afterRot})`);
// The preview mesh must turn with it.
const ghost = await page.evaluate(() => {
  const g = window.__sct.controller.propGhost.mesh;
  return { visible: g.visible, yaw: +g.rotation.y.toFixed(4) };
});
if (Math.abs(ghost.yaw - afterRot * Math.PI / 2) > 1e-3) {
  problems.push(`the preview did not rotate with the piece (yaw ${ghost.yaw})`);
}
console.log(`  ✓ rotate turns the piece and its preview (rot ${afterRot}, ghost yaw ${ghost.yaw})`);
await page.screenshot({ path: `${SHOTS}/E-holding-goal.png` });

// ------------------------------------------------------ 4. place two goals
console.log('  placing goals at both ends...');
await page.evaluate(() => { window.__sct.controller.rotation = 2; });
await tap(64, 7, 41);          // aims at the turf; the goal lands on top of it
await page.evaluate(() => { window.__sct.controller.rotation = 0; });
await tap(64, 7, 75);
await page.waitForTimeout(300);
s = await state();
if (s.props !== 2) problems.push(`expected 2 goals placed, world has ${s.props}`);
if (s.drawn !== s.props) problems.push(`renderer drew ${s.drawn} props for ${s.props} placed`);
console.log(`  ✓ ${s.props} goals placed and ${s.drawn} drawn`);

// Placing something should throw dust and flash, and reduced motion should
// switch that off rather than merely hiding it.
const fx = await page.evaluate(() => {
  const e = window.__sct.effects;
  return { live: e.pool.filter((p) => p.live).length, flashes: e.flashPool.filter((f) => f.live).length };
});
if (fx.live === 0 && fx.flashes === 0) problems.push('placing equipment produced no construction effect');
else console.log(`  \u2713 construction effects fired (${fx.live} particles, ${fx.flashes} flashes)`);
const quiet = await page.evaluate(() => {
  const a = window.__sct;
  a.game.state.settings.reducedMotion = true;
  a.applySettings();
  a.effects.placed(60, 8, 60, 0xffffff);
  a.effects.update(0.016);
  const n = a.effects.particles.count + a.effects.flashes.count;
  a.game.state.settings.reducedMotion = false;
  a.applySettings();
  return n;
});
if (quiet !== 0) problems.push(`reduced motion still drew ${quiet} effect instances`);
else console.log('  \u2713 reduced motion switches the effects off');

// The analyser must see them.
const equip = await page.evaluate(() => {
  const a = window.__sct;
  a.game.analyze(true);
  const v = a.game.analysis.venues[0];
  return v ? { sport: v.sport, equipment: v.equipment, score: v.equipmentScore, missing: v.equipmentMissing.map((m) => m.provides) } : null;
});
if (!equip) problems.push('no venue detected after fitting goals');
else if (equip.equipment.goal !== 2) problems.push(`the analyser counted ${equip.equipment.goal} goals`);
else console.log(`  ✓ the analyser reads ${equip.equipment.goal} goals; still missing: ${equip.missing.join(', ')}`);

// -------------------------------------------- 5. a prefab through the library
console.log('  placing a prefab from the library...');
await page.locator('.toolrow button[aria-label="Open the structure library"]').first().click();
await page.waitForTimeout(400);
const card = page.locator('.sheet-body .card.tap[aria-label^="Basketball Court"]').first();
if (!await card.count()) throw new Error('the library has no Basketball Court prefab');
await card.click();
await page.waitForTimeout(500);
s = await state();
if (s.prefabKey !== 'court_basketball') problems.push(`library did not arm the prefab (${s.prefabKey})`);

const beforeBlocks = await page.evaluate(() => window.__sct.game.world.blockCounts.get(window.__sct.dev.blockId('hardwood')) || 0);
await tap(20, 7, 20);
await page.waitForTimeout(600);
const afterBlocks = await page.evaluate(() => window.__sct.game.world.blockCounts.get(window.__sct.dev.blockId('hardwood')) || 0);
if (afterBlocks <= beforeBlocks) problems.push('the prefab laid no hardwood');
s = await state();
if (s.props < 6) problems.push(`the prefab did not fit its hoops and benches (${s.props} props total)`);
console.log(`  ✓ prefab laid ${afterBlocks - beforeBlocks} hardwood blocks and its fittings (${s.props} props on site)`);
await page.screenshot({ path: `${SHOTS}/E-prefab-court.png` });

// ----------------------------- 6. a large prefab stages, then fits out on rush
console.log('  staging a large prefab...');
await page.locator('.toolrow button[aria-label="Open the structure library"]').first().click();
await page.waitForTimeout(400);
await page.locator('.sheet-body .card.tap[aria-label^="Small Grandstand"]').first().click();
await page.waitForTimeout(400);
await page.evaluate(() => { window.__sct.controller.rotation = 0; });
await tap(36, 7, 82);
await page.waitForTimeout(500);
const staged = await page.evaluate(() => window.__sct.game.state.construction.length);
if (staged === 0) problems.push('a 1,400-block prefab was built instantly instead of being staged');
else console.log(`  ✓ the grandstand became a ${staged}-project construction site`);
await page.evaluate(() => {
  const a = window.__sct;
  for (const p of [...a.game.state.construction]) a.game.rushConstruction(p.id);
  a.worldRenderer.flush();
});
await page.waitForTimeout(400);
const seats = await page.evaluate(() => window.__sct.game.world.blockCounts.get(window.__sct.dev.blockId('seat')) || 0);
if (seats < 100) problems.push(`the rushed grandstand produced only ${seats} seats`);
else console.log(`  ✓ rushing the project finished it (${seats} seats)`);

// --------------------------------- 7. demolition asks before taking equipment
console.log('  checking the demolition confirmation...');
await page.evaluate(() => {
  const a = window.__sct;
  a.controller.setProp('scoreboard_sm');
  a.controller.rotation = 0;
});
await tap(50, 7, 30);
await page.waitForTimeout(300);
const withBoard = await propCount();
if (withBoard !== 7) problems.push(`expected 7 props before the demolition test, have ${withBoard}`);

await pickMode('DEMOLISH');
await page.evaluate(() => {
  const a = window.__sct;
  a.controller.setTool('single');
  a.rig.focusOn(50 * 2, 22, 30 * 2, 60);      // look the scoreboard in the face
  a.rig.pitch = 0.22;
  a.rig.yaw = 0.0;
});
await page.waitForTimeout(450);
// Aim at the object itself, not at the gap between its legs.
const boardAt = await page.evaluate(() => window.__sct.dev.projectProp(50, 8, 30));
if (!boardAt?.onScreen) problems.push('the scoreboard is not on screen to aim at');
else await page.mouse.click(boardAt.x, boardAt.y);
await page.waitForTimeout(400);
if (!await page.locator('.modal:not(.hidden)').count()) {
  problems.push('removing a scoreboard did not ask for confirmation');
} else {
  const text = await page.locator('.modal-panel').innerText();
  if (!/Scoreboard/i.test(text)) problems.push('the confirmation does not name what is being removed');
  console.log('  ✓ asked: "' + text.split('\n')[0] + '"');
  await page.screenshot({ path: `${SHOTS}/E-demolish-confirm.png` });
  await page.locator('.modal-panel button', { hasText: /^Remove it$/ }).first().click();
  await page.waitForTimeout(400);
  const after = await propCount();
  if (after !== withBoard - 1) problems.push(`confirming did not remove the scoreboard (${withBoard} -> ${after})`);
  else console.log('  ✓ confirming removed it');
}

// ------------------------------------------------------------- 8. undo works
await page.evaluate(() => window.__sct.undo());
await page.waitForTimeout(300);
if (await propCount() !== withBoard) problems.push('undo did not put the scoreboard back');
else console.log('  ✓ undo put it back');

// ------------------------------------------- 9. a big demolition also asks
await page.evaluate(() => {
  const a = window.__sct;
  a.controller.setMode('demolish');
  a.controller.setTool('box');
  a.rig.focusOn(64 * 2, 16, 58 * 2, 260);
  a.rig.pitch = 1.2;
  a.rig.yaw = -0.5;
});
await page.waitForTimeout(350);
await tap(40, 7, 44);
await tap(80, 7, 70);
await page.waitForTimeout(500);
const pending = await page.evaluate(() => ({
  mode: window.__sct.controller.mode,
  tool: window.__sct.controller.tool,
  cells: (window.__sct.controller.lastCells || []).length / 3,
}));
if (!await page.locator('.modal:not(.hidden)').count()) {
  problems.push(`clearing the pitch did not ask for confirmation (${JSON.stringify(pending)})`);
} else {
  console.log('  ✓ a large clearance asks first');
  await page.locator('.modal-panel button', { hasText: /^Keep it$/ }).first().click();
  await page.waitForTimeout(200);
}

// --------------------------------------------- 10. equipment survives a save
console.log('  saving and reloading...');
await page.evaluate(() => window.__sct.saveNow(true));
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.getByRole('button', { name: /^Continue$/ }).click();
await page.waitForFunction(() => window.__sct?.worldRenderer, null, { timeout: 15000 });
await page.waitForTimeout(1200);
const reloaded = await state();
if (reloaded.props !== withBoard) problems.push(`equipment did not survive the reload (${withBoard} -> ${reloaded.props})`);
if (reloaded.drawn !== reloaded.props) problems.push(`after reload the renderer drew ${reloaded.drawn} of ${reloaded.props} props`);
else console.log(`  ✓ ${reloaded.props} pieces of equipment reloaded and redrew`);
await page.screenshot({ path: `${SHOTS}/E-after-reload.png` });

if (errors.length) { console.error('CONSOLE ERRORS:', errors); throw new Error(`${errors.length} console errors`); }
if (problems.length) { console.error('PROBLEMS:', problems); throw new Error(`${problems.length} problems`); }
console.log('\nEQUIPMENT OK');
await browser.close();
