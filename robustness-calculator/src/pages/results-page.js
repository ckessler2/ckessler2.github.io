import { el, para, list } from "../components/prose.js";
import { createStatGrid } from "../components/stats.js";
import { createSplitBars } from "../components/split-bars.js";
import { BENCHMARKS } from "../spec/benchmark.js";

export function renderResultsPage() {
  const card = el("article", "page-card prose");

  // Published verdict counts over the same images, from src/spec/benchmark.js.
  const PUBLISHED_TOTALS = { certified: 0, counterexample: 0, unknown: 0 };
  for (const b of BENCHMARKS) {
    for (const verdicts of Object.values(b.reference.verdicts)) {
      for (const v of verdicts) PUBLISHED_TOTALS[{ unsat: "certified", sat: "counterexample", unknown: "unknown" }[v]]++;
    }
  }

  // Results of tests/benchmarks/crown.js at the default settings
  // (R = 10, K = 50, APGD, seed 0, CPU backend).
  const results = [
    ["2022 mnist_fc, 6×256", "0.03", 15, 9, 1, 5, "60.0–93.3%", "93.3%"],
    ["2022 mnist_fc, 6×256", "0.05", 15, 0, 1, 14, "0.0–93.3%", "80.0–86.7%"],
    ["2022 mnist_fc, 4×256", "0.03", 15, 10, 1, 4, "66.7–93.3%", "93.3%"],
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
  const head = ["Benchmark", "ε", "Images", "Certified", "Counterexample", "Unknown", "Tool’s range", "Published"];
  const table = el("table", "data-table");
  const thead = el("thead");
  const hr = el("tr");
  head.forEach((h) => hr.append(el("th", "", h)));
  thead.append(hr);
  const tbody = el("tbody");
  for (const row of results) {
    const tr = el("tr");
    row.forEach((v) => tr.append(el("td", "", String(v))));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  const wrap = el("div", "table-wrap results-table");
  wrap.append(table);

  // Totals over all settings, computed from the table rows.
  const sum = (i) => results.reduce((a, r) => a + r[i], 0);
  const images = sum(2);
  const tool = { certified: sum(3), counterexample: sum(4), unknown: sum(5) };
  const published = PUBLISHED_TOTALS;
  const exact = results.filter((r) => r[6] === r[7]).length;

  card.append(
    el("h2", "", "Classification benchmarks"),
    para(
      `ε-ball classification on ${results.length} published VNN-COMP settings (${images} images), at the default settings, against the verdicts of the competitions' complete verifiers.`,
    ),
    createStatGrid([
      { label: "Contradictions with published verdicts", value: `0 of ${images} images` },
      { label: "Tool's range contains the published result", value: `${results.length} of ${results.length} settings` },
      { label: "Exact, or exactly the published range", value: `${exact} of ${results.length} settings` },
      {
        label: "Published answers recovered",
        value: `${tool.certified}/${published.certified} robust · ${tool.counterexample}/${published.counterexample} not robust`,
      },
    ]),
    createSplitBars({
      parts: [
        { key: "certified", label: "Certified robust" },
        { key: "counterexample", label: "Counterexample (not robust)" },
        { key: "unknown", label: "Unknown" },
      ],
      rows: [
        { label: "This tool", values: tool },
        { label: "Published verifiers", values: published },
      ],
      caption:
        "The same images, decided by this tool and by the competitions' complete verifiers (published: proven robust, counterexample, or undecided). The tool leaves more images unknown, but every image it decides agrees with the published verdict.",
    }),
    wrap,
    list([
      "Useful: in 10 of the 18 settings the tool gives the exact answer or exactly the published range, in seconds to a minute. This includes the linear MalBeWare classifier (CROWN is exact for a linear model), the set-trained CORA MNIST network, and the CORA SVHN networks, where every image has a counterexample. Overall it certifies 98 of the 142 published-robust images and finds counterexamples for 145 of the 150 published-non-robust ones.",
      "Limited: at ε = 0.05 on the standard-trained 2022 networks, CROWN certifies almost nothing, so the range is wide (for example 0.0–93.3%). The attack misses 5 published counterexamples (for example 2 on CORA CIFAR-10 trades, whose range therefore reaches 30% against at most 20% published). None of the 28 images that no verifier decided is decided by the tool either.",
      "The page runs the attack with WebGL by default, which can find slightly different counterexamples than the CPU run behind this table; certification is unaffected.",
    ]),
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
      "All checks can be rerun with the scripts in tests/benchmarks/ (crown.js for the table above) and npm test.",
    ]),
  );

  return card;
}
