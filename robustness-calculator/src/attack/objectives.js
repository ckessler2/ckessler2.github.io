// Losses for PGD. Every loss is per-sample (shape [B]) and is MINIMISED.
// lossFn(y, x): y = model output [B, m], x = model input [B, n].

/**
 * VNNLIB region margin: min over disjuncts of max over atoms of (a·y - b).
 * <= 0 means the unsafe condition holds (a counterexample candidate).
 * Disjuncts are padded to the same number of atoms by repeating their first
 * atom, so the whole margin is one matrix product.
 */
export function createRegionMarginLoss(tf, region, numOutputs) {
  const D = region.disjuncts.length;
  const M = Math.max(...region.disjuncts.map((d) => d.atoms.length));
  const A = new Float32Array(numOutputs * D * M);
  const b = new Float32Array(D * M);
  region.disjuncts.forEach((d, di) => {
    for (let k = 0; k < M; k++) {
      const atom = d.atoms[Math.min(k, d.atoms.length - 1)];
      const col = di * M + k;
      for (let j = 0; j < numOutputs; j++) A[j * D * M + col] = atom.a[j];
      b[col] = atom.b;
    }
  });
  const At = tf.tensor2d(A, [numOutputs, D * M]);
  const bt = tf.tensor1d(b);
  return {
    lossFn: (y) => tf.min(tf.max(tf.reshape(tf.sub(tf.matMul(y, At), bt), [-1, D, M]), 2), 1),
    dispose() {
      At.dispose();
      bt.dispose();
    },
  };
}

/** Classification margin: logit of the true class minus the largest other logit. < 0 = misclassified. */
export function createClassificationLoss(tf, label, numOutputs) {
  const mask = tf.oneHot(tf.tensor1d([label], "int32"), numOutputs).toBool();
  return {
    lossFn: (y) => {
      const trueLogit = tf.max(tf.where(mask, y, tf.fill(y.shape, -Infinity)), 1);
      const otherLogit = tf.max(tf.where(mask, tf.fill(y.shape, -Infinity), y), 1);
      return tf.sub(trueLogit, otherLogit);
    },
    dispose() {
      mask.dispose();
    },
  };
}

/** Standard robustness: maximise ||f(x) - f(x*)||_inf, i.e. minimise its negative. */
export function createDeviationLoss(tf, yRef) {
  const ref = tf.tensor2d(yRef, [1, yRef.length]);
  return {
    lossFn: (y) => tf.neg(tf.max(tf.abs(tf.sub(y, ref)), 1)),
    dispose() {
      ref.dispose();
    },
  };
}

/**
 * Lipschitz robustness: maximise ||f(x) - f(x*)||_inf / ||x - x*||_inf.
 * The denominator is floored at minDist so float32 noise at tiny distances
 * cannot produce huge ratios.
 */
export function createLipschitzLoss(tf, xRef, yRef, minDist) {
  const xr = tf.tensor2d(xRef, [1, xRef.length]);
  const yr = tf.tensor2d(yRef, [1, yRef.length]);
  return {
    lossFn: (y, x) => {
      const num = tf.max(tf.abs(tf.sub(y, yr)), 1);
      const den = tf.maximum(tf.max(tf.abs(tf.sub(x, xr)), 1), minDist);
      return tf.neg(tf.div(num, den));
    },
    dispose() {
      xr.dispose();
      yr.dispose();
    },
  };
}
