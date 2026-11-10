// Min/max over one or more series, skipping non-finite values.
// Uses a loop rather than Math.min(...values), which throws once a long run
// exceeds the browser's argument limit.
export function finiteExtent(...seriesList) {
  let min = Infinity;
  let max = -Infinity;

  for (const values of seriesList) {
    for (const value of values) {
      if (!Number.isFinite(value)) {
        continue;
      }
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
  }

  return Number.isFinite(min) ? { min, max } : null;
}

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

// Integer-aligned axis bounds with a "nice" tick step, covering every series given.
export function computeAxisBounds(...seriesList) {
  const extent = finiteExtent(...seriesList);
  if (!extent) {
    return { min: -1, max: 1, step: 1 };
  }

  const min = Math.floor(extent.min);
  let max = Math.ceil(extent.max);

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

export function buildTicks(bounds) {
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

export function drawAxisLimitBox(u, color) {
  const { left, top, width, height } = u.bbox;
  u.ctx.save();
  u.ctx.strokeStyle = color;
  u.ctx.lineWidth = 1;
  u.ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
  u.ctx.restore();
}

// Reads the base plot colours and fonts from the CSS theme, plus any extra
// colours given as { key: "--css-variable" }.
export function getPlotTheme(extraColors = {}) {
  const styles = getComputedStyle(document.body);
  const read = (name) => styles.getPropertyValue(name).trim();

  const theme = {
    plotBg: read("--plot-bg"),
    text: read("--plot-text"),
    axis: read("--plot-axis"),
    fontFamily: styles.fontFamily,
    fontSize: parseFloat(styles.fontSize) || 14,
  };

  for (const [key, variable] of Object.entries(extraColors)) {
    theme[key] = read(variable);
  }

  return theme;
}
