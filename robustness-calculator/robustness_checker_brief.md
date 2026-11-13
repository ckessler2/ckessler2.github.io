# Brief: in-browser neural-network robustness checker

A handover brief for an AI or developer building the tool. It covers what we want, why, how to build a minimal version, and how to show its results are correct.

## 1. Goal

A static, client-side web app. Someone drops in an ONNX neural network and gets an honest estimate of how robust it is. Nothing is uploaded to a server and nothing needs installing. It should be embeddable in a personal website.

The method is adapted, not invented. The core is **projected gradient descent (PGD)** (Madry et al., 2018, "Towards Deep Learning Models Resistant to Adversarial Attacks"). PGD searches inside an allowed input region for an input that breaks a property.

**The rule the tool must never break:** PGD is a *falsifier*. A counterexample proves the model is not robust. Failing to find one proves nothing. The interface and reports must keep these apart: "counterexample found" vs "no counterexample found after N restarts × K steps". The tool must never say "robust" or "verified".

### Context

The owner is a PhD student who works on neural-network verification for gliding-drone control: the SAIV 2025 paper, using Vehicle/Marabou and CORA. That work defines two robustness notions for **regression** controllers. Given an input x\*, a radius ε, and constants δ and L:

- **Standard robustness:** ‖x − x\*‖ ≤ ε ⇒ ‖f(x) − f(x\*)‖ ≤ δ
- **Lipschitz robustness:** ‖x − x\*‖ ≤ ε ⇒ ‖f(x) − f(x\*)‖ ≤ L‖x − x\*‖

The tool should support these as well as the usual classification setting. Do **not** commit Marabou, CORA, or any Python dependency to the user-facing app.

## 2. Step 1: build the tool and get it working

### Stack

- TypeScript + Vite, built to a static site. No backend.
- **TensorFlow.js** for computation and gradients (`tf.grad` / `tf.valueAndGrad`).
  - Use the **CPU or WASM backend** for validation runs, so results are float32 and deterministic.
  - WebGL is optional for speed. It may lose precision on some devices.
- **onnxruntime-web** is used *only* as an independent forward pass to re-check counterexamples. It cannot give gradients for an arbitrary model: its training API needs artifacts prepared in Python.
- Run long attack loops in a **Web Worker** so the UI stays responsive. Show a progress bar and a cancel button.
- Use a **seeded random number generator**, and display the seed, so every run can be reproduced exactly.

### ONNX → TensorFlow.js translator (the main engineering task)

1. **Parse.** Decode the ONNX protobuf in the browser, for example with protobufjs and the official `onnx.proto`.
2. **Read initialisers (weights).** They come from `raw_data` (little-endian float32) or `float_data`.
3. **Reject unsupported features with a clear message.** Do not support external data files.
4. **Build a function from the graph.** Topologically sort the nodes and build a JavaScript function input → output from tf.js ops.
5. **Supported operators for the minimum product:** `Gemm` (with `transA`/`transB`/`alpha`/`beta`), `MatMul`, `Add`, `Sub`, `Mul`, `Div`, `Relu`, `Sigmoid`, `Tanh`, `Flatten`, `Reshape`, `Constant`, `Identity`.
   - Inspect the validation models in Step 2 and add any other operator they actually use.
   - Any other operator → refuse, naming the operator.
6. **Handle shapes.** Respect the declared input shape. Handle a batch dimension of size 1 or none, so restarts can run as one batch.
7. **Self-test on every load.** Compare the tf.js forward pass with onnxruntime-web on about 100 random inputs inside the input region. Warn if they differ by more than about 1e-5 relative.

### Inputs the app accepts

**Mode A: VNNLIB property (the standard verification format; needed for Step 2).**

- Parse the SMT-LIB subset used by VNN-COMP:
  - `(declare-const X_i Real)` and `(declare-const Y_j Real)`;
  - `(assert (<= X_0 c))` and `(assert (>= X_0 c))` for the input box;
  - output constraints that are linear comparisons between `Y_j` and constants or other `Y_k`;
  - `(assert (or (and ...) (and ...)))`, a disjunction of conjunctions.
