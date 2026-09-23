import { solveFixedStep } from "./solver-rk4.js";
import { nondimFreelyFallingPlate } from "./model-quiescent.js";
import { estimateResultMemoryBytes } from "./metrics.js";

export function runQuiescentSimulation(config) {
  const raw = solveFixedStep({ rhs: nondimFreelyFallingPlate, config });
  const states = {
    v_xp: raw.states.map((state) => state[0]),
    v_yp: raw.states.map((state) => state[1]),
    omega: raw.states.map((state) => state[2]),
    theta: raw.states.map((state) => state[3]),
    x: raw.states.map((state) => state[4]),
    y: raw.states.map((state) => state[5]),
  };

  const lastIndex = raw.t.length - 1;
  const result = {
    t: raw.t,
    states,
    finalState: {
      t_end: raw.t[lastIndex],
      v_xp: states.v_xp[lastIndex],
      v_yp: states.v_yp[lastIndex],
      omega: states.omega[lastIndex],
      theta: states.theta[lastIndex],
      x: states.x[lastIndex],
      y: states.y[lastIndex],
    },
    metadata: {
      stepCount: raw.stepCount,
      runtimeMs: raw.runtimeMs,
      estimatedMemoryBytes: 0,
      solverName: config.solver.method,
    },
  };

  result.metadata.estimatedMemoryBytes = estimateResultMemoryBytes(result);
  return result;
}
