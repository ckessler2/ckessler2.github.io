import { el, para, list } from "../components/prose.js";
import { createStatGrid } from "../components/stats.js";
import { createSplitBars } from "../components/split-bars.js";
import { BENCHMARKS } from "../spec/benchmark.js";

// Results of tests/benchmarks/crown.js at the default settings (APGD,
// seed 0, CPU backend; R = 10, K = 50 for classification and R = 400,
// K = 200 for regression properties). Each row:
// [benchmark, setting, instances, certified, counterexamples, unknown, tool's range, published].
const CLASSIFICATION = [
    ["2022 mnist_fc, 6×256", "0.03", 15, 9, 1, 5, "60.0–93.3%", "93.3%"],
    ["2022 mnist_fc, 6×256", "0.05", 15, 0, 1, 14, "0.0–93.3%", "80.0–86.7%"],
    ["2022 mnist_fc, 4×256", "0.03", 15, 11, 1, 3, "73.3–93.3%", "93.3%"],
    ["2022 mnist_fc, 4×256", "0.05", 15, 0, 3, 12, "0.0–80.0%", "80.0%"],
    ["2022 mnist_fc, 2×256", "0.03", 15, 9, 2, 4, "60.0–86.7%", "80.0%"],
    ["2022 mnist_fc, 2×256", "0.05", 15, 1, 7, 7, "6.7–53.3%", "46.7%"],
    ["2025 CORA MNIST, set", "0.1", 20, 19, 1, 0, "95.0%", "95.0%"],
    ["2025 CORA MNIST, point", "0.1", 20, 0, 18, 2, "0.0–10.0%", "0.0–10.0%"],
    ["2025 CORA MNIST, trades", "0.1", 20, 0, 2, 18, "0.0–90.0%", "0.0–90.0%"],
    ["2025 CORA SVHN, set", "0.1", 20, 0, 20, 0, "0.0%", "0.0%"],
    ["2025 CORA SVHN, point", "0.1", 20, 0, 20, 0, "0.0%", "0.0%"],
    ["2025 CORA SVHN, trades", "0.1", 20, 0, 20, 0, "0.0%", "0.0%"],
    ["2025 CORA CIFAR-10, set", "2/255", 20, 1, 15, 4, "5.0–25.0%", "15.0–25.0%"],
    ["2025 CORA CIFAR-10, point", "2/255", 20, 0, 19, 1, "0.0–5.0%", "0.0–5.0%"],
    ["2025 CORA CIFAR-10, trades", "2/255", 20, 0, 14, 6, "0.0–30.0%", "0.0–20.0%"],
    ["2025 MalBeWare, linear", "1/255", 14, 14, 0, 0, "100.0%", "100.0%"],
    ["2025 MalBeWare, linear", "2/255", 19, 19, 0, 0, "100.0%", "100.0%"],
    ["2025 MalBeWare, linear", "3/255", 17, 16, 1, 0, "94.1%", "94.1%"],
];

const REGRESSION = [
    ["2025 Collins RUL, small, window 20", "2 perturbed", 4, 3, 1, 0, "75.0%", "75.0%"],
    ["2025 Collins RUL, small, window 20", "4 perturbed", 4, 0, 4, 0, "0.0%", "0.0%"],
    ["2025 Collins RUL, small, window 20", "8 perturbed", 4, 4, 0, 0, "100.0%", "100.0%"],
    ["2025 Collins RUL, small, window 20", "16 perturbed", 4, 2, 2, 0, "50.0%", "50.0%"],
    ["2025 Collins RUL, full, window 20", "2 perturbed", 4, 3, 1, 0, "75.0%", "75.0%"],
    ["2025 Collins RUL, full, window 20", "4 perturbed", 4, 0, 4, 0, "0.0%", "0.0%"],
    ["2025 Collins RUL, full, window 20", "8 perturbed", 4, 4, 0, 0, "100.0%", "100.0%"],
    ["2025 Collins RUL, full, window 20", "16 perturbed", 4, 2, 2, 0, "50.0%", "50.0%"],
    ["2025 Collins RUL, full, window 40", "2 perturbed", 4, 4, 0, 0, "100.0%", "100.0%"],
    ["2025 Collins RUL, full, window 40", "4 perturbed", 4, 1, 3, 0, "25.0%", "25.0%"],
    ["2025 Collins RUL, full, window 40", "8 perturbed", 4, 1, 1, 2, "25.0–75.0%", "75.0%"],
    ["2025 Collins RUL, full, window 40", "16 perturbed", 4, 0, 0, 4, "0.0–100.0%", "100.0%"],
    ["2025 nn4sys learned index", "4 layers", 6, 6, 0, 0, "100.0%", "100.0%"],
    ["2025 nn4sys learned index", "deep", 6, 6, 0, 0, "100.0%", "100.0%"],
    ["2022 reach_prob_density", "ground-collision avoidance", 12, 0, 4, 8, "0.0–66.7%", "66.7%"],
    ["2022 reach_prob_density", "robot", 12, 0, 4, 8, "0.0–66.7%", "41.7%"],
    ["2022 reach_prob_density", "Van der Pol", 12, 9, 3, 0, "75.0%", "75.0%"],
];

/** Published verdict counts for one task, from src/spec/benchmark.js. */
function publishedTotals(task) {
  const totals = { certified: 0, counterexample: 0, unknown: 0 };
  for (const b of BENCHMARKS.filter((bm) => bm.task === task)) {
    for (const verdicts of Object.values(b.reference.verdicts)) {
      for (const v of verdicts) totals[{ unsat: "certified", sat: "counterexample", unknown: "unknown" }[v]]++;
    }
  }
  return totals;
}

