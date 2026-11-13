import { nondimFreelyFallingPlate } from "../simulation/nondim-falling-plate-quiescent.js";

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
//   anim.setResult(result, { e_x, config });   // after each simulation run
//   anim.setOpen(true / false);        // when the view is shown / hidden

// jsDelivr's +esm builds rewrite each addon's `import "three"` to this same
// URL, so everything shares one copy of three.js without an import map.
const THREE_VERSION = "0.160.0";
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;

// ---- Defaults worth tuning -----------------------------------------------------
// Camera defaults per view. These use the same units as the on-screen camera
// readout, so a view you like can be copied straight in here.
//   azimuth: degrees around the vertical (lab y) axis, 0 = looking along -z
//   zenith:  degrees down from straight above, 90 = level with the plate
//   zoom:    1 = the base framing (5.4 chords away when following,
//            whole path fitted when fixed)
const DEFAULT_CAMERAS = {
  follow: { azimuth: 0, zenith: 65, zoom: 0.2 },
  fixed: { azimuth: 0, zenith: 65, zoom: 1.1 },
};
const FOLLOW_BASE_DISTANCE = 5.4; // chords

const PLATE_CHORD = 1; // lengths are nondimensionalised by the plate length
const PLATE_SPAN = 2;
const PLATE_THICKNESS = 0.003;
const FIELD_OF_VIEW = 45;
const SPEED_OPTIONS = [0.5, 1, 2, 5, 10];
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_SLIDER_STEPS = 100; // slider runs -100..100, i.e. 10^-1 .. 10^1
const TIME_SLIDER_RESOLUTION = 1000;
const FORCE_ARROW_SCALE = 1.4;
const ACCEL_ARROW_SCALE = 3.2;
const MIN_ARROW_LENGTH = 0.2;
const MAX_ARROW_LENGTH = 2.6;
const COM_ICON_SIZE = 0.16;
const SIDE_ON_AZIMUTH = 0;
const SIDE_ON_ZENITH = 90;

const VIEW_MODES = {
  follow: ["follow"],
  fixed: ["fixed"],
  both: ["follow", "fixed"],
};
const VIEW_NAMES = { follow: "Follow", fixed: "Fixed" };

// View settings live at module level so they survive the page being rebuilt
// (route changes, theme toggles) and new simulation runs.
// These initial values are the defaults on page load.
// Colours set to null mean "use the theme colour".
const settings = {
  viewMode: "both", // "follow" | "fixed" | "both"
  speed: 5, // one of SPEED_OPTIONS
  projection: "orthographic", // "perspective" | "orthographic"
  cameras: structuredClone(DEFAULT_CAMERAS),
  lockSideOn2D: false,
  showCameraInfo: false,
  showComMarker: true,
  showForceArrow: false,
  showAccelerationArrow: false,
  lineStyle: "dashed", // "solid" | "dashed" | "hidden"
  plateColor: null,
  plateOpacity: 0.5,
  lineColor: "#000000",
  lineWidth: 1, // CSS px
  showGrid: false,
  background: "#ffffff",
  panelOpen: false,
};

let libPromise = null;

function loadThree() {
  libPromise ??= Promise.all([
    import(`${CDN}/+esm`),
    import(`${CDN}/examples/jsm/controls/OrbitControls.js/+esm`),
    import(`${CDN}/examples/jsm/lines/Line2.js/+esm`),
    import(`${CDN}/examples/jsm/lines/LineMaterial.js/+esm`),
    import(`${CDN}/examples/jsm/lines/LineGeometry.js/+esm`),
  ])
    .then(([THREE, orbit, line2, lineMaterial, lineGeometry]) => ({
      THREE,
      OrbitControls: orbit.OrbitControls,
      Line2: line2.Line2,
      LineMaterial: lineMaterial.LineMaterial,
      LineGeometry: lineGeometry.LineGeometry,
    }))
    .catch((error) => {
      libPromise = null; // allow a retry on the next open
      throw error;
    });
  return libPromise;
}

// Only the newest instance is kept alive; creating a new one releases the
// previous WebGL context.
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

// <input type="color"> only accepts #rrggbb.
function toHexColor(color, fallback = "#ffffff") {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return color;
  }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : fallback;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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
  const f = span > 0 ? clamp((time - t[i]) / span, 0, 1) : 0;
  const lerp = (values) => values[i] + (values[j] - values[i]) * f;
  return {
    x: lerp(states.x),
    y: lerp(states.y),
    theta: lerp(states.theta),
    v_xp: lerp(states.v_xp),
    v_yp: lerp(states.v_yp),
    omega: lerp(states.omega),
  };
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

