function niceStep(span) {
  if (span <= 1) {
    return 0.2;
  }
  if (span <= 3) {
    return 0.5;
  }
  if (span <= 8) {
    return 1;
  }
  if (span <= 20) {
    return 2;
  }
  if (span <= 40) {
    return 5;
  }
  return 10;
}

function computeAxisBounds(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return { range: [-1, 1], dtick: 1 };
  }

  const rawMin = Math.min(...finiteValues);
  const rawMax = Math.max(...finiteValues);
  const span = Math.max(rawMax - rawMin, 0.5);
  const step = niceStep(span);

  const min = Math.floor(rawMin / step) * step;
  const max = Math.ceil(rawMax / step) * step;
  const adjustedMax = max === min ? min + step : max;

  return {
    range: [min, adjustedMax],
    dtick: step,
  };
}

function getPlotTheme() {
  const styles = getComputedStyle(document.body);
  return {
    paperBg: styles.getPropertyValue("--plot-paper").trim(),
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
  const width = Math.max(target.clientWidth || 0, 240);
  const height = Math.max(250, Math.min(360, Math.round(width * 0.40)));
  return { width, height, compact: width < 520 };
}

export function renderStatePlot(target, result) {
  const { width, height, compact } = getPlotSize(target);
  const combinedValues = [
    ...result.states.v_xp,
    ...result.states.v_yp,
    ...result.states.omega,
    ...result.states.theta,
  ];
  const yAxis = computeAxisBounds(combinedValues);
  const theme = getPlotTheme();
  const fontSize = compact ? Math.max(11, theme.fontSize - 1) : theme.fontSize;

  Plotly.newPlot(
    target,
    [
      {
        x: result.t,
        y: result.states.v_xp,
        type: "scatter",
        mode: "lines",
        name: "$v_{x'}$",
        line: { width: 2, color: theme.vx },
      },
      {
        x: result.t,
        y: result.states.v_yp,
        type: "scatter",
        mode: "lines",
        name: "$v_{y'}$",
        line: { width: 2, color: theme.vy },
      },
      {
        x: result.t,
        y: result.states.omega,
        type: "scatter",
        mode: "lines",
        name: "$\\omega$",
        line: { width: 2, color: theme.omega },
      },
      {
        x: result.t,
        y: result.states.theta,
        type: "scatter",
        mode: "lines",
        name: "$\\theta$",
        line: { width: 2, color: theme.theta },
      },
    ],
    {
      width,
      height,
      autosize: true,
      paper_bgcolor: theme.paperBg,
      plot_bgcolor: theme.plotBg,
      font: {
        family: theme.fontFamily,
        size: fontSize,
        color: theme.text,
      },
      xaxis: {
        title: { text: "$t$", standoff: 10, font: { size: fontSize } },
        showgrid: false,
        zeroline: false,
        showline: true,
        linecolor: theme.axis,
        linewidth: 1,
        mirror: true,
        ticks: "outside",
        tickcolor: theme.axis,
        tickfont: { size: fontSize },
      },
      yaxis: {
        title: { text: "$v_{x'}, v_{y'}, \\omega, \\theta$", standoff: 10, font: { size: fontSize } },
        range: yAxis.range,
        dtick: yAxis.dtick,
        showgrid: false,
        zeroline: false,
        showline: true,
        linecolor: theme.axis,
        linewidth: 1,
        mirror: true,
        ticks: "outside",
        tickcolor: theme.axis,
        tickfont: { size: fontSize },
      },
      margin: {
        l: compact ? 44 : 52,
        r: compact ? 104 : 148,
        t: 12,
        b: compact ? 44 : 52,
      },
      legend: {
        orientation: "v",
        x: 1.06,
        xanchor: "left",
        y: 0.5,
        yanchor: "middle",
        font: { size: fontSize },
      },
    },
    { responsive: true, displayModeBar: false },
  );
}
