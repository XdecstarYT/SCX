/**
 * Unified pointer/keyboard input.
 *
 * Touch and mouse are folded into the same gesture vocabulary so the build
 * controller never needs to know which one it is talking to:
 *
 *   tap          place / select (button 0) or remove / cancel (button 2)
 *   longPress    contextual inspect
 *   orbit        one-finger drag, or left-drag on desktop
 *   pan          two-finger drag, or right-drag on desktop
 *   zoom         pinch, or wheel
 *   look         pointer-locked mouse movement in first person
 */
const TAP_SLOP = 11;       // px of movement still counted as a tap
const TAP_TIME = 320;      // ms
const LONG_PRESS = 480;    // ms

export class InputController {
  constructor(canvas, rig, handlers = {}) {
    this.canvas = canvas;
    this.rig = rig;
    this.h = handlers;
    this.pointers = new Map();
    this.keys = new Set();
    this.move = { x: 0, y: 0 };
    this.joystick = { x: 0, y: 0, active: false };
    this.run = false;
    this.enabled = true;
    this.pointerLocked = false;
    this.lastPinch = 0;
    this.lastMid = null;
    // While a build button is held we repeat the action, so you can sweep out
    // a wall rather than tapping forty times. The repeat only starts after a
    // deliberate hold - a tap must place exactly once.
    this.heldAction = null;
    this.holdStart = 0;
    this.longTimer = null;
    this.suppressTap = false;
    this.bind();
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown, { passive: false });
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('blur', () => { this.keys.clear(); this.updateMove(); });
  }

  destroy() {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }

  ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: -((e.clientY - r.top) / r.height) * 2 + 1,
    };
  }

  // ------------------------------------------------------------- pointers
  onDown = (e) => {
    if (!this.enabled) return;
    if (this.pointerLocked) {
      // In pointer lock the mouse is already captured; clicks are actions, and
      // holding repeats them.
      e.preventDefault();
      if (e.button === 1) { this.h.onPick?.(); return; }
      this.beginHold(e.button);
      this.h.onTap?.({ x: 0, y: 0 }, e.button, true);
      return;
    }
    if (e.button === 1) { e.preventDefault(); this.h.onPick?.(); return; }
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, {
      startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
      time: performance.now(), button: e.button, moved: 0, type: e.pointerType,
    });
    this.suppressTap = false;

    if (this.pointers.size === 2) {
      clearTimeout(this.longTimer);
      const [a, b] = [...this.pointers.values()];
      this.lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
      this.lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.suppressTap = true;
    } else if (this.pointers.size === 1) {
      const p = this.ndc(e);
      this.longTimer = setTimeout(() => {
        const pt = this.pointers.get(e.pointerId);
        if (pt && pt.moved < TAP_SLOP) {
          this.suppressTap = true;
          this.h.onLongPress?.(p);
        }
      }, LONG_PRESS);
    }
    e.preventDefault();
  };

  onMove = (e) => {
    if (this.pointerLocked) {
      const s = 0.85;
      this.rig.orbit(-e.movementX * s, -e.movementY * s);
      this.h.onAim?.();
      return;
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (this.pointers.size === 0) this.h.onHover?.(this.ndc(e));
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    p.moved += Math.abs(dx) + Math.abs(dy);
    if (p.moved > TAP_SLOP) clearTimeout(this.longTimer);

    if (this.pointers.size === 1) {
      if (p.moved <= TAP_SLOP) return;
      if (p.type === 'mouse' && p.button === 2) this.rig.pan(dx, dy);
      else this.rig.orbit(dx, dy);
      this.h.onAim?.();
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.lastPinch > 0 && Math.abs(d - this.lastPinch) > 1) {
        this.rig.zoom(this.lastPinch / d);
      }
      if (this.lastMid) this.rig.pan(mid.x - this.lastMid.x, mid.y - this.lastMid.y);
      this.lastPinch = d;
      this.lastMid = mid;
      this.h.onAim?.();
    }
    e.preventDefault();
  };

  onUp = (e) => {
    this.heldAction = null;
    const p = this.pointers.get(e.pointerId);
    clearTimeout(this.longTimer);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) { this.lastPinch = 0; this.lastMid = null; }

    const dt = performance.now() - p.time;
    const isTap = p.moved <= TAP_SLOP && dt < TAP_TIME * 2.6 && !this.suppressTap;
    if (isTap) {
      const r = this.canvas.getBoundingClientRect();
      this.h.onTap?.({
        x: ((e.clientX - r.left) / r.width) * 2 - 1,
        y: -((e.clientY - r.top) / r.height) * 2 + 1,
      }, p.button, false);
    }
    if (this.pointers.size === 0) this.suppressTap = false;
  };

  onWheel = (e) => {
    if (!this.enabled) return;
    e.preventDefault();
    // Walking around, the wheel cycles the hotbar. Surveying from the free
    // camera, it zooms.
    if (this.rig.isWalking || this.pointerLocked) {
      this.h.onCycleHotbar?.(e.deltaY > 0 ? 1 : -1);
      return;
    }
    this.rig.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
    this.h.onAim?.();
  };

  // ------------------------------------------------------------- keyboard
  onKeyDown = (e) => {
    if (isTextInput(e.target)) return;
    const k = e.key.toLowerCase();
    this.keys.add(k);
    this.run = e.shiftKey;

    if (k >= '1' && k <= '9') { this.h.onHotbar?.(+k - 1); e.preventDefault(); return; }
    if (k === '0') { this.h.onHotbar?.(9); return; }
    if (k === ' ') { this.rig.jump(); e.preventDefault(); }
    if (k === 'f' && !e.ctrlKey && !e.metaKey) this.rig.toggleFly();
    if (k === 'b') this.h.onToggleFirstPerson?.();
    if (k === 'z' && !e.ctrlKey && !e.metaKey) this.h.onPick?.();
    if (k === 'c') this.h.onCycleCamera?.();
    if (k === 'q') this.h.onRotate?.(-1);
    if (k === 'e') this.h.onRotate?.(1);
    if (k === 'r') this.h.onRotate?.(1);
    if (k === 'escape') { this.h.onEscape?.(); this.exitLock(); }
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? this.h.onRedo?.() : this.h.onUndo?.(); }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); this.h.onRedo?.(); }
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); this.h.onSave?.(); }
    this.updateMove();
  };

  onKeyUp = (e) => {
    this.keys.delete(e.key.toLowerCase());
    this.run = e.shiftKey;
    this.updateMove();
  };

  updateMove() {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (k.has('w') || k.has('arrowup')) y += 1;
    if (k.has('s') || k.has('arrowdown')) y -= 1;
    this.move.x = x; this.move.y = y;
  }

  /** Start a hold. The caller fires the first action itself. */
  beginHold(button) {
    this.heldAction = button;
    this.holdStart = performance.now();
  }

  /** True while a build action button is held down. */
  get isHolding() { return this.heldAction !== null; }
  get heldButton() { return this.heldAction; }
  /** Seconds the current hold has lasted, 0 when nothing is held. */
  get holdSeconds() {
    return this.heldAction === null ? 0 : (performance.now() - this.holdStart) / 1000;
  }
  releaseHold() { this.heldAction = null; }

  /** Combined keyboard + on-screen joystick, normalised. */
  get moveVector() {
    let x = this.move.x + this.joystick.x;
    let y = this.move.y + this.joystick.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  // ---------------------------------------------------------- pointer lock
  requestLock() {
    if (this.pointerLocked) return;
    this.canvas.requestPointerLock?.();
  }
  exitLock() {
    if (this.pointerLocked) document.exitPointerLock?.();
  }
  onLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    this.h.onLockChange?.(this.pointerLocked);
  };
}

