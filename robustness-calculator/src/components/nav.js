// Two-level navigation: a switch between the tools, then the current tool's sub-tabs.

function groupsOf(routes) {
  const groups = new Map(); // group -> [[key, route], …] in order
  for (const [key, route] of Object.entries(routes)) {
    if (!groups.has(route.group)) groups.set(route.group, []);
    groups.get(route.group).push([key, route]);
  }
  return groups;
}

function link(href, text, className, current) {
  const a = document.createElement("a");
  a.href = href;
  a.className = current ? `${className} is-active` : className;
  a.textContent = text;
  if (current) a.setAttribute("aria-current", "page");
  return a;
}

/** Estimate | Verify: each opens its tool's first tab. */
export function renderToolSwitch(routes, activeRoute) {
  const nav = document.createElement("nav");
  nav.className = "tool-switch segmented";
  nav.setAttribute("aria-label", "Tool");
  const active = routes[activeRoute].group;
  for (const [group, entries] of groupsOf(routes)) {
    nav.append(link(`#/${entries[0][0]}`, group, "tool-link", group === active));
  }
  return nav;
}

/** The current tool's tabs (Run · Method · …). */
export function renderSubtabs(routes, activeRoute) {
  const nav = document.createElement("nav");
  nav.className = "subtabs";
  nav.setAttribute("aria-label", "Page");
  const entries = groupsOf(routes).get(routes[activeRoute].group);
  for (const [key, route] of entries) {
    nav.append(link(`#/${key}`, route.label, "subtab", key === activeRoute));
  }
  return nav;
}
