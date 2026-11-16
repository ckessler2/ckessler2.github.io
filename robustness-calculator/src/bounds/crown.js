// Certified lower bounds with CROWN (Zhang et al., 2018) for feed-forward
// ReLU networks.
//
// 1. buildReluChain() turns the ONNX graph into a chain
//      z_1 = W_1 x + b_1,  z_k = W_k relu(z_{k-1}) + b_k,  y = z_n
//    by composing every run of affine operators (Gemm, MatMul, Add, Sub,
//    Mul, Div by constants, Flatten, Reshape, Identity) into one matrix.
//    Anything else (Sigmoid, Tanh, branching graphs) makes the model
//    uncertifiable, with the reason reported.
// 2. crownLowerBounds() bounds C·y from below over an input box by passing
//    linear bounds backwards through the chain. An unstable ReLU
//    (l < 0 < u on its input) is relaxed to
//      upper  relu(z) ≤ u (z − l) / (u − l)
//      lower  relu(z) ≥ a z,  a = 1 if u ≥ −l, else 0.
//    Pre-activation bounds of each hidden layer come from the same pass.
//
// Arithmetic is float64 on the float32 weights; see FLOAT_TOLERANCE.

const MAX_MATRIX = 50_000_000;

/**
 * Bounds are computed for the real-valued network. The deployed network runs
 * in float32, whose rounding can move the outputs slightly, so a margin is
 * only treated as certified when its lower bound exceeds this tolerance.
 */
export const FLOAT_TOLERANCE = 1e-3;

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
 * @returns {{ layers: {W: Float64Array, b: Float64Array, nin: number, nout: number}[] } | { error: string }}
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
  const nIn = prod(shape);
  let n = nIn;
  let W = null; // null = identity (n × n)
  let b = new Float64Array(n);
  let segIn = nIn;
  const layers = [];

  const dense = () => {
    if (W) return W;
    const I = new Float64Array(n * n);
    for (let i = 0; i < n; i++) I[i * n + i] = 1;
    return I;
  };
  // y = M · current, M: m × n (row-major)
  const applyMatrix = (M, m) => {
    if (m * segIn > MAX_MATRIX) throw new Error("the network is too large to certify in the browser");
    const next = new Float64Array(m * segIn);
    const nb = new Float64Array(m);
    if (W === null) {
      next.set(M);
    } else {
      for (let r = 0; r < m; r++) {
        for (let i = 0; i < n; i++) {
          const v = M[r * n + i];
          if (v === 0) continue;
          for (let c = 0; c < segIn; c++) next[r * segIn + c] += v * W[i * segIn + c];
        }
      }
    }
    for (let r = 0; r < m; r++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += M[r * n + i] * b[i];
      nb[r] = s;
    }
    W = next;
    b = nb;
    n = m;
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
          else {
            // Scale rows: Mul by v, Div by v, or c − x (scale −1 then add c).
            const s = node.opType === "Mul" ? v : node.opType === "Div" ? v.map((x) => 1 / x) : v.map(() => -1);
            if (W === null) W = dense();
            for (let i = 0; i < n; i++) {
              for (let col = 0; col < segIn; col++) W[i * segIn + col] *= s[i];
              b[i] *= s[i];
            }
            if (node.opType === "Sub") for (let i = 0; i < n; i++) b[i] += v[i];
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
        case "Relu":
          layers.push({ W: dense(), b, nin: segIn, nout: n });
          W = null;
          b = new Float64Array(n);
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
  layers.push({ W: dense(), b, nin: segIn, nout: n });
  return { layers };
}

/**
 * Lower bounds of the rows of A·z_k over the box [lo, hi] (A: m × n_k,
 * row-major), where z_k is the pre-activation of layer k, given the
 * pre-activation bounds of the earlier layers.
 */
function backward(layers, k, A, m, lo, hi, bounds) {
  let lam = A;
  let width = layers[k].nout;
  const c = new Float64Array(m);
  for (let j = k; j >= 0; j--) {
    const { W, b, nin, nout } = layers[j];
    for (let r = 0; r < m; r++) {
      let s = 0;
      for (let o = 0; o < nout; o++) s += lam[r * width + o] * b[o];
      c[r] += s;
    }
    const next = new Float64Array(m * nin);
    for (let r = 0; r < m; r++) {
      for (let o = 0; o < nout; o++) {
        const v = lam[r * width + o];
        if (v === 0) continue;
        const wo = o * nin;
        const nr = r * nin;
        for (let i = 0; i < nin; i++) next[nr + i] += v * W[wo + i];
      }
    }
    lam = next;
    width = nin;
    if (j === 0) break;
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
        else if (v >= 0) lam[idx] = ui >= -li ? v : 0;
        else {
          const s = ui / (ui - li);
          lam[idx] = v * s;
          c[r] -= v * s * li;
        }
      }
    }
  }
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

/** Lower bounds of C·y (C: m × outputs) over the box [lo, hi]. */
export function crownLowerBounds(chain, lo, hi, C, m) {
  const { layers } = chain;
  const bounds = [];
  for (let k = 0; k < layers.length - 1; k++) {
    const n = layers[k].nout;
    if (k === 0) {
      // First layer: interval arithmetic on an affine map is exact.
      const l = new Float64Array(n);
      const u = new Float64Array(n);
      const { W, b, nin } = layers[0];
      for (let o = 0; o < n; o++) {
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
      bounds.push({ l, u });
      continue;
    }
    const A = new Float64Array(2 * n * n);
    for (let i = 0; i < n; i++) {
      A[i * n + i] = 1;
      A[(n + i) * n + i] = -1;
    }
    const lb = backward(layers, k, A, 2 * n, lo, hi, bounds);
    bounds.push({ l: lb.slice(0, n), u: lb.slice(n).map((v) => -v) });
  }
  return backward(layers, layers.length - 1, C, m, lo, hi, bounds);
}

/** Lower bound on min over j ≠ label of (y_label − y_j) over the box. */
export function crownMarginLowerBound(chain, lo, hi, label) {
  const nOut = chain.layers[chain.layers.length - 1].nout;
  const C = new Float64Array((nOut - 1) * nOut);
  let r = 0;
  for (let j = 0; j < nOut; j++) {
    if (j === label) continue;
    C[r * nOut + label] = 1;
    C[r * nOut + j] = -1;
    r++;
  }
  return Math.min(...crownLowerBounds(chain, lo, hi, C, nOut - 1));
}
