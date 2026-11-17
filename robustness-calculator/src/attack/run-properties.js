// Property sets: each property is an input box (or several) plus an unsafe
// condition on the outputs, as in a VNNLIB file. Every property is first
// bounded with CROWN; regions it cannot prove safe are attacked, and every
// counterexample is re-checked with onnxruntime-web in float64.
//
// A region is proven safe when every unsafe case (a conjunction of linear
// conditions a·y − b ≤ 0) contains a condition whose CROWN lower bound on
// a·y − b is positive (beyond the float32 tolerance), i.e. cannot hold.

import { makeBox, sampleBox32, boxContains } from "./box.js";
import { deriveRng } from "./rng.js";
import { runVnnlibCheck } from "./run-vnnlib.js";
import { selfTest } from "../check/ort-check.js";
import { crownLowerBounds, intervalLowerBounds, toleranceFor, chainForward, FLOAT_TOLERANCE } from "../bounds/crown.js";
import { regionViolated64, regionMargin64, formatCounterexample } from "../spec/vnnlib.js";

/** Input splitting is used for regions with at most this many varying inputs. */
export const SPLIT_MAX_INPUTS = 4;
/** Budget for input splitting, per region (pieces, not time, so results do not depend on the machine). */
export const SPLIT_MAX_PIECES = 10000;
import { disclaimerFor } from "./report.js";

/** Smallest certified slack of a region (> 0 means proven safe) from CROWN. */
function certifyRegion(chain, region, numOutputs, measuredError) {
  const atoms = region.disjuncts.flatMap((d) => d.atoms);
  if (!atoms.length || region.disjuncts.some((d) => d.atoms.length === 0)) return { slack: -Infinity, safe: false };
  const C = new Float64Array(atoms.length * numOutputs);
  atoms.forEach((atom, r) => C.set(atom.a, r * numOutputs));
  // Cheap interval bounds first; CROWN only if they do not settle the region.
  const ib = intervalLowerBounds(chain, region.lo, region.hi, C, atoms.length);
  const quick = evaluate(region, ib, measuredError);
  if (quick.safe) return quick;
  const cb = crownLowerBounds(chain, region.lo, region.hi, C, atoms.length);
  return evaluate(region, cb.map((v, i) => Math.max(v, ib[i])), measuredError); // both are sound
}

function evaluate(region, lb, measuredError) {
  let k = 0;
  let slack = Infinity;
  let safe = true;
  for (const d of region.disjuncts) {
    // The case is impossible if one of its conditions provably fails.
    let best = -Infinity;
    let blocked = false;
    for (const atom of d.atoms) {
      const s = lb[k++] - atom.b;
      best = Math.max(best, s);
      if (s > toleranceFor(atom.b, measuredError)) blocked = true;
    }
    slack = Math.min(slack, best);
    if (!blocked) safe = false;
  }
  return { slack, safe };
}

/**
 * Low-dimensional regions: split the box (widest varying input first) until
 * every piece is proven safe, a piece's centre is a counterexample (re-checked
 * with onnxruntime), or SPLIT_MAX_PIECES pieces have been examined.
 */
async function splitSearch(chain, checker, region, numOutputs, measuredError) {
  const varying = [];
  for (let i = 0; i < region.lo.length; i++) if (region.hi[i] > region.lo[i]) varying.push(i);
  const box = makeBox(region.lo, region.hi);
  const stack = [[Float64Array.from(region.lo), Float64Array.from(region.hi)]];
  let pieces = 0;
  while (stack.length) {
    if (pieces >= SPLIT_MAX_PIECES) return { status: "unknown", pieces };
    const [lo, hi] = stack.pop();
    pieces++;
    const sub = { ...region, lo, hi };
    if (certifyRegion(chain, sub, numOutputs, measuredError).safe) continue;
    const centre = Float32Array.from(lo, (v, i) => 0.5 * (v + hi[i]));
    if (boxContains(box, centre) && regionViolated64(region, chainForward(chain, centre))) {
      const y = await checker.evaluate(centre);
      if (regionViolated64(region, y)) {
        const x = Array.from(centre);
        return { status: "counterexample", pieces, counterexample: { x, y: Array.from(y), margin: regionMargin64(region, y), text: formatCounterexample(x, y) } };
      }
    }
    let k = varying[0];
    let widest = -1;
    for (const i of varying) {
      const w = (hi[i] - lo[i]) / (region.hi[i] - region.lo[i]);
      if (w > widest) {
        widest = w;
        k = i;
      }
    }
    if (widest < 1e-9) continue;
    const mid = 0.5 * (lo[k] + hi[k]);
    const hiA = hi.slice();
    hiA[k] = mid;
    const loB = lo.slice();
    loB[k] = mid;
    stack.push([lo, hiA], [loB, hi]);
  }
  return { status: "certified", pieces };
}

