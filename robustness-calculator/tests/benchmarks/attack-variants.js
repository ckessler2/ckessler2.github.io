// Compare attack variants on VNN-COMP ε-ball classification instances with
// published verdicts (e.g. 2022 mnist_fc, 2025 cora_2024 MNIST networks).
//
//   node tests/benchmarks/attack-variants.js [--unsat] [--only=i,j] <data-dir> [<data-dir> ...]
//
// Each <data-dir> holds onnx/, vnnlib/ (decompressed) and ground_truth.json
// ({ "net|prop": { verdict } }) built from the published results. By default
// only published-sat instances are attacked (detection rate); --unsat also
// runs the published-unsat ones (any counterexample there would be a bug).
//
// Every instance is run in points mode, as the UI does: the image, label and
// ε are recovered from the property, and the box is clipped to [0, 1].

import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { tf, load } from "../helpers/setup.js";
import { parseVnnlib } from "../../src/spec/vnnlib.js";
import { runPointsCheck } from "../../src/attack/run-points.js";
import { pointFromProperty } from "../../src/spec/benchmark.js";

const args = process.argv.slice(2);
const withUnsat = args.includes("--unsat");
const dirs = args.filter((a) => !a.startsWith("--"));
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",").map(Number);

const ALL_VARIANTS = [
  { name: "PGD (R=10, K=20)", restarts: 10, steps: 20 },
  { name: "PGD, 9x restarts (R=90, K=20)", restarts: 90, steps: 20 },
  { name: "targeted (R=10, K=20)", restarts: 10, steps: 20, targeted: true },
  { name: "APGD schedule (R=10, K=20)", restarts: 10, steps: 20, schedule: "apgd" },
  { name: "targeted + APGD (R=10, K=20)", restarts: 10, steps: 20, targeted: true, schedule: "apgd" },
  { name: "targeted + APGD (R=10, K=100)", restarts: 10, steps: 100, targeted: true, schedule: "apgd" },
  { name: "APGD schedule (R=10, K=50)", restarts: 10, steps: 50, schedule: "apgd" },
  { name: "APGD schedule (R=10, K=100)", restarts: 10, steps: 100, schedule: "apgd" },
];
const VARIANTS = only ? only.map((i) => ALL_VARIANTS[i]) : ALL_VARIANTS;

/** Image, label and ε from a "box clipped to [0,1], unsafe if any Y_j >= Y_label" property. */
function recoverPoint(text) {
  const { lo, hi } = parseVnnlib(text).regions[0];
  const eps = Number((Math.max(...lo.map((l, i) => hi[i] - l)) / 2).toPrecision(6));
  return { ...pointFromProperty(text, eps), eps };
}

const instances = [];
for (const dir of dirs) {
  const truth = JSON.parse(readFileSync(join(dir, "ground_truth.json"), "utf8"));
  for (const [key, t] of Object.entries(truth)) {
    if (t.verdict !== "sat" && !withUnsat) continue;
    const [net, prop] = key.split("|");
    instances.push({ dir, net, prop, verdict: t.verdict });
  }
}

const models = new Map();
async function model(dir, net) {
  const k = join(dir, "onnx", net);
  if (!models.has(k)) models.set(k, await load(new Uint8Array(readFileSync(k))));
  return models.get(k);
}

const stats = VARIANTS.map(() => ({ found: 0, falseCe: 0, time: 0 }));
const missedBy = VARIANTS.map(() => []);
for (const inst of instances) {
  const { x, label, eps } = recoverPoint(readFileSync(join(inst.dir, "vnnlib", inst.prop), "utf8"));
  const { model: m, checker } = await model(inst.dir, inst.net);
  const cells = [];
  for (const [vi, v] of VARIANTS.entries()) {
    const r = await runPointsCheck({
      tf,
      model: m,
      checker,
      points: { inputs: [x], labels: [label] },
      settings: {
        task: "classification",
        epsilon: eps,
        seed: 0,
        restarts: v.restarts,
        steps: v.steps,
        targeted: v.targeted,
        schedule: v.schedule,
        selfTestSamples: 1,
        domainLo: new Array(x.length).fill(0),
        domainHi: new Array(x.length).fill(1),
      },
    });
    const found = r.rows[0].broken;
    stats[vi].time += r.timeMs;
    if (found && inst.verdict === "sat") stats[vi].found++;
    if (found && inst.verdict === "unsat") stats[vi].falseCe++;
    if (!found && inst.verdict === "sat") missedBy[vi].push(`${basename(inst.dir)}/${inst.net}/${inst.prop}`);
    cells.push(found ? "x" : ".");
  }
  console.log(`${inst.verdict.padEnd(5)} ${basename(inst.dir)}/${inst.net}/${inst.prop}  ${cells.join(" ")}`);
}

const nSat = instances.filter((i) => i.verdict === "sat").length;
console.log(`\n${nSat} published-sat instances${withUnsat ? `, ${instances.length - nSat} published-unsat` : ""}`);
VARIANTS.forEach((v, i) => {
  const s = stats[i];
  console.log(
    `${v.name.padEnd(32)} found ${String(s.found).padStart(3)}/${nSat}` +
      (withUnsat ? `  false CEs ${s.falseCe}` : "") +
      `  total ${(s.time / 1000).toFixed(1)} s`,
  );
});
console.log("\nMissed by the strongest variant:", missedBy[VARIANTS.length - 1]);
