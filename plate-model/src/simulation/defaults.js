export function createDefaultConfig() {
  return {
    model: {
      m_prime: 0.385945736987252,
      gamma: 0.257140013996219,
      inertia: 0.0435486755093541,
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
  { name: "m_prime", labelTex: "m'" },
  { name: "gamma", labelTex: "\\gamma" },
  { name: "inertia", labelTex: "I" },
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
  { name: "v_xp0", labelTex: "v_{x'}" },
  { name: "v_yp0", labelTex: "v_{y'}" },
  { name: "omega0", labelTex: "\\omega" },
  { name: "theta0", labelTex: "\\theta" },
  { name: "x0", labelTex: "x" },
  { name: "y0", labelTex: "y" },
];

export const solverFields = [
  { name: "dt", labelTex: "\\Delta t" },
  { name: "t_end", labelTex: "t_{\\mathrm{end}}" },
];

export const solverOptions = [{ value: "rk4", label: "RK4" }];