- Some files also put disjunctions on the input side. Handle that by attacking each input box separately.
- **Semantics:** a VNNLIB file describes the *unsafe* condition. The result is **sat** if some input in the box makes the output constraint true; that input is a counterexample. The result is **unsat** if none does.

**Mode B: robustness around points (the "plug in any model" use).**

- The user uploads a CSV of points, and optionally labels or reference outputs.
- The user chooses ε and the norm. The minimum product supports L∞ only. Optionally the user can give per-feature bounds on the input domain, to clip the box.
- ε is in the **model's own input space**. If the model expects normalised inputs, the user must enter ε in normalised units. Say so in the interface: input normalisation caused real problems in the SAIV work.

### Attack (both modes reduce to "minimise a margin over a box")

- **Box constraint:** lower and upper bounds per input feature. Projection is element-wise clamping.
- **Margin for a VNNLIB conjunction:** write each output constraint as gᵢ(y) = aᵢ·y − bᵢ ≤ 0. Then
  - margin of a conjunction = maxᵢ gᵢ;
  - margin of a disjunction = min over its conjunctions.

  A margin ≤ 0 means the constraint holds, which is a counterexample. Minimise the margin. For gradients, either attack each disjunct separately or use the min directly.
- **Classification (Mode B):** use the standard margin, the logit of the true class minus the largest other logit. Minimise it; below 0 means misclassified.
- **Regression, standard robustness:** maximise ‖f(x) − f(x\*)‖∞. Report the maximum found, and a counterexample if it exceeds δ.
- **Regression, Lipschitz robustness:** maximise ‖f(x) − f(x\*)‖ / ‖x − x\*‖, away from x = x\*. The largest value found is an **empirical lower bound** on the local Lipschitz constant.
- **PGD settings:**
  - L∞ sign-gradient steps with per-feature step size α·(uᵢ − lᵢ). Default α = 2.5 / K, following the Madry et al. heuristic.
  - K = 100 steps by default.
  - R random restarts, uniformly initialised in the box. Default R = 100, batched into one tensor.
  - Always also try the box centre and corners near the gradient direction.
- **Early stopping** for VNNLIB and classification as soon as a counterexample is found.
- **Re-check every counterexample:**
  1. Clamp it to the box.
  2. Re-evaluate it with **onnxruntime-web**.
  3. Re-check the constraint in float64 arithmetic on the outputs.

  Report it only if it passes. Otherwise report "spurious candidate (numerical)".

### Outputs and metrics

- **VNNLIB mode:**
  - verdict: `sat (counterexample found)` or `unknown (no counterexample in R×K)`;
  - best margin achieved;
  - time taken;
  - the counterexample, downloadable in the VNN-COMP format: `sat` followed by `((X_0 v) ... (Y_0 v) ...)`.
- **Mode B, classification:**
  - clean accuracy;
  - **robust accuracy upper bound** at ε (the fraction of points not broken);
  - per-point **smallest successful ε**, found by binary search on ε, with its median and distribution.
- **Mode B, regression:**
  - per point: the largest output deviation found, and the empirical Lipschitz lower bound;
  - the pass/fail count against user δ and L.
- **Every report states:** the seed, R, K, α, the backend, and the sentence "Upper bounds on robustness from attacks; absence of a counterexample is not a proof."

### Out of scope for the minimum product

These are listed so they are not forgotten:

- L2 attacks;
- gradient-free attacks (Square Attack, SPSA) through onnxruntime-web for unsupported operators;
- convolutional layers;
- certified lower bounds (see Step 3).

## 3. Step 2: check the results against a published benchmark

### Benchmark: ACAS Xu (VNN-COMP version)

Why this one:

- It is the most widely used verification benchmark.
- It is small enough for a browser: 45 networks, each with 5 inputs, 6 hidden layers of 50 ReLU units, and 5 outputs.
- It is easy to explain:
  - The inputs are encounter geometry: distance ρ, angles θ and ψ, and own and intruder speeds.
  - The outputs are scores for 5 collision-avoidance advisories: clear-of-conflict, weak left, weak right, strong left, strong right. The *lowest* score is the chosen advisory.
  - The properties φ1–φ10 come from Katz et al., 2017 (Reluplex). Use the plain-English descriptions in that paper's appendix.
