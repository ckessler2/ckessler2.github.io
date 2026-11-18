import { createAccordion } from "../components/accordion.js";
import { createField } from "../components/field.js";
import { createFileInput, readFileBytes } from "../components/file-input.js";
import { link } from "../components/prose.js";
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

// VehicleWrapper Run tab: write a Vehicle specification, give it its networks, datasets and
// parameters, and verify it with Marabou on the local runner. Vehicle's output is shown as text.

const form = {
  specification: "",
  networks: {}, // name -> { fileName, bytes }
  datasets: {}, // name -> { fileName, bytes, extension }
  parameters: {}, // name -> text
  timeout: 600,
  exampleLoaded: false,
  error: null,
};

let current = null; // { ctx, page, output } of the latest render
subscribe(() => {
  if (current && document.body.contains(current.page)) current.ctx.rerender();
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function accordion(state, key, title, content, defaultOpen = true) {
  const open = state.getState().accordionState[key] ?? defaultOpen;
  return createAccordion({ title, content, open, onToggle: (isOpen) => state.setAccordionOpen(key, isOpen) });
}

/** Networks, datasets and parameters declared in a specification (comments ignored). */
export function declarations(specification) {
  const text = specification.replace(/\{-[\s\S]*?-\}/g, " ").replace(/--.*$/gm, "");
  const found = { networks: [], datasets: [], parameters: [] };
  const pattern = /@(network|dataset|parameter)\s*(\([^)]*\))?\s+([A-Za-z_][A-Za-z0-9_']*)\s*:/g;
  for (const [, kind, options, name] of text.matchAll(pattern)) {
    if (kind === "parameter" && options && /infer\s*=\s*True/.test(options)) continue; // inferred from data
    const list = found[`${kind}s`];
    if (!list.includes(name)) list.push(name);
  }
  return found;
}

async function loadExample(ctx) {
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
  ctx.rerender();
}

// ---- left column ----------------------------------------------------------------------------

function renderRunnerSection() {
  const body = el("div", "control-stack");
  const status = {
    idle: "Not connected.",
    connecting: "Waiting for the runner…",
    connected: "Connected.",
    lost: "Disconnected.",
    "wrong-token": "The runner refused this page's token.",
    refused: "The runner refused the connection.",
  }[runner.connection];
  body.append(el("p", "", status));

  if (runner.connection === "connected") {
    const v = runner.info.versions;
    body.append(
      el("p", "section-note", `Vehicle ${v.vehicle}, Marabou ${v.maraboupy}, image ${v.image}.`),
      el("p", "section-note", "The runner stops by itself when you close this page."),
    );
    return body;
  }

  if (runner.error && runner.connection !== "wrong-token") body.append(el("p", "error-text", runner.error));
  if (runner.connection === "wrong-token") {
    body.append(el("p", "", "Each browser tab has its own token, so it was probably started from another tab or with an older command. Stop it (Ctrl+C in its terminal) and start it again with the command below."));
  }
  if (runner.connection === "refused") {
    body.append(el("p", "", "It may be an old runner or another program on port 8765. Stop it and start the runner with the command below."));
  }

  const steps = el("ol", "bullet-list");
  const docker = el("li");
  docker.append("Install and start ", link("https://docs.docker.com/get-started/get-docker/", "Docker"), ".");
  const command = el("li");
  const commandText = el("pre", "mono command-box", startCommand());
  const copy = el("button", "secondary-button", "Copy command");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(startCommand());
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Select the text to copy it";
    }
  });
  command.append("Run this in a terminal. The first start downloads about 700 MB.", commandText, copy);
  const press = el("li", "", "Press Connect. Your browser may ask whether this site may connect to your device: allow it.");
  steps.append(docker, command, press);
  body.append(steps);

  const buttons = el("div", "button-row");
  if (runner.connection === "connecting") {
    const stop = el("button", "secondary-button", "Stop waiting");
    stop.type = "button";
    stop.addEventListener("click", stopConnecting);
    buttons.append(stop);
  } else {
    const go = el("button", "run-button", "Connect");
    go.type = "button";
    go.addEventListener("click", connect);
    buttons.append(go);
  }
  body.append(
    buttons,
    el("p", "section-note", `Everything stays on your machine: the page talks only to ${RUNNER_URL}, and only after you press Connect.`),
  );
  return body;
}

