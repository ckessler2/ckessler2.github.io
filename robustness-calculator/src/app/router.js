import { renderNav } from "../components/nav.js";
import { renderCheckPage } from "../pages/check-page.js";
import { renderMethodPage } from "../pages/method-page.js";
import { renderMath } from "./math.js";

const routes = {
  check: {
    label: "Checker",
    render: renderCheckPage,
  },
  method: {
    label: "Method",
    render: renderMethodPage,
  },
};

function resolveRoute() {
  const routeKey = window.location.hash.replace(/^#\/?/, "") || "check";
  return routes[routeKey] ? routeKey : "check";
}

function createToggle(text, checked, onChange) {
  const label = document.createElement("label");
  label.className = "checkbox header-toggle";
  const span = document.createElement("span");
  span.textContent = text;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  label.append(span, input);
  return label;
}

export function createRouter(root, state, worker) {
  function render() {
    const activeRoute = resolveRoute();
    const appState = state.getState();
    document.body.dataset.fontMode = appState.useSansSerif ? "sans" : "serif";
    document.body.dataset.theme = appState.useDarkMode ? "dark" : "light";
    root.replaceChildren();

    const shell = document.createElement("div");
    shell.className = "site-shell";

    const header = document.createElement("header");
    header.className = "site-header";

    const headerTop = document.createElement("div");
    headerTop.className = "header-top";

    const toggles = document.createElement("div");
    toggles.className = "header-toggle-stack";
    toggles.append(
      createToggle("sans serif", appState.useSansSerif, (v) => {
        state.set("useSansSerif", v);
        render();
      }),
      createToggle("dark mode", appState.useDarkMode, (v) => {
        state.set("useDarkMode", v);
        render();
      }),
    );
    headerTop.append(toggles);

    const titleRow = document.createElement("div");
    titleRow.className = "site-title-row";

    const title = document.createElement("h1");
    title.className = "site-title";
    title.textContent = "Neural Network Robustness Checker";

    const byline = document.createElement("p");
    byline.className = "site-byline";
    byline.append("by Colin Kessler (");
    const homepageLink = document.createElement("a");
    homepageLink.href = "../index.html";
    homepageLink.textContent = "Homepage";
    homepageLink.className = "inline-link";
    byline.append(homepageLink, ")");
    titleRow.append(title, byline);

    header.append(headerTop, titleRow, renderNav(routes, activeRoute));

    const pageRoot = document.createElement("main");
    pageRoot.className = "page-stack";
    pageRoot.append(routes[activeRoute].render({ state, worker, renderMath, rerender: render }));

    shell.append(header, pageRoot);
    root.append(shell);
  }

  return {
    start() {
      window.addEventListener("hashchange", render);
      render();
    },
  };
}
