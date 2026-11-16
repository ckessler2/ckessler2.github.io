// Triage experiment: can cheap signals from the PGD run predict which
// ε-balls hide a counterexample that PGD misses but a gradient-free random
// search (Square Attack) finds?
//
//   cd robustness-calculator && npm install
//   node tests/benchmarks/triage.js [--nets=256x6] [--eps=0.03,0.05]
//        [--budget=60000] [--chains=100] [--p-init=0.8] [--seed=0]
//
// Downloads the VNN-COMP 2022 mnist_fc files it needs (pinned commit) into
// robustness-calculator/.bench-cache/ (git-ignored). For every instance it:
//   1. runs the tool's PGD at the page defaults (R=10, K=50, APGD schedule);
//   2. records cheap signals: clean margin, best margin PGD reached, relative
//      drop, and the first-order (gradient) prediction of the largest drop;
//   3. if PGD found nothing, runs an L∞ Square Attack (Andriushchenko et al.,
//      2020) with large initial patches, and records its best margin after
//      1k / 5k / 20k / all queries and when it first finds a confirmed
//      counterexample (re-checked with onnxruntime, as in the tool).
// Prints one line per instance plus a summary, and writes a CSV next to the
// cache. Published verdicts: VNN-COMP 2022 results (s = sat, u = unsat,
// ? = every verifier timed out).

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tf, load } from "../helpers/setup.js";
import { parseVnnlib } from "../../src/spec/vnnlib.js";
import { pointFromProperty } from "../../src/spec/benchmark.js";
import { runPointsCheck } from "../../src/attack/run-points.js";
import { createRng } from "../../src/attack/rng.js";

const arg = (name, dflt) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? dflt;
const NETS = arg("nets", "256x6").split(",");
const EPSS = arg("eps", "0.03,0.05").split(",");
const BUDGET = Number(arg("budget", 60000));
const CHAINS = Number(arg("chains", 100));
const P_INIT = Number(arg("p-init", 0.8));
const SEED = Number(arg("seed", 0));

const VERDICTS = {
  "256x2": { "0.03": "ussuuuuuuuuusuu", "0.05": "sssusssusuuusuu" },
  "256x4": { "0.03": "usuuuuuuuuuuuuu", "0.05": "usuuuususuuuuuu" },
  "256x6": { "0.03": "uuuuuusuuuuuuuu", "0.05": "usuuuus?uuuuuuu" },
};

const COMMIT = "ac970c9360423840f9f83a294cff55672fda454c";
const BASE = `https://raw.githubusercontent.com/VNN-COMP/vnncomp2022_benchmarks/${COMMIT}/benchmarks/mnist_fc`;
const CACHE = new URL("../../.bench-cache/", import.meta.url);
mkdirSync(CACHE, { recursive: true });

