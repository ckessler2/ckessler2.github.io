// Estimate Run tab (#/estimate): set up a check, run it in the worker, and show
// the answer first with every detail one click away. Styles: css/rapid.css.

import { readFileBytes, gunzip, stripGz } from "../components/file-input.js";
import { formatNumber, formatTime } from "../components/stats.js";
import { createEpsilonHistogram } from "../components/histogram.js";
import { downloadTextFile } from "../components/download.js";
import { el, emptyState, segmented, button, popover, copyButton } from "../components/ui.js";
import { infoTip, fieldRow, numberInput, textInput, selectInput, checkRow, filePicker, statusLine, subhead } from "../components/rapid-fields.js";
import { createRangeBar, formatPercent } from "../components/rapid-range-bar.js";
import { createPointList, detailList } from "../components/rapid-point-list.js";
import { createProgressTracker } from "../components/rapid-progress.js";
import { parseVnnlib } from "../spec/vnnlib.js";
import { TASKS, classificationSetupErrors } from "../spec/points.js";
import { friendlyError } from "../lib/errors.js";
import { BENCHMARKS, pointFromProperty, pointsCsvText } from "../spec/benchmark.js";
import { disclaimerFor } from "../attack/report.js";
import { ATTACK_DEFAULTS, attackDefaultsFor } from "../attack/defaults.js";
import { TFJS_VERSION, ORT_VERSION } from "../lib/cdn.js";

const METHOD = "#/estimate-method";

// DOM nodes updated in place (progress, status, "changed" markers) without a
// full re-render, so typing in a field never loses focus. Reassigned on every
// render, so a re-render mid-run (e.g. toggling dark mode) keeps them alive.
const live = {};
let tracker = createProgressTracker();
// Expanded rows of the current result (kept across re-renders).
const openRows = new Set();

// ---------------------------------------------------------------------------
// Attack settings: the defaults per property type (attack/defaults.js); change them under Advanced.

const standardAttack = (task) => {
  const d = attackDefaultsFor(task);
  return { restarts: d.restarts, steps: d.steps };
};

/** Attack settings for a new property type: its defaults. */
function attackFor(s, task) {
  return { ...standardAttack(task), schedule: "apgd", selfTestSamples: attackDefaultsFor(task).selfTestSamples };
}

// ---------------------------------------------------------------------------
// Advanced defaults: what "N changed" and "Reset to defaults" compare with.

function advancedDiffs(s) {
  const a = s.attack;
  const ps = s.pointsSettings;
  const task = ps.task;
  const dom = s.rapid.domainDefault;
  const diffs = [];
  const check = (name, value, def) => {
    if (value !== def) diffs.push(name);
  };
  if (task === "classification" || task === "properties") check("certify", a.certify !== false, true);
  if (s.mode === "points") {
    if (task === "classification") {
      check("searchEpsilon", ps.searchEpsilon, false);
      if (ps.searchEpsilon) check("searchIterations", ps.searchIterations, 8);
    }
    check("domainLo", ps.domainLoText.trim(), dom.lo);
    check("domainHi", ps.domainHiText.trim(), dom.hi);
  }
  const std = standardAttack(task);
  check("restarts", a.restarts, std.restarts);
  check("steps", a.steps, std.steps);
  check("schedule", a.schedule, "apgd");
  if (a.schedule === "constant") check("alpha", a.alpha, "");
  check("seed", a.seed, 0);
  check("backend", a.backend, "webgl");
  check("selfTestSamples", a.selfTestSamples, attackDefaultsFor(task).selfTestSamples);
  return diffs;
}

function resetAdvanced(state) {
  const s = state.getState();
  const task = s.pointsSettings.task;
  state.patch("attack", {
    ...standardAttack(task),
    schedule: "apgd",
    alpha: "",
    seed: 0,
    certify: true,
    backend: "webgl",
    selfTestSamples: attackDefaultsFor(task).selfTestSamples,
  });
  state.patch("pointsSettings", {
    searchEpsilon: false,
    searchIterations: 8,
    domainLoText: s.rapid.domainDefault.lo,
    domainHiText: s.rapid.domainDefault.hi,
  });
}

// ---------------------------------------------------------------------------
// Loading files and benchmarks

function stopIfRunning(ctx) {
  if (ctx.state.getState().run.status === "running") ctx.worker.cancel();
}

async function loadModelBytes(ctx, fileName, bytes) {
  const { state, worker, rerender } = ctx;
  state.set("model", { fileName, bytes, loading: true });
  rerender();
  try {
    const summary = await worker.loadModel(bytes);
    state.set("model", { fileName, bytes, summary });
  } catch (err) {
    state.set("model", { fileName, error: err.message });
  }
  rerender();
}

/** Property files ({ name, text }); checks that each parses and that they agree on sizes. */
function loadSpecFiles(ctx, files, extra = {}) {
  const { state } = ctx;
  try {
    let numInputs = null;
    let numOutputs = null;
    for (const f of files) {
      const spec = parseVnnlib(f.text);
      if (numInputs !== null && (spec.numInputs !== numInputs || spec.numOutputs !== numOutputs)) {
        throw new Error(`${f.name} has a different number of inputs or outputs from the other properties.`);
      }
      numInputs = spec.numInputs;
      numOutputs = spec.numOutputs;
    }
    state.set("vnnlib", { files, summary: { count: files.length, numInputs, numOutputs }, ...extra });
  } catch (err) {
    state.set("vnnlib", { files: [], error: err.message });
  }
}

