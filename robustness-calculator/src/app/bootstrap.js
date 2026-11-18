import { createAppState } from "./state.js";
import { createRouter } from "./router.js";
import { createWorkerClient } from "./worker-client.js";
import { ATTACK_DEFAULTS } from "../attack/defaults.js";

const appRoot = document.getElementById("app");

// Display settings are remembered per browser; the first visit follows the system theme.
function savedDisplay() {
  try {
    return JSON.parse(localStorage.getItem("easynnv-display") ?? "null");
  } catch {
    return null;
  }
}
const display = savedDisplay();
const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

const state = createAppState({
  useSansSerif: display?.useSansSerif ?? true,
  useDarkMode: display?.useDarkMode ?? prefersDark,
  accordionState: {},
  mode: "points",
  benchmarkId: "cora-mnist-set",
  model: null, // { fileName, bytes, summary, error, loading }
  vnnlib: null, // { fileName, text, summary, error }
  points: null, // { fileName, text, rows, error }
  pointsSettings: {
    task: "classification",
    epsilon: 0.01,
    delta: 0.1,
    lipschitz: 1,
    domainLoText: "",
    domainHiText: "",
    searchEpsilon: false,
    searchIterations: 8,
  },
  attack: {
    seed: 0,
    ...ATTACK_DEFAULTS.points,
    alpha: "",
    schedule: "apgd",
    certify: true,
    backend: "webgl",
  },
  run: { status: "idle", result: null, error: null, progress: null },
  // Estimate Run page view state.
  rapid: {
    source: "benchmark", // "benchmark" | "files"
    loadedBenchmark: null, // id of the benchmark whose files are loaded, if any
    domainDefault: { lo: "", hi: "" }, // input range the loaded benchmark comes with
    tab: "summary", // result view: "summary" | "points" | "repro"
    filter: "all", // per-point filter
  },
});

const worker = createWorkerClient();
const router = createRouter(appRoot, state, worker);
router.start();
