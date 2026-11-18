"""easyNNV runner: a small local HTTP server that runs `vehicle verify` for the easyNNV page.

Standard library only. Meant to run inside the runner image (see Dockerfile), started with
the command the page shows. The runner stops itself when the page goes away.

Endpoints (every request needs the page's Origin, a local Host and the token):
  GET  /status    versions, solvers, whether a job is running. The page polls it as a heartbeat.
  POST /verify    JSON job; the reply streams newline-delimited JSON events while Vehicle runs.
  POST /shutdown  the page is closing: cancel any job, then exit unless the page comes back.
"""

import base64
import hmac
import importlib.metadata
import json
import os
import platform
import queue
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("EASYNNV_TOKEN", "")
ORIGINS = set(os.environ.get("EASYNNV_ORIGINS", "https://ckessler2.github.io").split())
HOST_PORT = os.environ.get("EASYNNV_HOST_PORT", "8765")  # the port as published on the host
HOSTS = {f"127.0.0.1:{HOST_PORT}", f"localhost:{HOST_PORT}"}
IDLE_TIMEOUT = float(os.environ.get("EASYNNV_IDLE_TIMEOUT", "120"))  # seconds without a request
SHUTDOWN_GRACE = 10.0  # after /shutdown, a reloaded page has this long to reconnect
MAX_TIMEOUT = int(os.environ.get("EASYNNV_MAX_TIMEOUT", "3600"))
MAX_BODY = int(os.environ.get("EASYNNV_MAX_BODY_MB", "200")) * 1024 * 1024
KEEPALIVE = 2.0  # seconds between keep-alive events; a closed tab is noticed within two
SOLVERS = {"Marabou": "Marabou"}  # name in requests -> executable; VNNLib solvers go here later

NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_']{0,63}$")
EXTENSION = re.compile(r"^[a-z0-9]{1,8}$")
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")  # terminal colour codes in Vehicle's output
PARAMETER_VALUE = re.compile(r"^(-?[0-9]+(\.[0-9]+)?([eE]-?[0-9]+)?|True|False)$")

last_seen = time.monotonic()
shutdown_at = None  # set by /shutdown; cleared by the next request
job_lock = threading.Lock()


current = None  # the running Vehicle process, if any


def touch(page_request=True):
    """Record that the page is alive. A new page request also cancels a pending shutdown."""
    global last_seen, shutdown_at
    last_seen = time.monotonic()
    if page_request:
        shutdown_at = None


def versions():
    def run(*args):
        try:
            return subprocess.run(args, capture_output=True, text=True, timeout=30).stdout.strip()
        except Exception as error:  # noqa: BLE001 - report, don't crash
            return f"unavailable ({error})"

    def package(name):
        try:
            return importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            return "not installed"

    return {
        "vehicle": run("vehicle", "--version"),
        "maraboupy": package("maraboupy"),
        "python": platform.python_version(),
        "image": os.environ.get("EASYNNV_IMAGE_REVISION", "unknown"),
    }


VERSIONS = versions()


class JobError(ValueError):
    pass


