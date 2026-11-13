// 3D animation of the falling plate, replaying a finished simulation result.
//
// Self-contained: three.js is loaded from a CDN the first time the view is
// opened, and this module owns its own render loop, controls and cleanup.
// The motion is 2D (the x-y plane); the plate is given a nominal span in z
// purely for visualisation.
//
// Usage:
//   const anim = createPlateAnimation();
//   container.append(anim.panel);
//   anim.setResult(result, { e_x });   // after each simulation run
//   anim.setOpen(true / false);        // when the view is shown / hidden

// jsDelivr's +esm builds rewrite the addon's `import "three"` to this same URL,
// so both imports share one copy of three.js without needing an import map.
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/+esm";
const ORBIT_CONTROLS_URL =
  "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js/+esm";

const PLATE_CHORD = 1; // lengths are nondimensionalised by the plate length
const PLATE_SPAN = 2;
const PLATE_THICKNESS = 0.03;
const FOLLOW_OFFSET = [1.5, 1.2, 5]; // camera offset from the plate in follow mode
const SPEED_OPTIONS = [0.5, 1, 2, 5, 10];
const DEFAULT_SPEED = 2;
const SLIDER_RESOLUTION = 1000;

let threePromise = null;

function loadThree() {
  threePromise ??= Promise.all([import(THREE_URL), import(ORBIT_CONTROLS_URL)])
    .then(([THREE, orbit]) => ({ THREE, OrbitControls: orbit.OrbitControls }))
    .catch((error) => {
      threePromise = null; // allow a retry on the next open
      throw error;
    });
  return threePromise;
}

// The page is rebuilt on every route/theme change, so only the newest instance
// is kept alive; creating a new one releases the previous WebGL context.
let activeAnimation = null;

function readThemeColors() {
  const styles = getComputedStyle(document.body);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: read("--plot-bg", "#ffffff"),
    plate: read("--plot-state-2", "#ff7f11"),
    path: read("--plot-trajectory", "#0f5b78"),
    edges: read("--plot-axis", "#17212b"),
    grid: read("--border", "#d8dee8"),
    marker: read("--accent", "#ff6b6b"),
  };
}

// Largest index i with t[i] <= time (t is sorted ascending).
function findSampleIndex(t, time) {
  let low = 0;
  let high = t.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (t[mid] <= time) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

// Linear interpolation of position and angle, since RK45 output is unevenly spaced.
function sampleResult(result, time) {
  const { t, states } = result;
  const i = findSampleIndex(t, time);
  const j = Math.min(i + 1, t.length - 1);
  const span = t[j] - t[i];
  const f = span > 0 ? Math.min(1, Math.max(0, (time - t[i]) / span)) : 0;
  const lerp = (values) => values[i] + (values[j] - values[i]) * f;
  return { x: lerp(states.x), y: lerp(states.y), theta: lerp(states.theta) };
}

function pathBounds(result) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const { x, y } = result.states;
  for (let index = 0; index < x.length; index += 1) {
    if (!Number.isFinite(x[index]) || !Number.isFinite(y[index])) {
      continue;
    }
    minX = Math.min(minX, x[index]);
    maxX = Math.max(maxX, x[index]);
    minY = Math.min(minY, y[index]);
    maxY = Math.max(maxY, y[index]);
  }
  if (!Number.isFinite(minX)) {
    return { centerX: 0, centerY: 0, span: 1 };
  }
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    span: Math.max(maxX - minX, maxY - minY, 1),
  };
}

function createButton(text) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-action-button";
  button.textContent = text;
  return button;
}

