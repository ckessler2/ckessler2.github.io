// Talks to the local VehicleWrapper runner (runner/server.py). Module state, so a connection and a
// running job survive re-renders and tab switches; the runner stays alive while this page is open.
//
// The page only contacts the runner after the user presses Connect (browsers may ask permission
// for a public site to reach this machine), and again automatically after a reload.

export const RUNNER_URL = "http://127.0.0.1:8765";
const SITE_ORIGIN = "https://ckessler2.github.io";
const IMAGE = "ghcr.io/ckessler2/easynnv-runner";
const HEARTBEAT_MS = 30_000; // the runner stops after 120 s without a request
const CONNECT_RETRY_MS = 2_000; // while the container starts
const CONNECT_PATIENCE_MS = 120_000;
const OUTPUT_LIMIT = 2_000_000; // characters of output kept

const listeners = new Set();
export const runner = {
  connection: "idle", // idle | connecting | connected | lost | wrong-token | refused
  error: null,
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

function loadToken() {
  try {
    const saved = storage("localStorage")?.getItem("easynnv-token");
    if (saved && /^[0-9a-f]{32}$/.test(saved)) return saved;
  } catch {
    /* storage blocked: fall through to a fresh token for this visit */
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    storage("localStorage")?.setItem("easynnv-token", token);
  } catch {
    /* the token then lasts for this visit only */
  }
  return token;
}

const TOKEN = loadToken();

export function startCommand() {
  const origin = window.location.origin;
  const extraOrigin = origin === SITE_ORIGIN ? "" : ` -e EASYNNV_ORIGINS=${origin}`;
  return (
    "docker run --rm --init --pull=always -p 127.0.0.1:8765:8765 --read-only --tmpfs /tmp:size=2g " +
    "--cap-drop=ALL --security-opt=no-new-privileges --memory=4g --cpus=2 --pids-limit=256 " +
    `-e EASYNNV_TOKEN=${TOKEN}${extraOrigin} ${IMAGE}`
  );
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
    headers: { "X-EasyNNV-Token": TOKEN },
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
        : "Lost the runner. It stops after 2 minutes without this page, or it may have been closed.";
    clearInterval(heartbeat);
    setSessionFlag(false);
  }
  notify();
}

// Tell the runner the page is closing. sendBeacon cannot set headers, so the token is the body.
// The runner waits 10 s before stopping, so a reload reconnects instead (see the end of this file).
window.addEventListener("pagehide", () => {
  if (runner.connection !== "connected") return;
  try {
    navigator.sendBeacon(`${RUNNER_URL}/shutdown`, new Blob([TOKEN], { type: "text/plain" }));
  } catch {
    /* the runner's idle timeout is the backstop */
  }
});

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
 *        parameters: {name: value}, timeout }
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
  };
  controller = new AbortController();
  try {
    const response = await fetch(`${RUNNER_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-EasyNNV-Token": TOKEN },
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
    }
  } finally {
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
