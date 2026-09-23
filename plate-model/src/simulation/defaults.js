export function createDefaultConfig() {
  return {
    model: {
      l: 0.07,
      m: 0.3175e-3,
      rho_f: 1.225,
      a: 0.03375,
      b: 0.5e-3,
      s: 0.1745,
    },
    initialConditions: {
      v_xp0: 0,
      v_yp0: 0,
      omega0: 0,
      theta0: -1,
      x0: 0,
      y0: 0,
    },
    aero: {
      type: "li_et_al_coefficients",
      coefficients: [5.182, 0.8075, 0.106, 4.937, 1.5, 0.2386, 2.853, 0.3689, 1.73],
      e_x: 0,
    },
    solver: {
      dt: 0.05,
      t_end: 25,
      method: "rk4",
    },
    visualization: {
      showStartMarker: true,
      showEndMarker: true,
    },
  };
}

export const modelFields = [
  { name: "l", labelTex: "l" },
  { name: "m", labelTex: "m" },
  { name: "rho_f", labelTex: "\\rho_f" },
  { name: "a", labelTex: "a" },
  { name: "b", labelTex: "b" },
  { name: "s", labelTex: "s" },
  { name: "e_x", labelTex: "e_x" },
];

export const aeroCoefficientFields = [
  { name: "c1", labelTex: "C_{\\mathrm{CP}}^{0}" },
  { name: "c2", labelTex: "C_{\\mathrm{CP}}^{1}" },
  { name: "c3", labelTex: "C_{\\mathrm{CP}}^{2}" },
  { name: "c4", labelTex: "C_{\\mathrm{L}}^{1}" },
  { name: "c5", labelTex: "C_{\\mathrm{L}}^{2}" },
  { name: "c6", labelTex: "C_{\\mathrm{D}}^{0}" },
  { name: "c7", labelTex: "C_{\\mathrm{D}}^{1}" },
  { name: "c8", labelTex: "C_{\\mathrm{D}}^{\\pi/2}" },
  { name: "c9", labelTex: "C_{\\mathrm{R}}" },
];

export const initialConditionFields = [
  { name: "v_xp0", labelTex: "v_{x'}(0)" },
  { name: "v_yp0", labelTex: "v_{y'}(0)" },
  { name: "omega0", labelTex: "\\omega(0)" },
  { name: "theta0", labelTex: "\\theta(0)" },
  { name: "x0", labelTex: "x(0)" },
  { name: "y0", labelTex: "y(0)" },
];

export const solverFields = [
  { name: "dt", labelTex: "\\Delta t" },
  { name: "t_end", labelTex: "t_{\\mathrm{end}}" },
];

export const solverOptions = [{ value: "rk4", label: "RK4" }];