function renderSpecificationSection(ctx) {
  const body = el("div", "control-stack");
  const area = el("textarea", "spec-editor");
  area.value = form.specification;
  area.rows = 18;
  area.spellcheck = false;
  area.setAttribute("aria-label", "Vehicle specification (.vcl)");
  area.placeholder = "Write a Vehicle specification here, or load the example.";
  let pause = null;
  area.addEventListener("input", () => {
    form.specification = area.value;
    // Update the inputs it declares and the run bar in place, without redrawing the editor.
    clearTimeout(pause);
    pause = setTimeout(() => current?.refresh(), 400);
  });

  const buttons = el("div", "button-row");
  const example = el("button", "secondary-button", "Load example");
  example.type = "button";
  example.addEventListener("click", () => loadExample(ctx));
  buttons.append(
    example,
    createFileInput({
      accept: ".vcl",
      label: "Or open a .vcl file",
      onFile: async (file) => {
        form.specification = await file.text();
        ctx.rerender();
      },
    }),
  );
  body.append(area, buttons);
  body.append(
    el("p", "section-note", ""),
  );
  body.lastChild.append(
    "Syntax: see the ",
    link("https://vehicle-lang.readthedocs.io/", "Vehicle documentation"),
    ". Networks, datasets and parameters it declares appear under Inputs.",
  );
  if (form.error) body.append(el("p", "error-text", form.error));
  return body;
}

function renderInputsSection(ctx, found) {
  const body = el("div", "control-stack");
  if (!found.networks.length && !found.datasets.length && !found.parameters.length) {
    body.append(el("p", "section-note", "The specification declares no networks, datasets or parameters yet."));
  }
  for (const name of found.networks) {
    const chosen = form.networks[name];
    body.append(
      createFileInput({
        accept: ".onnx",
        label: `Network ${name} (.onnx)`,
        onFile: async (file) => {
          form.networks[name] = { fileName: file.name, bytes: await readFileBytes(file) };
          ctx.rerender();
        },
      }),
      el("p", "section-note", chosen ? `Loaded: ${chosen.fileName}` : "Not loaded."),
    );
  }
  for (const name of found.datasets) {
    const chosen = form.datasets[name];
    body.append(
      createFileInput({
        accept: ".idx,.npy,.csv,.json",
        label: `Dataset ${name}`,
        onFile: async (file) => {
          const extension = (file.name.split(".").pop() ?? "").toLowerCase();
          form.datasets[name] = { fileName: file.name, bytes: await readFileBytes(file), extension };
          ctx.rerender();
        },
      }),
      el("p", "section-note", chosen ? `Loaded: ${chosen.fileName}` : "Not loaded."),
    );
  }
  for (const name of found.parameters) {
    const { wrapper, input } = createField({ name: `param-${name}`, label: `Parameter ${name}`, value: form.parameters[name] ?? "", type: "text" });
    input.placeholder = "a number, True or False";
    input.addEventListener("input", () => {
      form.parameters[name] = input.value.trim();
    });
    body.append(wrapper);
  }
  return body;
}

function renderOptionsSection() {
  const body = el("div", "control-stack");
  const max = runner.info?.maxTimeout ?? 3600;
  const { wrapper, input } = createField({ name: "vehicle-timeout", label: "Time limit (seconds)", value: form.timeout });
  input.min = "1";
  input.max = String(max);
  input.addEventListener("change", () => {
    form.timeout = Math.max(1, Math.min(max, Math.trunc(Number(input.value) || 600)));
    input.value = String(form.timeout);
  });
  body.append(
    wrapper,
    el("p", "section-note", `For the whole run, up to ${max} s. The solver is Marabou; more will follow.`),
  );
  return body;
}

// ---- right column ---------------------------------------------------------------------------

function missingInputs(found) {
  const missing = [];
  if (!form.specification.trim()) missing.push("a specification");
  for (const name of found.networks) if (!form.networks[name]) missing.push(`network ${name}`);
  for (const name of found.datasets) if (!form.datasets[name]) missing.push(`dataset ${name}`);
  for (const name of found.parameters) if (!form.parameters[name]) missing.push(`parameter ${name}`);
  return missing;
}

