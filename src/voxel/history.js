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
    // Props are objects, not voxels, so they ride along as an ordered op log
    // rather than a before/after pair per cell.
    this.props = [];
    this.cost = 0;
    this.refund = 0;
  }
  get size() { return this.pos.length + this.props.length; }
  get voxelCount() { return this.pos.length; }
  record(x, y, z, pb, pz, nb, nz) {
    this.pos.push(packPos(x, y, z));
    this.prevB.push(pb); this.prevZ.push(pz);
    this.newB.push(nb); this.newZ.push(nz);
  }
  /** @param op 'add' | 'del' */
  recordProp(op, typeId, x, y, z, rot) {
    this.props.push({ op, typeId, x, y, z, rot: rot || 0 });
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
    // Props first: putting a block back should not fight equipment that was
    // knocked down with it.
    const layer = this.world.props;
    if (layer) {
      for (let i = b.props.length - 1; i >= 0; i--) {
        const op = b.props[i];
        if (op.op === 'add') layer.remove(op.x, op.y, op.z, op.rot);
        else layer.add(op.typeId, op.x, op.y, op.z, op.rot);
      }
    }
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
    const layer = this.world.props;
    if (layer) {
      for (const op of b.props) {
        if (op.op === 'add') layer.add(op.typeId, op.x, op.y, op.z, op.rot);
        else layer.remove(op.x, op.y, op.z, op.rot);
      }
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
