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

function computeAxisBoundsStep5(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return { min: -5, max: 5, step: 5 };
  }

  const rawMin = Math.min(...finiteValues);
  const rawMax = Math.max(...finiteValues);
  let min = 5 * Math.floor(rawMin / 5);
  let max = 5 * Math.ceil(rawMax / 5);

  if (min === max) {
    min -= 5;
    max += 5;
  }

  return { min, max, step: 5 };
}

function computeYAxisBoundsStep5(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return { min: -5, max: 0, step: 5 };
  }

  const rawMin = Math.min(...finiteValues);
  const rawMax = Math.max(...finiteValues);
  const min = 5 * Math.floor(rawMin / 5);
  let max = rawMax === 0 ? 0 : 5 * Math.ceil(rawMax / 5);

  if (min === max) {
    max += 5;
  }

  return { min, max, step: 5 };
}

function getPlotTheme() {
  const styles = getComputedStyle(document.body);
  return {
    plotBg: styles.getPropertyValue("--plot-bg").trim(),
    text: styles.getPropertyValue("--plot-text").trim(),
    axis: styles.getPropertyValue("--plot-axis").trim(),
    trajectory: styles.getPropertyValue("--plot-trajectory").trim(),
    fontFamily: styles.fontFamily,
    fontSize: parseFloat(styles.fontSize) || 14,
  };
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

function enforceCappedAspect(xAxis, yAxis, maxExpandFactor = 1.5) {
  const xCenter = (xAxis.min + xAxis.max) / 2;
  const yCenter = (yAxis.min + yAxis.max) / 2;
  const xSpan = xAxis.max - xAxis.min;
  const ySpan = yAxis.max - yAxis.min;

  let targetXSpan = xSpan;
  let targetYSpan = ySpan;

  if (ySpan > xSpan) {
    targetXSpan = Math.min(ySpan, xSpan * maxExpandFactor);
  } else if (xSpan > ySpan) {
    targetYSpan = Math.min(xSpan, ySpan * maxExpandFactor);
  }

  const xHalf = targetXSpan / 2;
  const yHalf = targetYSpan / 2;

  const xMin = 5 * Math.floor((xCenter - xHalf) / 5);
  const xMax = 5 * Math.ceil((xCenter + xHalf) / 5);
  const yMin = 5 * Math.floor((yCenter - yHalf) / 5);
  const yMax = 5 * Math.ceil((yCenter + yHalf) / 5);

  return {
    x: { min: xMin, max: xMax, step: 5 },
    y: { min: yMin, max: yMax, step: 5 },
  };
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

export function renderTrajectoryPlot(target, result, visualization) {
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
  const equalAxes = enforceCappedAspect(rawXAxis, rawYAxis);
  const xAxis = equalAxes.x;
  const yAxis = equalAxes.y;
  const xTicks = buildTicks(xAxis);
  const yTicks = buildTicks(yAxis);
  const theme = getPlotTheme();
  const axisColor = "#000";

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

  const data = [result.states.x, result.states.y];
  const series = [
    { label: "x", stroke: theme.axis },
    { label: "trajectory", stroke: theme.trajectory, width: 2 },
  ];

  wrapper.append(yLabel, plotHost, xLabel);
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
