/**
 * Performance at stadium scale.
 *
 * Builds a complex far larger than anything the tutorial leads you to, then
 * measures what the renderer actually does: draw calls, triangles, frame time
 * and the cost of a large edit. Software rendering makes the absolute numbers
 * meaningless, but draw calls, triangle counts and remesh behaviour are real.
 */
import { chromium } from 'playwright';

const SHOTS = process.env.SHOTS || '/tmp/shots';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
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

const problems = [];

// ------------------------------------------------------------ a big complex
console.log('  building a large complex...');
const built = await page.evaluate(async () => {
  const a = window.__sct;
  a.game.state.paused = true;
  a.game.state.cash = 5e9;
  a.tutorial.dismiss();
  // Largest plot, a championship pitch, and a deep bowl around it.
  a.game.state.sites[0].landTier = 3;
  a.game.world.expandTo(256);
  const w = a.game.world, B = a.dev.blockId, Z = a.dev.zoneId, G = 8;
  const cx = 128, cz = 128, pw = 53, pd = 34;
  for (let z = cz - pd / 2; z < cz + pd / 2; z++) {
    for (let x = cx - pw / 2; x < cx + pw / 2; x++) w.setBlock(Math.round(x), G - 1, Math.round(z), B('turf'), Z('pitch_football'));
  }
  for (let r = 2; r < 46; r++) {
    const y = G + Math.floor((r - 2) * 0.8);
    const x0 = cx - 27 - r, x1 = cx + 26 + r, z0 = cz - 17 - r, z1 = cz + 16 + r;
    if (x0 < 2 || z0 < 2 || x1 > 253 || z1 > 253 || y >= 58) break;
    const conc = r % 6 === 0;
    const col = (x, z) => {
      for (let yy = G - 1; yy < y; yy++) w.setBlock(x, yy, z, B('concrete'));
      w.setBlock(x, y, z, conc ? B('pavement') : B('seat'), conc ? Z('concourse') : Z('seating'));
    };
    for (let x = x0; x <= x1; x++) { col(x, z0); col(x, z1); }
    for (let z = z0 + 1; z < z1; z++) { col(x0, z); col(x1, z); }
  }
  // A roof over the top ring, and equipment on the pitch.
  for (let x = cx - 74; x <= cx + 73; x += 1) {
    for (const z of [cz - 64, cz + 63]) w.setBlock(x, 45, z, B('roof_stadium'));
  }
  a.dev.prop('goal_soccer', cx - 25, G, cz, 2);
  a.dev.prop('goal_soccer', cx + 25, G, cz, 0);
  a.dev.prop('scoreboard_lg', cx, G, cz - 20, 0);
  for (let i = 0; i < 40; i++) a.dev.prop('corner_flag', cx - 26 + i, G, cz - 18, 0);

  a.game.markWorldDirty();
  a.game.analyze(true);
  a.worldRenderer.rebuildAll();
  a.worldRenderer.flush();
  a.refresh();
  return {
    blocks: a.game.analysis.complex.totalBlocks,
    capacity: a.game.primaryVenue?.capacity.total || 0,
    chunks: a.worldRenderer.meshes.size,
    props: a.game.world.props.size,
  };
});
console.log(`  ${built.blocks.toLocaleString()} blocks, ${built.capacity.toLocaleString()} capacity, `
  + `${built.chunks} chunks, ${built.props} props`);

// ------------------------------------------------------------- render stats
const frame = async (label, setup) => {
  if (setup) await page.evaluate(setup);
  await page.waitForTimeout(900);
  const s = await page.evaluate(async () => {
    const a = window.__sct;
    // Average a handful of frames rather than trusting one.
    const times = [];
    for (let i = 0; i < 12; i++) {
      const t0 = performance.now();
      a.renderer.render(a.scene, a.camera);
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    return {
      calls: a.renderer.info.render.calls,
      tris: a.renderer.info.render.triangles,
      geometries: a.renderer.info.memory.geometries,
      textures: a.renderer.info.memory.textures,
      median: +times[Math.floor(times.length / 2)].toFixed(1),
    };
  });
  console.log(`  ${label.padEnd(22)} ${String(s.calls).padStart(4)} calls  `
    + `${(s.tris / 1000).toFixed(0).padStart(5)}k tris  ${String(s.geometries).padStart(4)} geo  `
    + `${s.median.toFixed(1).padStart(6)}ms median frame`);
  return s;
};

const overview = await frame('overview', () => {
  const a = window.__sct;
  a.setCamera('free');
  a.rig.focusOn(128 * 2, 40, 128 * 2, 420);
  a.rig.pitch = 0.7;
});
const ground = await frame('first person', () => {
  const a = window.__sct;
  a.setCamera('first');
  a.rig.eye?.set?.(128 * 2, 20, 128 * 2);
  a.rig.focus.set(128 * 2, 20, 128 * 2);
});
const zone = await frame('zone overlay', () => {
  window.__sct.worldRenderer.setZoneMode(true);
});
await page.evaluate(() => window.__sct.worldRenderer.setZoneMode(false));

// ------------------------------------------------------- a big edit, timed
const edit = await page.evaluate(() => {
  const a = window.__sct;
  const w = a.game.world, B = a.dev.blockId;
  const t0 = performance.now();
  for (let z = 200; z < 240; z++) for (let x = 20; x < 60; x++) w.setBlock(x, 8, z, B('concrete'));
  const setT = performance.now() - t0;
  const t1 = performance.now();
  a.worldRenderer.flush();
  return { cells: 40 * 40, setMs: +setT.toFixed(1), remeshMs: +(performance.now() - t1).toFixed(1),
    dirty: a.game.world.dirtyChunks.size };
});
console.log(`  1,600-block fill: ${edit.setMs}ms to place, ${edit.remeshMs}ms to remesh`);

await page.screenshot({ path: `${SHOTS}/PERF-stadium.png` });

// --------------------------------------------------------------- judgements
// Draw calls, triangle counts and remesh times stay meaningful off software
// rendering; the absolute frame time does not. The bounds below are regression
// guards against the measured numbers, not targets in their own right:
// a maximal 80,000-seat bowl on the largest plot is the worst case the game
// can produce, and it is one chunk mesh per built chunk.
if (overview.calls > 300) problems.push(`overview takes ${overview.calls} draw calls`);
if (ground.calls > 120) problems.push(`first person takes ${ground.calls} draw calls`);
if (zone.calls > 260) problems.push(`zone overlay takes ${zone.calls} draw calls`);
if (overview.textures > 4) problems.push(`${overview.textures} textures loaded - this game should have none`);
if (edit.remeshMs > 2500) problems.push(`a 1,600-block fill took ${edit.remeshMs}ms to remesh`);
if (built.capacity < 60_000) problems.push(`the stress stadium only reached ${built.capacity} capacity`);

if (errors.length) { console.error('CONSOLE ERRORS:', errors); throw new Error(`${errors.length} console errors`); }
if (problems.length) { console.error('PROBLEMS:', problems); throw new Error(`${problems.length} problems`); }
console.log('\nPERF OK');
await browser.close();
