import { el, info, hint, statusPill, emptyState, button, popover, copyButton } from "../components/ui.js";
import { readFileBytes } from "../components/file-input.js";
import { downloadTextFile } from "../components/download.js";
import {
  RUNNER_URL,
  runner,
  subscribe,
  connect,
  stopConnecting,
  startCommand,
  runJob,
  cancelJob,
} from "../vehicle/runner-client.js";
import { displayText, parseVehicleOutput, verdictLabel } from "../vehicle/output.js";

// VehicleWrapper Run tab: a .vcl editor beside the result. The toolbar holds the one main action
// (Connect runner / Verify / Cancel), the specification's inputs and the runner's status. Runner
// setup appears in the result pane only while not connected. Vehicle's output is read into one
// row per property; the raw text stays available under "Full output".
//
// Typing never redraws the editor: runner events, streamed output and edits update the toolbar
// and the result pane in place (current.refresh), so the editor keeps focus and selection.

const METHOD = "#/vehicle-method";
const DOCKER_URL = "https://docs.docker.com/get-started/get-docker/";

const form = {
  specification: "",
  networks: {}, // name -> { fileName, bytes }
  datasets: {}, // name -> { fileName, bytes, extension }
  parameters: {}, // name -> text
  timeout: 600,
  exampleLoaded: false,
  error: null,
};

const view = {
  showFullCommand: false,
  fullOutputOpen: false,
  expanded: new Map(), // property name -> open
};

let lastRun = null; // { signature, properties } of the latest Verify
let current = null; // { page, refresh, setSpec, focusLine } of the latest render

subscribe(() => {
  if (current && document.body.contains(current.page)) current.refresh();
});

/** Networks, datasets, parameters and properties declared in a specification (comments ignored). */
export function declarations(specification) {
  const text = specification.replace(/\{-[\s\S]*?-\}/g, " ").replace(/--.*$/gm, "");
  const found = { networks: [], datasets: [], parameters: [], properties: [] };
  const pattern = /@(network|dataset|parameter|property)\s*(\([^)]*\))?\s+([A-Za-z_][A-Za-z0-9_']*)\s*:/g;
  for (const [, kind, options, name] of text.matchAll(pattern)) {
    if (kind === "parameter" && options && /infer\s*=\s*True/.test(options)) continue; // inferred from data
    const list = found[kind === "property" ? "properties" : `${kind}s`];
    if (!list.includes(name)) list.push(name);
  }
  return found;
}

function missingInputs(found) {
  const missing = [];
  if (!form.specification.trim()) missing.push("a specification");
  for (const name of found.networks) if (!form.networks[name]) missing.push(`network ${name}`);
  for (const name of found.datasets) if (!form.datasets[name]) missing.push(`dataset ${name}`);
  for (const name of found.parameters) if (!form.parameters[name]) missing.push(`parameter ${name}`);
  return missing;
}

/** What a run depends on, to tell when a shown result is out of date. */
function signature(found) {
  const file = (f) => (f ? `${f.fileName}:${f.bytes.length}` : null);
  return JSON.stringify({
    s: form.specification,
    n: found.networks.map((n) => file(form.networks[n])),
    d: found.datasets.map((n) => file(form.datasets[n])),
    p: found.parameters.map((n) => form.parameters[n] ?? ""),
  });
}

const isRunning = () => runner.job?.status === "running";
const isConnected = () => runner.connection === "connected";

function canVerify(found = declarations(form.specification)) {
  return isConnected() && !isRunning() && missingInputs(found).length === 0;
}

function verify() {
  const found = declarations(form.specification);
  if (!canVerify(found)) return;
  lastRun = { signature: signature(found), properties: found.properties };
  view.expanded.clear();
  view.fullOutputOpen = false;
  const pick = (all, names) => Object.fromEntries(names.map((n) => [n, all[n]]));
  runJob(
    {
      specification: form.specification,
      networks: pick(form.networks, found.networks),
      datasets: pick(form.datasets, found.datasets),
      parameters: pick(form.parameters, found.parameters),
      timeout: form.timeout,
    },
    scheduleOutput,
  );
}

// Streamed output: redraw the result pane at most once per frame.
let outputFrame = 0;
function scheduleOutput() {
  if (outputFrame) return;
  outputFrame = requestAnimationFrame(() => {
    outputFrame = 0;
    if (current && document.body.contains(current.page)) current.refreshOutput();
  });
}

async function loadExample() {
  try {
    const [spec, model] = await Promise.all([
      fetch("./runner/example/spec.vcl").then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.statusText)))),
      fetch("./runner/example/model.onnx").then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText)))),
    ]);
    form.specification = spec;
    form.networks = { f: { fileName: "model.onnx (example)", bytes: new Uint8Array(model) } };
    form.datasets = {};
    form.parameters = {};
    form.error = null;
  } catch (error) {
    form.error = `Could not load the example: ${error.message}`;
  }
  form.exampleLoaded = true;
  current?.setSpec(form.specification);
}

