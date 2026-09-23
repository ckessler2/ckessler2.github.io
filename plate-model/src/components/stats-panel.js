function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes.toFixed(0)} B`;
  }
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

export function createStatsPanel(result) {
  const container = document.createElement("div");

  const statsGrid = document.createElement("div");
  statsGrid.className = "stats-grid";

  const items = [
    ["Total steps", result.metadata.stepCount.toLocaleString()],
    ["Compute time", `${result.metadata.runtimeMs.toFixed(2)} ms`],
    ["Estimated memory", formatBytes(result.metadata.estimatedMemoryBytes)],
  ];

  for (const [label, value] of items) {
    const chip = document.createElement("div");
    chip.className = "stat-chip";

    const labelNode = document.createElement("span");
    labelNode.textContent = label;

    const valueNode = document.createElement("strong");
    valueNode.textContent = value;

    chip.append(labelNode, valueNode);
    statsGrid.append(chip);
  }

  const finalState = document.createElement("pre");
  finalState.className = "mono";
  finalState.textContent = JSON.stringify(result.finalState, null, 2);

  container.append(statsGrid, finalState);
  return container;
}