function loadPointsText(ctx, fileName, text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  // A first row that is not numeric is a header (as in spec/points.js).
  const header = lines.length > 0 && lines[0].trim().split(/[,;\t ]+/).some((c) => !Number.isFinite(Number(c)));
  ctx.state.set("points", { fileName, text, rows: lines.length - (header ? 1 : 0) });
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch ${url} (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return url.endsWith(".gz") ? gunzip(bytes) : bytes;
}

async function loadBenchmark(ctx, id) {
  const bench = BENCHMARKS.find((b) => b.id === id) ?? BENCHMARKS[0];
  const { state, rerender } = ctx;
  stopIfRunning(ctx);
  state.set("benchmarkId", bench.id);
  state.patch("rapid", { source: "benchmark", loadedBenchmark: bench.id });
  if (bench.kind === "properties") return loadPropertyBenchmark(ctx, bench);
  const s = state.getState();
  state.set("mode", "points");
  state.patch("attack", attackFor(s, "classification"));
  state.set("model", { fileName: bench.modelName, loading: true });
  rerender();
  try {
    const [modelBytes, ...props] = await Promise.all([fetchBytes(bench.modelUrl), ...bench.propertyUrls.map(fetchBytes)]);
    const decoder = new TextDecoder();
    const points = props.map((b) => pointFromProperty(decoder.decode(b), bench.propertyEpsilon, { snap: bench.snapPixels }));
    const csv = pointsCsvText(points, [
      `${bench.label}: ${points.length} images and labels, recovered from the benchmark's properties (${bench.imageNames.join(" ")}).`,
      `Source: ${bench.modelUrl.replace(/\/onnx\/.*/, "")}`,
    ]);
    loadPointsText(ctx, "benchmark images", csv);
    state.patch("points", { reference: bench.reference, imageNames: bench.imageNames });
    state.patch("pointsSettings", { task: "classification", searchEpsilon: false, ...bench.settings });
    state.patch("rapid", { domainDefault: { lo: bench.settings.domainLoText ?? "", hi: bench.settings.domainHiText ?? "" } });
    await loadModelBytes(ctx, bench.modelName, modelBytes);
  } catch (err) {
    state.set("model", { error: `Could not load the benchmark: ${err.message}` });
    rerender();
  }
}

async function loadPropertyBenchmark(ctx, bench) {
  const { state, rerender } = ctx;
  const s = state.getState();
  state.set("mode", "vnnlib");
  state.patch("attack", attackFor(s, "properties"));
  state.patch("pointsSettings", { task: "properties" });
  state.set("model", { fileName: bench.modelName, loading: true });
  rerender();
  try {
    const [modelBytes, ...props] = await Promise.all([fetchBytes(bench.modelUrl), ...bench.propertyUrls.map(fetchBytes)]);
    const decoder = new TextDecoder();
    loadSpecFiles(
      ctx,
      props.map((b, i) => ({ name: bench.imageNames[i], text: decoder.decode(b) })),
      { reference: bench.reference, label: "benchmark properties" },
    );
    await loadModelBytes(ctx, bench.modelName, modelBytes);
  } catch (err) {
    state.set("model", { error: `Could not load the benchmark: ${err.message}` });
    rerender();
  }
}

// ---------------------------------------------------------------------------
// Readiness, run request and its signature (for "settings changed since this run")

function needs(s) {
  const missing = [];
  if (!s.model?.summary && !s.model?.loading) missing.push("model");
  if (s.mode === "vnnlib" ? !s.vnnlib?.summary : !s.points?.text) missing.push(s.mode === "vnnlib" ? "properties" : "points");
  return missing;
}

const isReady = (s) => !needs(s).length && !s.model?.loading;

function buildRequest(s) {
  const a = s.attack;
  const settings = {
    seed: a.seed,
    restarts: a.restarts,
    steps: a.steps,
    alpha: a.alpha === "" ? undefined : a.alpha,
    backend: a.backend,
    schedule: a.schedule,
    selfTestSamples: a.selfTestSamples,
    certify: a.certify !== false,
  };
  if (s.mode === "vnnlib") {
    return {
      type: "run-properties",
      payload: { files: s.vnnlib.files, settings },
      dataKey: s.vnnlib.files.map((f) => `${f.name}:${f.text.length}`).join("|"),
    };
  }
  const ps = s.pointsSettings;
  return {
    type: "run-points",
    payload: {
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
    },
    dataKey: `${s.points.fileName}:${s.points.text.length}`,
  };
}

function signatureOf(s) {
  if (!isReady(s)) return null;
  const r = buildRequest(s);
  return JSON.stringify([r.type, r.payload.settings, s.model.fileName, s.model.bytes?.length ?? 0, r.dataKey]);
}

function validateSettings(s) {
  const a = s.attack;
  const errors = [];
  if (s.mode === "points" && !(s.pointsSettings.epsilon > 0)) errors.push("ε must be a positive number.");
  if (!Number.isInteger(a.seed) || a.seed < 0) errors.push("Seed must be a whole number ≥ 0.");
  if (!Number.isInteger(a.restarts) || a.restarts < 1 || a.restarts > 10000) errors.push("Restarts must be between 1 and 10000.");
  if (!Number.isInteger(a.steps) || a.steps < 1 || a.steps > 100000) errors.push("Steps must be between 1 and 100000.");
  if (a.alpha !== "" && !(a.alpha > 0)) errors.push("α must be positive (or blank for 2.5 / steps).");
  if (!Number.isInteger(a.selfTestSamples) || a.selfTestSamples < 1) errors.push("Self-test samples must be ≥ 1.");
  return errors;
}

function dataSummary(s) {
  if (s.mode === "vnnlib") {
    const n = s.vnnlib.summary.count;
    return `${n} ${n === 1 ? "property" : "properties"}`;
  }
  const ps = s.pointsSettings;
  const parts = [`${s.points.rows} ${s.points.rows === 1 ? "point" : "points"}`, `ε ${formatNumber(ps.epsilon, 3)}`];
  if (ps.task === "regression-standard" && ps.delta !== "") parts.push(`δ ${formatNumber(ps.delta, 3)}`);
  if (ps.task === "regression-lipschitz" && ps.lipschitz !== "") parts.push(`L ${formatNumber(ps.lipschitz, 3)}`);
  return parts.join(" · ");
}

async function startRun(ctx) {
  const { state, worker, rerender } = ctx;
  const s = state.getState();
  if (!isReady(s) || setupErrors(s).length || s.run.status === "running") return;
  const previous = s.run.result ?? null;
  const errors = validateSettings(s);
  if (errors.length) {
    state.set("run", { status: "error", error: errors.join(" "), result: previous });
    rerender();
    return;
  }
  const { type, payload } = buildRequest(s);
  const meta = {
    model: s.model.fileName,
    property: s.mode === "vnnlib" ? `${s.vnnlib.label} (${s.vnnlib.files.length})` : s.points.fileName,
    imageNames: s.mode === "points" ? s.points.imageNames : s.vnnlib.files.map((f) => f.name),
    signature: signatureOf(s),
  };
  const propRef = s.mode === "vnnlib" ? s.vnnlib.reference : null;
  if (propRef && propRef.verdicts.all.length === s.vnnlib.files.length) {
    meta.reference = { verdicts: propRef.verdicts.all, source: propRef.source, sourceUrl: propRef.sourceUrl };
  }
  // Published verdicts for this exact ε, if the loaded points came with them.
  const ref = s.mode === "points" && s.pointsSettings.task === "classification" ? s.points.reference : null;
  const verdicts = ref?.verdicts?.[String(s.pointsSettings.epsilon)];
  if (verdicts && verdicts.length === s.points.rows) {
    meta.reference = { verdicts, source: ref.source, sourceUrl: ref.sourceUrl };
  }
  tracker = createProgressTracker();
  state.set("run", { status: "running", progress: null, result: previous });
  rerender();

  try {
    const result = await worker.run(type, payload, (progress) => {
      tracker.update(progress);
      updateProgress();
    });
    openRows.clear();
    state.patch("rapid", { filter: "all" });
    state.set("run", { status: "done", result: { ...result, meta } });
  } catch (err) {
    state.set("run", err.cancelled ? { status: "cancelled", result: previous } : { status: "error", error: err.message, result: previous });
  }
  rerender();
}

// ---------------------------------------------------------------------------
// Setup card

function benchParts(bench) {
  const i = bench.label.indexOf(": ");
  return i < 0 ? { group: "", name: bench.label } : { group: bench.label.slice(0, i), name: bench.label.slice(i + 2) };
}

function benchOptions(benches) {
  const groups = [];
  for (const b of benches) {
    const { group, name } = benchParts(b);
    let g = groups.find((x) => x.group === group);
    if (!g) groups.push((g = { group, options: [] }));
    g.options.push({ value: b.id, label: name });
  }
  return groups;
}

/** An error status line in plain words; the original message stays one click away. */
function errorLine(message) {
  const { text, raw } = friendlyError(message);
  const line = statusLine("error", text);
  if (raw) {
    const details = el("details", "rf-error-raw");
    details.append(el("summary", "", "Details"), el("code", "", raw));
    line.querySelector(".rf-status-text").append(details);
  }
  return line;
}

let setupErrorsCache = { key: null, errors: [] };

/** Problems that block a run before it starts (classification with < 2 outputs, labels out of range). */
function setupErrors(s) {
  const ms = s.model?.summary;
  if (!ms || s.mode !== "points" || s.pointsSettings.task !== "classification") return [];
  const text = s.points?.text ?? "";
  const key = `${ms.inputSize}|${ms.outputSize}|${text.length}|${text}`;
  if (setupErrorsCache.key !== key) setupErrorsCache = { key, errors: classificationSetupErrors(ms.outputSize, text, ms.inputSize) };
  return setupErrorsCache.errors;
}

/** Model warnings that matter before a run (several outputs, no certification, too few outputs). */
function modelNotes(s) {
  const ms = s.model?.summary;
  const out = [];
  if (!ms) return out;
  if (ms.extraOutputs?.length) out.push(el("p", "field-hint", `Several outputs; only “${ms.outputName}” is checked.`));
  if (!ms.certifiable) out.push(el("p", "field-hint rapid-hint-warn", `No certification for this model (${ms.certifyNote}); attack only.`));
  for (const e of setupErrors(s)) out.push(el("p", "error-text", e.text));
  return out;
}

function renderBenchmarkSource(ctx, s) {
  const { state } = ctx;
  const out = [];
  const benches = BENCHMARKS.filter((bm) => bm.task === s.pointsSettings.task);
  if (!benches.length) {
    const p = el("p", "section-note", "No built-in benchmarks for this type yet. ");
    const link = el("button", "rapid-link-button", "Use my files");
    link.type = "button";
    link.addEventListener("click", () => {
      state.patch("rapid", { source: "files" });
      ctx.rerender();
    });
    p.append(link);
    return [p];
  }
  const loadedId = benches.some((b) => b.id === s.rapid.loadedBenchmark) ? s.rapid.loadedBenchmark : "";
  out.push(
    fieldRow({
      label: "Benchmark",
      info: infoTip("Published VNN-COMP instances with known verdicts. The network and property files are fetched from the competition's GitHub repositories."),
      stacked: true,
      control: selectInput({
        name: "benchmark",
        value: loadedId,
        placeholder: "Choose a benchmark…",
        options: benchOptions(benches),
        onChange: (v) => loadBenchmark(ctx, v),
      }),
    }),
  );
  if (loadedId) {
    const bench = benches.find((b) => b.id === loadedId);
    if (s.model?.loading) out.push(statusLine("busy", `Loading ${benchParts(bench).name}…`));
    else if (s.model?.error) out.push(errorLine(s.model.error));
    else if (s.model?.summary && (s.mode === "vnnlib" ? s.vnnlib?.summary : s.points?.text)) {
      out.push(statusLine("ok", `${benchParts(bench).name} · ${dataSummary(s)}`), ...modelNotes(s));
    }
  }
  return out;
}

function renderFileSource(ctx, s) {
  const { state, rerender } = ctx;
  const out = [];
  const model = s.model;
  const modelStatus = model?.loading
    ? statusLine("busy", `Loading ${model.fileName ?? "model"}…`)
    : model?.error
      ? errorLine(model.error)
      : model?.summary
        ? statusLine("ok", `${model.fileName} · ${model.summary.inputSize} → ${model.summary.outputSize}`)
        : null;
  out.push(
    fieldRow({
      label: "Model",
      className: "rf-filefield",
      info: infoTip("An ONNX network (.onnx, or .onnx.gz). Feed-forward ReLU networks can also be certified with CROWN."),
      stacked: true,
      control: [
        filePicker({
          accept: ".onnx,.gz",
          buttonText: model?.summary || model?.loading ? "Replace…" : "Choose .onnx…",
          ariaLabel: "Model (.onnx)",
          onFiles: async ([file]) => {
            stopIfRunning(ctx);
            state.patch("rapid", { loadedBenchmark: null });
            try {
              await loadModelBytes(ctx, stripGz(file.name), await readFileBytes(file));
            } catch (err) {
              state.set("model", { fileName: file.name, error: err.message });
              rerender();
            }
          },
        }),
        modelStatus,
      ],
    }),
    ...modelNotes(s),
  );

  if (s.mode === "vnnlib") {
    const v = s.vnnlib;
    const ms = model?.summary;
    let vStatus = null;
    if (v?.error) vStatus = statusLine("error", v.error);
    else if (v?.summary) vStatus = statusLine("ok", `${v.files.length === 1 ? v.files[0].name : `${v.summary.count} properties`} · ${v.summary.numInputs} → ${v.summary.numOutputs}`);
    out.push(
      fieldRow({
        label: "Properties (.vnnlib)",
        className: "rf-filefield",
        info: infoTip("VNNLIB files: an input box and an unsafe output condition. Each file is checked separately."),
        hint: "One or more files.",
        stacked: true,
        control: [
          filePicker({
            accept: ".vnnlib,.gz,.txt,.smt2",
            multiple: true,
            buttonText: v?.summary ? "Replace…" : "Choose files…",
            ariaLabel: "Properties (.vnnlib)",
            onFiles: async (files) => {
              stopIfRunning(ctx);
              state.patch("rapid", { loadedBenchmark: null });
              const decoder = new TextDecoder();
              const loaded = [];
              for (const file of files) loaded.push({ name: stripGz(file.name).replace(/\.vnnlib$/i, ""), text: decoder.decode(await readFileBytes(file)) });
              loadSpecFiles(ctx, loaded, { label: loaded.length === 1 ? loaded[0].name : "property files" });
              rerender();
            },
          }),
          vStatus,
        ],
      }),
    );
    if (v?.summary && ms && (ms.inputSize !== v.summary.numInputs || ms.outputSize !== v.summary.numOutputs)) {
      out.push(el("p", "error-text", `The properties have ${v.summary.numInputs} inputs and ${v.summary.numOutputs} outputs; the model has ${ms.inputSize} and ${ms.outputSize}.`));
    }
    return out;
  }

  const p = s.points;
  out.push(
    fieldRow({
      label: "Points (.csv)",
      className: "rf-filefield",
      info: infoTip("Comma-separated, in the model's own input units (after any normalisation). A non-numeric first row is treated as a header; lines starting with # are skipped."),
      hint: s.pointsSettings.task === "classification" ? "One row per point: inputs, then label." : "One row per point: the inputs.",
      stacked: true,
      control: [
        filePicker({
          accept: ".csv,.txt,.gz",
          buttonText: p?.text ? "Replace…" : "Choose .csv…",
          ariaLabel: "Points (.csv)",
          onFiles: async ([file]) => {
            stopIfRunning(ctx);
            state.patch("rapid", { loadedBenchmark: null });
            loadPointsText(ctx, stripGz(file.name), new TextDecoder().decode(await readFileBytes(file)));
            rerender();
          },
        }),
        p?.text ? statusLine("ok", `${p.fileName} · ${p.rows} rows`) : null,
      ],
    }),
  );
  return out;
}

function renderSetup(ctx) {
  const { state, rerender } = ctx;
  const s = state.getState();
  const ps = s.pointsSettings;
  const card = el("section", "panel rapid-card");
  card.append(el("h2", "rapid-card-title", "Setup"));
  const flow = el("div", "rapid-flow");

  flow.append(
    fieldRow({
      label: "Property",
      info: infoTip(
        [
          "Classification robustness: the predicted class does not change anywhere within ε of each point.",
          "Standard robustness (δ, Casadio et al., 2022): within ε of each point, no output moves by more than δ. Attack only: it can find violations, not prove their absence.",
          "Lipschitz robustness (L): within ε of each point, output change ≤ L × input change. Attack only.",
          "Output constraints: each VNNLIB file gives an input box and unsafe output conditions; no input in the box may reach them.",
        ],
        { href: METHOD },
      ),
      stacked: true,
      control: selectInput({
        name: "task",
        value: ps.task,
        options: Object.entries(TASKS).map(([value, label]) => ({ value, label })),
        onChange: (v) => {
          const now = state.getState();
          state.patch("attack", attackFor(now, v));
          state.patch("pointsSettings", { task: v });
          state.set("mode", v === "properties" ? "vnnlib" : "points");
          if (!BENCHMARKS.some((b) => b.task === v)) state.patch("rapid", { source: "files" });
          rerender();
        },
      }),
    }),
  );

  const sourceRow = el("div", "rapid-source");
  sourceRow.append(
    segmented({
      label: "Source",
      value: s.rapid.source,
      options: [
        { value: "benchmark", label: "Benchmark" },
        { value: "files", label: "My files" },
      ],
      onChange: (v) => {
        state.patch("rapid", { source: v });
        rerender();
      },
    }),
  );
  flow.append(sourceRow, ...(s.rapid.source === "benchmark" ? renderBenchmarkSource(ctx, s) : renderFileSource(ctx, s)));

  const set = (key) => (v) => {
    state.patch("pointsSettings", { [key]: v });
    softRefresh(ctx);
  };
  if (s.mode === "points") {
    const params = el("div", "rapid-params");
    params.append(
      fieldRow({
        label: "ε",
        info: infoTip("L∞ radius: every input may move by at most ε (then clipped to the input range, if set).", { href: METHOD }),
        hint: "In the model's input units: normalised too if normalisation happens outside the ONNX file.",
        control: numberInput({ name: "epsilon", value: ps.epsilon, min: 0, onChange: set("epsilon") }),
      }),
    );
    if (ps.task === "regression-standard") {
      params.append(
        fieldRow({
          label: "δ",
          info: infoTip("Allowed change of any output (L∞). Blank: just report the largest change found."),
          control: numberInput({ name: "delta", value: ps.delta, min: 0, onChange: set("delta") }),
        }),
      );
    }
    if (ps.task === "regression-lipschitz") {
      params.append(
        fieldRow({
          label: "L",
          info: infoTip("Allowed local Lipschitz constant (L∞ in, L∞ out). Blank: just report the largest found."),
          control: numberInput({ name: "lipschitz", value: ps.lipschitz, min: 0, onChange: set("lipschitz") }),
        }),
      );
    }
    flow.append(params);
  }

  card.append(flow, renderAdvanced(ctx));
  return card;
}

// ---------------------------------------------------------------------------
// Advanced

function advancedStateText(s) {
  const n = advancedDiffs(s).length;
  return n ? `${n} changed` : "defaults";
}

function renderAdvanced(ctx) {
  const { state, rerender } = ctx;
  const s = state.getState();
  const a = s.attack;
  const ps = s.pointsSettings;
  const task = ps.task;
  const details = document.createElement("details");
  details.className = "rapid-advanced";
  details.open = s.accordionState.advanced ?? false;
  details.addEventListener("toggle", () => state.setAccordionOpen("advanced", details.open));

  const summary = document.createElement("summary");
  live.advState = el("span", "rapid-adv-state", advancedStateText(s));
  live.advReset = el("button", "rapid-link-button", "Reset to defaults");
  live.advReset.type = "button";
  live.advReset.hidden = advancedDiffs(s).length === 0;
  live.advReset.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    resetAdvanced(state);
    rerender();
  });
  const title = el("span", "rapid-adv-title");
  title.append("Advanced ", el("span", "rapid-adv-dot", "·"), " ", live.advState);
  summary.append(title, live.advReset);
  details.append(summary);

  const body = el("div", "rapid-adv-body");
  const setA = (key) => (v) => {
    state.patch("attack", { [key]: v });
    softRefresh(ctx);
  };
  const setP = (key) => (v) => {
    state.patch("pointsSettings", { [key]: typeof v === "string" ? v.trim() : v });
    softRefresh(ctx);
  };

  if (task === "classification" || task === "properties") {
    const g = el("div", "rapid-group");
    g.append(
      subhead("Certification"),
      checkRow({
        label: "Certify with CROWN",
        checked: a.certify !== false,
        onChange: (v) => setA("certify")(v),
        info: infoTip("Certifies points robust (or properties safe) with CROWN bounds before attacking: float64 bounds plus a float32 safety margin, not a floating-point-sound proof. Off: attack only, so results are upper bounds.", { href: METHOD, align: "end" }),
      }),
    );
    if (s.mode === "points" && task === "classification") {
      g.append(
        checkRow({
          label: "Find each point's ε range (slower)",
          checked: ps.searchEpsilon,
          onChange: (v) => {
            state.patch("pointsSettings", { searchEpsilon: v });
            rerender();
          },
          info: infoTip("Bisects ε for every point: the largest ε CROWN still certifies, and the smallest ε at which the attack finds a counterexample.", { align: "end" }),
        }),
      );
      if (ps.searchEpsilon) {
        g.append(fieldRow({ label: "Bisection steps", control: numberInput({ name: "searchIterations", value: ps.searchIterations, integer: true, min: 1, onChange: setP("searchIterations") }) }));
      }
    }
    body.append(g);
  }

  if (s.mode === "points") {
    const g = el("div", "rapid-group");
    const pair = el("div", "rapid-pair");
    pair.append(
      textInput({ name: "domainLo", value: ps.domainLoText, placeholder: "min", ariaLabel: "Input range minimum", onChange: setP("domainLoText") }),
      el("span", "rapid-pair-sep", "to"),
      textInput({ name: "domainHi", value: ps.domainHiText, placeholder: "max", ariaLabel: "Input range maximum", onChange: setP("domainHiText") }),
    );
    g.append(
      subhead("Input range"),
      fieldRow({
        label: "Clip to",
        info: infoTip("Perturbed inputs are clipped to [min, max], e.g. 0 to 1 for pixels. One value for all features, or one per feature (comma-separated). Blank: unbounded.", { align: "end" }),
        control: pair,
        className: "rf-wide",
      }),
    );
    body.append(g);
  }

  const attack = el("div", "rapid-group");
  attack.append(
    subhead("Attack"),
    fieldRow({ label: "Restarts", info: infoTip("Random starting points per point (or region)."), control: numberInput({ name: "restarts", value: a.restarts, integer: true, min: 1, onChange: setA("restarts") }) }),
    fieldRow({ label: "Steps", info: infoTip("Projected-gradient steps per restart."), control: numberInput({ name: "steps", value: a.steps, integer: true, min: 1, onChange: setA("steps") }) }),
    fieldRow({
      label: "Schedule",
      info: infoTip("APGD adapts the step size as it goes; constant is Madry-style PGD with a fixed step α."),
      control: selectInput({
        name: "schedule",
        value: a.schedule,
        options: [
          { value: "apgd", label: "APGD" },
          { value: "constant", label: "Constant" },
        ],
        onChange: (v) => {
          state.patch("attack", { schedule: v });
          rerender();
        },
      }),
    }),
  );
  if (a.schedule === "constant") {
    attack.append(
      fieldRow({
        label: "Step size α",
        info: infoTip("As a fraction of the box width. Blank: 2.5 / steps."),
        control: numberInput({ name: "alpha", value: a.alpha, placeholder: "2.5 / K", onChange: setA("alpha") }),
      }),
    );
  }
  attack.append(fieldRow({ label: "Seed", info: infoTip("The same seed and settings give the same attack (bit for bit on the CPU backend)."), control: numberInput({ name: "seed", value: a.seed, integer: true, min: 0, onChange: setA("seed") }) }));
  body.append(attack);

  const compute = el("div", "rapid-group");
  compute.append(
    subhead("Compute"),
    fieldRow({
      label: "Backend",
      info: infoTip("tf.js backend for the attack. WebGL uses the GPU; CPU is slower but bit-for-bit reproducible."),
      control: selectInput({
        name: "backend",
        value: a.backend,
        options: [
          { value: "webgl", label: "WebGL" },
          { value: "cpu", label: "CPU" },
        ],
        onChange: setA("backend"),
      }),
    }),
    fieldRow({
      label: "Self-test samples",
      info: infoTip("Random inputs on which the tf.js translation of the model is compared with onnxruntime-web before the run."),
      control: numberInput({ name: "selfTestSamples", value: a.selfTestSamples, integer: true, min: 1, onChange: setA("selfTestSamples") }),
    }),
  );
  body.append(compute);
  details.append(body);
  return details;
}