function isTextInput(t) {
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/**
 * On-screen thumbstick. Reports a normalised vector; visual knob follows.
 */
export function bindJoystick(el, input) {
  const knob = el.querySelector('.knob');
  let id = null, cx = 0, cy = 0, r = 1;
  const set = (dx, dy) => {
    const len = Math.hypot(dx, dy);
    const cl = Math.min(len, r);
    const nx = len > 0 ? (dx / len) * cl : 0;
    const ny = len > 0 ? (dy / len) * cl : 0;
    knob.style.transform = `translate(${nx}px, ${ny}px)`;
    input.joystick.x = nx / r;
    input.joystick.y = -ny / r;
    input.joystick.active = true;
  };
  const reset = () => {
    id = null;
    knob.style.transform = '';
    input.joystick.x = 0; input.joystick.y = 0; input.joystick.active = false;
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const rect = el.getBoundingClientRect();
    cx = rect.left + rect.width / 2; cy = rect.top + rect.height / 2;
    r = rect.width / 2 - 22;
    id = e.pointerId;
    el.setPointerCapture(e.pointerId);
    set(e.clientX - cx, e.clientY - cy);
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    e.preventDefault(); e.stopPropagation();
    set(e.clientX - cx, e.clientY - cy);
  });
  const end = (e) => { if (e.pointerId === id) { e.stopPropagation(); reset(); } };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  return reset;
}
