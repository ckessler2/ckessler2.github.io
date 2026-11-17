# ε-Ball Robustness Estimator

*Certified and attack bounds for neural network classifiers, in your browser.*

A static, client-side tool that checks ε-ball robustness of ONNX classifiers.
For each point it either **certifies** robustness with CROWN (a bound
propagation method), finds a **counterexample** with a gradient attack (PGD
with the APGD step schedule), or reports **unknown**. Robust accuracy is
reported as a range: certified share ≤ exact value ≤ share without a
counterexample. On every published VNN-COMP benchmark tried, the range
contains the published result, and on some it matches exactly. Nothing is
uploaded and nothing needs installing. The
original plan is in `robustness_checker_brief.md`; the page's **Method** tab
documents the method in full.

Neither half is complete. Certification is sound but has no branch and
bound, so it fails at larger ε, and the attack can miss counterexamples.
Only a complete verifier decides every point.

## Using it

1. Choose a model (`.onnx`) and a CSV of points (one row per point: the
   input features, then the class label). Alternatively, pick a built-in
   benchmark and press **Load benchmark**.
2. Set ε (the L∞ radius) and press **Run**.

ε is in the model's own input units, so if the model expects normalised
inputs, ε is normalised too.

**Advanced** holds:

- the certification switch;
- the per-point ε range (certified up to / broken from);
- input clipping (for example [0, 1] for images);
- seed, restarts R (default 10), steps K (default 50), step schedule and
  tf.js backend (WebGL by default; CPU for bit-for-bit reproducible attacks);
- the untested VNNLIB mode.

## Built-in benchmarks

Published VNN-COMP ε-ball classification instances (15 benchmarks, 18 settings), fetched on demand from the competition
repositories (pinned commits) and shown next to their published verdicts.
None of the files are hosted here.

| Benchmark | Network | Points | ε |
|---|---|---|---|
| VNN-COMP 2022 `mnist_fc` | 784 → 6, 4 or 2 × 256 ReLU → 10 | 15 MNIST images | 0.03, 0.05 |
| VNN-COMP 2025 `cora_2024` | 7 × 250 ReLU (models `set`, `point`, `trades`) for MNIST, SVHN, CIFAR-10 | 20 images each | 0.1 (MNIST, SVHN), 2/255 (CIFAR-10) |
| VNN-COMP 2025 `malbeware` | linear, 64 × 64 → 25 malware families | 14–19 images per ε | 1/255, 2/255, 3/255 |

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
| Unit tests (`npm test`) | 30/30 pass |
| Built-in benchmarks, default settings: 320 points in 18 network/ε settings (`node tests/benchmarks/crown.js`) | 0 contradictions with published verdicts. Certified 98/142 published-robust points; counterexamples for 145/150 published-non-robust points. The tool's range contains the published robust accuracy in all 18 settings, and equals the published value or range in 10 of them. |
| Small 2-input network vs exact branch and bound (`tests/exact-toy.test.js`, `tests/crown.test.js`) | The attack finds every non-robust point. The breaking ε is never below the exact value and at most 0.7% above it. CROWN certifies 134/142 robust (point, ε) pairs and never a non-robust one. |
| Translation vs onnxruntime-web | Within 2·10⁻⁵ relative on all 45 ACAS Xu networks. The CROWN layer chain matches onnxruntime on the benchmark networks and ACAS Xu. |

The per-benchmark table is on the page's **Results** tab (`src/pages/results-page.js`).

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
  bounds/    crown.js (layer-chain extraction and CROWN bounds)
  attack/    pgd.js (PGD / APGD schedule), objectives.js, box.js, rng.js,
             run-points.js (certify, then attack), run-vnnlib.js
  spec/      points.js (CSV mode), vnnlib.js (VNNLIB mode), benchmark.js (built-in benchmarks)
  check/     ort-check.js (onnxruntime-web forward pass + self-test)
  worker/    attack-worker.js (owns tf, ort, the model and its layer chain)
  app/, components/, pages/   UI (same structure and styles as ../plate-model)
tests/       node:test suites; helpers/ (ONNX writer, seeded toy classifier,
             exact branch and bound); benchmarks/ (crown.js, attack-variants.js, triage.js)
```

## Known limitations

The tool is designed to be fast rather than complete. The Results tab ("Where
the gaps come from") explains the two gaps in detail.

- **Certification is incomplete.** There is no branch and bound or α-CROWN,
  so it certifies little at larger ε or on networks not trained for
  verification. For example, on the 6×256 network at ε = 0.05 it certifies 0
  of 12 published-robust images: roughly 750–1,300 of the 1,536 ReLUs are
  unstable, and the margin bounds fall to between −300 and −16,000. No setting
  changes this.
- **Float32 is handled with a margin, not a proof.** Bounds are computed in
  float64 for the real-valued network; certification requires a margin bound
  above 10⁻³ to absorb float32 rounding, which is not a formal float32 proof.
- **The attack misses some counterexamples:** 5 of 150 published ones. The one
  analysed (6×256, prop_1, ε = 0.05) sits beyond a region where the margin
  first rises, so the gradient points away from it. More restarts or steps,
  targeted attacks and random sampling do not find it; a gradient-free Square
  Attack found it once but not reliably.
- **Scope:** fully connected ReLU networks for certification; L∞ only; CPU
  JavaScript (a benchmark run takes seconds to about a minute).