def build_command(job, folder):
    """Validate a job and write its files. Returns the argument list for `vehicle verify`."""
    if not isinstance(job, dict):
        raise JobError("the job must be a JSON object")
    solver = job.get("solver", "Marabou")
    if solver not in SOLVERS:
        raise JobError(f"unknown solver {solver!r}; available: {', '.join(SOLVERS)}")
    spec = job.get("specification")
    if not isinstance(spec, str) or not spec.strip():
        raise JobError("the specification is missing")
    with open(os.path.join(folder, "spec.vcl"), "w", encoding="utf-8") as f:
        f.write(spec)
    args = ["vehicle", "verify", "--specification", "spec.vcl", "--solver", SOLVERS[solver]]

    def files(kind, flag):
        entries = job.get(kind, {})
        if not isinstance(entries, dict):
            raise JobError(f"{kind} must be an object of name -> file")
        for i, (name, entry) in enumerate(entries.items()):
            if not NAME.match(name):
                raise JobError(f"invalid {kind[:-1]} name {name!r}")
            if not isinstance(entry, dict) or not isinstance(entry.get("data"), str):
                raise JobError(f"{kind[:-1]} {name!r} needs base64 'data'")
            extension = entry.get("extension", "onnx" if kind == "networks" else "")
            if not EXTENSION.match(extension):
                raise JobError(f"invalid file extension for {name!r}")
            filename = f"{kind}-{i}.{extension}"  # the runner chooses every file name
            try:
                data = base64.b64decode(entry["data"], validate=True)
            except ValueError as error:
                raise JobError(f"{kind[:-1]} {name!r}: invalid base64") from error
            with open(os.path.join(folder, filename), "wb") as f:
                f.write(data)
            args.extend([flag, f"{name}:{filename}"])

    files("networks", "--network")
    files("datasets", "--dataset")
    parameters = job.get("parameters", {})
    if not isinstance(parameters, dict):
        raise JobError("parameters must be an object of name -> value")
    for name, value in parameters.items():
        value = str(value)
        if not NAME.match(name) or not PARAMETER_VALUE.match(value):
            raise JobError(f"invalid parameter {name}={value!r}")
        args.extend(["--parameter", f"{name}:{value}"])
    properties = job.get("properties", [])
    if not isinstance(properties, list) or not all(isinstance(p, str) and NAME.match(p) for p in properties):
        raise JobError("properties must be a list of property names")
    for name in properties:
        args.extend(["--property", name])
    return args


