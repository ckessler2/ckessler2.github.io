// Certified bounds with CROWN (Zhang et al., 2018) for feed-forward ReLU
// networks.
//
// 1. buildReluChain() turns the ONNX graph into a chain of layers
//      z_1 = A_1(x),  z_k = A_k(relu(z_{k-1})),  y = z_n,
//    where each A_k is a short list of affine operations: a dense matrix
//    (runs of Gemm / MatMul / Add / Sub / Mul / Div by constants, Flatten,
//    Reshape, Identity are merged into one), a 2-D convolution (kept as a
//    convolution, never expanded into a matrix), or an element-wise
//    scale-and-shift. Anything else (Sigmoid, Tanh, branches) makes the model
//    uncertifiable, with the reason reported.
// 2. crownLowerBounds() bounds C·y from below over an input box by passing
//    linear bounds backwards through the chain. An unstable ReLU
//    (l < 0 < u on its input) is relaxed to
//      upper  relu(z) ≤ u (z − l) / (u − l)
//      lower  relu(z) ≥ a z,  a = 1 if u ≥ −l, else 0.
//    Pre-activation bounds of the hidden layers come from the same backward
//    pass, except for layers wider than CROWN_MAX_WIDTH, which use interval
//    arithmetic (much cheaper, looser).
//
// Arithmetic is float64 on the float32 weights; see FLOAT_TOLERANCE.

const MAX_MATRIX = 50_000_000;
const CROWN_MAX_WIDTH = 1024;

export const CERTIFIERS = ["crown", "acrown-lite"];
const ACROWN_LITE_BASELINE_MODES = ["adaptive", "upper", "mid", "one", "zero"];
const ACROWN_LITE_ROW_LIMIT = 64;
const ACROWN_LITE_STEPS = 14;
const ACROWN_LITE_DELTA = 0.22;
const ACROWN_LITE_LR = 0.2;

/**
 * Bounds are computed for the real-valued network. The deployed network runs
 * in float32, whose rounding can move the outputs slightly, so a bound only
 * counts as certified when it clears its threshold by a safety margin: the
 * larger of 10⁻⁵ × max(1, |threshold|) and ten times the largest float32
 * disagreement measured by the run's self-test (tf.js vs onnxruntime).
 */
export const FLOAT_TOLERANCE = 1e-5;
export const MEASURED_ERROR_FACTOR = 10;
export const toleranceFor = (threshold, measuredError = 0) =>
  Math.max(FLOAT_TOLERANCE * Math.max(1, Math.abs(threshold)), MEASURED_ERROR_FACTOR * measuredError);

const prod = (a) => a.reduce((x, y) => x * y, 1);

/** Broadcast a constant tensor against a value of shape [batch, ...shape]; returns per-feature values. */
function broadcastConstant(t, shape) {
  const full = [1, ...shape];
  const dims = t.dims.slice();
  if (dims.length > full.length) return null;
  while (dims.length < full.length) dims.unshift(1);
  if (dims.some((d, i) => d !== 1 && d !== full[i])) return null;
  if (dims[0] !== 1) return null;
  const n = prod(shape);
  const out = new Float64Array(n);
  const strides = dims.map((_, i) => prod(dims.slice(i + 1)));
  const idx = new Array(full.length).fill(0);
  for (let f = 0; f < n; f++) {
    let rem = f;
    for (let d = full.length - 1; d >= 1; d--) {
      idx[d] = rem % full[d];
      rem = Math.floor(rem / full[d]);
    }
    let k = 0;
    for (let d = 1; d < full.length; d++) if (dims[d] !== 1) k += idx[d] * strides[d];
    out[f] = t.data[k];
  }
  return out;
}

/**
 * @param parsed  output of parseOnnxModel()
 * @param featureShape  the model's input shape without the batch dimension
 * @returns {{ layers: {ops: object[], nin: number, nout: number}[] } | { error: string }}
 */
