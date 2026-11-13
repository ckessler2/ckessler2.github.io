// Independent forward pass with onnxruntime-web. It runs the original ONNX
// model, untouched by our translator, one sample at a time. Every
// counterexample is re-evaluated here (and its constraint re-checked in
// float64) before it is reported.

// onnxruntime's wasm build sometimes throws a bare number (a C++ exception pointer).
function ortError(err, what) {
  if (err instanceof Error) return new Error(`onnxruntime-web could not ${what}: ${err.message}`);
  return new Error(`onnxruntime-web could not ${what} (internal error ${String(err)}). The model may be invalid.`);
}

export async function createOrtChecker(ort, bytes, model) {
  let session;
  try {
    session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  } catch (err) {
    throw ortError(err, "load the model");
  }
  return {
    /** x: Float32Array (one sample, flattened) -> Float64Array of outputs. */
    async evaluate(x) {
      const feeds = {
        [model.inputName]: new ort.Tensor("float32", Float32Array.from(x), model.ortInputShape),
      };
      let out;
      try {
        out = await session.run(feeds, [model.outputName]);
      } catch (err) {
        throw ortError(err, "run the model");
      }
      return Float64Array.from(out[model.outputName].data);
    },
    async dispose() {
      await session.release?.();
    },
  };
}

/**
 * Compare the tf.js translation with onnxruntime on `count` sample inputs.
 * Error per output = |tf - ort| / max_j |ort_j| (relative to the size of that
 * sample's output vector, so outputs near zero do not inflate it).
 *
 * Default tolerance 1e-4: both libraries compute in float32 but accumulate in
 * different orders. On the ACAS Xu networks onnxruntime itself is up to
 * 1.7e-5 away from an exact float64 forward pass (tf.js: 3.8e-6), while a
 * genuine translation bug (wrong transpose, broadcast, operator) gives errors
 * of order 1.
 */
export async function selfTest(tf, model, checker, sample, { count = 100, tolerance = 1e-4 } = {}) {
  const n = model.inputSize;
  const xs = new Float32Array(count * n);
  for (let i = 0; i < count; i++) xs.set(sample(i), i * n);
  const yTf = tf.tidy(() => model.forward(tf.tensor2d(xs, [count, n])).dataSync());
  const m = model.outputSize;

  let maxRel = 0;
  let maxAbs = 0;
  for (let i = 0; i < count; i++) {
    const yOrt = await checker.evaluate(xs.subarray(i * n, (i + 1) * n));
    if (yOrt.length !== m) {
      throw new Error(`onnxruntime returned ${yOrt.length} outputs but the translation gives ${m}.`);
    }
    let scale = 0;
    for (let j = 0; j < m; j++) scale = Math.max(scale, Math.abs(yOrt[j]));
    scale = Math.max(scale, 1e-12);
    for (let j = 0; j < m; j++) {
      const abs = Math.abs(yTf[i * m + j] - yOrt[j]);
      maxAbs = Math.max(maxAbs, abs);
      maxRel = Math.max(maxRel, abs / scale);
    }
  }
  return { count, maxRelError: maxRel, maxAbsError: maxAbs, tolerance, ok: maxRel <= tolerance };
}
