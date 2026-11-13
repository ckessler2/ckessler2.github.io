// Mode B: robustness around points (classification, or regression with the
// standard / Lipschitz notions). Every number reported per point comes from
// onnxruntime-web outputs evaluated in float64, not from the tf.js attack.

import { makeBox, boxContains, clampToBox32, sampleBox32 } from "./box.js";
import { createRng, deriveRng } from "./rng.js";
import { runPgd, defaultAlpha } from "./pgd.js";
import { createClassificationLoss, createDeviationLoss, createLipschitzLoss } from "./objectives.js";
import { selfTest } from "../check/ort-check.js";
import { epsilonBox, median } from "../spec/points.js";
import { DISCLAIMER } from "./report.js";

const argmax = (y) => y.reduce((best, v, i) => (v > y[best] ? i : best), 0);
const infNorm = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

/** Highest logit other than `label` is strictly above the label's logit. */
function misclassified(y, label) {
  return y.some((v, j) => j !== label && v > y[label]);
}

export async function runPointsCheck({ tf, model, checker, points, settings, onProgress = () => {} }) {
  const t0 = performance.now();
  const { task, epsilon, seed, restarts, steps } = settings;
  const alpha = settings.alpha ?? defaultAlpha(steps);
  const { domainLo = null, domainHi = null } = settings;

  if (!(epsilon > 0)) throw new Error("ε must be a positive number.");

  const n = model.inputSize;
  const boxFor = (x, eps, i) => {
    const { lo, hi } = epsilonBox(x, eps, domainLo, domainHi);
    return makeBox(lo, hi, `Point ${i + 1}`);
  };
  const boxes = points.inputs.map((x, i) => boxFor(x, epsilon, i));
  // The model sees the point as float32; keep it inside its own box.
  const refs = points.inputs.map((x, i) => clampToBox32(boxes[i], Float32Array.from(x)));

  onProgress({ phase: "self-test" });
  const testRng = deriveRng(seed, 1);
  const test = await selfTest(tf, model, checker, (i) => sampleBox32(boxes[i % boxes.length], testRng), {
    count: settings.selfTestSamples ?? 100,
  });

  const rng = createRng(seed);
  const rows = [];

  for (let i = 0; i < points.inputs.length; i++) {
    const progress = (extra) => onProgress({ phase: "attack", point: i, points: points.inputs.length, steps, ...extra });
    const xRef = refs[i];
    const yRefOrt = await checker.evaluate(xRef);
    const row = { index: i };

    if (task === "classification") {
      const label = points.labels[i];
      if (label >= model.outputSize) throw new Error(`Point ${i + 1}: label ${label} but the model has ${model.outputSize} outputs.`);
      row.label = label;
      row.cleanPrediction = argmax(yRefOrt);
      row.cleanCorrect = !misclassified(yRefOrt, label) && row.cleanPrediction === label;

      if (!row.cleanCorrect) {
        row.broken = true;
        row.smallestEpsilon = 0;
        row.counterexample = { x: Array.from(xRef), y: Array.from(yRefOrt) };
        row.note = "misclassified without perturbation";
        rows.push(row);
        continue;
      }

      const attack = async (eps, box) => {
        const loss = createClassificationLoss(tf, label, model.outputSize);
        let found = null;
        try {
          const res = await runPgd(tf, {
            forward: model.forward,
            lossFn: loss.lossFn,
            box,
            restarts,
            steps,
            alpha,
            rng,
            isCandidate: (m) => m < 0,
            onCandidate: async (x32) => {
              const x = clampToBox32(box, x32);
              if (!boxContains(box, x)) return false;
              const y = await checker.evaluate(x);
              if (!misclassified(y, label)) return false;
              found = { x: Array.from(x), y: Array.from(y), prediction: argmax(y), epsilon: eps };
              return true;
            },
            onStep: (step, best) => progress({ step, epsilon: eps, best }),
          });
          return { found, bestMargin: res.bestLoss, spurious: res.spurious };
        } finally {
          loss.dispose();
        }
      };

      const first = await attack(epsilon, boxes[i]);
      row.bestMargin = first.bestMargin;
      row.spurious = first.spurious;
      row.broken = Boolean(first.found);
      row.counterexample = first.found;
      row.smallestEpsilon = first.found ? epsilon : Infinity;

      if (first.found && settings.searchEpsilon) {
        let lo = 0;
        let hi = epsilon;
        for (let it = 0; it < (settings.searchIterations ?? 8); it++) {
          const mid = 0.5 * (lo + hi);
          const r = await attack(mid, boxFor(points.inputs[i], mid, i));
          row.spurious += r.spurious;
          if (r.found) {
            hi = mid;
            row.counterexample = r.found;
          } else {
            lo = mid;
          }
        }
        row.smallestEpsilon = hi;
      }
    } else {
      const lipschitz = task === "regression-lipschitz";
      const yRefTf = tf.tidy(() => model.forward(tf.tensor2d(xRef, [1, n])).dataSync());
      const minDist = 0.01 * epsilon;
      const loss = lipschitz
        ? createLipschitzLoss(tf, xRef, yRefTf, minDist)
        : createDeviationLoss(tf, yRefTf);
      let res;
      try {
        res = await runPgd(tf, {
          forward: model.forward,
          lossFn: loss.lossFn,
          box: boxes[i],
          restarts,
          steps,
          alpha,
          rng,
          includeCentre: !lipschitz,
          onStep: (step, best) => progress({ step, best }),
        });
      } finally {
        loss.dispose();
      }
      const x = clampToBox32(boxes[i], res.bestX);
      const y = await checker.evaluate(x);
      const deviation = infNorm(y, yRefOrt);
      const distance = infNorm(x, xRef);
      row.maxDeviation = deviation;
      row.distance = distance;
      row.counterexample = { x: Array.from(x), y: Array.from(y) };
      if (lipschitz) {
        row.lipschitzLowerBound = deviation / Math.max(distance, minDist);
        if (settings.lipschitz != null) row.pass = !(row.lipschitzLowerBound > settings.lipschitz);
      } else if (settings.delta != null) {
        row.pass = !(deviation > settings.delta);
      }
    }
    rows.push(row);
  }

  const N = rows.length;
  const summary = {};
  if (task === "classification") {
    summary.cleanAccuracy = rows.filter((r) => r.cleanCorrect).length / N;
    summary.robustAccuracyUpperBound = rows.filter((r) => r.cleanCorrect && !r.broken).length / N;
    summary.brokenCount = rows.filter((r) => r.broken).length;
    summary.medianSmallestEpsilon = settings.searchEpsilon ? median(rows.map((r) => r.smallestEpsilon)) : null;
  } else {
    const key = task === "regression-lipschitz" ? "lipschitzLowerBound" : "maxDeviation";
    summary.maxValue = Math.max(...rows.map((r) => r[key]));
    summary.medianValue = median(rows.map((r) => r[key]));
    if (rows.some((r) => r.pass !== undefined)) {
      summary.passCount = rows.filter((r) => r.pass).length;
      summary.failCount = rows.filter((r) => r.pass === false).length;
    }
  }

  return {
    mode: "points",
    task,
    rows,
    summary,
    timeMs: performance.now() - t0,
    selfTest: test,
    settings: { ...settings, alpha },
    disclaimer: DISCLAIMER,
  };
}
