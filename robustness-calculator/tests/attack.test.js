import { test } from "node:test";
import assert from "node:assert/strict";
import { tf, load } from "./helpers/setup.js";
import { model, node, tensor } from "./helpers/onnx-writer.js";
import { parseVnnlib } from "../src/spec/vnnlib.js";
import { runVnnlibCheck } from "../src/attack/run-vnnlib.js";
import { runPointsCheck } from "../src/attack/run-points.js";
import { createRng } from "../src/attack/rng.js";

const settings = { seed: 7, restarts: 20, steps: 50, selfTestSamples: 20 };

// y0 = relu(x0 - x1): on [0,1]^2 its maximum is exactly 1, at (1, 0).
const reluDiff = model({
  nodes: [node("MatMul", ["x", "W"], ["d"]), node("Relu", ["d"], ["y"])],
  initializers: [tensor("W", [2, 1], [1, -1])],
  input: ["x", [1, 2]],
  output: ["y", [1, 1]],
});

const prop = (body, x0 = [0, 1], x1 = [0, 1]) => `
(declare-const X_0 Real) (declare-const X_1 Real) (declare-const Y_0 Real)
(assert (>= X_0 ${x0[0]})) (assert (<= X_0 ${x0[1]}))
(assert (>= X_1 ${x1[0]})) (assert (<= X_1 ${x1[1]}))
${body}`;

async function check(bytes, vnnlib, s = settings) {
  const { model: m, checker } = await load(bytes);
  return runVnnlibCheck({ tf, model: m, checker, spec: parseVnnlib(vnnlib), settings: s });
}