export function buildReluChain(parsed, featureShape) {
  const { graph } = parsed;
  const statics = new Map(graph.initializers);
  for (const n of graph.nodes) {
    if (n.opType === "Constant" && n.attrs.value) statics.set(n.outputs[0], n.attrs.value);
  }
  for (const n of graph.nodes) {
    if (n.opType === "Identity" && statics.has(n.inputs[0])) statics.set(n.outputs[0], statics.get(n.inputs[0]));
  }

  let cur = graph.inputs[0].name;
  let shape = featureShape.slice();
  let n = prod(shape);
  let segIn = n; // input width of the current layer
  let ops = []; // finished operations of the current layer
  let opIn = n; // input width of the pending affine map
  // Pending affine map from the last finished op: null W = diagonal `s` (null s = identity).
  let W = null;
  let s = null;
  let b = new Float64Array(n);
  const layers = [];

  const flush = () => {
    if (W) ops.push({ kind: "dense", W, b, nin: opIn, nout: n });
    else if (s || b.some((v) => v !== 0)) ops.push({ kind: "diag", s: s ?? new Float64Array(n).fill(1), b, nin: n, nout: n });
    W = null;
    s = null;
    b = new Float64Array(n);
    opIn = n;
  };
  // y = M · current, M: m × n (row-major)
  const applyMatrix = (M, m) => {
    if (m * opIn > MAX_MATRIX) throw new Error("the network is too large to certify in the browser");
    const next = new Float64Array(m * opIn);
    if (W === null) {
      for (let r = 0; r < m; r++) for (let i = 0; i < n; i++) next[r * opIn + i] = M[r * n + i] * (s ? s[i] : 1);
    } else {
      for (let r = 0; r < m; r++) {
        for (let i = 0; i < n; i++) {
          const v = M[r * n + i];
          if (v === 0) continue;
          for (let c = 0; c < opIn; c++) next[r * opIn + c] += v * W[i * opIn + c];
        }
      }
    }
    const nb = new Float64Array(m);
    for (let r = 0; r < m; r++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += M[r * n + i] * b[i];
      nb[r] = sum;
    }
    W = next;
    s = null;
    b = nb;
    n = m;
  };
  const scaleRows = (v) => {
    if (W) for (let i = 0; i < n; i++) for (let c = 0; c < opIn; c++) W[i * opIn + c] *= v[i];
    else s = Float64Array.from(v, (x, i) => x * (s ? s[i] : 1));
    for (let i = 0; i < n; i++) b[i] *= v[i];
  };

  try {
    for (const node of graph.nodes) {
      if (node.opType === "Constant") continue;
      const dynamic = node.inputs.filter((x) => x && !statics.has(x));
      if (dynamic.length === 0) continue;
      if (dynamic.length !== 1 || dynamic[0] !== cur) {
        return { error: "the graph is not a single chain of layers" };
      }
      const a = node.attrs;
      const other = node.inputs.find((x) => x && x !== cur);
      const c = other !== undefined ? statics.get(other) : null;

      switch (node.opType) {
        case "Identity":
        case "Dropout":
          break;
        case "Flatten":
          shape = [prod(shape)];
          break;
        case "Reshape": {
          const t = c ? Array.from(c.data, Number) : a.shape;
          const rest = t.slice(1).map((d, i) => (d === 0 ? shape[i] : d));
          const known = prod(rest.filter((d) => d > 0));
          shape = rest.map((d) => (d === -1 ? prod(shape) / known : d));
          if (prod(shape) !== n) return { error: "a Reshape changes the batch layout" };
          break;
        }
        case "Add":
        case "Sub":
        case "Mul":
        case "Div": {
          const v = broadcastConstant(c, shape);
          if (!v) return { error: `${node.opType} with a constant of shape [${c.dims}] cannot be broadcast` };
          const constFirst = node.inputs[0] !== cur;
          if (node.opType === "Add") for (let i = 0; i < n; i++) b[i] += v[i];
          else if (node.opType === "Sub" && !constFirst) for (let i = 0; i < n; i++) b[i] -= v[i];
          else if (node.opType === "Div" && constFirst) return { error: "division by the network's input is not affine" };
          else if (node.opType === "Mul") scaleRows(v);
          else if (node.opType === "Div") scaleRows(v.map((x) => 1 / x));
          else {
            // c − x
            scaleRows(v.map(() => -1));
            for (let i = 0; i < n; i++) b[i] += v[i];
          }
          break;
        }
        case "MatMul":
        case "Gemm": {
          if (node.inputs[0] !== cur) return { error: `${node.opType} with the input on the right is not supported` };
          if (prod(shape.slice(0, -1)) !== 1) return { error: `${node.opType} on a multi-row feature map is not supported` };
          if (a.transA === 1) return { error: "Gemm with transA is not supported" };
          const B = statics.get(node.inputs[1]);
          if (!B || B.dims.length !== 2) return { error: `${node.opType} needs a constant 2-D weight` };
          const transB = node.opType === "Gemm" && a.transB === 1;
          const k = transB ? B.dims[1] : B.dims[0];
          const m = transB ? B.dims[0] : B.dims[1];
          if (k !== n) return { error: `${node.opType} weight shape does not match` };
          const alpha = node.opType === "Gemm" ? a.alpha ?? 1 : 1;
          const M = new Float64Array(m * n);
          for (let r = 0; r < m; r++) for (let i = 0; i < n; i++) M[r * n + i] = alpha * (transB ? B.data[r * n + i] : B.data[i * m + r]);
          applyMatrix(M, m);
          if (node.opType === "Gemm" && node.inputs[2]) {
            const C = statics.get(node.inputs[2]);
            const v = C && broadcastConstant(C, [m]);
            if (!v) return { error: "Gemm bias cannot be broadcast" };
            const beta = a.beta ?? 1;
            for (let i = 0; i < m; i++) b[i] += beta * v[i];
          }
          shape = [...shape.slice(0, -1), m];
          break;
        }
        case "Conv": {
          if (shape.length !== 3) return { error: "Conv needs a [channels, height, width] input" };
          if ((a.group ?? 1) !== 1) return { error: "grouped convolutions are not supported" };
          if (a.auto_pad && a.auto_pad !== "NOTSET") return { error: `Conv auto_pad=${a.auto_pad} is not supported` };
          const K = statics.get(node.inputs[1]);
          if (!K || K.dims.length !== 4) return { error: "Conv needs a constant 4-D weight" };
          const [Cout, Cin, kh, kw] = K.dims;
          const [Cin0, Hin, Win] = shape;
          if (Cin !== Cin0) return { error: "Conv weight shape does not match" };
          const [pt, pl, pb, pr] = a.pads ?? [0, 0, 0, 0];
          const [sh, sw] = a.strides ?? [1, 1];
          const [dh, dw] = a.dilations ?? [1, 1];
          const Hout = Math.floor((Hin + pt + pb - dh * (kh - 1) - 1) / sh) + 1;
          const Wout = Math.floor((Win + pl + pr - dw * (kw - 1) - 1) / sw) + 1;
          flush();
          const bias = new Float64Array(Cout);
          if (node.inputs[2]) {
            const B = statics.get(node.inputs[2]);
            if (!B) return { error: "Conv bias must be constant" };
            bias.set(Float64Array.from(B.data));
          }
          ops.push({
            kind: "conv",
            K: Float64Array.from(K.data),
            bias,
            Cin, Hin, Win, Cout, Hout, Wout, kh, kw, sh, sw, pt, pl, dh, dw,
            nin: n,
            nout: Cout * Hout * Wout,
          });
          shape = [Cout, Hout, Wout];
          n = Cout * Hout * Wout;
          b = new Float64Array(n);
          opIn = n;
          break;
        }
        case "Relu":
          flush();
          layers.push({ ops, nin: segIn, nout: n });
          ops = [];
          segIn = n;
          break;
        default:
          return { error: `operator ${node.opType} is not supported by the certifier` };
      }
      cur = node.outputs[0];
    }
  } catch (err) {
    return { error: err.message };
  }
  if (cur !== graph.outputs[0].name) return { error: "the output is not at the end of the layer chain" };
  flush();
  layers.push({ ops, nin: segIn, nout: n });
  return { layers };
}