- Complete verifiers have already solved every instance, and the sat/unsat verdicts are published.

### Where to get it (check the URLs, don't trust them blindly)

- Models and properties: the VNN-COMP benchmark repositories, for example `stanleybak/vnncomp2021` or `ChristopherBrix/vnncomp2022_benchmarks` on GitHub, under `benchmarks/acasxu`. They contain ONNX files, VNNLIB files, and `instances.csv`.
- Ground-truth verdicts: the published VNN-COMP results, for example the `vnncomp2022_results` repository or the competition report.
  - Build a table of instance → sat/unsat. Take the verdict that the complete verifiers agree on.
  - Don't hard-code verdicts from memory.
- **Normalisation:** the VNNLIB bounds in this benchmark are already in the networks' **normalised** input and output space. Check this by reading the files; do not apply the original ACAS Xu normalisation again.

### Pass criteria

1. **Forward-pass agreement.** On all 45 networks, the tf.js translation matches onnxruntime-web within 1e-5 on random inputs.
2. **Soundness (must be perfect).** On every **unsat** instance, the tool reports no counterexample, because none exists. A reported counterexample on an unsat instance is a bug: fix it before anything else.
3. **Counterexamples are real.** Every counterexample on a **sat** instance passes the re-check in onnxruntime-web, and the downloaded file is in valid VNN-COMP format.
4. **Detection rate (the metric to report).** The fraction of **sat** instances where PGD finds a counterexample, with the time per instance, under default settings and the seed recorded.
   - Not every sat instance has to be found. Some ACAS Xu counterexamples sit in tiny regions that a falsifier may miss, and that is expected and should be reported honestly.
   - Plot detection rate against the number of restarts.
   - Compare qualitatively with falsifiers in the VNN-COMP reports, for example α,β-CROWN runs PGD before verifying.
5. **Reproducibility.** Re-running with the same seed and backend gives identical results.

### Deliverables of Step 2

- A results table: instance, ground truth, tool verdict, best margin, time.
- A script or page that re-runs the whole benchmark in the browser.
- A short README stating the scores for criteria 1–5.

### Optional cross-check for Mode B

Export one small MNIST fully-connected classifier to ONNX, for example from the VNN-COMP `mnist_fc` benchmark. Run PGD at a fixed ε, seed, R and K in the tool and in a reference Python library (torchattacks, Foolbox or IBM ART). Robust accuracy should agree within restart noise. This is done offline by the developer; it is not part of the app.

## 4. Do we need a neural-network verifier?

**Not for the minimum product.**

- Step 1 only *falsifies*.
- Step 2 uses verdicts that verifiers have *already published* as ground truth. Counterexamples check themselves by re-evaluation.

A verifier becomes necessary only:

- to produce ground truth for **new** models with no published verdicts. For example, the owner's SAIV controllers would be checked against Marabou, offline;
- to close the gap between "attack found nothing" and "proven safe".

### Step 3, later: certified lower bounds in the browser

Add **interval bound propagation (IBP)**, and later CROWN, for ReLU/tanh fully-connected networks. Both are sound but incomplete. The report then becomes:

> "certified up to ε = a (IBP), attack found at ε = b (PGD)"

That sandwich is the most useful output for users.

Check the IBP bounds against **auto_LiRPA** (Python, offline) on the same networks. The bounds should match to float tolerance.

## 5. Notes

- Before building, search for an existing browser-based robustness or falsification tool, to avoid duplicating one and to cite it if found.
- Keep the code modular, as separate parts:
  - `onnx/` (parse and translate);
  - `spec/` (VNNLIB and Mode B specifications);
  - `attack/` (PGD and margins);
  - `check/` (onnxruntime-web re-check);
  - `ui/`.

  Step 3 then only adds `bounds/`.
- Unit-test the translator and margins on tiny hand-made networks with known answers. Example: a 2-input ReLU network where the counterexample can be worked out by hand.
