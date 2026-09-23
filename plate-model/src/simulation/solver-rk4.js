function addScaled(base, delta, scale) {
  return base.map((value, index) => value + delta[index] * scale);
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

export function solveFixedStep({ rhs, config }) {
  const { dt, t_end } = config.solver;
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
    states[index + 1] = rk4Step(rhs, t[index], states[index], dt, config);
  }
  const runtimeMs = performance.now() - startTime;

  return { t, states, runtimeMs, stepCount };
}