// ---------------------------------------------------------------------------
// Operations: forward (point and interval) and backward (row vectors).

function forwardOp(op, x) {
  if (op.kind === "dense") {
    const { W, b, nin, nout } = op;
    const y = new Float64Array(nout);
    for (let o = 0; o < nout; o++) {
      let sum = b[o];
      for (let i = 0; i < nin; i++) sum += W[o * nin + i] * x[i];
      y[o] = sum;
    }
    return y;
  }
  if (op.kind === "diag") return Float64Array.from(x, (v, i) => op.s[i] * v + op.b[i]);
  return convForward(op, x, null).lo;
}

/** Interval through one op: exact for a single affine op. */
function intervalOp(op, lo, hi) {
  if (op.kind === "dense") {
    const { W, b, nin, nout } = op;
    const l = new Float64Array(nout);
    const u = new Float64Array(nout);
    for (let o = 0; o < nout; o++) {
      let a = b[o];
      let z = b[o];
      for (let i = 0; i < nin; i++) {
        const w = W[o * nin + i];
        if (w >= 0) {
          a += w * lo[i];
          z += w * hi[i];
        } else {
          a += w * hi[i];
          z += w * lo[i];
        }
      }
      l[o] = a;
      u[o] = z;
    }
    return { lo: l, hi: u };
  }
  if (op.kind === "diag") {
    const l = new Float64Array(op.nout);
    const u = new Float64Array(op.nout);
    for (let i = 0; i < op.nout; i++) {
      const a = op.s[i] * lo[i] + op.b[i];
      const z = op.s[i] * hi[i] + op.b[i];
      l[i] = Math.min(a, z);
      u[i] = Math.max(a, z);
    }
    return { lo: l, hi: u };
  }
  return convForward(op, lo, hi);
}

