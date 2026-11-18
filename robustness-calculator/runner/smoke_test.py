"""Smoke test for the runner image: python3 smoke_test.py IMAGE

Starts the image the way the page tells users to (hardened, port on 127.0.0.1 only), then checks
the example verification, the request checks and that the runner stops itself.
The daily image build publishes an image only if this passes.
"""

import base64
import json
import os
import secrets
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
HERE = os.path.dirname(os.path.abspath(__file__))
HARDENING = ["--init", "--read-only", "--tmpfs", "/tmp:size=2g", "--cap-drop=ALL",
             "--security-opt=no-new-privileges", "--memory=4g", "--cpus=2", "--pids-limit=256"]


def request(path, body=None, origin=ORIGIN, token=TOKEN, host=None, content_type="application/json"):
    headers = {"Content-Type": content_type}
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
    env = ["-e", f"EASYNNV_TOKEN={TOKEN}", *[a for e in extra_env for a in ("-e", e)]]
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

    status, _ = request("/shutdown", TOKEN.encode(), token=None, content_type="text/plain")
    check("shutdown accepted", status == 200)
    check("runner stops after shutdown", wait_for_exit(name, 30), logs(name))

    name = start("EASYNNV_IDLE_TIMEOUT=5")
    check("runner stops when the page goes quiet", wait_for_exit(name, 30), logs(name))
finally:
    subprocess.run(["docker", "rm", "-f", name], capture_output=True)

print(f"\n{len(failures)} failure(s)" if failures else "\nAll checks passed.")
sys.exit(1 if failures else 0)
