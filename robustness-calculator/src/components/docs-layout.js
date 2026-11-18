// Building blocks for the documentation pages (Estimate Method and Results, Verify Method):
// a page with an "On this page" table of contents, sections that open with a one-sentence summary,
// an "In short" box, small cards, definition lists and scrolling tables. Styles: css/docs.css.

import { el } from "./ui.js";

/** Append mixed content (strings, nodes, arrays of either) to a node. */
function fill(node, content) {
  for (const part of [].concat(content ?? [])) {
    if (part === null || part === undefined || part === false) continue;
    node.append(typeof part === "string" ? document.createTextNode(part) : part);
  }
  return node;
}

/** A paragraph from mixed content. */
export function p(...parts) {
  return fill(el("p"), parts);
}

/** The "In short" box at the top of a page. */
export function inShort(...content) {
  const box = el("section", "docs-short");
  box.setAttribute("aria-label", "In short");
  box.append(el("p", "docs-eyebrow", "In short"));
  return fill(box, content);
}

/** Small cards side by side: [{ title, text, tone? }]; tone adds a coloured marker (certified, counterexample, unknown). */
export function cards(items, className = "") {
  const list = el("ul", `docs-cards ${className}`.trim());
  for (const item of items) {
    const li = el("li", item.tone ? `docs-card tone-${item.tone}` : "docs-card");
    const title = el("strong", "docs-card-title");
    fill(title, item.title);
    li.append(title, fill(el("p"), item.text));
    list.append(li);
  }
  return list;
}

/** A definition list: [[term, description], …]; term and description can be strings or nodes. */
export function defs(items, className = "") {
  const dl = el("dl", `docs-defs ${className}`.trim());
  for (const [term, description] of items) {
    dl.append(fill(el("dt"), term), fill(el("dd"), description));
  }
  return dl;
}

/** Bullet or numbered list from mixed items. */
export function bullets(items, { ordered = false, className = "" } = {}) {
  const list = el(ordered ? "ol" : "ul", `bullet-list docs-list ${className}`.trim());
  for (const item of items) list.append(fill(el("li"), item));
  return list;
}

/** A small table that scrolls inside its own frame: head [labels], rows [[cells]]. */
export function table(head, rows, { className = "", caption } = {}) {
  const wrap = el("div", `docs-table-wrap ${className}`.trim());
  const t = el("table", "data-table docs-table");
  if (caption) t.append(fill(el("caption"), caption));
  const tr = el("tr");
  for (const h of head) tr.append(fill(el("th"), h));
  const thead = el("thead");
  thead.append(tr);
  const tbody = el("tbody");
  for (const row of rows) {
    const r = el("tr");
    for (const cell of row) r.append(fill(el("td"), cell));
    tbody.append(r);
  }
  t.append(thead, tbody);
  wrap.append(t);
  return wrap;
}

/** A sub-heading inside a section. */
export function subhead(text, ...extra) {
  const h = el("h3", "docs-h3", text);
  for (const node of extra) h.append(" ", node);
  return h;
}

/** A note with a left rule (warnings and recorded decisions). */
export function callout(content, tone = "warn") {
  return fill(el("div", `docs-callout tone-${tone}`), content);
}

function tocList(sections, onPick, withSubs = false) {
  const list = el("ol", "docs-toc-list");
  for (const s of sections) {
    const li = el("li");
    const b = el("button", "docs-toc-link", s.toc ?? s.title);
    b.type = "button";
    b.dataset.target = s.id;
    b.addEventListener("click", () => onPick(s.id));
    li.append(b);
    if (withSubs && s.subs?.length) {
      const sub = el("ol", "docs-toc-sublist");
      for (const h of s.subs) {
        const sb = el("button", "docs-toc-sublink", h.title);
        sb.type = "button";
        sb.addEventListener("click", () => onPick(s.id, h.id));
        const sli = el("li");
        sli.append(sb);
        sub.append(sli);
      }
      li.append(sub);
    }
    list.append(li);
  }
  return list;
}

/**
 * A documentation page.
 * header: nodes above the sections (title, "In short").
 * sections: [{ id, title, toc?, summary, body: [nodes] }]; the summary is the section's first, plain-words sentence.
 * tocDepth 2 also lists each section's sub-headings (h3.docs-h3) in the sidebar.
 * The table of contents is sticky on the right on wide screens and sits under the header on narrow ones.
 * Links scroll with scrollIntoView, so the hash route (#/estimate-method…) is never changed.
 */
export function docsPage({ header = [], sections, className = "", tocDepth = 1 }) {
  const layout = el("div", `docs-layout ${className}`.trim());
  const article = el("article", "page-card prose docs-article");
  const prefix = "docs-";

  const scrollTo = (id, subId) => {
    const target = article.querySelector(`#${prefix}${subId ?? id}`);
    if (!target) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    (subId ? target : target.querySelector("h2"))?.focus({ preventScroll: true });
    picked = id;
    setActive(id);
  };
  let picked = null;

  const sectionNodes = [];
  for (const s of sections) {
    const section = el("section", "docs-section");
    section.id = `${prefix}${s.id}`;
    const h = el("h2", "", s.title);
    h.tabIndex = -1;
    section.append(h);
    if (s.summary) section.append(fill(el("p", "docs-summary"), s.summary));
    fill(section, s.body);
    s.subs = [...section.querySelectorAll("h3.docs-h3")].map((h, i) => {
      h.id = `${prefix}${s.id}--${i}`;
      h.tabIndex = -1;
      return { id: `${s.id}--${i}`, title: h.firstChild?.textContent?.trim() ?? "" };
    });
    sectionNodes.push(section);
  }

  const inlineToc = el("nav", "docs-toc docs-toc-inline");
  inlineToc.setAttribute("aria-label", "On this page");
  inlineToc.append(el("p", "docs-eyebrow", "On this page"), tocList(sections, scrollTo));

  const sideToc = el("nav", "docs-toc docs-toc-side");
  sideToc.setAttribute("aria-label", "On this page (sidebar)");
  sideToc.append(el("p", "docs-eyebrow", "On this page"), tocList(sections, scrollTo, tocDepth > 1));
  const aside = el("aside", "docs-aside");
  aside.append(sideToc);

  function setActive(id) {
    for (const b of aside.querySelectorAll(".docs-toc-link")) {
      const on = b.dataset.target === id;
      b.classList.toggle("is-current", on);
      if (on) b.setAttribute("aria-current", "location");
      else b.removeAttribute("aria-current");
    }
  }

  fill(article, header);
  article.append(inlineToc, ...sectionNodes);

  // Highlight the section being read: the last one whose top has passed the upper third of the screen.
  let frame = 0;
  const onScroll = () => {
    if (!layout.isConnected) {
      window.removeEventListener("scroll", onScroll);
      return;
    }
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      let current = sections[0].id;
      for (const s of sections) {
        const node = article.querySelector(`#${prefix}${s.id}`);
        if (node && node.getBoundingClientRect().top < window.innerHeight * 0.33) current = s.id;
      }
      // At the very bottom, short last sections can never reach the top: keep the one that was clicked.
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom && picked) {
        const node = article.querySelector(`#${prefix}${picked}`);
        if (node && node.getBoundingClientRect().top < window.innerHeight) current = picked;
      }
      setActive(current);
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  queueMicrotask(onScroll);

  layout.append(article, aside);
  return layout;
}

/** Page title with an optional one-line subtitle. */
export function pageTitle(title, subtitle) {
  const head = el("header", "docs-title");
  head.append(el("h1", "", title));
  if (subtitle) head.append(fill(el("p", "docs-subtitle"), subtitle));
  return head;
}
