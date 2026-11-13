import { createAppState } from "./state.js";
import { createRouter } from "./router.js";
import { createWorkerClient } from "./worker-client.js";

const appRoot = document.getElementById("app");

const state = createAppState({
  useSansSerif: true,
  useDarkMode: false,
  accordionState: {},
  mode: "vnnlib",
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
    restarts: 100,
    steps: 100,
    alpha: "",
    backend: "cpu",
    selfTestSamples: 100,
  },
  run: { status: "idle", result: null, error: null, progress: null },
});

const worker = createWorkerClient();
const router = createRouter(appRoot, state, worker);
router.start();