function rotateBodyToWorld(vectorX, vectorY, theta) {
  return {
    x: vectorX * Math.cos(theta) - vectorY * Math.sin(theta),
    y: vectorX * Math.sin(theta) + vectorY * Math.cos(theta),
  };
}

// ---- Small DOM helpers -----------------------------------------------------------
function createButton(text) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-action-button";
  button.textContent = text;
  return button;
}

// .field gives inputs a text-box border and padding, which suits selects but
// not checkboxes, sliders or colour swatches.
function unboxInput(input) {
  Object.assign(input.style, { padding: "0", border: "0", background: "transparent" });
  return input;
}

function createSelect(id, options, value) {
  const select = document.createElement("select");
  select.id = id;
  for (const [optionValue, label] of options) {
    const option = document.createElement("option");
    option.value = String(optionValue);
    option.textContent = label;
    option.selected = String(optionValue) === String(value);
    select.append(option);
  }
  return select;
}

function createCheckbox(id, checked) {
  const input = unboxInput(document.createElement("input"));
  input.type = "checkbox";
  input.id = id;
  input.checked = checked;
  input.style.width = "auto";
  input.style.justifySelf = "start";
  return input;
}

function createInlineGroup(...children) {
  const group = document.createElement("div");
  Object.assign(group.style, {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    gridColumn: "2",
    minWidth: "0",
  });
  group.append(...children);
  return group;
}

// A slider with its current value printed beside it.
function createRange(id, { min, max, step }) {
  const input = unboxInput(document.createElement("input"));
  input.type = "range";
  input.id = id;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.style.flex = "1";
  const valueText = document.createElement("span");
  Object.assign(valueText.style, {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-small)",
    minWidth: "4.2em",
    textAlign: "right",
  });
  return { input, valueText, control: createInlineGroup(input, valueText) };
}

// A colour picker with a "Theme" button that returns to the theme colour.
function createColorPicker(id) {
  const input = unboxInput(document.createElement("input"));
  input.type = "color";
  input.id = id;
  input.style.height = "32px";
  const reset = createButton("Theme");
  reset.style.minWidth = "0";
  reset.title = "Reset to the theme colour";
  return { input, reset, control: createInlineGroup(input, reset) };
}

// One "label | control" row, reusing the form's .field grid styling.
function createSettingRow(labelText, control, forId = control.id) {
  const row = document.createElement("div");
  row.className = "field";
  row.style.gridTemplateColumns = "minmax(0, 1fr) minmax(150px, 200px)";
  const label = document.createElement("label");
  label.className = "field-label";
  label.textContent = labelText;
  if (forId) {
    label.htmlFor = forId;
  }
  row.append(label, control);
  return row;
}

function createSettingHeading(text) {
  const heading = document.createElement("p");
  heading.className = "kicker";
  heading.textContent = text;
  heading.style.marginTop = "6px";
  return heading;
}

