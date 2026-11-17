// The one-line statement every report carries.

/** Attack only: what "no counterexample" means. */
export const DISCLAIMER =
  "Upper bounds on robustness from attacks; absence of a counterexample is not a proof.";

/** Certification + attack. */
export const DISCLAIMER_CERTIFIED =
  "“Certified” points are proven robust by CROWN (with a float32 safety margin); “counterexample” points are proven not robust (re-checked with onnxruntime); “unknown” points are neither.";

export const disclaimerFor = (result) => (result?.summary?.certification === "crown" ? DISCLAIMER_CERTIFIED : DISCLAIMER);