/**
 * @param properties  [{ name, spec }] with spec from parseVnnlib()
 * @param chain       CROWN layer chain, or null (attack only)
 */
export async function runPropertySet({ tf, model, checker, properties, settings, chain = null, chainError = null, onProgress = () => {} }) {
  const t0 = performance.now();
  const certify = settings.certify !== false && chain !== null;

  for (const { name, spec } of properties) {
    if (spec.numInputs !== model.inputSize || spec.numOutputs !== model.outputSize) {
      throw new Error(`${name}: ${spec.numInputs} inputs and ${spec.numOutputs} outputs, but the model has ${model.inputSize} and ${model.outputSize}.`);
    }
  }

  // One self-test over all property boxes.
  onProgress({ phase: "self-test" });
  const boxes = properties.flatMap(({ spec }) => spec.regions.map((r) => makeBox(r.lo, r.hi)));
  const testRng = deriveRng(settings.seed, 1);
  const test = boxes.length
    ? await selfTest(tf, model, checker, (i) => sampleBox32(boxes[i % boxes.length], testRng), { count: settings.selfTestSamples ?? 100 })
    : null;

  const rows = [];
  for (const [index, { name, spec }] of properties.entries()) {
    const row = { index, name, regions: spec.regions.length };
    if (!spec.regions.length) {
      // Empty input set: nothing can be unsafe.
      Object.assign(row, { status: "certified", certifiedSlack: Infinity });
      rows.push(row);
      continue;
    }

    let open = spec.regions;
    if (certify) {
      onProgress({ phase: "certify", point: index, points: properties.length, unit: "property" });
      const results = spec.regions.map((r) => certifyRegion(chain, r, spec.numOutputs, test?.maxAbsError ?? 0));
      row.certifiedSlack = Math.min(...results.map((r) => r.slack));
      open = spec.regions.filter((_, i) => !results[i].safe);

      // Low-dimensional regions: refine by splitting the input box.
      const stillOpen = [];
      for (const region of open) {
        const varying = region.lo.filter((l, i) => region.hi[i] > l).length;
        if (varying === 0 || varying > SPLIT_MAX_INPUTS) {
          stillOpen.push(region);
          continue;
        }
        onProgress({ phase: "certify", point: index, points: properties.length, unit: "property" });
        const r = await splitSearch(chain, checker, region, spec.numOutputs, test?.maxAbsError ?? 0);
        row.splitPieces = (row.splitPieces ?? 0) + r.pieces;
        if (r.status === "counterexample") {
          row.counterexample = r.counterexample;
          break;
        }
        if (r.status === "certified") row.certifiedBySplitting = true;
        else stillOpen.push(region);
      }
      if (row.counterexample) {
        row.status = "counterexample";
        rows.push(row);
        continue;
      }
      open = stillOpen;
    }
    if (!open.length) {
      row.status = "certified";
      rows.push(row);
      continue;
    }

    const r = await runVnnlibCheck({
      tf,
      model,
      checker,
      spec: { ...spec, regions: open },
      settings: { ...settings, selfTestSamples: 0 },
      onProgress: (p) => onProgress({ ...p, point: index, points: properties.length }),
    });
    row.bestMargin = r.bestMargin;
    row.spurious = r.spuriousCandidates;
    if (r.counterexample) {
      row.status = "counterexample";
      row.counterexample = r.counterexample;
    } else {
      row.status = "unknown";
    }
    rows.push(row);
  }

  const count = (s) => rows.filter((r) => r.status === s).length;
  const result = {
    mode: "properties",
    task: "properties",
    rows,
    summary: {
      certification: certify ? "crown" : settings.certify !== false ? "unavailable" : "off",
      certificationNote: chainError,
      certifiedCount: count("certified"),
      counterexampleCount: count("counterexample"),
      unknownCount: count("unknown"),
    },
    timeMs: performance.now() - t0,
    selfTest: test ?? { count: 0, maxRelError: 0, maxAbsError: 0, tolerance: 0, ok: true },
    settings: { ...settings, certify, floatTolerance: certify ? FLOAT_TOLERANCE : undefined },
  };
  result.disclaimer = disclaimerFor(result);
  return result;
}