/** Convolution of a point (hi = null) or an interval [lo, hi]. */
function convForward(op, lo, hi) {
  const { K, bias, Cin, Hin, Win, Cout, Hout, Wout, kh, kw, sh, sw, pt, pl, dh, dw } = op;
  const outL = new Float64Array(Cout * Hout * Wout);
  const outU = hi ? new Float64Array(Cout * Hout * Wout) : null;
  for (let co = 0; co < Cout; co++) {
    for (let ho = 0; ho < Hout; ho++) {
      for (let wo = 0; wo < Wout; wo++) {
        let a = bias[co];
        let z = bias[co];
        for (let ci = 0; ci < Cin; ci++) {
          for (let i = 0; i < kh; i++) {
            const hiIdx = ho * sh - pt + i * dh;
            if (hiIdx < 0 || hiIdx >= Hin) continue;
            for (let j = 0; j < kw; j++) {
              const wiIdx = wo * sw - pl + j * dw;
              if (wiIdx < 0 || wiIdx >= Win) continue;
              const w = K[((co * Cin + ci) * kh + i) * kw + j];
              const idx = (ci * Hin + hiIdx) * Win + wiIdx;
              if (!hi) a += w * lo[idx];
              else if (w >= 0) {
                a += w * lo[idx];
                z += w * hi[idx];
              } else {
                a += w * hi[idx];
                z += w * lo[idx];
              }
            }
          }
        }
        const o = (co * Hout + ho) * Wout + wo;
        outL[o] = a;
        if (outU) outU[o] = z;
      }
    }
  }
  return { lo: outL, hi: outU };
}

/** Rows lam (m × op.nout) → lam·op (m × op.nin); adds lam·bias to c. */
function backwardOp(op, lam, m, c) {
  if (op.kind === "dense") {
    const { W, b, nin, nout } = op;
    for (let r = 0; r < m; r++) {
      let sum = 0;
      for (let o = 0; o < nout; o++) sum += lam[r * nout + o] * b[o];
      c[r] += sum;
    }
    const next = new Float64Array(m * nin);
    for (let r = 0; r < m; r++) {
      for (let o = 0; o < nout; o++) {
        const v = lam[r * nout + o];
        if (v === 0) continue;
        const wo = o * nin;
        const nr = r * nin;
        for (let i = 0; i < nin; i++) next[nr + i] += v * W[wo + i];
      }
    }
    return next;
  }
  if (op.kind === "diag") {
    const n = op.nout;
    const next = new Float64Array(m * n);
    for (let r = 0; r < m; r++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += lam[r * n + i] * op.b[i];
        next[r * n + i] = lam[r * n + i] * op.s[i];
      }
      c[r] += sum;
    }
    return next;
  }
  const { K, bias, Cin, Hin, Win, Cout, Hout, Wout, kh, kw, sh, sw, pt, pl, dh, dw, nin, nout } = op;
  const next = new Float64Array(m * nin);
  for (let r = 0; r < m; r++) {
    let sum = 0;
    for (let co = 0; co < Cout; co++) {
      for (let ho = 0; ho < Hout; ho++) {
        for (let wo = 0; wo < Wout; wo++) {
          const v = lam[r * nout + (co * Hout + ho) * Wout + wo];
          if (v === 0) continue;
          sum += v * bias[co];
          for (let ci = 0; ci < Cin; ci++) {
            for (let i = 0; i < kh; i++) {
              const hiIdx = ho * sh - pt + i * dh;
              if (hiIdx < 0 || hiIdx >= Hin) continue;
              for (let j = 0; j < kw; j++) {
                const wiIdx = wo * sw - pl + j * dw;
                if (wiIdx < 0 || wiIdx >= Win) continue;
                next[r * nin + (ci * Hin + hiIdx) * Win + wiIdx] += v * K[((co * Cin + ci) * kh + i) * kw + j];
              }
            }
          }
        }
      }
    }
    c[r] += sum;
  }
  return next;
}

