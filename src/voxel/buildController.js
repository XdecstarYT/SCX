import * as THREE from 'three';
import { BLOCK_SIZE, CHUNK_Y, GROUND_Y } from '../core/constants.js';
import { block, blockId, AIR } from '../data/blocks.js';
import { zone, zoneId, ZONE_NONE } from '../data/zones.js';
import { raycastVoxel, raycastPlane } from './raycast.js';
import {
  toolCells, priceEdit, applyEdit, copyRegion, rotateClipboard,
  TOOLS, CLIP_STRIDE, PLAN_TOOLS, pricePlan, applyPlan, planPositions,
} from './buildTools.js';
import { generateGrandstand, generateParkingGarage, generateRetainingWall, generateTerrainEdit } from './structures.js';

export const BUILD_MODES = [
  { key: 'build',     name: 'Build',     hint: 'Place blocks' },
  { key: 'zone',      name: 'Zone',      hint: 'Paint what an area is for' },
  { key: 'demolish',  name: 'Demolish',  hint: 'Remove blocks (30% refund)' },
  { key: 'inspect',   name: 'Inspect',   hint: 'See what the game thinks you built' },
  { key: 'terrain',   name: 'Terrain',   hint: 'Raise, lower, flatten and slope the ground' },
  { key: 'blueprint', name: 'Blueprint', hint: 'Copy, save and stamp structures' },
];

const MAX_GHOST = 3200;

/**
 * Owns everything between "player aimed at a voxel" and "the world changed":
 * target resolution, the ghost preview, costing, planning mode and blueprints.
 */
export class BuildController {
  constructor(game, scene, rig) {
    this.game = game;
    this.scene = scene;
    this.rig = rig;

    this.mode = 'build';
    this.tool = 'single';
    this.material = blockId('concrete');
    this.zoneKey = 'pitch_football';
    this.wallHeight = 3;
    this.standRise = 1;        // voxels of climb per seating row
    this.standGap = 14;        // columns between vomitories
    this.garageLevels = 3;
    this.terrainAmount = 2;
    this.lastPlan = null;
    this.anchor = null;
    this.aim = null;
    this.aimFace = null;
    this.clipboard = null;
    this.blueprints = [];
    this.replaceTarget = null;

    this.planning = null;   // { marker, cost, count }
    this.lastPrice = null;
    this.lastCells = null;
    this.inspectResult = null;
    this.onChange = null;   // UI refresh hook

    this.buildGhost();
  }

