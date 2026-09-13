import { el, fill, clear } from './dom.js';
import { block } from '../data/blocks.js';
import { zone } from '../data/zones.js';
import { TOOLS } from '../voxel/buildTools.js';
import { BUILD_MODES } from '../voxel/buildController.js';
import { fmtMoney } from '../core/economy.js';
import { PREFAB_BY_KEY } from '../voxel/prefabs.js';

const FACING = ['N', 'E', 'S', 'W'];

const TOOL_SETS = {
  build: ['single', 'line', 'wall', 'floor', 'box', 'hollow',
          'circle', 'cylinder', 'dome', 'pitched', 'stairs', 'fill', 'replace',
          'grandstand', 'bowl', 'canopy', 'garage', 'retaining'],
  zone: ['single', 'floor', 'box', 'circle', 'line'],
  demolish: ['single', 'box', 'floor', 'circle', 'wall', 'line'],
  inspect: ['single'],
  terrain: ['raise', 'lower', 'flatten', 'ramp'],
  blueprint: ['copy', 'paste', 'prefab'],
};

/**
 * The contextual parameter button. Each tool that takes a number gets one
 * cycling control rather than a settings panel nobody would open.
 */
const HEIGHT = { prop: 'wallHeight', icon: '\u2195', label: (v) => `H ${v}`, cycle: (v) => (v >= 12 ? 1 : v + (v >= 6 ? 3 : 1)) };
const DEPTH = { prop: 'terrainAmount', icon: '\u2195', label: (v) => `${v * 2}m`, title: 'How far to move the ground', cycle: (v) => (v >= 8 ? 1 : v + 1) };

const TOOL_PARAMS = {
  wall:       { ...HEIGHT, title: 'Wall height in blocks' },
  hollow:     { ...HEIGHT, title: 'Room height in blocks' },
  cylinder:   { ...HEIGHT, title: 'Cylinder height in blocks' },
  grandstand: { prop: 'standRise',     icon: '\u25E4', label: (v) => (v === 1 ? 'Steep' : v === 2 ? 'V.Steep' : 'Shallow'), title: 'Rake: how fast the rows climb', cycle: (v) => (v === 1 ? 2 : v === 2 ? 0.5 : 1) },
  bowl:       { prop: 'bowlRows',      icon: '\u25EF', label: (v) => `${v} rows`, title: 'How deep each tier of the bowl is', cycle: (v) => (v >= 30 ? 6 : v + 6) },
  canopy:     { prop: 'canopyClear',   icon: '\u2312', label: (v) => `${v * 2}m`,  title: 'Headroom left under the deck', cycle: (v) => (v >= 12 ? 2 : v + 2) },
  pitched:    { prop: 'roofPitch',     icon: '\u25B3', label: (v) => (v === 1 ? '45\u00B0' : v === 2 ? 'Steep' : 'Shallow'), title: 'Roof pitch', cycle: (v) => (v === 1 ? 2 : v === 2 ? 0.5 : 1) },
  dome:       { prop: 'domePitch',     icon: '\u25D3', label: (v) => (v === 1 ? 'Round' : v > 1 ? 'Tall' : 'Shallow'), title: 'How far the dome rises', cycle: (v) => (v === 1 ? 1.5 : v > 1 ? 0.6 : 1) },
  garage:     { prop: 'garageLevels',  icon: '\u26DB', label: (v) => `${v} lvl`,  title: 'Number of parking decks', cycle: (v) => (v >= 6 ? 1 : v + 1) },
  raise:      { ...DEPTH },
  lower:      { ...DEPTH },
};

/**
 * The build dock: mode tabs, tool row, material/zone palette and a live
 * readout of what the pending action will cost.
 *
 * Everything here is a >=44px touch target and scrolls horizontally rather
 * than wrapping, so it works at 360px wide without hiding controls.
 */
