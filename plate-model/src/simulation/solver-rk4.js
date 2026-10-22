function addScaled(base, delta, scale) {
  return base.map((value, index) => value + delta[index] * scale);
}

function addMany(base, terms) {
  return base.map((value, index) => {
    let sum = value;
    for (const [weight, vector] of terms) {
      sum += weight * vector[index];
    }
    return sum;
  });
}

function isFiniteState(state) {
  return state.every((value) => Number.isFinite(value));
}

function exceedsMagnitude(state, limit) {
  return state.some((value) => Math.abs(value) > limit);
}

function rk4Step(rhs, t, state, dt, config) {
  const k1 = rhs(t, state, config);
  const k2 = rhs(t + dt / 2, addScaled(state, k1, dt / 2), config);
  const k3 = rhs(t + dt / 2, addScaled(state, k2, dt / 2), config);
  const k4 = rhs(t + dt, addScaled(state, k3, dt), config);

  return state.map(
    (value, index) => value + (dt / 6) * (k1[index] + 2 * k2[index] + 2 * k3[index] + k4[index]),
  );
}

function rk45DormandPrinceStep(rhs, t, state, dt, config) {
  const k1 = rhs(t, state, config);
  const k2 = rhs(t + dt * (1 / 5), addMany(state, [[dt * (1 / 5), k1]]), config);
  const k3 = rhs(
    t + dt * (3 / 10),
    addMany(state, [
      [dt * (3 / 40), k1],
      [dt * (9 / 40), k2],
    ]),
    config,
  );
  const k4 = rhs(
    t + dt * (4 / 5),
    addMany(state, [
      [dt * (44 / 45), k1],
      [dt * (-56 / 15), k2],
      [dt * (32 / 9), k3],
    ]),
    config,
  );
  const k5 = rhs(
    t + dt * (8 / 9),
    addMany(state, [
      [dt * (19372 / 6561), k1],
      [dt * (-25360 / 2187), k2],
      [dt * (64448 / 6561), k3],
      [dt * (-212 / 729), k4],
    ]),
    config,
  );
  const k6 = rhs(
    t + dt,
    addMany(state, [
      [dt * (9017 / 3168), k1],
      [dt * (-355 / 33), k2],
      [dt * (46732 / 5247), k3],
      [dt * (49 / 176), k4],
      [dt * (-5103 / 18656), k5],
    ]),
    config,
  );
  const k7 = rhs(
    t + dt,
    addMany(state, [
      [dt * (35 / 384), k1],
      [dt * (500 / 1113), k3],
      [dt * (125 / 192), k4],
      [dt * (-2187 / 6784), k5],
      [dt * (11 / 84), k6],
    ]),
    config,
  );

  const nextState = addMany(state, [
    [dt * (35 / 384), k1],
    [dt * (500 / 1113), k3],
    [dt * (125 / 192), k4],
    [dt * (-2187 / 6784), k5],
    [dt * (11 / 84), k6],
  ]);

  const embeddedState = addMany(state, [
    [dt * (5179 / 57600), k1],
    [dt * (7571 / 16695), k3],
    [dt * (393 / 640), k4],
    [dt * (-92097 / 339200), k5],
    [dt * (187 / 2100), k6],
    [dt * (1 / 40), k7],
  ]);

  const error = nextState.map((value, index) => value - embeddedState[index]);
  return { nextState, error };
}

function computeErrorNorm(error, currentState, nextState, absTol, relTol) {
  let norm = 0;
  for (let index = 0; index < error.length; index += 1) {
    const scale = absTol + relTol * Math.max(Math.abs(currentState[index]), Math.abs(nextState[index]));
    const ratio = Math.abs(error[index]) / (scale || 1);
    if (ratio > norm) {
      norm = ratio;
    }
  }
  return norm;
}

