export function createStatsPanel(result) {
  const container = document.createElement("div");

  const finalState = document.createElement("pre");
  finalState.className = "mono";
  finalState.textContent = JSON.stringify(result.finalState, null, 2);

  container.append(finalState);
  return container;
}

