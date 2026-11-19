"""easyNNV runner: a small local HTTP server that runs `vehicle verify` for the easyNNV page.

Standard library only. Meant to run inside the runner image (see Dockerfile), started with
the command the page shows. The runner stops itself when the page goes away.

Endpoints (every request needs the page's Origin, a local Host, the token and the tab's id):
  GET  /status    versions, solvers, whether a job is running. Each tab polls it as a heartbeat.
  POST /verify    JSON job; the reply streams newline-delimited JSON events while Vehicle runs.
  POST /shutdown  a tab is closing (sent by navigator.sendBeacon; body "<token> <tab id>").

The runner is given only the SHA-256 of the token (EASYNNV_TOKEN_SHA256), so the token itself
is not in the start command, the process list or the container's environment, where code
running in a job could read it.
"""

import base64
import hashlib
import hmac
import importlib.metadata
import json
import os
import platform
import queue
import re
import select
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN_SHA256 = os.environ.get("EASYNNV_TOKEN_SHA256", "").strip().lower()
ORIGINS = set(os.environ.get("EASYNNV_ORIGINS", "https://ckessler2.github.io").split()) - {"null"}
HOST_PORT = os.environ.get("EASYNNV_HOST_PORT", "8765")  # the port as published on the host
HOSTS = {f"127.0.0.1:{HOST_PORT}", f"localhost:{HOST_PORT}"}
# The image also serves the page itself, for browsers that block a public site from reaching this
# machine. That page's own origin is then allowed too; it is served only from this folder.
SITE = os.path.realpath(os.environ.get("EASYNNV_SITE", "/app/site"))
if os.path.isdir(SITE):
    ORIGINS |= {f"http://127.0.0.1:{HOST_PORT}", f"http://localhost:{HOST_PORT}"}
SITE_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
              ".css": "text/css; charset=utf-8", ".vcl": "text/plain; charset=utf-8",
              ".onnx": "application/octet-stream", ".json": "application/json", ".svg": "image/svg+xml"}
IDLE_TIMEOUT = float(os.environ.get("EASYNNV_IDLE_TIMEOUT", "120"))  # seconds without a tab
SHUTDOWN_GRACE = 10.0  # after the last tab closes, a reloaded page has this long to reconnect
MAX_TIMEOUT = int(os.environ.get("EASYNNV_MAX_TIMEOUT", "3600"))
MAX_BODY = int(os.environ.get("EASYNNV_MAX_BODY_MB", "200")) * 1024 * 1024
MAX_CONNECTIONS = 32
SOCKET_TIMEOUT = 20  # seconds a connection may stall while sending a request or receiving output
KEEPALIVE = 2.0  # seconds between keep-alive events while a job runs
IN_CONTAINER = os.environ.get("EASYNNV_CONTAINER") == "1"  # set by the image; enables full clean-up
SOLVERS = {"Marabou": "Marabou"}  # name in requests -> executable; VNNLib solvers go here later

NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_']{0,63}")
EXTENSION = re.compile(r"[a-z0-9]{1,8}")
TAB = re.compile(r"[0-9a-f]{8,32}")
LENGTH = re.compile(r"[0-9]{1,10}")
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")  # terminal colour codes in Vehicle's output
PARAMETER_VALUE = re.compile(r"-?[0-9]+(\.[0-9]+)?([eE]-?[0-9]+)?|True|False")

# --- page tabs and the runner's lifetime -------------------------------------------------------

state = threading.Lock()
tabs = {}  # tab id -> when it was last heard from
deadline = time.monotonic() + IDLE_TIMEOUT  # exit at this time if no tab is open and no job runs
job_lock = threading.Lock()
current = None  # (process, folder) of the running job


def tab_seen(tab):
    global deadline
    with state:
        tabs[tab] = time.monotonic()
        deadline = None


def tab_closed(tab):
    global deadline
    with state:
        tabs.pop(tab, None)
        if not tabs:
            deadline = time.monotonic() + SHUTDOWN_GRACE


def check_token(value):
    if not isinstance(value, str) or not value.isascii():
        return False
    return hmac.compare_digest(hashlib.sha256(value.encode()).hexdigest(), TOKEN_SHA256)


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
        "packages": packages(),
    }


def packages():
    """Every installed package and version (pip freeze at build time), for reproducible records."""
    try:
        with open("/app/packages.txt") as handle:
            return [line.strip() for line in handle if "==" in line]
    except OSError:
        return []


