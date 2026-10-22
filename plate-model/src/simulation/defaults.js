export function createDefaultConfig() {
  return {
    model: {
      m_prime: 0.437607764772948,
      gamma: 0.220499600429808,
      inertia:0.013986294826135,
    },
    initialConditions: {
      v_xp0: 2.2,
      v_yp0: 0,
      omega0: 0,
      theta0: -0.2,
      x0: 0,
      y0: 0,
    },
    aero: {
      type: "li_et_al_coefficients",
      coefficients: [5.182184521,	0.807506507,	0.105977518,	4.936811621,	1.499580107,	0.238565281,	2.852890077,	0.368933365,	1.730018894],
      
      
      e_x: 0.0,
    },
    solver: {
      dt: 0.1,
      t_end: 50,
      method: "rk4",
      relTol: 1e-6,
      absTol: 1e-9,
      minStep: 1e-8,
      maxStep: 0.1,
      maxRuntimeMs: 1000,
      maxAbsState: 1000000,
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
  { name: "c1", labelTex: "C_{\\mathrm{L}}^{1}" },
  { name: "c2", labelTex: "C_{\\mathrm{L}}^{2}" },
  { name: "c3", labelTex: "C_{\\mathrm{D}}^{0}" },
  { name: "c4", labelTex: "C_{\\mathrm{D}}^{1}" },
  { name: "c5", labelTex: "C_{\\mathrm{D}}^{\\pi/2}" },
  { name: "c6", labelTex: "C_{\\mathrm{CP}}^{0}" },
  { name: "c7", labelTex: "C_{\\mathrm{CP}}^{1}" },
  { name: "c8", labelTex: "C_{\\mathrm{CP}}^{2}" },
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

export const solverOptions = [
  { value: "rk4", label: "RK4 (fixed step)" },
  { value: "rk45", label: "RK45 (adaptive, ode45-like)" },
];

