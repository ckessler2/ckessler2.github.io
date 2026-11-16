// Compare the tool with exact ground truth on a small seeded classifier
// (2 inputs, so branch and bound settles every point exactly).

import { test } from "node:test";
import assert from "node:assert/strict";
import { tf, load } from "./helpers/setup.js";
import { readMlp, exactRobust, exactMinEpsilon } from "./helpers/exact-bab.js";
import { buildToyClassifier } from "./helpers/toy-classifier.js";
import { runPointsCheck } from "../src/attack/run-points.js";

const { bytes, points } = buildToyClassifier();
const layers = readMlp(bytes);
const settings = { seed: 0, restarts: 100, steps: 100, task: "classification", selfTestSamples: 20 };

for (const schedule of ["constant", "apgd"]) test(`example classifier at ε = 0.1 (${schedule} schedule): every counterexample is real, and every non-robust point is found`, async () => {
  const eps = 0.1;
  const truth = points.inputs.map((x, i) => exactRobust(layers, x, points.labels[i], eps));
  assert.ok(truth.every((t) => t.robust !== null), "ground truth undecided for some point");

  const { model, checker } = await load(bytes);
  const r = await runPointsCheck({ tf, model, checker, points, settings: { ...settings, epsilon: eps, schedule } });

  const nonRobust = truth.filter((t) => t.robust === false).length;
  const found = r.rows.filter((row) => row.broken).length;
  r.rows.forEach((row, i) => {
    if (row.broken) assert.equal(truth[i].robust, false, `point ${i + 1}: tool found a counterexample but the point is provably robust`);
  });
  console.log(`  ε = ${eps}: ${nonRobust} of ${points.inputs.length} points are not robust (exact); the tool found ${found}.`);
  assert.equal(found, nonRobust);
});

test("example classifier: smallest breaking ε from the tool is never below the exact value, and close to it", async () => {
  const epsMax = 0.5;
  const exact = points.inputs.map((x, i) => exactMinEpsilon(layers, x, points.labels[i], epsMax));

  const { model, checker } = await load(bytes);
  const r = await runPointsCheck({
    tf,
    model,
    checker,
    points,
    settings: { ...settings, epsilon: epsMax, searchEpsilon: true, searchIterations: 14 },
  });

  const bisectionWidth = epsMax / 2 ** 14;
  let worstRatio = 1;
  let missed = 0;
  r.rows.forEach((row, i) => {
    const e = exact[i];
    const t = row.smallestEpsilon;
    // Soundness: no counterexample can exist below the true minimum (small float32 slack).
    assert.ok(t >= e - 1e-6, `point ${i + 1}: tool ε ${t} below exact ${e}`);
    if (Number.isFinite(e) && !Number.isFinite(t)) missed++;
    if (Number.isFinite(e) && Number.isFinite(t) && e > 0) worstRatio = Math.max(worstRatio, (t - bisectionWidth) / e);
  });
  const finite = exact.filter(Number.isFinite).length;
  console.log(
    `  ${finite} of ${points.inputs.length} points break below ε = ${epsMax} (exact); the tool missed ${missed}; ` +
      `worst (tool ε − bisection width) / exact ε = ${worstRatio.toFixed(4)}.`,
  );
  assert.equal(missed, 0);
  assert.ok(worstRatio < 1.01, `tool's smallest ε is up to ${worstRatio}× the exact value`);
});
