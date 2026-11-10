import { renderMath } from "../app/math.js";
import { buildTicks, drawAxisLimitBox, finiteExtent, getPlotTheme } from "./plot-utils.js";

function computeAxisBoundsStep5(values) {
  const extent = finiteExtent(values);
  if (!extent) {
    return { min: -5, max: 5, step: 5 };
  }

  const { min: rawMin, max: rawMax } = extent;
  let min = 5 * Math.floor(rawMin / 5);
  let max = 5 * Math.ceil(rawMax / 5);

  if (min === max) {
    min -= 5;
    max += 5;
  }

  return { min, max, step: 5 };
}

function computeYAxisBoundsStep5(values) {
  const extent = finiteExtent(values);
  if (!extent) {
    return { min: -5, max: 0, step: 5 };
  }

  const { min: rawMin, max: rawMax } = extent;
  const min = 5 * Math.floor(rawMin / 5);
  let max = rawMax === 0 ? 0 : 5 * Math.ceil(rawMax / 5);

  if (min === max) {
    max += 5;
  }

  return { min, max, step: 5 };
}

function getPlotSize(target) {
  const containerWidth = Math.max(target.clientWidth || 0, 240);
  const leftAxis = 56;
  const rightAxis = 16;
  const topAxis = 16;
  const bottomAxis = 56;
  const innerSize = Math.max(220, Math.min(460, containerWidth - leftAxis - rightAxis));
  const width = innerSize + leftAxis + rightAxis;
  const height = innerSize + topAxis + bottomAxis;
  return { width, height, leftAxis, rightAxis };
}

function enforceEqualAspect(xAxis, yAxis) {
  const xCenter = (xAxis.min + xAxis.max) / 2;
  const yCenter = (yAxis.min + yAxis.max) / 2;
  const xSpan = xAxis.max - xAxis.min;
  const ySpan = yAxis.max - yAxis.min;

  // Enforce identical data spans on x and y so one unit in x equals one unit in y.
  const targetSpan = 5 * Math.ceil(Math.max(xSpan, ySpan) / 5);
  const halfSpan = targetSpan / 2;

  const xMin = 5 * Math.floor((xCenter - halfSpan) / 5);
  const xMax = xMin + targetSpan;
  const yMin = 5 * Math.floor((yCenter - halfSpan) / 5);
  const yMax = yMin + targetSpan;

  return {
    x: { min: xMin, max: xMax, step: 5 },
    y: { min: yMin, max: yMax, step: 5 },
  };
}

function findNearestTrajectoryIndex(u) {
  const event = u.cursor.event;
  if (!event || typeof event.clientX !== "number" || typeof event.clientY !== "number") {
    return null;
  }

  const rect = u.over.getBoundingClientRect();
  const cursorLeft = event.clientX - rect.left;
  const cursorTop = event.clientY - rect.top;

  if (!Number.isFinite(cursorLeft) || !Number.isFinite(cursorTop)) {
    return null;
  }

  const xSeries = u.data[0] ?? [];
  const ySeries = u.data[1] ?? [];
  const pointCount = Math.min(xSeries.length, ySeries.length);
  if (!pointCount) {
    return null;
  }

  let nearestIndex = null;
  let nearestDistanceSquared = Infinity;

  for (let index = 0; index < pointCount; index += 1) {
    const xValue = xSeries[index];
    const yValue = ySeries[index];
    if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) {
      continue;
    }

    const xPixel = u.valToPos(xValue, "x");
    const yPixel = u.valToPos(yValue, "y");
    const dx = xPixel - cursorLeft;
    const dy = yPixel - cursorTop;
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared < nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

export function renderTrajectoryPlot(target, result) {
  const uPlotLib = window.uPlot;
  if (!uPlotLib) {
    target.textContent = "uPlot not loaded.";
    return;
  }

  target._uplot?.destroy();
  target.replaceChildren();

  const { width, height, leftAxis, rightAxis } = getPlotSize(target);
  const rawXAxis = computeAxisBoundsStep5(result.states.x);
  const rawYAxis = computeYAxisBoundsStep5(result.states.y);
  const equalAxes = enforceEqualAspect(rawXAxis, rawYAxis);
  const xAxis = equalAxes.x;
  const yAxis = equalAxes.y;
  const xTicks = buildTicks(xAxis);
  const yTicks = buildTicks(yAxis);
  const theme = getPlotTheme({ trajectory: "--plot-trajectory" });
  const axisColor = theme.axis;

  const wrapper = document.createElement("div");
  wrapper.className = "plot-math-wrap";
  wrapper.style.gridTemplateColumns = "auto max-content";
  wrapper.style.width = "max-content";
  wrapper.style.margin = "0 auto";

  const yLabel = document.createElement("div");
  yLabel.className = "plot-math-y-axis math-label";
  renderMath("y", yLabel, { inline: false });

  const plotHost = document.createElement("div");
  plotHost.className = "plot-uplot-host";
  plotHost.style.width = `${width}px`;

  const xLabel = document.createElement("div");
  xLabel.className = "plot-math-x-axis math-label";
  xLabel.style.transform = `translateX(${(leftAxis - rightAxis) / 2}px)`;
  renderMath("x", xLabel, { inline: false });

  const coordReadout = document.createElement("div");
  coordReadout.className = "plot-coord-readout";
  coordReadout.textContent = "x: -, y: -";

  const data = [result.states.x, result.states.y];
  const series = [
    { label: "x", stroke: theme.axis },
    { label: "trajectory", stroke: theme.trajectory, width: 2 },
  ];

  wrapper.append(yLabel, plotHost, xLabel, coordReadout);
  target.append(wrapper);

  const opts = {
    width,
    height,
    pxAlign: false,
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
        size: 56,
        gap: 6,
        values: (_plot, splits) => splits.map((value) => `${value}`),
        splits: () => xTicks,
      },
      {
        side: 3,
        stroke: axisColor,
        grid: { show: false },
        ticks: { stroke: axisColor },
        size: 56,
        gap: 6,
        values: (_plot, splits) => splits.map((value) => `${value}`),
        splits: () => yTicks,
      },
      {
        side: 0,
        stroke: axisColor,
        grid: { show: false },
        size: 16,
        ticks: { show: false },
        values: () => [],
      },
      {
        side: 1,
        stroke: axisColor,
        grid: { show: false },
        size: 16,
        ticks: { show: false },
        values: () => [],
      },
    ],
    series,
    hooks: {
      setCursor: [
        (u) => {
          const idx = findNearestTrajectoryIndex(u);
          if (idx == null || idx < 0) {
            coordReadout.textContent = "x: -, y: -";
            return;
          }

          const xValue = u.data[0][idx];
          const yValue = u.data[1][idx];
          coordReadout.textContent = `x: ${Number(xValue).toFixed(4)}, y: ${Number(yValue).toFixed(4)}`;
        },
      ],
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

  target._uplot = new uPlotLib(opts, data, plotHost);
}
