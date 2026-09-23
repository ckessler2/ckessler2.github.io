export function evaluateLiEtAlAerodynamics(alpha, coefficients) {
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
