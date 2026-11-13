# Neural network robustness checker

A static, client-side tool that searches for counterexamples to robustness
properties of ONNX neural networks with projected gradient descent (PGD).
Nothing is uploaded and nothing needs installing. See
`robustness_checker_brief.md` for the full plan.

**PGD is a falsifier.** A counterexample proves the network is not robust;
finding none proves nothing. The tool reports "counterexample found" or "no
counterexample found after R restarts × K steps", never "robust" or
"verified".

## Status

- **Step 1 (minimum tool): done.**
  - VNNLIB mode and robustness around points (classification, regression with
    standard δ, regression with Lipschitz L).
  - onnxruntime-web re-checks every counterexample.
  - Seeded and reproducible.
  - Runs in a Web Worker, with progress and cancel.
- **Step 2 (ACAS Xu benchmark run, results table, README scores): not done.**
  Smoke tests so far:
  - The translation agrees with onnxruntime-web on all 45 networks. The
    largest relative difference is 1.8e-5.
  - Translator check: onnxruntime itself is up to 1.7e-5 from an exact float64
    forward pass, while tf.js is within 3.8e-6.
  - Network 2_1 with property 2 gives sat in about 0.1 s in the browser.
- **Step 3 (IBP/CROWN bounds):** not started.

## Running it

There is no build step. The site loads tf.js, onnxruntime-web and MathJax
from jsDelivr, with pinned versions in `src/lib/cdn.js`. Serve the repository
root over HTTP; module workers do not load from `file://`.

```sh
python3 -m http.server 8000   # from the repository root
# open http://localhost:8000/robustness-calculator/
```

## Tests

The Node tests use the same library versions from npm. `package.json` and
`node_modules/` are for development only; the site does not use them.

```sh
cd robustness-calculator
npm install
npm test                       # unit tests on hand-made networks with known answers
node tests/make-examples.js    # regenerate examples/ (seeded, deterministic)
```

The tests cover:

- **Translator:** checked against exact answers and against onnxruntime-web.
- **VNNLIB parser:** DNF, input disjunctions, linear expressions, strictness,
  and clear errors for unsupported input.
- **Soundness:** properties that are known to be unsat must never come back sat.
- **Hand-calculated answers:** smallest breaking ε, maximum deviation and
  Lipschitz constant.
- **Float32 rounding:** box bounds are rounded inwards.
- **Reproducibility:** the same seed gives the same result.

## Layout

The layout follows `../plate-model`: hash router, small state store,
DOM-building components, and the same stylesheet tokens.

```
src/
  onnx/      protobuf.js (wire-format reader), onnx-model.js (ModelProto -> JS),
             translate.js (graph -> tf.js function)
  spec/      vnnlib.js (VNNLIB -> input regions + output DNF), points.js (CSV mode)
  attack/    pgd.js, objectives.js (margins/losses), box.js (float32-safe boxes),
             rng.js (seeded), run-vnnlib.js, run-points.js
  check/     ort-check.js (onnxruntime-web forward pass + self-test)
  worker/    attack-worker.js (owns tf, ort, model; loads libraries from CDN)
  app/       bootstrap, router, state, worker-client, math (MathJax)
  components/, pages/   UI
examples/    tiny ReLU net with sat/unsat properties; small classifier + points
tests/       node:test suites, ONNX writer for hand-made networks, example generator
```

The core modules take `tf` and `ort` as arguments rather than importing
them. That lets the same code run in the browser worker (loaded from the CDN)
and in Node (loaded from npm).

## Differences from the brief

- **Plain ES modules and JSDoc instead of TypeScript and Vite.** This matches
  plate-model and lets GitHub Pages serve the folder as-is.
- **A small hand-written protobuf reader instead of protobufjs plus
  `onnx.proto`.** It reads only the fields needed for ONNX.
- **Self-test threshold of 1e-4 instead of 1e-5.** The threshold is relative to
  the size of each sample's output vector. On ACAS Xu, onnxruntime's float32
  summation order alone gives up to 1.7e-5, as noted under Status. A real
  translation bug, such as a wrong transpose or broadcast, gives errors near 1.
- **CPU and WebGL tf.js backends only.** The CPU backend is the default and is
  deterministic. The WASM backend is not included.

## Related tools

No existing browser tool was found that combines ONNX loading, PGD and VNNLIB.
The closest is [adversarial.js](https://github.com/kennysong/adversarial.js),
an in-browser TensorFlow.js demonstration of FGSM, BIM and C&W attacks on
TensorFlow.js models.
