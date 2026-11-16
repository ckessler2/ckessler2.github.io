// Validate certification + attack (what the page runs) on the built-in
// benchmarks against their published verdicts.
//
//   cd robustness-calculator && npm install
//   node tests/benchmarks/crown.js [--benchmarks=mnist_fc-256x6,cora-set] [--eps=0.03,0.05]
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

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const only = arg("benchmarks")?.split(",");
const epsFilter = arg("eps")?.split(",");

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

const totals = { points: 0, certified: 0, counterexample: 0, unknown: 0, violations: 0, published: { unsat: 0, sat: 0, unknown: 0 }, certifiedOfUnsat: 0, foundOfSat: 0, decidedUnknown: 0 };

for (const b of BENCHMARKS.filter((b) => !only || only.includes(b.id))) {
  const bytes = new Uint8Array(await cached(b.modelUrl));
  const { model, checker } = await load(bytes);
  const chainResult = buildReluChain(parseOnnxModel(bytes), model.featureShape);
  if (chainResult.error) throw new Error(`${b.id}: ${chainResult.error}`);
  const texts = await Promise.all(b.propertyUrls.map(async (u) => (await cached(u)).toString("utf8")));
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
        restarts: 10,
        steps: 50,
        schedule: "apgd",
        selfTestSamples: 20,
        domainLo: new Array(784).fill(0),
        domainHi: new Array(784).fill(1),
      },
    });
    const line = r.rows.map((row, i) => {
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
        console.log(`  *** VIOLATION: ${b.id} ε=${epsText} ${b.imageNames[i]}: tool says ${row.status}, published ${v}`);
      }
      return { certified: "C", counterexample: "x", unknown: "." }[row.status];
    });
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

console.log(`
Legend: C = certified robust, x = counterexample, . = unknown; u = published robust, s = published not robust, ? = undecided.
${totals.points} points: ${totals.certified} certified, ${totals.counterexample} counterexamples, ${totals.unknown} unknown.
Published robust points certified: ${totals.certifiedOfUnsat}/${totals.published.unsat}. Published non-robust points with a counterexample: ${totals.foundOfSat}/${totals.published.sat}.
Undecided points the tool decided: ${totals.decidedUnknown}/${totals.published.unknown}.
Soundness violations: ${totals.violations}.`);
