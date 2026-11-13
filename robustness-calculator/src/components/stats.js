// Stat chips and data tables, styled like plate-model's stats grid.

export function formatNumber(v, digits = 6) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  if (v === Infinity) return "∞";
  if (v === -Infinity) return "−∞";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e-3 && abs < 1e6) return String(Number(v.toPrecision(digits)));
  return v.toExponential(digits - 1);
}

export function formatTime(ms) {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function createStatGrid(items) {
  const grid = document.createElement("div");
  grid.className = "stats-grid";
  for (const { label, value, title } of items) {
    const chip = document.createElement("div");
    chip.className = "stat-chip";
    if (title) chip.title = title;
    const l = document.createElement("span");
    l.textContent = label;
    const v = document.createElement("strong");
    v.textContent = value;
    chip.append(l, v);
    grid.append(chip);
  }
  return grid;
}

/**
 * columns: [{ label, value: (row) => string, className?: (row) => string }]
 */
export function createDataTable(columns, rows) {
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "data-table";

  const head = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const c of columns) {
    const th = document.createElement("th");
    th.textContent = c.label;
    if (c.title) th.title = c.title;
    hr.append(th);
  }
  head.append(hr);

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const c of columns) {
      const td = document.createElement("td");
      td.textContent = c.value(row);
      const cls = c.className?.(row);
      if (cls) td.className = cls;
      tr.append(td);
    }
    body.append(tr);
  }

  table.append(head, body);
  wrap.append(table);
  return wrap;
}
