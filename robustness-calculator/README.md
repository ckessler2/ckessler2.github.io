# Neural network robustness checker

A static, client-side tool that searches for adversarial counterexamples in
ONNX neural networks with projected gradient descent (PGD). Nothing is
uploaded and nothing needs installing. See `robustness_checker_brief.md` for
the original plan.

**PGD is a falsifier, not a verifier.** A counterexample proves that a network
is not robust; finding none proves nothing. The tool reports "counterexample
found" or "none found", and an *upper bound* on robust accuracy. It never
says "robust" or "verified".

## Using it

Press **Load benchmark** to fetch the built-in benchmark (see below), or check
your own classifier:

1. Choose the model (`.onnx`).
2. Choose a CSV of points: one row per point, the input features, then the
   class label.
3. Set ε (the L∞ radius) and press **Run attack**.

ε is in the model's own input units, so if the model expects normalised
inputs, ε is normalised too.

The **Advanced** section holds:

- Seed, restarts R (default 10), steps K (default 50), the step schedule
  (APGD by default, or constant-step PGD with step size α) and the tf.js
  backend.
- Clipping of the ε-box to a valid input range (for example, [0, 1] for
  images).
- An optional search for each point's smallest breaking ε.
- An untested VNNLIB mode.

Every report states the seed, settings and library versions, so a run can be
reproduced exactly.

## Benchmark

**Load benchmark** fetches the network `mnist-net_256x6` (784 → 6 × 256 ReLU →
10) and its 15 MNIST test images from the VNN-COMP 2022 `mnist_fc` benchmark
([benchmarks][vnncomp-bench], [results][vnncomp-results]). Nothing is hosted
in this repository.

- **Where it comes from:** the files are read from GitHub, pinned to one
  commit of the benchmark repository, which is about 2 MB.
- **Images and labels:** recovered in the browser from the ε = 0.03 property
  files. Each box is the image ± ε clipped to [0, 1], and pixels are k/255.
- **Defaults:** ε = 0.05, with inputs clipped to [0, 1], as in the benchmark.
- **Published verdicts:** stored in `src/spec/benchmark.js` (30 labels) and
  shown next to the tool's results. They come from the complete verifiers of
  VNN-COMP 2022 (also Table 27, pages 42–43, of the
  [report](https://arxiv.org/abs/2212.10376)).
  - **At ε = 0.03:** 14 robust, 1 not robust. That one is image 6, where 5
    verifiers reported a counterexample and 1 reported unsat.
  - **At ε = 0.05:** 12 robust, 2 not robust, and image 7 undecided (every
    verifier timed out). The exact robust accuracy is therefore 80.0–86.7%.
- **At the defaults:** the tool finds 1 of 2 non-robust images at ε = 0.05
  (upper bound 93.3%) and 1 of 1 at ε = 0.03 (93.3%, the exact value). The
  image it misses, image 1 at ε = 0.05, is missed by every attack variant
  tried.

Images are numbered from 0 here; the page's table numbers rows from 1.

[vnncomp-bench]: https://github.com/VNN-COMP/vnncomp2022_benchmarks/tree/main/benchmarks/mnist_fc
[vnncomp-results]: https://github.com/VNN-COMP/vnncomp2022_results

## Validation

| Check | Result |
|---|---|
| Unit tests on hand-made networks with known answers | 26/26 pass (`npm test`) |
| Seeded toy classifier (2 inputs, built in the test) vs exact branch and bound, ε = 0.1 | 5/40 points truly non-robust; the tool finds all 5 and no false counterexamples, with either step schedule. Robust accuracy 87.5% = exact value. |
| Toy classifier, smallest breaking ε (ε ≤ 0.5) | All 25 breakable points found. Never below the exact value; at most 0.7% above it. |
| ACAS Xu: tf.js translation vs onnxruntime-web, all 45 networks | Largest relative difference 1.8e-5. onnxruntime itself is 1.7e-5 from exact float64; tf.js is 3.8e-6. |
| Published VNN-COMP MNIST instances: 2022 `mnist_fc` (3 networks) and 2025 `cora_2024` (3 networks); 39 published sat, 90 published unsat | No false counterexamples on any unsat instance. Sat instances found: constant-step PGD (R = 10, K = 20) 34/39, also 34 with 9× the restarts; APGD 35/39 at K = 20 and 36/39 at K = 50 (the default). Per-class targeted attacks: no gain at 9× the cost. |

Re-run the comparisons with:

```sh
node tests/benchmarks/attack-variants.js [--unsat] [--only=i,j] <data-dir> ...
```

Each `<data-dir>` holds a benchmark's `onnx/` and `vnnlib/` folders
(decompressed) and a `ground_truth.json` built from the published results
([2022][vnncomp-results], [2025](https://github.com/VNN-COMP/vnncomp2025_results)).
Per-instance verdicts for the 2022 benchmark are also in Table 27 (pages
42–43) of the [VNN-COMP 2022 report](https://arxiv.org/abs/2212.10376).

## Running it locally

There is no build step. The site loads tf.js, onnxruntime-web and MathJax
from jsDelivr, with pinned versions in `src/lib/cdn.js`. Serve the repository
root over HTTP; module workers do not load from `file://`.

```sh
python3 -m http.server 8000   # from the repository root
# open http://localhost:8000/robustness-calculator/
```

Tests run in Node with the same library versions. `package.json` and
`node_modules/` are for development only.

```sh
cd robustness-calculator
npm install
npm test      # unit tests + exact comparison on the toy classifier
```

## Layout

The layout follows `../plate-model`: hash router, small state store,
DOM-building components, and the same stylesheet tokens.

```
src/
  onnx/      protobuf reader, ONNX model decoder, graph -> tf.js translator
  spec/      points.js (CSV mode), vnnlib.js (VNNLIB mode), benchmark.js (built-in benchmark)
  attack/    pgd.js (PGD and APGD schedule), objectives.js (incl. targeted),
             box.js (float32-safe boxes), rng.js (seeded),
             run-points.js, run-vnnlib.js
  check/     ort-check.js (onnxruntime-web forward pass + self-test)
  worker/    attack-worker.js (owns tf, ort and the model; loads libraries from CDN)
  app/, components/, pages/   UI
tests/       node:test suites; helpers/ (ONNX writer, seeded toy classifier,
             exact branch and bound); benchmarks/attack-variants.js
```

The core modules take `tf` and `ort` as arguments rather than importing them,
so the same code runs in the browser worker and in Node.

## Known limitations

- **Speed.** The default tf.js CPU backend is plain JavaScript. Run time grows
  with R × K for images that have no counterexample. At the defaults the
  benchmark took about 37 s in headless Chromium on a shared test machine, so
  it should be faster on a typical desktop.
- **Missed counterexamples.** Three of the 39 published counterexamples tried
  are missed by every variant, including image 1 of the benchmark at ε = 0.05.
- **Scope.** Fully connected networks only; no convolutional layers yet. L∞
  only.

## Related tools

No existing browser tool was found that combines ONNX loading, PGD and VNNLIB.
The closest is [adversarial.js](https://github.com/kennysong/adversarial.js),
an in-browser TensorFlow.js demonstration of FGSM, BIM and C&W attacks.
