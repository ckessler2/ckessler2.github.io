function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.dispatchEvent(new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    view: window,
  }));
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1000);
}

function finiteRange(values) {
  let min = Infinity;
  let max = -Infinity;

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

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  if (min === max) {
    return { min: min - 0.5, max: max + 0.5 };
  }

  return { min, max };
}

function buildTrajectoryPath(points) {
  if (!points.length) {
    return "";
  }

  const [first, ...rest] = points;
  const segments = [`M ${first.x.toFixed(3)} ${first.y.toFixed(3)}`];

  for (const point of rest) {
    segments.push(`L ${point.x.toFixed(3)} ${point.y.toFixed(3)}`);
  }

  return segments.join(" ");
}

function createSvgTrajectory(result) {
  const xValues = result.states?.x ?? [];
  const yValues = result.states?.y ?? [];
  const pointCount = Math.min(xValues.length, yValues.length);
  if (pointCount < 2) {
    return null;
  }

  const xRange = finiteRange(xValues);
  const yRange = finiteRange(yValues);
  if (!xRange || !yRange) {
    return null;
  }

  const width = 1200;
  const height = 800;
  const padding = 40;
  const drawableWidth = width - 2 * padding;
  const drawableHeight = height - 2 * padding;

  const xSpan = xRange.max - xRange.min;
  const ySpan = yRange.max - yRange.min;

  // Use one uniform scale so x and y units are equal in the exported SVG.
  const scale = Math.min(drawableWidth / xSpan, drawableHeight / ySpan);
  const usedWidth = xSpan * scale;
  const usedHeight = ySpan * scale;
  const offsetX = padding + (drawableWidth - usedWidth) / 2;
  const offsetY = padding + (drawableHeight - usedHeight) / 2;

  const points = Array.from({ length: pointCount }, (_, index) => {
    const xModel = xValues[index];
    const yModel = yValues[index];

    const x = offsetX + (xModel - xRange.min) * scale;
    const y = height - offsetY - (yModel - yRange.min) * scale;
    return { x, y };
  });

  const pathData = buildTrajectoryPath(points);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>Freely Falling Plate Trajectory</title>
  <desc>Trajectory built from timestep samples in model coordinates (x, y), mapped into an SVG frame.</desc>
  <path d="${pathData}" fill="none" stroke="#0f5b78" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;
}

function normalizeSvgFilename(filename) {
  const trimmed = String(filename ?? "").trim();
  if (!trimmed) {
    return "plate-model-trajectory-xy.svg";
  }
  return trimmed.toLowerCase().endsWith(".svg") ? trimmed : `${trimmed}.svg`;
}

export function exportQuiescentTrajectorySvg(
  result,
  filename = "plate-model-trajectory-xy.svg",
) {
  const svg = result ? createSvgTrajectory(result) : null;
  if (!svg) {
    return;
  }

  downloadTextFile(svg, normalizeSvgFilename(filename), "image/svg+xml;charset=utf-8");
}
