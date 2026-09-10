/** Screenshots the key screens at several viewport shapes, and asserts that
 *  nothing overflows horizontally or hides the tab bar. */
import { chromium } from 'playwright';
const SHOTS = process.env.SHOTS || '/tmp/shots';
const SIZES = [
  ['phone-small', 320, 568],
  ['phone', 390, 844],
  ['phone-landscape', 844, 390],
  ['tablet', 820, 1180],
  ['desktop', 1440, 900],
];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const problems = [];

for (const [name, w, h] of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /Start building/i }).click();
  await page.waitForFunction(() => window.__sct?.worldRenderer, null, { timeout: 15000 });
  await page.waitForTimeout(900);

  // Build something so the management screens have content.
  await page.evaluate(() => {
    const app = window.__sct; const w = app.game.world;
    const B = app.dev.blockId, Z = app.dev.zoneId, G = 8;
    const box = (x0,y0,z0,x1,y1,z1,k,zk)=>{const id=B(k),z=zk?Z(zk):undefined;
      for(let y=y0;y<=y1;y++)for(let zz=z0;zz<=z1;zz++)for(let x=x0;x<=x1;x++)w.setBlock(x,y,zz,id,z);};
    box(38,G-1,46,91,G-1,80,'turf','pitch_football');
    for (let r=0;r<4;r++){const y=G+r,x0=36-r*2,x1=93+r*2,z0=44-r*2,z1=82+r*2;
      for(let zz=z0;zz<=z1;zz++)for(let x=x0;x<=x1;x++){const band=x<x0+2||x>x1-2||zz<z0+2||zz>z1-2;
        if(band){for(let yy=G-1;yy<y;yy++)w.setBlock(x,yy,zz,B('concrete'));w.setBlock(x,y,zz,B('seat'),Z('seating'));}}}
    box(30,G-1,30,100,G-1,36,'tile','entrance');
    box(20,G-1,10,110,G-1,26,'asphalt','parking');
    box(30,G,88,44,G+2,96,'tile','restroom');
    box(48,G,88,60,G+2,96,'tile','concession');
    box(64,G,88,76,G+2,96,'tile','locker');
    box(80,G,88,88,G+2,96,'tile','medical');
    app.game.markWorldDirty(); app.game.analyze(true);
    app.worldRenderer.rebuildAll(); app.worldRenderer.flush();
    app.flyToVenue(app.game.primaryVenue); app.refresh();
  });
  await page.waitForTimeout(900);

  const shot = async (label) => page.screenshot({ path: `${SHOTS}/L-${name}-${label}.png` });
  await shot('build');

  // The floating stick and action pad sit over the 3D view. They must never
  // land on top of a dock control, a hotbar slot or the tab bar - which is
  // exactly what they used to do at the bottom right of a phone screen.
  for (const hand of ['right', 'left']) {
    await page.evaluate((h) => {
      const a = window.__sct;
      a.game.state.settings.handedness = h;
      a.applySettings();
      a.setCamera('first');            // stick and full action pad on screen
      a.controller.setProp('goal_soccer');
      a.refreshBuildUi();
      a.refresh();
    }, hand);
    await page.waitForTimeout(450);
    const cover = await page.evaluate(() => {
      const floats = [...document.querySelectorAll('.actionpad, .joy')]
        .filter((e) => e.offsetParent !== null)
        .map((e) => e.getBoundingClientRect());
      const covered = [];
      for (const el of document.querySelectorAll('.builddock button, .hotbar-bar button, .botnav button')) {
        const b = el.getBoundingClientRect();
        for (const f of floats) {
          const ox = Math.max(0, Math.min(b.right, f.right) - Math.max(b.left, f.left));
          const oy = Math.max(0, Math.min(b.bottom, f.bottom) - Math.max(b.top, f.top));
          if (ox * oy > b.width * b.height * 0.25) {
            covered.push((el.getAttribute('aria-label') || el.textContent || '?').trim().slice(0, 24));
            break;
          }
        }
      }
      const off = floats.filter((f) => f.top < 0 || f.left < 0
        || f.right > window.innerWidth + 1 || f.bottom > window.innerHeight + 1).length;
      return { covered, off };
    });
    if (cover.covered.length) problems.push(`${name}/${hand}-handed: floating controls cover ${cover.covered.join(', ')}`);
    if (cover.off) problems.push(`${name}/${hand}-handed: ${cover.off} floating control group is off screen`);
    if (hand === 'left') await shot('left-handed');
  }
  await page.evaluate(() => {
    const a = window.__sct;
    a.game.state.settings.handedness = 'right';
    a.applySettings();
    a.setCamera('free');
    a.refresh();
  });
  await page.waitForTimeout(300);

  for (const tab of ['Home', 'Events', 'Finance', 'More']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(500);
    await shot(tab.toLowerCase());
    // The tab bar must stay reachable while a sheet is open.
    const navHit = await page.evaluate(() => {
      const nav = document.querySelector('.botnav .nav');
      const r = nav.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return nav.contains(top);
    });
    if (!navHit) problems.push(`${name}/${tab}: tab bar is covered`);
  }

  const overflow = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
    sheetOverflow: (() => {
      const b = document.querySelector('.sheet-body');
      return b ? b.scrollWidth - b.clientWidth : 0;
    })(),
  }));
  if (overflow.docW > overflow.winW + 1) problems.push(`${name}: page scrolls horizontally (${overflow.docW} > ${overflow.winW})`);
  if (overflow.sheetOverflow > 2) problems.push(`${name}: sheet content overflows by ${overflow.sheetOverflow}px`);

  console.log(`  ${name.padEnd(17)} ok`);
  await page.close();
}
await browser.close();
if (problems.length) { console.error('\nPROBLEMS:'); problems.forEach((p) => console.error('  - ' + p)); process.exit(1); }
console.log('\nLAYOUTS OK');