export class BuildDock {
  constructor(game, controller) {
    this.onPick = null;      // (key) => put this in the active hotbar slot
    this.game = game;
    this.bc = controller;
    this.category = 'structure';
    this.zoneGroup = 'sport';
    this.node = el('div.builddock');
    this.buildStatic();
    this.render();
  }

  buildStatic() {
    this.modebar = el('div.modebar', { role: 'tablist', 'aria-label': 'Build mode' });
    this.toolrow = el('div.toolrow', { role: 'toolbar', 'aria-label': 'Build tools' });
    this.hint = el('div.dockhint');
    this.info = el('div.dockinfo');
    this.node.append(this.modebar, this.toolrow, this.info, this.hint);
  }

  render() {
    this.renderModes();
    this.renderTools();
    this.renderHint();
    this.renderInfo();
  }

  renderModes() {
    clear(this.modebar);
    for (const m of BUILD_MODES) {
      this.modebar.append(el(`button.mode.${m.key}` + (this.bc.mode === m.key ? '.on' : ''), {
        role: 'tab', 'aria-selected': String(this.bc.mode === m.key), title: m.hint,
        onclick: () => { this.bc.setMode(m.key); this.render(); },
      }, m.name));
    }
    // Planning mode toggle lives with the modes because it changes what a tap means.
    const planning = !!this.bc.planning;
    this.modebar.append(el('button.mode' + (planning ? '.on' : ''), {
      title: 'Design without spending, then commit or cancel',
      style: planning ? { background: 'var(--gold)', borderColor: 'var(--gold)', color: '#2a1c00' } : {},
      onclick: () => this.togglePlanning(),
    }, planning ? 'Planning ●' : 'Planning'));
  }

  togglePlanning() {
    if (this.bc.planning) { this.onPlanAction?.(); return; }
    this.bc.startPlanning();
    this.render();
  }

  renderTools() {
    clear(this.toolrow);
    const set = TOOL_SETS[this.bc.mode] || TOOL_SETS.build;
    for (const key of set) {
      const t = TOOLS.find((x) => x.key === key);
      if (!t) continue;
      const disabled = key === 'paste' && !this.bc.clipboard;
      this.toolrow.append(el('button.tool' + (this.bc.tool === key ? '.on' : ''), {
        title: t.hint, 'aria-label': t.name, 'aria-pressed': String(this.bc.tool === key), disabled,
        onclick: () => { this.bc.setTool(key); this.render(); },
      }, el('span.i', { text: t.icon }), el('span.n', { text: t.name })));
    }

    // One contextual parameter button, driven by the table above, so a tool
    // that takes a number gets its control without a settings panel and a
    // tool that does not is not asked about wall height.
    const param = TOOL_PARAMS[this.bc.tool];
    if (param) {
      const v = this.bc[param.prop];
      this.toolrow.append(el('button.tool', {
        title: `${param.title} (tap to cycle)`,
        'aria-label': `${param.title}: ${param.label(v)}`,
        onclick: () => {
          this.bc[param.prop] = param.cycle(v);
          this.bc.refreshPreview(); this.render();
        },
      }, el('span.i', { text: param.icon }), el('span.n', { text: param.label(v) })));
    }

    if (this.bc.holdingProp || this.bc.holdingPrefab
        || (this.bc.mode === 'blueprint' && this.bc.tool === 'paste' && this.bc.clipboard)) {
      this.toolrow.append(el('button.tool.rotate-btn', {
        title: 'Rotate 90 degrees (R)', 'aria-label': 'Rotate 90 degrees',
        onclick: () => { this.onRotate?.(); this.render(); },
      }, el('span.i', { text: '\u21BB' }), el('span.n', { text: FACING[this.bc.rotation & 3] })));
    }

    if (['build', 'zone'].includes(this.bc.mode)) {
      this.toolrow.append(el('button.tool.palette-btn', {
        title: 'Choose what goes in the selected hotbar slot',
        'aria-label': 'Open the palette',
        onclick: () => this.onOpenPalette?.(),
      }, el('span.i', { text: '\u229E' }), el('span.n', { text: 'Palette' })));
    }

    if (this.bc.mode === 'build') {
      this.toolrow.append(el('button.tool', {
        title: 'Place a whole prefabricated facility',
        'aria-label': 'Open the structure library',
        onclick: () => this.onOpenBlueprints?.(),
      }, el('span.i', { text: '\u25A3' }), el('span.n', { text: 'Prefabs' })));
    }

    if (this.bc.mode === 'blueprint') {
      this.toolrow.append(el('button.tool', {
        title: 'Save the copied structure as a blueprint', disabled: !this.bc.clipboard,
        onclick: () => this.onSaveBlueprint?.(),
      }, el('span.i', { text: '⤓' }), el('span.n', { text: 'Save' })));
      this.toolrow.append(el('button.tool', {
        title: 'Open the prefab and blueprint library',
        'aria-label': 'Open the structure library',
        onclick: () => this.onOpenBlueprints?.(),
      }, el('span.i', { text: '☷' }), el('span.n', { text: 'Library' })));
    }
  }