// ---------------------------------------------------------------------------
// Toolbar: one primary button, a short status, phases while running

function renderToolbar(ctx) {
  const box = el("div", "panel rapid-toolbar");
  live.toolbar = box;
  fillToolbar(ctx);
  return box;
}

function fillToolbar(ctx) {
  const box = live.toolbar;
  if (!box) return;
  const s = ctx.state.getState();
  const running = s.run.status === "running";
  box.replaceChildren();
  const missing = needs(s);
  const blockers = isReady(s) ? setupErrors(s) : [];
  const ready = isReady(s) && !blockers.length;
  const action = running
    ? button("Cancel", { onClick: () => ctx.worker.cancel() })
    : button("Run", { primary: true, disabled: !ready, onClick: () => startRun(ctx) });
  action.classList.add("rapid-run");
  const status = el("div", "rapid-status");
  live.phase = null;
  live.fill = null;
  if (running) {
    live.phase = el("p", "rapid-phases");
    const bar = el("div", "progress");
    live.fill = el("div", "progress-fill");
    bar.append(live.fill);
    status.append(live.phase, bar);
    updateProgress();
  } else if (s.model?.loading) {
    status.append(statusLine("busy", `Loading ${s.model.fileName ?? "model"}…`));
  } else if (missing.length) {
    status.append(statusLine("idle", `Needs: ${missing.join(", ")}`));
  } else if (blockers.length) {
    status.append(statusLine("error", blockers[0].short));
  } else if (s.run.status === "error") {
    status.append(errorLine(s.run.error));
  } else if (s.run.status === "cancelled") {
    status.append(statusLine("warn", `Cancelled · ${dataSummary(s)}`));
  } else {
    status.append(statusLine("ok", `Ready · ${dataSummary(s)}`));
  }
  box.append(action, status);
}

