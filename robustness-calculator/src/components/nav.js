// Tabs grouped by tool: each group is a label followed by its tabs.
export function renderNav(routes, activeRoute) {
  const nav = document.createElement("nav");
  nav.className = "nav-row";

  const groups = new Map();
  for (const [routeKey, route] of Object.entries(routes)) {
    if (!groups.has(route.group)) {
      const group = document.createElement("div");
      group.className = "nav-group";
      const label = document.createElement("span");
      label.className = "nav-group-label";
      label.textContent = route.group;
      group.append(label);
      groups.set(route.group, group);
      nav.append(group);
    }
    const link = document.createElement("a");
    link.href = `#/${routeKey}`;
    link.className = routeKey === activeRoute ? "nav-link is-active" : "nav-link";
    link.textContent = route.label;
    if (routeKey === activeRoute) link.setAttribute("aria-current", "page");
    groups.get(route.group).append(link);
  }

  return nav;
}
