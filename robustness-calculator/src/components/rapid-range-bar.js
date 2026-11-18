// One bar that shows a result range: proven-good share (solid), undecided share
// (hatched), proven-bad share (counterexamples). The two ends of the range are
// labelled under the bar; a published reference (a value or a lo–hi range) is
// drawn as a tick/bracket above it. Styles: css/rapid.css (.rrb-*).

import { el } from "./ui.js";

export const formatPercent = (v) => {
  const p = v * 100;
  return Number.isInteger(Math.round(p * 10) / 10) ? `${Math.round(p)}` : p.toFixed(1);
};

/**
 * @param counts      { good, unknown, bad } point/property counts
 * @param labels      { good, unknown, bad } legend names
 * @param published   null or { lo, hi } shares in [0, 1]
 * @param ariaLabel   text for screen readers
 */
export function createRangeBar({ counts, labels, published = null, ariaLabel = "" }) {
  const n = counts.good + counts.unknown + counts.bad;
  const lo = n ? counts.good / n : 0;
  const hi = n ? (counts.good + counts.unknown) / n : 0;
  const figure = el("figure", "rrb");

  const wrap = el("div", "rrb-barwrap");
  const track = el("div", "rrb-track");
  wrap.append(track);
  track.setAttribute("role", "img");
  track.setAttribute("aria-label", ariaLabel || `${labels.good} ${counts.good}, ${labels.unknown} ${counts.unknown}, ${labels.bad} ${counts.bad} of ${n}`);
  for (const key of ["good", "unknown", "bad"]) {
    if (!counts[key]) continue;
    const seg = el("div", `rrb-seg rrb-${key}`);
    seg.style.flexGrow = String(counts[key]);
    seg.title = `${labels[key]}: ${counts[key]} of ${n}`;
    if (counts[key] / n >= 0.1) seg.append(el("span", "rrb-count", String(counts[key])));
    track.append(seg);
  }

  // Published reference above the bar.
  const above = el("div", "rrb-above");
  if (published) {
    const mark = el("div", published.hi > published.lo ? "rrb-pub rrb-pub-range" : "rrb-pub");
    mark.style.left = `${published.lo * 100}%`;
    if (published.hi > published.lo) mark.style.width = `${(published.hi - published.lo) * 100}%`;
    const text = published.hi > published.lo ? `published ${formatPercent(published.lo)}–${formatPercent(published.hi)} %` : `published ${formatPercent(published.lo)} %`;
    const label = el("span", "rrb-pub-label", text);
    const centre = published.hi > published.lo ? (published.lo + published.hi) / 2 : published.lo;
    // Keep the label inside the bar's width.
    if (centre < 0.2) label.classList.add("is-start");
    else if (centre > 0.8) label.classList.add("is-end");
    mark.append(label);
    above.append(mark);
    for (const share of published.hi > published.lo ? [published.lo, published.hi] : [published.lo]) {
      const line = el("div", "rrb-pub-line");
      line.style.left = `calc(${share * 100}% - 1px)`;
      wrap.append(line);
    }
  }

  // End labels under the bar.
  const below = el("div", "rrb-below");
  const endLabel = (share, text) => {
    const node = el("span", "rrb-end", text);
    node.style.left = `${share * 100}%`;
    if (share < 0.08) node.classList.add("is-start");
    else if (share > 0.92) node.classList.add("is-end");
    return node;
  };
  if (hi - lo < 0.14) {
    below.append(endLabel((lo + hi) / 2, lo === hi ? `${formatPercent(lo)} %` : `${formatPercent(lo)}–${formatPercent(hi)} %`));
  } else {
    below.append(endLabel(lo, `${formatPercent(lo)} %`), endLabel(hi, `${formatPercent(hi)} %`));
  }

  const legend = el("div", "rrb-legend");
  for (const key of ["good", "unknown", "bad"]) {
    const item = el("span", "rrb-legend-item");
    item.append(el("span", `rrb-swatch rrb-${key}`), `${labels[key]} ${counts[key]}`);
    legend.append(item);
  }
  if (published) {
    const item = el("span", "rrb-legend-item");
    item.append(el("span", "rrb-swatch rrb-swatch-pub"), "published");
    legend.append(item);
  }

  if (published) figure.append(above);
  figure.append(wrap, below, legend);
  return figure;
}
