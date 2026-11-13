// Seeded PRNG (mulberry32). Every random number the tool uses comes from one
// of these, so a run is reproducible from its seed.

export function normaliseSeed(seed) {
  const n = Number(seed);
  if (!Number.isFinite(n)) {
    throw new Error(`Seed must be a number, got "${seed}".`);
  }
  return Math.trunc(Math.abs(n)) >>> 0;
}

export function createRng(seed) {
  let a = normaliseSeed(seed);
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A second, independent stream derived from the same seed (e.g. for the self-test). */
export function deriveRng(seed, stream) {
  return createRng((normaliseSeed(seed) ^ Math.imul(stream + 1, 0x9e3779b1)) >>> 0);
}
