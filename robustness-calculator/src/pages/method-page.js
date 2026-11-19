import { SUPPORTED_OPS } from "../onnx/translate.js";
import { el, code, link } from "../components/prose.js";
import { info } from "../components/ui.js";
import { docsPage, pageTitle, inShort, cards, defs, bullets, table, subhead, callout, p } from "../components/docs-layout.js";

// Estimate Method tab: how the in-browser estimate works. Scannable: "In short" first, then one
// section per part of the method, each opening with a one-sentence summary.

/** A second, muted line in a table cell. */
const note = (text) => el("span", "docs-cell-note", text);

export function renderMethodPage({ renderMath }) {
  const math = (tex) => {
    const block = el("div", "math-block");
    renderMath(tex, block, { inline: false });
    return block;
  };

  const header = [
    pageTitle("How Estimate works", "A quick robustness estimate for ONNX networks, computed in your browser."),
    inShort(
      p("For each point or property, Estimate gives one of three answers:"),
      cards(
        [
          {
            tone: "certified",
            title: "Certified",
            text: "CROWN bounds show that no input in the box changes the answer, in real arithmetic on the float64 network (as in VNN-COMP). Not a floating-point-sound proof.",
          },
          { tone: "counterexample", title: "Counterexample", text: "Definitely not robust (or unsafe): a concrete failing input, found by the attack and re-checked with onnxruntime." },
          { tone: "unknown", title: "Unknown", text: "Neither. The bounds were too loose to certify it, and the attack found no counterexample." },
        ],
        "docs-verdicts",
      ),
      bullets([
        [
          el("strong", "", "An estimate, not a complete verifier. "),
          "Robust accuracy is a range: at least the certified share, at most the share without a counterexample. For complete verification use ",
          link("#/verify", "Verify"),
          ".",
        ],
        ["Everything runs in your browser; nothing is uploaded. How well it works is on the ", link("#/estimate-results", "Results"), " tab."],
      ]),
    ),
  ];

  const sections = [
    {
      id: "inputs",
      title: "What it checks",
      summary: "You give it an ONNX network and a specification; the property decides what the specification is and which methods run.",
      body: [
        table(
          ["Property", "Specification", "Methods"],
          [
            ["Classification robustness", "CSV of inputs and labels, radius ε", "CROWN, then the attack"],
            [["Regression: standard robustness", note("‖x − x*‖∞ ≤ ε ⇒ ‖f(x) − f(x*)‖∞ ≤ δ")], "CSV of inputs, ε and δ", "Attack only"],
            [["Regression: Lipschitz robustness", note("‖x − x*‖∞ ≤ ε ⇒ ‖f(x) − f(x*)‖∞ ≤ L‖x − x*‖∞")], "CSV of inputs, ε and L", "Attack only"],
            [["Output constraints", note("input box ⇒ unsafe output condition")], "VNNLIB property files", "CROWN, input splitting, then the attack"],
          ],
        ),
        defs([
          ["Standard robustness", "The attack maximises the output change and reports the largest value found; a value above δ is a counterexample. Below δ means only that no violation was found."],
          ["Lipschitz robustness", "The attack maximises the ratio; the largest value found is a lower bound on the local Lipschitz constant. Distances below 1% of ε are floored, so float32 noise cannot inflate the ratio."],
          ["Output constraints", "Your own VNN-COMP property files (input boxes and linear output conditions combined with and/or). Each property is certified safe, shown unsafe by a counterexample, or left unknown."],
        ]),
        p(
          "The regression notions follow ",
          link("https://doi.org/10.1007/978-3-031-13185-1_11", "Casadio et al., “Neural Network Robustness as a Verification Property: A Principled Case Study” (CAV 2022)"),
          ". Both are checked by the attack only, so they can be shown violated but never certified.",
        ),
        p(
          "Robust accuracy is reported as a range: the certified share is a lower bound, the share without a counterexample an upper bound. The range collapses to the exact value when nothing is unknown.",
        ),
        callout("ε is in the model's own input units. If the network expects normalised inputs, ε and the points must be normalised too."),
        callout(
          "Neither method is complete. Certification can fail to certify robust points, and it holds for the real-valued network (with a float32 safety margin), not as a floating-point-sound proof; the attack can miss counterexamples. Only a complete verifier (for example α,β-CROWN or Marabou) decides every point.",
          "note",
        ),
      ],
    },
    {
      id: "crown",
      title: "Certification (CROWN)",
      toc: "Certification",
      summary: "CROWN passes linear bounds backwards through the network to show that no input in the box can change the answer.",
      body: [
        subhead("The network as a chain of layers"),
        p(
          "Consecutive affine operators (Gemm, MatMul; Add, Sub, Mul or Div by constants, such as input normalisation; plus Flatten, Reshape, Identity, Dropout) are merged into one matrix per layer. 2-D convolutions stay convolutions. This gives",
        ),
        math(String.raw`z_1 = W_1 x + b_1,\qquad z_k = W_k\,\mathrm{relu}(z_{k-1}) + b_k,\qquad y = z_n .`),
        p("Networks with other activations (Sigmoid, Tanh), pooling, branches, or a product of two inputs are reported as not certifiable; only the attack runs."),

        subhead("Bounding the outputs"),
        p(
          "CROWN (",
          link("https://arxiv.org/abs/1811.00866", "Zhang et al., 2018"),
          ") bounds linear functions of the outputs from below over the whole input box: the margins y",
          el("sub", "", "label"),
          " − y",
          el("sub", "", "j"),
          " for classification, the linear conditions of a property for regression. A ReLU whose input interval [l, u] contains 0 is replaced by two linear bounds:",
        ),
        math(String.raw`a\,z \;\le\; \mathrm{relu}(z) \;\le\; \frac{u\,(z - l)}{u - l},\qquad a = \begin{cases} 1 & u \ge -l \\ 0 & \text{otherwise.} \end{cases}`),
        defs([
          ["Hidden-layer intervals", "Each layer's [l, u] comes from the same backward pass applied to that layer, intersected with interval arithmetic. Layers wider than 1,024 units use interval arithmetic alone (much cheaper). The first layer's intervals are exact."],
          ["Certified when", "For a point: the smallest margin bound is positive. For a property: the bounds show that every unsafe case contains a condition that cannot hold anywhere in the box."],
        ]),

        subhead("Limits and safeguards"),
        bullets([
          [el("strong", "", "No ReLU splitting. "), "CROWN is incomplete: with many unstable ReLUs (larger ε, networks not trained for verifiability) the bound becomes very loose and nothing is certified."],
          [
            el("strong", "", "Input splitting for small properties. "),
            "Properties with at most 4 varying inputs that CROWN does not settle are split, widest input first, into up to 10,000 pieces. Each piece is bounded again, and the centre of each unsettled piece is tested as a counterexample. The cap is on pieces, not time, so results do not depend on the machine.",
          ],
          [
            el("strong", "", "Float32 margin. "),
            "Bounds are computed in float64 for the real-valued network, but the network runs in float32. A bound only counts if it clears its threshold by the larger of 10⁻⁵ × max(1, |threshold|) and ten times the largest float32 disagreement the self-test measured. A safety margin, not a formal float32 proof.",
          ],
          "Certified points and properties are not attacked. Certification applies to classification and output-constraint properties; standard and Lipschitz robustness are attack-only.",
        ]),
      ],
    },
    {
      id: "attack",
      title: "The attack (PGD / APGD)",
      toc: "The attack",
      summary: "Points and properties that are not certified are attacked: gradient steps search the box for an input that breaks the specification.",
      body: [
        p("For classification the attack minimises the margin"),
        math(String.raw`m(x) = y_{\text{label}}(x) - \max_{j \ne \text{label}} y_j(x),`),
        p(
          "which is negative exactly when x is misclassified, over the ε-ball (clipped to the input range, if given). For a regression property it minimises min over unsafe cases of max over their conditions of (aᵢ·y − bᵢ), which is ≤ 0 exactly when the unsafe condition holds.",
        ),
        defs([
          ["Step", ["Signed-gradient steps x ← clip(x − η·(u − l)·sign(∇m(x)), l, u), where l and u are the per-feature box bounds."]],
          [
            "Step size",
            [
              "APGD (",
              link("https://arxiv.org/abs/2003.01690", "Croce & Hein, 2020"),
              "): η starts at the full box width, momentum 0.75, and halves at checkpoints when progress stalls. ",
              info(
                "Checkpoints come after ⌊0.22K⌋ steps, then at gaps that shrink by ⌊0.03K⌋ down to ⌊0.06K⌋. A start halves its step and returns to its best point so far if fewer than 75% of its steps since the last checkpoint improved the margin, or if its best margin has not changed and its step was not just halved.",
              ),
              " Constant-step PGD (",
              link("https://arxiv.org/abs/1706.06083", "Madry et al., 2018"),
              ") is available under Advanced.",
            ],
          ],
          ["Starts", "R uniformly random starts of K steps each, batched into one tensor. The box centre and the box corner indicated by the gradient at the centre are always tried as well."],
          ["Stopping", "As soon as a counterexample is confirmed. A point already misclassified without perturbation counts as a counterexample."],
        ]),
        table(
          ["Property", "Starts R", "Steps K", "Why"],
          [
            ["Points (classification, standard, Lipschitz)", "10", "50", "every uncertified point is a high-dimensional ε-ball"],
            ["Regression properties", "400", "200", "the built-in boxes are low-dimensional and cheap to attack"],
          ],
          { caption: "Defaults (changeable under Advanced)" },
        ),
        subhead("Randomness and where it runs"),
        bullets([
          "Randomness comes from a seeded generator (mulberry32).",
          "Gradients come from a TensorFlow.js translation of the ONNX model, on the GPU (WebGL) by default, falling back to the CPU. On the CPU the same seed and settings give bit-for-bit identical results; on WebGL results can differ slightly between devices. This only changes which counterexamples are found, not their validity (each is re-checked with onnxruntime) and not certification (CROWN runs in float64 JavaScript).",
          "The attack runs in a Web Worker, so the page stays responsive, and Cancel stops it immediately.",
        ]),
        callout(
          "Gradient attacks can miss counterexamples that sit beyond a region where the margin first increases, or inside a very thin unsafe region. The Results tab shows how often this happens on the built-in benchmarks.",
          "note",
        ),
      ],
    },
    {
      id: "checks",
      title: "How results are checked",
      summary: "Every counterexample is re-checked independently, and the translation is tested before each run.",
      body: [
        defs([
          ["Counterexamples", "Clamped to the box and re-evaluated with onnxruntime-web, which runs the original ONNX file independently of the translation; the class change is then confirmed in float64. Candidates that fail are discarded and counted as spurious."],
          ["Box rounding", "Box bounds are rounded inwards to float32, so a counterexample lies inside the box exactly as specified. An input fixed to a value float32 cannot represent is set to the nearest float32, since a float32 network cannot be given the exact value."],
          ["Self-test", "Before each run, the translation is compared with onnxruntime-web on random inputs from the boxes (20 by default for points, 100 for properties). A warning appears if they differ by more than 10⁻⁴, relative to the size of the output vector."],
        ]),
      ],
    },
    {
      id: "epsilon-range",
      title: "Optional: ε range per point",
      toc: "ε range per point",
      summary: "Under Advanced, the tool can bisect ε for each point to bracket its true robustness radius.",
      body: [
        defs([
          ["Certified ε ≥", "the largest ε at which CROWN still certifies the point."],
          ["Breaking ε ≤", "the smallest ε at which the attack found a counterexample."],
        ]),
        p("The point's true robustness radius lies between the two."),
      ],
    },
    {
      id: "benchmarks",
      title: "Built-in benchmarks",
      summary: "Published VNN-COMP instances, fetched from the competition repositories at pinned commits and shown next to their published verdicts.",
      body: [
        callout(
          "Chosen among benchmarks whose operators the tool supports (fully connected and convolutional ReLU networks) and that are small enough for a browser. Left out: the two malbeware CNNs and the six largest nn4sys properties. Other VNN-COMP benchmarks are not included; many use operators (pooling, residual connections, other activations) or sizes the tool does not support. Results on other networks may be worse.",
          "note",
        ),
        subhead("Classification"),
        p("Each property file defines a box clip(x ± ε, 0, 1) around a test image, and the image and label are recovered from it. The 2022 images are snapped to k/255; the 2025 images are the box centres."),
        table(
          ["Benchmark", "Network", "Images", "ε"],
          [
            [
              ["VNN-COMP 2022 mnist_fc (", link("https://arxiv.org/abs/2212.10376", "report"), ", §4.9, Table 27)"],
              "784 → 2, 4 or 6 hidden layers of 256 ReLUs → 10",
              "15",
              "0.03, 0.05",
            ],
            [
              ["VNN-COMP 2025 cora_2024 (", link("https://arxiv.org/abs/2512.19007", "report"), ", §0.4.19)"],
              ["7 × 250 ReLU for MNIST, SVHN, CIFAR-10", note("models point, trades and set: standard, interval-bound propagation and set-based training")],
              "20 each",
              "0.1 (MNIST, SVHN), 2/255 (CIFAR-10)",
            ],
            ["VNN-COMP 2025 malbeware", "linear, 64 × 64 malware images → 25 families (the two convolutional models are not included)", "14–19 per ε", "1/255, 2/255, 3/255"],
          ],
          { className: "docs-table-wrapcells" },
        ),
        subhead("Regression"),
        p("Each is a network and a list of published property files."),
        table(
          ["Benchmark", "Network", "Properties"],
          [
            [
              "VNN-COMP 2025 collins_rul_cnn_2022",
              "3 CNNs predicting an engine's remaining useful life from a window of sensor readings. A property perturbs 2, 4, 8 or 16 readings and is unsafe if the prediction leaves an interval around the true value.",
              "12 settings of 4",
            ],
            [
              "VNN-COMP 2025 nn4sys learned index",
              "2 fully connected networks mapping a key to its position; safe if, for every key in each of up to 1,000 small ranges, the predicted position stays within bounds.",
              ["6 per network", note("the six largest (3,000–60,000 ranges, up to 12 MB each) are left out as too large for a quick in-browser check")],
            ],
            [
              "VNN-COMP 2022 reach_prob_density",
              "Fully connected models of dynamical systems (ground-collision avoidance, a robot, a Van der Pol oscillator); safe if, from every initial state in a box, the predicted state avoids an unsafe set.",
              "12 each",
            ],
          ],
          { className: "docs-table-wrapcells" },
        ),
        subhead("Published verdicts"),
        p(
          "Each instance carries the verdict of the competition's complete verifiers: robust, not robust, or undecided (every verifier timed out). Where verifiers disagreed, the instance is recorded as not robust, because a counterexample was submitted and the opposing claims were penalised. The verdicts appear next to the tool's results, and any contradiction is flagged.",
        ),
      ],
    },
    {
      id: "models",
      title: "Supported models",
      summary: "Feed-forward networks with one float32 input whose batch dimension is 1 or symbolic, with weights embedded in the .onnx file.",
      body: [
        bullets([
          "Certification additionally requires a single chain of layers with ReLU as the only nonlinearity.",
          "Gzipped files are decompressed in the browser.",
          "Any operator outside the list below is refused by name.",
        ]),
        el("p", "docs-eyebrow docs-ops-label", "Supported ONNX operators"),
        el("p", "docs-ops", SUPPORTED_OPS.join(" · ")),
      ],
    },
    {
      id: "not-included",
      title: "Not included",
      summary: "What Estimate deliberately leaves out to stay fast in the browser.",
      body: [
        bullets([
          "Full α-CROWN optimisation and branch and bound over unstable ReLUs, needed for state-of-the-art complete verification. Input splitting is only over low-dimensional inputs (at most 4 varying features for properties).",
          "Pooling, residual connections, grouped convolutions and activations other than ReLU (for certification).",
          "L2 perturbations.",
          "Gradient-free attacks (for example Square Attack). In our tests these found one counterexample that the gradient attack missed, but not reliably.",
        ]),
      ],
    },
  ];

  return docsPage({ header, sections, className: "docs-method" });
}
