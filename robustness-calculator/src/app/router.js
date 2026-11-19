import { renderToolSwitch, renderSubtabs } from "../components/nav.js";
import { el } from "../components/ui.js";
import { renderCheckPage } from "../pages/check-page.js";
import { renderMethodPage } from "../pages/method-page.js";
import { renderResultsPage } from "../pages/results-page.js";
import { renderVehiclePage } from "../pages/vehicle-page.js";
import { renderVehicleMethodPage } from "../pages/vehicle-method-page.js";
import { renderMath } from "./math.js";

// Tabs, in nav order, grouped by tool. The group is shown as a label in the nav.
const routes = {
  estimate: { group: "Estimate", label: "Run", render: renderCheckPage },
  "estimate-method": { group: "Estimate", label: "Method", render: renderMethodPage },
  "estimate-results": { group: "Estimate", label: "Results", render: renderResultsPage },
  verify: { group: "Verify", label: "Run", render: renderVehiclePage },
  "verify-method": { group: "Verify", label: "Method", render: renderVehicleMethodPage },
};

// Earlier tab names, so old links keep working.
const aliases = {
  check: "estimate",
  method: "estimate-method",
  results: "estimate-results",
  rapid: "estimate",
  "rapid-method": "estimate-method",
  "rapid-results": "estimate-results",
  vehicle: "verify",
  "vehicle-method": "verify-method",
};

function resolveRoute() {
  const key = window.location.hash.replace(/^#\/?/, "") || "estimate";
  const routeKey = aliases[key] ?? key;
  return routes[routeKey] ? routeKey : "estimate";
}

function displayToggles(appState, state, render) {
  const toggle = (text, checked, onChange) => {
    const label = el("label", "header-check");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    label.append(input, " ", text);
    return label;
  };
  const box = el("div", "header-checks");
  box.append(
    toggle("Sans serif", appState.useSansSerif, (v) => {
      state.set("useSansSerif", v);
      render();
    }),
    toggle("Dark mode", appState.useDarkMode, (v) => {
      state.set("useDarkMode", v);
      render();
    }),
  );
  return box;
}

const REPO = "https://github.com/ckessler2/ckessler2.github.io";

function footer() {
  const node = el("footer", "site-footer");
  const link = (text, href) => {
    const a = el("a", "inline-link", text);
    a.href = href;
    return a;
  };
  node.append(
    "easyNNV: neural network verification from your browser · by Colin Kessler (",
    link("Homepage", "https://ckessler2.github.io/"),
    ") · ",
    link("Source", `${REPO}/tree/main/robustness-calculator`),
    " · ",
    link("Issues", `${REPO}/issues`),
    " · ",
    link("Cite", `${REPO}/blob/main/robustness-calculator/CITATION.cff`),
    " · ",
    link("MIT licence", `${REPO}/blob/main/robustness-calculator/LICENSE`),
  );
  return node;
}

export function createRouter(root, state, worker) {
  function render() {
    const activeRoute = resolveRoute();
    const appState = state.getState();
    document.body.dataset.fontMode = appState.useSansSerif ? "sans" : "serif";
    document.body.dataset.theme = appState.useDarkMode ? "dark" : "light";
    try {
      localStorage.setItem(
        "easynnv-display",
        JSON.stringify({ useDarkMode: appState.useDarkMode, useSansSerif: appState.useSansSerif }),
      );
    } catch {
      /* storage unavailable: the settings last for this visit */
    }
    root.replaceChildren();
    document.title = `${routes[activeRoute].label} · ${routes[activeRoute].group} · easyNNV`;

    const shell = el("div", "site-shell");
    const header = el("header", "site-header");
    const bar = el("div", "header-bar");
    const title = el("a", "site-title", "easyNNV");
    title.href = "#/estimate";
    bar.append(title, renderToolSwitch(routes, activeRoute), el("span", "header-spacer"), displayToggles(appState, state, render));
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