  /**
   * A single line of guidance for the modes where what to do next is not
   * obvious. What you are *holding* lives in the hotbar, not here.
   */
  renderHint() {
    const text = {
      demolish: 'Tap a block to remove it, or use a tool to clear an area. Demolition refunds 30%.',
      inspect: 'Tap any block to see what the game thinks it is, and which venue it belongs to.',
      terrain: 'Raise and Lower move by the set amount; Flatten levels everything to the first point you tap; Ramp slopes between the two. The surface material is preserved.',
    }[this.bc.mode];

    if (this.bc.holdingProp) {
      const p = this.bc.previewSummary();
      fill(this.hint, el('span', { text: p?.blocked
        ? p.blocked
        : `${p?.prop?.name || 'Equipment'} \u2014 tap to place, \u21BB to turn it.` }));
      return;
    }

    if (this.bc.mode === 'blueprint') {
      if (this.bc.tool === 'prefab') {
        const def = PREFAB_BY_KEY.get(this.bc.prefabKey);
        fill(this.hint, el('span', { text: def
          ? `${def.name}: ${def.hint} Tap the ground to place it.`
          : 'Open the Library and choose a prefab.' }));
        return;
      }
      const c = this.bc.clipboard;
      fill(this.hint, el('span', { text: c
        ? `Clipboard: ${c.count} blocks, ${c.size.x}x${c.size.y}x${c.size.z}. Tap to stamp it.`
        : 'Pick Copy, then tap two opposite corners of a structure.' }));
      return;
    }
    if (text) fill(this.hint, el('span', { text }));
    else clear(this.hint);
  }

