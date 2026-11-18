# easyNNV

*Neural network verification from your browser.*

The page has two tools:

- **rapidNNV** (working): quick verification estimates that run entirely in
  the browser, with no setup. Described below.
- **VehicleWrapper** (first version): complete verification of
  [Vehicle](https://vehicle-lang.readthedocs.io/) specifications with
  Marabou, run by a local runner (a Docker container) behind the same page.
  See [VehicleWrapper](#vehiclewrapper).

The nav has a tab per tool, **rapidNNV** and **VehicleWrapper**; the active
tool's sub-tabs follow it on the same line (rapidNNV: Run, Method, Results;
VehicleWrapper: Run, Method). Older links (`#/check`, `#/method`,
`#/results`) still work.

## rapidNNV

A static, client-side tool that checks the robustness of ONNX networks: ε-ball
robustness of classifiers, and published-style regression properties (an
input box and an unsafe condition on the outputs). For each point or property
it either **certifies** it with CROWN (a bound propagation method), finds a
**counterexample** with a gradient attack (PGD with the APGD step schedule),
or reports **unknown**. Results are reported as a range: certified share ≤
exact value ≤ share without a counterexample. On every published VNN-COMP
benchmark tried (35 settings), the range contains the published result, and
in 23 it matches exactly. Nothing is
uploaded and nothing needs installing. The
original plan is in `robustness_checker_brief.md`; rapidNNV's **Method** tab
documents the method in full.

Neither half is complete. Certification is sound but has no branch and
bound, so it fails at larger ε, and the attack can miss counterexamples.
Only a complete verifier decides every point.

## Using it

1. Choose the robustness type.
2. Pick a built-in benchmark and press **Load benchmark**, or choose your own
   model (`.onnx`) and either a CSV of points (classification: one row per
   point, the input features, then the class label) or one or more VNNLIB
   property files (regression: output constraints).
3. For points, set ε (the L∞ radius). Press **Run**.

ε is in the model's own input units, so if the model expects normalised
inputs, ε is normalised too.

**Advanced** holds:

- the certification switch;
- the per-point ε range (certified up to / broken from);
- input clipping (for example [0, 1] for images);
- seed, restarts R, steps K and self-test samples (defaults: 10 / 50 / 20 for
  points, 400 / 200 / 100 for regression properties), step schedule and
  tf.js backend (WebGL by default; CPU for bit-for-bit reproducible attacks);
- (input splitting for regression properties with at most 4 varying inputs is
  automatic).

## Built-in benchmarks

Published VNN-COMP instances (32 benchmarks, 35 settings), fetched on demand
from the competition repositories (pinned commits) and shown next to their
published verdicts. None of the files are hosted here.

Classification (ε-balls around images):

| Benchmark | Network | Points | ε |
|---|---|---|---|
| VNN-COMP 2022 `mnist_fc` | 784 → 6, 4 or 2 × 256 ReLU → 10 | 15 MNIST images | 0.03, 0.05 |
| VNN-COMP 2025 `cora_2024` | 7 × 250 ReLU (models `set`, `point`, `trades`) for MNIST, SVHN, CIFAR-10 | 20 images each | 0.1 (MNIST, SVHN), 2/255 (CIFAR-10) |
| VNN-COMP 2025 `malbeware` | linear, 64 × 64 → 25 malware families | 14–19 images per ε | 1/255, 2/255, 3/255 |

Regression (input box ⇒ output conditions, as VNNLIB properties):

| Benchmark | Network | Properties |
|---|---|---|
| VNN-COMP 2025 `collins_rul_cnn_2022` | 3 CNNs predicting remaining useful life; 2–16 perturbed readings | 48, as 12 settings of 4 |
| VNN-COMP 2025 `nn4sys` learned index | 2 fully connected networks (key → position) | 12 (the 6 properties per network with ≤ 1,000 key ranges) |
| VNN-COMP 2022 `reach_prob_density` | fully connected dynamics models (gcas, robot, vdp) | 36 |

**Where the images come from:** they are recovered from the property files.
Each box is clip(x ± ε, 0, 1). The 2022 pixels are snapped to k/255; the 2025
images are the box centres.

**Where the verdicts come from:** they are in `src/spec/benchmark.js`, as
published by the competitions' complete verifiers:

- *robust* (unsat), *not robust* (sat) or *undecided* (every verifier timed
  out);
- where verifiers disagreed the instance is recorded as not robust, because a
  counterexample was submitted and the opposing claims were penalised.

Sources: [2022 results](https://github.com/VNN-COMP/vnncomp2022_results)
(also Table 27 of the [2022 report](https://arxiv.org/abs/2212.10376));
[2025 results](https://github.com/VNN-COMP/vnncomp2025_results)
([2025 report](https://arxiv.org/abs/2512.19007)).

## Validation

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 31/31 pass |
| Classification benchmarks, default settings: 320 images in 18 settings (`node tests/benchmarks/crown.js --tasks=classification`) | 0 contradictions with published verdicts. Certified 99/142 published-robust images; counterexamples for 145/150 published-non-robust images. The range contains the published robust accuracy in all 18 settings and equals it (or the published range) in 10. |
| Regression benchmarks, default settings: 96 properties in 17 settings (`node tests/benchmarks/crown.js --tasks=properties`) | 0 contradictions. Certified 45/64 published-safe properties; counterexamples for 29/32 published-unsafe ones. The range contains the published value in all 17 settings and equals it in 13. |
| Small 2-input network vs exact branch and bound (`tests/exact-toy.test.js`, `tests/crown.test.js`) | The attack finds every non-robust point. The breaking ε is never below the exact value and at most 0.7% above it. CROWN certifies 134/142 robust (point, ε) pairs and never a non-robust one. |
| Translation vs onnxruntime-web | Within 2·10⁻⁵ relative on all 45 ACAS Xu networks and 6·10⁻⁶ on the Collins CNNs. The CROWN layer chain matches onnxruntime on the benchmark networks (including convolutions) and ACAS Xu. |

The per-benchmark tables are on rapidNNV's **Results** tab (`src/pages/results-page.js`).

Further scripts in `tests/benchmarks/`:

- `attack-variants.js` compares attack variants;
- `triage.js` compares PGD signals against a gradient-free Square Attack.

Both download what they need into `.bench-cache/` (git-ignored), except
`attack-variants.js`, which takes local data directories.

## Running it locally

There is no build step. The site loads tf.js, onnxruntime-web and MathJax
from jsDelivr, with pinned versions in `src/lib/cdn.js`. Serve the repository
root over HTTP:

```sh
python3 -m http.server 8000   # from the repository root
# open http://localhost:8000/robustness-calculator/
```

Tests run in Node with the same library versions. `package.json` and
`node_modules/` are for development only.

```sh
cd robustness-calculator
npm install
npm test
node tests/benchmarks/crown.js     # validation on all built-in benchmarks
```

## Layout

```
src/
  onnx/      protobuf reader, ONNX model decoder, graph -> tf.js translator
  bounds/    crown.js (layer chain incl. convolutions; interval and CROWN bounds)
  attack/    pgd.js (PGD / APGD schedule), objectives.js, box.js, rng.js,
             run-points.js (points: certify, then attack),
             run-properties.js (properties: certify, split, then attack), run-vnnlib.js
  spec/      points.js (CSV mode), vnnlib.js (VNNLIB properties), benchmark.js (built-in benchmarks)
  check/     ort-check.js (onnxruntime-web forward pass + self-test)
  worker/    attack-worker.js (owns tf, ort, the model and its layer chain)
  vehicle/   runner-client.js (VehicleWrapper: connection, heartbeat, streaming a job)
  app/, components/, pages/   UI (same structure and styles as ../plate-model)
runner/      VehicleWrapper's local runner (Python server, Dockerfile, smoke test, example)
tests/       node:test suites; helpers/ (ONNX writer, seeded toy classifier,
             exact branch and bound); benchmarks/ (crown.js, attack-variants.js, triage.js)
```

## VehicleWrapper

Vehicle and Marabou do all the work; easyNNV only makes them easier to run.
On the **Run** tab:

1. Start the runner with the command the tab shows (it holds the SHA-256 of
   a random token made for this browser tab), then press **Connect**. The page contacts
   `http://127.0.0.1:8765` only after that, and checks in every 30 seconds.
2. Write a specification, or press **Load example**. The networks, datasets
   and parameters it declares each get an input.
3. Press **Verify**. Vehicle's output appears as it runs; **Cancel** stops it.

The runner stops by itself when the page closes. The **Method** tab explains
the design and the security measures in full.

`runner/` holds everything the tab runs on your machine:

| File | What it is |
| --- | --- |
| `server.py` | Local HTTP server (standard library only): runs `vehicle verify`, streams its output, and checks every request (Origin, Host, token, tab id, content type); tracks open tabs; kills everything a run started and empties `/tmp` after it |
| `Dockerfile` | `python:3.11-slim` plus the newest `vehicle-lang`, `maraboupy` and `typing-extensions` (`--no-deps`: nothing else), as an unprivileged user; nothing pinned |
| `smoke_test.py` | Starts the image hardened, verifies `example/`, checks the request rules and that the runner stops itself |
| `example/` | `spec.vcl` (one true property, one false) and its 2-input ReLU network `model.onnx` (made by `make-model.js`) |

`../.github/workflows/runner-image.yml` rebuilds the image daily with the
newest packages, runs the smoke test, and publishes
`ghcr.io/ckessler2/easynnv-runner` only if it passes and the contents changed.

The runner stops itself when the page goes: a closed tab stops a running job
within about 4 seconds, and an idle runner stops after 2 minutes without a
request (or 10 seconds after the page says it is closing).

To build and test it locally (needs Docker):

```sh
cd robustness-calculator
docker build --platform linux/amd64 -t easynnv-runner runner
python3 runner/smoke_test.py easynnv-runner
```

When the page is served locally (see below), the start command it shows adds
`-e EASYNNV_ORIGINS=<that origin>`, since the runner otherwise accepts only
`https://ckessler2.github.io`.

## Known limitations

The tool is designed to be fast rather than complete. rapidNNV's Results tab ("Where
the gaps come from") explains the two gaps in detail.

- **Certification is incomplete.** There is no branch and bound over ReLUs or
  α-CROWN (input splitting is used only for properties with ≤ 4 varying
  inputs), so it certifies little at larger ε, on networks not trained for
  verification, or on large regression boxes (reach_prob gcas and robot). For example, on the 6×256 network at ε = 0.05 it certifies 0
  of 12 published-robust images: roughly 750–1,300 of the 1,536 ReLUs are
  unstable, and the margin bounds fall to between −300 and −16,000. No setting
  changes this.
- **Float32 is handled with a margin, not a proof.** Bounds are computed in
  float64 for the real-valued network; a bound must clear its threshold by the
  larger of 10⁻⁵ × max(1, |threshold|) and 10× the float32 disagreement the
  run's self-test measures. This is not a formal float32 proof.
- **The attack misses some counterexamples:** 5 of 150 published ones in
  classification and 3 of 32 in regression (all on the robot benchmark; not
  analysed). The classification one
  analysed (6×256, prop_1, ε = 0.05) sits beyond a region where the margin
  first rises, so the gradient points away from it. More restarts or steps,
  targeted attacks and random sampling do not find it; a gradient-free Square
  Attack found it once but not reliably.
- **Scope:** ReLU networks built from dense and 2-D convolution layers for
  certification (no pooling or residual connections); L∞ only; the six
  largest learned-index properties are excluded as too large; a benchmark run
  takes seconds to about two minutes.
