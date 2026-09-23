import { createAppState } from "./state.js";
import { createRouter } from "./router.js";
import { createDefaultConfig } from "../simulation/defaults.js";

const appRoot = document.getElementById("app");

const state = createAppState({
  config: createDefaultConfig(),
  quiescentResult: null,
  useSansSerif: true,
  useDarkMode: false,
  accordionState: {},
});

const router = createRouter(appRoot, state);
router.start();
