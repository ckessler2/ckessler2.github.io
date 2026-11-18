// Two levels on one line: a tab per tool, and after the active tool its own sub-tabs.
// Clicking a tool opens its first sub-tab (Run) and hides the other tool's sub-tabs.
export function renderNav(routes, activeRoute) {
  const nav = document.createElement("nav");
  nav.className = "nav-row";
  const activeGroup = routes[activeRoute].group;

  const link = (href, text, className, current) => {
    const a = document.createElement("a");
    a.href = href;
    a.className = current ? `${className} is-active` : className;
    a.textContent = text;
    if (current) a.setAttribute("aria-current", "page");
    return a;
  };

  const groups = new Map(); // group -> its routes, in order
  for (const [key, route] of Object.entries(routes)) {
    if (!groups.has(route.group)) groups.set(route.group, []);
    groups.get(route.group).push([key, route]);
  }

  for (const [group, entries] of groups) {
    const isActive = group === activeGroup;
    nav.append(link(`#/${entries[0][0]}`, group, "nav-link nav-tool", isActive));
    if (!isActive) continue;
    const subtabs = document.createElement("div");
    subtabs.className = "nav-subtabs";
    for (const [key, route] of entries) {
      subtabs.append(link(`#/${key}`, route.label, "nav-sublink", key === activeRoute));
    }
    nav.append(subtabs);
  }
  return nav;
}