function updateProgress() {
  if (!live.phase) return;
  const { steps, detail } = tracker.phases();
  live.phase.replaceChildren();
  steps.forEach((st, i) => {
    if (i) live.phase.append(el("span", "rapid-phase-arrow", " → "));
    live.phase.append(el("span", `rapid-phase is-${st.state}`, st.label));
  });
  if (detail) live.phase.append(el("span", "rapid-phase-detail", ` · ${detail}`));
  if (live.fill) live.fill.style.width = `${Math.round(tracker.fraction() * 100)}%`;
}

/** Re-draw the bits that depend on settings, without a full re-render. */
function softRefresh(ctx) {
  const s = ctx.state.getState();
  fillToolbar(ctx);
  if (live.advState) live.advState.textContent = advancedStateText(s);
  if (live.advReset) live.advReset.hidden = advancedDiffs(s).length === 0;
  updateStale(ctx);
}

function updateStale(ctx) {
  if (!live.resultCard) return;
  const s = ctx.state.getState();
  const running = s.run.status === "running";
  const stale = running || s.run.result?.meta?.signature !== signatureOf(s);
  live.resultCard.classList.toggle("is-stale", stale);
  live.staleBanner.hidden = !stale;
  live.staleText.textContent = running ? "Previous result · a new run is in progress" : "Settings changed since this run";
  live.staleRun.hidden = running || !isReady(s);
}