export function solveFixedStep({ rhs, config }) {
  const { dt, t_end } = config.solver;
  const maxRuntimeMs = config.solver.maxRuntimeMs ?? Infinity;
  const maxAbsState = config.solver.maxAbsState ?? Infinity;
  const stepCount = Math.floor(t_end / dt);
  const t = Array.from({ length: stepCount + 1 }, (_, index) => index * dt);
  const states = new Array(stepCount + 1);
  const initial = config.initialConditions;

  states[0] = [
    initial.v_xp0,
    initial.v_yp0,
    initial.omega0,
    initial.theta0,
    initial.x0,
    initial.y0,
  ];

  const startTime = performance.now();
  for (let index = 0; index < stepCount; index += 1) {
    if (performance.now() - startTime > maxRuntimeMs) {
      throw new Error(`Simulation exceeded ${maxRuntimeMs} ms runtime limit.`);
    }

    states[index + 1] = rk4Step(rhs, t[index], states[index], dt, config);

    const nextState = states[index + 1];
    if (!isFiniteState(nextState)) {
      throw new Error("Simulation diverged: non-finite state encountered.");
    }
    if (exceedsMagnitude(nextState, maxAbsState)) {
      throw new Error(`Simulation diverged: state magnitude exceeded ${maxAbsState}.`);
    }
  }
  const runtimeMs = performance.now() - startTime;

  return { t, states, runtimeMs, stepCount };
}

export function solveAdaptiveRK45({ rhs, config }) {
  const { dt, t_end } = config.solver;
  const maxRuntimeMs = config.solver.maxRuntimeMs ?? Infinity;
  const maxAbsState = config.solver.maxAbsState ?? Infinity;
  const relTol = config.solver.relTol ?? 1e-6;
  const absTol = config.solver.absTol ?? 1e-9;
  const minStep = config.solver.minStep ?? 1e-8;
  const maxStep = config.solver.maxStep ?? dt;

  let time = 0;
  let stepSize = Math.min(dt, maxStep);
  let acceptedStepCount = 0;

  const initial = config.initialConditions;
  let state = [
    initial.v_xp0,
    initial.v_yp0,
    initial.omega0,
    initial.theta0,
    initial.x0,
    initial.y0,
  ];

  const times = [time];
  const states = [state];

  const startTime = performance.now();
  while (time < t_end) {
    if (performance.now() - startTime > maxRuntimeMs) {
      throw new Error(`Simulation exceeded ${maxRuntimeMs} ms runtime limit.`);
    }

    const remaining = t_end - time;
    const actualStep = Math.min(stepSize, remaining);
    const { nextState, error } = rk45DormandPrinceStep(rhs, time, state, actualStep, config);

    if (!isFiniteState(nextState)) {
      throw new Error("Simulation diverged: non-finite state encountered.");
    }

    const errorNorm = computeErrorNorm(error, state, nextState, absTol, relTol);
    const accepted = errorNorm <= 1;

    const safety = 0.9;
    const growth = errorNorm === 0 ? 5 : safety * errorNorm ** (-1 / 5);
    const factor = Math.min(5, Math.max(0.2, growth));
    const proposedStep = Math.min(maxStep, Math.max(minStep, actualStep * factor));

    if (accepted) {
      time += actualStep;
      state = nextState;

      if (exceedsMagnitude(state, maxAbsState)) {
        throw new Error(`Simulation diverged: state magnitude exceeded ${maxAbsState}.`);
      }

      times.push(time);
      states.push(state);
      acceptedStepCount += 1;
    } else if (actualStep <= minStep * 1.0000001) {
      throw new Error("RK45 step size reached minimum before meeting tolerance.");
    }

    stepSize = proposedStep;
  }

  const runtimeMs = performance.now() - startTime;
  return { t: times, states, runtimeMs, stepCount: acceptedStepCount };
}

export function solveSimulation({ rhs, config }) {
  if (config.solver.method === "rk45") {
    return solveAdaptiveRK45({ rhs, config });
  }
  return solveFixedStep({ rhs, config });
}
