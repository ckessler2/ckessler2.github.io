"""Smoke test for the runner image: python3 smoke_test.py IMAGE

Starts the image the way the page tells users to (hardened, port on 127.0.0.1 only), then checks
the example verification, the request checks and that the runner stops itself.
The daily image build publishes an image only if this passes.
"""

import base64
import hashlib
import json
import os
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

IMAGE = sys.argv[1]
PORT = "8765"
URL = f"http://127.0.0.1:{PORT}"
ORIGIN = "https://ckessler2.github.io"
TOKEN = secrets.token_hex(16)
TAB = secrets.token_hex(8)
HERE = os.path.dirname(os.path.abspath(__file__))
HARDENING = ["--init", "--read-only", "--tmpfs", "/tmp:size=2g", "--cap-drop=ALL",
             "--security-opt=no-new-privileges", "--memory=4g", "--cpus=2", "--pids-limit=256"]


def request(path, body=None, origin=ORIGIN, token=TOKEN, host=None, content_type="application/json", tab=TAB):
    headers = {"Content-Type": content_type}
    if tab:
        headers["X-EasyNNV-Tab"] = tab
    if origin:
        headers["Origin"] = origin
    if token:
        headers["X-EasyNNV-Token"] = token
    if host:
        headers["Host"] = host
    data = body if isinstance(body, bytes) or body is None else json.dumps(body).encode()
    req = urllib.request.Request(URL + path, data=data, headers=headers, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=300) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


def start(*extra_env):
    env = ["-e", f"EASYNNV_TOKEN_SHA256={hashlib.sha256(TOKEN.encode()).hexdigest()}", *[a for e in extra_env for a in ("-e", e)]]
    name = "easynnv-smoke-" + secrets.token_hex(4)
    subprocess.run(["docker", "run", "-d", "--rm", "--name", name, "-p", f"127.0.0.1:{PORT}:8765",
                    *HARDENING, *env, IMAGE], check=True, capture_output=True)
    for _ in range(60):
        try:
            if request("/status")[0] == 200:
                return name
        except OSError:
            pass
        time.sleep(1)
    raise SystemExit("runner did not start:\n" + logs(name))


def logs(name):
    return subprocess.run(["docker", "logs", name], capture_output=True, text=True).stdout


def running(name):
    return name in subprocess.run(["docker", "ps", "--format", "{{.Names}}"], capture_output=True, text=True).stdout


def wait_for_exit(name, seconds):
    for _ in range(seconds):
        if not running(name):
            return True
        time.sleep(1)
    return False


failures = []


def check(label, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + label)
    if not ok:
        failures.append(label)
        if detail:
            print("     " + detail[:2000].replace("\n", "\n     "))