// ---------------------------------------------------------------------------
// Results: analysis shared by the views and exports

const PUB_CATEGORY = { unsat: "certified", sat: "counterexample", unknown: "unknown" };

function verdictOf(row) {
  if (row.status) return row.status;
  if (row.pass === undefined) return null;
  return row.pass ? "unknown" : "counterexample";
}

function analyse(result) {
  const rows = result.rows;
  const ref = result.meta.reference ?? null;
  const verdicts = rows.map(verdictOf);
  const counts = { certified: 0, counterexample: 0, unknown: 0 };
  verdicts.forEach((v) => v && counts[v]++);
  const pub = ref ? ref.verdicts.map((v) => PUB_CATEGORY[v] ?? "unknown") : null;
  const pubCounts = pub ? { certified: 0, counterexample: 0, unknown: 0 } : null;
  pub?.forEach((v) => pubCounts[v]++);
  const conflictAt = (i) => Boolean(pub) && ((verdicts[i] === "counterexample" && pub[i] === "certified") || (verdicts[i] === "certified" && pub[i] === "counterexample"));
  const conflicts = rows.map((_, i) => i).filter(conflictAt);
  const decidedUndecided = pub ? rows.filter((_, i) => verdicts[i] && verdicts[i] !== "unknown" && pub[i] === "unknown").length : 0;
  return { rows, ref, verdicts, counts, pub, pubCounts, conflicts, conflictAt, decidedUndecided, hasVerdicts: verdicts.some(Boolean) };
}

function words(result) {
  if (result.mode === "properties") {
    return { unit: "property", units: "properties", good: "certified", unknown: "unknown", bad: "counterexample", pub: { unsat: "safe", sat: "unsafe", unknown: "undecided" } };
  }
  if (result.task === "classification") {
    return { unit: "point", units: "points", good: "certified", unknown: "unknown", bad: "counterexample", pub: { unsat: "robust", sat: "not robust", unknown: "undecided" } };
  }
  return { unit: "point", units: "points", good: null, unknown: "no violation found", bad: "violated", pub: {} };
}

const pctRange = (lo, hi) => (lo === hi ? `${formatPercent(lo)} %` : `${formatPercent(lo)}–${formatPercent(hi)} %`);

/** The one-line answer: { main, sub, info } */
function headline(result, an) {
  const s = result.settings;
  const n = result.rows.length;
  const time = formatTime(result.timeMs);
  const crown = result.summary.certification === "crown";
  if (result.mode === "properties") {
    const c = an.counts.certified;
    const hi = n - an.counts.counterexample;
    const main = !crown ? `At most ${hi} of ${n} properties safe` : c === hi ? `${c} of ${n} properties safe` : `${c}–${hi} of ${n} properties safe`;
    return {
      main,
      sub: [`${an.counts.counterexample} unsafe`, `${an.counts.unknown} unknown`, time].join(" · "),
      info: [
        "The lower count is properties certified safe by CROWN; the higher count adds every property the attack could not break. The true number lies in between, up to the float32 caveat on the Method page.",
        disclaimerFor(result),
      ],
    };
  }
  const eps = formatNumber(s.epsilon, 3);
  if (result.task === "classification") {
    const lo = an.counts.certified / n;
    const hi = (n - an.counts.counterexample) / n;
    return {
      main: crown ? `Robust accuracy ${pctRange(lo, hi)}` : `Robust accuracy ≤ ${formatPercent(hi)} %`,
      at: `at ε = ${eps}`,
      sub: `${n} points · ${time}`,
      info: [
        "Lower end: points certified by CROWN. Upper end: points the attack could not break. The true robust accuracy lies in between, up to the float32 caveat on the Method page.",
        disclaimerFor(result),
      ],
    };
  }
  const lip = result.task === "regression-lipschitz";
  const sm = result.summary;
  const limit = lip ? s.lipschitz : s.delta;
  if (limit !== null && limit !== undefined && sm.passCount !== undefined) {
    return {
      main: `No violation found for ${sm.passCount} of ${n} points`,
      at: `at ε = ${eps}, ${lip ? "L" : "δ"} = ${formatNumber(limit, 3)}`,
      sub: `${n} points · ${time}`,
      info: ["The attack found no input breaking the bound at these points, which is not a proof; a violation is a concrete input.", disclaimerFor(result)],
    };
  }
  return {
    main: lip ? `Lipschitz constant ≥ ${formatNumber(sm.maxValue, 4)}` : `Output change ≥ ${formatNumber(sm.maxValue, 4)}`,
    at: `at ε = ${eps}`,
    sub: `largest over ${n} points · ${time}`,
    info: [lip ? "An empirical lower bound on the local Lipschitz constant (L∞ in, L∞ out): the true constant is at least this large." : "The largest output change (L∞) the attack found within ε: the true worst case is at least this large.", disclaimerFor(result)],
  };
}

