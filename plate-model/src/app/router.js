import { renderNav } from "../components/nav.js";
import { renderBackgroundPage } from "../pages/background-page.js";
import { renderEquationsPage } from "../pages/equations-page.js";
import { renderQuiescentPage } from "../pages/quiescent-page.js";
import { renderGustPage } from "../pages/gust-page.js";
import { renderMath } from "./math.js";

const routes = {
  background: {
    label: "Background",
    render: renderBackgroundPage,
  },
  equations: {
    label: "Equations",
    render: renderEquationsPage,
  },
  quiescent: {
    label: "Quiescent Simulator",
    render: renderQuiescentPage,
  },
  gust: {
    label: "Gust Simulator",
    render: renderGustPage,
  },
};

function resolveRoute() {
  const routeKey = window.location.hash.replace(/^#\/?/, "") || "quiescent";
  return routes[routeKey] ? routeKey : "quiescent";
}

export function createRouter(root, state) {
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

    const fontToggle = document.createElement("label");
    fontToggle.className = "checkbox header-toggle";

    const fontToggleText = document.createElement("span");
    fontToggleText.textContent = "sans serif";

    const fontToggleInput = document.createElement("input");
    fontToggleInput.type = "checkbox";
    fontToggleInput.checked = appState.useSansSerif;
    fontToggleInput.addEventListener("change", () => {
      state.setUseSansSerif(fontToggleInput.checked);
      render();
    });

    fontToggle.append(fontToggleText, fontToggleInput);

    const themeToggle = document.createElement("label");
    themeToggle.className = "checkbox header-toggle";

    const themeToggleText = document.createElement("span");
    themeToggleText.textContent = "dark mode";

    const themeToggleInput = document.createElement("input");
    themeToggleInput.type = "checkbox";
    themeToggleInput.checked = appState.useDarkMode;
    themeToggleInput.addEventListener("change", () => {
      state.setUseDarkMode(themeToggleInput.checked);
      render();
    });

    themeToggle.append(themeToggleText, themeToggleInput);
    toggles.append(fontToggle, themeToggle);
    headerTop.append(toggles);

    const title = document.createElement("h1");
    title.className = "site-title";
    title.textContent = "Freely Falling Plate Simulator";

    const subtitle = document.createElement("p");
    subtitle.className = "site-subtitle";
    subtitle.textContent =
      "A 2D quasi-steady aerodynamic simulator for plates with displaced CoM, implemented in JavaScript.";

    header.append(headerTop, title, subtitle, renderNav(routes, activeRoute));

    const pageRoot = document.createElement("main");
    pageRoot.className = "page-stack";
    pageRoot.append(routes[activeRoute].render({ state, renderMath }));

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
