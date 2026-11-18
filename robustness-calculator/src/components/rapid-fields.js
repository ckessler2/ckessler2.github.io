// Compact form rows for the rapidNNV Run page: a short label (with optional ⓘ),
// the control, and at most one hint line. Styles: css/rapid.css (.rf-*).

import { el, popover } from "./ui.js";

/** ⓘ popover; align "end" for icons near the right edge (keeps the panel on screen). */
export function infoTip(text, { href = null, linkText = "More on the Method page", align = "start" } = {}) {
  const button = el("button", "info-button", "i");
  button.setAttribute("aria-label", "More information");
  const parts = [].concat(text).map((t) => (typeof t === "string" ? el("p", "", t) : t));
  if (href) {
    const a = el("a", "inline-link", `${linkText} →`);
    a.href = href;
    parts.push(a);
  }
  return popover(button, parts, { className: "info", align });
}

let nextId = 1;

/**
 * One labelled row. `control` is an element (or array of elements); `stacked`
 * puts the control under the label instead of beside it.
 */
export function fieldRow({ label, info = null, hint = null, control, stacked = false, className = "" }) {
  const row = el("div", `rf-field ${stacked ? "rf-stacked" : ""} ${className}`.trim());
  const head = el("div", "rf-label");
  const controls = [].concat(control);
  const first = controls.find((c) => c && /^(INPUT|SELECT|TEXTAREA)$/.test(c.tagName));
  const labelNode = el("label", "", label);
  if (first) {
    if (!first.id) first.id = `rf-${nextId++}`;
    labelNode.htmlFor = first.id;
  }
  head.append(labelNode);
  if (info) head.append(" ", info);
  const body = el("div", "rf-control");
  body.append(...controls.filter(Boolean));
  const hintNode = hint ? el("p", "field-hint rf-hint", hint) : null;
  // Stacked rows read label → hint → control; side-by-side rows put the hint underneath.
  if (stacked) row.append(...[head, hintNode, body].filter(Boolean));
  else row.append(...[head, body, hintNode].filter(Boolean));
  return row;
}

/** Number input; onChange gets a number, or "" when blank. */
export function numberInput({ value, onChange, integer = false, min, placeholder, name }) {
  const input = document.createElement("input");
  input.type = "number";
  input.step = "any";
  input.value = value === "" || value === undefined || value === null ? "" : String(value);
  if (name) input.name = name;
  if (placeholder) input.placeholder = placeholder;
  if (min !== undefined) input.min = String(min);
  input.addEventListener("change", () => {
    const raw = input.value.trim();
    onChange(raw === "" ? "" : integer ? Math.trunc(Number(raw)) : Number(raw));
  });
  return input;
}

export function textInput({ value, onChange, placeholder, name, ariaLabel }) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value ?? "";
  if (name) input.name = name;
  if (placeholder) input.placeholder = placeholder;
  if (ariaLabel) input.setAttribute("aria-label", ariaLabel);
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

/** options: [{ value, label }] or [{ group, options: [...] }]; placeholder adds a disabled first option. */
export function selectInput({ value, options, onChange, name, placeholder }) {
  const select = document.createElement("select");
  if (name) select.name = name;
  const add = (parent, o) => {
    const opt = el("option", "", o.label);
    opt.value = o.value;
    opt.selected = o.value === value;
    parent.append(opt);
  };
  if (placeholder) {
    const opt = el("option", "", placeholder);
    opt.value = "";
    opt.disabled = true;
    opt.selected = !options.some((o) => (o.options ?? [o]).some((x) => x.value === value));
    select.append(opt);
  }
  for (const o of options) {
    if (o.group) {
      const g = document.createElement("optgroup");
      g.label = o.group;
      o.options.forEach((x) => add(g, x));
      select.append(g);
    } else add(select, o);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

/** Checkbox with a label and optional ⓘ. */
export function checkRow({ label, checked, onChange, info = null }) {
  const row = el("div", "rf-check");
  const lab = el("label", "checkbox");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = Boolean(checked);
  box.addEventListener("change", () => onChange(box.checked));
  lab.append(box, " ", label);
  row.append(lab);
  if (info) row.append(" ", info);
  return row;
}

/** A file picker as a quiet button, with the chosen/loaded file named beside it. */
export function filePicker({ accept, multiple = false, buttonText, onFiles, ariaLabel }) {
  const wrap = el("span", "rf-file");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.multiple = multiple;
  input.className = "rf-file-input";
  input.setAttribute("aria-label", ariaLabel ?? buttonText);
  input.addEventListener("change", async () => {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length) await onFiles(files);
  });
  const btn = el("button", "secondary-button rf-file-button", buttonText);
  btn.type = "button";
  btn.addEventListener("click", () => input.click());
  wrap.append(input, btn);
  return wrap;
}

/** A one-line status: coloured dot + text. state: ok | busy | warn | error | idle. */
export function statusLine(state, text) {
  const line = el("p", `rf-status is-${state}`);
  line.append(el("span", "status-dot"), el("span", "rf-status-text", text));
  return line;
}

/** Small uppercase subhead inside a section. */
export function subhead(text) {
  return el("h4", "rf-subhead", text);
}