VERSIONS = versions()

# --- jobs --------------------------------------------------------------------------------------


class JobError(ValueError):
    pass


def build_command(job, folder):
    """Validate a job and write its files. Returns the argument list for `vehicle verify`."""
    if not isinstance(job, dict):
        raise JobError("the job must be a JSON object")
    solver = job.get("solver", "Marabou")
    if solver not in SOLVERS:
        raise JobError(f"unknown solver; available: {', '.join(SOLVERS)}")
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
            if not NAME.fullmatch(name):
                raise JobError(f"invalid {kind[:-1]} name")
            if not isinstance(entry, dict) or not isinstance(entry.get("data"), str):
                raise JobError(f"{kind[:-1]} {name} needs base64 'data'")
            extension = entry.get("extension", "onnx" if kind == "networks" else "")
            if not isinstance(extension, str) or not EXTENSION.fullmatch(extension):
                raise JobError(f"invalid file extension for {name}")
            filename = f"{kind}-{i}.{extension}"  # the runner chooses every file name
            try:
                data = base64.b64decode(entry["data"], validate=True)
            except ValueError as error:
                raise JobError(f"{kind[:-1]} {name}: invalid base64") from error
            with open(os.path.join(folder, filename), "wb") as f:
                f.write(data)
            args.extend([flag, f"{name}:{filename}"])

    files("networks", "--network")
    files("datasets", "--dataset")
    parameters = job.get("parameters", {})
    if not isinstance(parameters, dict):
        raise JobError("parameters must be an object of name -> value")
    for name, value in parameters.items():
        if not isinstance(value, (str, int, float)) or isinstance(value, bool):
            raise JobError(f"invalid value for parameter {name}")
        value = str(value)
        if not NAME.fullmatch(name) or not PARAMETER_VALUE.fullmatch(value):
            raise JobError("invalid parameter name or value")
        args.extend(["--parameter", f"{name}:{value}"])
    properties = job.get("properties", [])
    if not isinstance(properties, list) or not all(isinstance(p, str) and NAME.fullmatch(p) for p in properties):
        raise JobError("properties must be a list of property names")
    for name in properties:
        args.extend(["--property", name])
    timeout = job.get("timeout", 600)
    if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= MAX_TIMEOUT:
        raise JobError(f"timeout must be a whole number of seconds from 1 to {MAX_TIMEOUT}")
    return args, timeout