function alerts(result, an) {
  const out = [];
  if (an.conflicts.length) {
    const which = an.conflicts.slice(0, 6).map((i) => `#${i + 1}`).join(", ") + (an.conflicts.length > 6 ? ", …" : "");
    out.push(
      el(
        "p",
        "rapid-alert is-error",
        `${an.conflicts.length} ${an.conflicts.length === 1 ? "result contradicts" : "results contradict"} a published verdict (${which}). This indicates a bug or a mismatch in the input box: please report it.`,
      ),
    );
  }
  const t = result.selfTest;
  if (t && !t.ok) {
    out.push(
      el(
        "p",
        "rapid-alert is-warn",
        `Self-test: tf.js and onnxruntime-web differ by up to ${formatNumber(t.maxRelError, 3)} (relative), above ${formatNumber(t.tolerance, 2)}. Gradients may be unreliable; counterexamples are still re-checked with onnxruntime-web.`,
      ),
    );
  }
  if (result.summary.certification === "unavailable") {
    out.push(el("p", "rapid-alert is-warn", `Certification unavailable for this model (${result.summary.certificationNote}): attack only, so results are upper bounds.`));
  }
  return out;
}

function infoNotes(result, an) {
  const out = [];
  if (result.extraColumns > 0) out.push(`${result.extraColumns} extra CSV column(s) after the inputs${result.task === "classification" ? " and label" : ""} were ignored.`);
  if (an.decidedUndecided) out.push(`Decided ${an.decidedUndecided} case(s) that no published verifier solved.`);
  const spurious = result.rows.reduce((acc, r) => acc + (r.spurious ?? 0), 0);
  if (spurious) out.push(`${spurious} attack candidate(s) did not hold up when re-checked with onnxruntime-web and were discarded.`);
  if (result.summary.certification === "off" && (result.task === "classification" || result.mode === "properties")) out.push("Certification was turned off: results are upper bounds.");
  return out;
}

// ---------------------------------------------------------------------------
// Results: views

function renderResults(ctx) {
  const s = ctx.state.getState();
  const result = s.run.result;
  live.resultCard = null;
  if (!result) {
    const panel = el("div", "panel rapid-card rapid-empty");
    const benches = BENCHMARKS.filter((b) => b.task === s.pointsSettings.task);
    const actions = [];
    if (benches.length && !isReady(s) && !s.model?.loading) {
      actions.push(
        button("Try a benchmark", {
          onClick: () => {
            const id = benches.some((b) => b.id === s.benchmarkId) ? s.benchmarkId : benches[0].id;
            loadBenchmark(ctx, id);
          },
        }),
      );
    }
    panel.append(
      emptyState({
        title: "Check a network's robustness",
        text: s.run.status === "running" ? "Running… results appear here when it finishes." : isReady(s) && !setupErrors(s).length ? "Ready. Press Run; results appear here." : "Pick a benchmark or open your own model, then Run.",
        actions,
      }),
    );
    return panel;
  }
  return renderResultCard(ctx, result);
}

function renderResultCard(ctx, result) {
  const { state, rerender } = ctx;
  const s = state.getState();
  const an = analyse(result);
  const w = words(result);
  const card = el("section", "panel rapid-card rapid-result");
  live.resultCard = card;

  // Stale banner (shown when settings changed since the run, or while re-running).
  live.staleBanner = el("div", "rapid-stale");
  live.staleText = el("span", "", "");
  live.staleRun = el("button", "rapid-link-button", "Run again");
  live.staleRun.type = "button";
  live.staleRun.addEventListener("click", () => startRun(ctx));
  live.staleBanner.append(live.staleText, " ", live.staleRun);

  // Headline + export.
  const h = headline(result, an);
  const top = el("div", "rapid-result-top");
  const titleBox = el("div", "rapid-headline");
  const main = el("h2", "rapid-answer");
  main.append(h.main);
  if (h.at) main.append(" ", el("span", "rapid-answer-at", h.at));
  main.append(" ", infoTip(h.info, { href: METHOD, align: "start" }));
  titleBox.append(main, el("p", "rapid-answer-sub", h.sub));
  top.append(titleBox, exportMenu(result, an));
  card.append(live.staleBanner, top);

  const body = el("div", "rapid-result-body");
  if (an.hasVerdicts) {
    const n = result.rows.length;
    const published = an.pubCounts ? { lo: an.pubCounts.certified / n, hi: (an.pubCounts.certified + an.pubCounts.unknown) / n } : null;
    body.append(
      createRangeBar({
        counts: { good: an.counts.certified, unknown: an.counts.unknown, bad: an.counts.counterexample },
        labels: { good: w.good ?? "certified", unknown: w.unknown, bad: w.bad },
        published,
      }),
    );
  }
  body.append(...alerts(result, an));

  const tabs = [
    { value: "summary", label: "Summary" },
    { value: "points", label: result.mode === "properties" ? "Per property" : "Per point" },
    { value: "repro", label: "Reproducibility" },
  ];
  const tab = tabs.some((t) => t.value === s.rapid.tab) ? s.rapid.tab : "summary";
  const tabBar = segmented({
    label: "Result views",
    value: tab,
    options: tabs,
    onChange: (v) => {
      state.patch("rapid", { tab: v });
      rerender();
    },
  });
  tabBar.classList.add("rapid-tabs");
  body.append(tabBar);
  const view = el("div", "rapid-view");
  if (tab === "summary") view.append(...summaryView(result, an, w));
  else if (tab === "points") view.append(pointsView(ctx, result, an, w));
  else view.append(...reproView(result));
  body.append(view);
  card.append(body);
  updateStale(ctx);
  return card;
}

