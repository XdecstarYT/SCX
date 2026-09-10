import { MAX_UNDO } from '../core/constants.js';

const packPos = (x, y, z) => (y << 18) | (z << 9) | x;
const unpackX = (p) => p & 511;
const unpackZ = (p) => (p >> 9) & 511;
const unpackY = (p) => (p >> 18) & 127;

/**
 * A reversible batch of voxel edits. Positions are bit-packed and the
 * before/after state is kept in parallel typed-array-friendly lists, so a
 * 20,000-voxel fill costs ~100KB rather than 20,000 objects.
 */
export class EditBatch {
  constructor(label = 'Edit') {
    this.label = label;
    this.pos = [];
    this.prevB = [];
    this.prevZ = [];
    this.newB = [];
    this.newZ = [];
    this.cost = 0;
    this.refund = 0;
  }
  get size() { return this.pos.length; }
  record(x, y, z, pb, pz, nb, nz) {
    this.pos.push(packPos(x, y, z));
    this.prevB.push(pb); this.prevZ.push(pz);
    this.newB.push(nb); this.newZ.push(nz);
  }
}

export class History {
  constructor(world) {
    this.world = world;
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = null;
  }

  push(batch) {
    if (batch.size === 0) return;
    this.undoStack.push(batch);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange?.();
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    const b = this.undoStack.pop();
    if (!b) return null;
    for (let i = b.pos.length - 1; i >= 0; i--) {
      const p = b.pos[i];
      this.world.setBlock(unpackX(p), unpackY(p), unpackZ(p), b.prevB[i], b.prevZ[i]);
    }
    this.redoStack.push(b);
    this.onChange?.();
    return b;
  }

  redo() {
    const b = this.redoStack.pop();
    if (!b) return null;
    for (let i = 0; i < b.pos.length; i++) {
      const p = b.pos[i];
      this.world.setBlock(unpackX(p), unpackY(p), unpackZ(p), b.newB[i], b.newZ[i]);
    }
    this.undoStack.push(b);
    this.onChange?.();
    return b;
  }

  /** Roll back to a marker returned by mark(). Used to cancel Planning Mode. */
  mark() { return this.undoStack.length; }
  rollbackTo(marker) {
    let total = 0;
    while (this.undoStack.length > marker) {
      const b = this.undo();
      if (!b) break;
      total += b.cost;
    }
    this.redoStack.length = 0;
    this.onChange?.();
    return total;
  }
  /** Drop the redo history and everything below a marker (commit). */
  clearRedo() { this.redoStack.length = 0; this.onChange?.(); }

  clear() { this.undoStack.length = 0; this.redoStack.length = 0; this.onChange?.(); }
}

export { packPos, unpackX, unpackY, unpackZ };
