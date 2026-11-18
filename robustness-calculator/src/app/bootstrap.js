import { createAppState } from "./state.js";
import { createRouter } from "./router.js";
import { createWorkerClient } from "./worker-client.js";
import { ATTACK_DEFAULTS } from "../attack/defaults.js";

const appRoot = document.getElementById("app");

const state = createAppState({
  useSansSerif: true,
  useDarkMode: false,
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
  // rapidNNV Run page view state.
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
