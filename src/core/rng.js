/**
 * Small deterministic PRNG (mulberry32). The simulation stays reproducible for
 * a given save + day, so a reload cannot be used to reroll a bid result.
 */
export function makeRng(seed) {
  let a = seed >>> 0;
  const fn = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.range = (lo, hi) => lo + fn() * (hi - lo);
  fn.int = (lo, hi) => Math.floor(fn.range(lo, hi + 1));
  fn.pick = (arr) => arr[Math.floor(fn() * arr.length)];
  fn.chance = (p) => fn() < p;
  /** Normal-ish variation clustered near 1. */
  fn.jitter = (spread) => 1 + (fn() + fn() + fn() - 1.5) * (spread / 1.5);
  fn.shuffle = (arr) => {
    const a2 = arr.slice();
    for (let i = a2.length - 1; i > 0; i--) {
      const j = Math.floor(fn() * (i + 1));
      [a2[i], a2[j]] = [a2[j], a2[i]];
    }
    return a2;
  };
  return fn;
}

/** Stable 32-bit hash of a string, for deriving per-entity seeds. */
export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
