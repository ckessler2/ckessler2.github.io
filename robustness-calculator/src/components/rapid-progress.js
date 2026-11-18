// Turns the worker's progress events into phases for the Run toolbar:
// "Self-test ✓ → Certify 12/20 → Attack 3 · point 13, step 30/50".
// Events (see attack/run-points.js, run-properties.js, run-vnnlib.js):
//   { phase: "self-test" }
//   { phase: "certify", point, points, epsilon?, unit? }
//   { phase: "attack", point, points, step, steps, region?, regions?, epsilon? }
// Attack events are throttled by the worker, so the attack count may lag slightly.

import { formatNumber } from "./stats.js";

export function createProgressTracker() {
  let selfTest = false;
  let certified = -1;
  const attacked = new Set();
  let last = null;
  return {
    update(p) {
      if (!p) return;
      last = p;
      if (p.phase === "self-test") selfTest = true;
      if (p.phase === "certify" && p.point !== undefined) certified = Math.max(certified, p.point);
      if (p.phase === "attack" && p.point !== undefined) attacked.add(p.point);
    },
    /** [{ label, state: "done" | "active" | "todo" }] and a detail string. */
    phases() {
      const p = last;
      const out = [];
      if (!p) return { steps: [{ label: "Starting", state: "active" }], detail: "" };
      const inSelfTest = p.phase === "self-test";
      out.push({ label: inSelfTest ? "Self-test" : "Self-test ✓", state: inSelfTest ? "active" : "done" });
      const total = p.points;
      const unit = p.unit === "property" || p.region !== undefined ? "property" : "point";
      if (certified >= 0) {
        out.push({ label: `Certify ${Math.min(certified + 1, total ?? certified + 1)}${total ? `/${total}` : ""}`, state: p.phase === "certify" ? "active" : "done" });
      }
      if (attacked.size) out.push({ label: `Attack ${attacked.size}`, state: p.phase === "attack" ? "active" : "done" });
      let detail = "";
      if (inSelfTest) detail = "comparing tf.js with onnxruntime";
      else if (p.phase === "certify") detail = `${unit} ${p.point + 1}${p.epsilon !== undefined ? ` · ε ${formatNumber(p.epsilon, 3)}` : ""}`;
      else if (p.phase === "attack") {
        const where = p.regions > 1 ? ` · region ${p.region + 1}/${p.regions}` : "";
        const eps = p.epsilon !== undefined && p.region === undefined ? ` · ε ${formatNumber(p.epsilon, 3)}` : "";
        detail = `${p.points > 0 ? `${unit} ${p.point + 1}/${p.points}` : unit}${where} · step ${p.step}/${p.steps}${eps}`;
      }
      return { steps: out, detail };
    },
    fraction() {
      const p = last;
      if (!p || (p.phase !== "attack" && p.phase !== "certify") || !(p.points > 0)) return 0;
      if (p.phase === "certify") return p.point / p.points;
      if (p.region !== undefined) return (p.point + (p.region + p.step / p.steps) / p.regions) / p.points;
      return (p.point + p.step / p.steps) / p.points;
    },
  };
}
