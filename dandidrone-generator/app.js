const diameterInput = document.getElementById("diameter");
const widthInput = document.getElementById("width");
const countInput = document.getElementById("count");
const generateButton = document.getElementById("generate");
const exportButton = document.getElementById("export");
const statusEl = document.getElementById("status");
const previewSvg = document.getElementById("preview");

let latest = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b00020" : "#1f2a37";
}

function normalizeAngle(angle) {
  let wrapped = angle;
  while (wrapped > Math.PI) {
    wrapped -= 2 * Math.PI;
  }
  while (wrapped <= -Math.PI) {
    wrapped += 2 * Math.PI;
  }
  return wrapped;
}

function parseInputs() {
  const diameter = Number(diameterInput.value);
  const width = Number(widthInput.value);
  const count = Number(countInput.value);

  if (!Number.isFinite(diameter) || diameter <= 0) {
    throw new Error("Diameter must be a positive number.");
  }
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error("Filament width must be a positive number.");
  }
  if (width >= diameter) {
    throw new Error("Filament width must be smaller than diameter.");
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Number of filaments must be a positive integer.");
  }

  return { diameter, width, count };
}

function sampleBoundary({ diameter, width, count }) {
  const outerRadius = diameter / 2;
  const halfWidth = width / 2;
  const filamentLength = Math.sqrt(outerRadius ** 2 - halfWidth ** 2);
  const samples = Math.max(720, count * 30);
  const points = [];

  for (let i = 0; i < samples; i += 1) {
    const phi = (2 * Math.PI * i) / samples;
    let radius = 0;

    for (let k = 0; k < count; k += 1) {
      const theta = (2 * Math.PI * k) / count;
      const delta = normalizeAngle(phi - theta);
      const cosDelta = Math.cos(delta);
      if (cosDelta <= 1e-12) {
        continue;
      }

      const sinDeltaAbs = Math.abs(Math.sin(delta));
      const fromLength = filamentLength / cosDelta;
      const fromWidth = sinDeltaAbs > 1e-12 ? halfWidth / sinDeltaAbs : Number.POSITIVE_INFINITY;
      const localRadius = Math.min(fromLength, fromWidth);

      if (localRadius > radius) {
        radius = localRadius;
      }
    }

    points.push({
      x: radius * Math.cos(phi),
      y: radius * Math.sin(phi),
    });
  }

  return { points, outerRadius };
}

function updatePreview(points, outerRadius) {
  const margin = outerRadius * 0.1 + 0.05;
  const extent = outerRadius + margin;
  previewSvg.setAttribute("viewBox", `${-extent} ${-extent} ${2 * extent} ${2 * extent}`);

  previewSvg.replaceChildren();

  const grid = document.createElementNS("http://www.w3.org/2000/svg", "g");
  grid.setAttribute("stroke", "#eef2f8");
  grid.setAttribute("stroke-width", "0.03");
  const axisX = document.createElementNS("http://www.w3.org/2000/svg", "line");
  axisX.setAttribute("x1", String(-extent));
  axisX.setAttribute("y1", "0");
  axisX.setAttribute("x2", String(extent));
  axisX.setAttribute("y2", "0");
  const axisY = document.createElementNS("http://www.w3.org/2000/svg", "line");
  axisY.setAttribute("x1", "0");
  axisY.setAttribute("y1", String(-extent));
  axisY.setAttribute("x2", "0");
  axisY.setAttribute("y2", String(extent));
  grid.append(axisX, axisY);

  const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  polygon.setAttribute("class", "outline");
  polygon.setAttribute(
    "points",
    points.map((point) => `${point.x.toFixed(5)},${point.y.toFixed(5)}`).join(" "),
  );

  previewSvg.append(grid, polygon);
}

function makeDxf(points) {
  const lines = [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$INSUNITS",
    "70",
    "4",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
    "0",
    "LWPOLYLINE",
    "8",
    "CUT_OUTLINE",
    "90",
    String(points.length),
    "70",
    "1",
  ];

  for (const point of points) {
    lines.push("10", point.x.toFixed(9), "20", point.y.toFixed(9));
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return `${lines.join("\n")}\n`;
}

function handleGenerate() {
  try {
    const params = parseInputs();
    const { points, outerRadius } = sampleBoundary(params);
    updatePreview(points, outerRadius);
    latest = { params, points };
    exportButton.disabled = false;
    setStatus(
      `Generated outline: D=${params.diameter} mm, W=${params.width} mm, N=${params.count}.`,
    );
  } catch (error) {
    latest = null;
    exportButton.disabled = true;
    previewSvg.replaceChildren();
    setStatus(error instanceof Error ? error.message : "Failed to generate outline.", true);
  }
}

function handleExport() {
  if (!latest) {
    setStatus("Generate an outline before exporting.", true);
    return;
  }

  const { params, points } = latest;
  const dxfText = makeDxf(points);
  const blob = new Blob([dxfText], { type: "application/dxf" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `dandelion_D${params.diameter}_W${params.width}_N${params.count}.dxf`;
  document.body.append(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
  setStatus(`Exported ${link.download}.`);
}

generateButton.addEventListener("click", handleGenerate);
exportButton.addEventListener("click", handleExport);
