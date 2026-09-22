const defaults = {
  l: 0.07,
  m: 0.3175e-3,
  rho_f: 1.225,
  a: 0.03375,
  b: 0.5e-3,
  s: 0.1745,
  v_xp0: 0,
  v_yp0: 0,
  omega0: 0,
  theta0: -1,
  x0: 0,
  y0: 0,
  e_x: 0,
  dt: 0.05,
  t_end: 25,
  aeroCoeffs: "5.182 0.8075 0.1060 4.937 1.500 0.2386 2.853 0.3689 1.730",
};

const numericFields = [
  ["l", "l"],
  ["m", "m"],
  ["rho_f", "rho_f"],
  ["a", "a"],
  ["b", "b"],
  ["s", "s"],
  ["v_xp0", "v_xp0"],
  ["v_yp0", "v_yp0"],
  ["omega0", "omega0"],
  ["theta0", "theta0"],
  ["x0", "x0"],
  ["y0", "y0"],
  ["e_x", "e_x"],
  ["dt", "dt"],
  ["t_end", "t_end"],
];

const inputsGrid = document.getElementById("inputs-grid");
const coeffInput = document.getElementById("aeroCoeffs");
const status = document.getElementById("status");
const finalState = document.getElementById("final-state");
const runButton = document.getElementById("run-button");

const inputElements = {};

for (const [key, label] of numericFields) {
  const wrapper = document.createElement("label");
  wrapper.className = "field";

  const title = document.createElement("span");
  title.textContent = label;

  const input = document.createElement("input");
  input.type = "number";
  input.value = String(defaults[key]);
  input.step = "any";

  wrapper.append(title, input);
  inputsGrid.appendChild(wrapper);
  inputElements[key] = input;
}

coeffInput.value = defaults.aeroCoeffs;

