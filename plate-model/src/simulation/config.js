export function readConfigFromForm(formState) {
  const coefficients = Array.from({ length: 9 }, (_, index) =>
    Number(formState[`c${index + 1}`]),
  );

  if (coefficients.some(Number.isNaN)) {
    throw new Error("All aerodynamic coefficients must be numeric.");
  }

  const config = {
    model: {
      l: Number(formState.l),
      m: Number(formState.m),
      rho_f: Number(formState.rho_f),
      a: Number(formState.a),
      b: Number(formState.b),
      s: Number(formState.s),
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

  return config;
}