  // ------------------------------------------------------------------ ghost
  buildGhost() {
    const geo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0x39e08a, transparent: true, opacity: 0.34, depthWrite: false,
    });
    this.ghost = new THREE.InstancedMesh(geo, this.ghostMat, MAX_GHOST);
    this.ghost.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ghost.count = 0;
    this.ghost.frustumCulled = false;
    this.ghost.renderOrder = 6;
    this.scene.add(this.ghost);

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    this.outline.visible = false;
    this.outline.renderOrder = 7;
    this.scene.add(this.outline);

    this.bbox = new THREE.LineSegments(edges.clone(), new THREE.LineBasicMaterial({ color: 0x39e08a, transparent: true, opacity: 0.7 }));
    this.bbox.visible = false;
    this.bbox.renderOrder = 7;
    this.scene.add(this.bbox);

    this._m = new THREE.Matrix4();
  }

  setGhostColor(hex) {
    this.ghostMat.color.setHex(hex);
    this.bbox.material.color.setHex(hex);
  }

  // ----------------------------------------------------------------- aiming
  /** Resolve what the player is pointing at. `ndc` null = screen centre. */
  updateAim(ndc) {
    const r = ndc ? this.rig.ray(ndc.x, ndc.y) : this.rig.centreRay();
    const hit = raycastVoxel(this.game.world, r.origin, r.dir, 400);
    if (hit) {
      this.aimFace = hit;
      // Building places into the empty voxel in front of the face; every other
      // mode acts on the block that was actually hit.
      const placing = this.mode === 'build' || (this.mode === 'blueprint' && this.tool === 'paste');
      this.aim = placing
        ? { x: hit.px, y: hit.py, z: hit.pz }
        : { x: hit.x, y: hit.y, z: hit.z };
    } else {
      const p = raycastPlane(r.origin, r.dir, GROUND_Y);
      this.aimFace = null;
      this.aim = p && this.game.world.inBounds(p.x, p.y, p.z) ? p : null;
    }
    this.refreshPreview();
    return this.aim;
  }

  get activeTool() {
    if (this.mode === 'demolish') return this.tool === 'single' ? 'single' : this.tool;
    if (this.mode === 'blueprint') return this.tool;
    return this.tool;
  }

  toolNeedsTwoPoints() {
    const t = TOOLS.find((x) => x.key === this.activeTool);
    return !!t?.drag;
  }

  /** True when the active tool generates a multi-material structure. */
  get isPlanTool() { return PLAN_TOOLS.has(this.activeTool); }

  /**
   * Build the plan for a procedural tool. Pure: safe to call every frame for
   * the ghost preview.
   */
  buildPlan(a, b) {
    const w = this.game.world;
    switch (this.activeTool) {
      case 'grandstand': {
        // If the player has a seating material selected, use it.
        const mat = block(this.material);
        const seatBlock = mat.category === 'seating' ? this.material : blockId('seat');
        return generateGrandstand(w, a, b, {
          seatBlock,
          rise: this.standRise,
          gapEvery: this.standGap,
        });
      }
      case 'garage':
        return generateParkingGarage(w, a, b, { levels: this.garageLevels });
      case 'retaining':
        return generateRetainingWall(w, a, b, { block: this.material });
      case 'raise': case 'lower': case 'flatten': case 'ramp':
        return generateTerrainEdit(w, a, b, this.activeTool, { amount: this.terrainAmount });
      default:
        return { cells: [], meta: {} };
    }
  }

  previewCells() {
    if (!this.aim) return null;
    const tool = this.activeTool;
    const a = this.anchor || this.aim;
    const b = this.aim;

    if (this.isPlanTool) {
      // A structure only makes sense once both corners are known.
      if (!this.anchor) { this.lastPlan = null; return []; }
      const plan = this.buildPlan(a, b);
      this.lastPlan = plan;
      return planPositions(plan.cells);
    }
    this.lastPlan = null;
    return toolCells(tool, this.game.world, a, b, {
      wallHeight: this.wallHeight,
      clipboard: this.clipboard,
    });
  }

  refreshPreview() {
    const cells = this.previewCells();
    this.lastCells = cells;
    if (!cells || cells.length === 0) {
      this.ghost.count = 0;
      this.bbox.visible = false;
      this.outline.visible = false;
      this.lastPrice = null;
      return;
    }

    // Price it.
    if (this.isPlanTool && this.lastPlan) {
      this.lastPrice = pricePlan(this.game.world, this.lastPlan.cells);
      this.lastPrice.count = cells.length / 3;
    }
    const mode = this.mode === 'demolish' ? 'demolish' : this.mode === 'zone' ? 'zone' : (this.tool === 'paste' ? 'paste' : 'build');
    if (this.isPlanTool && this.lastPlan) {
      // already priced above
    } else if (mode === 'zone') {
      this.lastPrice = { cost: 0, refund: 0, placed: cells.length / 3, removed: 0, net: 0 };
    } else {
      this.lastPrice = priceEdit(this.game.world, cells, mode, this.material, {
        clipboard: this.clipboard,
        replaceTarget: this.tool === 'replace' ? this.replaceTarget : null,
      });
    }

    const colour = this.mode === 'terrain' ? 0x8a6a44
      : this.mode === 'demolish' ? 0xff5f6d
      : this.mode === 'zone' ? zone(this.zoneKey).color
      : this.mode === 'inspect' ? 0xf2b73d
      : (this.lastPrice.net > this.game.state.cash && !this.planning) ? 0xff5f6d : 0x39e08a;
    this.setGhostColor(colour);

    // Instance the ghost boxes (capped) and always draw the bounding box.
    const n = Math.min(MAX_GHOST, cells.length / 3);
    const stride = Math.max(1, Math.ceil((cells.length / 3) / MAX_GHOST));
    let idx = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < cells.length; i += 3 * stride) {
      const x = cells[i], y = cells[i + 1], z = cells[i + 2];
      if (idx < MAX_GHOST) {
        this._m.makeTranslation((x + 0.5) * BLOCK_SIZE, (y + 0.5) * BLOCK_SIZE, (z + 0.5) * BLOCK_SIZE);
        this.ghost.setMatrixAt(idx++, this._m);
      }
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    this.ghost.count = idx;
    this.ghost.instanceMatrix.needsUpdate = true;

    const sx = (maxX - minX + 1) * BLOCK_SIZE, sy = (maxY - minY + 1) * BLOCK_SIZE, sz = (maxZ - minZ + 1) * BLOCK_SIZE;
    this.bbox.scale.set(sx * 1.002, sy * 1.002, sz * 1.002);
    this.bbox.position.set((minX * BLOCK_SIZE) + sx / 2, (minY * BLOCK_SIZE) + sy / 2, (minZ * BLOCK_SIZE) + sz / 2);
    this.bbox.visible = cells.length > 3;

    // Highlight the exact voxel under the cursor.
    if (this.aimFace && this.mode !== 'build') {
      this.outline.scale.setScalar(BLOCK_SIZE * 1.006);
      this.outline.position.set(
        (this.aimFace.x + 0.5) * BLOCK_SIZE,
        (this.aimFace.y + 0.5) * BLOCK_SIZE,
        (this.aimFace.z + 0.5) * BLOCK_SIZE);
      this.outline.visible = true;
    } else {
      this.outline.visible = false;
    }
  }

  /** Human-readable summary of the pending action, for the dock. */
  previewSummary() {
    if (!this.lastPrice || !this.lastCells) return null;
    const count = this.lastCells.length / 3;
    return {
      count,
      placed: this.lastPrice.placed,
      removed: this.lastPrice.removed,
      cost: this.lastPrice.net * (this.game.state.buildCostMult || 1),
      affordable: this.planning || this.lastPrice.net * (this.game.state.buildCostMult || 1) <= this.game.state.cash,
      awaitingSecondPoint: this.toolNeedsTwoPoints() && !this.anchor,
    };
  }

  // ----------------------------------------------------------------- acting
  /**
   * The single entry point for a tap. Returns a short status string for the UI.
   */
  act(button = 0) {
    if (!this.aim) return null;

    if (this.mode === 'inspect') return this.doInspect();

    if (button === 2) {
      // Right click / remove button always cancels a pending anchor first.
      if (this.anchor) { this.anchor = null; this.refreshPreview(); return 'Cancelled'; }
      return this.removeSingle();
    }

    if (this.toolNeedsTwoPoints() && !this.anchor) {
      this.anchor = { ...this.aim };
      if (this.tool === 'replace') {
        this.replaceTarget = this.game.world.getBlock(this.aim.x, this.aim.y, this.aim.z) || null;
      }
      this.refreshPreview();
      return 'Now tap the second point';
    }

    return this.commit();
  }

  commit() {
    const cells = this.previewCells();
    if (!cells || cells.length === 0) { this.anchor = null; return null; }
    const g = this.game;

    // Procedural structures take the plan path: multi-material, one batch.
    if (this.isPlanTool && this.lastPlan) {
      const plan = this.lastPlan;
      const price = pricePlan(g.world, plan.cells);
      const net = price.net * (g.state.buildCostMult || 1);
      if (!this.planning && net > 0 && net > g.state.cash) {
        this.anchor = null;
        this.refreshPreview();
        return { error: `You need ${fmt(net)} for this. You have ${fmt(g.state.cash)}.` };
      }
      // Terrain work is immediate; real structures go up over days.
      const staged = this.activeTool !== 'raise' && this.activeTool !== 'lower'
        && this.activeTool !== 'flatten' && this.activeTool !== 'ramp'
        && !this.planning
        && g.stageOrApply({
          label: STRUCTURE_LABEL[this.activeTool] || 'Structure',
          cells: plan.cells,
          cost: net,
          count: price.placed,
        });

      if (staged) {
        if (net > 0) g.spendConstruction(net, true);
        else if (net < 0) g.refund(-net);
        g.state.stats.blocksPlaced += price.placed;
        this.anchor = null;
        this.refreshPreview();
        this.onChange?.();
        return `${describePlan(this.activeTool, plan.meta, net)} \u2014 under construction`;
      }

      const batch = applyPlan(g.world, plan.cells, TOOL_LABEL[this.activeTool] || 'Structure');
      g.history.push(batch);
      if (this.planning) { this.planning.cost += net; this.planning.count += batch.size; }
      else if (net > 0) g.spendConstruction(net, true);
      else if (net < 0) g.refund(-net);
      g.state.stats.blocksPlaced += price.placed;
      this.finish(batch, batch.size);
      return describePlan(this.activeTool, plan.meta, net);
    }

    // Blueprint copy does not modify anything.
    if (this.mode === 'blueprint' && this.tool === 'copy') {
      this.clipboard = copyRegion(g.world, this.anchor || this.aim, this.aim);
      this.anchor = null;
      this.tool = 'paste';
      this.refreshPreview();
      this.onChange?.();
      return `Copied ${this.clipboard.count} blocks`;
    }

    const mode = this.mode === 'demolish' ? 'demolish'
      : this.mode === 'zone' ? 'zone'
      : this.tool === 'paste' ? 'paste' : 'build';

    if (mode === 'zone') {
      const batch = applyEdit(g.world, cells, 'zone', 0, { zoneId: zoneId(this.zoneKey), label: `Zone: ${zone(this.zoneKey).name}` });
      g.history.push(batch);
      this.finish(batch, 0);
      return `Zoned ${batch.size} blocks as ${zone(this.zoneKey).name}`;
    }

    const price = priceEdit(g.world, cells, mode, this.material, {
      clipboard: this.clipboard,
      replaceTarget: this.tool === 'replace' ? this.replaceTarget : null,
    });
    const net = price.net * (g.state.buildCostMult || 1);

    if (!this.planning && net > 0 && net > g.state.cash) {
      this.anchor = null;
      this.refreshPreview();
      return { error: `You need ${fmt(net)} for this. You have ${fmt(g.state.cash)}.` };
    }

    const batch = applyEdit(g.world, cells, mode, this.material, {
      clipboard: this.clipboard,
      replaceTarget: this.tool === 'replace' ? this.replaceTarget : null,
      label: mode === 'demolish' ? 'Demolish' : `Build: ${block(this.material).name}`,
    });
    g.history.push(batch);

    if (this.planning) {
      this.planning.cost += net;
      this.planning.count += batch.size;
    } else if (net > 0) {
      g.spendConstruction(net, true);
    } else if (net < 0) {
      g.refund(-net);
    }

    this.finish(batch, batch.size);
    if (mode === 'demolish') return `Removed ${price.removed} blocks (+${fmt(price.refund)})`;
    return `${price.placed} blocks placed (${fmt(net)})`;
  }

  finish(batch, count) {
    const st = this.game.state.stats;
    if (this.mode === 'demolish') st.blocksRemoved += batch.size;
    else if (this.mode === 'build') st.blocksPlaced += batch.size;
    this.anchor = null;
    this.game.markWorldDirty();
    this.game.checkAchievements();
    this.refreshPreview();
    this.onChange?.();
  }

  removeSingle() {
    if (!this.aimFace) return null;
    const g = this.game;
    const cells = [this.aimFace.x, this.aimFace.y, this.aimFace.z];
    const price = priceEdit(g.world, cells, 'demolish', 0);
    if (price.removed === 0) return null;
    const batch = applyEdit(g.world, cells, 'demolish', 0, { label: 'Demolish' });
    g.history.push(batch);
    if (!this.planning) g.refund(batch.refund);
    else this.planning.cost -= batch.refund;
    g.state.stats.blocksRemoved += batch.size;
    g.markWorldDirty();
    this.refreshPreview();
    this.onChange?.();
    return `Removed (+${fmt(batch.refund)})`;
  }

  doInspect() {
    const w = this.game.world;
    const { x, y, z } = this.aim;
    const bid = w.getBlock(x, y, z);
    const zid = w.getZone(x, y, z);
    const venue = nearestVenue(this.game.venues, x, z);
    this.inspectResult = {
      pos: { x, y, z },
      metres: { x: x * BLOCK_SIZE, y: (y - GROUND_Y) * BLOCK_SIZE, z: z * BLOCK_SIZE },
      block: bid ? block(bid) : null,
      zone: zid ? zone(zid) : null,
      venue,
    };
    this.onChange?.();
    return 'inspect';
  }

  // ----------------------------------------------------------------- undo
  undo() {
    const b = this.game.history.undo();
    if (!b) return null;
    if (this.planning) this.planning.cost -= (b.cost - b.refund) * (this.game.state.buildCostMult || 1);
    else this.game.refund((b.cost - b.refund) * (this.game.state.buildCostMult || 1));
    this.game.markWorldDirty();
    this.refreshPreview();
    this.onChange?.();
    return b;
  }

  redo() {
    const b = this.game.history.redo();
    if (!b) return null;
    const net = (b.cost - b.refund) * (this.game.state.buildCostMult || 1);
    if (this.planning) this.planning.cost += net;
    else if (net > 0) this.game.spendConstruction(net, true);
    else this.game.refund(-net);
    this.game.markWorldDirty();
    this.refreshPreview();
    this.onChange?.();
    return b;
  }

  // ------------------------------------------------------------- planning
  startPlanning() {
    if (this.planning) return;
    this.planning = { marker: this.game.history.mark(), cost: 0, count: 0 };
    this.onChange?.();
  }

  commitPlan() {
    if (!this.planning) return null;
    const { cost, count } = this.planning;
    if (cost > this.game.state.cash) {
      return { error: `This plan costs ${fmt(cost)} but you only have ${fmt(this.game.state.cash)}.` };
    }
    if (cost > 0) this.game.spendConstruction(cost, true);
    else if (cost < 0) this.game.refund(-cost);
    this.planning = null;
    this.game.history.clearRedo();
    this.onChange?.();
    return { ok: true, cost, count };
  }

  cancelPlan() {
    if (!this.planning) return null;
    this.game.history.rollbackTo(this.planning.marker);
    this.planning = null;
    this.game.markWorldDirty();
    this.refreshPreview();
    this.onChange?.();
    return { ok: true };
  }

  // ------------------------------------------------------------ blueprints
  saveBlueprint(name) {
    if (!this.clipboard) return { error: 'Copy a structure first.' };
    const bp = {
      id: `BP${Date.now().toString(36)}`,
      name: name || `Blueprint ${this.blueprints.length + 1}`,
      size: this.clipboard.size,
      count: this.clipboard.count,
      cells: this.clipboard.cells.slice(),
    };
    this.blueprints.push(bp);
    this.persistBlueprints();
    this.onChange?.();
    return { ok: true, bp };
  }

  loadBlueprint(id) {
    const bp = this.blueprints.find((b) => b.id === id);
    if (!bp) return;
    this.clipboard = { cells: bp.cells.slice(), size: bp.size, count: bp.count };
    this.mode = 'blueprint';
    this.tool = 'paste';
    this.refreshPreview();
    this.onChange?.();
  }

  deleteBlueprint(id) {
    this.blueprints = this.blueprints.filter((b) => b.id !== id);
    this.persistBlueprints();
    this.onChange?.();
  }

  rotateClipboard() {
    if (!this.clipboard) return;
    this.clipboard = rotateClipboard(this.clipboard);
    this.refreshPreview();
    this.onChange?.();
  }

  persistBlueprints() {
    try {
      localStorage.setItem('sct3d:blueprints', JSON.stringify(this.blueprints));
    } catch { /* quota or private mode */ }
  }

  restoreBlueprints() {
    try {
      const raw = localStorage.getItem('sct3d:blueprints');
      if (raw) this.blueprints = JSON.parse(raw);
    } catch { this.blueprints = []; }
  }

  setMode(mode) {
    const prev = this.mode;
    this.mode = mode;
    this.anchor = null;
    if (mode === 'blueprint' && !this.clipboard) this.tool = 'copy';
    if (mode === 'build' && !BUILD_TOOL_KEYS.includes(this.tool)) this.tool = 'single';
    if (mode === 'terrain' && !TERRAIN_TOOL_KEYS.includes(this.tool)) this.tool = 'raise';
    if (mode !== 'terrain' && TERRAIN_TOOL_KEYS.includes(this.tool)) this.tool = 'single';
    if (mode === 'zone' && !['single', 'floor', 'box', 'line'].includes(this.tool)) this.tool = 'floor';
    if (mode === 'demolish' && ['copy', 'paste', 'replace', 'fill'].includes(this.tool)) this.tool = 'box';
    this.refreshPreview();
    this.onChange?.();
  }

  setTool(tool) {
    this.tool = tool;
    this.anchor = null;
    this.refreshPreview();
    this.onChange?.();
  }

  setMaterial(id) {
    this.material = id;
    this.refreshPreview();
    this.onChange?.();
  }

  setZone(key) {
    this.zoneKey = key;
    this.refreshPreview();
    this.onChange?.();
  }

  setVisible(v) {
    this.ghost.visible = v;
    this.outline.visible = v && this.outline.visible;
    this.bbox.visible = v && this.bbox.visible;
  }
}