/** Forward pass of the chain at a point (float64); used by tests. */
export function chainForward(chain, x) {
  let h = Float64Array.from(x);
  chain.layers.forEach((layer, k) => {
    for (const op of layer.ops) h = forwardOp(op, h);
    if (k < chain.layers.length - 1) h = h.map((v) => Math.max(0, v));
  });
  return h;
}

/**
 * Lower bounds of the rows of A·z_k over the box [lo, hi] (A: m × n_k,
 * row-major), where z_k is the pre-activation of layer k, given the
 * pre-activation bounds of the earlier layers.
 */
function reluLowerSlope(mode, li, ui) {
  switch (mode) {
    case "zero":
      return 0;
    case "one":
      return 1;
    case "mid":
      return 0.5;
    case "upper":
      return ui / (ui - li);
    case "adaptive":
    default:
      return ui >= -li ? 1 : 0;
  }
}

/** "acrown-lite" maps to a small set of sound slope choices; unknown values fall back to CROWN. */
export function normaliseCertifier(name) {
  return CERTIFIERS.includes(name) ? name : "crown";
}

const clamp01 = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : v);

function cloneAlpha(alphaByLayer) {
  return alphaByLayer.map((a) => (a ? Float64Array.from(a) : null));
}

function createAlphaState(bounds, mode = "adaptive") {
  return bounds.map(({ l, u }) => {
    const alpha = new Float64Array(l.length);
    for (let i = 0; i < l.length; i++) {
      if (l[i] >= 0) alpha[i] = 1;
      else if (u[i] <= 0) alpha[i] = 0;
      else alpha[i] = reluLowerSlope(mode, l[i], u[i]);
    }
    return alpha;
  });
}

