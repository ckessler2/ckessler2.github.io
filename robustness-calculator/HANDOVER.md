# easyNNV handover

State as of 2026-11-19, commit `a4ddaaf` on `main`. This note is for the next working
session. The README covers the details; this note covers what isn't written there.

## What it is

easyNNV is a static site in this folder (no build step; vanilla ES modules), served by GitHub
Pages at https://ckessler2.github.io/robustness-calculator/. It has two tools:

- **Estimate** (`#/estimate`, `-method`, `-results`): in-browser bounds on robust accuracy for an
  ONNX model.
  - Certifies with CROWN (`src/bounds/crown.js`, float64).
  - Attacks with PGD/APGD (`src/attack/`), re-checked in onnxruntime-web.
  - tf.js and onnxruntime come from jsDelivr (`src/lib/cdn.js`) and run in a worker.
  - Benchmarks are VNN-COMP sets (`src/spec/benchmark.js`).
- **Verify** (`#/verify`, `-method`): a `.vcl` editor that runs Vehicle and Marabou in a local
  Docker container (the "runner").
  - The user pastes a `docker run` command shown on the page and presses Connect runner.
  - Runner: `runner/server.py`, a Python stdlib HTTP server wrapping `vehicle verify`. Image
    `ghcr.io/ckessler2/easynnv-runner`, linux/amd64, Python 3.11.
  - Browser side: `src/vehicle/runner-client.js` (connection, token, heartbeat, beacon),
    `src/pages/vehicle-page.js` (UI), `src/vehicle/output.js` (parses Vehicle's text output),
    `src/vehicle/examples.js` (examples), `src/vehicle/counterexample.js` (counterexample images
    and the onnxruntime check).

## The owner's preferences and decisions (don't re-open these)

- **Keep it a thin wrapper.** As little code as possible, and the **newest** Vehicle, Marabou and
  image (unpinned, rebuilt daily). Reproducibility comes from revision tags and run records, not
  from pinning.
- **Keep the UI minimal.** Show little by default, with details on demand (ⓘ popovers,
  disclosures). Keep the existing look and structure, with well-structured Method pages rather
  than collapsed sections. Short names: easyNNV, **Estimate**, **Verify**. A **Train** tool
  (Vehicle's property-driven training) comes later; don't start it unasked. VNNLIB verifiers
  (α,β-CROWN) come later too.
- **The runner is tied to the tab.** It stops when the tab closes or crashes: a beacon, a
  heartbeat every 5 s, a 120 s idle timeout and a 10 s grace period for reloads. There is also a
  Disconnect button.
- **Accepted, documented security limits** (README "Security: known limits"; the owner said this
  is enough security work for now):
  - the tool shares the github.io origin (it gets its own site later);
  - no cooldown before new releases are used;
  - the container may make outbound network connections.
- **Pushing:** the owner asked for finished work to go straight to `main`, as well as to the
  session branch. Commit or push only finished, tested work.
- **Licence:** MIT and CITATION.cff were added. Confirm the licence choice with the owner if it
  comes up.

## How to work on it

```bash
cd robustness-calculator
npm test
```

The unit tests use node:test; 39 pass.

To serve the site, run this from the repo root and open
http://localhost:8000/robustness-calculator/:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

In a local copy, the start command adds `-e EASYNNV_ORIGINS=http://localhost:8000` automatically.

Build and test the runner:

```bash
docker build --platform linux/amd64 -f runner/Dockerfile -t easynnv-runner:test .
```

```bash
EASYNNV_SMOKE_OUTPUT=/tmp/out.txt python3 runner/smoke_test.py easynnv-runner:test
```

```bash
node runner/check_parser.mjs /tmp/out.txt
```

The smoke test has 33 checks: verification, request rules, the served page and the runner
stopping itself.

### Sandbox notes (cloud sessions)

- **Docker:** if the daemon is down, start it with `(dockerd > /tmp/dockerd.log 2>&1 &)`.
- **pip inside `docker build` fails TLS** because of the agent proxy's CA. Earlier sessions
  re-tagged `python:3.11-slim` locally as an image with the CA added (copy the CA into the image,
  then set `PIP_CERT` and `SSL_CERT_FILE`). Never change the real Dockerfile for this.
- **The jsDelivr and unpkg CDNs are blocked.** In Playwright, intercept them with `page.route`
  and serve the files from `node_modules` (onnxruntime-web and tfjs are installed there).
  `raw.githubusercontent.com` works, so the Verify examples load.
- **Playwright** is preinstalled: `require('playwright')`, `chromium.launch()`. Don't install it.
  Start the runner from the page's own command, swapping in `easynnv-runner:test` and dropping
  `--pull=always`. Wait until the runner answers before opening `http://127.0.0.1:8765/`.
- **Vehicle sources** for reference: `/home/user/vehicle-lang/vehicle`, `vehicle-tutorial`,
  `vehicle-specification-editor` (clone them if missing; they are public).

## Runner security model (keep it intact)

- **Request checks:**
  - Host must be `127.0.0.1:PORT` or `localhost:PORT` (defeats DNS rebinding).
  - Origin must be on the allowlist (`https://ckessler2.github.io`, plus `EASYNNV_ORIGINS`;
    never `null`). The page the runner serves itself is the exception: its requests carry
    `Sec-Fetch-Site: same-origin` and no Origin.
  - Token: the container only knows its SHA-256 (`EASYNNV_TOKEN_SHA256`). The token is in the
    tab's sessionStorage; the runner-served page receives it via the URL fragment
    `#/verify?token=…` and strips it at once.
  - `X-EasyNNV-Tab` header on every request.
  - Headers must not be repeated; chunked bodies are refused; JSON only; every error reply
    closes the connection.
- **Limits:** 32 connections and a 20 s socket timeout.
- **Cleanup:** after every job the runner kills the process group plus `kill(-1)` and wipes `/tmp`.
- **Static files:** `serve_site()` serves only files under `/app/site`, by file type
  (path-traversal checked; tested in the smoke test).
- **Container flags:** `--read-only --tmpfs /tmp --cap-drop=ALL no-new-privileges --memory
  --cpus=2 --pids-limit=256 -p 127.0.0.1:8765:8765`.

## CI (`.github/workflows/runner-image.yml`)

- Runs daily, on push to main (the path filter covers `robustness-calculator/**` except `.md`)
  and on pull requests.
- Builds with context `robustness-calculator/`, then:
  1. asserts the newest PyPI releases of vehicle-lang and maraboupy were installed;
  2. runs the smoke test and the parser check;
  3. fingerprints the image, which includes the site files.
- Publishes only on main, and only if the contents changed. Tags: `c-<hash>`, the revision
  `YYYY-MM-DD-<sha7>`, the date, and `latest`.
- A failed scheduled build opens an issue.
- The last run (on `a4ddaaf`) succeeded.

## Facts learned the hard way

- **Vehicle's output:**
  - Progress lines can end with `\r`, and colour codes can appear; `displayText()` handles both.
    That bug made Iris rows show as "unknown".
  - Vehicle has a stable machine-readable mode, `vehicle --json verify`, which streams events,
    and `vehicle --json list` lists declarations. Counterexample values are not in the JSON.
- **The official GUI:** `vehicle-lang/vehicle-specification-editor` (PyQt6, `pip install
  vehicle-gui`) is the Vehicle team's own GUI. It uses the JSON events.
- **maraboupy 2.0.0** (April 2024, still the latest) has wheels only for x86 Linux and Intel
  macOS, Python 3.8–3.11. That is why the image is amd64 on Python 3.11, and why Verify is
  useful at all: Marabou can't be pip-installed on Apple Silicon, Windows or Python 3.12+.
- **Tutorial files:** some files in the tutorial repo are symbolic links, and GitHub's raw URLs
  return a link's target path instead of the file. `examples.js` uses the real paths
  (`resources-by-dataset/…`), and a unit test guards this.
- **Memory:** the tutorial's 50-image Fashion-MNIST slices need about 7.7 GB, so the examples use
  the first 10 (`firstEntries()` cuts IDX files in the browser).
- **Timings with 2 CPUs:**

  | Example | Result | Time |
  |---|---|---|
  | Tiny network, ACAS Xu, Iris, wind | — | 1–3 s |
  | MNIST | — | 46 s |
  | Strong classification robustness | — | 5 s |
  | Fashion-MNIST, 10 images | — | 45 s |
  | Chapter 4 Fashion-MNIST, before training | 6 of 10 robust | about 2 min |
  | Chapter 4 Fashion-MNIST, after training | 8 of 10 robust | about 3 min |
  | ACAS Xu 1_8, before training | 1 of 4 hold | 6 s |
  | ACAS Xu 1_8, after training | 4 of 4 hold | 21 s |

- **Tutorial specs Marabou can't run:** standard robustness (two network applications),
  Euclidean robustness (non-linear; Vehicle 0.29 crashes), `hyperrec/spec2.vcl` (doesn't
  compile) and Iris `property0` (it starts unticked).

## Backlog, roughly by priority

1. **The Vehicle team:** the owner may talk to them about positioning (the official no-install
   route for the tutorial?) or contributing the image. Wait for the owner's decision.
2. **Use `vehicle --json` events for verdicts,** keeping the text parser only for counterexample
   values. `/declarations` could use `vehicle --json list`.
3. **Browser matrix:** test Safari, Firefox and Brave, and Chrome 142+'s local-network
   permission. Also whether the `sendBeacon` to `/shutdown` gets through that permission.
4. **Estimate credibility:**
   - cross-check CROWN bounds against auto_LiRPA numerically;
   - compare with published VNN-COMP verdicts point by point;
   - run the original VNNLIB files instead of reconstructed boxes;
   - treat ties as unsafe, as VNN-COMP does (`misclassified()` in `src/attack/run-points.js`
     uses `>`). This changes results, so rerun the benchmarks.
5. **Supply chain:** sign images (cosign keyless) and add build provenance.
6. **Maintenance:**
   - a keepalive for the scheduled workflow (GitHub disables schedules after 60 days without
     activity);
   - a plan for Python 3.11's end of life (October 2027).
7. **Smaller:**
   - a Codespaces route (needs a token flow for the runner-served page);
   - a start command for offline or cached use (`--pull=missing`);
   - a configurable port (the client hard-codes 8765);
   - per-field `aria-label`s on the ⓘ buttons;
   - names for Fashion-MNIST class indices in the counterexample check.
8. **Bigger, only when asked:**
   - Vehicle's language server in the editor;
   - Estimate as a first pass that sends only undecided queries to Marabou;
   - Train, with a before/after comparison.

## Conventions

- **Writing:** plain, short sentences in UI and docs. Every tool or file name in docs must be
  correct.
- **Testing before reporting:** run the tests, the smoke test, and a browser check at 1280 px and
  375 px (no horizontal scroll, no page errors).
- **Repository text:** no model names in commits or code. End commit messages with the
  attribution trailer the session's instructions give.