test("finds a counterexample that exists, and it really violates the property", async () => {
  const r = await check(reluDiff, prop("(assert (>= Y_0 0.9))"));
  assert.equal(r.verdict, "sat");
  const [x0, x1] = r.counterexample.x;
  assert.ok(x0 - x1 >= 0.9, `x0 - x1 = ${x0 - x1}`);
  assert.ok(r.counterexample.y[0] >= 0.9);
  assert.ok(r.selfTest.ok);
  assert.match(r.counterexample.text, /^sat\n\(\(X_0 /);
});

test("finds a counterexample confined to a tiny corner of the box", async () => {
  const r = await check(reluDiff, prop("(assert (>= Y_0 0.999))"));
  assert.equal(r.verdict, "sat");
});

test("soundness: never reports a counterexample when none exists", async () => {
  // max y0 on the box is exactly 1, so these are unsat.
  for (const body of ["(assert (>= Y_0 1.0001))", "(assert (> Y_0 1))"]) {
    const r = await check(reluDiff, prop(body));
    assert.equal(r.verdict, "unknown", body);
    assert.equal(r.counterexample, null);
    assert.ok(r.bestMargin >= 0, `best margin ${r.bestMargin}`);
  }
  // Restricting the box: max is 0.5 when x0 <= 0.5.
  const r = await check(reluDiff, prop("(assert (>= Y_0 0.6))", [0, 0.5]));
  assert.equal(r.verdict, "unknown");
  assert.ok(Math.abs(r.bestMargin - 0.1) < 1e-6, `best margin ${r.bestMargin}`);
});

test("box bounds that are not float32 values are respected exactly", async () => {
  // The upper bound 0.6 rounds UP to float32 (0.60000002...). Counterexamples must stay <= 0.6.
  const r = await check(reluDiff, prop("(assert (>= Y_0 0.59))", [0, 0.6]));
  assert.equal(r.verdict, "sat");
  assert.ok(r.counterexample.x[0] <= 0.6);
  // y0 = 0.6 needs x0 = 0.6 exactly, which is not a float32 value: the largest
  // float32 input is 0.59999996, so no float32 counterexample exists.
  const edge = await check(reluDiff, prop("(assert (>= Y_0 0.6))", [0, 0.6]));
  assert.equal(edge.verdict, "unknown");
});

test("same seed gives identical results; a different seed still finds the counterexample", async () => {
  const p = prop("(assert (>= Y_0 0.95))");
  const s = { ...settings, restarts: 5, steps: 10 };
  const a = await check(reluDiff, p, s);
  const b = await check(reluDiff, p, s);
  assert.deepEqual(a.counterexample, b.counterexample);
  assert.equal(a.bestMargin, b.bestMargin);
  const c = await check(reluDiff, p, { ...s, seed: 12345 });
  assert.equal(c.verdict, "sat");
});

test("rng is deterministic per seed", () => {
  const a = createRng(42);
  const b = createRng(42);
  const c = createRng(43);
  const sa = Array.from({ length: 5 }, a);
  assert.deepEqual(sa, Array.from({ length: 5 }, b));
  assert.notDeepEqual(sa, Array.from({ length: 5 }, c));
  sa.forEach((v) => assert.ok(v >= 0 && v < 1));
});

// Two logits z0 = x0, z1 = x1. At (0.6, 0.4), label 0, the margin is 0.2 and
// the L∞ attack lowers it by 2ε, so the smallest breaking ε is exactly 0.1.
const identity2 = model({
  nodes: [node("Identity", ["x"], ["y"])],
  input: ["x", [1, 2]],
  output: ["y", [1, 2]],
});

test("classification: robust accuracy and smallest ε match the hand calculation", async () => {
  const { model: m, checker } = await load(identity2);
  const points = { inputs: [[0.6, 0.4], [0.3, 0.7], [0.9, 0.1]], labels: [0, 0, 0] };
  const r = await runPointsCheck({
    tf,
    model: m,
    checker,
    points,
    settings: { ...settings, task: "classification", epsilon: 0.15, searchEpsilon: true, searchIterations: 10 },
  });
  const [p0, p1, p2] = r.rows;
  assert.equal(p0.broken, true);
  assert.ok(p0.smallestEpsilon >= 0.1 && p0.smallestEpsilon < 0.1 + 0.15 / 2 ** 9, `ε = ${p0.smallestEpsilon}`);
  assert.equal(p1.cleanCorrect, false);
  assert.equal(p1.smallestEpsilon, 0);
  assert.equal(p2.broken, false); // margin 0.8 needs ε > 0.4
  assert.equal(p2.smallestEpsilon, Infinity);
  assert.equal(r.summary.cleanAccuracy, 2 / 3);
  assert.equal(r.summary.robustAccuracyUpperBound, 1 / 3);
});

// y = 3·x0 - x1. Around (0,0) with ε = 0.1 the largest deviation is 0.4,
// and the L∞→L∞ Lipschitz constant is 4.
const linear = model({
  nodes: [node("MatMul", ["x", "W"], ["y"])],
  initializers: [tensor("W", [2, 1], [3, -1])],
  input: ["x", [1, 2]],
  output: ["y", [1, 1]],
});

test("regression: maximum deviation and Lipschitz lower bound match the hand calculation", async () => {
  const { model: m, checker } = await load(linear);
  const points = { inputs: [[0, 0]], labels: null };
  const std = await runPointsCheck({
    tf, model: m, checker, points,
    settings: { ...settings, task: "regression-standard", epsilon: 0.1, delta: 0.3 },
  });
  const dev = std.rows[0].maxDeviation;
  assert.ok(dev <= 0.4 + 1e-6 && dev > 0.4 - 1e-4, `deviation ${dev}`);
  assert.equal(std.rows[0].pass, false);

  const lip = await runPointsCheck({
    tf, model: m, checker, points,
    settings: { ...settings, task: "regression-lipschitz", epsilon: 0.1, lipschitz: 5 },
  });
  const L = lip.rows[0].lipschitzLowerBound;
  assert.ok(L <= 4 * (1 + 1e-5) && L > 3.9, `L ≥ ${L}`);
  assert.equal(lip.rows[0].pass, true);
});

test("shipped examples: sat example is found, unsat example is never reported sat", async () => {
  const { readFileSync } = await import("node:fs");
  const ex = (f) => new URL(`../examples/${f}`, import.meta.url);
  const bytes = new Uint8Array(readFileSync(ex("tiny-relu.onnx")));
  const sat = await check(bytes, readFileSync(ex("tiny-relu-sat.vnnlib"), "utf8"), { ...settings, restarts: 100, steps: 100 });
  assert.equal(sat.verdict, "sat");
  const unsat = await check(bytes, readFileSync(ex("tiny-relu-unsat.vnnlib"), "utf8"), { ...settings, restarts: 100, steps: 100 });
  assert.equal(unsat.verdict, "unknown");
});
