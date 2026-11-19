// The one-line statement every report carries.

/** Attack only: what "no counterexample" means. */
export const DISCLAIMER =
  "Upper bounds on robustness from attacks; absence of a counterexample is not a proof.";

/** Certification + attack. */
export const DISCLAIMER_CERTIFIED =
  "“Certified”: CROWN bounds show no input in the box changes the answer, in real arithmetic on the float64 network (as in VNN-COMP), with a float32 safety margin; not a floating-point-sound proof. “Counterexample”: a concrete failing input, re-checked with onnxruntime. “Unknown”: neither.";

export const disclaimerFor = (result) => (result?.summary?.certification === "crown" ? DISCLAIMER_CERTIFIED : DISCLAIMER);
