import { PLAN_STRIDE } from '../voxel/structures.js';
import { block } from '../data/blocks.js';

/**
 * Staged construction.
 *
 * Small edits land immediately - waiting three days to place a doorway would
 * be miserable. Anything substantial becomes a project that rises out of the
 * ground over several in-game days, lowest blocks first, so you watch a
 * foundation become a structure become a stand.
 *
 * The strategic point is that you cannot throw up a 12,000-seat tier the day
 * before an event you have already won.
 */
export const STAGED_THRESHOLD = 400;   // blocks
export const RUSH_SURCHARGE = 0.6;     // paid to finish immediately

/** How long a project of this size should take, in in-game days. */
export function projectDays(blocks) {
  return Math.max(1, Math.min(16, Math.round(blocks / 900) + 1));
}

export function shouldStage(cellCount) {
  return cellCount >= STAGED_THRESHOLD;
}

/**
 * Turn a plan (or a uniform-material cell list) into a project. Cells are
 * sorted bottom-up so the structure genuinely rises.
 */
export function createProject(state, { label, cells, cost, uniformBlock, uniformZone, props, siteId }) {
  const records = [];
  if (uniformBlock !== undefined) {
    for (let i = 0; i < cells.length; i += 3) {
      records.push([cells[i], cells[i + 1], cells[i + 2], uniformBlock, uniformZone]);
    }
  } else {
    for (let i = 0; i < cells.length; i += PLAN_STRIDE) {
      records.push([cells[i], cells[i + 1], cells[i + 2], cells[i + 3], cells[i + 4]]);
    }
  }
  // Foundations first, then upward; ties broken by structural role so columns
  // appear before the deck they carry.
  records.sort((a, b) => a[1] - b[1] || supportRank(b[3]) - supportRank(a[3]));

  const flat = new Array(records.length * PLAN_STRIDE);
  records.forEach((r, i) => {
    flat[i * PLAN_STRIDE] = r[0];
    flat[i * PLAN_STRIDE + 1] = r[1];
    flat[i * PLAN_STRIDE + 2] = r[2];
    flat[i * PLAN_STRIDE + 3] = r[3];
    flat[i * PLAN_STRIDE + 4] = r[4] || 0;
  });

  const total = records.length;
  return {
    id: `C${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    label,
    // Which site this is being built on. Without it, a stand ordered in one
    // city would go up in whichever city you happened to be standing in when
    // the days ticked by.
    siteId: siteId || state.activeSite || 'site1',
    cells: flat,
    // Fittings go in last, the way they do on a real site.
    props: (props || []).map((p) => [p.typeId, p.x, p.y, p.z, p.rot]),
    total,
    placed: 0,
    progress: 0,
    cost: Math.round(cost),
    startDay: state.day,
    days: projectDays(total),
    bbox: bboxOf(records),
  };
}

function supportRank(id) {
  const b = block(id);
  return b ? b.support : 0;
}

function bboxOf(records) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of records) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * Advance a site's projects by `dayFraction` of a day, placing blocks as the
 * progress bar crosses them.
 * @param siteId only advance projects on this site; omit for all of them.
 * @returns {{changed:boolean, completed:Array}}
 */
export function tickConstruction(state, world, dayFraction, siteId = null) {
  const all = state.construction || [];
  const projects = siteId ? all.filter((p) => (p.siteId || state.activeSite) === siteId) : all;
  if (projects.length === 0) return { changed: false, completed: [] };

  let changed = false;
  const completed = [];

  for (const p of projects) {
    p.progress = Math.min(1, p.progress + dayFraction / p.days);
    const want = Math.round(p.progress * p.total);
    while (p.placed < want) {
      const i = p.placed * PLAN_STRIDE;
      world.setBlock(p.cells[i], p.cells[i + 1], p.cells[i + 2], p.cells[i + 3], p.cells[i + 4]);
      p.placed++;
      changed = true;
    }
    if (p.progress >= 1) {
      if (fitOut(world, p)) changed = true;
      completed.push(p);
    }
  }

  if (completed.length) {
    state.construction = all.filter((p) => !completed.includes(p));
  }
  return { changed, completed };
}

/** Finish a project immediately, for a surcharge. */
export function rushProject(state, world, id) {
  const p = (state.construction || []).find((x) => x.id === id);
  if (!p) return null;
  const remaining = p.total - p.placed;
  const surcharge = Math.round((p.cost * (remaining / Math.max(1, p.total))) * RUSH_SURCHARGE);
  if (state.cash < surcharge) return { error: `Rushing this needs ${surcharge.toLocaleString()} in overtime.` };

  for (let i = p.placed; i < p.total; i++) {
    const k = i * PLAN_STRIDE;
    world.setBlock(p.cells[k], p.cells[k + 1], p.cells[k + 2], p.cells[k + 3], p.cells[k + 4]);
  }
  p.placed = p.total;
  p.progress = 1;
  fitOut(world, p);
  state.construction = state.construction.filter((x) => x.id !== id);
  return { ok: true, surcharge, project: p };
}

/** Install a finished project's equipment. Safe to call more than once. */
function fitOut(world, p) {
  if (!p.props || p.props.length === 0 || p.fitted) return false;
  p.fitted = true;
  let any = false;
  for (const [typeId, x, y, z, rot] of p.props) {
    if (world.props?.canPlace(world, typeId, x, y, z, rot).ok) {
      world.props.add(typeId, x, y, z, rot);
      any = true;
    }
  }
  return any;
}

/**
 * Abandon a project. Anything already built stays; the unbuilt remainder is
 * refunded in full, since no materials were used.
 */
export function cancelProject(state, id) {
  const p = (state.construction || []).find((x) => x.id === id);
  if (!p) return null;
  const remaining = 1 - p.progress;
  const refund = Math.round(p.cost * remaining);
  state.construction = state.construction.filter((x) => x.id !== id);
  return { ok: true, refund, project: p };
}

export function constructionSummary(state) {
  const projects = state.construction || [];
  return {
    count: projects.length,
    blocks: projects.reduce((s, p) => s + (p.total - p.placed), 0),
    projects: projects.map((p) => ({
      id: p.id, label: p.label, progress: p.progress,
      placed: p.placed, total: p.total, cost: p.cost,
      daysLeft: Math.max(0, Math.ceil((1 - p.progress) * p.days)),
    })),
  };
}
