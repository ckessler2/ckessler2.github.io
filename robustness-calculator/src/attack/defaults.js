// Default attack settings per robustness type. Point-based checks
// (classification, standard / Lipschitz regression) attack high-dimensional
// ε-balls around every uncertified point, so they use a light attack;
// property checks (low-dimensional boxes in the built-in benchmarks) can
// afford a much stronger one. Both can be changed under Advanced.

export const ATTACK_DEFAULTS = {
  points: { restarts: 10, steps: 50, selfTestSamples: 20 },
  properties: { restarts: 400, steps: 200, selfTestSamples: 100 },
};

export const attackDefaultsFor = (task) => (task === "properties" ? ATTACK_DEFAULTS.properties : ATTACK_DEFAULTS.points);
