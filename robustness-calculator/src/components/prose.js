// Small helpers for text pages (Method, Results).

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function para(...parts) {
  const p = el("p");
  for (const part of parts) {
    if (typeof part === "string") p.append(part);
    else p.append(part);
  }
  return p;
}

export function code(text) {
  return el("code", "", text);
}

export function link(href, text) {
  const a = el("a", "inline-link", text);
  a.href = href;
  return a;
}

export function list(items) {
  const ul = el("ul", "bullet-list");
  for (const item of items) {
    const li = el("li");
    if (Array.isArray(item)) li.append(...item);
    else li.append(item);
    ul.append(li);
  }
  return ul;
}
