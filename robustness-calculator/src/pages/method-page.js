import { SUPPORTED_OPS } from "../onnx/translate.js";
import { el, para, code, link, list } from "../components/prose.js";

export function renderMethodPage({ renderMath }) {
  const card = el("article", "page-card prose");
  const math = (tex) => {
    const block = el("div", "math-block");
    renderMath(tex, block, { inline: false });
    return block;
  };

  card.append(
    el("h2", "", "What this tool does"),
    para(
      "You give it an ONNX network and a specification. For point-based checks this is a CSV of inputs (plus labels for classification) with a radius ε; for property checks it is one or more VNNLIB files (input boxes with unsafe output conditions). For each point or property, the tool answers in one of three ways:",
    ),
    list([
      [el("strong", "", "certified"), ": proven robust. CROWN, a bound-propagation method, shows that no input in the ε-ball can change the class."],
      [el("strong", "", "counterexample"), ": proven not robust. An attack found an input in the ε-ball that is misclassified, and an independent forward pass confirmed it."],
      [el("strong", "", "unknown"), ": neither. The bounds were too loose to prove robustness and the attack found no counterexample."],
    ]),
    para(
      "Robust accuracy is therefore reported as a range: the share of certified points is a lower bound, the share of points without a counterexample is an upper bound, and the exact value lies in between. The range collapses to the exact value when no point is unknown.",
    ),
    el(
      "p",
      "warning-box",
      "Neither method is complete. Certification is sound but can fail to prove robust points robust; the attack can miss counterexamples. An unknown point may be either. Only a complete verifier (for example α,β-CROWN or Marabou) is guaranteed to decide every point.",
    ),
    para(
      "Regression has two point-based attack-only checks (standard δ and Lipschitz), and one property mode: an input box (for example a few perturbed sensor readings) with an unsafe condition on the outputs (for example, the prediction leaves a given interval). In the property mode, each property is likewise certified safe, shown unsafe by a counterexample, or left unknown.",
    ),
    para("Everything runs in your browser. Nothing is uploaded; the built-in benchmarks are downloaded from GitHub."),
    para("How well this works on published benchmarks is shown on the ", link("#/results", "Results"), " tab."),

    el("h2", "", "Certification (CROWN)"),
    para(
      "The network must be a chain of affine layers separated by ReLUs. On loading, consecutive affine operators (Gemm, MatMul, and Add, Sub, Mul or Div by constants, for example input normalisation, plus Flatten, Reshape, Identity and Dropout) are merged into one matrix per layer; 2-D convolutions are kept as convolutions rather than expanded into matrices. This gives",
    ),
    math(String.raw`z_1 = W_1 x + b_1,\qquad z_k = W_k\,\mathrm{relu}(z_{k-1}) + b_k,\qquad y = z_n .`),
    para(
      "Networks with other activations (Sigmoid, Tanh), pooling, branches, or a multiplication between two inputs are reported as not certifiable, and only the attack runs.",
    ),
    para(
      "CROWN (",
      link("https://arxiv.org/abs/1811.00866", "Zhang et al., 2018"),
      ") bounds linear functions of the outputs from below over the whole input box: the margins y_label − y_j for classification, and the linear conditions of a property for regression. It passes linear bounds backwards from the output to the input. A ReLU whose input interval [l, u] contains 0 is replaced by two linear bounds:",
    ),
    math(String.raw`a\,z \;\le\; \mathrm{relu}(z) \;\le\; \frac{u\,(z - l)}{u - l},\qquad a = \begin{cases} 1 & u \ge -l \\ 0 & \text{otherwise.} \end{cases}`),
    para(
      "The intervals [l, u] of each hidden layer come from the same backward pass applied to that layer, intersected with interval arithmetic; layers wider than 1,024 units use interval arithmetic alone, which is much cheaper. The first layer's intervals are exact. The resulting bound holds for every input in the box. A point is certified when the smallest margin bound is positive; a property is certified when every unsafe case contains a condition that provably cannot hold.",
    ),
    list([
      "There is no splitting of unstable ReLUs, so CROWN is incomplete: with many unstable ReLUs, typically at larger ε or in networks not trained for verifiability, the bound becomes very loose and nothing is certified.",
      "Low-dimensional properties (at most 4 varying inputs) that CROWN does not settle are refined by splitting the input box, widest input first, into up to 10,000 pieces. Each piece is bounded again, and the centre of each unsettled piece is tested as a counterexample. The cap is on pieces, not time, so results do not depend on the machine.",
      "The bounds are computed in float64 for the real-valued network. The deployed network runs in float32, so a bound only counts if it clears its threshold by a safety margin: the larger of 10⁻⁵ × max(1, |threshold|) and ten times the largest float32 disagreement between the translation and onnxruntime measured by the run's self-test. It is a safety margin, not a formal proof about float32 arithmetic.",
      "Certified points and properties are not attacked. Certification applies to classification and to regression properties; the standard and Lipschitz regression checks are attack-only.",
    ]),

    el("h2", "", "The attack"),
    para("Points that are not certified are attacked. The attack minimises the classification margin"),
    math(String.raw`m(x) = y_{\text{label}}(x) - \max_{j \ne \text{label}} y_j(x),`),
    para(
      "which is negative exactly when x is misclassified, over the ε-ball (clipped to the input range, if one is given). For a regression property the attack minimises min over unsafe cases of max over their conditions of (aᵢ·y − bᵢ), which is ≤ 0 exactly when the unsafe condition holds.",
    ),
    list([
      "It takes signed-gradient steps x ← clip(x − η·(u − l)·sign(∇m(x)), l, u), where l and u are the per-feature box bounds.",
      [
        "The step size follows APGD (",
        link("https://arxiv.org/abs/2003.01690", "Croce & Hein, 2020"),
        "). η starts at the full box width, with momentum 0.75. At checkpoints after ⌊0.22K⌋ steps, then at gaps that shrink by ⌊0.03K⌋ down to ⌊0.06K⌋, a start halves its step and returns to its best point so far if fewer than 75% of its steps since the last checkpoint improved the margin, or if its best margin has not changed and its step was not just halved. Constant-step PGD (",
        link("https://arxiv.org/abs/1706.06083", "Madry et al., 2018"),
        ") is available under Advanced.",
      ],
      "There are R uniformly random starts, each run for K steps, all batched into one tensor. The defaults depend on the robustness type: R = 10 and K = 50 for points (classification and the standard and Lipschitz regression checks), where every uncertified point is a high-dimensional ε-ball; R = 400 and K = 200 for regression properties, whose boxes in the built-in benchmarks are low-dimensional and cheap to attack. The box centre and the box corner indicated by the gradient at the centre are always tried as well.",
      "The attack stops as soon as a counterexample is confirmed. A point that is already misclassified without perturbation counts as a counterexample.",
      "Randomness comes from a seeded generator (mulberry32). Gradients are computed with tf.js on the GPU (WebGL) by default, falling back to the CPU if WebGL is unavailable. On the CPU backend, the same seed and settings give bit-for-bit identical results; on WebGL, results can differ slightly between devices. This affects only which counterexamples the attack finds, not their validity (each is re-checked with onnxruntime) and not certification (CROWN runs in float64 JavaScript).",
      "Gradients come from a TensorFlow.js translation of the ONNX model. The attack runs in a Web Worker, so the page stays responsive, and Cancel stops it immediately.",
    ]),
    para(
      "Gradient attacks can miss counterexamples that sit beyond a region where the margin first increases, or inside a very thin unsafe region. See the Results tab for how often this happens on the built-in benchmarks.",
    ),

    el("h2", "", "How results are checked"),
    list([
      "Every counterexample is clamped to the box and re-evaluated with onnxruntime-web, which runs the original ONNX file independently of the translation. The class change is then confirmed in float64. Candidates that fail are discarded and counted as spurious.",
      "Box bounds are rounded inwards to float32, so a counterexample lies inside the box exactly as specified, not just after rounding. An input fixed to a single value that float32 cannot represent is set to the nearest float32, since a float32 network cannot be given the exact value.",
      "Before each run, a self-test compares the translation with onnxruntime-web on random inputs from the boxes (20 by default for points, 100 for properties). A warning appears if they differ by more than 10⁻⁴, relative to the size of the output vector.",
    ]),

    el("h2", "", "Optional: ε range per point"),
    para(
      "Under Advanced, the tool can bisect ε for each point. “Certified ε ≥” is the largest ε at which CROWN still certifies the point; “breaking ε ≤” is the smallest ε at which the attack found a counterexample. The point's true robustness radius lies between the two.",
    ),

    el("h2", "", "Built-in benchmarks"),
    para(
      "These are published VNN-COMP instances, fetched from the competition's repositories (pinned commits). Each property file defines a box clip(x ± ε, 0, 1) around a test image, and the image and label are recovered from it. The 2022 images are snapped to k/255; the 2025 images are the box centres.",
    ),
    list([
      [
        "VNN-COMP 2022 mnist_fc: 784 → 2, 4 or 6 hidden layers of 256 ReLUs → 10; 15 images at ε = 0.03 and 0.05 (",
        link("https://arxiv.org/abs/2212.10376", "report"),
        ", Section 4.9 and Table 27).",
      ],
      [
        "VNN-COMP 2025 cora_2024: a 7 × 250 ReLU network for MNIST, SVHN and CIFAR-10, each in three models named point, trades and set (the report describes the training as standard, interval-bound propagation and set-based); 20 images each, at ε = 0.1 (MNIST, SVHN) and 2/255 (CIFAR-10) (",
        link("https://arxiv.org/abs/2512.19007", "report"),
        ", Section 0.4.19).",
      ],
      "VNN-COMP 2025 malbeware: a linear classifier of 64 × 64 malware images into 25 families; 14–19 images at each of ε = 1/255, 2/255 and 3/255. The benchmark's two convolutional models are not included.",
    ]),
    para("Regression benchmarks (each a network and a list of published property files):"),
    list([
      "VNN-COMP 2025 collins_rul_cnn_2022: three convolutional networks predicting the remaining useful life of an engine from a window of sensor readings. A property perturbs 2, 4, 8 or 16 readings and is unsafe if the prediction leaves an interval around the true value. Grouped by network and number of perturbed readings: 12 settings of 4 properties.",
      "VNN-COMP 2025 nn4sys learned index: two fully connected networks mapping a key to its position; a property is safe if, for every key in each of up to 1,000 small ranges, the predicted position stays within bounds. The six largest properties (3,000–60,000 ranges, up to 12 MB each) are left out as too large for a quick in-browser check.",
      "VNN-COMP 2022 reach_prob_density: fully connected models of dynamical systems (ground-collision avoidance, a robot, a Van der Pol oscillator); a property is safe if, from every initial state in a box, the predicted state avoids an unsafe set. 12 properties each.",
    ]),
    para(
      "Each instance comes with the published verdict of the competition's complete verifiers: robust, not robust, or undecided (every verifier timed out). Where verifiers disagreed, the instance is recorded as not robust, because a counterexample was submitted and the opposing claims were penalised. The verdicts appear next to the tool's results, and any contradiction is flagged.",
    ),

    el("h2", "", "Other modes"),
    list([
      "Regression, standard robustness (‖x − x*‖∞ ≤ ε ⇒ ‖f(x) − f(x*)‖∞ ≤ δ): the attack maximises the output change and reports the largest value found. A value above δ is a counterexample.",
      "Regression, Lipschitz robustness (‖f(x) − f(x*)‖∞ ≤ L‖x − x*‖∞): the attack maximises the ratio. The largest value found is a lower bound on the local Lipschitz constant. Distances below 1% of ε are floored, so float32 noise cannot inflate the ratio.",
      "Regression, output constraints (VNNLIB): your own VNN-COMP property files (input boxes and linear output conditions combined with and/or), checked as described above.",
    ]),
    el("p", "warning-box", "ε is in the model's own input units. If the network expects normalised inputs, ε (and the points) must be normalised too."),

    el("h2", "", "Supported models"),
    para(
      "These are feed-forward networks with one float32 input whose batch dimension is 1 or symbolic. The supported ONNX operators are ",
      code(SUPPORTED_OPS.join(", ")),
      "; any other is refused by name. Certification additionally requires a single chain of layers with ReLU as the only nonlinearity. Weights must be embedded in the .onnx file. Gzipped files are decompressed in the browser.",
    ),

    el("h2", "", "Not included"),
    list([
      "Full α-CROWN optimisation and branch and bound over unstable ReLUs, which are needed for state-of-the-art complete verification. Input splitting here is only over low-dimensional inputs (at most 4 varying features for properties).",
      "Pooling, residual connections, grouped convolutions and activations other than ReLU (for certification).",
      "L2 perturbations.",
      "Gradient-free attacks (for example Square Attack). In our tests these found one counterexample that the gradient attack missed, but not reliably.",
    ]),
  );

  return card;
}
