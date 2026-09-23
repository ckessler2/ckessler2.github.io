export function createPlotSection() {
  const panel = document.createElement("div");
  panel.className = "plot-section";

  const plot = document.createElement("div");
  plot.className = "plot";

  panel.append(plot);
  return { panel, plot };
}
