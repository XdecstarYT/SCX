import { VoxelWorld, Chunk } from '../voxel/world.js';
import { SAVE_VERSION } from '../core/gameState.js';

/**
 * Chunks are stored run-length encoded, not as raw geometry. A 16x64x16 chunk
 * of mostly-air is a few dozen bytes; a fully built one still compresses hard
 * because voxel worlds are enormously repetitive.
 *
 * Wire format per run: [value, countLow, countHigh] -> base64.
 */
export function rleEncode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v && n < 65535) n++;
    out.push(v, n & 255, (n >> 8) & 255);
    i += n;
  }
  return bytesToB64(Uint8Array.from(out));
}

export function rleDecode(b64, length) {
  const bytes = b64ToBytes(b64);
  const out = new Uint8Array(length);
  let p = 0;
  for (let i = 0; i + 2 < bytes.length; i += 3) {
    const v = bytes[i];
    const n = bytes[i + 1] | (bytes[i + 2] << 8);
    if (v !== 0) out.fill(v, p, Math.min(length, p + n));
    p += n;
    if (p >= length) break;
  }
  return out;
}

function bytesToB64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Fields that are recomputed from the world and must never be persisted. */
const DERIVED_KEYS = [
  'derived', 'complex', 'staffBonus', 'sponsorPerEvent', 'sponsorBonuses',
  'buildCostMult', 'salaryMult', 'wearFactor', 'capacityPenalty', 'tempSeats',
  'sponsorLocked', 'transitShare', 'bestCapacityHint',
];

export function serializeState(state) {
  const out = {};
  for (const [k, v] of Object.entries(state)) {
    if (DERIVED_KEYS.includes(k)) continue;
    out[k] = v;
  }
  out.version = SAVE_VERSION;
  out.lastPlayed = Date.now();
  return out;
}

export function serializeWorld(world) {
  const chunks = [];
  world.forEachChunk((c) => {
    if (c.nonEmpty === 0) return;
    chunks.push({
      cx: c.cx, cz: c.cz,
      b: rleEncode(c.blocks),
      z: rleEncode(c.zones),
    });
  });
  return { size: world.size, chunks };
}

export function deserializeWorld(data) {
  const world = new VoxelWorld(data.size);
  const volume = 16 * 64 * 16;
  for (const rec of data.chunks) {
    const chunk = world.getChunk(rec.cx, rec.cz, true);
    chunk.blocks.set(rleDecode(rec.b, volume));
    chunk.zones.set(rleDecode(rec.z, volume));
    let n = 0, maxY = 0;
    for (let i = 0; i < volume; i++) {
      const id = chunk.blocks[i];
      if (id) {
        n++;
        world.blockCounts.set(id, (world.blockCounts.get(id) || 0) + 1);
        const y = Math.floor(i / (16 * 16));
        if (y > maxY) maxY = y;
      }
      const z = chunk.zones[i];
      if (z) world.zoneCounts.set(z, (world.zoneCounts.get(z) || 0) + 1);
    }
    chunk.nonEmpty = n;
    chunk.maxY = maxY;
    chunk.dirty = true;
    chunk.zoneDirty = true;
    world.dirtyChunks.add(chunk);
  }
  world.version++;
  return world;
}

export function makeSave(state, world, meta = {}) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    meta: {
      complexName: state.complexName,
      day: state.day,
      cash: Math.round(state.cash),
      reputation: Math.round(state.reputation.venue),
      capacity: state.derived?.bestCapacity || 0,
      ...meta,
    },
    state: serializeState(state),
    world: serializeWorld(world),
  };
}

/** Migrate older saves forward. Never throw on an old save. */
export function migrate(save) {
  if (!save || !save.state) throw new Error('Save file is not readable.');
  const s = save.state;
  s.settings = { sound: true, music: false, reducedMotion: false, highContrast: false,
    largeText: false, sensitivity: 1, invertY: false, showFps: false, autosave: true,
    handedness: 'right', ...(s.settings || {}) };
  s.modifiers = s.modifiers || [];
  s.venues = s.venues || { registered: [] };
  s.events = { board: [], scheduled: [], history: [], lastGeneratedDay: 0, ...(s.events || {}) };
  s.finance = { ledger: [], months: [], monthAccum: {}, lastMonth: 0, ...(s.finance || {}) };
  s.tutorial = { step: 0, dismissed: false, seen: {}, ...(s.tutorial || {}) };
  s.organiserHistory = s.organiserHistory || {};
  s.achievements = s.achievements || [];
  s.version = SAVE_VERSION;
  return save;
}
