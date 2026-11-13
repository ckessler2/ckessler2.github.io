// Input boxes. The attack runs in float32, but the box bounds are real
// numbers (doubles) from the spec. Rounding a bound to float32 can push it
// *outside* the box (fround(0.6) > 0.6), which would make a counterexample
// invalid. So bounds are rounded inwards: every float32 point the attack can
// reach lies inside the original box.

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function nextFloat32Up(x) {
  if (Number.isNaN(x) || x === Infinity) return x;
  if (x === 0) return 1.401298464324817e-45;
  f32[0] = x;
  if (x > 0) u32[0] += 1;
  else u32[0] -= 1;
  return f32[0];
}

export function nextFloat32Down(x) {
  return -nextFloat32Up(-x);
}

/** Smallest float32 >= x. */
export function float32AtLeast(x) {
  const r = Math.fround(x);
  return r < x ? nextFloat32Up(r) : r;
}

/** Largest float32 <= x. */
export function float32AtMost(x) {
  const r = Math.fround(x);
  return r > x ? nextFloat32Down(r) : r;
}

/**
 * Build an attack box from double bounds.
 * Returns { lo, hi } (the exact bounds, Float64Array) and { lo32, hi32 }
 * (inward-rounded float32 bounds the attack actually uses).
 */
export function makeBox(lo, hi, label = "Input box") {
  const n = lo.length;
  const lo64 = Float64Array.from(lo);
  const hi64 = Float64Array.from(hi);
  const lo32 = new Float32Array(n);
  const hi32 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(lo64[i]) || !Number.isFinite(hi64[i])) {
      throw new Error(`${label}: input ${i} is unbounded; every input needs a finite lower and upper bound.`);
    }
    if (lo64[i] > hi64[i]) {
      throw new Error(`${label}: input ${i} has lower bound ${lo64[i]} above upper bound ${hi64[i]}.`);
    }
    lo32[i] = float32AtLeast(lo64[i]);
    hi32[i] = float32AtMost(hi64[i]);
    if (lo32[i] > hi32[i]) {
      throw new Error(`${label}: input ${i} interval [${lo64[i]}, ${hi64[i]}] contains no float32 value.`);
    }
  }
  return { lo: lo64, hi: hi64, lo32, hi32, size: n };
}

export function boxContains(box, x) {
  for (let i = 0; i < box.size; i++) {
    if (!(x[i] >= box.lo[i] && x[i] <= box.hi[i])) return false;
  }
  return true;
}

export function clampToBox32(box, x) {
  const out = new Float32Array(box.size);
  for (let i = 0; i < box.size; i++) {
    out[i] = Math.min(box.hi32[i], Math.max(box.lo32[i], x[i]));
  }
  return out;
}

export function boxCentre32(box) {
  const out = new Float32Array(box.size);
  for (let i = 0; i < box.size; i++) {
    out[i] = Math.min(box.hi32[i], Math.max(box.lo32[i], 0.5 * (box.lo32[i] + box.hi32[i])));
  }
  return out;
}

/** Uniform sample in the float32 box using the given rng. */
export function sampleBox32(box, rng) {
  const out = new Float32Array(box.size);
  for (let i = 0; i < box.size; i++) {
    const v = box.lo32[i] + rng() * (box.hi32[i] - box.lo32[i]);
    out[i] = Math.min(box.hi32[i], Math.max(box.lo32[i], v));
  }
  return out;
}
