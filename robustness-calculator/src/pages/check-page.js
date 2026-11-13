import { createAccordion } from "../components/accordion.js";
import { createField } from "../components/field.js";
import { createFileInput, readFileBytes, gunzip, stripGz } from "../components/file-input.js";
import { createStatGrid, createDataTable, formatNumber, formatTime } from "../components/stats.js";
import { createEpsilonHistogram } from "../components/histogram.js";
import { downloadTextFile } from "../components/download.js";
import { parseVnnlib } from "../spec/vnnlib.js";
import { TASKS } from "../spec/points.js";
import { DISCLAIMER } from "../attack/report.js";
import { TFJS_VERSION, ORT_VERSION } from "../lib/cdn.js";

const EXAMPLES = {
  vnnlib: {
    label: "Example: VNNLIB property",
    model: "examples/tiny-relu.onnx",
    spec: "examples/tiny-relu-sat.vnnlib",
  },
  points: {
    label: "Example: classifier points",
    model: "examples/mlp-classifier.onnx",
    points: "examples/mlp-points.csv",
  },
};

// DOM nodes the progress callback updates without a full re-render. They are
// reassigned on every render, so a re-render mid-run (e.g. toggling dark
// mode) keeps the progress display alive.
const live = {};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function sectionBlock(title, ...children) {
  const block = el("div", "section-block");
  if (title) block.append(el("h3", "section-heading", title));
  block.append(...children.filter(Boolean));
  return block;
}

function errorText(message) {
  return message ? el("p", "error-text", message) : null;
}

function note(text) {
  return el("p", "section-note", text);
}

function accordion(state, key, title, content, defaultOpen = true) {
  const open = state.getState().accordionState[key] ?? defaultOpen;
  return createAccordion({
    title,
    content,
    open,
    onToggle: (isOpen) => state.setAccordionOpen(key, isOpen),
  });
}

function numberField({ name, label, value, onChange, integer = false, min, placeholder, className }) {
  const { wrapper, input } = createField({ name, label, value });
  if (placeholder) input.placeholder = placeholder;
  if (className) wrapper.classList.add(className);
  input.addEventListener("change", () => {
    const raw = input.value.trim();
    onChange(raw === "" ? "" : integer ? Math.trunc(Number(raw)) : Number(raw));
  });
  if (min !== undefined) input.min = String(min);
  return wrapper;
}

function selectField({ name, label, value, options, onChange }) {
  const { wrapper, input } = createField({ name, label, value, type: "select", options });
  wrapper.classList.add("field-wide-input");
  input.addEventListener("change", () => onChange(input.value));
  return wrapper;
}

function textField({ name, label, value, placeholder, onChange }) {
  const { wrapper, input } = createField({ name, label, value, type: "text" });
  wrapper.classList.add("field-stacked");
  input.placeholder = placeholder ?? "";
  input.addEventListener("change", () => onChange(input.value));
  return wrapper;
}

function describeShape(shape) {
  return `[${shape.map((d) => (d === null ? "?" : d)).join(", ")}]`;
}

// ---------------------------------------------------------------------------
// Loading files

async function loadModelBytes(ctx, fileName, bytes) {
  const { state, worker, rerender } = ctx;
  state.set("model", { fileName, bytes, loading: true });
  state.set("run", { status: "idle" });
  rerender();
  try {
    const summary = await worker.loadModel(bytes);
    state.set("model", { fileName, bytes, summary });
  } catch (err) {
    state.set("model", { fileName, error: err.message });
  }
  rerender();
}

function loadSpecText(ctx, fileName, text) {
  const { state } = ctx;
  try {
    const spec = parseVnnlib(text);
    const summary = {
      numInputs: spec.numInputs,
      numOutputs: spec.numOutputs,
      regions: spec.regions.length,
      disjuncts: spec.regions.reduce((a, r) => a + r.disjuncts.length, 0),
    };
    state.set("vnnlib", { fileName, text, summary });
  } catch (err) {
    state.set("vnnlib", { fileName, error: err.message });
  }
}