function sourceLink(ref) {
  const a = el("a", "inline-link", "source ↗");
  a.href = ref.sourceUrl;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

function summaryView(result, an, w) {
  const out = [];
  const s = result.settings;
  const sm = result.summary;
  const n = result.rows.length;
  const facts = [];
  if (an.pubCounts) {
    const lo = an.pubCounts.certified / n;
    const hi = (an.pubCounts.certified + an.pubCounts.unknown) / n;
    const share = result.mode === "properties" ? `${an.pubCounts.certified}${an.pubCounts.unknown ? `–${an.pubCounts.certified + an.pubCounts.unknown}` : ""} of ${n} safe` : `${pctRange(lo, hi)} robust`;
    facts.push({ label: "Published", value: [`${share} · `, sourceLink(an.ref)], note: "Verdicts of the competition's complete verifiers." });
  }
  if (result.task === "classification") {
    facts.push({ label: "Clean accuracy", value: `${formatPercent(sm.cleanAccuracy)} %`, note: "Correct without any perturbation." });
    if (sm.medianCertifiedRadius !== null && sm.medianCertifiedRadius !== undefined) facts.push({ label: "Median certified ε", value: `≥ ${formatNumber(sm.medianCertifiedRadius, 4)}` });
    if (sm.medianSmallestEpsilon !== null) {
      facts.push({
        label: "Median breaking ε",
        value: Number.isFinite(sm.medianSmallestEpsilon) ? `≤ ${formatNumber(sm.medianSmallestEpsilon, 4)}` : `> ${formatNumber(s.epsilon, 4)}`,
      });
    }
  }
  if (result.task === "regression-standard" || result.task === "regression-lipschitz") {
    const lip = result.task === "regression-lipschitz";
    facts.push({ label: lip ? "Largest Lipschitz ≥" : "Largest change ≥", value: formatNumber(sm.maxValue, 4) });
    facts.push({ label: "Median over points", value: formatNumber(sm.medianValue, 4) });
  }
  if (result.task === "classification" || result.mode === "properties") {
    facts.push({ label: "Certification", value: { crown: "CROWN", off: "off", unavailable: "unavailable" }[sm.certification] ?? "–" });
  }
  facts.push({ label: "Attack", value: `${s.restarts} restarts × ${s.steps} steps (${s.schedule === "apgd" ? "APGD" : "constant"})` });
  if (result.selfTest?.count) {
    facts.push({ label: "Self-test", value: `${result.selfTest.ok ? "passed" : "above tolerance"} · max rel. error ${formatNumber(result.selfTest.maxRelError, 2)}` });
  }
  facts.push({ label: "Time", value: formatTime(result.timeMs) });
  out.push(detailList(facts));

  if (result.task === "classification" && s.searchEpsilon) {
    const fig = el("div", "rapid-hist");
    fig.append(el("h3", "section-heading", "Smallest breaking ε per point"), createEpsilonHistogram(result.rows.map((r) => r.smallestEpsilon), s.epsilon));
    out.push(fig);
  }

  const notes = infoNotes(result, an);
  if (notes.length) {
    const d = document.createElement("details");
    d.className = "rapid-notes";
    d.append(el("summary", "", `Notes (${notes.length})`));
    const ul = el("ul", "rapid-notes-list");
    notes.forEach((t) => ul.append(el("li", "", t)));
    d.append(ul);
    out.push(d);
  }
  return out;
}

function pubFor(an, w, i) {
  if (!an.ref) return null;
  const v = an.ref.verdicts[i];
  const cat = an.pub[i];
  return { label: w.pub[v] ?? "undecided", state: an.conflictAt(i) ? "conflict" : cat === an.verdicts[i] ? "match" : "differs" };
}

function valuesPreview(x, k = 6) {
  const head = x.slice(0, k).map((v) => formatNumber(v, 4)).join(", ");
  return x.length > k ? `[${head}, …] (${x.length} values)` : `[${head}]`;
}

function smallButton(text, onClick) {
  const b = el("button", "secondary-button rapid-small-button", text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function pointsView(ctx, result, an, w) {
  const { state } = ctx;
  const s = result.settings;
  const names = result.meta.imageNames;
  const crown = result.summary.certification === "crown";
  const verdict = (i) => (an.verdicts[i] ? { key: an.verdicts[i], label: an.verdicts[i] === "certified" ? w.good : an.verdicts[i] === "unknown" ? w.unknown : w.bad } : null);
  let items;
  let columns;

  if (result.mode === "properties") {
    columns = { title: "#", sub: "Property", verdict: "Result" };
    items = result.rows.map((r, i) => ({
      index: i,
      title: `#${i + 1}`,
      sub: names?.[i] ?? r.name,
      verdict: verdict(i),
      published: pubFor(an, w, i),
      details: () => {
        const box = el("div", "rapid-detail");
        box.append(
          detailList([
            crown && r.certifiedSlack !== undefined
              ? { label: "Slack ≥ (CROWN)", value: r.certifiedSlack === Infinity ? "∞" : formatNumber(r.certifiedSlack, 4), note: "CROWN lower bound on the distance from the unsafe condition; above 0 (plus float32 margin) means certified." }
              : null,
            r.certifiedBySplitting ? { label: "Certified by", value: `splitting the box into ${r.splitPieces} pieces` } : null,
            r.bestMargin !== undefined ? { label: "Margin ≤ (attack)", value: formatNumber(r.bestMargin, 4), note: "Lowest unsafe-condition margin reached; ≤ 0 means a counterexample." } : null,
            r.regions > 1 ? { label: "Input regions", value: String(r.regions) } : null,
            an.ref ? { label: "Published", value: pubFor(an, w, i).label } : null,
          ]),
        );
        if (r.counterexample?.text) {
          const pre = el("pre", "mono rapid-ce", r.counterexample.text.split("\n").slice(0, 8).join("\n") + (r.counterexample.text.split("\n").length > 8 ? "\n…" : ""));
          box.append(
            pre,
            smallButton("Download counterexample", () =>
              downloadTextFile(`; ${names?.[i] ?? r.name}\n${r.counterexample.text}`, `counterexample-${names?.[i] ?? i + 1}.txt`, "text/plain"),
            ),
          );
        }
        return box;
      },
    }));
  } else if (result.task === "classification") {
    columns = { title: "#", sub: "Label", verdict: "Result" };
    items = result.rows.map((r, i) => ({
      index: i,
      title: names ? `#${i + 1} ${names[i]}` : `#${i + 1}`,
      sub: String(r.label),
      verdict: verdict(i),
      published: pubFor(an, w, i),
      details: () => {
        const box = el("div", "rapid-detail");
        let pred;
        if (!r.cleanCorrect) pred = { label: "Prediction", value: `${r.cleanPrediction} (label ${r.label})`, note: "Misclassified without any perturbation." };
        else if (r.broken && r.counterexample) pred = { label: "Prediction", value: `${r.cleanPrediction} → ${r.counterexample.prediction}`, note: "Clean → under the counterexample." };
        else pred = { label: "Prediction", value: `${r.cleanPrediction}`, note: "Correct on the clean input." };
        box.append(
          detailList([
            pred,
            crown && r.certifiedBound !== undefined ? { label: "Margin ≥ (CROWN)", value: formatNumber(r.certifiedBound, 4), note: "CROWN lower bound over the ε-ball; above 0 (plus float32 margin) means certified." } : null,
            r.bestMargin !== undefined ? { label: "Margin ≤ (attack)", value: formatNumber(r.bestMargin, 4), note: "Lowest margin the attack reached; below 0 means a counterexample." } : null,
            s.searchEpsilon && crown && r.cleanCorrect
              ? { label: "Certified up to ε", value: r.certifiedRadiusAtLeastEpsilon ? `≥ ${formatNumber(s.epsilon, 4)}` : formatNumber(r.certifiedRadius, 4), note: "Largest ε CROWN certifies (bisection)." }
              : null,
            s.searchEpsilon && r.cleanCorrect
              ? {
                  label: "Breaks from ε",
                  value: Number.isFinite(r.smallestEpsilon) ? `≤ ${formatNumber(r.smallestEpsilon, 4)}` : `> ${formatNumber(s.epsilon, 4)}`,
                  note: "Smallest ε with a counterexample found (an upper bound).",
                }
              : null,
            an.ref ? { label: "Published", value: pubFor(an, w, i).label } : null,
            r.counterexample && r.cleanCorrect ? { label: "Counterexample", value: valuesPreview(r.counterexample.x), note: r.counterexample.epsilon !== undefined ? `Found at ε = ${formatNumber(r.counterexample.epsilon, 4)}.` : null } : null,
          ]),
        );
        if (r.counterexample && r.cleanCorrect) {
          box.append(
            smallButton("Download counterexample (.csv)", () =>
              downloadTextFile(counterexampleCsv([{ r, name: names?.[i] }], result), `counterexample-${i + 1}.csv`, "text/csv"),
            ),
          );
        }
        return box;
      },
    }));
  } else {
    const lip = result.task === "regression-lipschitz";
    columns = { title: "#", sub: lip ? "L ≥" : "Change ≥", verdict: "Result" };
    items = result.rows.map((r, i) => ({
      index: i,
      title: names ? `#${i + 1} ${names[i]}` : `#${i + 1}`,
      sub: formatNumber(lip ? r.lipschitzLowerBound : r.maxDeviation, 3),
      verdict: verdict(i),
      published: null,
      details: () => {
        const box = el("div", "rapid-detail");
        box.append(
          detailList([
            { label: "Output change ‖Δy‖∞", value: formatNumber(r.maxDeviation, 4), note: "Largest found within ε; the true worst case is at least this." },
            { label: "Input change ‖Δx‖∞", value: formatNumber(r.distance, 4) },
            lip ? { label: "Lipschitz ≥", value: formatNumber(r.lipschitzLowerBound, 4), note: "Output change ÷ input change." } : null,
            { label: "Worst input", value: valuesPreview(r.counterexample.x) },
          ]),
          smallButton("Download worst input (.csv)", () => downloadTextFile(r.counterexample.x.join(",") + "\n", `worst-input-${i + 1}.csv`, "text/csv")),
        );
        return box;
      },
    }));
  }

  return createPointList({
    items,
    columns,
    labels: { counterexample: w.bad, unknown: w.unknown, certified: w.good },
    filter: state.getState().rapid.filter,
    onFilter: (f) => state.patch("rapid", { filter: f }),
    openSet: openRows,
  });
}

function reproView(result) {
  const repro = reproducibility(result);
  const text = JSON.stringify(repro, jsonReplacer, 2);
  const row = el("div", "button-row");
  row.append(copyButton(() => text, "Copy"));
  return [el("p", "section-note", "Everything needed to repeat this run. The full report (Export) also holds every per-point value."), el("pre", "mono rapid-repro", text), row];
}

function exportMenu(result, an) {
  const items = [];
  const add = (label, fn) => {
    const b = el("button", "rapid-menu-item", label);
    b.type = "button";
    b.addEventListener("click", fn);
    items.push(b);
  };
  const names = result.meta.imageNames;
  if (result.mode === "properties") {
    add("Per-property table (.csv)", () => downloadTextFile(propertiesCsv(result, an), "robustness-properties.csv", "text/csv"));
    const ces = result.rows.filter((r) => r.counterexample);
    if (ces.length) {
      add(`Counterexamples (${ces.length}, VNN-COMP .txt)`, () =>
        downloadTextFile(ces.map((r) => `; ${names?.[r.index] ?? r.name}\n${r.counterexample.text}`).join("\n"), "counterexamples.txt", "text/plain"),
      );
    }
  } else {
    add("Per-point table (.csv)", () => downloadTextFile(pointsCsv(result), "robustness-points.csv", "text/csv"));
    if (result.task === "classification") {
      const ces = result.rows.filter((r) => r.counterexample && r.cleanCorrect).map((r) => ({ r, name: names?.[r.index] }));
      if (ces.length) add(`Counterexamples (${ces.length}, .csv)`, () => downloadTextFile(counterexampleCsv(ces, result), "counterexamples.csv", "text/csv"));
    }
  }
  add("Full report (.json)", () =>
    downloadTextFile(JSON.stringify({ ...result, reproducibility: reproducibility(result) }, jsonReplacer, 2), "robustness-report.json", "application/json"),
  );
  const trigger = el("button", "secondary-button rapid-export", "Export ▾");
  return popover(trigger, items, { className: "rapid-menu", align: "end" });
}

// ---------------------------------------------------------------------------
// Exports (the disclaimer stays in every file)

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
    schedule: s.schedule,
    alpha: s.schedule === "constant" ? s.alpha : undefined,
    backend: s.backend,
    selfTestSamples: result.selfTest.count,
    selfTestMaxRelError: result.selfTest.maxRelError,
    tfjs: TFJS_VERSION,
    onnxruntimeWeb: ORT_VERSION,
    statement: disclaimerFor(result),
  };
}

const csvEscape = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function tableCsv(cols, rows, result) {
  const lines = [cols.map((c) => csvEscape(c.label)).join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(String(c.value(r)))).join(","));
  lines.push("", `# ${disclaimerFor(result)}`, `# ${JSON.stringify(reproducibility(result), jsonReplacer)}`);
  return lines.join("\n") + "\n";
}

