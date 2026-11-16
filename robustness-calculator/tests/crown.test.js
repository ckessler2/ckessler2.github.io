// CROWN lower bounds must be sound (never above any achievable margin) and
// must never certify a point that exact branch and bound shows is not robust.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReluChain, crownMarginLowerBound } from "../src/bounds/crown.js";
import { parseOnnxModel } from "../src/onnx/onnx-model.js";
import { readMlp, exactRobust, margin } from "./helpers/exact-bab.js";
import { buildToyClassifier } from "./helpers/toy-classifier.js";
import { createRng } from "../src/attack/rng.js";

const { bytes, points } = buildToyClassifier();
const layers = buildReluChain(parseOnnxModel(bytes), [2]);
const mlp = readMlp(bytes);

test("CROWN bounds are sound and never certify a non-robust point (toy classifier, exact ground truth)", () => {
  const rng = createRng(3);
  let certified = 0;
  let robust = 0;
  for (const eps of [0.02, 0.05, 0.1, 0.2]) {
    points.inputs.forEach((x, i) => {
      const label = points.labels[i];
      const lo = x.map((v) => v - eps);
      const hi = x.map((v) => v + eps);
      const lb = crownMarginLowerBound(layers, lo, hi, label);
      // Sound: no point in the box has a smaller margin than the bound.
      for (let s = 0; s < 200; s++) {
        const p = lo.map((l, k) => l + rng() * (hi[k] - l));
        assert.ok(lb <= margin(mlp, p, label) + 1e-9, `point ${i}, eps ${eps}: bound ${lb} above a sampled margin`);
      }
      assert.ok(lb <= margin(mlp, x, label) + 1e-9);
      const truth = exactRobust(mlp, x, label, eps);
      if (lb > 0) {
        certified++;
        assert.equal(truth.robust, true, `point ${i}, eps ${eps}: certified but not robust`);
      }
      if (truth.robust) robust++;
    });
  }
  console.log(`  CROWN certified ${certified} of ${robust} truly robust (point, ε) pairs.`);
  assert.ok(certified > 0);
});

test("chain extraction folds normalisation and reshapes, and matches onnxruntime", async () => {
  const { tf, load } = await import("./helpers/setup.js");
  const { model: writeModel, node, tensor } = await import("./helpers/onnx-writer.js");
  // (x − mean) / std → Flatten → MatMul → Add → Relu → Gemm(transB) → Mul(2)
  const bytes = writeModel({
    nodes: [
      node("Sub", ["x", "mean"], ["a"]),
      node("Div", ["a", "std"], ["b"]),
      node("Flatten", ["b"], ["c"], { axis: 1 }),
      node("MatMul", ["c", "W1"], ["d"]),
      node("Add", ["d", "b1"], ["e"]),
      node("Relu", ["e"], ["f"]),
      node("Gemm", ["f", "W2", "b2"], ["g"], { transB: 1 }),
      node("Mul", ["g", "k"], ["y"]),
    ],
    initializers: [
      tensor("mean", [1, 1, 3], [0.1, -0.2, 0.3]),
      tensor("std", [3], [2, 0.5, 1]),
      tensor("W1", [3, 4], Array.from({ length: 12 }, (_, i) => Math.sin(i + 1))),
      tensor("b1", [4], [0.1, -0.1, 0.2, 0]),
      tensor("W2", [2, 4], Array.from({ length: 8 }, (_, i) => Math.cos(i))),
      tensor("b2", [2], [0.5, -0.5]),
      tensor("k", [1], [2]),
    ],
    input: ["x", [1, 1, 3]],
    output: ["y", [1, 2]],
  });
  const { model: m, checker } = await load(bytes);
  const chain = buildReluChain(parseOnnxModel(bytes), m.featureShape);
  assert.equal(chain.error, undefined);
  assert.deepEqual(chain.layers.map((l) => [l.nin, l.nout]), [[3, 4], [4, 2]]);
  const rng = createRng(5);
  for (let t = 0; t < 10; t++) {
    const x = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
    let h = x;
    chain.layers.forEach((L, k) => {
      const o = Array.from({ length: L.nout }, (_, r) => L.b[r] + h.reduce((s, v, i) => s + v * L.W[r * L.nin + i], 0));
      h = k < chain.layers.length - 1 ? o.map((v) => Math.max(0, v)) : o;
    });
    const ref = await checker.evaluate(Float32Array.from(x));
    h.forEach((v, j) => assert.ok(Math.abs(v - ref[j]) < 1e-5, `${v} vs ${ref[j]}`));
    // A box of zero width: the bound equals the true margin.
    const lb = crownMarginLowerBound(chain, x, x, 0);
    assert.ok(Math.abs(lb - (h[0] - h[1])) < 1e-9);
  }
  void tf;
});

test("models the certifier cannot handle are reported, not mis-bounded", async () => {
  const { model: writeModel, node, tensor } = await import("./helpers/onnx-writer.js");
  const bytes = writeModel({
    nodes: [node("MatMul", ["x", "W"], ["a"]), node("Tanh", ["a"], ["y"])],
    initializers: [tensor("W", [2, 2], [1, 0, 0, 1])],
    input: ["x", [1, 2]],
    output: ["y", [1, 2]],
  });
  const r = buildReluChain(parseOnnxModel(bytes), [2]);
  assert.match(r.error, /Tanh/);
});

test("run: certified points skip the attack and are never contradicted by exact ground truth", async () => {
  const { tf, load } = await import("./helpers/setup.js");
  const { runPointsCheck } = await import("../src/attack/run-points.js");
  const { model: m, checker } = await load(bytes);
  const eps = 0.1;
  const r = await runPointsCheck({
    tf, model: m, checker, points, chain: layers,
    settings: { task: "classification", epsilon: eps, seed: 0, restarts: 10, steps: 50, schedule: "apgd", selfTestSamples: 5, searchEpsilon: true, searchIterations: 10 },
  });
  let certified = 0;
  r.rows.forEach((row, i) => {
    const truth = exactRobust(mlp, points.inputs[i], points.labels[i], eps);
    if (row.status === "certified") {
      certified++;
      assert.equal(truth.robust, true);
      assert.equal(row.bestMargin, undefined, "certified points should not be attacked");
    }
    if (row.status === "counterexample") assert.equal(truth.robust, false);
    // Certified radius (lower) never exceeds the breaking ε found by the attack (upper).
    if (Number.isFinite(row.smallestEpsilon)) assert.ok(row.certifiedRadius <= row.smallestEpsilon);
  });
  assert.equal(r.summary.certifiedCount, certified);
  assert.ok(r.summary.robustAccuracyLowerBound <= r.summary.robustAccuracyUpperBound);
});
