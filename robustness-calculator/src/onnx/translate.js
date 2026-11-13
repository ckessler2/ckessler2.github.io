// Translate a parsed ONNX graph into a TensorFlow.js function so we can take
// gradients with tf.grad. `tf` is passed in so the same code runs in the
// browser worker (CDN build) and in Node tests (npm build).
//
// Batching convention: the model is always run on a batch [B, ...featureShape].
// If the declared input has a leading batch dimension (1 or symbolic) it is
// replaced by B; if the declared input has rank 1 a leading batch dimension is
// added. Every result is re-checked against onnxruntime-web, which runs the
// untouched model, so a batching mistake here shows up as a self-test failure
// rather than a false counterexample.

export const SUPPORTED_OPS = [
  "Gemm",
  "MatMul",
  "Add",
  "Sub",
  "Mul",
  "Div",
  "Relu",
  "Sigmoid",
  "Tanh",
  "Flatten",
  "Reshape",
  "Constant",
  "Identity",
];

const prod = (arr) => arr.reduce((a, b) => a * b, 1);

function staticFromConstantNode(node) {
  const a = node.attrs;
  if (a.value) return a.value;
  if (a.value_float !== undefined) return { dims: [], dataType: "float32", data: Float32Array.of(a.value_float) };
  if (a.value_floats) return { dims: [a.value_floats.length], dataType: "float32", data: Float32Array.from(a.value_floats) };
  if (a.value_int !== undefined) return { dims: [], dataType: "int64", data: [a.value_int] };
  if (a.value_ints) return { dims: [a.value_ints.length], dataType: "int64", data: a.value_ints.slice() };
  throw new Error(`Constant node "${node.name}" uses an unsupported value attribute.`);
}

function topoSort(nodes, available) {
  const ready = new Set(available);
  const remaining = nodes.slice();
  const ordered = [];
  while (remaining.length) {
    const idx = remaining.findIndex((n) => n.inputs.every((i) => i === "" || ready.has(i)));
    if (idx < 0) {
      const missing = remaining[0].inputs.filter((i) => i !== "" && !ready.has(i));
      throw new Error(`Graph cannot be ordered: node "${remaining[0].name || remaining[0].opType}" needs ${missing.join(", ")}.`);
    }
    const [node] = remaining.splice(idx, 1);
    ordered.push(node);
    node.outputs.forEach((o) => ready.add(o));
  }
  return ordered;
}

function resolveInputLayout(info) {
  const shape = info.shape;
  if (!shape || shape.length === 0) {
    throw new Error(`Input "${info.name}" has no declared shape.`);
  }
  if (info.elemType && info.elemType !== "float32") {
    throw new Error(`Input "${info.name}" is ${info.elemType}; only float32 inputs are supported.`);
  }
  const lead = shape[0];
  const leadIsBatch = shape.length >= 2 && (lead === 1 || typeof lead === "string" || lead === null || lead <= 0);
  if (shape.length >= 2 && !leadIsBatch) {
    throw new Error(`Input "${info.name}" has a fixed batch size of ${lead}; only batch size 1 or a symbolic batch is supported.`);
  }
  const featureShape = leadIsBatch ? shape.slice(1) : shape.slice();
  if (featureShape.some((d) => typeof d !== "number" || d <= 0)) {
    throw new Error(`Input "${info.name}" has shape [${shape}]; all non-batch dimensions must be fixed.`);
  }
  // Shape onnxruntime should be given for a single sample.
  const ortShape = leadIsBatch ? [1, ...featureShape] : featureShape.slice();
  return { featureShape, ortShape, size: prod(featureShape) };
}

