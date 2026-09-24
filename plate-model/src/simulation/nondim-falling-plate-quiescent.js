function evaluateLiEtAlAerodynamics(alpha, coefficients) {
  const [C_L1, C_L2, C_D0, C_D1, C_D_pi_2, C_0_CP, C_1_CP, C_2_CP] = coefficients;

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

  return { C_Lalpha, C_Dalpha, epsilon_alpha, C_D_pi_2 };
}

export function nondimFreelyFallingPlate(_t, state, config) {
  const [v_xp, v_yp, omega, theta] = state;
  const { l, m, rho_f, a, b, s } = config.model;
  const { coefficients, e_x } = config.aero;
  const C_R = coefficients[8];

  const rho_s = m / (Math.PI * a * b);
  const inertia = (m * (a ** 2 + b ** 2)) / (rho_f * l ** 4) + 1 / 32 + e_x ** 2;
  const l_CM = e_x * l;
  const m_prime = (4 * m) / (Math.PI * rho_f * l * l * s);
  const gamma = rho_f / (rho_s - rho_f);
  const alpha = Math.atan2(v_yp - omega * l_CM, v_xp);

  const { C_Lalpha, C_Dalpha, epsilon_alpha, C_D_pi_2 } =
    evaluateLiEtAlAerodynamics(alpha, coefficients);

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
  const plusMinus = 2 * e_x <= 1 ? e_xplus + e_xminus : e_xplus - e_xminus;

  const domegadt =
    (-(C_D_pi_2 / (32 * Math.PI)) * omega * Math.abs(omega) * plusMinus +
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
