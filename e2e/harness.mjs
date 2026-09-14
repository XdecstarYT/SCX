/**
 * Shared end-to-end helpers.
 *
 * Three suites had grown their own copy of the same voxel-tapping helper, and
 * all three had the same fault in it, so fixing it once in one of them would
 * have left the other two flaking.
 */

/**
 * Tap a voxel's top face through the real canvas.
 *
 * Verifies the point is actually over the 3D view first: a tap that landed on
 * the dock would silently change the tool instead of placing a block, and the
 * test would then fail somewhere else entirely.
 *
 * There are two quite different reasons a point is untappable and they need
 * different remedies. Off screen is fixed by pulling the camera back. Covered
 * by a toast is fixed by getting rid of the toast - zooming out for that just
 * slid the point to a different part of the same toast, which was worth about
 * one failure in three, on a different voxel each time.
 */
export function makeTap(page, opts = {}) {
  const settle = opts.settle ?? 80;
  const tries = opts.tries ?? 8;
  return async function tap(vx, vy, vz) {
    let last = null;
    for (let attempt = 0; attempt < tries; attempt++) {
      const p = await page.evaluate(([x, y, z]) => {
        const q = window.__sct.dev.project(x, y, z);
        const hit = document.elementFromPoint(q.x, q.y);
        return {
          ...q,
          tag: hit?.tagName,
          cover: hit?.closest?.('.toasts, .builddock, .botnav, .topbar, .railcol, .sheet, .tutorial, .touchlayer')
            ?.className || null,
        };
      }, [vx, vy, vz]);
      last = p;

      if (p.onScreen && p.tag === 'CANVAS') {
        await page.mouse.click(p.x, p.y);
        await page.waitForTimeout(settle);
        return;
      }
      if (!p.onScreen) {
        await page.evaluate(() => { window.__sct.rig.zoom(1.28); });
        await page.waitForTimeout(180);
      } else if (/toasts|tutorial/.test(p.cover || '')) {
        // Transient chrome: clear it rather than waiting out its four seconds.
        await page.evaluate(() => {
          window.__sct.hud.toasts.replaceChildren();
          window.__sct.tutorial.dismiss();
        });
        await page.waitForTimeout(60);
      } else {
        // Permanent chrome: the camera is what has to move.
        await page.evaluate(() => { window.__sct.rig.zoom(1.22); });
        await page.waitForTimeout(180);
      }
    }
    throw new Error(`voxel ${vx},${vy},${vz} could not be tapped: ${JSON.stringify(last)}`);
  };
}
