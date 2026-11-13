// Mode A: falsify a VNNLIB property with PGD, re-checking every candidate
// counterexample with onnxruntime-web and float64 arithmetic.

import { makeBox, boxContains, clampToBox32, boxCentre32, sampleBox32 } from "./box.js";
import { createRng, deriveRng } from "./rng.js";
import { runPgd, defaultAlpha } from "./pgd.js";
import { createRegionMarginLoss } from "./objectives.js";
import { selfTest } from "../check/ort-check.js";
import { regionMargin64, regionViolated64, formatCounterexample } from "../spec/vnnlib.js";
import { DISCLAIMER } from "./report.js";

export async function runVnnlibCheck({ tf, model, checker, spec, settings, onProgress = () => {} }) {
  const t0 = performance.now();
  const { seed, restarts, steps } = settings;
  const alpha = settings.alpha ?? defaultAlpha(steps);

  if (spec.numInputs !== model.inputSize) {
    throw new Error(`The property declares ${spec.numInputs} inputs (X_i) but the model takes ${model.inputSize}.`);
  }
  if (spec.numOutputs !== model.outputSize) {
    throw new Error(`The property declares ${spec.numOutputs} outputs (Y_j) but the model produces ${model.outputSize}.`);
  }
  if (!spec.regions.length) {
    throw new Error("The property's input region is empty, so it is trivially unsat; there is nothing to attack.");
  }

  const boxes = spec.regions.map((r, i) => makeBox(r.lo, r.hi, spec.regions.length > 1 ? `Input region ${i + 1}` : "Input box"));

  onProgress({ phase: "self-test" });
  const testRng = deriveRng(seed, 1);
  const test = await selfTest(tf, model, checker, (i) => sampleBox32(boxes[i % boxes.length], testRng), {
    count: settings.selfTestSamples ?? 100,
  });

  const rng = createRng(seed);
  let bestMargin = Infinity;
  let bestRegion = 0;
  let counterexample = null;
  let spurious = 0;

  async function recheck(regionIndex, x32) {
    const region = spec.regions[regionIndex];
    const box = boxes[regionIndex];
    const x = clampToBox32(box, x32);
    if (!boxContains(box, x)) return null;
    const y = await checker.evaluate(x);
    if (!regionViolated64(region, y)) return null;
    return { x: Array.from(x), y: Array.from(y), margin: regionMargin64(region, y), region: regionIndex };
  }

  for (let r = 0; r < spec.regions.length && !counterexample; r++) {
    const region = spec.regions[r];
    const box = boxes[r];

    // A disjunct with no output constraint: every input in the box is unsafe.
    if (region.disjuncts.some((d) => d.atoms.length === 0)) {
      const ce = await recheck(r, boxCentre32(box));
      if (ce) {
        counterexample = ce;
        bestMargin = -Infinity;
        bestRegion = r;
        break;
      }
    }

    const loss = createRegionMarginLoss(tf, region, model.outputSize);
    try {
      const res = await runPgd(tf, {
        forward: model.forward,
        lossFn: loss.lossFn,
        box,
        restarts,
        steps,
        alpha,
        rng,
        isCandidate: (m) => m <= 0,
        onCandidate: async (x) => {
          counterexample = await recheck(r, x);
          return Boolean(counterexample);
        },
        onStep: (step, best) =>
          onProgress({
            phase: "attack",
            region: r,
            regions: spec.regions.length,
            step,
            steps,
            bestMargin: Math.min(bestMargin, best),
          }),
      });
      spurious += res.spurious;
      if (res.bestLoss < bestMargin) {
        bestMargin = res.bestLoss;
        bestRegion = r;
      }
    } finally {
      loss.dispose();
    }
  }

  const timeMs = performance.now() - t0;
  return {
    mode: "vnnlib",
    verdict: counterexample ? "sat" : "unknown",
    verdictText: counterexample
      ? "sat (counterexample found)"
      : `unknown (no counterexample in ${restarts} restarts × ${steps} steps)`,
    bestMargin,
    bestRegion,
    timeMs,
    counterexample: counterexample && {
      ...counterexample,
      text: formatCounterexample(counterexample.x, counterexample.y),
    },
    spuriousCandidates: spurious,
    selfTest: test,
    regions: spec.regions.length,
    settings: { ...settings, alpha },
    disclaimer: DISCLAIMER,
  };
}
