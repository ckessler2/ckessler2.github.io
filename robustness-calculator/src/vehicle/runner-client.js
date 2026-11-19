// Talks to the local Verify runner (runner/server.py). Module state, so a connection and a
// running job survive re-renders and tab switches; the runner stays alive while this page is open.
//
// The page only contacts the runner after the user presses Connect (browsers may ask permission
// for a public site to reach this machine), and again automatically after a reload.

const RUNNER_PORT = 8765;
const SITE_ORIGIN = "https://ckessler2.github.io";
export const IMAGE = "ghcr.io/ckessler2/easynnv-runner";
// The runner also serves this page at its own address (for browsers that block a public site from
// reaching this machine). Served from there, the page talks to its own origin.
export const SERVED_BY_RUNNER =
  /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(window.location.origin) &&
  /^\/(index\.html)?$/.test(window.location.pathname);
export const RUNNER_URL = SERVED_BY_RUNNER ? window.location.origin : `http://127.0.0.1:${RUNNER_PORT}`;
const SLOW_MS = 10_000; // after this long without an answer, show what to check
const HEARTBEAT_MS = 5_000; // notices a stopped runner quickly; the runner stops after 120 s without a request
const CONNECT_RETRY_MS = 2_000; // while the container starts
const CONNECT_PATIENCE_MS = 120_000;
const OUTPUT_LIMIT = 2_000_000; // characters of output kept

const listeners = new Set();
export const runner = {
  connection: "idle", // idle | connecting | connected | lost | wrong-token | refused
  slow: false, // connecting for a while without an answer
  blocked: false, // the browser's local-network permission for this site is "denied"
  error: null,
  notice: null, // a neutral message, e.g. after Disconnect
  info: null, // /status reply: versions, solvers, busy, …
  job: null, // { status: running|done|failed|cancelled, output, outcome, seconds, error }
};

function notify() {
  for (const listener of listeners) listener();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---- token and start command ---------------------------------------------------------------

function storage(kind) {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// The token lives in this tab's sessionStorage only: a new one for each tab session, so it is not
// stored for the whole site, and pages in other tabs cannot read it. It survives a reload.
// The page served by the runner receives it in the link's fragment (never sent to a server), which
// is removed from the address bar at once.
function tokenFromLink() {
  const match = /[?&]token=([0-9a-f]{32})(?=&|$)/.exec(window.location.hash);
  if (!match) return null;
  const hash = window.location.hash.replace(/[?&]token=[0-9a-f]{32}/, "");
  history.replaceState(null, "", window.location.pathname + window.location.search + hash);
  return match[1];
}

function loadToken() {
  const linked = SERVED_BY_RUNNER ? tokenFromLink() : null;
  if (linked) {
    try {
      storage("sessionStorage")?.setItem("easynnv-token", linked);
      storage("sessionStorage")?.setItem("easynnv-connected", "1");
    } catch {
      /* the token then lasts until the page is reloaded */
    }
    return linked;
  }
  try {
    const saved = storage("sessionStorage")?.getItem("easynnv-token");
    if (saved && /^[0-9a-f]{32}$/.test(saved)) return saved;
  } catch {
    /* storage blocked: fall through to a fresh token for this page */
  }
  const token = hex(crypto.getRandomValues(new Uint8Array(16)));
  try {
    storage("sessionStorage")?.setItem("easynnv-token", token);
  } catch {
    /* the token then lasts until the page is reloaded */
  }
  return token;
}

const TOKEN = loadToken();
// The runner is given only the token's SHA-256, so the token is not in the command, the shell
// history, the process list or the container (where code running in a job could read it).
const TOKEN_SHA256 = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN))));
// Identifies this page load, so the runner knows when the last open tab has gone.
const TAB = hex(crypto.getRandomValues(new Uint8Array(8)));
const HEADERS = { "X-EasyNNV-Token": TOKEN, "X-EasyNNV-Tab": TAB };

export const MEMORY_CHOICES = [4, 8, 16]; // GB

/** The memory limit for the runner (GB), remembered on this device. */
export function memoryLimit() {
  try {
    const saved = Number(storage("localStorage")?.getItem("easynnv-memory"));
    if (MEMORY_CHOICES.includes(saved)) return saved;
  } catch {
    /* default */
  }
  return 4;
}