export function createPlateAnimation() {
  activeAnimation?.dispose();

  // ---- DOM -----------------------------------------------------------------
  const panel = document.createElement("div");
  panel.className = "plot-section";

  const controlsRow = document.createElement("div");
  controlsRow.className = "toolbar-main";

  const playButton = createButton("Pause");

  const speedLabel = document.createElement("label");
  speedLabel.className = "checkbox checkbox-reversed";
  const speedText = document.createElement("span");
  speedText.textContent = "Speed";
  const speedSelect = document.createElement("select");
  for (const speed of SPEED_OPTIONS) {
    const option = document.createElement("option");
    option.value = String(speed);
    option.textContent = `${speed}×`;
    option.selected = speed === DEFAULT_SPEED;
    speedSelect.append(option);
  }
  speedLabel.append(speedText, speedSelect);

  const followLabel = document.createElement("label");
  followLabel.className = "checkbox checkbox-reversed";
  const followText = document.createElement("span");
  followText.textContent = "Follow plate";
  const followToggle = document.createElement("input");
  followToggle.type = "checkbox";
  followToggle.checked = true;
  followLabel.append(followText, followToggle);

  const timeReadout = document.createElement("span");
  timeReadout.className = "plot-coord-readout";

  controlsRow.append(playButton, speedLabel, followLabel, timeReadout);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(SLIDER_RESOLUTION);
  slider.value = "0";
  slider.style.width = "100%";

  const host = document.createElement("div");
  host.style.width = "100%";
  host.style.touchAction = "none";

  const message = document.createElement("p");
  message.className = "section-note";

  panel.append(controlsRow, slider, host, message);

  // ---- State ---------------------------------------------------------------
  let result = null;
  let e_x = 0;
  let isOpen = false;
  let isPlaying = true;
  let isScrubbing = false;
  let playTime = 0;
  let lastFrameTime = null;
  let rafId = null;
  let disposed = false;
  let initPromise = null;
  let bounds = { centerX: 0, centerY: 0, span: 1 };

  // three.js objects, created lazily in init().
  let THREE = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let plateGroup = null;
  let plateMesh = null;
  let pathLine = null;
  let grid = null;
  let resizeObserver = null;
  const colors = readThemeColors();

  function endTime() {
    return result ? result.t[result.t.length - 1] : 0;
  }

  function updateTimeReadout() {
    timeReadout.textContent = result
      ? `t = ${playTime.toFixed(2)} / ${endTime().toFixed(2)}`
      : "t = -";
  }

  // ---- Scene construction --------------------------------------------------
  function sizeRenderer() {
    if (!renderer) {
      return;
    }
    const width = host.clientWidth;
    if (!width) {
      return; // hidden (closed accordion); the ResizeObserver will retry
    }
    const height = Math.max(260, Math.min(480, Math.round(width * 0.6)));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function disposeObject(object) {
    if (!object) {
      return;
    }
    object.parent?.remove(object);
    object.traverse((child) => {
      child.geometry?.dispose();
      child.material?.dispose();
    });
  }

  function buildPlate() {
    plateGroup = new THREE.Group(); // origin at the centre of mass

    // The geometric centre sits -e_x along the chord from the CoM (matching the
    // `v_yp - omega * e_x` term in the model), so the plate pivots about its CoM.
    plateMesh = new THREE.Mesh(
      new THREE.BoxGeometry(PLATE_CHORD, PLATE_THICKNESS, PLATE_SPAN),
      new THREE.MeshStandardMaterial({ color: colors.plate, roughness: 0.55, metalness: 0.1 }),
    );
    plateMesh.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(plateMesh.geometry),
        new THREE.LineBasicMaterial({ color: colors.edges }),
      ),
    );
    plateGroup.add(plateMesh);

    const comMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 16, 12),
      new THREE.MeshBasicMaterial({ color: colors.marker }),
    );
    comMarker.position.z = PLATE_SPAN / 2 + 0.02;
    plateGroup.add(comMarker);

    scene.add(plateGroup);
  }

  function buildPathObjects() {
    disposeObject(pathLine);
    disposeObject(grid);
    pathLine = null;
    grid = null;
    if (!result) {
      return;
    }

    plateMesh.position.x = -e_x;

    const points = [];
    for (let index = 0; index < result.t.length; index += 1) {
      const x = result.states.x[index];
      const y = result.states.y[index];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        points.push(new THREE.Vector3(x, y, 0));
      }
    }
    pathLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: colors.path }),
    );
    scene.add(pathLine);

    // A 1-unit grid behind the path gives a sense of motion when following.
    bounds = pathBounds(result);
    const gridSize = Math.ceil(bounds.span) + 10;
    grid = new THREE.GridHelper(gridSize, Math.min(gridSize, 200), colors.grid, colors.grid);
    grid.rotation.x = Math.PI / 2; // lie in the x-y plane
    grid.position.set(Math.round(bounds.centerX), Math.round(bounds.centerY), -PLATE_SPAN);
    scene.add(grid);

    resetCamera();
  }

  function resetCamera() {
    if (!camera || !result) {
      return;
    }
    if (followToggle.checked) {
      const { x, y } = sampleResult(result, playTime);
      controls.target.set(x, y, 0);
      camera.position.set(x + FOLLOW_OFFSET[0], y + FOLLOW_OFFSET[1], FOLLOW_OFFSET[2]);
    } else {
      // Fit the whole path in view.
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const distance = (bounds.span / 2 / Math.tan(halfFov)) * 1.2 + PLATE_SPAN;
      controls.target.set(bounds.centerX, bounds.centerY, 0);
      camera.position.set(bounds.centerX, bounds.centerY, distance);
    }
    camera.far = Math.max(1000, bounds.span * 10);
    camera.updateProjectionMatrix();
    controls.update();
  }

  async function init() {
    message.textContent = "Loading three.js…";
    let lib;
    try {
      lib = await loadThree();
    } catch (_error) {
      message.textContent = "Could not load three.js (are you offline?). Reopen to retry.";
      initPromise = null;
      return;
    }
    if (disposed) {
      return;
    }
    message.textContent = "";
    THREE = lib.THREE;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.append(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(colors.background);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 5, 8);
    scene.add(sun);

    camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1000);
    controls = new lib.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    buildPlate();
    buildPathObjects();

    resizeObserver = new ResizeObserver(sizeRenderer);
    resizeObserver.observe(host);
    sizeRenderer();
  }

  // ---- Animation loop ------------------------------------------------------
  function renderFrame(now) {
    rafId = null;
    if (disposed || !isOpen) {
      return;
    }
    if (!panel.isConnected) {
      dispose(); // the page was rebuilt without us
      return;
    }
    rafId = window.requestAnimationFrame(renderFrame);

    if (!renderer || !result) {
      return;
    }

    const elapsed = lastFrameTime == null ? 0 : Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    if (isPlaying && !isScrubbing) {
      playTime += elapsed * Number(speedSelect.value);
      if (playTime > endTime()) {
        playTime = 0; // loop
      }
      slider.value = String(Math.round((playTime / (endTime() || 1)) * SLIDER_RESOLUTION));
    }

    const { x, y, theta } = sampleResult(result, playTime);
    plateGroup.position.set(x, y, 0);
    plateGroup.rotation.z = theta; // body x' axis is at angle theta from lab x

    if (followToggle.checked) {
      // Translate camera and target together, so user orbiting is preserved.
      const dx = x - controls.target.x;
      const dy = y - controls.target.y;
      controls.target.x += dx;
      controls.target.y += dy;
      camera.position.x += dx;
      camera.position.y += dy;
    }

    controls.update();
    renderer.render(scene, camera);
    updateTimeReadout();
  }

  function startLoop() {
    if (rafId == null && isOpen && !disposed) {
      lastFrameTime = null;
      rafId = window.requestAnimationFrame(renderFrame);
    }
  }

  function stopLoop() {
    if (rafId != null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // ---- Control events ------------------------------------------------------
  playButton.addEventListener("click", () => {
    isPlaying = !isPlaying;
    playButton.textContent = isPlaying ? "Pause" : "Play";
  });

  slider.addEventListener("input", () => {
    isScrubbing = true;
    playTime = (Number(slider.value) / SLIDER_RESOLUTION) * endTime();
  });
  slider.addEventListener("change", () => {
    isScrubbing = false;
  });

  followToggle.addEventListener("change", resetCamera);

  // ---- Public API ----------------------------------------------------------
  function setResult(nextResult, { e_x: nextEx = 0 } = {}) {
    result = nextResult ?? null;
    e_x = Number(nextEx) || 0;
    playTime = 0;
    slider.value = "0";
    updateTimeReadout();
    if (renderer) {
      buildPathObjects();
    }
  }

  function setOpen(open) {
    isOpen = Boolean(open);
    if (!isOpen) {
      stopLoop();
      return;
    }
    initPromise ??= init();
    initPromise.then(() => {
      if (renderer) {
        sizeRenderer();
        startLoop();
      }
    });
  }

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    stopLoop();
    resizeObserver?.disconnect();
    controls?.dispose();
    if (scene) {
      disposeObject(pathLine);
      disposeObject(grid);
      disposeObject(plateGroup);
    }
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
    if (activeAnimation === api) {
      activeAnimation = null;
    }
  }

  updateTimeReadout();

  const api = { panel, setResult, setOpen, dispose };
  activeAnimation = api;
  return api;
}
