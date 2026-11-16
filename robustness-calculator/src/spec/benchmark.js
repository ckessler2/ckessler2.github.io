// The one built-in benchmark: VNN-COMP 2022 mnist_fc, network mnist-net_256x6
// (784 → 6×256 ReLU → 10), with its 15 MNIST test images.
//
// Nothing is hosted here: the network and the properties are fetched on
// demand from the benchmark repository, pinned to one commit. The images and
// labels are recovered from the property files (each box is the image ± ε,
// clipped to [0, 1]; pixels are k/255).
//
// The verdicts are the published results of the complete verifiers in
// VNN-COMP 2022 (https://github.com/VNN-COMP/vnncomp2022_results; Table 27 of
// the report, arXiv:2212.10376): "unsat" = proven robust, "sat" = a
// counterexample exists, "unknown" = every verifier timed out. For image 6 at
// ε = 0.03, five verifiers reported a counterexample and one reported unsat;
// it is recorded as sat.

import { parseVnnlib } from "./vnnlib.js";

const COMMIT = "ac970c9360423840f9f83a294cff55672fda454c";
const BASE = `https://raw.githubusercontent.com/VNN-COMP/vnncomp2022_benchmarks/${COMMIT}/benchmarks/mnist_fc`;

export const BENCHMARK = {
  label: "VNN-COMP 2022 MNIST, 6×256 ReLU network",
  modelName: "mnist-net_256x6.onnx",
  modelUrl: `${BASE}/onnx/mnist-net_256x6.onnx.gz`,
  // The ε = 0.03 property files are used only to recover the images.
  propertyUrls: Array.from({ length: 15 }, (_, i) => `${BASE}/vnnlib/prop_${i}_0.03.vnnlib.gz`),
  propertyEpsilon: 0.03,
  pointsName: "mnist_fc images 0–14",
  settings: { epsilon: 0.05, domainLoText: "0", domainHiText: "1" },
  reference: {
    source: "VNN-COMP 2022 mnist_fc, mnist-net_256x6: published verdicts of the complete verifiers",
    sourceUrl: "https://github.com/VNN-COMP/vnncomp2022_results",
    verdicts: {
      0.03: ["unsat", "unsat", "unsat", "unsat", "unsat", "unsat", "sat", "unsat", "unsat", "unsat", "unsat", "unsat", "unsat", "unsat", "unsat"],
      0.05: ["unsat", "sat", "unsat", "unsat", "unsat", "unsat", "sat", "unknown", "unsat", "unsat", "unsat", "unsat", "unsat", "unsat", "unsat"],
    },
  },
};

/**
 * Recover the centre point, label and ε of an MNIST ε-ball property whose box
 * is clip(x ± ε, 0, 1) and whose unsafe condition is "some Y_j ≥ Y_label".
 * Pixels are snapped to k/255 when `snap` is set.
 */
export function pointFromProperty(text, eps, { snap = false } = {}) {
  const spec = parseVnnlib(text);
  const { lo, hi, disjuncts } = spec.regions[0];
  // Each atom is Y_j − Y_label ≥ 0, stored as a·y − b ≤ 0: the label has coefficient +1.
  const label = disjuncts[0].atoms[0].a.findIndex((v) => v > 0);
  const x = lo.map((l, i) => {
    const h = hi[i];
    let v;
    if (l > 0 && h < 1) v = 0.5 * (l + h);
    else if (l <= 0 && h < 1) v = Math.max(0, h - eps);
    else if (h >= 1 && l > 0) v = Math.min(1, l + eps);
    else v = 0.5;
    return snap ? Math.round(v * 255) / 255 : v;
  });
  return { x, label };
}

/** Points CSV text (with a provenance header) from recovered images. */
export function pointsCsvText(points, header) {
  const fmt = (v) => (v === 0 ? "0" : String(Math.fround(v)));
  const rows = points.map(({ x, label }) => [...x.map(fmt), label].join(","));
  return `${header.map((h) => `# ${h}`).join("\n")}\n${rows.join("\n")}\n`;
}