async function cached(path) {
  const file = new URL(path.replace(/\//g, "_").replace(/\.gz$/, ""), CACHE);
  if (!existsSync(file)) {
    const res = await fetch(`${BASE}/${path}`);
    if (!res.ok) throw new Error(`download failed: ${path} (${res.status})`);
    writeFileSync(file, gunzipSync(Buffer.from(await res.arrayBuffer())));
  }
  return readFileSync(file);
}

/** L∞ Square Attack on a 28×28 image, CHAINS parallel chains, gradient-free. */
async function squareAttack(model, checker, xs, lo, hi, label) {
  const n = 784;
  const side = 28;
  const rng = createRng(SEED);
  const iters = Math.max(1, Math.floor(BUDGET / CHAINS));
  const margins = (X, B) =>
    tf.tidy(() => model.forward(tf.tensor2d(X, [B, n])).arraySync().map((r) => r[label] - Math.max(...r.filter((_, k) => k !== label))));
  // Patch-size schedule of the paper (halvings at these of 10k iterations), rescaled.
  const marks = [10, 50, 200, 500, 1000, 2000, 4000, 6000, 8000].map((v) => Math.floor((v / 10000) * iters));
  const patch = (it) => Math.max(1, Math.round(Math.sqrt((P_INIT / 2 ** marks.filter((v) => it > v).length) * n)));

  // Initialise each chain at vertical stripes of ±ε.
  const X = new Float32Array(CHAINS * n);
  for (let b = 0; b < CHAINS; b++) {
    for (let c = 0; c < side; c++) {
      const up = rng() < 0.5;
      for (let r = 0; r < side; r++) X[b * n + r * side + c] = up ? hi[r * side + c] : lo[r * side + c];
    }
  }
  let m = margins(X, CHAINS);
  const at = {};
  let foundAt = null;
  for (let it = 0; it < iters; it++) {
    const h = patch(it);
    const Xn = X.slice();
    for (let b = 0; b < CHAINS; b++) {
      const r0 = Math.floor(rng() * (side - h + 1));
      const c0 = Math.floor(rng() * (side - h + 1));
      const up = rng() < 0.5;
      for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + h; c++) Xn[b * n + r * side + c] = up ? hi[r * side + c] : lo[r * side + c];
    }
    const mn = margins(Xn, CHAINS);
    for (let b = 0; b < CHAINS; b++) {
      if (mn[b] < m[b]) {
        m[b] = mn[b];
        X.set(Xn.subarray(b * n, (b + 1) * n), b * n);
      }
    }
    const queries = (it + 1) * CHAINS;
    for (const q of [1000, 5000, 20000]) if (queries >= q && at[q] === undefined) at[q] = Math.min(...m);
    const k = m.findIndex((v) => v < 0);
    if (k >= 0) {
      const y = Array.from(await checker.evaluate(X.slice(k * n, (k + 1) * n)));
      if (y.some((v, q) => q !== label && v > y[label])) {
        foundAt = queries;
        break;
      }
    }
  }
  return { foundAt, best: Math.min(...m), at };
}

const rows = [];
const models = {};
for (const net of NETS) {
  for (const e of EPSS) {
    for (let i = 0; i < 15; i++) {
      const verdict = { s: "sat", u: "unsat", "?": "unknown" }[VERDICTS[net][e][i]];
      models[net] ??= await load(new Uint8Array(await cached(`onnx/mnist-net_${net}.onnx.gz`)));
      const { model, checker } = models[net];
      const eps = Number(e);
      const text = (await cached(`vnnlib/prop_${i}_${e}.vnnlib.gz`)).toString("utf8");
      const { lo, hi } = parseVnnlib(text).regions[0];
      const { x: xs, label } = pointFromProperty(text, eps, { snap: true });

      // Clean margin and gradient at the image.
      const { m0, linDrop } = tf.tidy(() => {
        const x = tf.tensor2d(Float32Array.from(xs), [1, 784]);
        const mask = tf.oneHot([label], 10).toBool();
        const f = (xx) => {
          const y = model.forward(xx);
          return tf.sub(tf.sum(tf.slice(y, [0, label], [1, 1])), tf.max(tf.where(mask, tf.fill([1, 10], -Infinity), y)));
        };
        const { value, grad } = tf.valueAndGrad(f)(x);
        const g = grad.dataSync();
        // First-order prediction of the largest margin drop over the box.
        let drop = 0;
        for (let k = 0; k < 784; k++) drop += g[k] > 0 ? g[k] * (xs[k] - lo[k]) : -g[k] * (hi[k] - xs[k]);
        return { m0: value.dataSync()[0], linDrop: drop };
      });

      let t = Date.now();
      const p = await runPointsCheck({
        tf,
        model,
        checker,
        points: { inputs: [xs], labels: [label] },
        settings: {
          task: "classification",
          epsilon: eps,
          seed: SEED,
          restarts: 10,
          steps: 50,
          schedule: "apgd",
          selfTestSamples: 1,
          domainLo: new Array(784).fill(0),
          domainHi: new Array(784).fill(1),
        },
      });
      const pgdTime = (Date.now() - t) / 1000;
      const pgdFound = p.rows[0].broken;
      const pgdBest = p.rows[0].bestMargin;

      let sq = null;
      let sqTime = 0;
      if (!pgdFound) {
        t = Date.now();
        sq = await squareAttack(model, checker, xs, lo, hi, label);
        sqTime = (Date.now() - t) / 1000;
      }

      const row = {
        net,
        eps: e,
        image: i,
        verdict,
        cleanMargin: m0,
        pgdBest,
        pgdRelDrop: (m0 - pgdBest) / m0,
        linDropOverMargin: linDrop / m0,
        pgdFound,
        pgdTime,
        squareFoundAt: sq?.foundAt ?? "",
        squareBest: sq ? sq.best : "",
        squareBest1k: sq?.at[1000] ?? "",
        squareBest5k: sq?.at[5000] ?? "",
        squareBest20k: sq?.at[20000] ?? "",
        squareTime: sqTime,
      };
      rows.push(row);
      const f = (v) => (typeof v === "number" ? v.toFixed(3) : String(v));
      console.log(
        `${net} eps=${e} img=${String(i).padStart(2)} ${verdict.padEnd(7)} ` +
          `clean=${f(m0)} pgdBest=${f(pgdBest)} drop=${f(row.pgdRelDrop)} linDrop/m=${f(row.linDropOverMargin)} ` +
          `PGD:${pgdFound ? "found" : "-    "} ` +
          (sq
            ? `SQUARE:${sq.foundAt ? `found@${sq.foundAt}` : "-"} best=${f(sq.best)} (1k ${f(sq.at[1000] ?? NaN)}, 5k ${f(sq.at[5000] ?? NaN)}, 20k ${f(sq.at[20000] ?? NaN)})`
            : "") +
          ` [${(pgdTime + sqTime).toFixed(1)} s]`,
      );
    }
  }
}

// Summary
const sat = rows.filter((r) => r.verdict === "sat");
const pgdOnly = sat.filter((r) => r.pgdFound).length;
const both = sat.filter((r) => r.pgdFound || r.squareFoundAt).length;
const falseCe = rows.filter((r) => r.verdict === "unsat" && (r.pgdFound || r.squareFoundAt)).length;
const newOnUnknown = rows.filter((r) => r.verdict === "unknown" && (r.pgdFound || r.squareFoundAt)).length;
console.log(`\n${rows.length} instances: ${sat.length} published sat, ${rows.filter((r) => r.verdict === "unsat").length} unsat, ${rows.filter((r) => r.verdict === "unknown").length} unknown`);
console.log(`PGD found ${pgdOnly}/${sat.length}; PGD + Square found ${both}/${sat.length}; counterexamples on published-unsat: ${falseCe}; on unknown: ${newOnUnknown}`);
console.log(`time: PGD ${rows.reduce((a, r) => a + r.pgdTime, 0).toFixed(0)} s, Square ${rows.reduce((a, r) => a + r.squareTime, 0).toFixed(0)} s`);
console.log("\nSignals, PGD-unbroken instances (look for a value that separates Square successes from the rest):");
for (const r of rows.filter((r) => !r.pgdFound)) {
  console.log(
    `  ${r.net} eps=${r.eps} img=${String(r.image).padStart(2)} ${r.verdict.padEnd(7)} square=${(r.squareFoundAt ? "FOUND" : "-").padEnd(5)} ` +
      `clean=${r.cleanMargin.toFixed(3)} pgdDrop=${r.pgdRelDrop.toFixed(3)} linDrop/m=${r.linDropOverMargin.toFixed(3)} sq1k=${Number(r.squareBest1k).toFixed(3)} sq5k=${Number(r.squareBest5k).toFixed(3)}`,
  );
}

const out = new URL(`triage-${NETS.join("+")}-${BUDGET}.csv`, CACHE);
const cols = Object.keys(rows[0]);
writeFileSync(out, [cols.join(","), ...rows.map((r) => cols.map((c) => r[c]).join(","))].join("\n") + "\n");
console.log(`\nCSV: ${out.pathname}`);
