// Projected gradient descent over an input box (L-infinity), following
// Madry et al. (2018): sign-gradient steps, element-wise clamping, random
// restarts batched into one tensor.
//
// Two optional refinements:
//   - copies: every start is repeated `copies` times in the batch, so a loss
//     can give each copy a different objective (e.g. one target class per
//     copy). Row i belongs to copy i % copies.
//   - schedule "apgd": the step-size schedule of APGD (Croce & Hein, 2020):
//     start with a large step, halve it per start at checkpoints when progress
//     stalls (and jump back to that start's best point), with momentum 0.75.
//
// PGD is a falsifier. Finding nothing proves nothing.

import { boxCentre32, sampleBox32 } from "./box.js";

export function defaultAlpha(steps) {
  return 2.5 / steps;
}

/**
 * APGD checkpoints, in whole steps as in the reference implementation: the
 * first gap is ⌊0.22 K⌋, each later gap shrinks by ⌊0.03 K⌋ down to ⌊0.06 K⌋
 * (K = 100 gives 22, 41, 57, 70, 80, 87, 93, 99).
 */
export function apgdCheckpoints(steps) {
  const decrease = Math.max(Math.floor(0.03 * steps), 1);
  const minimum = Math.max(Math.floor(0.06 * steps), 1);
  let gap = Math.max(Math.floor(0.22 * steps), 1);
  const out = [];
  for (let k = gap; k < steps; k += gap) {
    out.push(k);
    gap = Math.max(gap - decrease, minimum);
  }
  return out;
}

/**
 * @param tf        TensorFlow.js namespace
 * @param opts.forward   (x [B,n]) -> y [B,m]
 * @param opts.lossFn    (y, x) -> loss [B], minimised
 * @param opts.box       from makeBox()
 * @param opts.restarts  number of uniform random starting points (R), per copy
 * @param opts.steps     PGD steps per start (K)
 * @param opts.alpha     constant schedule: step size as a fraction of each feature's box width
 * @param opts.schedule  "constant" (default) or "apgd"
 * @param opts.apgdInitial  apgd: initial step as a fraction of the box width (APGD uses 2ε, i.e. 1)
 * @param opts.copies    repeat each start this many times (see above)
 * @param opts.rng       seeded rng
 * @param opts.includeCentre  also start at the box centre
 * @param opts.includeCorner  also start at the corner the centre gradient points to
 * @param opts.isCandidate    (loss) -> bool; when set, candidates go to onCandidate
 * @param opts.onCandidate    async (x Float32Array, loss) -> bool (true = confirmed, stop)
 * @param opts.onStep         (step, bestLoss) -> void
 */