export function translateModel(tf, parsed) {
  const { graph, opsets } = parsed;
  const opset = opsets.find((o) => o.domain === "" || o.domain === "ai.onnx")?.version ?? 0;

  if (graph.inputs.length !== 1) {
    throw new Error(`The model has ${graph.inputs.length} inputs (${graph.inputs.map((i) => i.name).join(", ")}); exactly one is supported.`);
  }
  if (graph.outputs.length < 1) {
    throw new Error("The model declares no outputs.");
  }

  const foreign = graph.nodes.filter((n) => n.domain && n.domain !== "ai.onnx");
  if (foreign.length) {
    throw new Error(`Unsupported operator domain(s): ${[...new Set(foreign.map((n) => `${n.domain}:${n.opType}`))].join(", ")}.`);
  }
  const unsupported = [...new Set(graph.nodes.map((n) => n.opType).filter((op) => !SUPPORTED_OPS.includes(op)))];
  if (unsupported.length) {
    throw new Error(
      `Unsupported operator${unsupported.length > 1 ? "s" : ""}: ${unsupported.join(", ")}. ` +
        `Supported: ${SUPPORTED_OPS.join(", ")}.`,
    );
  }
  for (const n of graph.nodes) {
    for (const [k, v] of Object.entries(n.attrs)) {
      if (v && v.unsupportedAttributeType) {
        throw new Error(`Node "${n.name || n.opType}" has a ${v.unsupportedAttributeType} attribute "${k}", which is not supported.`);
      }
    }
    if (["Add", "Sub", "Mul", "Div"].includes(n.opType) && n.attrs.broadcast === 1 && n.attrs.axis !== undefined) {
      throw new Error(`Node "${n.name || n.opType}" uses legacy axis broadcasting (opset < 7), which is not supported.`);
    }
  }

  const inputInfo = graph.inputs[0];
  const layout = resolveInputLayout(inputInfo);
  const outputInfo = graph.outputs[0];

  // Static (compile-time) values: initialisers and Constant outputs.
  const statics = new Map(graph.initializers);
  for (const n of graph.nodes) {
    if (n.opType === "Constant") statics.set(n.outputs[0], staticFromConstantNode(n));
  }
  for (const n of graph.nodes) {
    if (n.opType === "Identity" && statics.has(n.inputs[0])) statics.set(n.outputs[0], statics.get(n.inputs[0]));
  }

  // Float statics become tf tensors once, outside any tidy, and live until dispose().
  const constTensors = new Map();
  let paramCount = 0;
  for (const [name, t] of statics) {
    if (t.dataType === "float32" || t.dataType === "float64") {
      constTensors.set(name, tf.tensor(t.data, t.dims, "float32"));
      if (graph.initializers.has(name)) paramCount += t.data.length;
    }
  }

  const order = topoSort(
    graph.nodes.filter((n) => n.opType !== "Constant"),
    [inputInfo.name, ...statics.keys()],
  );

  function staticInts(name, what) {
    const t = statics.get(name);
    if (!t) {
      throw new Error(`${what} must be a constant in the model (dynamic shapes are not supported).`);
    }
    return Array.from(t.data, Number);
  }

  function run(xFlat) {
    const batch = xFlat.shape[0];
    const env = new Map(constTensors);
    env.set(inputInfo.name, tf.reshape(xFlat, [batch, ...layout.featureShape]));
    const get = (name) => {
      const v = env.get(name);
      if (!v) throw new Error(`Value "${name}" is not a float tensor at runtime.`);
      return v;
    };

    for (const node of order) {
      const a = node.attrs;
      const x = () => get(node.inputs[0]);
      let y;
      switch (node.opType) {
        case "Identity":
          y = x();
          break;
        case "Add":
          y = tf.add(x(), get(node.inputs[1]));
          break;
        case "Sub":
          y = tf.sub(x(), get(node.inputs[1]));
          break;
        case "Mul":
          y = tf.mul(x(), get(node.inputs[1]));
          break;
        case "Div":
          y = tf.div(x(), get(node.inputs[1]));
          break;
        case "Relu":
          y = tf.relu(x());
          break;
        case "Sigmoid":
          y = tf.sigmoid(x());
          break;
        case "Tanh":
          y = tf.tanh(x());
          break;
        case "Flatten": {
          const t = x();
          let axis = a.axis ?? 1;
          if (axis < 0) axis += t.rank;
          const outer = prod(t.shape.slice(0, axis));
          y = tf.reshape(t, [outer, prod(t.shape.slice(axis))]);
          break;
        }
        case "Reshape": {
          const t = x();
          const target = opset >= 5 ? staticInts(node.inputs[1], "Reshape's shape input") : a.shape.slice();
          if (a.allowzero === 1 && target.includes(0)) {
            throw new Error("Reshape with allowzero=1 and a zero dimension is not supported.");
          }
          const resolved = target.map((d, i) => (d === 0 ? t.shape[i] : d));
          // A leading 1 in the target is the model's batch dimension.
          if (resolved[0] === 1 && t.shape[0] === batch && batch !== 1) resolved[0] = batch;
          y = tf.reshape(t, resolved);
          break;
        }
        case "MatMul": {
          const A = x();
          const B = get(node.inputs[1]);
          if (B.rank === 1) {
            y = tf.squeeze(matMulND(tf, A, tf.reshape(B, [B.shape[0], 1])), [A.rank - 1]);
          } else {
            y = matMulND(tf, A, B);
          }
          break;
        }
        case "Gemm": {
          const A = x();
          const B = get(node.inputs[1]);
          let out = tf.matMul(A, B, a.transA === 1, a.transB === 1);
          const alpha = a.alpha ?? 1;
          if (alpha !== 1) out = tf.mul(out, alpha);
          if (node.inputs[2]) {
            const beta = a.beta ?? 1;
            const C = get(node.inputs[2]);
            out = tf.add(out, beta === 1 ? C : tf.mul(C, beta));
          }
          y = out;
          break;
        }
        default:
          throw new Error(`Unsupported operator ${node.opType}.`);
      }
      env.set(node.outputs[0], y);
    }

    const out = env.get(outputInfo.name);
    if (!out) {
      throw new Error(`Output "${outputInfo.name}" was never computed.`);
    }
    if (out.size % batch !== 0 || out.shape[0] !== batch) {
      throw new Error(
        `The model's output has shape [${out.shape}] for a batch of ${batch}; it does not keep the batch dimension, so it cannot be batched.`,
      );
    }
    return tf.reshape(out, [batch, out.size / batch]);
  }

  // Work out the output size by running one sample.
  const outputSize = tf.tidy(() => run(tf.zeros([1, layout.size])).shape[1]);

  return {
    inputName: inputInfo.name,
    declaredInputShape: inputInfo.shape,
    ortInputShape: layout.ortShape,
    featureShape: layout.featureShape,
    inputSize: layout.size,
    outputName: outputInfo.name,
    extraOutputs: graph.outputs.slice(1).map((o) => o.name),
    outputSize,
    opset,
    paramCount,
    opCounts: graph.nodes.reduce((acc, n) => ({ ...acc, [n.opType]: (acc[n.opType] ?? 0) + 1 }), {}),
    /** xFlat: tf.Tensor2D [B, inputSize] -> tf.Tensor2D [B, outputSize]. Call inside tf.tidy. */
    forward: run,
    dispose() {
      constTensors.forEach((t) => t.dispose());
    },
  };
}

function matMulND(tf, A, B) {
  if (A.rank === 2 && B.rank === 2) return tf.matMul(A, B);
  if (B.rank === 2) {
    const lead = A.shape.slice(0, -1);
    const flat = tf.reshape(A, [-1, A.shape[A.rank - 1]]);
    return tf.reshape(tf.matMul(flat, B), [...lead, B.shape[1]]);
  }
  return tf.matMul(A, B);
}
