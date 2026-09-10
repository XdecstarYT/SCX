/** Minimal pub/sub. Keeps the simulation free of any DOM knowledge. */
export class EventBus {
  constructor() { this.map = new Map(); }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) { this.map.get(type)?.delete(fn); }
  emit(type, payload) {
    const s = this.map.get(type);
    if (s) for (const fn of [...s]) fn(payload);
    const all = this.map.get('*');
    if (all) for (const fn of [...all]) fn({ type, payload });
  }
}