export async function runPgd(tf, opts) {
  const {
    forward,
    lossFn,
    box,
    restarts,
    steps,
    alpha = defaultAlpha(steps),
    schedule = "constant",
    apgdInitial = 1,
    copies = 1,
    rng,
    includeCentre = true,
    includeCorner = true,
    isCandidate = null,
    onCandidate = null,
    onStep = null,
    maxRechecks = 25,
  } = opts;

  const n = box.size;
  const objective = (x) => lossFn(forward(x), x);
  const valueAndGrad = tf.valueAndGrad(objective);

  // Starting points, each block a multiple of `copies` rows so that row i
  // always belongs to copy i % copies.
  const starts = [];
  const centre = boxCentre32(box);
  if (includeCentre) for (let c = 0; c < copies; c++) starts.push(centre);
  if (includeCorner) {
    const g = tf.tidy(() => {
      const xs = tf.tile(tf.tensor2d(centre, [1, n]), [copies, 1]);
      return valueAndGrad(xs, tf.ones([copies])).grad.dataSync();
    });
    for (let c = 0; c < copies; c++) {
      const corner = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const gi = g[c * n + i];
        corner[i] = gi > 0 ? box.lo32[i] : gi < 0 ? box.hi32[i] : centre[i];
      }
      starts.push(corner);
    }
  }
  for (let r = 0; r < restarts * copies; r++) starts.push(sampleBox32(box, rng));

  const B = starts.length;
  const flat = new Float32Array(B * n);
  starts.forEach((s, i) => flat.set(s, i * n));

  const lo = tf.tensor2d(box.lo32, [1, n]);
  const hi = tf.tensor2d(box.hi32, [1, n]);
  const width = tf.sub(hi, lo);
  const ones = tf.ones([B]);
  const clip = (t) => tf.minimum(tf.maximum(t, lo), hi);

  // Per-start step sizes (fractions of the box width).
  const eta = new Float32Array(B).fill(schedule === "apgd" ? apgdInitial : alpha);
  let stepSize = tf.tidy(() => tf.mul(tf.tensor2d(eta, [B, 1]), width));

  let x = tf.tensor2d(flat, [B, n]);
  let xPrev = tf.clone(x);
  let bestXs = tf.clone(x); // per-start best point (apgd)
  const bestLossS = new Float32Array(B).fill(Infinity);
  const prevLoss = new Float32Array(B).fill(Infinity);
  const improvedCount = new Int32Array(B);
  let lastCheckpoint = 0;
  let bestAtCheckpoint = new Float32Array(B).fill(Infinity);
  const reducedAtCheckpoint = new Uint8Array(B);
  const checkpoints = new Set(schedule === "apgd" ? apgdCheckpoints(steps) : []);

  let bestLoss = Infinity;
  let bestX = new Float32Array(starts[0]);
  let confirmed = null;
  let rechecks = 0;
  let spurious = 0;
  let stepsRun = 0;

  const replace = (old, next) => {
    old.dispose();
    return next;
  };

  try {
    for (let k = 0; k <= steps; k++) {
      const { value, grad } = tf.tidy(() => valueAndGrad(x, ones));
      const losses = value.dataSync();
      value.dispose();

      // Per-start bookkeeping.
      const improvedMask = new Uint8Array(B);
      let anyImproved = false;
      let iBest = -1;
      for (let i = 0; i < B; i++) {
        if (losses[i] < prevLoss[i]) improvedCount[i]++;
        prevLoss[i] = losses[i];
        if (losses[i] < bestLossS[i]) {
          bestLossS[i] = losses[i];
          improvedMask[i] = 1;
          anyImproved = true;
        }
        if (losses[i] < bestLoss) {
          bestLoss = losses[i];
          iBest = i;
        }
      }
      if (schedule === "apgd" && anyImproved) {
        bestXs = replace(bestXs, tf.tidy(() => tf.where(tf.tensor2d(improvedMask, [B, 1], "bool").tile([1, n]), x, bestXs)));
      }

      let xs = null;
      if (iBest >= 0) {
        xs = x.dataSync();
        bestX = xs.slice(iBest * n, (iBest + 1) * n);
      }

      if (isCandidate && onCandidate && rechecks < maxRechecks) {
        // Re-check the most violating candidate of this step.
        let iCand = -1;
        for (let i = 0; i < B; i++) {
          if (isCandidate(losses[i]) && (iCand < 0 || losses[i] < losses[iCand])) iCand = i;
        }
        if (iCand >= 0) {
          xs = xs ?? x.dataSync();
          rechecks++;
          const candX = xs.slice(iCand * n, (iCand + 1) * n);
          if (await onCandidate(candX, losses[iCand])) {
            confirmed = { x: candX, loss: losses[iCand] };
          } else {
            spurious++;
          }
        }
      }

      stepsRun = k;
      onStep?.(k, bestLoss);

      if (confirmed || k === steps) {
        grad.dispose();
        break;
      }

      // APGD checkpoint: halve the step of starts that stalled and send them
      // back to their best point.
      if (checkpoints.has(k)) {
        const span = k - lastCheckpoint;
        const reset = new Uint8Array(B);
        let anyReset = false;
        for (let i = 0; i < B; i++) {
          const fewImprovements = improvedCount[i] < 0.75 * span;
          const stalled = !reducedAtCheckpoint[i] && bestAtCheckpoint[i] === bestLossS[i];
          reducedAtCheckpoint[i] = fewImprovements || stalled ? 1 : 0;
          if (reducedAtCheckpoint[i]) {
            eta[i] /= 2;
            reset[i] = 1;
            anyReset = true;
          }
        }
        improvedCount.fill(0);
        lastCheckpoint = k;
        bestAtCheckpoint = bestLossS.slice();
        if (anyReset) {
          stepSize = replace(stepSize, tf.tidy(() => tf.mul(tf.tensor2d(eta, [B, 1]), width)));
          const mask = tf.tensor2d(reset, [B, 1], "bool");
          x = replace(x, tf.tidy(() => tf.where(mask.tile([1, n]), bestXs, x)));
          xPrev = replace(xPrev, tf.clone(x));
          mask.dispose();
          grad.dispose();
          for (let i = 0; i < B; i++) if (reset[i]) prevLoss[i] = bestLossS[i];
          continue; // re-evaluate the gradient at the new points
        }
      }

      const next = tf.tidy(() => {
        const z = clip(tf.sub(x, tf.mul(stepSize, tf.sign(grad))));
        if (schedule !== "apgd" || k === 0) return z;
        // x + 0.75 (z − x) + 0.25 (x − x_prev)
        return clip(tf.add(tf.add(x, tf.mul(tf.sub(z, x), 0.75)), tf.mul(tf.sub(x, xPrev), 0.25)));
      });
      grad.dispose();
      xPrev = replace(xPrev, x);
      x = next;
    }
  } finally {
    [x, xPrev, bestXs, lo, hi, width, stepSize, ones].forEach((t) => t.dispose());
  }

  return {
    bestLoss,
    bestX,
    confirmed,
    spurious,
    stepsRun,
    batchSize: B,
  };
}
