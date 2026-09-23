import { evaluateLiEtAlAerodynamics } from "./aero-li-et-al.js";

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