name = start("EASYNNV_IDLE_TIMEOUT=15")
try:
    status, body = request("/status")
    print("status:", body)
    check("status reports versions", status == 200 and "vehicle" in json.loads(body)["versions"])

    job = {
        "specification": open(os.path.join(HERE, "example", "spec.vcl")).read(),
        "networks": {"f": {"data": base64.b64encode(open(os.path.join(HERE, "example", "model.onnx"), "rb").read()).decode()}},
        "solver": "Marabou",
        "timeout": 120,
    }
    status, body = request("/verify", job)
    events = [json.loads(line) for line in body.splitlines() if line]
    output = "".join(e.get("text", "") for e in events)
    check("verify streams events and finishes", status == 200 and events[-1].get("outcome") == "finished", body)
    check("true property is proved", "proved no counterexample" in output, output)
    check("false property has a counterexample", "found a counterexample" in output, output)
    check("no colour codes in output", "\x1b[" not in output)

    check("wrong origin rejected", request("/status", origin="https://evil.example")[0] == 403)
    check("missing origin rejected", request("/status", origin=None)[0] == 403)
    check("wrong Host (DNS rebinding) rejected", request("/status", host=f"evil.example:{PORT}")[0] == 403)
    check("missing token rejected", request("/status", token=None)[0] == 401)
    check("wrong token rejected", request("/status", token="x" * 32)[0] == 401)
    check("form-style POST rejected", request("/verify", b"a=b", content_type="text/plain")[0] == 415)
    check("unknown solver rejected", request("/verify", {**job, "solver": "sh"})[0] == 400)
    check("unsafe network name rejected", request("/verify", {**job, "networks": {"../x": job["networks"]["f"]}})[0] == 400)
    check("unsafe parameter rejected", request("/verify", {**job, "parameters": {"p": "1; rm -rf /"}})[0] == 400)

    # Raw requests that urllib cannot send.
    def raw(data, read_for=2.0):
        with socket.create_connection(("127.0.0.1", int(PORT)), timeout=read_for) as s:
            s.sendall(data)
            chunks = []
            try:
                while True:
                    chunk = s.recv(65536)
                    if not chunk:
                        break
                    chunks.append(chunk)
            except socket.timeout:
                pass
            return b"".join(chunks).decode("latin-1")

    good = (f"GET /status HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nOrigin: {ORIGIN}\r\n"
            f"X-EasyNNV-Token: {TOKEN}\r\nX-EasyNNV-Tab: {TAB}\r\n\r\n")
    smuggle = (f"POST /verify HTTP/1.1\r\nHost: evil.example\r\nOrigin: https://evil.example\r\n"
               f"Content-Type: text/plain\r\nContent-Length: {len(good)}\r\n\r\n{good}")
    reply = raw(smuggle.encode())
    check("a rejected request's body is not run as a second request", reply.count("HTTP/1.1") == 1, reply)
    reply = raw(f"POST /verify HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nOrigin: {ORIGIN}\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n".encode())
    check("chunked request bodies rejected", reply.startswith("HTTP/1.1 400"), reply)
    reply = raw(f"POST /shutdown HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nOrigin: {ORIGIN}\r\nContent-Length: 100000000\r\n\r\n".encode())
    check("large shutdown body refused before reading", reply.startswith("HTTP/1.1 413"), reply)
    reply = raw(good.replace(f"X-EasyNNV-Token: {TOKEN}", "X-EasyNNV-Token: \xff\xfe").encode("latin-1"))
    check("non-ASCII token rejected cleanly", reply.startswith("HTTP/1.1 401"), reply)
    reply = raw(good.replace("\r\n\r\n", f"\r\nOrigin: {ORIGIN}\r\n\r\n").encode())
    check("duplicate Origin header rejected", reply.startswith("HTTP/1.1 403"), reply)
    check("infinite timeout rejected cleanly", request("/verify", b'{"specification": "x", "timeout": 1e400}')[0] == 400)
    check("missing tab id rejected", request("/status", tab=None)[0] == 400)
    idle = [socket.create_connection(("127.0.0.1", int(PORT))) for _ in range(60)]
    for s in idle:
        s.sendall(b"GET /status HTTP/1.1\r\n")  # never finished
    time.sleep(1)
    try:
        status, _ = request("/status")
    except OSError:
        status = None
    for s in idle:
        s.close()
    time.sleep(1)
    check("idle connections are capped (runner still answers afterwards)", request("/status")[0] == 200)
    check("token is not in the container's environment",
          TOKEN not in subprocess.run(["docker", "exec", name, "sh", "-c", "cat /proc/[0-9]*/environ 2>/dev/null"], capture_output=True, text=True).stdout)

    status, _ = request("/shutdown", f"{TOKEN} {TAB}".encode(), token=None, content_type="text/plain", tab=None)
    check("shutdown accepted", status == 200)
    check("runner stops after shutdown", wait_for_exit(name, 30), logs(name))

    name = start("EASYNNV_IDLE_TIMEOUT=5")
    check("runner stops when the page goes quiet", wait_for_exit(name, 30), logs(name))
finally:
    subprocess.run(["docker", "rm", "-f", name], capture_output=True)

print(f"\n{len(failures)} failure(s)" if failures else "\nAll checks passed.")
sys.exit(1 if failures else 0)