function pointColumns(result) {
  const s = result.settings;
  const names = result.meta.imageNames;
  const idx = { label: "#", value: (r) => (names ? `${r.index + 1} (${names[r.index]})` : String(r.index + 1)) };
  if (result.task === "classification") {
    const ref = result.meta.reference;
    const cols = [
      idx,
      { label: "Label", value: (r) => String(r.label) },
      { label: "Clean pred.", value: (r) => String(r.cleanPrediction) },
      { label: "Result", value: (r) => r.status },
      { label: "Adv. pred.", value: (r) => (r.broken && r.cleanCorrect ? String(r.counterexample.prediction) : "–") },
    ];
    if (result.summary.certification === "crown") cols.push({ label: "Margin ≥ (CROWN)", value: (r) => (r.certifiedBound === undefined ? "–" : formatNumber(r.certifiedBound, 4)) });
    cols.push({ label: "Margin ≤ (attack)", value: (r) => (r.bestMargin === undefined ? "–" : formatNumber(r.bestMargin, 4)) });
    if (ref) cols.push({ label: "Published", value: (r) => ({ unsat: "robust", sat: "not robust" })[ref.verdicts[r.index]] ?? "undecided" });
    if (s.searchEpsilon && result.summary.certification === "crown") {
      cols.push({ label: "Certified ε ≥", value: (r) => (r.certifiedRadiusAtLeastEpsilon ? `≥ ${formatNumber(s.epsilon)}` : formatNumber(r.certifiedRadius, 4)) });
    }
    if (s.searchEpsilon) {
      cols.push({
        label: "Breaking ε ≤",
        value: (r) => (r.smallestEpsilon === 0 ? "0" : Number.isFinite(r.smallestEpsilon) ? `≤ ${formatNumber(r.smallestEpsilon, 4)}` : `> ${formatNumber(s.epsilon)}`),
      });
    }
    return cols;
  }
  const lip = result.task === "regression-lipschitz";
  const cols = [idx, { label: "Max deviation ‖Δy‖∞", value: (r) => formatNumber(r.maxDeviation) }, { label: "‖Δx‖∞", value: (r) => formatNumber(r.distance) }];
  if (lip) cols.push({ label: "Lipschitz lower bound", value: (r) => formatNumber(r.lipschitzLowerBound) });
  if (result.rows.some((r) => r.pass !== undefined)) cols.push({ label: lip ? "≤ L?" : "≤ δ?", value: (r) => (r.pass ? "no violation found" : "violated") });
  return cols;
}

const pointsCsv = (result) => tableCsv(pointColumns(result), result.rows, result);

function propertiesCsv(result, an) {
  const names = result.meta.imageNames;
  const w = words(result);
  const cols = [
    { label: "#", value: (r) => String(r.index + 1) },
    { label: "Property", value: (r) => names?.[r.index] ?? r.name },
    { label: "Result", value: (r) => r.status },
    { label: "Slack ≥ (CROWN)", value: (r) => (r.certifiedBySplitting ? `by splitting (${r.splitPieces} pieces)` : r.certifiedSlack === undefined ? "–" : formatNumber(r.certifiedSlack, 4)) },
    { label: "Margin ≤ (attack)", value: (r) => (r.bestMargin === undefined ? "–" : formatNumber(r.bestMargin, 4)) },
  ];
  if (an.ref) cols.push({ label: "Published", value: (r) => w.pub[an.ref.verdicts[r.index]] ?? "undecided" });
  return tableCsv(cols, result.rows, result);
}

/** Counterexample inputs as a points CSV (inputs, then the true label), so they can be loaded back. */
function counterexampleCsv(entries, result) {
  const lines = [`# Counterexamples from ${result.meta.model} at ε = ${result.settings.epsilon}: inputs, then the true label.`];
  for (const { r, name } of entries) {
    lines.push(`# point ${r.index + 1}${name ? ` (${name})` : ""}: label ${r.label} → predicted ${r.counterexample.prediction}`);
    lines.push([...r.counterexample.x.map((v) => String(v)), r.label].join(","));
  }
  lines.push(`# ${disclaimerFor(result)}`);
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------

export function renderCheckPage(ctx) {
  for (const key of Object.keys(live)) live[key] = null;
  const page = el("section", "rapid-page");
  const controls = el("div", "rapid-controls");
  controls.append(renderSetup(ctx));
  const toolbar = renderToolbar(ctx);
  toolbar.classList.add("rapid-toolbar-area");
  const results = el("div", "rapid-results");
  results.append(renderResults(ctx));
  page.append(controls, toolbar, results);
  return page;
}
