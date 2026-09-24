import { createAccordion } from "../components/accordion.js";
import { createField } from "../components/field.js";
import { createPlotSection } from "../components/plot-section.js";
import { createStatsPanel } from "../components/stats-panel.js";
import { readConfigFromForm } from "../simulation/config.js";
import {
  aeroCoefficientFields,
  createDefaultConfig,
  initialConditionFields,
  modelFields,
  solverFields,
  solverOptions,
} from "../simulation/defaults.js";
import { runQuiescentSimulation } from "../simulation/run-quiescent.js";
import { renderTrajectoryPlot } from "../plots/trajectory-plot.js";
import { renderStatePlot } from "../plots/state-plot.js";

function flattenConfig(config) {
  const coeffs = Object.fromEntries(
    config.aero.coefficients.map((value, index) => [`c${index + 1}`, value]),
  );

  return {
    ...config.model,
    ...config.initialConditions,
    ...coeffs,
    e_x: config.aero.e_x,
    dt: config.solver.dt,
    t_end: config.solver.t_end,
    solverMethod: config.solver.method,
    showStartMarker: config.visualization.showStartMarker,
    showEndMarker: config.visualization.showEndMarker,
  };
}

function createFieldGrid(fields, values, inputMap, renderMath, options = {}) {
  const grid = document.createElement("div");
  grid.className = "field-grid";

  for (const field of fields) {
    const { wrapper, input } = createField({
      name: field.name,
      label: field.label,
      labelTex: field.labelTex,
      value: values[field.name],
      type: field.type ?? "number",
      wide: field.wide ?? false,
      options: field.options ?? [],
      renderMath,
    });
    inputMap[field.name] = input;
    if (options.onInput) {
      input.addEventListener("input", options.onInput);
      input.addEventListener("change", options.onInput);
    }
    grid.append(wrapper);
  }

  return grid;
}

function createSectionBlock(titleText, contentNode, note = "", className = "") {
  const block = document.createElement("div");
  block.className = "section-block";
  if (className) {
    block.classList.add(className);
  }

  const heading = document.createElement("h3");
  heading.className = "section-heading";
  heading.textContent = titleText;

  block.append(heading);
  if (note) {
    const noteNode = document.createElement("p");
    noteNode.className = "section-note";
    noteNode.textContent = note;
    block.append(noteNode);
  }
  block.append(contentNode);

  return block;
}

function buildModelInfoSection() {
  const wrapper = document.createElement("div");

  const summary = document.createElement("p");
  summary.textContent = "See ";

  const summaryLink = document.createElement("a");
  summaryLink.href = "https://www.siam.org/publications/siam-news/articles/the-unconventional-aerodynamics-of-paper-airplanes/";
  summaryLink.textContent = "Li and Ristroph, 2022";
  summaryLink.target = "_blank";
  summaryLink.rel = "noreferrer";
  summaryLink.className = "inline-link";

  summary.append(summaryLink, " for a lay summary of this topic.");

  const intro = document.createElement("p");
  intro.textContent = "Introduced by ";

  const sourceLink = document.createElement("a");
  sourceLink.href = "https://doi.org/10.1017/jfm.2022.89";
  sourceLink.textContent = "Li et al, 2022";
  sourceLink.target = "_blank";
  sourceLink.rel = "noreferrer";
  sourceLink.className = "inline-link";

  intro.append(
    sourceLink,
    ", this is a 2D quasi-steady aerodynamic model of thin plates with differing centre of mass (CoM) locations, capable of predicting fluttering, tumbling, bounding, gliding and diving.",
  );

  wrapper.append(summary, intro);
  return wrapper;
}

function getAccordionOpen(state, key, fallback) {
  const accordionState = state.getState().accordionState ?? {};
  return accordionState[key] ?? fallback;
}

function buildAccordion(state, key, title, content, fallbackOpen, options = {}) {
  return createAccordion({
    title,
    titleNode: options.titleNode ?? null,
    content,
    open: getAccordionOpen(state, key, fallbackOpen),
    onToggle: (isOpen) => {
      state.setAccordionOpen(key, isOpen);
      options.onToggle?.(isOpen);
    },
  });
}