function unstableIndices(bounds) {
  return bounds.map(({ l, u }) => {
    const idx = [];
    for (let i = 0; i < l.length; i++) if (l[i] < 0 && u[i] > 0) idx.push(i);
    return idx;
  });
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let z = Math.imul(t ^ (t >>> 15), t | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function backward(layers, k, A, m, lo, hi, bounds, { alphaMode = "adaptive", alphaByLayer = null } = {}) {
  let lam = A;
  const c = new Float64Array(m);
  for (let j = k; j >= 0; j--) {
    const ops = layers[j].ops;
    for (let q = ops.length - 1; q >= 0; q--) lam = backwardOp(ops[q], lam, m, c);
    if (j === 0) break;
    const nin = layers[j].nin;
    const { l, u } = bounds[j - 1];
    for (let i = 0; i < nin; i++) {
      const li = l[i];
      const ui = u[i];
      if (li >= 0) continue;
      for (let r = 0; r < m; r++) {
        const idx = r * nin + i;
        const v = lam[idx];
        if (v === 0) continue;
        if (ui <= 0) lam[idx] = 0;
        else if (v >= 0) {
          const alpha = alphaByLayer?.[j - 1]?.[i];
          lam[idx] = v * (alpha === undefined ? reluLowerSlope(alphaMode, li, ui) : alpha);
        }
        else {
          const s = ui / (ui - li);
          lam[idx] = v * s;
          c[r] -= v * s * li;
        }
      }
    }
  }
  const width = layers[0].nin;
  const out = new Float64Array(m);
  for (let r = 0; r < m; r++) {
    let s = c[r];
    for (let i = 0; i < width; i++) {
      const v = lam[r * width + i];
      s += v >= 0 ? v * lo[i] : v * hi[i];
    }
    out[r] = s;
  }
  return out;
}

function buildHiddenBounds(chain, lo, hi) {
  const { layers } = chain;
  const bounds = [];
  for (let k = 0; k < layers.length - 1; k++) {
    const n = layers[k].nout;
    if (k === 0 || n > CROWN_MAX_WIDTH) {
      // Interval arithmetic: exact for the first layer when it is one affine op.
      const prevL = k === 0 ? lo : bounds[k - 1].l.map((v) => Math.max(0, v));
      const prevU = k === 0 ? hi : bounds[k - 1].u.map((v) => Math.max(0, v));
      bounds.push(intervalLayer(layers[k], prevL, prevU));
      continue;
    }
    const A = new Float64Array(2 * n * n);
    for (let i = 0; i < n; i++) {
      A[i * n + i] = 1;
      A[(n + i) * n + i] = -1;
    }
    const lb = backward(layers, k, A, 2 * n, lo, hi, bounds);
    // Keep the tighter of CROWN and interval bounds.
    const ib = intervalLayer(layers[k], bounds[k - 1].l.map((v) => Math.max(0, v)), bounds[k - 1].u.map((v) => Math.max(0, v)));
    const l = lb.slice(0, n).map((v, i) => Math.max(v, ib.l[i]));
    const u = lb.slice(n).map((v, i) => Math.min(-v, ib.u[i]));
    bounds.push({ l, u });
  }
  return bounds;
}

function intervalLayer(layer, lo, hi) {
  let l = lo;
  let u = hi;
  for (const op of layer.ops) ({ lo: l, hi: u } = intervalOp(op, l, u));
  return { l, u };
}

/** Lower bounds of C·y (C: m × outputs) over the box [lo, hi] from interval arithmetic alone (cheap, loose). */
export function intervalLowerBounds(chain, lo, hi, C, m) {
  let l = lo;
  let u = hi;
  chain.layers.forEach((layer, k) => {
    ({ l, u } = intervalLayer(layer, l, u));
    if (k < chain.layers.length - 1) {
      l = l.map((v) => Math.max(0, v));
      u = u.map((v) => Math.max(0, v));
    }
  });
  const nOut = l.length;
  const out = new Float64Array(m);
  for (let r = 0; r < m; r++) {
    let s = 0;
    for (let j = 0; j < nOut; j++) {
      const a = C[r * nOut + j];
      s += a >= 0 ? a * l[j] : a * u[j];
    }
    out[r] = s;
  }
  return out;
}

/** Lower bounds of C·y (C: m × outputs) over the box [lo, hi]. */
export function crownLowerBounds(chain, lo, hi, C, m) {
  const { layers } = chain;
  const bounds = buildHiddenBounds(chain, lo, hi);
  return backward(layers, layers.length - 1, C, m, lo, hi, bounds);
}

/**
 * α-CROWN-lite: per-row optimisation of per-neuron ReLU lower slopes α∈[0,1]
 * with a small projected-ascent budget (SPSA style). It stays incomplete but
 * is often tighter than one fixed CROWN slope rule while keeping runtime
 * browser-friendly.
 */
export function acrownLiteLowerBounds(
  chain,
  lo,
  hi,
  C,
  m,
  { rowLimit = ACROWN_LITE_ROW_LIMIT, baselineModes = ACROWN_LITE_BASELINE_MODES, steps = ACROWN_LITE_STEPS } = {},
) {
  if (m > rowLimit) return crownLowerBounds(chain, lo, hi, C, m);
  const { layers } = chain;
  const bounds = buildHiddenBounds(chain, lo, hi);
  const unstable = unstableIndices(bounds);
  const totalUnstable = unstable.reduce((n, idx) => n + idx.length, 0);
  if (!totalUnstable) return crownLowerBounds(chain, lo, hi, C, m);

  const nOut = layers[layers.length - 1].nout;
  const out = new Float64Array(m);
  const row = new Float64Array(nOut);

  const evalRow = (rowCoeffs, alphaByLayer = null, alphaMode = "adaptive") =>
    backward(layers, layers.length - 1, rowCoeffs, 1, lo, hi, bounds, { alphaByLayer, alphaMode })[0];

  for (let r = 0; r < m; r++) {
    for (let j = 0; j < nOut; j++) row[j] = C[r * nOut + j];

    // Never weaker than baseline CROWN.
    let best = evalRow(row, null, "adaptive");

    // Keep strong fixed policies as cheap candidates.
    for (const mode of baselineModes) {
      const lb = evalRow(row, null, mode);
      if (lb > best) best = lb;
    }

    if (steps > 0) {
      let alpha = createAlphaState(bounds, "adaptive");
      let bestAlpha = cloneAlpha(alpha);
      let bestLocal = evalRow(row, alpha);
      if (bestLocal > best) best = bestLocal;

      const rng = mulberry32((r + 1) * 0x9e3779b1);
      const dirs = unstable.map((ids) => (ids.length ? new Int8Array(ids.length) : null));

      for (let it = 0; it < steps; it++) {
        const frac = 1 - it / Math.max(steps, 1);
        const delta = ACROWN_LITE_DELTA * (0.35 + 0.65 * frac);
        const lr = ACROWN_LITE_LR * (0.35 + 0.65 * frac);

        const plus = cloneAlpha(alpha);
        const minus = cloneAlpha(alpha);
        for (let k = 0; k < unstable.length; k++) {
          const ids = unstable[k];
          const d = dirs[k];
          for (let p = 0; p < ids.length; p++) {
            const i = ids[p];
            const s = rng() < 0.5 ? -1 : 1;
            d[p] = s;
            plus[k][i] = clamp01(alpha[k][i] + delta * s);
            minus[k][i] = clamp01(alpha[k][i] - delta * s);
          }
        }

        const fPlus = evalRow(row, plus);
        const fMinus = evalRow(row, minus);
        if (fPlus > bestLocal) {
          bestLocal = fPlus;
          bestAlpha = cloneAlpha(plus);
        }
        if (fMinus > bestLocal) {
          bestLocal = fMinus;
          bestAlpha = cloneAlpha(minus);
        }

        const coeff = (fPlus - fMinus) / Math.max(2 * delta, 1e-12);
        for (let k = 0; k < unstable.length; k++) {
          const ids = unstable[k];
          const d = dirs[k];
          for (let p = 0; p < ids.length; p++) {
            const i = ids[p];
            alpha[k][i] = clamp01(alpha[k][i] + lr * coeff * d[p]);
          }
        }
        const fNow = evalRow(row, alpha);
        if (fNow > bestLocal) {
          bestLocal = fNow;
          bestAlpha = cloneAlpha(alpha);
        }
      }

      const fBest = evalRow(row, bestAlpha);
      if (fBest > best) best = fBest;
    }

    out[r] = best;
  }
  return out;
}

/** Lower bounds from the selected certifier (default: CROWN). */
export function certifierLowerBounds(chain, lo, hi, C, m, { certifier = "crown" } = {}) {
  const method = normaliseCertifier(certifier);
  if (method === "acrown-lite") return acrownLiteLowerBounds(chain, lo, hi, C, m);
  return crownLowerBounds(chain, lo, hi, C, m);
}

/** Lower bound on min over j ≠ label of (y_label − y_j) over the box. */
export function crownMarginLowerBound(chain, lo, hi, label) {
  return certifierMarginLowerBound(chain, lo, hi, label, { certifier: "crown" });
}

/** Lower bound on min over j ≠ label of (y_label − y_j), for a chosen certifier. */
export function certifierMarginLowerBound(chain, lo, hi, label, { certifier = "crown" } = {}) {
  const nOut = chain.layers[chain.layers.length - 1].nout;
  const C = new Float64Array((nOut - 1) * nOut);
  let r = 0;
  for (let j = 0; j < nOut; j++) {
    if (j === label) continue;
    C[r * nOut + label] = 1;
    C[r * nOut + j] = -1;
    r++;
  }
  return Math.min(...certifierLowerBounds(chain, lo, hi, C, nOut - 1, { certifier }));
}
