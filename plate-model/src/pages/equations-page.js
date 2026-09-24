function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightJs(source) {
  let html = escapeHtml(source);

  html = html.replace(
    /(\/\/.*$)/gm,
    '<span class="code-comment">$1</span>',
  );
  html = html.replace(
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
    '<span class="code-string">$1</span>',
  );
  html = html.replace(
    /\b(import|from|export|function|return|const|let|if|else)\b/g,
    '<span class="code-keyword">$1</span>',
  );
  html = html.replace(
    /\b(Math|Number)\b/g,
    '<span class="code-builtin">$1</span>',
  );
  html = html.replace(
    /\b(\d+(?:\.\d+)?(?:e-?\d+)?)\b/gi,
    '<span class="code-number">$1</span>',
  );

  return html;
}

function createCodeCard(titleText, source) {
  const card = document.createElement("section");
  card.className = "page-card";

  const title = document.createElement("h2");
  title.textContent = titleText;

  const pre = document.createElement("pre");
  pre.className = "code-block";

  const code = document.createElement("code");
  code.className = "code-block-inner";
  code.innerHTML = highlightJs(source);

  pre.append(code);
  card.append(title, pre);
  return card;
}

const modelSource = `function evaluateLiEtAlAerodynamics(alpha, coefficients) {
  const [C_L1, C_L2, C_D0, C_D1, C_D_pi_2, C_0_CP, C_1_CP, C_2_CP] = coefficients;

  const alpha0 = (14 * Math.PI) / 180;
  const delta = (6 * Math.PI) / 180;

  const Falpha1 = (1 - Math.tanh((Math.PI - Math.abs(alpha) - alpha0) / delta)) / 2;
  const Falpha2 = (1 - Math.tanh((Math.abs(alpha) - alpha0) / delta)) / 2;
  const Falpha3 = (1 - Math.tanh((alpha - alpha0) / delta)) / 2;
  const Falpha4 = (1 - Math.tanh((Math.PI - alpha - alpha0) / delta)) / 2;

  // lift / drag / center-of-pressure closures
  // ...

  return { C_Lalpha, C_Dalpha, epsilon_alpha, C_D_pi_2 };
}

export function nondimFreelyFallingPlate(_t, state, config) {
  const [v_xp, v_yp, omega, theta] = state;
  const { m_prime, gamma, inertia } = config.model;
  const { coefficients, e_x } = config.aero;
  const C_R = coefficients[8];

  const alpha = Math.atan2(v_yp - omega * e_x, v_xp);

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
}`;

const runnerSource = `import { solveFixedStep } from "./solver-rk4.js";
import { nondimFreelyFallingPlate } from "./nondim-falling-plate-quiescent.js";
import { estimateResultMemoryBytes } from "./metrics.js";

export function runQuiescentSimulation(config) {
  const raw = solveFixedStep({ rhs: nondimFreelyFallingPlate, config });
  // ... package state histories and metadata for plotting
  return result;
}`;

export function renderEquationsPage() {
  const page = document.createElement("section");
  page.className = "page-flow";

  page.append(
    createCodeCard("nondim-falling-plate-quiescent.js", modelSource),
    createCodeCard("run-quiescent.js", runnerSource),
  );
  return page;
}
