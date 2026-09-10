import { makeSave, migrate, deserializeWorld, deserializeWorlds } from './serialization.js';

const DB_NAME = 'sct3d';
const STORE = 'saves';
const LS_KEY = 'sct3d:save:';
const SLOT_INDEX = 'sct3d:slots';

/**
 * Persistence. IndexedDB is the primary store (saves can be a few MB once a
 * player has built a stadium); localStorage is the fallback so the game still
 * works in private windows and locked-down webviews.
 */
class SaveManager {
  constructor() {
    this.dbPromise = null;
    this.mode = 'unknown';
  }

  openDb() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no idb'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => { this.mode = 'indexeddb'; resolve(req.result); };
      req.onerror = () => reject(req.error || new Error('idb open failed'));
    }).catch((e) => { this.mode = 'localstorage'; throw e; });
    return this.dbPromise;
  }

  async idb(mode, fn) {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const req = fn(store);
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  }

  async write(slot, data) {
    try {
      await this.idb('readwrite', (s) => s.put(data, slot));
    } catch {
      this.mode = 'localstorage';
      localStorage.setItem(LS_KEY + slot, JSON.stringify(data));
    }
    this.touchIndex(slot, data.meta);
  }

  async read(slot) {
    try {
      const v = await this.idb('readonly', (s) => s.get(slot));
      if (v) return v;
    } catch { /* fall through */ }
    const raw = localStorage.getItem(LS_KEY + slot);
    return raw ? JSON.parse(raw) : null;
  }

  async remove(slot) {
    try { await this.idb('readwrite', (s) => s.delete(slot)); } catch { /* ignore */ }
    localStorage.removeItem(LS_KEY + slot);
    const idx = this.index();
    delete idx[slot];
    localStorage.setItem(SLOT_INDEX, JSON.stringify(idx));
  }

  index() {
    try { return JSON.parse(localStorage.getItem(SLOT_INDEX) || '{}'); } catch { return {}; }
  }

  touchIndex(slot, meta) {
    const idx = this.index();
    idx[slot] = { ...meta, savedAt: Date.now() };
    try { localStorage.setItem(SLOT_INDEX, JSON.stringify(idx)); } catch { /* quota */ }
  }

  // ------------------------------------------------------------- public API
  async save(game, slot = 'auto') {
    const data = makeSave(game.state, game.worlds, { slot });
    await this.write(slot, data);
    return data.meta;
  }

  async load(slot = 'auto') {
    const raw = await this.read(slot);
    if (!raw) return null;
    const save = migrate(raw);
    return { state: save.state, worlds: deserializeWorlds(save), meta: save.meta };
  }

  async hasSave(slot = 'auto') {
    return !!(await this.read(slot));
  }

  listSlots() {
    return Object.entries(this.index())
      .map(([slot, meta]) => ({ slot, ...meta }))
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  // ---------------------------------------------------------- export/import
  exportBlob(game) {
    const data = makeSave(game.state, game.worlds, { exported: true });
    return new Blob([JSON.stringify(data)], { type: 'application/json' });
  }

  exportFilename(game) {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const name = (game.state.complexName || 'complex').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    return `sct3d-${name}-day${game.state.day}-${stamp}.json`;
  }

  async importText(text) {
    const parsed = JSON.parse(text);
    const save = migrate(parsed);
    return { state: save.state, worlds: deserializeWorlds(save), meta: save.meta };
  }
}

export const saveManager = new SaveManager();
export { makeSave, migrate };