export function setMemoryLimit(gb) {
  try {
    storage("localStorage")?.setItem("easynnv-memory", String(gb));
  } catch {
    /* only for this page */
  }
  notify();
}

/** The command that starts the runner. `image` pins a published revision (default: the newest). */
export function startCommand({ image = null } = {}) {
  const origin = window.location.origin;
  // A page served from elsewhere (e.g. a local copy) is allowed explicitly; never "null" (file://).
  const extraOrigin =
    origin === SITE_ORIGIN || SERVED_BY_RUNNER || !/^https?:\/\//.test(origin) ? "" : ` -e EASYNNV_ORIGINS=${origin}`;
  const memory = memoryLimit();
  return (
    `docker run --rm --init ${image ? "" : "--pull=always "}--platform=linux/amd64 ` +
    `-p 127.0.0.1:${RUNNER_PORT}:8765 --read-only --tmpfs /tmp:size=${memory >= 8 ? memory / 2 : 2}g ` +
    `--cap-drop=ALL --security-opt=no-new-privileges --memory=${memory}g --cpus=2 --pids-limit=256 ` +
    `-e EASYNNV_TOKEN_SHA256=${TOKEN_SHA256}${extraOrigin} ${image ? `${IMAGE}:${image}` : IMAGE}`
  );
}

/** Opens this page as served by the runner itself, already holding this tab's token. */
export function runnerPageUrl() {
  return `http://127.0.0.1:${RUNNER_PORT}/#/verify?token=${TOKEN}`;
}

/** The browser's local-network permission for this page, where the browser has one (Chrome 142+). */
async function localNetworkPermission() {
  for (const name of ["loopback-network", "local-network-access", "local-network"]) {
    try {
      return (await navigator.permissions.query({ name })).state;
    } catch {
      /* not a permission this browser knows */
    }
  }
  return null;
}

// ---- connection and heartbeat ---------------------------------------------------------------

let heartbeat = null;
let connectAttempt = 0;

function setSessionFlag(on) {
  try {
    if (on) storage("sessionStorage")?.setItem("easynnv-connected", "1");
    else storage("sessionStorage")?.removeItem("easynnv-connected");
  } catch {
    /* only affects reconnecting after a reload */
  }
}

async function fetchStatus() {
  const response = await fetch(`${RUNNER_URL}/status`, {
    headers: HEADERS,
    cache: "no-store",
  });
  if (response.status === 401) throw Object.assign(new Error("wrong token"), { kind: "wrong-token" });
  if (!response.ok) throw Object.assign(new Error(`runner replied ${response.status}`), { kind: "refused" });
  return response.json();
}

/** Connect, retrying while the container starts. */
export async function connect() {
  const attempt = ++connectAttempt;
  clearInterval(heartbeat);
  runner.connection = "connecting";
  runner.error = null;
  runner.notice = null;
  runner.slow = false;
  runner.blocked = !SERVED_BY_RUNNER && (await localNetworkPermission()) === "denied";
  notify();
  const started = Date.now();
  while (attempt === connectAttempt) {
    try {
      runner.info = await fetchStatus();
      if (attempt !== connectAttempt) return;
      runner.connection = "connected";
      setSessionFlag(true);
      heartbeat = setInterval(beat, HEARTBEAT_MS);
      notify();
      return;
    } catch (error) {
      if (attempt !== connectAttempt) return;
      if (error.kind) {
        // The runner answered but refused: retrying will not help.
        runner.connection = error.kind;
        runner.error = error.message;
        notify();
        return;
      }
      if (Date.now() - started > CONNECT_PATIENCE_MS) {
        runner.connection = "idle";
        runner.error = "No runner found at " + RUNNER_URL + ". Start it with the command above, then press Connect.";
        notify();
        return;
      }
      if (!runner.slow && Date.now() - started > SLOW_MS) {
        runner.slow = true;
        notify();
      }
      await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_MS));
    }
  }
}

export function stopConnecting() {
  connectAttempt++;
  if (runner.connection === "connecting") runner.connection = "idle";
  notify();
}

