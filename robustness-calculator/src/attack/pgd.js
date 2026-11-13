// Projected gradient descent over an input box (L-infinity), following
// Madry et al. (2018): sign-gradient steps, element-wise clamping, random
// restarts batched into one tensor.
//
// PGD is a falsifier. Finding nothing proves nothing.

import { boxCentre32, sampleBox32 } from "./box.js";

export function defaultAlpha(steps) {
  return 2.5 / steps;
}

/**
 * @param tf        TensorFlow.js namespace
 * @param opts.forward   (x [B,n]) -> y [B,m]
 * @param opts.lossFn    (y, x) -> loss [B], minimised
 * @param opts.box       from makeBox()
 * @param opts.restarts  number of uniform random starting points (R)
 * @param opts.steps     PGD steps per start (K)
 * @param opts.alpha     step size as a fraction of each feature's box width
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

  const starts = [];
  const centre = boxCentre32(box);
  if (includeCentre) starts.push(centre);
  if (includeCorner) {
    const g = tf.tidy(() => valueAndGrad(tf.tensor2d(centre, [1, n]), tf.ones([1])).grad.dataSync());
    const corner = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      corner[i] = g[i] > 0 ? box.lo32[i] : g[i] < 0 ? box.hi32[i] : centre[i];
    }
    starts.push(corner);
  }
  for (let r = 0; r < restarts; r++) starts.push(sampleBox32(box, rng));

  const B = starts.length;
  const flat = new Float32Array(B * n);
  starts.forEach((s, i) => flat.set(s, i * n));

  const lo = tf.tensor2d(box.lo32, [1, n]);
  const hi = tf.tensor2d(box.hi32, [1, n]);
  const stepSize = tf.tidy(() => tf.mul(tf.sub(hi, lo), alpha));
  const ones = tf.ones([B]);
  let x = tf.tensor2d(flat, [B, n]);

  let bestLoss = Infinity;
  let bestX = new Float32Array(starts[0]);
  let confirmed = null;
  let rechecks = 0;
  let spurious = 0;
  let stepsRun = 0;

  try {
    for (let k = 0; k <= steps; k++) {
      const { value, grad } = tf.tidy(() => valueAndGrad(x, ones));
      const losses = value.dataSync();
      value.dispose();

      let iBest = -1;
      for (let i = 0; i < B; i++) {
        if (losses[i] < bestLoss) {
          bestLoss = losses[i];
          iBest = i;
        }
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

      const next = tf.tidy(() => tf.minimum(tf.maximum(tf.sub(x, tf.mul(stepSize, tf.sign(grad))), lo), hi));
      grad.dispose();
      x.dispose();
      x = next;
    }
  } finally {
    x.dispose();
    lo.dispose();
    hi.dispose();
    stepSize.dispose();
    ones.dispose();
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
