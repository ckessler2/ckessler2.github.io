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

/** Key figures, the tool-vs-published bars and the per-setting table for one task. */
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
      { label: "Tool's range contains the published result", value: `${rows.length} of ${rows.length} settings` },
      { label: "Exact, or exactly the published range", value: `${exact} of ${rows.length} settings` },
      {
        label: "Published answers recovered",
        value: `${((tool.certified / published.certified) * 100).toFixed(1)}% ${words.safe} · ${((tool.counterexample / published.counterexample) * 100).toFixed(1)}% ${words.unsafe}`,
        title: `${tool.certified} of ${published.certified} published-${words.safe} certified; ${tool.counterexample} of ${published.counterexample} published counterexamples found`,
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
      caption: `The same ${words.units.toLowerCase()}, decided by this tool and by the competitions' complete verifiers (published: proven ${words.safe}, counterexample, or undecided). The tool leaves more unknown, but everything it decides agrees with the published verdict.`,
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
      intro: (k, n) => `ε-ball classification on ${k} published VNN-COMP settings (${n} images), at the default settings, against the verdicts of the competitions' complete verifiers.`,
      rows: CLASSIFICATION,
      task: "classification",
      words: { setting: "ε", units: "Images", safe: "robust", unsafe: "not robust" },
      notes: [
        "Useful: in 10 of the 18 settings the tool gives the exact answer or exactly the published range, in seconds to a minute. This includes the linear MalBeWare classifier (CROWN is exact for a linear model), the set-trained CORA MNIST network, and the CORA SVHN networks, where every image has a counterexample. Overall it certifies 99 of the 142 published-robust images and finds counterexamples for 145 of the 150 published-non-robust ones.",
        "Limited: at ε = 0.05 on the standard-trained 2022 networks, CROWN certifies almost nothing, so the range is wide (for example 0.0–93.3%). The attack misses 5 published counterexamples (for example 2 on CORA CIFAR-10 trades, whose range therefore reaches 30% against at most 20% published). None of the 28 images that no verifier decided is decided by the tool either.",
        "The page runs the attack with WebGL by default, which can find slightly different counterexamples than the CPU run behind this table; certification is unaffected.",
      ],
    }),
    ...benchmarkSection({
      title: "Regression benchmarks",
      intro: (k, n) => `Published regression properties (an input box and an unsafe condition on the outputs) in ${k} settings (${n} properties), at the default settings, against the verdicts of the competitions' complete verifiers.`,
      rows: REGRESSION,
      task: "properties",
      words: { setting: "Setting", units: "Properties", safe: "safe", unsafe: "unsafe" },
      notes: [
        "Useful: in 13 of the 17 settings the tool gives the exact answer. The convolutional Collins RUL networks are decided completely in 10 of their 12 settings, in seconds to a minute; every learned-index property is certified; and the Van der Pol setting is decided completely, with input splitting certifying all 9 safe properties (the inputs are only three-dimensional) and the attack finding all 3 counterexamples.",
        "Limited: the reach_prob_density properties have large input boxes. For ground-collision avoidance (14 inputs) and the robot (5 inputs), CROWN certifies nothing and there are too many inputs for splitting, although the attack finds all 4 and 4 of the 7 published counterexamples (the robot's other 3 were not analysed). On the larger Collins network (window 40) with 8–16 perturbed readings, the wide convolution layers use interval bounds and several properties stay unknown.",
        "The six largest learned-index properties (3,000–60,000 key ranges each) are left out as too large for a quick in-browser check.",
      ],
    }),
  );

  card.append(
    el("h2", "", "Where the gaps come from"),
    para(
      "The tool is built to be fast rather than complete, and its gaps have two sources. The clearest example is the 2022 mnist_fc 6×256 network at ε = 0.05, where the tool reports 0.0–93.3% against a published 80.0–86.7%.",
    ),
    list([
      "Lower bound: certification (CROWN). None of the 12 published-robust images is certified. At this ε, roughly 750–1,300 of the network's 1,536 ReLUs are unstable (their input can take either sign inside the ε-ball). Each is replaced by a loose linear bound, and the looseness compounds over six layers, so the margin bounds come out between about −300 and −16,000 while the true margins are around +0.8. No setting changes this. Closing it would need optimised relaxations (α-CROWN) or branch and bound, which is how the published verifiers proved these images, at far more than a few seconds per image. The “ε range” option under Advanced still shows how far CROWN does reach, for example certified up to ε ≈ 0.021 and 0.030 for two of these images.",
      "Upper bound: the attack (PGD). One published counterexample (image prop_1) is missed. Along the line from the image to the counterexample, the margin first rises and then drops sharply, so the gradient leads every start away from it. 1,000 restarts, 500 steps, either step schedule, per-class targeted attacks and 2,000 random points or box corners all failed to find it. A gradient-free Square Attack found it once, after about 56,000 queries, but not reliably, so it is not included. The attack misses 5 of the 150 published counterexamples in total; only this one was analysed.",
      "Images that no published verifier decided (28) are not decided by the tool either.",
    ]),

    el("h2", "", "Other checks"),
    list([
      "Small 2-input network with exact ground truth (branch and bound): the attack finds every non-robust point, the breaking ε is never below the exact value and at most 0.7% above it, and CROWN certifies 134 of 142 robust (point, ε) pairs and never a non-robust one.",
      "Translation: it agrees with onnxruntime-web to within 2·10⁻⁵ relative on all 45 ACAS Xu networks, and the merged layer chain matches onnxruntime on the benchmark networks and on ACAS Xu.",
      "All checks can be rerun with the scripts in tests/benchmarks/ (crown.js for both tables above) and npm test.",
    ]),
  );

  return card;
}