/** Key figures, tool-vs-published bars, and a per-benchmark-case table. */
function benchmarkSection({ title, intro, rows, task, words, notes }) {
  const sum = (i) => rows.reduce((a, r) => a + r[i], 0);
  const n = sum(2);
  const tool = { certified: sum(3), counterexample: sum(4), unknown: sum(5) };
  const published = publishedTotals(task);
  const exact = rows.filter((r) => r[6] === r[7]).length;

  const table = el("table", "data-table");
  const hr = el("tr");
  ["Benchmark", words.setting, words.units, "Certified", "Counterexample", "Unknown", "Tool’s range", "Published"].forEach((h) => hr.append(el("th", "", h)));
  const thead = el("thead");
  thead.append(hr);
  const tbody = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    row.forEach((v) => tr.append(el("td", "", String(v))));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  const wrap = el("div", "table-wrap results-table");
  wrap.append(table);

  return [
    el("h2", "", title),
    para(intro(rows.length, n)),
    createStatGrid([
      { label: "Tool's range contains published answer", value: `${rows.length} of ${rows.length} benchmark cases (table rows)` },
      { label: "Exact match (or exact published range)", value: `${exact} of ${rows.length} benchmark cases (table rows)` },
      {
        label: "Published answers recovered",
        value: `${((tool.certified / published.certified) * 100).toFixed(1)}% of published ${words.safe} cases · ${((tool.counterexample / published.counterexample) * 100).toFixed(1)}% of published ${words.unsafe} cases`,
        title: `${tool.certified} of ${published.certified} published ${words.safe} cases certified; ${tool.counterexample} of ${published.counterexample} published ${words.unsafe} cases found`,
      },
    ]),
    createSplitBars({
      parts: [
        { key: "certified", label: `Certified ${words.safe}` },
        { key: "counterexample", label: `Counterexample (${words.unsafe})` },
        { key: "unknown", label: "Unknown" },
      ],
      rows: [
        { label: "This tool", values: tool },
        { label: "Published verifiers", values: published },
      ],
      caption: `Comparison on the same ${words.units.toLowerCase()}: this tool versus the published competition verifiers. "Unknown" means undecided. This tool leaves more unknown cases, but the cases it decides agree with the published verdicts.`,
    }),
    wrap,
    list(notes),
  ];
}

export function renderResultsPage() {
  const card = el("article", "page-card prose");

  card.append(
    ...benchmarkSection({
      title: "Classification benchmarks",
      intro: (k, n) => `ε-ball classification on ${k} published VNN-COMP benchmark cases (${n} images), using the default options. Here, each benchmark case is one table row (a benchmark + its ε/variant). Results are compared with published competition verdicts.`,
      rows: CLASSIFICATION,
      task: "classification",
      words: { setting: "ε", units: "Images", safe: "robust", unsafe: "not robust" },
      notes: [
        "Quick takeaway: the tool is exact (or exactly matches the published range) in 10 of 18 benchmark cases, often in seconds to about a minute.",
        "Where it struggles: at larger ε (especially 2022 mnist_fc at ε = 0.05), certification proves very few images, so the reported range stays wide.",
        "Attack limits: it misses 5 of 150 published non-robust images, so the upper bound can be too high in a few cases (for example CORA CIFAR-10 trades).",
        "Reproducibility note: these tables were produced on CPU. The page defaults to WebGL, which may find slightly different counterexamples, but certification is unchanged.",
      ],
    }),
    ...benchmarkSection({
      title: "Regression benchmarks",
      intro: (k, n) => `Published regression properties in ${k} benchmark cases (${n} properties), using the default options. Here, each benchmark case is one table row (a benchmark + its variant). Results are compared with published competition verdicts.`,
      rows: REGRESSION,
      task: "properties",
      words: { setting: "Case", units: "Properties", safe: "safe", unsafe: "unsafe" },
      notes: [
        "Quick takeaway: the tool gives an exact match in 13 of 17 benchmark cases. Many Collins cases and all included nn4sys cases are fully decided.",
        "Where it struggles: some larger-input cases (especially reach_prob_density and larger Collins window-40 cases) remain unknown.",
        "Scope note: the six largest nn4sys properties are omitted because they are too large for a fast in-browser check.",
      ],
    }),
  );

  card.append(
    el("h2", "", "Where the gaps come from"),
    para(
      "The tool is designed for fast checks in the browser, so some results stay uncertain. The biggest gaps come from two places:",
    ),
    list([
      "Certification gap (lower bound): on harder cases, especially 2022 mnist_fc 6×256 at ε = 0.05, certification proves very few robust images, so the lower bound can be much lower than the published value.",
      "Attack gap (upper bound): the attack can miss some counterexamples. Overall it misses 5 of 150 published non-robust classification images, which can leave the upper bound too high in a few cases.",
      "Undecided cases: if the published complete verifiers were undecided, this tool is usually undecided too (28 classification images).",
    ]),

    el("h2", "", "Other checks"),
    list([
      "Toy-network check (with exact ground truth): the attack finds all non-robust points, and certification never falsely proves a non-robust case.",
      "Model-translation check: the ONNX-to-tf.js translation is cross-checked against onnxruntime-web on ACAS Xu and benchmark networks.",
      "You can rerun these checks with `node tests/benchmarks/crown.js` and `npm test`.",
    ]),
  );

  return card;
}