export function createPlateAnimation() {
  activeAnimation?.dispose();
  const colors = readThemeColors();

  // ---- Toolbar: play/pause and timer on the left, settings on the right --------
  const panel = document.createElement("div");
  panel.className = "plot-section";

  const toolbar = document.createElement("div");
  toolbar.className = "toolbar-main";
  toolbar.style.marginBottom = "8px";

  const playButton = createButton("Pause");

  const timeReadout = document.createElement("span");
  timeReadout.className = "status";
  timeReadout.style.fontFamily = "var(--font-mono)";

  const settingsButton = createButton("Settings");
  settingsButton.style.marginLeft = "auto";

  toolbar.append(playButton, timeReadout, settingsButton);

  const timeSlider = document.createElement("input");
  timeSlider.type = "range";
  timeSlider.min = "0";
  timeSlider.max = String(TIME_SLIDER_RESOLUTION);
  timeSlider.value = "0";
  timeSlider.style.width = "100%";
  timeSlider.setAttribute("aria-label", "Animation time");

  // ---- Viewport: canvas, per-view mouse layers, and the settings overlay -------
  const viewport = document.createElement("div");
  Object.assign(viewport.style, { position: "relative", width: "100%", minHeight: "260px" });

  const message = document.createElement("p");
  message.className = "section-note";

  // ---- Settings overlay ----------------------------------------------------------
  const settingsPanel = document.createElement("div");
  Object.assign(settingsPanel.style, {
    position: "absolute",
    top: "8px",
    right: "8px",
    zIndex: "3",
    width: "min(360px, calc(100% - 16px))",
    maxHeight: "calc(100% - 16px)",
    overflowY: "auto",
    display: "grid",
    gap: "8px",
    padding: "12px",
    background: "var(--panel)",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow)",
  });

  const viewModeInput = createSelect(
    "anim-view-mode",
    [
      ["follow", "Follow plate"],
      ["fixed", "Fixed (whole path)"],
      ["both", "Both, side by side"],
    ],
    settings.viewMode,
  );
  const speedInput = createSelect(
    "anim-speed",
    SPEED_OPTIONS.map((speed) => [speed, `${speed}×`]),
    settings.speed,
  );
  const projectionInput = createSelect(
    "anim-projection",
    [
      ["perspective", "Perspective"],
      ["orthographic", "Orthographic"],
    ],
    settings.projection,
  );
  const zoomRanges = {
    follow: createRange("anim-zoom-follow", {
      min: -ZOOM_SLIDER_STEPS,
      max: ZOOM_SLIDER_STEPS,
      step: 1,
    }),
    fixed: createRange("anim-zoom-fixed", {
      min: -ZOOM_SLIDER_STEPS,
      max: ZOOM_SLIDER_STEPS,
      step: 1,
    }),
  };
  const cameraInfoInput = createCheckbox("anim-camera-info", settings.showCameraInfo);
  const resetCameraButton = createButton("Reset camera");
  resetCameraButton.id = "anim-reset-camera";
  resetCameraButton.style.minWidth = "0";
  const sideOn2DInput = createCheckbox("anim-side-on-2d", settings.lockSideOn2D);
  const comMarkerInput = createCheckbox("anim-com-marker", settings.showComMarker);
  const forceArrowInput = createCheckbox("anim-force-arrow", settings.showForceArrow);
  const accelerationArrowInput = createCheckbox(
    "anim-acceleration-arrow",
    settings.showAccelerationArrow,
  );

  const lineStyleInput = createSelect(
    "anim-line-style",
    [
      ["solid", "Solid"],
      ["dashed", "Dashed"],
      ["hidden", "Hidden"],
    ],
    settings.lineStyle,
  );
  const plateColorPicker = createColorPicker("anim-plate-color");
  const plateOpacityRange = createRange("anim-plate-opacity", { min: 0, max: 1, step: 0.05 });
  plateOpacityRange.input.value = String(settings.plateOpacity);
  const lineColorPicker = createColorPicker("anim-line-color");
  const lineWidthRange = createRange("anim-line-width", { min: 0.5, max: 8, step: 0.5 });
  lineWidthRange.input.value = String(settings.lineWidth);
  const gridInput = createCheckbox("anim-grid", settings.showGrid);
  const backgroundPicker = createColorPicker("anim-background");

  settingsPanel.append(
    createSettingHeading("Playback"),
    createSettingRow("View", viewModeInput),
    createSettingRow("Speed", speedInput),
    createSettingHeading("Camera"),
    createSettingRow("Projection", projectionInput),
    createSettingRow("Zoom (follow)", zoomRanges.follow.control, zoomRanges.follow.input.id),
    createSettingRow("Zoom (fixed)", zoomRanges.fixed.control, zoomRanges.fixed.input.id),
    createSettingRow("Show camera info", cameraInfoInput),
    createSettingRow("", resetCameraButton, null),
    createSettingRow("2D side-on lock (az 0°, zen 90°)", sideOn2DInput),
    createSettingHeading("Overlays"),
    createSettingRow("Show CoM icon", comMarkerInput),
    createSettingRow("Show force arrow", forceArrowInput),
    createSettingRow("Show acceleration arrow", accelerationArrowInput),
    createSettingHeading("Plate"),
    createSettingRow("Colour", plateColorPicker.control, plateColorPicker.input.id),
    createSettingRow("Opacity", plateOpacityRange.control, plateOpacityRange.input.id),
    createSettingHeading("Trajectory line"),
    createSettingRow("Style", lineStyleInput),
    createSettingRow("Colour", lineColorPicker.control, lineColorPicker.input.id),
    createSettingRow("Width", lineWidthRange.control, lineWidthRange.input.id),
    createSettingHeading("Scene"),
    createSettingRow("Show grid", gridInput),
    createSettingRow("Background", backgroundPicker.control, backgroundPicker.input.id),
  );

  viewport.append(settingsPanel);
  panel.append(toolbar, timeSlider, viewport, message);

  // ---- State -----------------------------------------------------------------------
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
  let simConfig = null;

  // three.js objects, created lazily in init().
  let lib = null;
  let THREE = null;
  let renderer = null;
  let scene = null;
  let views = []; // one per visible camera, see createView()
  let plateGroup = null;
  let plateMesh = null;
  let plateSurfaceMaterial = null;
  let comMarker = null;
  let comMarkerTexture = null;
  let pathLine = null;
  let pathMaterial = null;
  let grid = null;
  let forceArrow = null;
  let accelerationArrow = null;
  let resizeObserver = null;

  function endTime() {
    return result ? result.t[result.t.length - 1] : 0;
  }

  function updateTimeReadout() {
    timeReadout.textContent = result
      ? `t = ${playTime.toFixed(2)} / ${endTime().toFixed(2)}`
      : "t = -";
  }

  function syncSettingsPanel() {
    settingsPanel.style.display = settings.panelOpen ? "grid" : "none";
    settingsButton.setAttribute("aria-expanded", String(settings.panelOpen));
  }

  function syncColorPickers() {
    plateColorPicker.input.value = toHexColor(settings.plateColor ?? colors.plate);
    lineColorPicker.input.value = toHexColor(settings.lineColor ?? colors.path);
    backgroundPicker.input.value = toHexColor(settings.background ?? colors.background);
  }

  function syncPlateOpacityText() {
    plateOpacityRange.valueText.textContent = `${Math.round(Number(settings.plateOpacity) * 100)}%`;
  }

  function syncLineWidthText() {
    lineWidthRange.valueText.textContent = `${Number(settings.lineWidth).toFixed(1)} px`;
  }

  // Zoom sliders, their numbers, and the per-view camera labels.
  function updateCameraReadouts() {
    for (const [mode, range] of Object.entries(zoomRanges)) {
      const { zoom } = settings.cameras[mode];
      range.input.value = String(Math.round(Math.log10(zoom) * ZOOM_SLIDER_STEPS));
      range.valueText.textContent = `${zoom.toFixed(2)}×`;
    }
    for (const view of views) {
      const { azimuth, zenith, zoom } = settings.cameras[view.mode];
      view.label.style.display = settings.showCameraInfo ? "block" : "none";
      view.label.textContent =
        `${VIEW_NAMES[view.mode]} · zoom ${zoom.toFixed(2)}× · ` +
        `az ${azimuth.toFixed(1)}° · zen ${zenith.toFixed(1)}°`;
    }
  }

  // ---- Cameras and views -------------------------------------------------------------
  // Each view is one camera pair (perspective + orthographic) with its own mouse
  // controls, attached to a transparent layer over its part of the canvas.
  function createView(mode) {
    const element = document.createElement("div");
    Object.assign(element.style, {
      position: "absolute",
      top: "0",
      bottom: "0",
      boxSizing: "border-box",
      zIndex: "1",
    });

    const label = document.createElement("div");
    Object.assign(label.style, {
      position: "absolute",
      left: "8px",
      bottom: "8px",
      padding: "2px 6px",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--font-size-small)",
      color: "var(--text)",
      background: "var(--panel)",
      opacity: "0.85",
      pointerEvents: "none",
      whiteSpace: "nowrap",
    });
    element.append(label);
    viewport.insertBefore(element, settingsPanel);

    const perspectiveCamera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.05, 1000);
    const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
    const camera = settings.projection === "orthographic" ? orthographicCamera : perspectiveCamera;

    const controls = new lib.OrbitControls(camera, element);
    controls.enableDamping = true;
    controls.enableRotate = !settings.lockSideOn2D;
    controls.minZoom = MIN_ZOOM;
    controls.maxZoom = MAX_ZOOM;

    const view = {
      mode,
      element,
      label,
      perspectiveCamera,
      orthographicCamera,
      camera,
      controls,
      baseDistance: FOLLOW_BASE_DISTANCE, // camera distance that counts as zoom 1×
      rect: { x: 0, width: 1, height: 1 },
    };
    // Mouse/wheel changes feed back into the settings and readouts.
    controls.addEventListener("change", () => readCamera(view));
    return view;
  }

  function disposeView(view) {
    view.controls.dispose();
    view.element.remove();
  }

  function isOrthographic(view) {
    return view.camera === view.orthographicCamera;
  }

  // The orthographic frustum matches what the perspective camera sees at the
  // base distance, so switching projection keeps the framing roughly the same.
  function updateViewProjection(view) {
    const aspect = view.rect.width / view.rect.height || 1;
    const far = Math.max(1000, bounds.span * 20);
    const halfHeight = view.baseDistance * Math.tan(THREE.MathUtils.degToRad(FIELD_OF_VIEW / 2));

    view.perspectiveCamera.aspect = aspect;
    view.perspectiveCamera.far = far;
    view.perspectiveCamera.updateProjectionMatrix();

    const ortho = view.orthographicCamera;
    ortho.left = -halfHeight * aspect;
    ortho.right = halfHeight * aspect;
    ortho.top = halfHeight;
    ortho.bottom = -halfHeight;
    ortho.far = far;
    ortho.updateProjectionMatrix();

    view.controls.minDistance = view.baseDistance / MAX_ZOOM;
    view.controls.maxDistance = view.baseDistance / MIN_ZOOM;
  }

  // Put the camera at the stored azimuth/zenith/zoom around the current target.
  // Perspective zooms by distance; orthographic by frustum scale (with the
  // camera parked at the base distance).
  function positionCamera(view) {
    const { azimuth, zenith, zoom: rawZoom } = settings.cameras[view.mode];
    const zoom = clamp(rawZoom, MIN_ZOOM, MAX_ZOOM);
    const radius = isOrthographic(view) ? view.baseDistance : view.baseDistance / zoom;
    const offset = new THREE.Vector3().setFromSphericalCoords(
      radius,
      THREE.MathUtils.degToRad(clamp(zenith, 0.01, 179.99)),
      THREE.MathUtils.degToRad(azimuth),
    );
    view.camera.position.copy(view.controls.target).add(offset);
    if (isOrthographic(view)) {
      view.camera.zoom = zoom;
      view.camera.updateProjectionMatrix();
    }
    view.controls.update();
  }

  // Read the live camera back into settings (inverse of positionCamera).
  function readCamera(view) {
    const offset = view.camera.position.clone().sub(view.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const zoom = isOrthographic(view)
      ? view.camera.zoom
      : view.baseDistance / Math.max(spherical.radius, 1e-9);

    if (settings.lockSideOn2D) {
      settings.cameras[view.mode] = {
        azimuth: SIDE_ON_AZIMUTH,
        zenith: SIDE_ON_ZENITH,
        zoom,
      };
      updateCameraReadouts();
      return;
    }

    settings.cameras[view.mode] = {
      azimuth: THREE.MathUtils.radToDeg(spherical.theta),
      zenith: THREE.MathUtils.radToDeg(spherical.phi),
      zoom,
    };
    updateCameraReadouts();
  }

  function applySideOnLock() {
    if (settings.lockSideOn2D) {
      for (const mode of Object.keys(settings.cameras)) {
        settings.cameras[mode].azimuth = SIDE_ON_AZIMUTH;
        settings.cameras[mode].zenith = SIDE_ON_ZENITH;
      }
    }

    for (const view of views) {
      view.controls.enableRotate = !settings.lockSideOn2D;
      if (settings.lockSideOn2D) {
        positionCamera(view);
      }
    }

    updateCameraReadouts();
  }

  // Aim a view at the plate (follow) or the whole path (fixed).
  function placeCamera(view) {
    if (!result) {
      return;
    }
    if (view.mode === "follow") {
      const { x, y } = sampleResult(result, playTime);
      view.controls.target.set(x, y, 0);
      view.baseDistance = FOLLOW_BASE_DISTANCE;
    } else {
      const aspect = view.rect.width / view.rect.height || 1;
      const halfFov = THREE.MathUtils.degToRad(FIELD_OF_VIEW / 2);
      const halfSpan = (bounds.span / 2) * 1.2;
      view.controls.target.set(bounds.centerX, bounds.centerY, 0);
      view.baseDistance = halfSpan / Math.tan(halfFov) / Math.min(1, aspect) + PLATE_SPAN;
    }
    updateViewProjection(view);
    positionCamera(view);
  }

  function setProjection(projection) {
    for (const view of views) {
      const next =
        projection === "orthographic" ? view.orthographicCamera : view.perspectiveCamera;
      if (next === view.camera) {
        continue;
      }
      next.position.copy(view.camera.position);
      next.quaternion.copy(view.camera.quaternion);
      view.camera = next;
      view.controls.object = next;
      updateViewProjection(view);
      positionCamera(view);
    }
  }

  // Split the canvas between the views and size the renderer.
  function layoutViews() {
    if (!renderer) {
      return;
    }
    const width = viewport.clientWidth;
    if (!width) {
      return; // hidden (closed accordion); the ResizeObserver will retry
    }
    const height = Math.max(260, Math.min(480, Math.round(width * 0.6)));
    renderer.setSize(width, height);

    let x = 0;
    views.forEach((view, index) => {
      const viewWidth =
        index === views.length - 1 ? width - x : Math.floor(width / views.length);
      view.rect = { x, width: viewWidth, height };
      view.element.style.left = `${x}px`;
      view.element.style.width = `${viewWidth}px`;
      view.element.style.borderLeft = index > 0 ? "1px solid var(--border)" : "none";
      x += viewWidth;
      updateViewProjection(view);
    });
  }

  function rebuildViews() {
    if (!renderer) {
      return;
    }
    views.forEach(disposeView);
    views = VIEW_MODES[settings.viewMode].map(createView);
    layoutViews();
    views.forEach(placeCamera);
    applySideOnLock();
  }

  // ---- Scene construction --------------------------------------------------------------
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

  function createComIconTexture() {
    const size = 256;
    const center = size / 2;
    const radius = size * 0.46;

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }

    ctx.clearRect(0, 0, size, size);

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.arc(center, center, radius, -Math.PI / 2, 0);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.arc(center, center, radius, Math.PI / 2, Math.PI);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#000000";
    ctx.lineWidth = Math.round(size * 0.04);
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  function buildPlate() {
    plateGroup = new THREE.Group(); // origin at the centre of mass

    // The geometric centre sits -e_x along the chord from the CoM (matching the
    // `v_yp - omega * e_x` term in the model), so the plate pivots about its CoM.
    plateSurfaceMaterial = new THREE.MeshStandardMaterial({
      color: colors.plate,
      roughness: 0.55,
      metalness: 0.1,
      transparent: true,
      opacity: 1,
    });
    plateMesh = new THREE.Mesh(
      new THREE.BoxGeometry(PLATE_CHORD, PLATE_THICKNESS, PLATE_SPAN),
      plateSurfaceMaterial,
    );
    plateMesh.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(plateMesh.geometry),
        new THREE.LineBasicMaterial({ color: colors.edges }),
      ),
    );
    plateGroup.add(plateMesh);

    comMarkerTexture = createComIconTexture();
    comMarker = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: comMarkerTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    comMarker.scale.set(COM_ICON_SIZE, COM_ICON_SIZE, 1);
    comMarker.renderOrder = 50;
    plateGroup.add(comMarker);

    forceArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      MIN_ARROW_LENGTH,
      0x2e7d32,
    );
    forceArrow.visible = false;

    accelerationArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      MIN_ARROW_LENGTH,
      0x9c27b0,
    );
    accelerationArrow.visible = false;

    scene.add(plateGroup);
    scene.add(forceArrow);
    scene.add(accelerationArrow);
    applyPlateStyle();
  }

  function applyPlateStyle() {
    if (!plateSurfaceMaterial) {
      return;
    }

    const opacity = clamp(Number(settings.plateOpacity), 0, 1);
    plateSurfaceMaterial.color.set(settings.plateColor ?? colors.plate);
    plateSurfaceMaterial.opacity = opacity;
    plateSurfaceMaterial.transparent = opacity < 0.999;
    plateSurfaceMaterial.needsUpdate = true;
  }

  function applyPathStyle() {
    if (!pathMaterial) {
      return;
    }
    pathMaterial.color.set(settings.lineColor ?? colors.path);
    pathMaterial.linewidth = settings.lineWidth;
    pathMaterial.dashed = settings.lineStyle === "dashed";
    if (pathLine) {
      pathLine.visible = settings.lineStyle !== "hidden";
    }
  }

  function applyGridVisibility() {
    if (grid) {
      grid.visible = settings.showGrid;
    }
  }

  function applyBackground() {
    if (scene) {
      scene.background.set(settings.background ?? colors.background);
    }
  }

  function applyOverlayVisibility() {
    if (comMarker) {
      comMarker.visible = settings.showComMarker;
    }

    if (forceArrow) {
      forceArrow.visible = settings.showForceArrow && Boolean(result) && Boolean(simConfig);
    }

    if (accelerationArrow) {
      accelerationArrow.visible =
        settings.showAccelerationArrow && Boolean(result) && Boolean(simConfig);
    }
  }

  function updateArrow(arrow, vectorX, vectorY, originX, originY, scale) {
    if (!arrow) {
      return;
    }

    if (!Number.isFinite(vectorX) || !Number.isFinite(vectorY)) {
      arrow.visible = false;
      return;
    }

    const magnitude = Math.hypot(vectorX, vectorY);
    if (!(magnitude > 1e-12)) {
      arrow.visible = false;
      return;
    }

    const length = clamp(magnitude * scale, MIN_ARROW_LENGTH, MAX_ARROW_LENGTH);
    const dir = new THREE.Vector3(vectorX / magnitude, vectorY / magnitude, 0);
    const headLength = Math.min(0.45, Math.max(0.15, length * 0.3));
    const headWidth = Math.min(0.25, Math.max(0.09, length * 0.18));

    arrow.position.set(originX, originY, 0);
    arrow.setDirection(dir);
    arrow.setLength(length, headLength, headWidth);
    arrow.visible = true;
  }

  function updateDynamicVectors(sample, time) {
    const showAnyVector = settings.showForceArrow || settings.showAccelerationArrow;
    if (!showAnyVector || !simConfig || !result) {
      return;
    }

    const stateVector = [sample.v_xp, sample.v_yp, sample.omega, sample.theta, sample.x, sample.y];
    const [dv_xpdt, dv_ypdt] = nondimFreelyFallingPlate(time, stateVector, simConfig);

    const accelWorld = rotateBodyToWorld(dv_xpdt, dv_ypdt, sample.theta);
    const forceBodyX = simConfig.model.m_prime * dv_xpdt;
    const forceBodyY = (simConfig.model.m_prime + 1) * dv_ypdt;
    const forceWorld = rotateBodyToWorld(forceBodyX, forceBodyY, sample.theta);

    if (settings.showForceArrow) {
      updateArrow(forceArrow, forceWorld.x, forceWorld.y, sample.x, sample.y, FORCE_ARROW_SCALE);
    }

    if (settings.showAccelerationArrow) {
      updateArrow(
        accelerationArrow,
        accelWorld.x,
        accelWorld.y,
        sample.x,
        sample.y,
        ACCEL_ARROW_SCALE,
      );
    }
  }

  function buildPathObjects() {
    // The path material is shared and long-lived, so only drop the geometry.
    if (pathLine) {
      pathLine.parent?.remove(pathLine);
      pathLine.geometry.dispose();
      pathLine = null;
    }
    disposeObject(grid);
    grid = null;
    if (!result) {
      return;
    }

    plateMesh.position.x = -e_x;
    bounds = pathBounds(result);

    const positions = [];
    for (let index = 0; index < result.t.length; index += 1) {
      const x = result.states.x[index];
      const y = result.states.y[index];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        positions.push(x, y, 0);
      }
    }
    if (positions.length >= 6) {
      // Line2 draws real pixel-width lines (plain WebGL lines are always 1px).
      const geometry = new lib.LineGeometry();
      geometry.setPositions(positions);
      pathLine = new lib.Line2(geometry, pathMaterial);
      pathLine.computeLineDistances(); // needed for dashes
      scene.add(pathLine);
    }
    pathMaterial.dashSize = Math.max(0.4, bounds.span / 150);
    pathMaterial.gapSize = pathMaterial.dashSize * 0.6;
    applyPathStyle();

    // A 1-unit grid behind the path gives a sense of motion when following.
    const gridSize = Math.ceil(bounds.span) + 10;
    grid = new THREE.GridHelper(gridSize, Math.min(gridSize, 200), colors.grid, colors.grid);
    grid.rotation.x = Math.PI / 2; // lie in the x-y plane
    grid.position.set(Math.round(bounds.centerX), Math.round(bounds.centerY), -PLATE_SPAN);
    scene.add(grid);
    applyGridVisibility();
    applyOverlayVisibility();

    views.forEach(placeCamera);
  }

  async function init() {
    message.textContent = "Loading three.js…";
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
    renderer.setScissorTest(true); // each view renders into its own rectangle
    renderer.domElement.style.display = "block";
    viewport.prepend(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color();
    applyBackground();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 5, 8);
    scene.add(sun);

    pathMaterial = new lib.LineMaterial({ worldUnits: false });

    buildPlate();
    rebuildViews();
    buildPathObjects();

    resizeObserver = new ResizeObserver(layoutViews);
    resizeObserver.observe(viewport);
  }

  // ---- Animation loop ------------------------------------------------------------------
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
      playTime += elapsed * settings.speed;
      if (playTime > endTime()) {
        playTime = 0; // loop
      }
      timeSlider.value = String(Math.round((playTime / (endTime() || 1)) * TIME_SLIDER_RESOLUTION));
    }

    const sample = sampleResult(result, playTime);
    const { x, y, theta } = sample;
    plateGroup.position.set(x, y, 0);
    plateGroup.rotation.z = theta; // body x' axis is at angle theta from lab x
    updateDynamicVectors(sample, playTime);

    for (const view of views) {
      if (view.mode === "follow") {
        // Translate camera and target together, so user orbiting is preserved.
        const dx = x - view.controls.target.x;
        const dy = y - view.controls.target.y;
        view.controls.target.x += dx;
        view.controls.target.y += dy;
        view.camera.position.x += dx;
        view.camera.position.y += dy;
      }
      view.controls.update();

      const { x: left, width, height } = view.rect;
      renderer.setViewport(left, 0, width, height);
      renderer.setScissor(left, 0, width, height);
      pathMaterial.resolution.set(width, height);
      renderer.render(scene, view.camera);
    }
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

  // ---- Control events ------------------------------------------------------------------
  playButton.addEventListener("click", () => {
    isPlaying = !isPlaying;
    playButton.textContent = isPlaying ? "Pause" : "Play";
  });

  settingsButton.addEventListener("click", () => {
    settings.panelOpen = !settings.panelOpen;
    syncSettingsPanel();
  });

  timeSlider.addEventListener("input", () => {
    isScrubbing = true;
    playTime = (Number(timeSlider.value) / TIME_SLIDER_RESOLUTION) * endTime();
  });
  timeSlider.addEventListener("change", () => {
    isScrubbing = false;
  });

  viewModeInput.addEventListener("change", () => {
    settings.viewMode = viewModeInput.value;
    rebuildViews();
  });

  speedInput.addEventListener("change", () => {
    settings.speed = Number(speedInput.value);
  });

  projectionInput.addEventListener("change", () => {
    settings.projection = projectionInput.value;
    setProjection(settings.projection);
  });

  for (const [mode, range] of Object.entries(zoomRanges)) {
    range.input.addEventListener("input", () => {
      settings.cameras[mode].zoom = 10 ** (Number(range.input.value) / ZOOM_SLIDER_STEPS);
      const view = views.find((candidate) => candidate.mode === mode);
      if (view) {
        positionCamera(view); // keeps the current angle and pan
      }
      updateCameraReadouts();
    });
  }

  cameraInfoInput.addEventListener("change", () => {
    settings.showCameraInfo = cameraInfoInput.checked;
    updateCameraReadouts();
  });

  resetCameraButton.addEventListener("click", () => {
    settings.cameras = structuredClone(DEFAULT_CAMERAS);
    views.forEach(placeCamera);
    applySideOnLock();
  });

  sideOn2DInput.addEventListener("change", () => {
    settings.lockSideOn2D = sideOn2DInput.checked;
    applySideOnLock();
  });

  comMarkerInput.addEventListener("change", () => {
    settings.showComMarker = comMarkerInput.checked;
    applyOverlayVisibility();
  });

  forceArrowInput.addEventListener("change", () => {
    settings.showForceArrow = forceArrowInput.checked;
    applyOverlayVisibility();
  });

  accelerationArrowInput.addEventListener("change", () => {
    settings.showAccelerationArrow = accelerationArrowInput.checked;
    applyOverlayVisibility();
  });

  plateColorPicker.input.addEventListener("input", () => {
    settings.plateColor = plateColorPicker.input.value;
    applyPlateStyle();
  });
  plateColorPicker.reset.addEventListener("click", () => {
    settings.plateColor = null;
    syncColorPickers();
    applyPlateStyle();
  });

  plateOpacityRange.input.addEventListener("input", () => {
    settings.plateOpacity = clamp(Number(plateOpacityRange.input.value), 0, 1);
    syncPlateOpacityText();
    applyPlateStyle();
  });

  lineStyleInput.addEventListener("change", () => {
    settings.lineStyle = lineStyleInput.value;
    applyPathStyle();
  });

  lineColorPicker.input.addEventListener("input", () => {
    settings.lineColor = lineColorPicker.input.value;
    applyPathStyle();
  });
  lineColorPicker.reset.addEventListener("click", () => {
    settings.lineColor = null;
    syncColorPickers();
    applyPathStyle();
  });

  lineWidthRange.input.addEventListener("input", () => {
    settings.lineWidth = Number(lineWidthRange.input.value);
    syncLineWidthText();
    applyPathStyle();
  });

  gridInput.addEventListener("change", () => {
    settings.showGrid = gridInput.checked;
    applyGridVisibility();
  });

  backgroundPicker.input.addEventListener("input", () => {
    settings.background = backgroundPicker.input.value;
    applyBackground();
  });
  backgroundPicker.reset.addEventListener("click", () => {
    settings.background = null;
    syncColorPickers();
    applyBackground();
  });

  // ---- Public API ----------------------------------------------------------------------
  function setResult(nextResult, { e_x: nextEx = 0, config: nextConfig = null } = {}) {
    result = nextResult ?? null;
    e_x = Number(nextEx) || 0;
    simConfig = nextConfig ? structuredClone(nextConfig) : null;
    playTime = 0;
    timeSlider.value = "0";
    updateTimeReadout();
    applyOverlayVisibility();
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
        layoutViews();
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
    views.forEach(disposeView);
    views = [];
    if (scene) {
      pathLine?.geometry.dispose();
      pathMaterial?.dispose();
      comMarkerTexture?.dispose();
      disposeObject(grid);
      disposeObject(forceArrow);
      disposeObject(accelerationArrow);
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

  syncSettingsPanel();
  syncColorPickers();
  syncPlateOpacityText();
  syncLineWidthText();
  updateCameraReadouts();
  updateTimeReadout();

  const api = { panel, setResult, setOpen, dispose };
  activeAnimation = api;
  return api;
}
