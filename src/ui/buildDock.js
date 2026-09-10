import { el, fill, clear } from './dom.js';
import { BLOCK_CATEGORIES, BLOCK_BY_ID, block } from '../data/blocks.js';
import { ZONE_GROUPS, ZONE_BY_ID, zone } from '../data/zones.js';
import { TOOLS } from '../voxel/buildTools.js';
import { BUILD_MODES } from '../voxel/buildController.js';
import { fmtMoney } from '../core/economy.js';

const TOOL_SETS = {
  build: ['single', 'line', 'wall', 'floor', 'box', 'hollow', 'fill', 'replace'],
  zone: ['single', 'floor', 'box', 'line'],
  demolish: ['single', 'box', 'floor', 'wall', 'line'],
  inspect: ['single'],
  blueprint: ['copy', 'paste'],
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
    this.catrow = el('div.catrow');
    this.hotbar = el('div.hotbar', { role: 'listbox', 'aria-label': 'Materials' });
    this.info = el('div.dockinfo');
    this.node.append(this.modebar, this.toolrow, this.info, this.catrow, this.hotbar);
  }

  render() {
    this.renderModes();
    this.renderTools();
    this.renderPalette();
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

    if (this.bc.mode === 'build' || this.bc.mode === 'demolish') {
      const h = this.bc.wallHeight;
      this.toolrow.append(el('button.tool', {
        title: 'Wall / room height in blocks (tap to cycle)',
        'aria-label': `Wall height ${h} blocks`,
        onclick: () => {
          this.bc.wallHeight = h >= 12 ? 1 : h + (h >= 6 ? 3 : 1);
          this.bc.refreshPreview(); this.render();
        },
      }, el('span.i', { text: '↕' }), el('span.n', { text: `H ${h}` })));
    }

    if (this.bc.mode === 'blueprint') {
      this.toolrow.append(el('button.tool', {
        title: 'Rotate the copied structure 90 degrees', disabled: !this.bc.clipboard,
        onclick: () => { this.bc.rotateClipboard(); this.render(); },
      }, el('span.i', { text: '↻' }), el('span.n', { text: 'Rotate' })));
      this.toolrow.append(el('button.tool', {
        title: 'Save the copied structure as a blueprint', disabled: !this.bc.clipboard,
        onclick: () => this.onSaveBlueprint?.(),
      }, el('span.i', { text: '⤓' }), el('span.n', { text: 'Save' })));
      this.toolrow.append(el('button.tool', {
        title: 'Open saved blueprints',
        onclick: () => this.onOpenBlueprints?.(),
      }, el('span.i', { text: '☷' }), el('span.n', { text: 'Library' })));
    }
  }

  renderPalette() {
    clear(this.catrow); clear(this.hotbar);

    if (this.bc.mode === 'zone') {
      for (const g of ZONE_GROUPS) {
        this.catrow.append(el('button.cat' + (this.zoneGroup === g.key ? '.on' : ''), {
          onclick: () => { this.zoneGroup = g.key; this.renderPalette(); },
        }, g.name));
      }
      for (const z of ZONE_BY_ID) {
        if (z.group !== this.zoneGroup) continue;
        this.hotbar.append(this.zoneSwatch(z));
      }
      return;
    }

    if (this.bc.mode === 'demolish') {
      this.hotbar.append(el('div.small.faint', {
        style: { padding: '8px 4px' },
        text: 'Tap a block to remove it, or use a tool to clear an area. Demolition refunds 30%.',
      }));
      return;
    }

    if (this.bc.mode === 'inspect') {
      this.hotbar.append(el('div.small.faint', {
        style: { padding: '8px 4px' },
        text: 'Tap any block to see what the game thinks it is, and which venue it belongs to.',
      }));
      return;
    }

    if (this.bc.mode === 'blueprint') {
      const c = this.bc.clipboard;
      this.hotbar.append(el('div.small.faint', {
        style: { padding: '8px 4px' },
        text: c
          ? `Clipboard: ${c.count} blocks, ${c.size.x}x${c.size.y}x${c.size.z}. Tap to stamp it.`
          : 'Pick Copy, then tap two opposite corners of a structure.',
      }));
      return;
    }

    for (const c of BLOCK_CATEGORIES) {
      this.catrow.append(el('button.cat' + (this.category === c.key ? '.on' : ''), {
        onclick: () => { this.category = c.key; this.renderPalette(); },
      }, c.name));
    }
    for (const b of BLOCK_BY_ID) {
      if (b.category !== this.category) continue;
      this.hotbar.append(this.blockSwatch(b));
    }
  }

  blockSwatch(b) {
    const locked = b.unlock && !this.game.isUnlocked(b.unlock);
    const on = this.bc.material === b.id && !locked;
    return el('button.swatch' + (on ? '.on' : '') + (locked ? '.locked' : ''), {
      role: 'option', 'aria-selected': String(on),
      'aria-label': `${b.name}, ${locked ? 'locked' : '$' + b.cost + ' per block'}`,
      title: locked ? `${b.name} - unlock with research` : `${b.name} - $${b.cost}/block`,
      onclick: () => {
        if (locked) { this.onLocked?.(b); return; }
        this.bc.setMaterial(b.id); this.renderPalette(); this.renderInfo();
      },
    },
      el('span.chipc', { style: { background: '#' + b.color.toString(16).padStart(6, '0') } }),
      el('span.n', { text: b.name }),
      el('span.c', { text: locked ? '\u{1F512}' : '$' + b.cost }));
  }

  zoneSwatch(z) {
    const on = this.bc.zoneKey === z.key;
    return el('button.swatch' + (on ? '.on' : ''), {
      role: 'option', 'aria-selected': String(on), 'aria-label': z.name,
      title: z.regulation
        ? `${z.name} - needs at least ${z.regulation.w}x${z.regulation.d} blocks`
        : z.name,
      onclick: () => { this.bc.setZone(z.key); this.renderPalette(); this.renderInfo(); },
    },
      el('span.chipc', { style: { background: '#' + z.color.toString(16).padStart(6, '0') } }),
      el('span.n', { text: z.name }),
      el('span.c', { text: z.capacity ? `${z.capacity}/blk` : (z.regulation ? `${z.regulation.w}x${z.regulation.d}` : '—') }));
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
