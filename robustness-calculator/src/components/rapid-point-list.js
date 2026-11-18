// Per-point (or per-property) results as a filterable list of narrow rows that
// expand to details. Failures come first. Styles: css/rapid.css (.rpl-*).

import { el } from "./ui.js";

export const VERDICT_SYMBOL = { counterexample: "✗", unknown: "?", certified: "✓" };
const ORDER = { counterexample: 0, unknown: 1, certified: 2 };

/**
 * @param items  [{ index, title, sub, verdict: { key, label } | null,
 *                  published: { label, state: "match" | "differs" | "conflict" } | null,
 *                  details: () => Node }]
 * @param labels { counterexample, unknown, certified } chip names
 * @param filter current filter key ("all", a verdict key, or "differs")
 * @param onFilter (key) => void, to remember the filter
 * @param openSet  Set of item indices that are expanded (kept across re-renders)
 * @param columns  header names: { title, sub, verdict, published }
 */
export function createPointList({ items, labels, filter = "all", onFilter, openSet = new Set(), columns }) {
  const root = el("div", "rpl");
  const hasPublished = items.some((it) => it.published);
  if (hasPublished) root.classList.add("has-published");
  const sorted = items.slice().sort((a, b) => (ORDER[a.verdict?.key] ?? 3) - (ORDER[b.verdict?.key] ?? 3) || a.index - b.index);

  // Filter chips with counts; only kinds that occur.
  const counts = { all: items.length, counterexample: 0, unknown: 0, certified: 0, differs: 0 };
  for (const it of items) {
    if (it.verdict) counts[it.verdict.key]++;
    if (it.published && it.published.state !== "match") counts.differs++;
  }
  const chipDefs = [
    { key: "all", label: `All ${counts.all}` },
    ...["counterexample", "unknown", "certified"]
      .filter((k) => counts[k] > 0 && labels[k])
      .map((k) => ({ key: k, label: `${VERDICT_SYMBOL[k]} ${labels[k]} ${counts[k]}` })),
    ...(counts.differs ? [{ key: "differs", label: `≠ published ${counts.differs}` }] : []),
  ];
  if (!chipDefs.some((c) => c.key === filter)) filter = "all";

  const chips = el("div", "rpl-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Filter");
  const chipNodes = chipDefs.map((c) => {
    const b = el("button", `rpl-chip rpl-chip-${c.key}`, c.label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(c.key === filter));
    b.addEventListener("click", () => {
      filter = c.key;
      chipNodes.forEach((n, i) => n.setAttribute("aria-pressed", String(chipDefs[i].key === filter)));
      apply();
      onFilter?.(filter);
    });
    chips.append(b);
    return b;
  });
  if (chipDefs.length > 1) root.append(chips);

  const head = el("div", "rpl-head");
  head.append(el("span", "rpl-c-title", columns.title), el("span", "rpl-c-sub", columns.sub ?? ""), el("span", "rpl-c-verdict", columns.verdict));
  if (hasPublished) head.append(el("span", "rpl-c-pub", columns.published ?? "Published"));
  head.setAttribute("aria-hidden", "true");
  root.append(head);

  const list = el("div", "rpl-list");
  const rows = sorted.map((it) => {
    const d = document.createElement("details");
    d.className = "rpl-row";
    const s = document.createElement("summary");
    s.append(el("span", "rpl-c-title", it.title), el("span", "rpl-c-sub", it.sub ?? ""));
    const v = el("span", `rpl-c-verdict rpl-v-${it.verdict?.key ?? "none"}`);
    if (it.verdict) v.append(el("span", "rpl-sym", VERDICT_SYMBOL[it.verdict.key] ?? ""), " ", it.verdict.label);
    else v.textContent = "–";
    s.append(v);
    if (hasPublished) {
      const p = el("span", `rpl-c-pub is-${it.published?.state ?? "none"}`, it.published?.label ?? "–");
      if (it.published?.state === "conflict") p.title = "Contradicts the published verdict";
      s.append(p);
    }
    const body = el("div", "rpl-detail");
    d.append(s, body);
    let filled = false;
    const fill = () => {
      if (filled || !d.open) return;
      filled = true;
      body.append(it.details());
    };
    d.addEventListener("toggle", () => {
      if (d.open) openSet.add(it.index);
      else openSet.delete(it.index);
      fill();
    });
    if (openSet.has(it.index)) {
      d.open = true;
      fill();
    }
    list.append(d);
    return { it, d };
  });
  root.append(list);
  const empty = el("p", "section-note rpl-empty", "Nothing in this group.");
  root.append(empty);

  function apply() {
    let shown = 0;
    for (const { it, d } of rows) {
      const show =
        filter === "all" ||
        (filter === "differs" ? it.published && it.published.state !== "match" : it.verdict?.key === filter);
      d.hidden = !show;
      if (show) shown++;
    }
    empty.hidden = shown > 0;
  }
  apply();
  return root;
}

/** A details grid: [{ label, value, note }] → rows of "label  value" with a one-line meaning. */
export function detailList(entries) {
  const dl = el("dl", "rpl-dl");
  for (const e of entries.filter(Boolean)) {
    const dt = el("dt", "", e.label);
    const dd = el("dd");
    dd.append(...[].concat(e.value));
    if (e.note) dd.append(el("span", "rpl-note", e.note));
    dl.append(dt, dd);
  }
  return dl;
}