def kill_group(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)  # Vehicle and every solver process it started
    except ProcessLookupError:
        pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "easyNNV-runner"
    sys_version = ""

    def log_message(self, fmt, *args):  # one line per request, no request bodies
        sys.stderr.write(f"{self.command} {self.path} -> {fmt % args}\n")

    # --- checks ---------------------------------------------------------------

    def allowed(self, need_token=True):
        """Reject before doing any work. Returns True if the request may proceed."""
        origin = self.headers.get("Origin")
        if self.headers.get("Host") not in HOSTS:  # defeats DNS rebinding
            self.reply(403, {"error": "wrong Host"}, cors=False)
            return False
        if origin not in ORIGINS:  # also rejects requests with no Origin at all
            self.reply(403, {"error": "origin not allowed"}, cors=False)
            return False
        if need_token and not hmac.compare_digest(self.headers.get("X-EasyNNV-Token", ""), TOKEN):
            self.reply(401, {"error": "wrong or missing token"})
            return False
        return True

    def cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Vary", "Origin")

    def reply(self, status, body, cors=True):
        data = json.dumps(body).encode()
        self.send_response(status)
        if cors:
            self.cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_body(self):
        length = self.headers.get("Content-Length")
        if length is None or not length.isdigit():
            self.reply(411, {"error": "Content-Length required"})
            return None
        if int(length) > MAX_BODY:
            self.reply(413, {"error": f"request larger than {MAX_BODY // 2**20} MB"})
            self.close_connection = True
            return None
        return self.rfile.read(int(length))

    # --- endpoints ------------------------------------------------------------

    def do_OPTIONS(self):  # CORS preflight
        if not self.allowed(need_token=False):
            return
        self.send_response(204)
        self.cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-EasyNNV-Token")
        if self.headers.get("Access-Control-Request-Private-Network"):
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self.allowed():
            return
        if self.path != "/status":
            return self.reply(404, {"error": "not found"})
        touch()
        self.reply(200, {"versions": VERSIONS, "solvers": list(SOLVERS), "busy": job_lock.locked(),
                         "maxTimeout": MAX_TIMEOUT, "idleTimeout": IDLE_TIMEOUT})

    def do_POST(self):
        if self.path == "/shutdown":
            # Sent with navigator.sendBeacon, which cannot set headers: the token is the body.
            if not self.allowed(need_token=False):
                return
            body = self.read_body()
            if body is None:
                return
            if not hmac.compare_digest(body.strip(), TOKEN.encode()):
                return self.reply(401, {"error": "wrong or missing token"})
            global shutdown_at
            shutdown_at = time.monotonic()
            return self.reply(200, {"stopping_in": SHUTDOWN_GRACE})
        if not self.allowed():
            return
        if self.path != "/verify":
            return self.reply(404, {"error": "not found"})
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            return self.reply(415, {"error": "send application/json"})
        touch()
        body = self.read_body()
        if body is None:
            return
        if not job_lock.acquire(blocking=False):
            return self.reply(409, {"error": "a job is already running"})
        try:
            self.verify(body)
        finally:
            job_lock.release()

    def verify(self, body):
        folder = tempfile.mkdtemp(prefix="job-")
        try:
            try:
                job = json.loads(body)
                args = build_command(job, folder)
                timeout = min(int(job.get("timeout", 600)), MAX_TIMEOUT)
                if timeout <= 0:
                    raise JobError("timeout must be positive")
            except (ValueError, TypeError) as error:  # JobError and bad JSON
                return self.reply(400, {"error": str(error)})

            self.send_response(200)
            self.cors_headers()
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()

            def send(event):
                data = (json.dumps(event) + "\n").encode()
                self.wfile.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")
                self.wfile.flush()

            global current
            process = current = subprocess.Popen(
                args, cwd=folder, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL, start_new_session=True,
            )
            lines = queue.Queue()

            def read_output():
                for raw in process.stdout:
                    lines.put(ANSI.sub("", raw.decode("utf-8", "replace")))
                lines.put(None)

            threading.Thread(target=read_output, daemon=True).start()
            started = time.monotonic()
            outcome = "finished"
            try:
                send({"type": "started", "command": args})
                while True:
                    try:
                        line = lines.get(timeout=KEEPALIVE)
                    except queue.Empty:
                        line = ""
                    if line is None:
                        break
                    if time.monotonic() - started > timeout:
                        outcome = "timeout"
                        kill_group(process)
                        break
                    if shutdown_at is not None:
                        outcome = "cancelled"
                        kill_group(process)
                        break
                    # Writing is also how a closed tab is noticed: it raises and the job is killed.
                    send({"type": "output", "text": line} if line else {"type": "keepalive"})
                    touch(page_request=False)
                process.wait()
                send({"type": "done", "outcome": outcome, "exitCode": process.returncode,
                      "seconds": round(time.monotonic() - started, 2)})
                self.wfile.write(b"0\r\n\r\n")
            except (BrokenPipeError, ConnectionResetError, OSError):
                kill_group(process)  # the page went away
                process.wait()
                self.close_connection = True
        finally:
            current = None
            shutil.rmtree(folder, ignore_errors=True)


def watchdog():
    """Stop the runner when the page has gone: no request for IDLE_TIMEOUT, or /shutdown."""
    while True:
        time.sleep(1)
        now = time.monotonic()
        closing = shutdown_at is not None and now - shutdown_at > SHUTDOWN_GRACE
        idle = not job_lock.locked() and now - last_seen > IDLE_TIMEOUT
        if closing or idle:
            print("Page closed or idle: stopping the runner.", flush=True)
            os._exit(0)  # running jobs are in their own process groups; kill them first


def main():
    if len(TOKEN) < 16:
        sys.exit("EASYNNV_TOKEN must be set to the token shown on the easyNNV page (16+ characters).")
    if os.geteuid() == 0:
        print("Warning: running as root. Use the runner image, which runs as an unprivileged user.")
    server = ThreadingHTTPServer(("0.0.0.0", 8765), Handler)  # Docker publishes it on 127.0.0.1 only
    server.daemon_threads = True
    threading.Thread(target=watchdog, daemon=True).start()
    print(f"easyNNV runner ready: Vehicle {VERSIONS['vehicle']}, Marabou {VERSIONS['maraboupy']}.", flush=True)
    print(f"Waiting for the page on http://127.0.0.1:{HOST_PORT}; it stops when the page closes.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
