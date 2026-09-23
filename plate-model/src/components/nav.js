export function renderNav(routes, activeRoute) {
  const nav = document.createElement("nav");
  nav.className = "nav-row";

  for (const [routeKey, route] of Object.entries(routes)) {
    const link = document.createElement("a");
    link.href = `#/${routeKey}`;
    link.className = routeKey === activeRoute ? "nav-link is-active" : "nav-link";
    link.textContent = route.label;
    nav.append(link);
  }

  return nav;
}
