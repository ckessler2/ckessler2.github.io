import { renderMath } from "../app/math.js";
import { buildTicks, computeAxisBounds, drawAxisLimitBox, getPlotTheme } from "./plot-utils.js";

function getPlotSize(target) {
  const containerWidth = target.clientWidth || target.parentElement?.clientWidth || 0;
  const width = Math.max(Math.floor((containerWidth - 8) * 0.85), 220);
  const height = Math.max(250, Math.min(360, Math.round(width * 0.4)));
  return { width, height };
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
  const yAxis = computeAxisBounds(
    result.states.v_xp,
    result.states.v_yp,
    result.states.omega,
    result.states.theta,
  );
  const xTicks = buildTicks(xAxis);
  const yTicks = buildTicks(yAxis);
  const theme = getPlotTheme({
    vx: "--plot-state-1",
    vy: "--plot-state-2",
    omega: "--plot-state-3",
    theta: "--plot-state-4",
  });
  const axisColor = theme.axis;

  const wrapper = document.createElement("div");
  wrapper.className = "plot-math-wrap";

  const yLabel = document.createElement("div");
  yLabel.className = "plot-math-y-axis math-label";
  yLabel.style.position = "relative";
  yLabel.style.zIndex = "2";
  renderMath("v_{x'},\\,v_{y'},\\,\\omega,\\,\\theta", yLabel, { inline: false });

  const plotHost = document.createElement("div");
  plotHost.className = "plot-uplot-host";
  plotHost.style.marginLeft = "-10px";
  plotHost.style.position = "relative";
  plotHost.style.zIndex = "1";

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
