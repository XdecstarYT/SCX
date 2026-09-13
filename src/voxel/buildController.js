import * as THREE from 'three';
import { BLOCK_SIZE, CHUNK_Y, GROUND_Y } from '../core/constants.js';
import { block, blockId, AIR } from '../data/blocks.js';
import { zone, zoneId, ZONE_NONE } from '../data/zones.js';
import { raycastVoxel, raycastPlane } from './raycast.js';
import {
  toolCells, priceEdit, applyEdit, copyRegion, rotateClipboard,
  TOOLS, CLIP_STRIDE, PLAN_TOOLS, pricePlan, applyPlan, planPositions,
} from './buildTools.js';
import {
  generateGrandstand, generateParkingGarage, generateRetainingWall, generateTerrainEdit,
  generateBowl, generateCanopy,
} from './structures.js';
import { generatePrefab, PREFAB_BY_KEY } from './prefabs.js';
import { EditBatch } from './history.js';
import { prop, PROP_BY_ID } from '../data/props.js';
import { PropGhost } from '../world/propRenderer.js';

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
 * How far you can place from. Walking around, reach is an arm's length plus a
 * bit, exactly as it should be; from the free camera you are surveying the
 * site rather than laying bricks, so it opens right up.
 */
export const FIRST_PERSON_REACH = 14;   // metres (7 blocks)
export const FREE_REACH = 400;

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
    this.bowlRows = 12;        // rake depth of each tier of a seating bowl
    this.canopyClear = 4;      // blocks of headroom under a canopy deck
    this.roofPitch = 1;        // gable slope: blocks of rise per block in
    this.domePitch = 1;        // 1 = a true hemisphere, lower = a shallow cap
    this.lastPlan = null;
    this.anchor = null;
    this.aim = null;
    this.aimFace = null;
    this.clipboard = null;
    this.blueprints = [];
    this.replaceTarget = null;
    // What the player is holding, and which way up it goes. Rotation belongs
    // to props and prefabs: a voxel is one flat colour, so turning one would
    // be invisible.
    this.propKey = null;
    this.prefabKey = null;
    this.rotation = 0;
    this.aimProp = null;

    this.planning = null;   // { marker, cost, count }
    this.lastPrice = null;
    this.lastCells = null;
    this.inspectResult = null;
    this.onChange = null;   // UI refresh hook

    this.buildGhost();
    this.propGhost = new PropGhost(scene);
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
  get reach() {
    return this.rig?.isWalking ? FIRST_PERSON_REACH : FREE_REACH;
  }

  updateAim(ndc) {
    const r = ndc ? this.rig.ray(ndc.x, ndc.y) : this.rig.centreRay();
    const world = this.game.world;
    const hit = raycastVoxel(world, r.origin, r.dir, this.reach);
    // Equipment stands in front of the blocks it sits on, so whichever the ray
    // reaches first is what the player means.
    const ph = world.props?.size ? world.props.raycast(r.origin, r.dir, this.reach) : null;
    this.aimProp = ph && (!hit || ph.dist <= hit.dist) ? ph.rec : null;
    if (hit) {
      this.aimFace = hit;
      // Building places into the empty voxel in front of the face; every other
      // mode acts on the block that was actually hit.
      // Prefabs and pasted structures land ON the surface you point at, the
      // same as a block does; every other mode acts on the block itself.
      const placing = this.mode === 'build'
        || (this.mode === 'blueprint' && (this.tool === 'paste' || this.tool === 'prefab'));
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

  /** True when the hotbar slot in hand is a piece of equipment, not a block. */
  get holdingProp() { return this.mode === 'build' && !!this.propKey; }

  get holdingPrefab() { return this.mode === 'blueprint' && this.tool === 'prefab' && !!this.prefabKey; }

  /** Rotate whatever is in hand by 90 degrees. */
  rotate(dir = 1) {
    if (this.mode === 'blueprint' && this.tool === 'paste' && this.clipboard) {
      this.clipboard = rotateClipboard(this.clipboard);
      this.rotation = (this.rotation + 1) & 3;
      this.refreshPreview();
      this.onChange?.();
      return 'Rotated the clipboard 90\u00B0';
    }
    this.rotation = (this.rotation + (dir >= 0 ? 1 : 3)) & 3;
    this.refreshPreview();
    this.onChange?.();
    if (this.holdingProp) return `${prop(this.propKey).name} facing ${FACING[this.rotation]}`;
    if (this.holdingPrefab) return `${PREFAB_BY_KEY.get(this.prefabKey)?.name || 'Prefab'} facing ${FACING[this.rotation]}`;
    return `Facing ${FACING[this.rotation]}`;
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
      case 'bowl': {
        const mat = block(this.material);
        return generateBowl(w, a, b, {
          seatBlock: mat.category === 'seating' ? this.material : blockId('seat'),
          rise: this.standRise,
          gapEvery: this.standGap,
          rows: this.bowlRows,
        });
      }
      case 'canopy': {
        const mat = block(this.material);
        return generateCanopy(w, a, b, {
          block: mat.category === 'roof' ? this.material : blockId('roof_metal'),
          clearance: this.canopyClear,
        });
      }
      case 'garage':
        return generateParkingGarage(w, a, b, { levels: this.garageLevels });
      case 'retaining':
        return generateRetainingWall(w, a, b, { block: this.material });
      case 'raise': case 'lower': case 'flatten': case 'ramp':
        return generateTerrainEdit(w, a, b, this.activeTool, { amount: this.terrainAmount });
      case 'prefab':
        return generatePrefab(w, this.prefabKey, a, this.rotation);
      default:
        return { cells: [], meta: {} };
    }
  }

  previewCells() {
    if (!this.aim) return null;
    const tool = this.activeTool;
    const a = this.anchor || this.aim;
    const b = this.aim;

    if (this.holdingProp) {
      // Equipment has no cell list: its preview is the model itself.
      this.lastPlan = null;
      return [];
    }

    if (this.isPlanTool) {
      // A prefab lands where you point; every other structure needs two corners.
      const single = tool === 'prefab';
      if (!single && !this.anchor) { this.lastPlan = null; return []; }
      const plan = this.buildPlan(single ? b : a, b);
      this.lastPlan = plan;
      return planPositions(plan.cells);
    }
    this.lastPlan = null;
    return toolCells(tool, this.game.world, a, b, {
      wallHeight: this.wallHeight,
      clipboard: this.clipboard,
      roofPitch: this.roofPitch,
      domePitch: this.domePitch,
    });
  }

  refreshPreview() {
    const cells = this.previewCells();
    this.lastCells = cells;

    // Equipment previews as the model itself, turned the way it will land.
    if (this.holdingProp) {
      this.ghost.count = 0;
      this.bbox.visible = false;
      this.outline.visible = false;
      this.updatePropGhost();
      return;
    }
    this.propGhost.hide();

    if (!cells || cells.length === 0) {
      this.ghost.count = 0;
      this.bbox.visible = false;
      this.outline.visible = false;
      this.lastPrice = null;
      return;
    }

    // Price it.
    if (this.isPlanTool && this.lastPlan) {
      this.lastPrice = pricePlan(this.game.world, this.lastPlan.cells, this.lastPlan.props);
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

    // Outline the block you are pointing at. In BUILD mode that is the face
    // you are aiming at, so you can see what you are building against; in
    // every other mode it is the block that will be affected.
    const target = this.mode === 'build' ? this.aimFace : (this.aimFace || this.aim);
    if (target) {
      this.outline.scale.setScalar(BLOCK_SIZE * 1.006);
      this.outline.position.set(
        (target.x + 0.5) * BLOCK_SIZE,
        (target.y + 0.5) * BLOCK_SIZE,
        (target.z + 0.5) * BLOCK_SIZE);
      this.outline.visible = true;
    } else {
      this.outline.visible = false;
    }
  }

  /** Ghost the held piece of equipment where it would land. */
  updatePropGhost() {
    const type = prop(this.propKey);
    if (!type || !this.aim) { this.propGhost.hide(); this.lastPrice = null; return; }
    const check = this.game.world.props.canPlace(
      this.game.world, type.id, this.aim.x, this.aim.y, this.aim.z, this.rotation);
    this.propBlockedReason = check.ok ? null : check.reason;
    const cost = type.cost * (this.game.state.buildCostMult || 1);
    this.lastPrice = {
      cost: type.cost, refund: 0, placed: check.ok ? 1 : 0, removed: 0,
      net: type.cost, prop: type, ok: check.ok,
    };
    this.propGhost.show(this.propKey, this.aim.x, this.aim.y, this.aim.z, this.rotation,
      check.ok && cost <= this.game.state.cash);
  }

  /** Place the held piece of equipment. */
  placeProp() {
    const g = this.game;
    const type = prop(this.propKey);
    if (!type || !this.aim) return null;
    if (type.unlock && !g.isUnlocked(type.unlock)) {
      return { error: `${type.name} needs the matching research project first.` };
    }
    const check = g.world.props.canPlace(g.world, type.id, this.aim.x, this.aim.y, this.aim.z, this.rotation);
    if (!check.ok) return { error: check.reason };
    const net = type.cost * (g.state.buildCostMult || 1);
    if (!this.planning && net > g.state.cash) {
      return { error: `${type.name} costs ${fmt(net)}. You have ${fmt(g.state.cash)}.` };
    }
    const batch = new EditBatch('Place: ' + type.name);
    g.world.props.add(type.id, this.aim.x, this.aim.y, this.aim.z, this.rotation);
    batch.recordProp('add', type.id, this.aim.x, this.aim.y, this.aim.z, this.rotation);
    batch.cost = type.cost;
    g.history.push(batch);
    if (this.planning) { this.planning.cost += net; this.planning.count += 1; }
    else g.spendConstruction(net, true);
    g.state.stats.blocksPlaced += 1;
    g.markWorldDirty();
    g.checkAchievements();
    this.refreshPreview();
    this.onChange?.();
    return `${type.name} placed (${fmt(net)})`;
  }

  /** Remove the piece of equipment under the crosshair. */
  removeProp(rec) {
    const g = this.game;
    const type = PROP_BY_ID[rec.typeId];
    g.world.props.remove(rec.x, rec.y, rec.z);
    const batch = new EditBatch('Remove: ' + (type?.name || 'equipment'));
    batch.recordProp('del', rec.typeId, rec.x, rec.y, rec.z, rec.rot);
    const refund = (type?.cost || 0) * 0.3;
    batch.refund = refund;
    g.history.push(batch);
    if (this.planning) this.planning.cost -= refund;
    else g.refund(refund);
    g.state.stats.blocksRemoved += 1;
    g.markWorldDirty();
    g.checkAchievements();
    this.refreshPreview();
    this.onChange?.();
    return `${type?.name || 'Equipment'} removed (+${fmt(refund)})`;
  }

  /** Human-readable summary of the pending action, for the dock. */
  previewSummary() {
    if (this.holdingProp) {
      if (!this.lastPrice?.prop) return null;
      const cost = this.lastPrice.net * (this.game.state.buildCostMult || 1);
      return {
        count: 1, placed: this.lastPrice.placed, removed: 0, cost,
        affordable: !!this.planning || cost <= this.game.state.cash,
        awaitingSecondPoint: false,
        prop: this.lastPrice.prop,
        blocked: this.propBlockedReason,
      };
    }
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
  act(button = 0, confirmed = false) {
    if (!this.aim) return null;

    if (this.mode === 'inspect') return this.doInspect();

    if (button === 2) {
      // Right click / remove button always cancels a pending anchor first.
      if (this.anchor) { this.anchor = null; this.refreshPreview(); return 'Cancelled'; }
      return this.removeSingle(confirmed);
    }

    // Demolishing a single tap on a piece of equipment takes the equipment.
    if (this.mode === 'demolish' && this.tool === 'single' && this.aimProp) {
      return this.confirmOrRemoveProp(this.aimProp, confirmed);
    }

    if (this.holdingProp) return this.placeProp();

    if (this.toolNeedsTwoPoints() && !this.anchor) {
      this.anchor = { ...this.aim };
      if (this.tool === 'replace') {
        this.replaceTarget = this.game.world.getBlock(this.aim.x, this.aim.y, this.aim.z) || null;
      }
      this.refreshPreview();
      return 'Now tap the second point';
    }

    return this.commit(confirmed);
  }

  commit(confirmed = false) {
    const cells = this.previewCells();
    if (!cells || cells.length === 0) { this.anchor = null; return null; }
    const g = this.game;

    // A prefab may be built out of materials that are still behind research.
    // The palette greys those blocks out, so a prefab that used them would be
    // a way round the tech tree rather than a shortcut through the tedium.
    if (this.activeTool === 'prefab') {
      const def = PREFAB_BY_KEY.get(this.prefabKey);
      if (def?.unlock && !g.isUnlocked(def.unlock)) {
        this.anchor = null;
        return { error: `${def.name} needs the matching research project first.` };
      }
    }

    // Procedural structures take the plan path: multi-material, one batch.
    if (this.isPlanTool && this.lastPlan) {
      const plan = this.lastPlan;
      const price = pricePlan(g.world, plan.cells, plan.props);
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
          label: plan.meta?.name || STRUCTURE_LABEL[this.activeTool] || 'Structure',
          cells: plan.cells,
          props: plan.props || null,
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

      const batch = applyPlan(g.world,
        plan.cells,
        plan.meta?.name ? `Build: ${plan.meta.name}` : (TOOL_LABEL[this.activeTool] || 'Structure'),
        plan.props || null);
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
      return `Zoned ${batch.voxelCount} blocks as ${zone(this.zoneKey).name}`;
    }

    const price = priceEdit(g.world, cells, mode, this.material, {
      clipboard: this.clipboard,
      replaceTarget: this.tool === 'replace' ? this.replaceTarget : null,
    });
    const net = price.net * (g.state.buildCostMult || 1);

    if (mode === 'demolish' && !confirmed) {
      const concern = this.demolitionConcern(cells, price);
      if (concern) return { confirm: concern };
    }

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
    if (mode === 'demolish') {
      const extra = price.propsRemoved ? ` and ${price.propsRemoved} piece${price.propsRemoved === 1 ? '' : 's'} of equipment` : '';
      return `Removed ${price.removed} blocks${extra} (+${fmt(price.refund)})`;
    }
    return `${price.placed} blocks placed (${fmt(net)})`;
  }

  finish(batch, count) {
    const st = this.game.state.stats;
    if (this.mode === 'demolish') st.blocksRemoved += batch.voxelCount;
    else if (this.mode === 'build') st.blocksPlaced += batch.voxelCount;
    this.anchor = null;
    this.game.markWorldDirty();
    this.game.checkAchievements();
    this.refreshPreview();
    this.onChange?.();
  }

  removeSingle(confirmed = false) {
    if (this.aimProp) return this.confirmOrRemoveProp(this.aimProp, confirmed);
    if (!this.aimFace) return null;
    const g = this.game;
    const cells = [this.aimFace.x, this.aimFace.y, this.aimFace.z];
    const price = priceEdit(g.world, cells, 'demolish', 0);
    if (price.removed === 0) return null;
    const batch = applyEdit(g.world, cells, 'demolish', 0, { label: 'Demolish' });
    g.history.push(batch);
    if (!this.planning) g.refund(batch.refund);
    else this.planning.cost -= batch.refund;
    g.state.stats.blocksRemoved += batch.voxelCount;
    g.markWorldDirty();
    this.refreshPreview();
    this.onChange?.();
    return `Removed (+${fmt(batch.refund)})`;
  }

  /**
   * Equipment is expensive and easy to knock over by accident, so removing a
   * piece asks first unless the player has already said yes.
   */
  confirmOrRemoveProp(rec, confirmed) {
    const type = PROP_BY_ID[rec.typeId];
    if (!confirmed && (type?.cost || 0) >= CONFIRM_VALUE) {
      return {
        confirm: {
          title: `Remove ${type.name}?`,
          body: `You get back ${fmt((type.cost || 0) * 0.3)} of the ${fmt(type.cost || 0)} it cost. This can be undone.`,
          action: 'removeProp',
          button: 2,
        },
      };
    }
    return this.removeProp(rec);
  }

  /**
   * Is this demolition big enough, or important enough, to be worth asking
   * about? A stray tap should never take out a stand or a roof section.
   */
  demolitionConcern(cells, price) {
    if (!cells || price.removed === 0) return null;
    const w = this.game.world;
    let structural = 0, seats = 0, roofing = 0, fixtures = 0;
    const propHits = new Set();
    for (let i = 0; i < cells.length; i += 3) {
      const id = w.getBlock(cells[i], cells[i + 1], cells[i + 2]);
      if (!id) continue;
      const b = block(id);
      if (b.support >= 16) structural++;
      if (b.category === 'seating') seats++;
      if (b.category === 'roof') roofing++;
      if (b.light || b.power > 0.01) fixtures++;
      if (w.props?.size) {
        for (const dy of [0, 1]) {
          const rec = w.props.at(cells[i], cells[i + 1] + dy, cells[i + 2]);
          if (rec) propHits.add(rec);
        }
      }
    }
    const reasons = [];
    if (seats >= 40) reasons.push(`${seats.toLocaleString()} blocks of seating`);
    if (roofing >= 30) reasons.push(`${roofing.toLocaleString()} roof panels`);
    if (structural >= 20) reasons.push(`${structural.toLocaleString()} load-bearing blocks`);
    if (fixtures > 0) reasons.push(`${fixtures} floodlight${fixtures === 1 ? '' : 's'} or powered fixture${fixtures === 1 ? '' : 's'}`);
    if (propHits.size > 0) reasons.push(`${propHits.size} piece${propHits.size === 1 ? '' : 's'} of equipment`);
    if (!reasons.length && price.removed < CONFIRM_BLOCKS) return null;
    if (!reasons.length) reasons.push(`${price.removed.toLocaleString()} blocks`);
    return {
      title: 'Demolish this?',
      body: `This removes ${reasons.join(', ')}. You get back ${fmt(price.refund)}. This can be undone.`,
      action: 'demolish',
      button: 0,
    };
  }

  /**
   * Eyedropper. Returns the key of whatever you are looking at, so the hotbar
   * can hold it - the fastest way to match an existing material.
   */
  pickTarget() {
    // Equipment first: if you are looking at a goal, that is what you meant.
    if (this.aimProp && this.mode !== 'zone') {
      const t = PROP_BY_ID[this.aimProp.typeId];
      if (t) return { kind: 'prop', key: t.key, name: t.name, rot: this.aimProp.rot };
    }
    if (!this.aimFace) return null;
    const w = this.game.world;
    if (this.mode === 'zone') {
      const zid = w.getZone(this.aimFace.x, this.aimFace.y, this.aimFace.z);
      return zid ? { kind: 'zone', key: zone(zid).key, name: zone(zid).name } : null;
    }
    const bid = w.getBlock(this.aimFace.x, this.aimFace.y, this.aimFace.z);
    return bid ? { kind: 'block', key: block(bid).key, name: block(bid).name } : null;
  }

  doInspect() {
    const w = this.game.world;
    const { x, y, z } = this.aim;
    const bid = w.getBlock(x, y, z);
    const zid = w.getZone(x, y, z);
    const venue = nearestVenue(this.game.venues, x, z);
    const propRec = this.aimProp || w.props?.at(x, y, z) || w.props?.at(x, y + 1, z) || null;
    this.inspectResult = {
      pos: { x, y, z },
      metres: { x: x * BLOCK_SIZE, y: (y - GROUND_Y) * BLOCK_SIZE, z: z * BLOCK_SIZE },
      block: bid ? block(bid) : null,
      zone: zid ? zone(zid) : null,
      prop: propRec ? PROP_BY_ID[propRec.typeId] : null,
      propRot: propRec ? propRec.rot : 0,
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
    if (mode === 'blueprint' && this.tool === 'prefab' && !this.prefabKey) this.tool = 'copy';
    if (mode === 'blueprint' && !this.clipboard && this.tool === 'paste') this.tool = this.prefabKey ? 'prefab' : 'copy';
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
    this.propKey = null;
    this.refreshPreview();
    this.onChange?.();
  }

  /** Hold a piece of sports equipment instead of a block. */
  setProp(key) {
    if (!prop(key)) return;
    this.propKey = key;
    if (this.mode !== 'build') this.mode = 'build';
    this.tool = 'single';
    this.anchor = null;
    this.refreshPreview();
    this.onChange?.();
  }

  /** Arm a prefab for stamping. */
  setPrefab(key) {
    if (!PREFAB_BY_KEY.has(key)) return;
    this.prefabKey = key;
    this.mode = 'blueprint';
    this.tool = 'prefab';
    this.anchor = null;
    this.refreshPreview();
    this.onChange?.();
  }

  setZone(key) {
    this.zoneKey = key;
    this.refreshPreview();
    this.onChange?.();
  }

  setVisible(v) {
    this.propGhost.mesh.visible = v && this.propGhost.mesh.visible;
    this.ghost.visible = v;
    this.outline.visible = v && this.outline.visible;
    this.bbox.visible = v && this.bbox.visible;
  }
}

const BUILD_TOOL_KEYS = ['single', 'line', 'wall', 'floor', 'box', 'hollow',
  'circle', 'cylinder', 'dome', 'pitched', 'stairs', 'fill',
  'replace', 'grandstand', 'bowl', 'canopy', 'garage', 'retaining'];

/** Confirm before demolishing this many blocks, or equipment worth this much. */
const CONFIRM_BLOCKS = 120;
const CONFIRM_VALUE = 20_000;
const FACING = ['north', 'east', 'south', 'west'];
const TERRAIN_TOOL_KEYS = ['raise', 'lower', 'flatten', 'ramp'];

const STRUCTURE_LABEL = {
  grandstand: 'Grandstand', garage: 'Parking garage', retaining: 'Retaining wall',
  bowl: 'Seating bowl', canopy: 'Canopy roof',
};

const TOOL_LABEL = {
  grandstand: 'Build: grandstand', garage: 'Build: parking garage',
  bowl: 'Build: seating bowl', canopy: 'Build: canopy roof',
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
    case 'bowl':
      return `Seating bowl: ${meta.sides} tiers, ${meta.capacity.toLocaleString()} seats (${money})`;
    case 'canopy':
      return `Canopy: ${meta.panels.toLocaleString()} panels on ${meta.columns} columns (${money})`;
    case 'retaining':
      return `Retaining wall built (${money})`;
    case 'prefab':
      return `${meta.name} placed${meta.propCount ? `, ${meta.propCount} fittings` : ''} (${money})`;
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