def clean_up(process, folder):
    """Kill everything a job started and remove its files."""
    try:
        os.killpg(process.pid, signal.SIGKILL)  # Vehicle and every solver process it started
    except ProcessLookupError:
        pass
    if IN_CONTAINER:
        # Processes that left the job's process group, too. In the container every other process
        # of this user belongs to a job; kill(-1) spares this process and PID 1.
        try:
            os.kill(-1, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    shutil.rmtree(folder, ignore_errors=True)
    if IN_CONTAINER:  # anything a job left elsewhere in /tmp
        tmp = tempfile.gettempdir()
        for entry in os.listdir(tmp):
            path = os.path.join(tmp, entry)
            if os.path.isdir(path) and not os.path.islink(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                try:
                    os.remove(path)
                except OSError:
                    pass


# --- HTTP --------------------------------------------------------------------------------------


def printable(text):
    """Escape control characters, so requests cannot write terminal escape codes to the log."""
    return text.encode("unicode_escape").decode("ascii")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "easyNNV-runner"
    sys_version = ""
    timeout = SOCKET_TIMEOUT

    def log_message(self, fmt, *args):  # one line per request, no request bodies
        line = f"{getattr(self, 'command', '-')} {getattr(self, 'path', '-')} -> {fmt % args}"
        sys.stderr.write(printable(line) + "\n")

    def handle_expect_100(self):
        return True  # never answer "100 Continue" before the checks

    # --- checks ---------------------------------------------------------------

    def header(self, name):
        """The header's value if it was sent exactly once, else None."""
        values = self.headers.get_all(name) or []
        return values[0] if len(values) == 1 else None

    def allowed(self, need_token=True):
        """Reject before doing any work. Returns True if the request may proceed."""
        if self.header("Host") not in HOSTS:  # defeats DNS rebinding
            self.reply(403, {"error": "wrong Host"}, cors=False)
            return False
        # Browsers leave out Origin on same-origin GETs: then only the page this runner serves
        # (Sec-Fetch-Site, which pages cannot set) may go on. Anything else needs an allowed Origin.
        same_origin = self.header("Origin") is None and self.header("Sec-Fetch-Site") == "same-origin"
        if not (same_origin and os.path.isdir(SITE)) and self.header("Origin") not in ORIGINS:
            self.reply(403, {"error": "origin not allowed"}, cors=False)
            return False
        if self.headers.get("Transfer-Encoding") is not None:
            self.reply(400, {"error": "send a Content-Length, not chunked data"})
            return False
        if need_token:
            if not check_token(self.header("X-EasyNNV-Token")):
                self.reply(401, {"error": "wrong or missing token"})
                return False
            if not TAB.fullmatch(self.header("X-EasyNNV-Tab") or ""):
                self.reply(400, {"error": "missing tab id"})
                return False
        return True

    def cors_headers(self):
        if self.header("Origin") is None:  # same-origin request: no CORS headers needed
            return
        self.send_header("Access-Control-Allow-Origin", self.header("Origin"))
        self.send_header("Vary", "Origin")

    def reply(self, status, body, cors=True):
        data = json.dumps(body).encode()
        self.send_response(status)
        if cors:
            self.cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if status >= 400:
            # Unread request bytes must never be parsed as another request on this connection.
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        self.wfile.write(data)

    def body_length(self, limit):
        """The declared body length if it is valid and at most `limit`, else None (after replying)."""
        length = self.headers.get("Content-Length")
        if length is None or not LENGTH.fullmatch(length):
            self.reply(411, {"error": "Content-Length required"})
            return None
        if int(length) > limit:
            self.reply(413, {"error": f"request larger than {limit} bytes"})
            return None
        return int(length)

    def client_gone(self):
        """True if the page has closed its side of the connection."""
        try:
            readable, _, _ = select.select([self.connection], [], [], 0)
            return bool(readable) and self.connection.recv(1, socket.MSG_PEEK) == b""
        except OSError:
            return True

    def serve_site(self):
        """The page's own files (public, read-only): no token needed, but the Host is checked."""
        if self.header("Host") not in HOSTS:
            return self.reply(403, {"error": "wrong Host"}, cors=False)
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path in ("", "/"):
            path = "/index.html"
        file = os.path.realpath(os.path.join(SITE, path.lstrip("/")))
        kind = SITE_TYPES.get(os.path.splitext(file)[1])
        if not file.startswith(SITE + os.sep) or kind is None or not os.path.isfile(file):
            return self.reply(404, {"error": "not found"}, cors=False)
        with open(file, "rb") as handle:
            data = handle.read()
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(data)

    # --- endpoints ------------------------------------------------------------

    def do_OPTIONS(self):  # CORS preflight
        if not self.allowed(need_token=False):
            return
        self.send_response(204)
        self.cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-EasyNNV-Token, X-EasyNNV-Tab")
        if self.headers.get("Access-Control-Request-Private-Network"):
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path != "/status" and os.path.isdir(SITE):
            return self.serve_site()
        if not self.allowed():
            return
        if self.path != "/status":
            return self.reply(404, {"error": "not found"})
        tab_seen(self.header("X-EasyNNV-Tab"))
        self.reply(200, {"versions": VERSIONS, "solvers": list(SOLVERS), "busy": job_lock.locked(),
                         "maxTimeout": MAX_TIMEOUT, "idleTimeout": IDLE_TIMEOUT})

    def do_POST(self):
        if self.path == "/shutdown":
            # Sent with navigator.sendBeacon, which cannot set headers: the body is "<token> <tab>".
            if not self.allowed(need_token=False):
                return
            length = self.body_length(256)
            if length is None:
                return
            parts = self.rfile.read(length).decode("ascii", "replace").split()
            if len(parts) != 2 or not check_token(parts[0]) or not TAB.fullmatch(parts[1]):
                return self.reply(401, {"error": "wrong or missing token"})
            tab_closed(parts[1])
            return self.reply(200, {"closed": True})
        if not self.allowed():
            return
        if self.path != "/verify":
            return self.reply(404, {"error": "not found"})
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            return self.reply(415, {"error": "send application/json"})
        tab = self.header("X-EasyNNV-Tab")
        tab_seen(tab)
        length = self.body_length(MAX_BODY)
        if length is None:
            return
        if not job_lock.acquire(blocking=False):  # before reading: one upload at a time
            return self.reply(409, {"error": "a job is already running"})
        try:
            self.verify(self.rfile.read(length), tab)
        finally:
            job_lock.release()

    def verify(self, body, tab):
        global current
        folder = tempfile.mkdtemp(prefix="job-")
        try:
            job = json.loads(body)
            args, timeout = build_command(job, folder)
        except (ValueError, TypeError, OverflowError, RecursionError) as error:  # incl. JobError
            shutil.rmtree(folder, ignore_errors=True)
            return self.reply(400, {"error": str(error) if isinstance(error, JobError) else "invalid JSON"})
        except OSError:  # e.g. the temporary space is full
            shutil.rmtree(folder, ignore_errors=True)
            return self.reply(507, {"error": "could not store the job's files"})

        self.send_response(200)
        self.cors_headers()
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        def send(event):
            # A closed page makes this raise (directly, or on the next write): the job is then killed.
            if self.client_gone():
                raise ConnectionResetError("the page closed the connection")
            data = (json.dumps(event) + "\n").encode()
            self.wfile.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")
            self.wfile.flush()
            tab_seen(tab)

        process = subprocess.Popen(
            args, cwd=folder, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, start_new_session=True,
        )
        current = (process, folder)
        lines = queue.Queue()

        def read_output():
            for raw in process.stdout:
                lines.put(ANSI.sub("", raw.decode("utf-8", "replace")))
            lines.put(None)

        threading.Thread(target=read_output, daemon=True).start()
        started = time.monotonic()
        outcome = "finished"
        output_done = False
        try:
            send({"type": "started", "command": args})
            while True:
                if time.monotonic() - started > timeout:
                    outcome = "timeout"
                    break
                if output_done:
                    # Output has ended; wait for the process itself, still within the time limit.
                    try:
                        process.wait(timeout=KEEPALIVE)
                        break
                    except subprocess.TimeoutExpired:
                        send({"type": "keepalive"})
                        continue
                try:
                    line = lines.get(timeout=KEEPALIVE)
                except queue.Empty:
                    line = ""
                if line is None:
                    output_done = True
                    continue
                if not line and process.poll() is not None:
                    break  # Vehicle has exited; anything still holding its output is killed below
                send({"type": "output", "text": line} if line else {"type": "keepalive"})
            clean_up(process, folder)
            send({"type": "done", "outcome": outcome,
                  "exitCode": process.returncode if outcome == "finished" else None,
                  "seconds": round(time.monotonic() - started, 2)})
            self.wfile.write(b"0\r\n\r\n")
        except OSError:  # the page went away, or stopped reading for SOCKET_TIMEOUT seconds
            self.close_connection = True
        finally:
            clean_up(process, folder)
            current = None


class Server(ThreadingHTTPServer):
    """At most MAX_CONNECTIONS at once; further connections are closed at once."""

    daemon_threads = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.slots = threading.BoundedSemaphore(MAX_CONNECTIONS)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


def watchdog():
    """Stop the runner when no page is left: the last tab closed, or none was heard from for a while."""
    global deadline
    while True:
        time.sleep(1)
        now = time.monotonic()
        with state:
            for tab, seen in list(tabs.items()):
                if now - seen > IDLE_TIMEOUT:
                    del tabs[tab]
                    if not tabs:
                        deadline = now
            stop = not tabs and deadline is not None and now >= deadline and not job_lock.locked()
        if stop:
            print("No easyNNV page is open: stopping the runner.", flush=True)
            if current is not None:
                clean_up(*current)
            os._exit(0)


def main():
    if not re.fullmatch(r"[0-9a-f]{64}", TOKEN_SHA256):
        sys.exit("EASYNNV_TOKEN_SHA256 must be set: start the runner with the command on the easyNNV page.")
    if os.geteuid() == 0:
        print("Warning: running as root. Use the runner image, which runs as an unprivileged user.")
    server = Server(("0.0.0.0", 8765), Handler)  # Docker publishes it on 127.0.0.1 only
    threading.Thread(target=watchdog, daemon=True).start()
    print(f"easyNNV runner ready: Vehicle {VERSIONS['vehicle']}, Marabou {VERSIONS['maraboupy']}.", flush=True)
    print(f"Waiting for the page on http://127.0.0.1:{HOST_PORT}; it stops when the page closes.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
