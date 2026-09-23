function niceStep(span) {
  if (span <= 6) {
    return 1;
  }
  if (span <= 12) {
    return 2;
  }
  if (span <= 30) {
    return 5;
  }
  if (span <= 60) {
    return 10;
  }
  return 20;
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
    trajectory: styles.getPropertyValue("--plot-trajectory").trim(),
    start: styles.getPropertyValue("--plot-start").trim(),
    end: styles.getPropertyValue("--plot-end").trim(),
    fontFamily: styles.fontFamily,
    fontSize: parseFloat(styles.fontSize) || 14,
  };
}

function getPlotSize(target) {
  const width = Math.max(target.clientWidth || 0, 240);
  const height = Math.max(280, Math.min(500, Math.round(width * 0.72)));
  return { width, height, compact: width < 520 };
}

export function renderTrajectoryPlot(target, result, visualization) {
  const { width, height, compact } = getPlotSize(target);
  const xAxis = computeAxisBounds(result.states.x);
  const yAxis = computeAxisBounds(result.states.y);
  const theme = getPlotTheme();
  const fontSize = compact ? Math.max(11, theme.fontSize - 1) : theme.fontSize;
  const traces = [
    {
      x: result.states.x,
      y: result.states.y,
      type: "scatter",
      mode: "lines",
      name: "$x(t), y(t)$",
      line: { color: theme.trajectory, width: 2 },
    },
  ];

  if (visualization.showStartMarker) {
    traces.push({
      x: [result.states.x[0]],
      y: [result.states.y[0]],
      type: "scatter",
      mode: "markers",
      name: "$\\mathrm{start}$",
      marker: { color: theme.start, size: 8 },
    });
  }

  if (visualization.showEndMarker) {
    traces.push({
      x: [result.states.x[result.states.x.length - 1]],
      y: [result.states.y[result.states.y.length - 1]],
      type: "scatter",
      mode: "markers",
      name: "$\\mathrm{end}$",
      marker: { color: theme.end, size: 8 },
    });
  }

  Plotly.newPlot(
    target,
    traces,
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
        title: { text: "$x$", standoff: 10, font: { size: fontSize } },
        range: xAxis.range,
        dtick: xAxis.dtick,
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
        title: { text: "$y$", standoff: 10, font: { size: fontSize } },
        range: yAxis.range,
        dtick: yAxis.dtick,
        scaleanchor: "x",
        scaleratio: 1,
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
        l: compact ? 44 : 56,
        r: compact ? 104 : 140,
        t: 12,
        b: compact ? 44 : 56,
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
