// The one-line statement every report carries.

/** Attack only: what "no counterexample" means. */
export const DISCLAIMER =
  "Upper bounds on robustness from attacks; absence of a counterexample is not a proof.";

/** Certification + attack. */
export const DISCLAIMER_CERTIFIED =
  "“Certified” points are proven robust by bound propagation (CROWN or α-CROWN-lite, with a float32 safety margin); “counterexample” points are proven not robust (re-checked with onnxruntime); “unknown” points are neither.";

export const disclaimerFor = (result) => (["crown", "acrown-lite"].includes(result?.summary?.certification) ? DISCLAIMER_CERTIFIED : DISCLAIMER);