function parseCoeffs(source, expectedCount = 9) {
  const values = source
    .replaceAll(",", " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);

  if (values.length !== expectedCount || values.some(Number.isNaN)) {
    throw new Error(`Expected ${expectedCount} numeric aerodynamic coefficients.`);
  }

  return values;
}

function nondimFreelyFallingPlate(_t, y, p, opt) {
  const [v_xp, v_yp, omega, theta] = y;
  const [l, m, rho_f, a, b, s] = p;
  const [C_L1, C_L2, C_D0, C_D1, C_D_pi_2, C_0_CP, C_1_CP, C_2_CP, C_R, e_x] = opt;

  const rho_s = m / (Math.PI * a * b);
  const inertia = (m * (a ** 2 + b ** 2)) / (rho_f * l ** 4) + 1 / 32 + e_x ** 2;
  const l_CM = e_x * l;
  const m_prime = (4 * m) / (Math.PI * rho_f * l * l * s);
  const gamma = rho_f / (rho_s - rho_f);
  const alpha = Math.atan2(v_yp - omega * l_CM, v_xp);

  const alpha0 = (14 * Math.PI) / 180;
  const delta = (6 * Math.PI) / 180;

  const Falpha1 = (1 - Math.tanh((Math.PI - Math.abs(alpha) - alpha0) / delta)) / 2;
  const Falpha2 = (1 - Math.tanh((Math.abs(alpha) - alpha0) / delta)) / 2;
  const Falpha3 = (1 - Math.tanh((alpha - alpha0) / delta)) / 2;
  const Falpha4 = (1 - Math.tanh((Math.PI - alpha - alpha0) / delta)) / 2;

  const C_Lalpha1 =
    Falpha1 * C_L1 * Math.sin(Math.PI - Math.abs(alpha)) +
    (1 - Falpha1) * C_L2 * Math.sin(2 * (Math.PI - Math.abs(alpha)));
  const C_Lalpha2 =
    Falpha2 * C_L1 * Math.sin(Math.abs(alpha)) +
    (1 - Falpha2) * C_L2 * Math.sin(2 * Math.abs(alpha));
  const C_Lalpha3 =
    Falpha3 * C_L1 * Math.sin(alpha) + (1 - Falpha3) * C_L2 * Math.sin(2 * alpha);
  const C_Lalpha4 =
    Falpha4 * C_L1 * Math.sin(Math.PI - alpha) +
    (1 - Falpha4) * C_L2 * Math.sin(2 * (Math.PI - alpha));

  let C_Lalpha;
  if (-Math.PI <= alpha && alpha <= -Math.PI / 2) {
    C_Lalpha = C_Lalpha1;
  } else if (-Math.PI / 2 < alpha && alpha <= 0) {
    C_Lalpha = -C_Lalpha2;
  } else if (0 < alpha && alpha <= Math.PI / 2) {
    C_Lalpha = C_Lalpha3;
  } else {
    C_Lalpha = -C_Lalpha4;
  }

  const C_Dalpha1 =
    Falpha1 * (C_D0 + C_D1 * Math.sin((Math.PI - Math.abs(alpha)) ** 2)) +
    (1 - Falpha1) * C_D_pi_2 * Math.sin(Math.PI - Math.abs(alpha)) ** 2;
  const C_Dalpha2 =
    Falpha2 * (C_D0 + C_D1 * Math.sin(Math.abs(alpha) ** 2)) +
    (1 - Falpha2) * C_D_pi_2 * Math.sin(Math.abs(alpha)) ** 2;
  const C_Dalpha3 =
    Falpha3 * (C_D0 + C_D1 * Math.sin(alpha ** 2)) +
    (1 - Falpha3) * C_D_pi_2 * Math.sin(alpha) ** 2;
  const C_Dalpha4 =
    Falpha4 * (C_D0 + C_D1 * Math.sin((Math.PI - alpha) ** 2)) +
    (1 - Falpha4) * C_D_pi_2 * Math.sin(Math.PI - alpha) ** 2;

  let C_Dalpha;
  if (-Math.PI <= alpha && alpha < -Math.PI / 2) {
    C_Dalpha = C_Dalpha1;
  } else if (-Math.PI / 2 <= alpha && alpha < 0) {
    C_Dalpha = C_Dalpha2;
  } else if (0 <= alpha && alpha < Math.PI / 2) {
    C_Dalpha = C_Dalpha3;
  } else {
    C_Dalpha = C_Dalpha4;
  }

  const l_CP_alpha_l1 =
    Falpha1 * (C_0_CP - C_1_CP * (Math.PI - Math.abs(alpha)) ** 2) +
    (1 - Falpha1) * C_2_CP * (1 - (Math.PI - Math.abs(alpha)) / (Math.PI / 2));
  const l_CP_alpha_l2 =
    Falpha2 * (C_0_CP - C_1_CP * Math.abs(alpha) ** 2) +
    (1 - Falpha2) * C_2_CP * (1 - Math.abs(alpha) / (Math.PI / 2));
  const l_CP_alpha_l3 =
    Falpha3 * (C_0_CP - C_1_CP * alpha ** 2) +
    (1 - Falpha3) * C_2_CP * (1 - alpha / (Math.PI / 2));
  const l_CP_alpha_l4 =
    Falpha4 * (C_0_CP - C_1_CP * (Math.PI - alpha) ** 2) +
    (1 - Falpha4) * C_2_CP * (1 - (Math.PI - alpha) / (Math.PI / 2));

  let epsilon_alpha;
  if (-Math.PI <= alpha && alpha <= -Math.PI / 2) {
    epsilon_alpha = -l_CP_alpha_l1;
  } else if (-Math.PI / 2 <= alpha && alpha <= 0) {
    epsilon_alpha = l_CP_alpha_l2;
  } else if (0 <= alpha && alpha <= Math.PI / 2) {
    epsilon_alpha = l_CP_alpha_l3;
  } else {
    epsilon_alpha = -l_CP_alpha_l4;
  }

  const speed = Math.sqrt(v_xp ** 2 + (v_yp - omega * e_x) ** 2);
  const L_Txy = (2 / Math.PI) * C_Lalpha * speed;
  const L_Tx = L_Txy * (v_yp - omega * e_x);
  const L_Ty = L_Txy * -v_xp;
  const L_Rxy = (-2 / Math.PI) * C_R * omega;
  const L_Rx = L_Rxy * (v_yp - omega * e_x);
  const L_Ry = L_Rxy * -v_xp;
  const D_xy = (-2 / Math.PI) * C_Dalpha * speed;
  const D_x = D_xy * v_xp;
  const D_y = D_xy * (v_yp - omega * e_x);

  const e_xplus = (2 * e_x + 1) ** 4 + (2 * e_x - 1) ** 4;
  const e_xminus = (2 * e_x + 1) ** 4 - (2 * e_x - 1) ** 4;
  const plus_minus = 2 * e_x <= 1 ? e_xplus + e_xminus : e_xplus - e_xminus;

  const domegadt =
    (-(C_D_pi_2 / (32 * Math.PI)) * omega * Math.abs(omega) * plus_minus +
      (L_Ty + D_y) * (epsilon_alpha - e_x) -
      gamma * e_x * Math.cos(theta)) /
    inertia;

  const dv_xpdt =
    ((m_prime + 1) * omega * v_yp - e_x * omega ** 2 + (L_Tx + L_Rx) + D_x - Math.sin(theta)) /
    m_prime;

  const dv_ypdt =
    (-m_prime * omega * v_xp + domegadt * e_x + (L_Ty + L_Ry) + D_y - Math.cos(theta)) /
    (m_prime + 1);

  const dthetadt = omega;
  const dx_dt = v_xp * Math.cos(theta) - v_yp * Math.sin(theta);
  const dy_dt = v_xp * Math.sin(theta) + v_yp * Math.cos(theta);

  return [dv_xpdt, dv_ypdt, domegadt, dthetadt, dx_dt, dy_dt];
}

function addScaled(base, delta, scale) {
  return base.map((value, index) => value + delta[index] * scale);
}

function rk4Step(t, state, dt, params, options) {
  const k1 = nondimFreelyFallingPlate(t, state, params, options);
  const k2 = nondimFreelyFallingPlate(t + dt / 2, addScaled(state, k1, dt / 2), params, options);
  const k3 = nondimFreelyFallingPlate(t + dt / 2, addScaled(state, k2, dt / 2), params, options);
  const k4 = nondimFreelyFallingPlate(t + dt, addScaled(state, k3, dt), params, options);

  return state.map(
    (value, index) => value + (dt / 6) * (k1[index] + 2 * k2[index] + 2 * k3[index] + k4[index]),
  );
}

function collectInputs() {
  const values = { aeroCoeffs: coeffInput.value };

  for (const [key] of numericFields) {
    values[key] = Number(inputElements[key].value);
  }

  return values;
}

function runSimulation(inputs) {
  const aero = parseCoeffs(inputs.aeroCoeffs);
  const params = [inputs.l, inputs.m, inputs.rho_f, inputs.a, inputs.b, inputs.s];
  const options = [...aero, inputs.e_x];
  const stepCount = Math.floor(inputs.t_end / inputs.dt);
  const t = Array.from({ length: stepCount + 1 }, (_, index) => index * inputs.dt);
  const states = new Array(stepCount + 1);

  states[0] = [inputs.v_xp0, inputs.v_yp0, inputs.omega0, inputs.theta0, inputs.x0, inputs.y0];

  for (let index = 0; index < stepCount; index += 1) {
    states[index + 1] = rk4Step(t[index], states[index], inputs.dt, params, options);
  }

  return {
    t,
    v_xp: states.map((state) => state[0]),
    v_yp: states.map((state) => state[1]),
    omega: states.map((state) => state[2]),
    theta: states.map((state) => state[3]),
    x: states.map((state) => state[4]),
    y: states.map((state) => state[5]),
  };
}

function render(result) {
  Plotly.newPlot(
    "trajectory-plot",
    [
      { x: result.x, y: result.y, type: "scatter", mode: "lines", name: "x vs y" },
      { x: [result.x[0]], y: [result.y[0]], type: "scatter", mode: "markers", name: "start" },
      {
        x: [result.x[result.x.length - 1]],
        y: [result.y[result.y.length - 1]],
        type: "scatter",
        mode: "markers",
        name: "end",
      },
    ],
    {
      paper_bgcolor: "#fff",
      plot_bgcolor: "#fff",
      xaxis: { title: "x" },
      yaxis: { title: "y", scaleanchor: "x", scaleratio: 1 },
      margin: { l: 50, r: 20, t: 20, b: 50 },
    },
    { responsive: true },
  );

  Plotly.newPlot(
    "state-plot",
    [
      { x: result.t, y: result.v_xp, type: "scatter", mode: "lines", name: "v_xp" },
      { x: result.t, y: result.v_yp, type: "scatter", mode: "lines", name: "v_yp" },
      { x: result.t, y: result.omega, type: "scatter", mode: "lines", name: "omega" },
      { x: result.t, y: result.theta, type: "scatter", mode: "lines", name: "theta" },
    ],
    {
      paper_bgcolor: "#fff",
      plot_bgcolor: "#fff",
      xaxis: { title: "t" },
      yaxis: { title: "state value" },
      margin: { l: 50, r: 20, t: 20, b: 50 },
    },
    { responsive: true },
  );

  const lastIndex = result.t.length - 1;
  finalState.textContent = JSON.stringify(
    {
      t_end: result.t[lastIndex],
      v_xp: result.v_xp[lastIndex],
      v_yp: result.v_yp[lastIndex],
      omega: result.omega[lastIndex],
      theta: result.theta[lastIndex],
      x: result.x[lastIndex],
      y: result.y[lastIndex],
    },
    null,
    2,
  );
}

function execute() {
  try {
    status.textContent = "Running...";
    const inputs = collectInputs();
    if (inputs.dt <= 0 || inputs.t_end <= 0) {
      throw new Error("dt and t_end must both be positive.");
    }
    const result = runSimulation(inputs);
    render(result);
    status.textContent = "Simulation complete.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Unknown simulation error.";
  }
}

runButton.addEventListener("click", execute);
execute();