const BUILD_TOOL_KEYS = ['single', 'line', 'wall', 'floor', 'box', 'hollow', 'fill',
  'replace', 'grandstand', 'garage', 'retaining'];
const TERRAIN_TOOL_KEYS = ['raise', 'lower', 'flatten', 'ramp'];

const STRUCTURE_LABEL = {
  grandstand: 'Grandstand', garage: 'Parking garage', retaining: 'Retaining wall',
};

const TOOL_LABEL = {
  grandstand: 'Build: grandstand', garage: 'Build: parking garage',
  retaining: 'Build: retaining wall', raise: 'Terrain: raise',
  lower: 'Terrain: lower', flatten: 'Terrain: flatten', ramp: 'Terrain: ramp',
};

/** A human-readable result line for a procedural structure. */
function describePlan(tool, meta, net) {
  const money = net >= 0 ? fmt(net) : `refund ${fmt(-net)}`;
  switch (tool) {
    case 'grandstand':
      return `Grandstand: ${meta.rows} rows, ${meta.capacity.toLocaleString()} seats (${money})`;
    case 'garage':
      return `Parking garage: ${meta.levels} levels, ${meta.spaces.toLocaleString()} spaces (${money})`;
    case 'retaining':
      return `Retaining wall built (${money})`;
    case 'raise': case 'lower': case 'flatten': case 'ramp':
      return `Terrain reshaped across ${meta.columns.toLocaleString()} columns (${money})`;
    default:
      return `Structure built (${money})`;
  }
}

function nearestVenue(venues, x, z) {
  let best = null, bd = Infinity;
  for (const v of venues) {
    const d = Math.hypot(v.centre.x - x, v.centre.z - z);
    if (d < bd && d < v.reach) { bd = d; best = v; }
  }
  return best;
}

const fmt = (v) => {
  const a = Math.abs(Math.round(v));
  const s = v < 0 ? '-' : '';
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `${s}$${Math.round(a / 1000)}K`;
  return `${s}$${a.toLocaleString()}`;
};

export { TOOLS, BUILD_TOOL_KEYS, TERRAIN_TOOL_KEYS };
