// Validate certification + attack (what the page runs) on the built-in
// benchmarks against their published verdicts.
//
//   cd robustness-calculator && npm install
//   node tests/benchmarks/crown.js [--tasks=classification,properties] [--benchmarks=mnist_fc-256x6,...] [--eps=0.03,0.05] [--certifier=crown|acrown-lite]
//
// Defaults: every benchmark in src/spec/benchmark.js, at every ε with
// published verdicts, with the page's default attack settings. Files are
// downloaded once into robustness-calculator/.bench-cache/ (git-ignored).
//
// Checks, per point:
//   - certified ⇒ the published verdict is not "sat" (soundness of CROWN);
//   - counterexample ⇒ the published verdict is not "unsat" (soundness of the attack);
//   - the CROWN bound ≤ the margin at the image (a concrete point in the box).

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tf, load } from "../helpers/setup.js";
import { parseOnnxModel } from "../../src/onnx/onnx-model.js";
import { buildReluChain } from "../../src/bounds/crown.js";
import { BENCHMARKS, pointFromProperty } from "../../src/spec/benchmark.js";
import { runPointsCheck } from "../../src/attack/run-points.js";
import { runPropertySet } from "../../src/attack/run-properties.js";
import { ATTACK_DEFAULTS } from "../../src/attack/defaults.js";
import { parseVnnlib } from "../../src/spec/vnnlib.js";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const only = arg("benchmarks")?.split(",");
const epsFilter = arg("eps")?.split(",");
const tasks = arg("tasks")?.split(",");
const certifier = arg("certifier") ?? "crown";

const CACHE = new URL("../../.bench-cache/", import.meta.url);
mkdirSync(CACHE, { recursive: true });
async function cached(url) {
  const file = new URL(url.split("/benchmarks/")[1].replace(/\//g, "_").replace(/\.gz$/, ""), CACHE);
  if (!existsSync(file)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: ${url} (${res.status})`);
    writeFileSync(file, gunzipSync(Buffer.from(await res.arrayBuffer())));
  }
  return readFileSync(file);
}

const newTotals = () => ({ points: 0, certified: 0, counterexample: 0, unknown: 0, violations: 0, published: { unsat: 0, sat: 0, unknown: 0 }, certifiedOfUnsat: 0, foundOfSat: 0, decidedUnknown: 0 });
const allTotals = {};

/** Compare per-point statuses with published verdicts; returns the status line. */
function tally(totals, b, label, rows, verdicts) {
  return rows.map((row, i) => {
    const v = verdicts[i];
    totals.points++;
    totals[row.status]++;
    totals.published[v]++;
    if (row.status === "certified" && v === "unsat") totals.certifiedOfUnsat++;
    if (row.status === "counterexample" && v === "sat") totals.foundOfSat++;
    if (row.status !== "unknown" && v === "unknown") totals.decidedUnknown++;
    const bad = (row.status === "certified" && v === "sat") || (row.status === "counterexample" && v === "unsat");
    if (bad) {
      totals.violations++;
      console.log(`  *** VIOLATION: ${b.id} ${label} ${b.imageNames[i]}: tool says ${row.status}, published ${v}`);
    }
    return { certified: "C", counterexample: "x", unknown: "." }[row.status];
  });
}

for (const b of BENCHMARKS.filter((b) => (!only || only.includes(b.id)) && (!tasks || tasks.includes(b.task)))) {
  const totals = (allTotals[b.task] ??= newTotals());
  const bytes = new Uint8Array(await cached(b.modelUrl));
  const { model, checker } = await load(bytes);
  const chainResult = buildReluChain(parseOnnxModel(bytes), model.featureShape);
  if (chainResult.error) throw new Error(`${b.id}: ${chainResult.error}`);
  const texts = await Promise.all(b.propertyUrls.map(async (u) => (await cached(u)).toString("utf8")));

  if (b.kind === "properties") {
    const verdicts = b.reference.verdicts.all;
    const t0 = Date.now();
    const r = await runPropertySet({
      tf,
      model,
      checker,
      chain: chainResult,
      properties: texts.map((t, i) => ({ name: b.imageNames[i], spec: parseVnnlib(t) })),
      settings: { seed: 0, ...ATTACK_DEFAULTS.properties, schedule: "apgd", certifier },
    });
    const line = tally(totals, b, "", r.rows, verdicts);
    const n = r.rows.length;
    const pub = verdicts.filter((v) => v === "unsat").length;
    const und = verdicts.filter((v) => v === "unknown").length;
    const pct = (k) => `${((k / n) * 100).toFixed(1)}%`;
    console.log(
      `${b.id.padEnd(32)} tool ${line.join("")}  published ${verdicts.map((v) => ({ unsat: "u", sat: "s", unknown: "?" })[v]).join("")}  ` +
        `safe share: tool [${pct(r.summary.certifiedCount)}, ${pct(n - r.summary.counterexampleCount)}], published ${und ? `${pct(pub)}–${pct(pub + und)}` : pct(pub)}  ` +
        `(${((Date.now() - t0) / 1000).toFixed(1)} s)`,
    );
    continue;
  }

  const pts = texts.map((t) => pointFromProperty(t, b.propertyEpsilon, { snap: b.snapPixels }));
  const points = { inputs: pts.map((p) => p.x), labels: pts.map((p) => p.label) };

  for (const [epsText, verdicts] of Object.entries(b.reference.verdicts)) {
    if (epsFilter && !epsFilter.includes(epsText)) continue;
    const t0 = Date.now();
    const r = await runPointsCheck({
      tf,
      model,
      checker,
      points,
      chain: chainResult,
      settings: {
        task: "classification",
        epsilon: Number(epsText),
        seed: 0,
        ...ATTACK_DEFAULTS.points,
        schedule: "apgd",
        certifier,
        domainLo: new Array(model.inputSize).fill(0),
        domainHi: new Array(model.inputSize).fill(1),
      },
    });
    const line = tally(totals, b, `ε=${epsText}`, r.rows, verdicts);
    const n = r.rows.length;
    const pub = verdicts.filter((v) => v === "unsat").length;
    const und = verdicts.filter((v) => v === "unknown").length;
    const pct = (k) => `${((k / n) * 100).toFixed(1)}%`;
    console.log(
      `${b.id.padEnd(18)} ε=${epsText.padEnd(4)} tool ${line.join("")}  published ${verdicts.map((v) => ({ unsat: "u", sat: "s", unknown: "?" })[v]).join("")}  ` +
        `robust accuracy: tool [${pct(r.summary.certifiedCount)}, ${pct(n - r.summary.brokenCount)}], published ${und ? `${pct(pub)}–${pct(pub + und)}` : pct(pub)}  ` +
        `(${((Date.now() - t0) / 1000).toFixed(0)} s)`,
    );
  }
}

console.log(`\nCertification method: ${certifier}.`);
console.log("Legend: C = certified, x = counterexample, . = unknown; u = published safe/robust, s = published not, ? = undecided.");
for (const [task, t] of Object.entries(allTotals)) {
  console.log(`
[${task}] ${t.points} instances: ${t.certified} certified, ${t.counterexample} counterexamples, ${t.unknown} unknown.
Published safe instances certified: ${t.certifiedOfUnsat}/${t.published.unsat}. Published unsafe instances with a counterexample: ${t.foundOfSat}/${t.published.sat}.
Undecided instances the tool decided: ${t.decidedUnknown}/${t.published.unknown}.
Soundness violations: ${t.violations}.`);
}
