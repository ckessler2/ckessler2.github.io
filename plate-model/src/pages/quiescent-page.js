import { createAccordion } from "../components/accordion.js";
import { createField } from "../components/field.js";
import { createPlotSection } from "../components/plot-section.js";
import { createStatsPanel } from "../components/stats-panel.js";
import { readConfigFromForm } from "../simulation/config.js";
import { exportQuiescentResultCsv } from "../export/export-quiescent-csv.js";
import { exportQuiescentTrajectorySvg } from "../export/export-xy-svg.js";
import {
  adaptiveSolverFields,
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
import { createPlateAnimation } from "../plots/plate-animation.js";

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
    relTol: config.solver.relTol,
    absTol: config.solver.absTol,
    maxStep: config.solver.maxStep,
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
    ", these equations predict 2D quasi-steady aerodynamic forces on free-falling thin plates with differing centre of mass (CoM) locations, and can predict fluttering, tumbling, bounding, gliding and diving. This client-side JavaScript app solves the equations in nondimensional form.",
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

function formatRuntimeMs(runtimeMs) {
  if (!Number.isFinite(runtimeMs) || runtimeMs <= 0) {
    return "0";
  }

  return Number(runtimeMs).toPrecision(3);
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

  function applyFormValues(nextValues) {
    for (const [name, input] of Object.entries(inputMap)) {
      if (!(name in nextValues)) {
        continue;
      }

      const nextValue = nextValues[name];
      if (input.type === "checkbox") {
        input.checked = Boolean(nextValue);
      } else {
        input.value = String(nextValue);
      }
    }
  }

  function scheduleAutoRun() {
    if (!autoRunToggle.checked) {
      return;
    }
    window.clearTimeout(autoRunTimer);
    autoRunTimer = window.setTimeout(execute, 120);
  }

  const inputsContent = document.createElement("div");
  inputsContent.className = "page-flow";

  const validationCasesContent = document.createElement("div");
  validationCasesContent.className = "toolbar-main";

  const alsomitraDefaultButton = document.createElement("button");
  alsomitraDefaultButton.className = "header-action-button";
  alsomitraDefaultButton.type = "button";
  alsomitraDefaultButton.textContent = "Alsomitra (default)";
  alsomitraDefaultButton.addEventListener("click", () => {
    const defaultValues = flattenConfig(createDefaultConfig());
    applyFormValues(defaultValues);
    syncAdaptiveFields();
    execute();
  });

  validationCasesContent.append(alsomitraDefaultButton);

  inputsContent.append(
    createSectionBlock("Validation cases", validationCasesContent),
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
  solverGrid.append(solverMethodField.wrapper);

  // Tolerances only apply to the adaptive solver, so hide them for fixed-step RK4.
  const adaptiveGrid = createFieldGrid(adaptiveSolverFields, values, inputMap, renderMath, {
    onInput: scheduleAutoRun,
  });

  function syncAdaptiveFields() {
    adaptiveGrid.hidden = solverMethodField.input.value !== "rk45";
  }

  syncAdaptiveFields();
  solverMethodField.input.addEventListener("change", () => {
    syncAdaptiveFields();
    scheduleAutoRun();
  });

  const solverContent = document.createElement("div");
  solverContent.className = "page-flow";
  solverContent.append(solverGrid, adaptiveGrid);

  inputsContent.append(
    createSectionBlock("Solver settings", solverContent),
  );

  const exportContent = document.createElement("div");
  exportContent.className = "page-flow";

  const csvFilenameField = createField({
    name: "csvFilename",
    label: "CSV filename",
    value: "plate-model-quiescent.csv",
    type: "text",
  });
  csvFilenameField.wrapper.classList.add("export-filename-field");

  const exportCsvButton = document.createElement("button");
  exportCsvButton.className = "header-action-button";
  exportCsvButton.type = "button";
  exportCsvButton.textContent = "Export .csv";
  exportCsvButton.addEventListener("click", () => {
    const latestState = state.getState();
    exportQuiescentResultCsv(latestState.quiescentResult, csvFilenameField.input.value);
  });

  const svgFilenameField = createField({
    name: "svgFilename",
    label: "SVG filename",
    value: "plate-model-trajectory-xy.svg",
    type: "text",
  });
  svgFilenameField.wrapper.classList.add("export-filename-field");

  const exportSvgButton = document.createElement("button");
  exportSvgButton.className = "header-action-button";
  exportSvgButton.type = "button";
  exportSvgButton.textContent = "Export XY svg";
  exportSvgButton.addEventListener("click", () => {
    const latestState = state.getState();
    exportQuiescentTrajectorySvg(latestState.quiescentResult, svgFilenameField.input.value);
  });

  exportContent.append(
    csvFilenameField.wrapper,
    exportCsvButton,
    svgFilenameField.wrapper,
    exportSvgButton,
  );

  accordionGroup.append(
    buildAccordion(state, "quiescent-inputs", "Simulator setup", inputsContent, false),
    buildAccordion(state, "quiescent-exports", "Export results", exportContent, false),
    buildAccordion(
      state,
      "quiescent-what-is-this",
      "What is this?",
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
      renderTrajectoryPlot(trajectorySection.plot, latestState.quiescentResult);
      renderStatePlot(stateSection.plot, latestState.quiescentResult);
    }
  }

  const plateAnimation = createPlateAnimation();

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
      "quiescent-animation",
      "3D animation (work in progress)",
      plateAnimation.panel,
      true,
      { onToggle: (isOpen) => plateAnimation.setOpen(isOpen) },
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
    buildAccordion(
      state,
      "quiescent-trajectory",
      "Trajectory plot",
      trajectorySection.panel,
      false,
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

  // Start the animation straight away if its accordion begins open.
  plateAnimation.setOpen(getAccordionOpen(state, "quiescent-animation", true));

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

  function updatePlots(result) {
    renderTrajectoryPlot(trajectorySection.plot, result);
    renderStatePlot(stateSection.plot, result);
    plateAnimation.setResult(result, { e_x: state.getState().config.aero.e_x });

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
      updatePlots(result);
      status.textContent = `${result.metadata.stepCount.toLocaleString()} steps in ${formatRuntimeMs(result.metadata.runtimeMs)} ms`;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("runtime limit") || error.message.includes("diverged"))
      ) {
        autoRunToggle.checked = false;
      }
      status.textContent =
        error instanceof Error ? error.message : "Unknown simulation error.";
    }
  }

  button.addEventListener("click", execute);

  const existingResult = state.getState().quiescentResult;
  if (existingResult) {
    updatePlots(existingResult);
    status.textContent = `${existingResult.metadata.stepCount.toLocaleString()} steps in ${formatRuntimeMs(existingResult.metadata.runtimeMs)} ms`;
  } else {
    execute();
  }

  return page;
}
