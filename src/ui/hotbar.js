import { el, fill, clear } from './dom.js';
import { block, blockId, BLOCK_BY_KEY } from '../data/blocks.js';
import { zone, zoneId, ZONE_BY_KEY } from '../data/zones.js';
import { PROP_BY_KEY } from '../data/props.js';

/** Slots holding sports equipment are marked so a block key can never clash. */
export const PROP_PREFIX = '@';
export const isPropSlot = (key) => typeof key === 'string' && key.startsWith(PROP_PREFIX);
export const propSlotKey = (key) => PROP_PREFIX + key;

/**
 * A proper hotbar: nine slots you own, not a menu you scroll.
 *
 * Number keys select, the scroll wheel cycles, and the block you are holding
 * is named briefly above the bar as it changes. Long-press (or right-click) a
 * slot to reassign it from the full palette. There is one set of slots for
 * materials and another for zones, because painting what an area is for is
 * the same motion as building it.
 */
export const SLOTS = 9;

export const DEFAULT_BLOCK_SLOTS = [
  'concrete', 'turf', 'seat', 'tile', 'steel', 'asphalt', 'road', 'floodlight', '@goal_soccer',
];
export const DEFAULT_ZONE_SLOTS = [
  'pitch_football', 'seating', 'entrance', 'exit', 'restroom',
  'concession', 'locker', 'concourse', 'parking',
];

export class Hotbar {
  constructor(game, controller) {
    this.game = game;
    this.bc = controller;
    this.onAssign = null;      // (slotIndex) => open the palette
    this.node = el('div.hotbar-bar', { role: 'toolbar', 'aria-label': 'Hotbar' });
    this.label = el('div.hotbar-label', { 'aria-live': 'polite' });
    this.wrap = el('div.hotbar-wrap', {}, this.label, this.node);
    this.labelTimer = null;
    this.render();
  }

  get state() { return this.game.state.hotbar; }
  get zoneMode() { return this.bc.mode === 'zone'; }
  get slots() { return this.zoneMode ? this.state.zones : this.state.blocks; }

  /** The thing in a slot, resolved to a block or zone record. */
  entry(i) {
    const key = this.slots[i];
    if (!key) return null;
    if (this.zoneMode) return ZONE_BY_KEY.get(key) || null;
    if (isPropSlot(key)) return PROP_BY_KEY.get(key.slice(1)) || null;
    return BLOCK_BY_KEY.get(key) || null;
  }

  select(i, announce = true) {
    if (i < 0 || i >= SLOTS) return;
    this.state.active = i;
    const e = this.entry(i);
    if (e) {
      if (this.zoneMode) this.bc.setZone(e.key);
      else if (e.isProp) this.bc.setProp(e.key);
      else this.bc.setMaterial(e.id);
    }
    if (announce) this.announce(e);
    this.render();
  }

  cycle(dir) {
    this.select((this.state.active + dir + SLOTS) % SLOTS);
  }

  /** Put something in the active slot (used by the palette and by pick-block). */
  assign(key, slot = this.state.active) {
    if (!key) return;
    this.slots[slot] = key;
    this.state.active = slot;
    this.select(slot);
  }

  /** Eyedropper: hold what you are looking at. */
  pick(key) {
    if (!key) return false;
    const existing = this.slots.indexOf(key);
    if (existing >= 0) { this.select(existing); return true; }
    this.assign(key);
    return true;
  }

  announce(entry) {
    this.label.textContent = entry
      ? (this.zoneMode ? entry.name
        : `${entry.name} \u00B7 $${entry.cost.toLocaleString()}${entry.isProp ? ' \u00B7 rotatable' : ''}`)
      : 'Empty slot';
    this.label.classList.add('show');
    clearTimeout(this.labelTimer);
    this.labelTimer = setTimeout(() => this.label.classList.remove('show'), 1600);
  }

  /** Keep the hotbar in step when the palette changes the selection directly. */
  syncFromController() {
    const key = this.zoneMode ? this.bc.zoneKey
      : this.bc.propKey ? propSlotKey(this.bc.propKey)
      : block(this.bc.material).key;
    const i = this.slots.indexOf(key);
    if (i >= 0 && i !== this.state.active) this.state.active = i;
    else if (i < 0) this.slots[this.state.active] = key;
    this.render();
  }

  render() {
    clear(this.node);
    for (let i = 0; i < SLOTS; i++) {
      const e = this.entry(i);
      const on = i === this.state.active;
      const locked = e && !this.zoneMode && e.unlock && !this.game.isUnlocked(e.unlock);
      const btn = el('button.slot' + (on ? '.on' : '') + (locked ? '.locked' : '') + (e?.isProp ? '.prop' : ''), {
        'aria-label': e ? `Slot ${i + 1}: ${e.name}${e.isProp ? ' (equipment)' : ''}${locked ? ' (locked)' : ''}` : `Slot ${i + 1}: empty`,
        'aria-pressed': String(on),
        title: e ? `${e.name} — tap to hold, long-press to change` : 'Empty — tap to choose',
        onclick: () => {
          if (!e) { this.onAssign?.(i); return; }
          if (locked) { this.onLocked?.(e); return; }
          this.select(i);
        },
        oncontextmenu: (ev) => { ev.preventDefault(); this.onAssign?.(i); },
      },
        el('span.n', { text: String(i + 1) }),
        e
          ? el('span.sw', { style: { background: '#' + e.color.toString(16).padStart(6, '0') } },
              locked ? el('span.lk', { text: '\u{1F512}' }) : e.isProp ? el('span.pk', { text: '\u25E9' }) : null)
          : el('span.sw.empty', { text: '+' }));

      // Long-press to reassign, on touch.
      let timer = null;
      btn.addEventListener('pointerdown', () => {
        timer = setTimeout(() => { timer = null; this.onAssign?.(i); }, 480);
      });
      const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
      btn.addEventListener('pointerup', cancel);
      btn.addEventListener('pointercancel', cancel);
      btn.addEventListener('pointerleave', cancel);

      this.node.append(btn);
    }
  }
}

/** Fresh hotbar state for a new game. */
export function createHotbarState() {
  return {
    blocks: DEFAULT_BLOCK_SLOTS.slice(),
    zones: DEFAULT_ZONE_SLOTS.slice(),
    active: 0,
  };
}
