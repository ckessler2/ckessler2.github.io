import { SUPPORTED_OPS } from "../onnx/translate.js";
import { DISCLAIMER } from "../attack/report.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function para(...parts) {
  const p = el("p");
  for (const part of parts) {
    if (typeof part === "string") p.append(part);
    else p.append(part);
  }
  return p;
}

function code(text) {
  return el("code", "", text);
}

function link(href, text) {
  const a = el("a", "inline-link", text);
  a.href = href;
  return a;
}

function list(items) {
  const ul = el("ul", "bullet-list");
  for (const item of items) {
    const li = el("li");
    if (Array.isArray(item)) li.append(...item);
    else li.append(item);
    ul.append(li);
  }
  return ul;
}

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
      "You give it a neural network in ONNX format and a property. It searches for an input that breaks the property, using projected gradient descent (PGD; ",
      link("https://arxiv.org/abs/1706.06083", "Madry et al., 2018"),
      "). Everything runs in your browser: the model is translated into TensorFlow.js to get gradients, and nothing is uploaded.",
    ),
    el("p", "warning-box", `PGD is a falsifier. A counterexample proves the network is not robust. Failing to find one proves nothing. ${DISCLAIMER}`),
    para(
      "So the tool reports either ",
      el("strong", "", "counterexample found"),
      " or ",
      el("strong", "", "no counterexample found after R restarts × K steps"),
      ". It never says “robust” or “verified”. For a proof you need a complete verifier such as Marabou or α,β-CROWN.",
    ),

    el("h2", "", "Properties"),
    el("h3", "", "VNNLIB (the VNN-COMP format)"),
    para(
      "A VNNLIB file declares inputs ",
      code("X_i"),
      " and outputs ",
      code("Y_j"),
      ", bounds each input to an interval, and states the ",
      el("em", "", "unsafe"),
      " condition on the outputs as linear comparisons, possibly combined with ",
      code("and"),
      " / ",
      code("or"),
      ". The instance is sat if some input in the box satisfies the unsafe condition. Disjunctions on the input side are handled by attacking each input box separately.",
    ),
    para("Each output constraint is written as gᵢ(y) = aᵢ·y − bᵢ ≤ 0. The attack minimises the margin"),
    math(String.raw`m(y) = \min_{\text{cases } c}\; \max_{i \in c}\; \big(a_i^\top y - b_i\big),`),
    para("which is ≤ 0 exactly when some case of the unsafe condition holds."),

    el("h3", "", "Robustness around points"),
    para("For a CSV of points x* and a radius ε (L∞), the box is ‖x − x*‖∞ ≤ ε, optionally clipped to an input domain."),
    list([
      "Classification: minimise the margin (true-class logit − largest other logit); below 0 means misclassified. Reported: clean accuracy, an upper bound on robust accuracy, and optionally each point's smallest breaking ε, found by binary search.",
      "Regression, standard robustness: ‖x − x*‖ ≤ ε ⇒ ‖f(x) − f(x*)‖ ≤ δ. The attack maximises ‖f(x) − f(x*)‖∞ and reports the largest value found.",
      "Regression, Lipschitz robustness: ‖x − x*‖ ≤ ε ⇒ ‖f(x) − f(x*)‖ ≤ L‖x − x*‖. The attack maximises the ratio; the largest value found is an empirical lower bound on the local Lipschitz constant. Distances below 1% of ε are floored, so float32 noise cannot inflate the ratio.",
    ]),
    el("p", "warning-box", "ε is in the model's own input space. If the network expects normalised inputs, ε must be given in normalised units too."),

    el("h2", "", "The attack"),
    list([
      "L∞ PGD: x ← clip(x − α·(u − l)·sign(∇m(x)), l, u), with per-feature step size α·(uᵢ − lᵢ). Default α = 2.5 / K, K = 100 steps.",
      "R random starts drawn uniformly in the box (default 100), batched into one tensor, plus the box centre and the corner the gradient at the centre points towards.",
      "VNNLIB and classification attacks stop as soon as a counterexample is confirmed.",
      "A seeded random number generator (mulberry32) makes every run reproducible: the same seed, settings and backend give the same result.",
      "The attack runs in a Web Worker, so the page stays responsive; Cancel stops it immediately.",
    ]),

    el("h2", "", "How results are checked"),
    list([
      "Self-test: before each run, the tf.js translation and onnxruntime-web are compared on sample inputs from the box. A difference above 1e-4 (relative to the output size) triggers a warning. The two libraries both use float32 but sum in different orders; on the ACAS Xu networks onnxruntime differs from an exact float64 forward pass by up to 1.7e-5.",
      "Every candidate counterexample is clamped to the box and re-evaluated with onnxruntime-web, which runs the original ONNX file independently of the translation. The property is then re-checked in float64. Only candidates that pass are reported; the others are counted as spurious.",
      "Box bounds are rounded inwards to float32, so a reported counterexample lies inside the box exactly as written in the property file, not just after rounding.",
    ]),

    el("h2", "", "Supported models"),
    para(
      "Feed-forward networks with one float32 input whose batch dimension is 1 or symbolic, and these ONNX operators: ",
      code(SUPPORTED_OPS.join(", ")),
      ". Any other operator is refused by name. Weights must be embedded in the .onnx file (no external data). Gzipped files (.gz, as VNN-COMP ships them) are decompressed in the browser.",
    ),

    el("h2", "", "Not yet included"),
    list([
      "L2 attacks.",
      "Gradient-free attacks for operators that cannot be translated.",
      "Convolutional layers.",
      "Certified lower bounds (interval bound propagation, CROWN), which would turn the report into “certified up to ε = a, attack found at ε = b”.",
    ]),
  );

  return card;
}
