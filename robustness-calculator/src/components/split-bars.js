// Stacked horizontal bars on one shared axis: each row is one whole split into
// the same ordered parts, so rows can be compared segment by segment.
// Each segment shows its count where it fits and has a hover tooltip; the
// legend names the parts, so identity never rests on colour alone.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param parts  [{ key, label }] in display order; colour comes from CSS class `split-${key}`
 * @param rows   [{ label, values: { [key]: number } }]
 */
export function createSplitBars({ parts, rows, caption }) {
  const figure = el("figure", "split-bars");

  const legend = el("div", "split-legend");
  for (const p of parts) {
    const item = el("span", "split-legend-item");
    item.append(el("span", `split-swatch split-${p.key}`), p.label);
    legend.append(item);
  }
  figure.append(legend);

  for (const row of rows) {
    const total = parts.reduce((a, p) => a + (row.values[p.key] ?? 0), 0);
    const line = el("div", "split-row");
    line.append(el("div", "split-row-label", row.label));
    const bar = el("div", "split-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute(
      "aria-label",
      `${row.label}: ` + parts.map((p) => `${p.label} ${row.values[p.key] ?? 0} of ${total}`).join(", "),
    );
    for (const p of parts) {
      const v = row.values[p.key] ?? 0;
      if (!v) continue;
      const share = v / total;
      const seg = el("div", `split-seg split-${p.key}`);
      seg.style.flexGrow = String(v);
      seg.dataset.tip = `${p.label}: ${v} of ${total} (${(share * 100).toFixed(0)}%)`;
      seg.tabIndex = 0;
      if (share >= 0.08) seg.append(el("span", "split-seg-value", String(v)));
      bar.append(seg);
    }
    line.append(bar);
    figure.append(line);
  }

  if (caption) figure.append(el("figcaption", "section-note", caption));
  return figure;
}