function closePopovers() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
}

/** Keep open popover panels inside the viewport (they are placed below their button). */
function fitPopovers(root) {
  requestAnimationFrame(() => {
    for (const panel of root.querySelectorAll(".popover-panel:not([hidden])")) {
      panel.style.transform = "";
      const rect = panel.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      let shift = 0;
      if (rect.right > width - 8) shift = width - 8 - rect.right;
      if (rect.left + shift < 8) shift = 8 - rect.left;
      if (shift) panel.style.transform = `translateX(${Math.round(shift)}px)`;
    }
  });
}

function hiddenFileInput(accept, onFile) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.hidden = true;
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) await onFile(file);
  });
  return input;
}

function versionOf(text) {
  return /\d+(\.\d+)+/.exec(text ?? "")?.[0] ?? text ?? "?";
}

// ---- toolbar ----------------------------------------------------------------------------------

function buildToolbar() {
  const bar = el("div", "vw-toolbar");

  // Main action: one button whose meaning follows the state.
  const primary = el("button", "run-button vw-primary");
  primary.type = "button";
  primary.addEventListener("click", () => {
    if (isRunning()) cancelJob();
    else if (isConnected()) verify();
    else if (runner.connection !== "connecting") {
      connect();
      if (window.matchMedia("(max-width: 799px)").matches) {
        current?.output.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  });
  const needs = el("span", "vw-needs");

  // Open: the example or a .vcl file.
  const vclInput = hiddenFileInput(".vcl,text/plain", async (file) => {
    form.specification = await file.text();
    form.error = null;
    current?.setSpec(form.specification);
  });
  const menuItem = (text, onClick) => {
    const item = el("button", "vw-menu-item", text);
    item.type = "button";
    item.addEventListener("click", () => {
      closePopovers();
      onClick();
    });
    return item;
  };
  const openButton = el("button", "secondary-button vw-tool", "Open ▾");
  const openMenu = popover(openButton, [
    menuItem("Example: tiny ReLU network", loadExample),
    menuItem("Open .vcl file…", () => vclInput.click()),
  ]);

  // Inputs the specification declares.
  const inputsButton = el("button", "secondary-button vw-tool");
  const inputsPanel = el("div", "vw-inputs-panel");
  const inputsMenu = popover(inputsButton, inputsPanel);
  let inputsShown = null;

  // Time limit.
  const timeButton = el("button", "secondary-button vw-tool");
  const timeInput = document.createElement("input");
  timeInput.type = "number";
  timeInput.id = "vw-timeout";
  timeInput.min = "1";
  timeInput.className = "vw-number";
  timeInput.value = String(form.timeout);
  const timeHint = hint("");
  timeInput.addEventListener("change", () => {
    const max = runner.info?.maxTimeout ?? 3600;
    form.timeout = Math.max(1, Math.min(max, Math.trunc(Number(timeInput.value) || 600)));
    timeInput.value = String(form.timeout);
    update();
  });
  const timeLabel = el("label", "vw-field-label", "Time limit for the whole run (s)");
  timeLabel.htmlFor = "vw-timeout";
  const timeMenu = popover(timeButton, [timeLabel, timeInput, timeHint]);

  // Runner status.
  const pillButton = el("button", "vw-pill-button");
  pillButton.setAttribute("aria-label", "Runner status");
  const pillPanel = el("div", "vw-pill-panel");
  const pillMenu = popover(pillButton, pillPanel, { align: "end" });

  bar.append(primary, needs, openMenu, inputsMenu, timeMenu, el("span", "vw-spacer"), pillMenu, vclInput);
  bar.addEventListener("click", () => fitPopovers(bar), true); // capture: popover buttons stop propagation

  function renderInputsPanel(found) {
    const parts = [];
    const fileRow = (kind, name, chosen, accept, onFile) => {
      const row = el("div", "vw-input-row");
      const input = hiddenFileInput(accept, async (file) => {
        await onFile(file);
        inputsShown = null; // redraw the panel with the new file name
        current?.refresh();
      });
      const choose = button(chosen ? "Change…" : "Choose…", { onClick: () => input.click() });
      choose.classList.add("vw-small");
      choose.setAttribute("aria-label", `Choose ${kind} ${name}`);
      const state = el("span", chosen ? "vw-input-file" : "vw-input-file is-missing", chosen ? chosen.fileName : "not loaded");
      row.append(el("span", "vw-input-name", `${chosen ? "✓" : "✗"} ${name}`), state, choose, input);
      return row;
    };
    if (found.networks.length) {
      parts.push(el("p", "vw-panel-title", "Networks (.onnx)"));
      for (const name of found.networks) {
        parts.push(
          fileRow("network", name, form.networks[name], ".onnx", async (file) => {
            form.networks[name] = { fileName: file.name, bytes: await readFileBytes(file) };
          }),
        );
      }
    }
    if (found.datasets.length) {
      parts.push(el("p", "vw-panel-title", "Datasets"));
      for (const name of found.datasets) {
        parts.push(
          fileRow("dataset", name, form.datasets[name], ".idx,.npy,.csv,.json", async (file) => {
            const extension = (file.name.split(".").pop() ?? "").toLowerCase();
            form.datasets[name] = { fileName: file.name, bytes: await readFileBytes(file), extension };
          }),
        );
      }
    }
    if (found.parameters.length) {
      parts.push(el("p", "vw-panel-title", "Parameters"));
      for (const name of found.parameters) {
        const row = el("label", "vw-input-row");
        const input = document.createElement("input");
        input.type = "text";
        input.className = "vw-param";
        input.value = form.parameters[name] ?? "";
        input.placeholder = "number, True or False";
        input.addEventListener("input", () => {
          form.parameters[name] = input.value.trim();
          update(); // label and main button only; the panel keeps focus
          current?.refreshOutput();
        });
        row.append(el("span", "vw-input-name", name), input);
        parts.push(row);
      }
    }
    if (!parts.length) parts.push(el("p", "", "The specification declares no networks, datasets or parameters."));
    inputsPanel.replaceChildren(...parts);
  }

  function inputsLabel(found) {
    const items = [
      ...found.networks.map((n) => [n, !!form.networks[n]]),
      ...found.datasets.map((n) => [n, !!form.datasets[n]]),
      ...found.parameters.map((n) => [n, !!form.parameters[n]]),
    ];
    const kind = found.datasets.length || found.parameters.length ? "Inputs" : "Networks";
    if (!items.length) return { text: "Inputs: none", missing: false };
    const missing = items.some(([, ok]) => !ok);
    if (items.length > 3) {
      const ready = items.filter(([, ok]) => ok).length;
      return { text: `${kind}: ${ready}/${items.length} ${missing ? "✗" : "✓"}`, missing };
    }
    return { text: `${kind}: ${items.map(([n, ok]) => `${n} ${ok ? "✓" : "✗"}`).join(" · ")}`, missing };
  }

  function updatePill() {
    const c = runner.connection;
    let pill;
    if (c === "connected" && isRunning()) pill = statusPill("busy", "Running");
    else if (c === "connected") {
      pill = statusPill("ok", "Connected");
      pill.lastChild.append(el("span", "vw-wide-only", ` · Vehicle ${versionOf(runner.info?.versions?.vehicle)}`));
    }
    else if (c === "connecting") pill = statusPill("busy", "Connecting…");
    else if (c === "lost") pill = statusPill("warn", "Disconnected");
    else if (c === "wrong-token") pill = statusPill("error", "Token refused");
    else if (c === "refused") pill = statusPill("error", "Connection refused");
    else pill = statusPill("idle", "Not connected");
    pillButton.replaceChildren(pill);

    const parts = [];
    if (c === "connected") {
      const v = runner.info?.versions ?? {};
      parts.push(
        el("p", "", `Vehicle ${versionOf(v.vehicle)} · Marabou ${v.maraboupy ?? "?"}`),
        el("p", "vw-muted", `Runner image ${v.image ?? "unknown"}`),
        el("p", "", "The runner stops when you close this page."),
      );
    } else {
      parts.push(el("p", "", `Runs on your machine. This page talks only to ${RUNNER_URL}, and only after you press Connect.`));
    }
    const more = el("a", "inline-link", "How it works →");
    more.href = METHOD;
    parts.push(more);
    pillPanel.replaceChildren(...parts);
  }

  function update() {
    const found = declarations(form.specification);
    const running = isRunning();
    const connected = isConnected();
    const missing = missingInputs(found);

    if (running) {
      primary.textContent = "Cancel";
      primary.className = "secondary-button vw-primary";
      primary.disabled = false;
    } else if (connected) {
      primary.textContent = "Verify";
      primary.className = "run-button vw-primary";
      primary.disabled = missing.length > 0;
    } else {
      primary.textContent = runner.connection === "connecting" ? "Connecting…" : "Connect runner";
      primary.className = "run-button vw-primary";
      primary.disabled = runner.connection === "connecting";
    }
    needs.textContent = connected && !running && missing.length ? `Needs: ${missing.join(", ")}` : "";
    primary.title = needs.textContent;

    const key = JSON.stringify([found.networks, found.datasets, found.parameters]);
    if (key !== inputsShown) {
      inputsShown = key;
      renderInputsPanel(found);
    }
    const label = inputsLabel(found);
    inputsButton.textContent = label.text;
    inputsButton.classList.toggle("is-missing", label.missing);

    const max = runner.info?.maxTimeout ?? 3600;
    timeInput.max = String(max);
    timeHint.textContent = `1 to ${max} s.`;
    timeButton.replaceChildren(el("span", "vw-wide-only", "Time limit "), `${form.timeout} s`);
    timeButton.setAttribute("aria-label", `Time limit ${form.timeout} seconds`);

    updatePill();
  }

  update();
  return { bar, update };
}

// ---- result pane: runner setup ----------------------------------------------------------------

function renderSetup() {
  const box = el("div", "vw-setup");
  const title = el("h3", "vw-pane-title", "Start the runner ");
  box.append(title);
  title.append(
    info(
      `Verification runs in a Docker container on your own machine. This page talks only to ${RUNNER_URL}, and only after you press Connect. Your browser may ask to allow this.`,
      METHOD,
    ),
  );

  const steps = el("ol", "vw-steps");

  const docker = el("li");
  const dockerLink = el("a", "inline-link", "Install Docker ↗");
  dockerLink.href = DOCKER_URL;
  dockerLink.target = "_blank";
  dockerLink.rel = "noopener noreferrer";
  docker.className = "vw-step-inline";
  docker.append(dockerLink, el("span", "vw-muted", " and start it"));

  const command = el("li");
  const commandLine = el("div", "vw-command");
  const commandText = el("code", view.showFullCommand ? "vw-command-text is-full" : "vw-command-text", startCommand());
  commandText.title = view.showFullCommand ? "" : "Show full command to read it all";
  commandLine.append(commandText, copyButton(startCommand));
  const toggle = el("button", "vw-link-button", view.showFullCommand ? "Hide full command" : "Show full command");
  toggle.type = "button";
  toggle.addEventListener("click", () => {
    view.showFullCommand = !view.showFullCommand;
    current?.refreshOutput();
  });
  const commandMeta = el("div", "vw-command-meta");
  commandMeta.append(toggle, el("span", "", "First start downloads about 650 MB"));
  command.append(el("span", "", "Run in a terminal"), commandLine, commandMeta);

  const press = el("li");
  if (runner.connection === "connecting") {
    press.append(
      statusPill("busy", "Waiting for the runner…"),
      " ",
      button("Stop waiting", { onClick: stopConnecting }),
    );
  } else {
    press.append(button("Connect", { primary: true, onClick: connect }));
  }
  steps.append(docker, command, press);
  box.append(steps);

  if (runner.connection === "wrong-token") {
    box.append(
      el("p", "error-text", "The runner refused this page's token."),
      hint("It was started from another tab or with an older command. Stop it (Ctrl+C) and run the command above."),
    );
  } else if (runner.connection === "refused") {
    box.append(
      el("p", "error-text", "The runner refused the connection."),
      hint("An old runner or another program may be on port 8765. Stop it and run the command above."),
    );
  } else if (runner.error) {
    box.append(el("p", "error-text", runner.error));
  }
  return box;
}

// ---- result pane: verdicts --------------------------------------------------------------------

const ICONS = {
  proved: "✓",
  false: "✗",
  timeout: "⏱",
  unknown: "?",
  error: "!",
  running: "◌",
  pending: "○",
  skipped: "–",
};

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

const baseName = (name) => name.replace(/[![].*$/, "");

/** Final state of a row once the job is over, for properties Vehicle never finished. */
function settle(row, job) {
  if (row.verdict !== "pending" && row.verdict !== "running") return row;
  if (job.status === "running") return row;
  if (job.status === "done" && job.outcome === "timeout") return { ...row, verdict: "timeout", label: "timeout" };
  if (job.status === "cancelled" || job.outcome === "cancelled") return { ...row, verdict: "skipped", label: "cancelled" };
  if (job.status === "done" && job.exitCode === 0) return { ...row, verdict: "unknown", label: "not reported" };
  return { ...row, verdict: "skipped", label: "not checked" };
}

const isCounterexample = (row) => row.verdict === "false" && /counterexample/i.test(row.message ?? "");

/** One row for a property Vehicle verified element by element (e.g. many!0, many!1, …). */
function groupRow(name, members, job, last) {
  const count = (v) => members.filter((m) => m.verdict === v).length;
  const proved = count("proved");
  const falses = count("false");
  // Vehicle checks properties in turn: the group last reported may have elements still to come.
  const cutShort = members.includes(last) && !(job.status === "done" && job.outcome === "finished");
  const open = count("running") + count("pending") + (cutShort && !count("running") ? 1 : 0);
  const unfinished = settle({ verdict: "running" }, job); // what an unfinished element became
  let verdict = "proved";
  if (falses) verdict = "false";
  else if (open) verdict = unfinished.verdict;
  else if (count("skipped")) verdict = "skipped";
  else if (count("timeout")) verdict = "timeout";
  else if (count("unknown")) verdict = "unknown";
  const cex = members.filter(isCounterexample).length;
  const parts = [cutShort ? `${proved} proved` : `${proved} of ${members.length} proved`];
  if (cex) parts.push(plural(cex, "counterexample", "counterexamples"));
  if (falses - cex) parts.push(`${falses - cex} false`);
  if (open) parts.push(job.status === "running" ? "checking" : unfinished.label);
  return {
    name,
    verdict,
    message: "",
    label: parts.join(" · "),
    values: [],
    children: members.filter((m) => m.verdict !== "proved"),
    falseCount: falses,
    cexCount: cex,
  };
}

/** Declared properties in spec order, each replaced by what Vehicle reported for it. */
function mergeRows(declared, reported, job) {
  const rows = [];
  const used = new Set();
  const settled = reported.map((row) => settle(row, job));
  const last = settled[settled.length - 1];
  for (const name of declared) {
    const matches = settled.filter((p) => p.name === name || baseName(p.name) === name);
    matches.forEach((m) => used.add(m));
    if (matches.length === 1 && matches[0].name === name) rows.push(matches[0]);
    else if (matches.length) rows.push(groupRow(name, matches, job, last));
    else rows.push(settle({ name, verdict: "pending", message: "", values: [] }, job));
  }
  for (const p of settled) if (!used.has(p)) rows.push(p);
  return rows.map((row) => ({
    falseCount: row.verdict === "false" ? 1 : 0,
    cexCount: isCounterexample(row) ? 1 : 0,
    ...row,
  }));
}

function rowLabel(row) {
  return row.label ?? (row.verdict === "pending" ? "pending" : verdictLabel(row));
}

function renderRow(row, strict) {
  const head = el("span", "vw-row-head");
  head.append(
    el("span", `vw-icon is-${row.verdict}`, ICONS[row.verdict] ?? "?"),
    el("span", "vw-row-name", row.name),
    el("span", "vw-row-label", `— ${rowLabel(row)}`),
  );
  if (strict.has(baseName(row.name))) {
    const mark = el("span", "vw-strict-mark", "≤");
    mark.title = "Strict < relaxed to ≤ in this property";
    head.append(mark);
  }
  const children = row.children ?? [];
  if (!row.values?.length && !children.length) {
    const div = el("div", `vw-row is-${row.verdict}`);
    div.append(head);
    return div;
  }
  const details = el("details", `vw-row is-${row.verdict}`);
  details.open = view.expanded.get(row.name) ?? false;
  details.addEventListener("toggle", () => view.expanded.set(row.name, details.open));
  const summary = el("summary");
  summary.append(head);
  details.append(summary);
  if (row.values?.length) {
    const values = el("div", "vw-values");
    for (const value of row.values) {
      const line = el("div", "vw-value", value.name ? `${value.name} = ${value.text}` : value.text);
      if (value.raw !== value.text) line.title = `Vehicle printed: ${value.raw}`;
      values.append(line);
    }
    details.append(values);
  }
  if (children.length) {
    const list = el("div", "vw-rows vw-subrows");
    const shown = children.slice(0, 50);
    for (const child of shown) list.append(renderRow(child, new Set()));
    if (children.length > shown.length) list.append(el("p", "field-hint", `${children.length - shown.length} more in Full output`));
    details.append(list);
  }
  return details;
}

function headline(job, rows, parsed) {
  const count = (v) => rows.filter((r) => r.verdict === v).length;
  const seconds = job.seconds != null ? `${job.seconds} s` : null;
  if (job.status === "running") {
    const checked = rows.filter((r) => !["pending", "running"].includes(r.verdict)).length;
    const text = parsed.verifying ? `Verifying… ${checked} of ${rows.length} checked` : "Compiling the specification…";
    return { state: "busy", text };
  }
  if (job.status === "failed") return { state: "error", text: `Failed: ${job.error}` };
  if (job.status === "cancelled" || job.outcome === "cancelled") return { state: "idle", text: "Cancelled" };
  if (job.outcome === "finished" && job.exitCode !== 0) {
    return { state: "error", text: ["Vehicle error", seconds].filter(Boolean).join(" · ") };
  }
  const proved = count("proved");
  const falses = rows.filter((r) => r.verdict === "false");
  const counterexamples = rows.reduce((n, r) => n + r.cexCount, 0);
  const otherFalse = rows.reduce((n, r) => n + r.falseCount, 0) - counterexamples;
  const unknown = count("unknown");
  if (rows.length === 0) {
    return { state: job.outcome === "timeout" ? "warn" : "idle", text: ["Finished", seconds].filter(Boolean).join(" · ") };
  }
  const parts = [`${proved} of ${rows.length} ${rows.length === 1 ? "property holds" : "properties hold"}`];
  if (counterexamples) parts.push(plural(counterexamples, "counterexample", "counterexamples"));
  if (otherFalse) parts.push(`${otherFalse} false`);
  if (job.outcome === "timeout") parts.push("time limit reached");
  if (unknown) parts.push(`${unknown} unknown`);
  if (seconds) parts.push(seconds);
  const state = falses.length ? "error" : job.outcome === "timeout" || unknown ? "warn" : "ok";
  return { state, text: parts.join(" · ") };
}

function renderHeadline({ state, text }) {
  const line = el("p", `vw-headline is-${state}`);
  line.append(el("span", "status-dot"), el("span", "", text));
  line.setAttribute("role", "status");
  return line;
}

function renderErrorBlock(job, parsed) {
  const text = parsed.error ?? displayText(job.output).trim().split("\n").slice(-20).join("\n");
  const box = el("div", "vw-error");
  box.append(el("pre", "vw-error-text", text || `Vehicle exited with code ${job.exitCode} and no message.`));
  const where = /line (\d+)(?:,\s*column (\d+))?/.exec(text);
  if (where) {
    const go = el("button", "vw-link-button", `Go to line ${where[1]}`);
    go.type = "button";
    go.addEventListener("click", () => current?.focusLine(Number(where[1]), Number(where[2] ?? 1)));
    box.append(go);
  }
  return box;
}

function renderFullOutput(job, fallback) {
  const text = displayText(job.output);
  const details = el("details", "vw-full");
  details.open = fallback || view.fullOutputOpen;
  details.addEventListener("toggle", () => {
    if (!fallback) view.fullOutputOpen = details.open;
  });
  const summary = el("summary", "", fallback ? "Output" : "Full output");
  const actions = el("div", "button-row vw-full-actions");
  const copy = copyButton(() => displayText(runner.job?.output ?? ""));
  copy.classList.add("vw-small");
  const download = button("Download", {
    onClick: () => downloadTextFile(displayText(runner.job?.output ?? ""), "vehicle-output.txt", "text/plain"),
  });
  download.classList.add("vw-small");
  actions.append(copy, download);
  details.append(summary, actions, el("pre", "mono output-box vw-output-text", text || "(no output yet)"));
  return details;
}

function renderResults(found) {
  const job = runner.job;
  const parsed = parseVehicleOutput(job.output);
  const declared = lastRun?.properties ?? found.properties;
  const rows = mergeRows(declared, parsed.properties, job);

  const wrap = el("div", "vw-results");
  const stale = lastRun && !isRunning() && signature(found) !== lastRun.signature;
  if (stale) {
    const bar = el("p", "vw-stale-bar");
    const again = el("button", "vw-link-button", "Verify again");
    again.type = "button";
    again.disabled = !canVerify(found);
    again.addEventListener("click", verify);
    bar.append("Changed since this run · ", again);
    wrap.append(bar);
  }

  const body = el("div", stale ? "vw-results-body is-stale" : "vw-results-body");
  body.append(renderHeadline(headline(job, rows, parsed)));

  const errored = job.status === "done" && job.outcome === "finished" && job.exitCode !== 0;
  if (errored) body.append(renderErrorBlock(job, parsed));

  if (parsed.strict.size) {
    const n = parsed.strict.size;
    const note = el("p", "vw-note");
    note.append(
      el("span", "vw-strict-mark", "≤"),
      ` Strict < relaxed to ≤ in ${plural(n, "property", "properties")}; a counterexample may lie on the boundary `,
      info(
        "Marabou accepts only non-strict inequalities, so Vehicle turned x < y into x ≤ y. The error is at most the solver's floating-point tolerance, but a reported counterexample may sit exactly on a boundary.",
        METHOD,
      ),
    );
    body.append(note);
  }
  for (const warning of parsed.warnings) {
    const note = el("p", "vw-note vw-note-clip", `Warning: ${warning}`);
    note.title = warning;
    body.append(note);
  }

  if (rows.length && !(errored && rows.every((r) => r.verdict === "skipped"))) {
    const list = el("div", "vw-rows");
    for (const row of rows) list.append(renderRow(row, parsed.strict));
    body.append(list);
  }

  const ended = job.status !== "running";
  const fallback = ended && !errored && parsed.properties.length === 0 && !parsed.error;
  body.append(renderFullOutput(job, fallback));
  wrap.append(body);
  return wrap;
}

function renderPending(found) {
  if (!found.properties.length) {
    return emptyState({
      title: "No properties yet",
      text: "Mark a Bool declaration with @property to verify it.",
    });
  }
  const box = el("div", "vw-results");
  const head = el("p", "vw-headline is-idle");
  head.append(
    el("span", "status-dot"),
    el("span", "", `${plural(found.properties.length, "property", "properties")} to verify `),
    info("Each @property is proved, or refuted with a counterexample, unless it runs out of time.", METHOD),
  );
  const list = el("div", "vw-rows");
  for (const name of found.properties) list.append(renderRow({ name, verdict: "pending", values: [] }, new Set()));
  box.append(head, list);
  return box;
}

function renderOutputPane(pane) {
  const found = declarations(form.specification);
  const parts = [];
  if (form.error) parts.push(el("p", "error-text", form.error));
  if (!isConnected()) parts.push(renderSetup());
  if (runner.job) parts.push(renderResults(found));
  else if (isConnected()) parts.push(renderPending(found));
  pane.replaceChildren(...parts);
}

// ---- page -------------------------------------------------------------------------------------

export function renderVehiclePage() {
  if (!form.exampleLoaded && !form.specification) loadExample();

  const page = el("section", "page-flow vw-page");
  const toolbar = buildToolbar();
  const layout = el("div", "vw-layout");

  const editor = el("textarea", "vw-editor");
  editor.value = form.specification;
  editor.spellcheck = false;
  editor.wrap = "off";
  editor.setAttribute("autocapitalize", "off");
  editor.setAttribute("autocomplete", "off");
  editor.setAttribute("aria-label", "Vehicle specification (.vcl)");
  editor.placeholder = "Write a Vehicle specification here, or open the example.";
  let pause = null;
  editor.addEventListener("input", () => {
    form.specification = editor.value;
    clearTimeout(pause);
    pause = setTimeout(() => current?.refresh(), 400);
  });

  const output = el("div", "panel vw-output");
  output.setAttribute("aria-live", "polite");
  output.addEventListener("click", () => fitPopovers(output), true);

  current = {
    page,
    output,
    refresh() {
      toolbar.update();
      renderOutputPane(output);
    },
    refreshOutput() {
      renderOutputPane(output);
      toolbar.update();
    },
    setSpec(text) {
      editor.value = text;
      this.refresh();
    },
    focusLine(line, column) {
      const lines = editor.value.split("\n");
      let start = 0;
      for (let i = 0; i < Math.min(line - 1, lines.length); i++) start += lines[i].length + 1;
      const position = Math.min(start + Math.max(0, column - 1), editor.value.length);
      editor.focus();
      editor.setSelectionRange(start, position === start ? start + (lines[line - 1]?.length ?? 0) : position);
      const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 18;
      editor.scrollTop = Math.max(0, (line - 4) * lineHeight);
    },
  };
  renderOutputPane(output);

  const editorWrap = el("div", "vw-editor-wrap");
  editorWrap.append(editor);
  layout.append(editorWrap, output);
  page.append(toolbar.bar, layout);
  return page;
}