export function renderQuiescentPage({ state, renderMath }) {
  const config = state.getState().config ?? createDefaultConfig();
  const values = flattenConfig(config);
  const page = document.createElement("section");
  page.className = "page-flow";

  const layout = document.createElement("div");
  layout.className = "sim-layout";

  const controls = document.createElement("div");
  controls.className = "control-stack";

  const accordionGroup = document.createElement("div");
  accordionGroup.className = "accordion-group";

  const results = document.createElement("div");
  results.className = "results-stack";

  const resultsAccordionGroup = document.createElement("div");
  resultsAccordionGroup.className = "accordion-group";

  const toolbar = document.createElement("section");
  toolbar.className = "panel";

  const toolbarRow = document.createElement("div");
  toolbarRow.className = "toolbar";

  const toolbarMain = document.createElement("div");
  toolbarMain.className = "toolbar-main";

  const button = document.createElement("button");
  button.className = "run-button";
  button.type = "button";
  button.textContent = "Run simulation";

  const autoRunLabel = document.createElement("label");
  autoRunLabel.className = "checkbox checkbox-reversed";
  const autoRunText = document.createElement("span");
  autoRunText.textContent = "Auto-run";
  const autoRunToggle = document.createElement("input");
  autoRunToggle.type = "checkbox";
  autoRunToggle.checked = true;
  autoRunLabel.append(autoRunText, autoRunToggle);

  const status = document.createElement("p");
  status.className = "status";
  status.textContent = "No run yet.";

  toolbarMain.append(button, autoRunLabel, status);
  toolbarRow.append(toolbarMain);
  toolbar.append(toolbarRow);

  const inputMap = {};
  let autoRunTimer = null;

  function scheduleAutoRun() {
    if (!autoRunToggle.checked) {
      return;
    }
    window.clearTimeout(autoRunTimer);
    autoRunTimer = window.setTimeout(execute, 120);
  }

  const inputsContent = document.createElement("div");
  inputsContent.className = "page-flow";
  inputsContent.append(
    createSectionBlock(
      "Nondimensional parameters",
      createFieldGrid(modelFields, values, inputMap, renderMath, { onInput: scheduleAutoRun }),
      "",
      "section-block-wide-inputs",
    ),
    createSectionBlock(
      "Aerodynamic coefficients",
      createFieldGrid(aeroCoefficientFields, values, inputMap, renderMath, {
        onInput: scheduleAutoRun,
      }),
    ),
    createSectionBlock(
      "Initial values",
      createFieldGrid(initialConditionFields, values, inputMap, renderMath, {
        onInput: scheduleAutoRun,
      }),
      "",
      "section-block-wide-inputs",
    ),
  );

  const solverContent = document.createElement("div");
  solverContent.className = "page-flow";

  const solverGrid = createFieldGrid(solverFields, values, inputMap, renderMath, {
    onInput: scheduleAutoRun,
  });
  const solverMethodField = createField({
    name: "solverMethod",
    label: "Solver",
    value: values.solverMethod,
    type: "select",
    options: solverOptions,
    renderMath,
  });
  inputMap.solverMethod = solverMethodField.input;
  solverMethodField.input.addEventListener("change", scheduleAutoRun);
  solverGrid.append(solverMethodField.wrapper);
  solverContent.append(solverGrid);

  const visualizationContent = document.createElement("div");
  visualizationContent.className = "checkbox-row";
  for (const [name, label] of [
    ["showStartMarker", "Show start marker"],
    ["showEndMarker", "Show end marker"],
  ]) {
    const row = document.createElement("label");
    row.className = "checkbox";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = values[name];
    box.addEventListener("change", scheduleAutoRun);
    inputMap[name] = box;
    const text = document.createElement("span");
    text.textContent = label;
    row.append(box, text);
    visualizationContent.append(row);
  }

  accordionGroup.append(
    buildAccordion(state, "quiescent-inputs", "Simulator setup", inputsContent, false),
    buildAccordion(state, "quiescent-solver", "Simulator settings", solverContent, false),
    buildAccordion(
      state,
      "quiescent-visualisation",
      "Plotting settings",
      visualizationContent,
      false,
    ),
    buildAccordion(
      state,
      "quiescent-what-is-this",
      "What is this model?",
      buildModelInfoSection(),
      false,
    ),
  );

  controls.append(toolbar, accordionGroup);

  const trajectorySection = createPlotSection();
  const stateSection = createPlotSection();

  function refreshPlots() {
    const latestState = state.getState();
    if (latestState.quiescentResult) {
      renderTrajectoryPlot(trajectorySection.plot, latestState.quiescentResult, latestState.config.visualization);
      renderStatePlot(stateSection.plot, latestState.quiescentResult);
    }
  }

  let debugAccordion = buildAccordion(
    state,
    "quiescent-debugging",
    "Debugging",
    "Run the simulation to populate final-state and performance metadata.",
    false,
  );

  resultsAccordionGroup.append(
    buildAccordion(
      state,
      "quiescent-trajectory",
      "Trajectory plot",
      trajectorySection.panel,
      true,
      {
        onToggle: (isOpen) => {
          if (isOpen) {
            window.requestAnimationFrame(refreshPlots);
          }
        },
      },
    ),
    buildAccordion(
      state,
      "quiescent-states",
      "Timewise plot",
      stateSection.panel,
      true,
      {
        onToggle: (isOpen) => {
          if (isOpen) {
            window.requestAnimationFrame(refreshPlots);
          }
        },
      },
    ),
    debugAccordion,
  );

  results.append(resultsAccordionGroup);
  layout.append(controls, results);
  page.append(layout);

  function collectFormState() {
    const formState = {};
    for (const [name, input] of Object.entries(inputMap)) {
      formState[name] = input.type === "checkbox" ? input.checked : input.value;
    }
    return formState;
  }

  function updatePlots(result, activeConfig) {
    renderTrajectoryPlot(trajectorySection.plot, result, activeConfig.visualization);
    renderStatePlot(stateSection.plot, result);

    const nextDebugAccordion = buildAccordion(
      state,
      "quiescent-debugging",
      "Debugging",
      createStatsPanel(result),
      false,
    );
    debugAccordion.replaceWith(nextDebugAccordion);
    debugAccordion = nextDebugAccordion;
  }

  function execute() {
    try {
      const nextConfig = readConfigFromForm(collectFormState());
      const result = runQuiescentSimulation(nextConfig);
      state.setConfig(nextConfig);
      state.setQuiescentResult(result);
      updatePlots(result, nextConfig);
      status.textContent = `${result.metadata.stepCount.toLocaleString()} steps in ${result.metadata.runtimeMs.toFixed(2)} ms`;
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Unknown simulation error.";
    }
  }

  button.addEventListener("click", execute);

  const existingResult = state.getState().quiescentResult;
  if (existingResult) {
    updatePlots(existingResult, config);
    status.textContent = `${existingResult.metadata.stepCount.toLocaleString()} steps in ${existingResult.metadata.runtimeMs.toFixed(2)} ms`;
  } else {
    execute();
  }

  return page;
}
