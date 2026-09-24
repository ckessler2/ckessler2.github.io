export function readConfigFromForm(formState) {
  const coefficients = Array.from({ length: 9 }, (_, index) =>
    Number(formState[`c${index + 1}`]),
  );

  if (coefficients.some(Number.isNaN)) {
    throw new Error("All aerodynamic coefficients must be numeric.");
  }

  const config = {
    model: {
      m_prime: Number(formState.m_prime),
      gamma: Number(formState.gamma),
      inertia: Number(formState.inertia),
    },
    initialConditions: {
      v_xp0: Number(formState.v_xp0),
      v_yp0: Number(formState.v_yp0),
      omega0: Number(formState.omega0),
      theta0: Number(formState.theta0),
      x0: Number(formState.x0),
      y0: Number(formState.y0),
    },
    aero: {
      type: "li_et_al_coefficients",
      coefficients,
      e_x: Number(formState.e_x),
    },
    solver: {
      dt: Number(formState.dt),
      t_end: Number(formState.t_end),
      method: formState.solverMethod,
    },
    visualization: {
      showStartMarker: Boolean(formState.showStartMarker),
      showEndMarker: Boolean(formState.showEndMarker),
    },
  };

  if (config.solver.dt <= 0 || config.solver.t_end <= 0) {
    throw new Error("dt and t_end must both be positive.");
  }

  if (config.model.m_prime <= 0 || config.model.gamma <= 0 || config.model.inertia <= 0) {
    throw new Error("m_prime, gamma, and inertia must all be positive.");
  }

  return config;
}