async function beat() {
  try {
    runner.info = await fetchStatus();
    return; // still connected: nothing to redraw (a redraw would steal focus from the editor)
  } catch (error) {
    runner.connection = error.kind ?? "lost";
    runner.error =
      error.kind === "wrong-token"
        ? error.message
        : "The runner has stopped (its terminal was closed, or Docker stopped). Start it again to keep verifying.";
    runner.info = null;
    clearInterval(heartbeat);
    setSessionFlag(false);
  }
  notify();
}

// Tell the runner this tab is done with it. sendBeacon cannot set headers, so the token and tab id
// are the body. The runner stops once no tab is left. It waits 10 s first, so a reload reconnects
// instead (see the end of this file).
function sendShutdown() {
  try {
    navigator.sendBeacon(`${RUNNER_URL}/shutdown`, new Blob([`${TOKEN} ${TAB}`], { type: "text/plain" }));
  } catch {
    /* the runner's idle timeout is the backstop */
  }
}

window.addEventListener("pagehide", () => {
  if (runner.connection === "connected") sendShutdown();
});

/** Stop using the runner: cancel any job and tell the runner to stop (unless another tab uses it). */
export function disconnect() {
  controller?.abort();
  connectAttempt++;
  clearInterval(heartbeat);
  if (runner.connection === "connected") sendShutdown();
  runner.connection = "idle";
  runner.info = null;
  runner.error = null;
  runner.notice = "Disconnected. The runner stops within 10 seconds, unless another easyNNV tab is using it.";
  setSessionFlag(false);
  notify();
}

// ---- running a job --------------------------------------------------------------------------

let controller = null;

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function append(text) {
  const job = runner.job;
  job.output += text;
  if (job.output.length > OUTPUT_LIMIT) job.output = "…\n" + job.output.slice(-OUTPUT_LIMIT);
}

/**
 * job: { specification, networks: {name: {bytes}}, datasets: {name: {bytes, extension}},
 *        parameters: {name: value}, properties: [names; empty = all], timeout }
 */
export async function runJob(job, onOutput) {
  if (runner.job?.status === "running") return;
  runner.job = { status: "running", output: "", outcome: null, seconds: null, error: null };
  notify();
  const body = {
    solver: "Marabou",
    specification: job.specification,
    timeout: job.timeout,
    networks: Object.fromEntries(
      Object.entries(job.networks).map(([name, f]) => [name, { data: bytesToBase64(f.bytes), extension: "onnx" }]),
    ),
    datasets: Object.fromEntries(
      Object.entries(job.datasets).map(([name, f]) => [name, { data: bytesToBase64(f.bytes), extension: f.extension }]),
    ),
    parameters: job.parameters,
    properties: job.properties ?? [],
  };
  controller = new AbortController();
  try {
    const response = await fetch(`${RUNNER_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...HEADERS },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const reply = await response.json().catch(() => ({}));
      throw new Error(reply.error ?? `runner replied ${response.status}`);
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += value;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === "output") {
          append(event.text);
          onOutput?.();
        } else if (event.type === "done") {
          runner.job.outcome = event.outcome;
          runner.job.seconds = event.seconds;
          runner.job.exitCode = event.exitCode;
        }
      }
    }
    runner.job.status = runner.job.outcome ? "done" : "failed";
    if (!runner.job.outcome) runner.job.error = "The runner stopped before the job finished.";
  } catch (error) {
    if (error.name === "AbortError") {
      runner.job.status = "cancelled";
    } else {
      runner.job.status = "failed";
      runner.job.error = error.message === "Failed to fetch" ? "Could not reach the runner." : error.message;
      if (runner.connection === "connected") beat(); // find out now whether the runner has stopped
    }
  } finally {
    controller?.abort(); // make sure the stream is closed, so the runner stops the job
    controller = null;
    notify();
  }
}

/** Closing the stream is how a job is cancelled: the runner notices within seconds and stops it. */
export function cancelJob() {
  controller?.abort();
}

// After a reload, reconnect without waiting for a click: the runner is still up for 10 s.
try {
  if (storage("sessionStorage")?.getItem("easynnv-connected")) connect();
} catch {
  /* nothing to restore */
}