  renderInfo() {
    clear(this.info);
    const s = this.bc.previewSummary();
    const plan = this.bc.planning;

    if (plan) {
      this.info.append(
        el('span.gold', { text: '● PLANNING' }),
        el('span', { text: `${plan.count} blocks` }),
        el('span.cost', { text: fmtMoney(plan.cost) }),
        el('button.btn.sm.go', { onclick: () => this.onPlanAction?.('commit') }, 'Build it'),
        el('button.btn.sm', { onclick: () => this.onPlanAction?.('cancel') }, 'Discard'));
      return;
    }

    if (s && s.prop) {
      this.info.append(
        el('span', { text: `${s.prop.name} \u00B7 facing ${['north', 'east', 'south', 'west'][this.bc.rotation & 3]}` }),
        el('span', { class: 'cost' + (s.affordable ? '' : ' bad'), text: fmtMoney(s.cost) }));
      if (s.blocked) this.info.append(el('span.bad', { text: '\u2014 ' + s.blocked }));
      else if (!s.affordable) this.info.append(el('span.bad', { text: '\u2014 not enough cash' }));
      return;
    }

    const nothingToDo = s && ((this.bc.mode === 'build' && s.placed === 0)
      || (this.bc.mode === 'demolish' && s.removed === 0));
    if (!s || s.count === 0 || nothingToDo) {
      const t = TOOLS.find((x) => x.key === this.bc.tool);
      this.info.append(el('span', { text: t ? t.hint : 'Aim at the ground to build.' }));
      return;
    }

    if (s.awaitingSecondPoint) {
      this.info.append(el('span.bluetx', { text: '◎ Tap the second point' }));
      return;
    }

    const structure = this.bc.lastPlan;
    if (structure && structure.meta) {
      const m = structure.meta;
      const bits = [];
      if (m.capacity) bits.push(`${m.capacity.toLocaleString()} seats`);
      if (m.rows) bits.push(`${m.rows} rows`);
      if (m.vomitories) bits.push(`${m.vomitories} vomitories`);
      if (m.spaces) bits.push(`${m.spaces.toLocaleString()} spaces`);
      if (m.levels) bits.push(`${m.levels} levels`);
      if (m.raised) bits.push(`+${m.raised} blocks of fill`);
      if (m.lowered) bits.push(`-${m.lowered} blocks cut`);
      if (m.columns && !m.raised && !m.lowered) bits.push(`${m.columns.toLocaleString()} columns`);
      if (m.prefab) {
        bits.length = 0;
        bits.push(`${m.name} \u00B7 ${m.footprint.x}\u00D7${m.footprint.z} blocks`);
        if (m.propCount) bits.push(`${m.propCount} fittings`);
      }
      this.info.append(el('span', { text: bits.join(' \u00B7 ') || 'Ready' }));
      this.info.append(el('span', {
        class: 'cost' + (s.affordable ? '' : ' bad'),
        text: s.cost >= 0 ? fmtMoney(s.cost) : `refund ${fmtMoney(-s.cost)}`,
      }));
      if (!s.affordable) this.info.append(el('span.bad', { text: '\u2014 not enough cash' }));
      if (m.outside) this.info.append(el('span.bad', { text: `\u2014 ${m.outside} blocks fall off your land` }));
      else if (m.unevenBy >= 2) this.info.append(el('span.gold', { text: `\u2014 ground varies by ${m.unevenBy} blocks; flatten it first` }));
      return;
    }

    const n = (v) => `${v} block${v === 1 ? '' : 's'}`;
    const label = this.bc.mode === 'zone'
      ? `${n(s.count)} → ${zone(this.bc.zoneKey).name}`
      : this.bc.mode === 'demolish'
        ? `${n(s.removed)} to remove`
        : n(s.placed);

    this.info.append(el('span', { text: label }));
    if (this.bc.mode !== 'zone' && this.bc.mode !== 'inspect') {
      this.info.append(el('span', {
        class: 'cost' + (s.affordable ? '' : ' bad'),
        text: s.cost >= 0 ? fmtMoney(s.cost) : `refund ${fmtMoney(-s.cost)}`,
      }));
      if (!s.affordable) this.info.append(el('span.bad', { text: '— not enough cash' }));
    }
    if (this.bc.mode === 'build' && this.bc.tool !== 'single') {
      const dims = this.bc.lastCells ? dimsOf(this.bc.lastCells) : null;
      if (dims) this.info.append(el('span.faint', { text: `${dims.x}×${dims.y}×${dims.z} blocks (${dims.x * 2}m×${dims.z * 2}m)` }));
    }
  }
}

function dimsOf(cells) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < cells.length; i += 3) {
    if (cells[i] < minX) minX = cells[i]; if (cells[i] > maxX) maxX = cells[i];
    if (cells[i + 1] < minY) minY = cells[i + 1]; if (cells[i + 1] > maxY) maxY = cells[i + 1];
    if (cells[i + 2] < minZ) minZ = cells[i + 2]; if (cells[i + 2] > maxZ) maxZ = cells[i + 2];
  }
  return { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 };
}

export { TOOL_SETS };
