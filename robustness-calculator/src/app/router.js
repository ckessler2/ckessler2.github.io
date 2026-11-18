import { renderToolSwitch, renderSubtabs } from "../components/nav.js";
import { el, popover } from "../components/ui.js";
import { renderCheckPage } from "../pages/check-page.js";
import { renderMethodPage } from "../pages/method-page.js";
import { renderResultsPage } from "../pages/results-page.js";
import { renderVehiclePage } from "../pages/vehicle-page.js";
import { renderVehicleMethodPage } from "../pages/vehicle-method-page.js";
import { renderMath } from "./math.js";

// Tabs, in nav order, grouped by tool. The group is shown as a label in the nav.
const routes = {
  rapid: { group: "rapidNNV", label: "Run", render: renderCheckPage },
  "rapid-method": { group: "rapidNNV", label: "Method", render: renderMethodPage },
  "rapid-results": { group: "rapidNNV", label: "Results", render: renderResultsPage },
  vehicle: { group: "VehicleWrapper", label: "Run", render: renderVehiclePage },
  "vehicle-method": { group: "VehicleWrapper", label: "Method", render: renderVehicleMethodPage },
};

// Earlier tab names, so old links keep working.
const aliases = { check: "rapid", method: "rapid-method", results: "rapid-results" };

function resolveRoute() {
  const key = window.location.hash.replace(/^#\/?/, "") || "rapid";
  const routeKey = aliases[key] ?? key;
  return routes[routeKey] ? routeKey : "rapid";
}

function settingsMenu(appState, state, render) {
  const option = (text, checked, onChange) => {
    const label = el("label", "menu-check");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    label.append(input, " ", text);
    return label;
  };
  const button = el("button", "icon-button", "⚙");
  button.setAttribute("aria-label", "Display settings");
  button.title = "Display settings";
  return popover(
    button,
    [
      option("Dark mode", appState.useDarkMode, (v) => {
        state.set("useDarkMode", v);
        render();
      }),
      option("Serif font", !appState.useSansSerif, (v) => {
        state.set("useSansSerif", !v);
        render();
      }),
    ],
    { className: "settings-menu", align: "end" },
  );
}

function footer() {
  const node = el("footer", "site-footer");
  const home = el("a", "inline-link", "Homepage");
  home.href = "../index.html";
  node.append("easyNNV: neural network verification from your browser · by Colin Kessler (", home, ")");
  return node;
}

export function createRouter(root, state, worker) {
  function render() {
    const activeRoute = resolveRoute();
    const appState = state.getState();
    document.body.dataset.fontMode = appState.useSansSerif ? "sans" : "serif";
    document.body.dataset.theme = appState.useDarkMode ? "dark" : "light";
    root.replaceChildren();

    const shell = el("div", "site-shell");
    const header = el("header", "site-header");
    const bar = el("div", "header-bar");
    const title = el("a", "site-title", "easyNNV");
    title.href = "#/rapid";
    bar.append(title, renderToolSwitch(routes, activeRoute), el("span", "header-spacer"), settingsMenu(appState, state, render));
    header.append(bar, renderSubtabs(routes, activeRoute));

    const pageRoot = document.createElement("main");
    pageRoot.className = "page-stack";
    pageRoot.append(routes[activeRoute].render({ state, worker, renderMath, rerender: render }));

    shell.append(header, pageRoot, footer());
    root.append(shell);
  }

  return {
    start() {
      window.addEventListener("hashchange", render);
      render();
    },
  };
}
