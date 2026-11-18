// Shared building blocks for a quiet interface: help on demand (ⓘ popovers, one-line hints),
// status pills, empty states, segmented switches and small menus. Styles: "Shared UI" in style.css.

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---- popovers (ⓘ help and small menus) ----------------------------------------------------------

let openPopover = null;

function closeOpenPopover() {
  if (!openPopover) return;
  openPopover.panel.hidden = true;
  openPopover.button.setAttribute("aria-expanded", "false");
  openPopover = null;
}

document.addEventListener("click", (event) => {
  if (openPopover && !openPopover.root.contains(event.target)) closeOpenPopover();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeOpenPopover();
});

/** A button that opens a small panel on click (works on touch; closes on outside click or Esc). */
export function popover(button, panelContent, { className = "", align = "start" } = {}) {
  const root = el("span", `popover ${className}`.trim());
  const panel = el("div", `popover-panel popover-${align}`);
  panel.hidden = true;
  panel.append(...[].concat(panelContent));
  button.type = "button";
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const wasOpen = openPopover?.panel === panel;
    closeOpenPopover();
    if (wasOpen) return;
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    openPopover = { root, panel, button };
  });
  root.append(button, panel);
  return root;
}

/**
 * ⓘ help: a definition or "why" in one or two sentences, with an optional link to the Method page.
 * Usage: label.append(" ", info("L∞ radius: every input may move by at most ε.", "#/rapid-method"))
 */
export function info(text, href = null, linkText = "More on the Method page") {
  const button = el("button", "info-button", "i");
  button.setAttribute("aria-label", "More information");
  const parts = [el("p", "", text)];
  if (href) {
    const a = el("a", "inline-link", `${linkText} →`);
    a.href = href;
    parts.push(a);
  }
  return popover(button, parts, { className: "info" });
}

/** One short line under a field: only what is needed to fill it in correctly. */
export function hint(text) {
  return el("p", "field-hint", text);
}

/** A coloured dot and a short label. state: idle | ok | busy | warn | error. */
export function statusPill(state, label) {
  const pill = el("span", `status-pill is-${state}`);
  pill.append(el("span", "status-dot"), el("span", "", label));
  return pill;
}

/** A short title, one sentence, and the actions that start the work. */
export function emptyState({ title, text, actions = [] }) {
  const box = el("div", "empty-state");
  if (title) box.append(el("h3", "", title));
  if (text) box.append(el("p", "", text));
  if (actions.length) {
    const row = el("div", "button-row");
    row.append(...actions);
    box.append(row);
  }
  return box;
}

/** A segmented switch: options [{value, label}], one active. */
export function segmented({ options, value, onChange, label }) {
  const group = el("div", "segmented");
  group.setAttribute("role", "radiogroup");
  if (label) group.setAttribute("aria-label", label);
  for (const option of options) {
    const button = el("button", option.value === value ? "is-active" : "", option.label);
    button.type = "button";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(option.value === value));
    button.addEventListener("click", () => {
      if (option.value !== value) onChange(option.value);
    });
    group.append(button);
  }
  return group;
}

/** A button styled as primary (accent) or secondary. */
export function button(text, { primary = false, onClick, disabled = false, title } = {}) {
  const node = el("button", primary ? "run-button" : "secondary-button", text);
  node.type = "button";
  node.disabled = disabled;
  if (title) node.title = title;
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

/** A section heading with optional trailing nodes (ⓘ, links, small actions). */
export function sectionHeading(text, ...extra) {
  const h = el("h3", "section-heading", text);
  for (const node of extra) h.append(" ", node);
  return h;
}

/** Copy text to the clipboard from a button, with brief feedback. */
export function copyButton(getText, label = "Copy") {
  const node = el("button", "secondary-button", label);
  node.type = "button";
  node.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(getText());
      node.textContent = "Copied";
    } catch {
      node.textContent = "Select and copy";
    }
    setTimeout(() => (node.textContent = label), 1500);
  });
  return node;
}
