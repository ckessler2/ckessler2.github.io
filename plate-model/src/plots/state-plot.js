import { renderMath } from "../app/math.js";

function niceIntegerStep(minStep) {
  const safeMinStep = Math.max(1, minStep);
  const exponent = Math.floor(Math.log10(safeMinStep));
  const base = 10 ** exponent;
  const scaled = safeMinStep / base;

  if (scaled <= 1) {
    return base;
  }
  if (scaled <= 2) {
    return 2 * base;
  }
  if (scaled <= 5) {
    return 5 * base;
  }
  return 10 * base;
}

function computeAxisBounds(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return { min: -1, max: 1, step: 1 };
  }

  const min = Math.floor(Math.min(...finiteValues));
  let max = Math.ceil(Math.max(...finiteValues));

  if (max === min) {
    max = min + 1;
  }

  const span = max - min;
  const targetTickCount = 7;
  const minStep = Math.ceil(span / targetTickCount);
  const step = niceIntegerStep(minStep);
  const adjustedMax = min + Math.ceil(span / step) * step;

  return {
    min,
    max: adjustedMax,
    step,
  };
}

function getPlotTheme() {
  const styles = getComputedStyle(document.body);
  return {
    plotBg: styles.getPropertyValue("--plot-bg").trim(),
    text: styles.getPropertyValue("--plot-text").trim(),
    axis: styles.getPropertyValue("--plot-axis").trim(),
    vx: styles.getPropertyValue("--plot-state-1").trim(),
    vy: styles.getPropertyValue("--plot-state-2").trim(),
    omega: styles.getPropertyValue("--plot-state-3").trim(),
    theta: styles.getPropertyValue("--plot-state-4").trim(),
    fontFamily: styles.fontFamily,
    fontSize: parseFloat(styles.fontSize) || 14,
  };
}

function getPlotSize(target) {
  const containerWidth = target.clientWidth || target.parentElement?.clientWidth || 0;
  const width = Math.max(Math.floor(containerWidth) - 8, 220);
  const height = Math.max(250, Math.min(360, Math.round(width * 0.4)));
  return { width, height };
}

function buildTicks(bounds) {
  const { min, max } = bounds;
  let step = Math.max(1, bounds.step);
  const maxTickTarget = 9;

  function generateTicks(currentStep) {
    const tickSet = new Set([min, max]);

    const start = Math.ceil(min / currentStep) * currentStep;
    const count = Math.max(0, Math.floor((max - start) / currentStep) + 1);
    const cappedCount = Math.min(count, maxTickTarget + 2);

    for (let index = 0; index < cappedCount; index += 1) {
      tickSet.add(start + index * currentStep);
    }

    if (min <= 0 && 0 <= max) {
      tickSet.add(0);
    }

    return Array.from(tickSet).sort((a, b) => a - b);
  }

  let ticks = generateTicks(step);
  while (ticks.length > maxTickTarget) {
    step *= 2;
    ticks = generateTicks(step);
  }

  return ticks;
}

function drawAxisLimitBox(u, color) {
  const { left, top, width, height } = u.bbox;
  u.ctx.save();
  u.ctx.strokeStyle = color;
  u.ctx.lineWidth = 1;
  u.ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
  u.ctx.restore();
}

function createLegendItem({ color, tex }) {
  const item = document.createElement("div");
  item.className = "plot-math-legend-item";

  const swatch = document.createElement("span");
  swatch.className = "plot-math-swatch";
  swatch.style.background = color;

  const label = document.createElement("span");
  label.className = "plot-math-label math-label";
  renderMath(tex, label);

  item.append(swatch, label);
  return item;
}

export function renderStatePlot(target, result) {
  const uPlotLib = window.uPlot;
  if (!uPlotLib) {
    target.textContent = "uPlot not loaded.";
    return;
  }

  target._uplot?.destroy();
  target.replaceChildren();

  const { width, height } = getPlotSize(target);
  const xAxis = computeAxisBounds(result.t);
  const combinedValues = [
    ...result.states.v_xp,
    ...result.states.v_yp,
    ...result.states.omega,
    ...result.states.theta,
  ];
  const yAxis = computeAxisBounds(combinedValues);
  const xTicks = buildTicks(xAxis);
  const yTicks = buildTicks(yAxis);
  const theme = getPlotTheme();
  const axisColor = "#000";

  const wrapper = document.createElement("div");
  wrapper.className = "plot-math-wrap";

  const yLabel = document.createElement("div");
  yLabel.className = "plot-math-y-axis math-label";
  renderMath("v_{x'},\\,v_{y'},\\,\\omega,\\,\\theta", yLabel, { inline: false });

  const plotHost = document.createElement("div");
  plotHost.className = "plot-uplot-host";
  plotHost.style.marginLeft = "-10px";

  const xLabel = document.createElement("div");
  xLabel.className = "plot-math-x-axis math-label";
  renderMath("t", xLabel, { inline: false });

  const legend = document.createElement("div");
  legend.className = "plot-math-legend";
  legend.append(
    createLegendItem({ color: theme.vx, tex: "v_{x'}" }),
    createLegendItem({ color: theme.vy, tex: "v_{y'}" }),
    createLegendItem({ color: theme.omega, tex: "\\omega" }),
    createLegendItem({ color: theme.theta, tex: "\\theta" }),
  );

  wrapper.append(yLabel, plotHost, xLabel, legend);
  target.append(wrapper);

  const opts = {
    width,
    height,
    legend: { show: false },
    scales: {
      x: { min: xAxis.min, max: xAxis.max },
      y: { min: yAxis.min, max: yAxis.max },
    },
    axes: [
      {
        side: 2,
        stroke: axisColor,
        grid: { show: false },
        ticks: { stroke: axisColor },
        values: (_plot, splits) => splits.map((value) => `${value}`),
        splits: () => xTicks,
      },
      {
        side: 3,
        stroke: axisColor,
        grid: { show: false },
        ticks: { stroke: axisColor },
        values: (_plot, splits) => splits.map((value) => `${value}`),
        splits: () => yTicks,
      },
      {
        side: 0,
        stroke: axisColor,
        grid: { show: false },
        ticks: { show: false },
        values: () => [],
        size: 14,
      },
      {
        side: 1,
        stroke: axisColor,
        grid: { show: false },
        ticks: { show: false },
        values: () => [],
        size: 14,
      },
    ],
    series: [
      { label: "t", stroke: theme.axis },
      { label: "vx", stroke: theme.vx, width: 2 },
      { label: "vy", stroke: theme.vy, width: 2 },
      { label: "omega", stroke: theme.omega, width: 2 },
      { label: "theta", stroke: theme.theta, width: 2 },
    ],
    hooks: {
      draw: [
        (u) => {
          drawAxisLimitBox(u, axisColor);
        },
      ],
    },
  };

  plotHost.style.background = theme.plotBg;
  plotHost.style.fontFamily = theme.fontFamily;
  plotHost.style.fontSize = `${theme.fontSize}px`;
  plotHost.style.color = theme.text;

  const data = [
    result.t,
    result.states.v_xp,
    result.states.v_yp,
    result.states.omega,
    result.states.theta,
  ];

  target._uplot = new uPlotLib(opts, data, plotHost);

  if (!target._statePlotResizeObserver) {
    target._statePlotResizeObserver = new ResizeObserver(() => {
      if (!target._uplot) {
        return;
      }

      const { width: nextWidth, height: nextHeight } = getPlotSize(target);
      target._uplot.setSize({ width: nextWidth, height: nextHeight });
    });
    target._statePlotResizeObserver.observe(target);
  }
}
