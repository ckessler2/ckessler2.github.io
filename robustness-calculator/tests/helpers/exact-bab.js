// Ground truth for small fully connected ReLU classifiers (test-only).
//
// Branch and bound with interval bound propagation, in float64:
//   - if IBP proves the margin is positive on a sub-box, the sub-box is safe;
//   - if the sub-box centre is misclassified, that is a counterexample;
//   - otherwise split the widest side and repeat.
// IBP is sound, so "robust" answers are proofs; "not robust" answers come
// with a witness. Only practical for low-dimensional inputs.

import { parseOnnxModel } from "../../src/onnx/onnx-model.js";

/** Read a Gemm/Relu chain (as written by tests/helpers/toy-classifier.js) into float64 layers. */
export function readMlp(bytes) {
  const { graph } = parseOnnxModel(bytes);
  const layers = [];
  for (const n of graph.nodes) {
    if (n.opType !== "Gemm") continue;
    if (n.attrs.transA || n.attrs.transB || (n.attrs.alpha ?? 1) !== 1 || (n.attrs.beta ?? 1) !== 1) {
      throw new Error("readMlp only handles plain Gemm layers.");
    }
    const W = graph.initializers.get(n.inputs[1]);
    const b = graph.initializers.get(n.inputs[2]);
    layers.push({ nin: W.dims[0], nout: W.dims[1], W: Float64Array.from(W.data), b: Float64Array.from(b.data) });
  }
  return layers;
}

export function logits(layers, x) {
  let h = Array.from(x);
  layers.forEach(({ W, b, nin, nout }, li) => {
    const o = new Array(nout);
    for (let j = 0; j < nout; j++) {
      let s = b[j];
      for (let i = 0; i < nin; i++) s += h[i] * W[i * nout + j];
      o[j] = s;
    }
    h = li < layers.length - 1 ? o.map((v) => Math.max(0, v)) : o;
  });
  return h;
}

export function margin(layers, x, label) {
  const z = logits(layers, x);
  let other = -Infinity;
  z.forEach((v, j) => {
    if (j !== label && v > other) other = v;
  });
  return z[label] - other;
}

/** Sound lower bound on min over the box of (z_label - z_j), minimised over j. */
function marginLowerBound(layers, lo, hi, label) {
  let l = Array.from(lo);
  let u = Array.from(hi);
  for (let li = 0; li < layers.length - 1; li++) {
    const { W, b, nin, nout } = layers[li];
    const nl = new Array(nout);
    const nu = new Array(nout);
    for (let j = 0; j < nout; j++) {
      let a = b[j];
      let c = b[j];
      for (let i = 0; i < nin; i++) {
        const w = W[i * nout + j];
        if (w >= 0) {
          a += w * l[i];
          c += w * u[i];
        } else {
          a += w * u[i];
          c += w * l[i];
        }
      }
      nl[j] = Math.max(0, a);
      nu[j] = Math.max(0, c);
    }
    l = nl;
    u = nu;
  }
  // Last layer: bound each margin directly (tighter than subtracting intervals).
  const { W, b, nin, nout } = layers[layers.length - 1];
  let worst = Infinity;
  for (let j = 0; j < nout; j++) {
    if (j === label) continue;
    let m = b[label] - b[j];
    for (let i = 0; i < nin; i++) {
      const c = W[i * nout + label] - W[i * nout + j];
      m += c >= 0 ? c * l[i] : c * u[i];
    }
    worst = Math.min(worst, m);
  }
  return worst;
}

// Min-heap of boxes keyed by their margin lower bound (most suspicious first).
function createHeap() {
  const a = [];
  return {
    get size() {
      return a.length;
    },
    push(item) {
      a.push(item);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].key <= a[i].key) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    },
    pop() {
      const top = a[0];
      const last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < a.length && a[l].key < a[m].key) m = l;
          if (r < a.length && a[r].key < a[m].key) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]];
          i = m;
        }
      }
      return top;
    },
  };
}

function corners(lo, hi) {
  let out = [[]];
  for (let i = 0; i < lo.length; i++) out = out.flatMap((c) => [[...c, lo[i]], [...c, hi[i]]]);
  return out;
}

/**
 * Is the classifier robust on the L∞ ball of radius eps around x?
 * Best-first branch and bound. Returns { robust: true } (proved),
 * { robust: false, witness } or { robust: null } if some box could not be
 * decided before reaching minWidth.
 */
export function exactRobust(layers, x, label, eps, { minWidth = 1e-9, maxBoxes = 2_000_000 } = {}) {
  const heap = createHeap();
  const add = (lo, hi) => {
    const key = marginLowerBound(layers, lo, hi, label);
    if (key <= 0) heap.push({ key, lo, hi });
  };
  add(x.map((v) => v - eps), x.map((v) => v + eps));
  const checkCorners = x.length <= 4;
  let boxes = 0;
  let undecided = 0;
  while (heap.size) {
    const { lo, hi } = heap.pop();
    if (++boxes > maxBoxes) return { robust: null, boxes };
    const candidates = [lo.map((v, i) => 0.5 * (v + hi[i])), ...(checkCorners ? corners(lo, hi) : [])];
    for (const c of candidates) {
      if (margin(layers, c, label) < 0) return { robust: false, witness: c, boxes };
    }
    let k = 0;
    for (let i = 1; i < lo.length; i++) if (hi[i] - lo[i] > hi[k] - lo[k]) k = i;
    if (hi[k] - lo[k] < minWidth) {
      undecided++;
      continue;
    }
    const mid = 0.5 * (lo[k] + hi[k]);
    const hiA = hi.slice();
    hiA[k] = mid;
    const loB = lo.slice();
    loB[k] = mid;
    add(lo, hiA);
    add(loB, hi);
  }
  return undecided ? { robust: null, boxes, undecided } : { robust: true, boxes };
}

/** Smallest eps in [0, epsMax] at which the point is not robust (bisection to tol), or Infinity. */
export function exactMinEpsilon(layers, x, label, epsMax, tol = 1e-7) {
  if (margin(layers, x, label) < 0) return 0;
  const decide = (eps) => {
    const r = exactRobust(layers, x, label, eps);
    if (r.robust === null) throw new Error(`Ground truth undecided at eps = ${eps}.`);
    return r.robust;
  };
  if (decide(epsMax)) return Infinity;
  let lo = 0;
  let hi = epsMax;
  while (hi - lo > tol) {
    const mid = 0.5 * (lo + hi);
    if (decide(mid) === false) hi = mid;
    else lo = mid;
  }
  return hi;
}
