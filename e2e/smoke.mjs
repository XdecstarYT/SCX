import { chromium } from 'playwright';
const SHOTS = '/tmp/claude-0/-home-user-SCX/1dd096d9-aa5f-51b9-91a8-676a74711740/scratchpad/shots';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}/01-splash.png` });

await page.getByRole('button', { name: /Start building/i }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}/02-world.png` });

const state = await page.evaluate(() => {
  const a = window.__sct;
  return { cash: a.game.state.cash, size: a.game.world.size, chunks: a.game.world.chunks.size,
           meshes: a.worldRenderer.meshes.size, tab: a.tab, calls: a.renderer.info.render.calls,
           tris: a.renderer.info.render.triangles, fps: a.fps };
});
console.log('STATE', JSON.stringify(state));
console.log('ERRORS', errors.length ? errors : 'none');
await browser.close();
