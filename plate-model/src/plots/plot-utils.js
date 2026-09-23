function niceNumber(value, round) {
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  let niceFraction;

  if (round) {
    if (fraction < 1.5) {
      niceFraction = 1;
    } else if (fraction < 3) {
      niceFraction = 2;
    } else if (fraction < 7) {
      niceFraction = 5;
    } else {
      niceFraction = 10;
    }
  } else if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }

  return niceFraction * 10 ** exponent;
}

export function computeNiceAxis(values, tickCount = 6) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(Math.abs(max), 1);
  const paddedRange = range * 1.08;
  const step = niceNumber(paddedRange / Math.max(tickCount - 1, 1), true);
  const niceMin = Math.floor((min - 0.04 * range) / step) * step;
  const niceMax = Math.ceil((max + 0.04 * range) / step) * step;

  return { min: niceMin, max: niceMax, step };
}

export function matlabAxisStyle(title, axisSpec = {}) {
  return {
    title,
    range: [axisSpec.min, axisSpec.max],
    dtick: axisSpec.step,
    showgrid: false,
    zeroline: false,
    showline: true,
    linecolor: "#17212b",
    linewidth: 1,
    mirror: true,
    ticks: "outside",
    tickcolor: "#17212b",
    tickfont: { color: "#17212b" },
    titlefont: { color: "#17212b" },
  };
}
