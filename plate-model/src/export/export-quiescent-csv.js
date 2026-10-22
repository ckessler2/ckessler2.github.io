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

function normalizeCsvFilename(filename) {
  const trimmed = String(filename ?? "").trim();
  if (!trimmed) {
    return "plate-model-quiescent.csv";
  }
  return trimmed.toLowerCase().endsWith(".csv") ? trimmed : `${trimmed}.csv`;
}

export function exportQuiescentResultCsv(result, filename = "plate-model-quiescent.csv") {
  if (!result) {
    return;
  }

  const headers = ["t", "v_xp", "v_yp", "omega", "theta", "x", "y"];
  const rows = result.t.map((time, index) => [
    time,
    result.states.v_xp[index],
    result.states.v_yp[index],
    result.states.omega[index],
    result.states.theta[index],
    result.states.x[index],
    result.states.y[index],
  ]);

  const content = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
  downloadTextFile(content, normalizeCsvFilename(filename), "text/csv;charset=utf-8");
}
