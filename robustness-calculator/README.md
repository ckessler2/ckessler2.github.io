# easyNNV

*Neural network verification from your browser.*

The page has two tools:

- **Estimate** (working): quick verification estimates that run entirely in
  the browser, with no setup. Described below.
- **Verify** (first version): complete verification of
  [Vehicle](https://vehicle-lang.readthedocs.io/) specifications with
  Marabou, run by a local runner (a Docker container) behind the same page.
  See [Verify](#verify).

The nav has a tab per tool, **Estimate** and **Verify**; the active
tool's sub-tabs follow it on the same line (Estimate: Run, Method, Results;
Verify: Run, Method). Older links (`#/check`, `#/method`, `#/results`, `#/rapid…`, `#/vehicle…`)
still work.

## Estimate

A static, client-side tool that checks the robustness of ONNX networks: ε-ball
robustness of classifiers, and published-style regression properties (an
input box and an unsafe condition on the outputs). For each point or property
it either **certifies** it with CROWN (a bound propagation method), finds a
**counterexample** with a gradient attack (PGD with the APGD step schedule),
or reports **unknown**. Results are reported as a range: certified share ≤
exact value ≤ share without a counterexample. On the built-in VNN-COMP
benchmarks (35 settings, chosen among those whose operators the tool
supports), the range contains the published result in every setting and
equals it in 23 (a comparison of aggregate ranges, not of individual points). Nothing is
uploaded and nothing needs installing. The
original plan is in `robustness_checker_brief.md`; Estimate's **Method** tab
documents the method in full.

Neither half is complete. "Certified" means the CROWN bounds show that no
input in the box changes the answer, in real arithmetic on the float64
network (as in VNN-COMP), with a float32 safety margin; it is not a
floating-point-sound proof. Certification has no branch and bound, so it
fails at larger ε, and the attack can miss counterexamples (a counterexample,
when found, is a concrete input re-checked with onnxruntime). Only a complete
verifier decides every point.

Regression around points comes in two attack-only modes: standard robustness
(outputs move by at most δ within ε) and Lipschitz robustness (output change
≤ L × input change), following
[Casadio et al., CAV 2022](https://doi.org/10.1007/978-3-031-13185-1_11).
They can show a violation but never certify, so passing points are reported
as "no violation found".

## Using it

1. Choose the robustness type.
2. Pick a built-in benchmark and press **Load benchmark**, or choose your own
   model (`.onnx`) and either a CSV of points (classification: one row per
   point, the input features, then the class label) or one or more VNNLIB
   property files (regression: output constraints).
3. For points, set ε (the L∞ radius). Press **Run**.

ε is in the model's own input units, so if the model normalises its inputs
outside the ONNX file, ε (and the points) must be normalised too.

Classification needs a model with at least two outputs (one logit per class)
and CSV labels below the number of outputs; otherwise **Run** is blocked with
a message (a single-output model always predicts class 0).

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
| Unit tests (`npm test`) | 39/39 pass |
| Classification benchmarks, default settings: 320 images in 18 settings (`node tests/benchmarks/crown.js --tasks=classification`) | No contradiction with published verdicts (no certified image is published non-robust and no counterexample is for a published-robust one; a soundness sanity check, not a measure of accuracy). Certified 99/142 published-robust images; counterexamples for 145/150 published-non-robust images. The range contains the published robust accuracy in all 18 settings and equals it (or the published range) in 10. |
| Regression benchmarks, default settings: 96 properties in 17 settings (`node tests/benchmarks/crown.js --tasks=properties`) | No contradiction with published verdicts. Certified 45/64 published-safe properties; counterexamples for 29/32 published-unsafe ones. The range contains the published value in all 17 settings and equals it in 13. |
| Small 2-input network vs exact branch and bound (`tests/exact-toy.test.js`, `tests/crown.test.js`) | The attack finds every non-robust point. The breaking ε is never below the exact value and at most 0.7% above it. CROWN certifies 134/142 robust (point, ε) pairs and never a non-robust one. |
| Translation vs onnxruntime-web | Within 2·10⁻⁵ relative on all 45 ACAS Xu networks and 6·10⁻⁶ on the Collins CNNs. The CROWN layer chain matches onnxruntime on the benchmark networks (including convolutions) and ACAS Xu. |

"Equals" compares the aggregate range with the published one, not
individual verdicts. The benchmarks were chosen among those whose operators
the tool supports (fully connected and convolutional ReLU networks) and that
fit in a browser: the two malbeware CNNs and the six largest nn4sys
properties were left out, and other VNN-COMP benchmarks (many with pooling,
residual connections or other activations) were not added, so results on
other networks may be worse.

The per-benchmark tables are on Estimate's **Results** tab (`src/pages/results-page.js`).

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
  vehicle/   runner-client.js (Verify: connection, heartbeat, streaming a job)
  app/, components/, pages/   UI (same structure and styles as ../plate-model)
runner/      Verify's local runner (Python server, Dockerfile, smoke test, example)
tests/       node:test suites; helpers/ (ONNX writer, seeded toy classifier,
             exact branch and bound); benchmarks/ (crown.js, attack-variants.js, triage.js)
```

## Verify

Vehicle and Marabou do all the work; easyNNV only makes them easier to run.
On the **Run** tab:

1. Start the runner with the command the tab shows (it holds the SHA-256 of
   a random token made for this browser tab), then press **Connect runner**. The page contacts
   `http://127.0.0.1:8765` only after that, and checks in every 5 seconds.
   If nothing answers within 10 seconds, or Chrome's local-network permission
   is denied, the page lists what to check and offers the same page served by
   the runner itself (`http://127.0.0.1:8765/`, same origin, so no browser
   permission is needed). Memory: 4 GB by default, 8 or 16 GB selectable.
2. Write a specification, or choose an example under **Open**: the built-in
   tiny network, or one of the Vehicle tutorial's examples (see below). The
   networks, datasets and parameters it declares each get an input, and
   **Properties** chooses which to verify.
3. Press **Verify**. Vehicle's output appears as it runs; **Cancel** stops it.
   Matrix-valued counterexamples (e.g. an image perturbation) are drawn next to
   the dataset image, and **Check with the network** confirms them in the
   browser with onnxruntime. **Run record** (under Full output) downloads a
   JSON file with the inputs' SHA-256 hashes, the image revision and every
   package version, the limits, the verdicts, and a `docker run` command that
   repeats the run with exactly the same image.

### Examples

Open lists the specifications of the
[Vehicle tutorial](https://vehicle-lang.github.io/tutorial/) that Marabou can
verify, fetched from
[vehicle-lang/vehicle-tutorial](https://github.com/vehicle-lang/vehicle-tutorial)
at a pinned commit when chosen (nothing is hosted here; see
`src/vehicle/examples.js`). Times are with the runner's 2 CPUs and 4 GB.

| Chapter | Example | Result |
| --- | --- | --- |
| 2 | ACAS Xu property 3, network 1_7 | counterexample, seconds |
| 2 | Iris classifier, sample answers to exercise 4 (properties 1–6) | 1 of 6 holds, seconds |
| 3 | MNIST robustness, 2 images, ε = 0.005 | both robust, ~40 s |
| 3 | Strong classification robustness (exercise 4) | both robust, ~5 s |
| 3 | Fashion-MNIST robustness, first 10 images (exercise 7) | all robust, ~50 s |
| 3 | Robustness over the box around 5 inputs (exercise 5 sample) | counterexample, seconds |
| 4 | ACAS Xu 1_8 before / after property-driven training, properties 1, 3, 4, 9 | 1 / 4 of 4 hold, 6 s / 20 s |
| 4 | Fashion-MNIST before / after property-driven training, first 10 images, ε = 0.02 | 6 / 8 of 10 robust, ~2 / ~3 min |
| 5 | Wind controller; with records (exercise 3); centred stability (exercise 4); with parameters (challenge) | all proved, seconds |

Left out, because Marabou or Vehicle 0.29 cannot run them: standard
robustness (exercise 5: two applications of the network), Euclidean
robustness (exercise 6: non-linear), the compiler-bug reproducers in
`chapter-3/solutions/repro`, the second box specification (`spec2.vcl`, which
does not compile), the incomplete exercise files, Iris property 0 (a file
check that does not compile), and chapter 6 (a separate 5 GB artifact).
The 50-image slices of chapters 3 and 4 need about 8 GB, more than the
runner's 4 GB, so the examples use their first 10 images.

The runner stops by itself when the page closes, or when you press
**Disconnect** (in the status menu at the top right). The **Method** tab explains
the design and the security measures in full.

`runner/` holds everything the tab runs on your machine:

| File | What it is |
| --- | --- |
| `server.py` | Local HTTP server (standard library only): runs `vehicle verify`, streams its output, and checks every request (Origin, Host, token, tab id, content type); tracks open tabs; kills everything a run started and empties `/tmp` after it; also serves a copy of this page |
| `Dockerfile` | `python:3.11-slim` plus the newest `vehicle-lang`, `maraboupy` and `typing-extensions` (`--no-deps`: nothing else), as an unprivileged user; nothing pinned; build context is `robustness-calculator/` |
| `smoke_test.py` | Starts the image hardened, verifies `example/`, checks the request rules, the served page and that the runner stops itself |
| `check_parser.mjs` | Runs the page's output parser on the smoke test's real Vehicle output |
| `example/` | `spec.vcl` (one true property, one false) and its 2-input ReLU network `model.onnx` (made by `make-model.js`) |

`../.github/workflows/runner-image.yml` rebuilds the image daily with the
newest packages, checks that the newest PyPI releases were really installed,
runs the smoke test and the parser check, and publishes
`ghcr.io/ckessler2/easynnv-runner` only if they pass and the contents changed.
Each published image is tagged `latest`, with the date, with a content hash and
with its revision (`YYYY-MM-DD-<commit>`, which `/status` and the run record
report). A failed scheduled build opens an issue.

The runner stops itself when the page goes: a closed tab stops a running job
within about 4 seconds, and an idle runner stops after 2 minutes without a
request (or 10 seconds after the page says it is closing).

To build and test it locally (needs Docker):

```sh
cd robustness-calculator
docker build --platform linux/amd64 -f runner/Dockerfile -t easynnv-runner .
python3 runner/smoke_test.py easynnv-runner
```

When the page is served locally (see below), the start command it shows adds
`-e EASYNNV_ORIGINS=<that origin>`, since the runner otherwise accepts only
`https://ckessler2.github.io`.

Keep `-p 127.0.0.1:8765:8765` as it is: publishing the port on all interfaces
(`-p 8765:8765` or `0.0.0.0`) would let other machines on your network reach
the runner (they would still need the token).

### Security: known limits

The Verify **Method** tab describes the security measures in full.
These limits are known and accepted for now:

- **Shared origin.** Everything under `ckessler2.github.io` shares one browser
  origin, so a script on this page, or on another page of the site that
  opened the easyNNV tab, could read that tab's runner token. easyNNV will
  move to its own site later.
- **Outbound network.** The runner container can make outbound connections;
  blocking them would need a more complex start command.
- **New releases.** The image takes new Vehicle and Marabou releases within a
  day, checked only by the smoke test. It installs nothing else (`--no-deps`),
  and there is no waiting period before new releases are used.
- **Worker libraries.** TensorFlow.js and ONNX Runtime are imported by code in
  Estimate's worker, so they cannot carry integrity hashes (the worker cannot
  read the token).

### Roadmap

1. **Done:** the runner, its image and the daily build, tested end to end on
   an example (one property proved, one refuted).
2. **Done:** the Run tab's first version (Connect, a `.vcl` editor with an
   example, inputs for the declared networks, datasets and parameters,
   Verify and Cancel, streamed output).
3. Testing in Chrome, Firefox and Safari (the page served by the runner is
   the way round if a browser blocks the public site).
4. VNNLib verifiers: Vehicle can compile specifications to VNNLib queries, so
   verifiers such as
   [α,β-CROWN](https://github.com/Verified-Intelligence/alpha-beta-CROWN) can
   be added to the solver list.
5. **Done:** verdict rows, counterexamples drawn and checked with the network,
   run records. Still to do: a better editor (Vehicle includes a language
   server), and reading `vehicle --json` events instead of the text output.
6. A combined mode: Estimate reads VNNLib, so it can first try Vehicle's
   compiled queries in the browser and send only the undecided ones to the
   runner.

### Open questions

- Browsers treat requests from a public site to your own machine
  differently. Recent Chrome asks for permission (the page detects a denial);
  Safari and Brave may block them entirely. To be tested; the page served by
  the runner avoids the question.
- Marabou cannot express strict inequalities (x < y), so Vehicle relaxes them
  to x ≤ y and warns. Counterexamples can then sit exactly on a boundary; the
  Run tab points this out when it happens.

## Known limitations

The tool is designed to be fast rather than complete. Estimate's Results tab ("Where
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