function renderToolbar(ctx, found) {
  const panel = el("div", "panel");
  const row = el("div", "toolbar");
  const main = el("div", "toolbar-main");
  const running = runner.job?.status === "running";
  const missing = missingInputs(found);
  const connected = runner.connection === "connected";

  const run = el("button", "run-button", running ? "Running…" : "Verify");
  run.type = "button";
  run.disabled = running || !connected || missing.length > 0;
  run.addEventListener("click", () => {
    found = declarations(form.specification);
    const pick = (all, names) => Object.fromEntries(names.map((n) => [n, all[n]]));
    runJob(
      {
        specification: form.specification,
        networks: pick(form.networks, found.networks),
        datasets: pick(form.datasets, found.datasets),
        parameters: pick(form.parameters, found.parameters),
        timeout: form.timeout,
      },
      () => current?.output && (current.output.textContent = displayText(runner.job.output)),
    );
  });
  main.append(run);
  if (running) {
    const cancel = el("button", "secondary-button", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", cancelJob);
    main.append(cancel);
  }

  let status;
  if (!connected) status = "Connect to the runner first (Runner, on the left).";
  else if (missing.length) status = `Still needed: ${missing.join(", ")}.`;
  else if (running) status = "Vehicle is compiling the specification and Marabou is checking it…";
  else status = "Ready.";
  const statusBox = el("div", "toolbar-status");
  statusBox.append(el("p", "status", status));
  row.append(main, statusBox);
  panel.append(row);
  return panel;
}

/** Vehicle redraws progress bars with carriage returns; keep only what was drawn last. */
function displayText(output) {
  return output
    .trimStart()
    .split("\n")
    .map((line) => line.split("\r").pop())
    .join("\n");
}

function renderOutput(ctx) {
  const job = runner.job;
  const panel = el("div", "control-stack");
  const outcome = {
    running: "Running.",
    cancelled: "Cancelled. The runner stops the verification within a few seconds.",
    failed: `Failed: ${job.error}`,
  }[job.status];
  if (job.status === "done") {
    const text =
      job.outcome === "timeout"
        ? `Stopped at the time limit after ${job.seconds} s.`
        : job.outcome === "cancelled"
          ? "Cancelled because the page was closing."
          : job.exitCode === 0
            ? `Finished in ${job.seconds} s.`
            : `Vehicle stopped with an error (exit code ${job.exitCode}) after ${job.seconds} s. Its message is below.`;
    panel.append(el("p", job.outcome === "finished" && job.exitCode === 0 ? "" : "error-text", text));
  } else {
    panel.append(el("p", job.status === "failed" ? "error-text" : "", outcome));
  }
  if (job.status === "done" && /strict inequalit/i.test(job.output)) {
    panel.append(
      el(
        "p",
        "warning-box",
        "Marabou cannot express strict inequalities (x < y), so Vehicle relaxed them to x ≤ y. A counterexample may then lie exactly on a boundary of the property.",
      ),
    );
  }
  const output = el("pre", "mono output-box", displayText(job.output) || "(no output yet)");
  current.output = output;
  panel.append(output);
  const group = el("div", "accordion-group");
  group.append(accordion(ctx.state, "vehicle-output", "Vehicle output", panel));
  return group;
}

function renderIntro() {
  const panel = el("div", "panel");
  panel.append(
    el(
      "p",
      "",
      "Complete verification with Vehicle and Marabou, running in a container on your own machine. Write a Vehicle specification, give it its networks, and press Verify: each property is proved, or refuted with a counterexample, unless it runs out of time.",
    ),
    el("p", "section-note", ""),
  );
  panel.lastChild.append(
    "Start with the example: connect the runner, press Load example, then Verify. How it works and how it is secured is on the ",
    link("#/vehicle-method", "Method"),
    " tab.",
  );
  return panel;
}

export function renderVehiclePage(ctx) {
  if (!form.exampleLoaded && !form.specification) loadExample(ctx);
  const found = declarations(form.specification);

  const page = el("section", "page-flow");
  current = { ctx, page, output: null };
  const layout = el("div", "sim-layout");

  const inputs = el("div");
  const toolbar = el("div");
  inputs.append(renderInputsSection(ctx, found));
  toolbar.append(renderToolbar(ctx, found));
  let shown = JSON.stringify(found);
  current.refresh = () => {
    const now = declarations(form.specification);
    if (JSON.stringify(now) !== shown) {
      shown = JSON.stringify(now);
      inputs.replaceChildren(renderInputsSection(ctx, now));
    }
    toolbar.replaceChildren(renderToolbar(ctx, now));
  };

  const controls = el("div", "control-stack");
  const group = el("div", "accordion-group");
  group.append(
    accordion(ctx.state, "vehicle-runner", "Runner", renderRunnerSection(), true),
    accordion(ctx.state, "vehicle-spec", "Specification", renderSpecificationSection(ctx)),
    accordion(ctx.state, "vehicle-inputs", "Inputs", inputs),
    accordion(ctx.state, "vehicle-options", "Options", renderOptionsSection(), false),
  );
  controls.append(group);

  const results = el("div", "results-stack");
  results.append(toolbar, runner.job ? renderOutput(ctx) : renderIntro());

  layout.append(controls, results);
  page.append(layout);
  return page;
}
