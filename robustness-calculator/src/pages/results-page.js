import { el, code } from "../components/prose.js";
import { createSplitBars } from "../components/split-bars.js";
import { info, segmented } from "../components/ui.js";
import { pageTitle, inShort, bullets, table, p } from "../components/docs-layout.js";
import { BENCHMARKS } from "../spec/benchmark.js";

// Results of tests/benchmarks/crown.js at the default settings (APGD,
// seed 0, CPU backend; R = 10, K = 50 for classification and R = 400,
// K = 200 for regression properties). Each row:
// [benchmark, setting, instances, certified, counterexamples, unknown, tool's range, published].
const CLASSIFICATION = [
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
    ["2022 mnist_fc, 6×256", "0.03", 15, 9, 1, 5, "60.0–93.3%", "93.3%"],
    ["2022 mnist_fc, 6×256", "0.05", 15, 0, 1, 14, "0.0–93.3%", "80.0–86.7%"],
    ["2022 mnist_fc, 4×256", "0.03", 15, 11, 1, 3, "73.3–93.3%", "93.3%"],
    ["2022 mnist_fc, 4×256", "0.05", 15, 0, 3, 12, "0.0–80.0%", "80.0%"],
    ["2022 mnist_fc, 2×256", "0.03", 15, 9, 2, 4, "60.0–86.7%", "80.0%"],
    ["2022 mnist_fc, 2×256", "0.05", 15, 1, 7, 7, "6.7–53.3%", "46.7%"],
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

/** Totals for one task: instances, the tool's verdicts, the published ones, exact matches. */
function summarise(rows, task) {
  const sum = (i) => rows.reduce((a, r) => a + r[i], 0);
  return {
    cases: rows.length,
    instances: sum(2),
    tool: { certified: sum(3), counterexample: sum(4), unknown: sum(5) },
    published: publishedTotals(task),
    exact: rows.filter((r) => r[6] === r[7]).length,
  };
}

const TASKS = {
  classification: {
    label: "Classification",
    rows: CLASSIFICATION,
    task: "classification",
    words: { setting: "ε", units: "Images", unit: "images", safe: "robust", unsafe: "not robust" },
    notes: [
      [el("strong", "", "Where it struggles: "), "at larger ε (especially 2022 mnist_fc at ε = 0.05), certification proves very few images, so the range stays wide."],
      [el("strong", "", "Attack limits: "), "it misses 5 of 150 published non-robust images, so the upper bound can be too high in a few cases (for example CORA CIFAR-10 trades)."],
    ],
  },
  properties: {
    label: "Regression",
    rows: REGRESSION,
    task: "properties",
    words: { setting: "Case", units: "Properties", unit: "properties", safe: "safe", unsafe: "unsafe" },
    notes: [
      [el("strong", "", "Fully decided: "), "many Collins cases and all included nn4sys cases."],
      [el("strong", "", "Where it struggles: "), "some larger-input cases (especially reach_prob_density and the larger Collins window-40 cases) remain unknown."],
      [el("strong", "", "Scope: "), "the six largest nn4sys properties are omitted as too large for a fast in-browser check."],
    ],
  },
};

let activeTask = "classification"; // kept across re-renders (e.g. a theme switch)

const pct = (a, b) => (b ? (a / b) * 100 : 0).toFixed(1);

/** A number tile: label with ⓘ, a big value, and a small line of detail. */
function tile({ label, value, unit, sub, help }) {
  const li = el("li", "docs-tile");
  const l = el("span", "docs-tile-label", label);
  if (help) l.append(" ", info(help));
  const v = el("span", "docs-tile-value", value);
  if (unit) v.append(" ", el("span", "docs-tile-unit", unit));
  li.append(l, v);
  if (sub) li.append(el("span", "docs-tile-sub", sub));
  return li;
}

function taskPanel(key) {
  const { rows, task, words, notes } = TASKS[key];
  const t = summarise(rows, task);

  const tiles = el("ul", "docs-tiles");
  tiles.append(
    tile({
      label: "Agrees with published",
      value: `${t.cases} / ${t.cases}`,
      unit: "cases",
      sub: "0 contradictions",
      help: "In every benchmark case the tool's range of robust accuracy overlaps the published answer: no instance the tool decides contradicts a published verdict.",
    }),
    tile({
      label: "Exact match",
      value: `${t.exact} / ${t.cases}`,
      unit: "cases",
      sub: `${pct(t.exact, t.cases)} %`,
      help: "The tool's range equals the published value (or the published range, where verifiers left instances undecided).",
    }),
    tile({
      label: `Recovered: ${words.safe}`,
      value: pct(t.tool.certified, t.published.certified),
      unit: "%",
      sub: `${t.tool.certified} of ${t.published.certified} published ${words.safe}`,
      help: `Share of the published ${words.safe} ${words.unit} that CROWN certified.`,
    }),
    tile({
      label: `Recovered: ${words.unsafe}`,
      value: pct(t.tool.counterexample, t.published.counterexample),
      unit: "%",
      sub: `${t.tool.counterexample} of ${t.published.counterexample} published ${words.unsafe}`,
      help: `Share of the published ${words.unsafe} ${words.unit} for which the attack found a confirmed counterexample.`,
    }),
  );

  const bars = createSplitBars({
    parts: [
      { key: "certified", label: `Certified ${words.safe}` },
      { key: "counterexample", label: `Counterexample (${words.unsafe})` },
      { key: "unknown", label: "Unknown" },
    ],
    rows: [
      { label: "This tool", values: t.tool },
      { label: "Published verifiers", values: t.published },
    ],
  });
  const barsNote = el("p", "docs-figure-note", "Every decided case agrees with the published verdicts. ");
  barsNote.append(
    info(`The same ${t.instances} ${words.unit}, judged by this tool and by the published competition verifiers. Unknown means undecided. This tool leaves more instances unknown, but the ones it decides agree with the published verdicts.`),
  );

  const tableRows = rows.map((r) => {
    const exact = r[6] === r[7];
    const match = el("span", exact ? "is-exact" : "is-range", exact ? "exact" : "contains");
    return [...r.map(String), match];
  });
  const tableNode = table(
    ["Benchmark", words.setting, words.units, "Certified", "Counter­example", "Unknown", "Tool’s range", "Published", "Match"],
    tableRows,
  );

  const left = el("div", "docs-results-col");
  left.append(tiles, bars, barsNote, bullets(notes));
  const right = el("div", "docs-results-col");
  const tableHead = el("h3", "docs-h3", `Per benchmark case (${t.cases} cases, ${t.instances} ${words.unit}) `);
  tableHead.append(info("Each row is one benchmark at one ε or variant. “contains”: the tool's range is wider than the published answer but contains it."));
  right.append(tableHead, tableNode);

  const panel = el("div", "docs-results-panel");
  panel.id = "docs-results-panel";
  panel.setAttribute("role", "tabpanel");
  panel.append(left, right);
  return panel;
}

export function renderResultsPage() {
  const card = el("article", "page-card prose docs-results");

  const c = summarise(CLASSIFICATION, "classification");
  const r = summarise(REGRESSION, "properties");
  const cases = c.cases + r.cases;
  const instances = c.instances + r.instances;

  card.append(
    pageTitle("Results", "Estimate against the published verdicts of the VNN-COMP complete verifiers, on the built-in benchmarks."),
    inShort(
      bullets([
        [el("strong", "", "No contradictions. "), `Across ${instances} instances in ${cases} benchmark cases, every verdict Estimate reaches agrees with the published one.`],
        [
          el("strong", "", `Exact in ${c.exact + r.exact} of ${cases} cases `),
          `(classification ${c.exact}/${c.cases}, regression ${r.exact}/${r.cases}), often in seconds to about a minute. Elsewhere the range is wider but contains the published answer.`,
        ],
        [
          el("strong", "", "Recovers most verdicts. "),
          `${pct(c.tool.certified + r.tool.certified, c.published.certified + r.published.certified)} % of published robust or safe instances are certified; ${pct(c.tool.counterexample + r.tool.counterexample, c.published.counterexample + r.published.counterexample)} % of published not-robust or unsafe ones get a counterexample.`,
        ],
        [el("strong", "", "The gaps "), "are certification at larger ε and on large regression boxes, and a few counterexamples the attack misses."],
      ]),
    ),
  );

  const intro = el("div", "docs-results-intro");
  const switcher = el("div", "docs-results-switch");
  const meta = el("p", "docs-results-meta", "Default settings: APGD, seed 0, CPU backend ");
  meta.append(info("The page defaults to WebGL, which may find slightly different counterexamples; certification is unchanged. Rerun with node tests/benchmarks/crown.js."));
  intro.append(switcher, meta);

  let panel = taskPanel(activeTask);
  const drawSwitch = () => {
    switcher.replaceChildren(
      segmented({
        label: "Benchmark type",
        value: activeTask,
        options: Object.entries(TASKS).map(([value, t]) => ({ value, label: t.label })),
        onChange: (value) => {
          activeTask = value;
          const next = taskPanel(value);
          panel.replaceWith(next);
          panel = next;
          drawSwitch();
        },
      }),
    );
  };
  drawSwitch();
  card.append(intro, panel);

  const closing = el("div", "docs-results-closing");
  const gaps = el("section");
  gaps.append(
    el("h2", "", "Where the gaps come from"),
    p("Built for fast checks in the browser, the tool leaves some cases uncertain, for three reasons:"),
    bullets([
      [el("strong", "", "Certification (lower bound): "), "on harder cases, especially 2022 mnist_fc 6×256 at ε = 0.05, few robust images are proven, so the lower bound can sit far below the published value."],
      [el("strong", "", "Attack (upper bound): "), "it misses 5 of 150 published non-robust classification images, which can leave the upper bound too high in a few cases."],
      [el("strong", "", "Undecided cases: "), `where the published complete verifiers were undecided, this tool usually is too (${c.published.unknown} classification images).`],
    ]),
  );
  const other = el("section");
  other.append(
    el("h2", "", "Other checks"),
    bullets([
      [el("strong", "", "Toy network with exact ground truth: "), "the attack finds every non-robust point, and certification never falsely proves a non-robust case."],
      [el("strong", "", "Model translation: "), "the ONNX-to-tf.js translation is cross-checked against onnxruntime-web on ACAS Xu and the benchmark networks."],
      ["Rerun all of this with ", code("node tests/benchmarks/crown.js"), " and ", code("npm test"), "."],
    ]),
  );
  closing.append(gaps, other);
  card.append(closing);

  return card;
}