function loadPointsText(ctx, fileName, text) {
  const rows = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#")).length;
  ctx.state.set("points", { fileName, text, rows });
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch ${url} (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return url.endsWith(".gz") ? gunzip(bytes) : bytes;
}

async function loadExample(ctx, key) {
  const ex = EXAMPLES[key];
  const { state, rerender } = ctx;
  state.set("mode", key);
  state.set("run", { status: "idle" });
  try {
    if (key === "vnnlib") {
      loadSpecText(ctx, ex.spec.split("/").pop(), new TextDecoder().decode(await fetchBytes(ex.spec)));
    } else {
      loadPointsText(ctx, ex.points.split("/").pop(), new TextDecoder().decode(await fetchBytes(ex.points)));
      state.patch("pointsSettings", { task: "classification", epsilon: 0.1, searchEpsilon: true });
    }
    await loadModelBytes(ctx, ex.model.split("/").pop(), await fetchBytes(ex.model));
  } catch (err) {
    state.set("model", { error: err.message });
    rerender();
  }
}

// ---------------------------------------------------------------------------
// Controls

function renderModelSection(ctx) {
  const { state, rerender } = ctx;
  const { model } = state.getState();
  const content = el("div", "page-flow");

  content.append(
    createFileInput({
      accept: ".onnx,.gz",
      label: "ONNX model file",
      fileName: model?.fileName,
      onFile: async (file) => {
        try {
          await loadModelBytes(ctx, stripGz(file.name), await readFileBytes(file));
        } catch (err) {
          state.set("model", { fileName: file.name, error: err.message });
          rerender();
        }
      },
    }),
  );

  if (model?.loading) content.append(note("Loading the model and the libraries…"));
  if (model?.error) content.append(errorText(model.error));

  const s = model?.summary;
  if (s) {
    const ops = Object.entries(s.opCounts)
      .map(([op, n]) => (n > 1 ? `${op}×${n}` : op))
      .join(", ");
    content.append(
      createStatGrid([
        { label: "Input", value: `${describeShape(s.declaredInputShape)} → ${s.inputSize} features` },
        { label: "Output", value: `${s.outputSize} values` },
        { label: "Parameters", value: s.paramCount.toLocaleString() },
        { label: "Opset", value: String(s.opset) },
      ]),
      note(`Operators: ${ops}`),
    );
    if (s.extraOutputs.length) {
      content.append(note(`The model has several outputs; only "${s.outputName}" is checked.`));
    }
  }

  const examples = el("div", "button-row");
  for (const key of Object.keys(EXAMPLES)) {
    const b = el("button", "secondary-button", EXAMPLES[key].label);
    b.type = "button";
    b.addEventListener("click", () => loadExample(ctx, key));
    examples.append(b);
  }
  content.append(examples);
  return accordion(state, "model", "1 · Model (ONNX)", content);
}

function renderPropertySection(ctx) {
  const { state, rerender } = ctx;
  const s = state.getState();
  const content = el("div", "page-flow");

  content.append(
    selectField({
      name: "mode",
      label: "What to check",
      value: s.mode,
      options: [
        { value: "vnnlib", label: "VNNLIB property" },
        { value: "points", label: "Robustness around points" },
      ],
      onChange: (v) => {
        state.set("mode", v);
        rerender();
      },
    }),
  );

  if (s.mode === "vnnlib") {
    content.append(
      createFileInput({
        accept: ".vnnlib,.gz,.txt,.smt2",
        label: "VNNLIB property file",
        fileName: s.vnnlib?.fileName,
        onFile: async (file) => {
          loadSpecText(ctx, stripGz(file.name), new TextDecoder().decode(await readFileBytes(file)));
          rerender();
        },
      }),
    );
    if (s.vnnlib?.error) content.append(errorText(s.vnnlib.error));
    const v = s.vnnlib?.summary;
    if (v) {
      content.append(
        createStatGrid([
          { label: "Inputs (X)", value: String(v.numInputs) },
          { label: "Outputs (Y)", value: String(v.numOutputs) },
          { label: "Input regions", value: String(v.regions) },
          { label: "Unsafe cases", value: String(v.disjuncts), title: "Disjuncts of the output condition, summed over regions" },
        ]),
      );
      const m = s.model?.summary;
      if (m && (m.inputSize !== v.numInputs || m.outputSize !== v.numOutputs)) {
        content.append(
          errorText(`The property has ${v.numInputs} inputs and ${v.numOutputs} outputs; the model has ${m.inputSize} and ${m.outputSize}.`),
        );
      }
    }
    content.append(
      note("A VNNLIB file describes the unsafe condition. The tool searches the input box for an input that satisfies it."),
    );
  } else {
    const ps = s.pointsSettings;
    const set = (key) => (v) => state.patch("pointsSettings", { [key]: v });
    content.append(
      createFileInput({
        accept: ".csv,.txt,.gz",
        label: "CSV of points",
        fileName: s.points?.fileName && `${s.points.fileName} (${s.points.rows} rows)`,
        onFile: async (file) => {
          loadPointsText(ctx, stripGz(file.name), new TextDecoder().decode(await readFileBytes(file)));
          rerender();
        },
      }),
      note("One point per row: the model's input features (flattened), then, for classification, the class index."),
      selectField({
        name: "task",
        label: "Task",
        value: ps.task,
        options: Object.entries(TASKS).map(([value, label]) => ({ value, label })),
        onChange: (v) => {
          state.patch("pointsSettings", { task: v });
          rerender();
        },
      }),
      numberField({ name: "epsilon", label: "ε (L∞ radius)", value: ps.epsilon, onChange: set("epsilon") }),
    );
    if (ps.task === "regression-standard") {
      content.append(numberField({ name: "delta", label: "δ (allowed output change, L∞)", value: ps.delta, onChange: set("delta") }));
    }
    if (ps.task === "regression-lipschitz") {
      content.append(numberField({ name: "lipschitz", label: "L (allowed Lipschitz constant, L∞→L∞)", value: ps.lipschitz, onChange: set("lipschitz") }));
    }
    if (ps.task === "classification") {
      const label = el("label", "checkbox");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = ps.searchEpsilon;
      cb.addEventListener("change", () => {
        state.patch("pointsSettings", { searchEpsilon: cb.checked });
        rerender();
      });
      label.append(cb, " Find each point's smallest breaking ε (binary search)");
      content.append(label);
      if (ps.searchEpsilon) {
        content.append(numberField({ name: "searchIterations", label: "Bisection steps", value: ps.searchIterations, integer: true, min: 1, onChange: set("searchIterations") }));
      }
    }
    content.append(
      textField({ name: "domainLo", label: "Input domain lower bounds (optional: one value, or one per feature)", value: ps.domainLoText, placeholder: "e.g. 0", onChange: set("domainLoText") }),
      textField({ name: "domainHi", label: "Input domain upper bounds (optional)", value: ps.domainHiText, placeholder: "e.g. 1", onChange: set("domainHiText") }),
      el(
        "p",
        "warning-box",
        "ε is in the model's own input space. If the model expects normalised inputs, give ε (and the points and domain bounds) in normalised units.",
      ),
    );
  }

  return accordion(state, "property", "2 · Property", content);
}

function renderAttackSection(ctx) {
  const { state } = ctx;
  const a = state.getState().attack;
  const set = (key) => (v) => state.patch("attack", { [key]: v });
  const grid = el("div", "field-grid");
  grid.append(
    numberField({ name: "seed", label: "Seed", value: a.seed, integer: true, min: 0, onChange: set("seed") }),
    numberField({ name: "restarts", label: "Random restarts R", value: a.restarts, integer: true, min: 1, onChange: set("restarts") }),
    numberField({ name: "steps", label: "PGD steps K", value: a.steps, integer: true, min: 1, onChange: set("steps") }),
    numberField({ name: "alpha", label: "Step size α (fraction of box width)", value: a.alpha, placeholder: "2.5 / K", onChange: set("alpha") }),
    numberField({ name: "selfTestSamples", label: "Self-test samples", value: a.selfTestSamples, integer: true, min: 1, onChange: set("selfTestSamples") }),
    selectField({
      name: "backend",
      label: "tf.js backend",
      value: a.backend,
      options: [
        { value: "cpu", label: "CPU (deterministic)" },
        { value: "webgl", label: "WebGL (faster, may lose precision)" },
      ],
      onChange: set("backend"),
    }),
  );
  const content = el("div", "page-flow");
  content.append(
    grid,
    note("Each restart starts uniformly at random in the box; the box centre and the corner the gradient points to are always tried as well."),
  );
  return accordion(state, "attack", "3 · Attack settings", content, false);
}

// ---------------------------------------------------------------------------
// Running

function validateSettings(attack) {
  const errors = [];
  if (!Number.isInteger(attack.seed) || attack.seed < 0) errors.push("Seed must be a whole number ≥ 0.");
  if (!Number.isInteger(attack.restarts) || attack.restarts < 1 || attack.restarts > 10000) errors.push("Restarts must be between 1 and 10000.");
  if (!Number.isInteger(attack.steps) || attack.steps < 1 || attack.steps > 100000) errors.push("Steps must be between 1 and 100000.");
  if (attack.alpha !== "" && !(attack.alpha > 0)) errors.push("α must be positive (or blank for 2.5 / K).");
  if (!Number.isInteger(attack.selfTestSamples) || attack.selfTestSamples < 1) errors.push("Self-test samples must be ≥ 1.");
  return errors;
}

function progressText(p) {
  if (!p) return "Starting…";
  if (p.phase === "self-test") return "Self-test: comparing the tf.js translation with onnxruntime-web…";
  const step = `step ${p.step}/${p.steps}`;
  if (p.region !== undefined) {
    const where = p.regions > 1 ? `region ${p.region + 1}/${p.regions} · ` : "";
    return `${where}${step} · best margin ${formatNumber(p.bestMargin, 4)}`;
  }
  const eps = p.epsilon !== undefined ? ` · ε = ${formatNumber(p.epsilon, 4)}` : "";
  return `point ${p.point + 1}/${p.points} · ${step}${eps}`;
}

function progressFraction(p) {
  if (!p || p.phase !== "attack") return 0;
  if (p.region !== undefined) return (p.region + p.step / p.steps) / p.regions;
  return (p.point + p.step / p.steps) / p.points;
}

function updateLive(state) {
  const run = state.getState().run;
  if (live.status) live.status.textContent = run.status === "running" ? progressText(run.progress) : statusText(state);
  if (live.fill) live.fill.style.width = `${Math.round(progressFraction(run.progress) * 100)}%`;
}

function statusText(state) {
  const s = state.getState();
  const run = s.run;
  if (run.status === "error") return `Error: ${run.error}`;
  if (run.status === "cancelled") return "Cancelled.";
  if (run.status === "done") return `Finished in ${formatTime(run.result.timeMs)}.`;
  if (!s.model?.summary) return "Load a model to start.";
  if (s.mode === "vnnlib" && !s.vnnlib?.summary) return "Load a VNNLIB property.";
  if (s.mode === "points" && !s.points?.text) return "Load a CSV of points.";
  return "Ready.";
}

async function startRun(ctx) {
  const { state, worker, rerender } = ctx;
  const s = state.getState();
  const errors = validateSettings(s.attack);
  if (errors.length) {
    state.set("run", { status: "error", error: errors.join(" ") });
    rerender();
    return;
  }

  const settings = {
    seed: s.attack.seed,
    restarts: s.attack.restarts,
    steps: s.attack.steps,
    alpha: s.attack.alpha === "" ? undefined : s.attack.alpha,
    backend: s.attack.backend,
    selfTestSamples: s.attack.selfTestSamples,
  };

  let type;
  let payload;
  if (s.mode === "vnnlib") {
    type = "run-vnnlib";
    payload = { text: s.vnnlib.text, settings };
  } else {
    const ps = s.pointsSettings;
    if (!(ps.epsilon > 0)) {
      state.set("run", { status: "error", error: "ε must be a positive number." });
      rerender();
      return;
    }
    type = "run-points";
    payload = {
      text: s.points.text,
      settings: {
        ...settings,
        task: ps.task,
        epsilon: ps.epsilon,
        delta: ps.task === "regression-standard" && ps.delta !== "" ? ps.delta : null,
        lipschitz: ps.task === "regression-lipschitz" && ps.lipschitz !== "" ? ps.lipschitz : null,
        domainLoText: ps.domainLoText,
        domainHiText: ps.domainHiText,
        searchEpsilon: ps.task === "classification" && ps.searchEpsilon,
        searchIterations: ps.searchIterations,
      },
    };
  }

  const meta = {
    model: s.model.fileName,
    property: s.mode === "vnnlib" ? s.vnnlib.fileName : s.points.fileName,
  };
  state.set("run", { status: "running", progress: null });
  rerender();

  try {
    const result = await worker.run(type, payload, (progress) => {
      state.patch("run", { progress });
      updateLive(state);
    });
    state.set("run", { status: "done", result: { ...result, meta } });
  } catch (err) {
    state.set("run", err.cancelled ? { status: "cancelled" } : { status: "error", error: err.message });
  }
  rerender();
}

function renderToolbar(ctx) {
  const { state, worker } = ctx;
  const s = state.getState();
  const running = s.run.status === "running";
  const ready =
    s.model?.summary && (s.mode === "vnnlib" ? s.vnnlib?.summary : s.points?.text) && !running && !s.model?.loading;

  const panel = el("div", "panel");
  const row = el("div", "toolbar");
  const main = el("div", "toolbar-main");

  const runButton = el("button", "run-button", running ? "Running…" : "Run attack");
  runButton.type = "button";
  runButton.disabled = !ready;
  runButton.addEventListener("click", () => startRun(ctx));

  const cancel = el("button", "secondary-button", "Cancel");
  cancel.type = "button";
  cancel.disabled = !running;
  cancel.addEventListener("click", () => worker.cancel());

  main.append(runButton, cancel);

  const statusBox = el("div", "toolbar-status");
  live.status = el("p", "status", statusText(state));
  statusBox.append(live.status);
  if (running) {
    const bar = el("div", "progress");
    live.fill = el("div", "progress-fill");
    bar.append(live.fill);
    statusBox.append(bar);
  } else {
    live.fill = null;
  }
  if (s.run.status === "error") live.status.classList.add("error-text");

  row.append(main, statusBox);
  panel.append(row);
  updateLive(state);
  return panel;
}

// ---------------------------------------------------------------------------
// Results

function jsonReplacer(_key, value) {
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (ArrayBuffer.isView(value)) return Array.from(value);
  return value;
}

function reproducibility(result) {
  const s = result.settings;
  return {
    model: result.meta.model,
    property: result.meta.property,
    seed: s.seed,
    restarts: s.restarts,
    steps: s.steps,
    alpha: s.alpha,
    backend: s.backend,
    selfTestSamples: result.selfTest.count,
    selfTestMaxRelError: result.selfTest.maxRelError,
    tfjs: TFJS_VERSION,
    onnxruntimeWeb: ORT_VERSION,
    statement: DISCLAIMER,
  };
}

function selfTestWarning(result) {
  const t = result.selfTest;
  if (t.ok) return null;
  return el(
    "p",
    "warning-box",
    `Self-test warning: the tf.js translation differs from onnxruntime-web by up to ${formatNumber(t.maxRelError, 3)} (relative) on ${t.count} sample inputs, above the ${formatNumber(t.tolerance, 2)} threshold. Gradients may be unreliable. Any counterexample shown has still been re-checked with onnxruntime-web.`,
  );
}

function renderVnnlibResult(ctx, result) {
  const { state } = ctx;
  const group = el("div", "accordion-group");

  const summary = el("div", "page-flow");
  summary.append(
    el("p", `verdict ${result.verdict === "sat" ? "verdict-sat" : "verdict-unknown"}`, result.verdictText),
    createStatGrid([
      { label: "Best margin found", value: formatNumber(result.bestMargin), title: "min over the attack of max(a·y − b); ≤ 0 means the unsafe condition holds" },
      { label: "Time", value: formatTime(result.timeMs) },
      { label: "Input regions", value: String(result.regions) },
      { label: "Spurious candidates", value: String(result.spuriousCandidates), title: "tf.js candidates that failed the onnxruntime float64 re-check" },
      { label: "Self-test max rel. error", value: formatNumber(result.selfTest.maxRelError, 3) },
    ]),
  );
  const warn = selfTestWarning(result);
  if (warn) summary.append(warn);
  summary.append(el("p", "disclaimer", DISCLAIMER));
  group.append(accordion(state, "result", "Result", summary));

  if (result.counterexample) {
    const ce = result.counterexample;
    const content = el("div", "page-flow");
    const rows = [
      ...ce.x.map((v, i) => ({ name: `X_${i}`, v })),
      ...ce.y.map((v, j) => ({ name: `Y_${j}`, v })),
    ];
    content.append(
      note(
        `Re-checked with onnxruntime-web: the outputs satisfy the unsafe condition (margin ${formatNumber(ce.margin)} in float64)` +
          (result.regions > 1 ? `, in input region ${ce.region + 1}.` : "."),
      ),
      createDataTable(
        [
          { label: "Variable", value: (r) => r.name },
          { label: "Value", value: (r) => String(r.v) },
        ],
        rows,
      ),
    );
    const buttons = el("div", "button-row");
    const dl = el("button", "header-action-button", "Download counterexample (VNN-COMP format)");
    dl.type = "button";
    dl.addEventListener("click", () => downloadTextFile(ce.text, "counterexample.txt", "text/plain"));
    buttons.append(dl);
    content.append(buttons);
    group.append(accordion(state, "counterexample", "Counterexample", content));
  }

  group.append(renderReproducibility(ctx, result));
  return group;
}

function renderPointsResult(ctx, result) {
  const { state } = ctx;
  const group = el("div", "accordion-group");
  const s = result.settings;
  const summary = el("div", "page-flow");
  const sm = result.summary;
  const chips = [];

  if (result.task === "classification") {
    chips.push(
      { label: "Clean accuracy", value: `${(sm.cleanAccuracy * 100).toFixed(1)}%` },
      { label: `Robust accuracy at ε = ${formatNumber(s.epsilon)} (upper bound)`, value: `${(sm.robustAccuracyUpperBound * 100).toFixed(1)}%` },
      { label: "Points broken", value: `${sm.brokenCount} / ${result.rows.length}` },
    );
    if (sm.medianSmallestEpsilon !== null) {
      chips.push({
        label: "Median smallest breaking ε",
        value: Number.isFinite(sm.medianSmallestEpsilon) ? `≤ ${formatNumber(sm.medianSmallestEpsilon)}` : `> ${formatNumber(s.epsilon)}`,
      });
    }
  } else {
    const lip = result.task === "regression-lipschitz";
    chips.push(
      { label: lip ? "Largest Lipschitz lower bound" : "Largest output deviation", value: formatNumber(sm.maxValue) },
      { label: "Median over points", value: formatNumber(sm.medianValue) },
    );
    if (sm.passCount !== undefined) {
      chips.push({ label: lip ? `Exceed L = ${formatNumber(s.lipschitz)}` : `Exceed δ = ${formatNumber(s.delta)}`, value: `${sm.failCount} / ${result.rows.length}` });
    }
  }
  chips.push({ label: "Time", value: formatTime(result.timeMs) }, { label: "Self-test max rel. error", value: formatNumber(result.selfTest.maxRelError, 3) });
  summary.append(createStatGrid(chips));
  if (result.task === "regression-lipschitz") {
    summary.append(note("Each value is an empirical lower bound on the local Lipschitz constant (L∞ in, L∞ out): the true constant is at least this large."));
  }
  if (result.extraColumns > 0) {
    summary.append(note(`${result.extraColumns} extra CSV column(s) after the inputs${result.task === "classification" ? " and label" : ""} were ignored.`));
  }
  const warn = selfTestWarning(result);
  if (warn) summary.append(warn);
  summary.append(el("p", "disclaimer", DISCLAIMER));
  group.append(accordion(state, "result", "Result", summary));

  const perPoint = el("div", "page-flow");
  if (result.task === "classification" && s.searchEpsilon) {
    perPoint.append(createEpsilonHistogram(result.rows.map((r) => r.smallestEpsilon), s.epsilon));
  }
  perPoint.append(createDataTable(pointColumns(result), result.rows));
  const buttons = el("div", "button-row");
  const dl = el("button", "header-action-button", "Download per-point CSV");
  dl.type = "button";
  dl.addEventListener("click", () => downloadTextFile(pointsCsv(result), "robustness-points.csv", "text/csv"));
  buttons.append(dl);
  perPoint.append(buttons);
  group.append(accordion(state, "points-table", "Per-point results", perPoint));

  group.append(renderReproducibility(ctx, result));
  return group;
}

function pointColumns(result) {
  const s = result.settings;
  const idx = { label: "#", value: (r) => String(r.index + 1) };
  if (result.task === "classification") {
    const cols = [
      idx,
      { label: "Label", value: (r) => String(r.label) },
      { label: "Clean pred.", value: (r) => String(r.cleanPrediction), className: (r) => (r.cleanCorrect ? "" : "cell-bad") },
      { label: "Counterexample", value: (r) => (r.broken ? "found" : "none found"), className: (r) => (r.broken ? "cell-bad" : "") },
      { label: "Adv. pred.", value: (r) => (r.broken && r.cleanCorrect ? String(r.counterexample.prediction) : "–") },
      { label: "Best margin", value: (r) => formatNumber(r.bestMargin, 4) },
    ];
    if (s.searchEpsilon) {
      cols.push({
        label: "Smallest ε",
        title: "Smallest ε at which a counterexample was found (an upper bound on the true minimum)",
        value: (r) => (r.smallestEpsilon === 0 ? "0" : Number.isFinite(r.smallestEpsilon) ? `≤ ${formatNumber(r.smallestEpsilon, 4)}` : `> ${formatNumber(s.epsilon)}`),
      });
    }
    return cols;
  }
  const lip = result.task === "regression-lipschitz";
  const cols = [
    idx,
    { label: "Max deviation ‖Δy‖∞", value: (r) => formatNumber(r.maxDeviation) },
    { label: "‖Δx‖∞", value: (r) => formatNumber(r.distance) },
  ];
  if (lip) cols.push({ label: "Lipschitz lower bound", value: (r) => formatNumber(r.lipschitzLowerBound) });
  if (result.rows.some((r) => r.pass !== undefined)) {
    cols.push({
      label: lip ? "≤ L?" : "≤ δ?",
      value: (r) => (r.pass ? "no violation found" : "violated"),
      className: (r) => (r.pass ? "" : "cell-bad"),
    });
  }
  return cols;
}

function pointsCsv(result) {
  const cols = pointColumns(result);
  const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [cols.map((c) => esc(c.label)).join(",")];
  for (const r of result.rows) lines.push(cols.map((c) => esc(c.value(r))).join(","));
  lines.push("", `# ${DISCLAIMER}`, `# ${JSON.stringify(reproducibility(result), jsonReplacer)}`);
  return lines.join("\n") + "\n";
}

function renderReproducibility(ctx, result) {
  const content = el("div", "page-flow");
  const repro = reproducibility(result);
  content.append(el("pre", "mono", JSON.stringify(repro, jsonReplacer, 2)));
  const buttons = el("div", "button-row");
  const dl = el("button", "header-action-button", "Download full report (JSON)");
  dl.type = "button";
  dl.addEventListener("click", () =>
    downloadTextFile(JSON.stringify({ ...result, reproducibility: repro }, jsonReplacer, 2), "robustness-report.json", "application/json"),
  );
  buttons.append(dl);
  content.append(buttons);
  return accordion(ctx.state, "repro", "Reproducibility", content, false);
}

// ---------------------------------------------------------------------------

export function renderCheckPage(ctx) {
  const { state } = ctx;
  const s = state.getState();

  const page = el("section", "page-flow");
  const layout = el("div", "sim-layout");

  const controls = el("div", "control-stack");
  const controlGroup = el("div", "accordion-group");
  controlGroup.append(renderModelSection(ctx), renderPropertySection(ctx), renderAttackSection(ctx));
  controls.append(controlGroup);

  const results = el("div", "results-stack");
  results.append(renderToolbar(ctx));

  const result = s.run.status === "done" ? s.run.result : null;
  if (result) {
    results.append(result.mode === "vnnlib" ? renderVnnlibResult(ctx, result) : renderPointsResult(ctx, result));
  } else {
    const intro = el("div", "panel");
    intro.append(
      el("p", "", "Load an ONNX network and either a VNNLIB property or a CSV of points, then run the attack. Everything runs in your browser; nothing is uploaded."),
      el(
        "p",
        "section-note",
        "The tool searches for counterexamples with projected gradient descent. A counterexample proves the network is not robust; finding none proves nothing. See the Method tab.",
      ),
    );
    results.append(intro);
  }

  layout.append(controls, results);
  page.append(layout);
  return page;
}
