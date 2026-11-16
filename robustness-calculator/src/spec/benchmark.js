// Built-in benchmarks: published VNN-COMP instances with known verdicts.
//
// Nothing is hosted here: each network and its property files are fetched on
// demand from the benchmark repositories, pinned to one commit. The images and
// labels are recovered from the property files (each box is the image ± ε,
// clipped to [0, 1]).
//
// Verdicts are the published results of the complete verifiers:
//   "unsat"   = proven robust,
//   "sat"     = a counterexample exists (a verifier submitted one),
//   "unknown" = every verifier timed out or gave up.
// Where verifiers disagreed, "sat" is used: a counterexample is evidence,
// and the disagreeing "unsat" claims were penalised by the competition.

import { parseVnnlib } from "./vnnlib.js";

const VNN2022 =
  "https://raw.githubusercontent.com/VNN-COMP/vnncomp2022_benchmarks/ac970c9360423840f9f83a294cff55672fda454c/benchmarks/mnist_fc";
const VNN2025 =
  "https://raw.githubusercontent.com/VNN-COMP/vnncomp2025_benchmarks/8b7b811b78ce6a329dc96f04ae6652da3c245948/benchmarks/cora_2024";

const decode = (codes) => Array.from(codes, (c) => ({ s: "sat", u: "unsat", "?": "unknown" })[c]);

function mnistFc(layersLabel, net, codes003, codes005) {
  return {
    id: `mnist_fc-${net}`,
    label: `VNN-COMP 2022 mnist_fc: ${layersLabel} ReLU network`,
    modelName: `mnist-net_${net}.onnx`,
    modelUrl: `${VNN2022}/onnx/mnist-net_${net}.onnx.gz`,
    // The ε = 0.03 property files are only used to recover the 15 images.
    propertyUrls: Array.from({ length: 15 }, (_, i) => `${VNN2022}/vnnlib/prop_${i}_0.03.vnnlib.gz`),
    propertyEpsilon: 0.03,
    snapPixels: true, // pixels are k/255
    imageNames: Array.from({ length: 15 }, (_, i) => `prop_${i}`),
    settings: { epsilon: 0.05, domainLoText: "0", domainHiText: "1" },
    reference: {
      source: "VNN-COMP 2022 mnist_fc: published verdicts of the complete verifiers",
      sourceUrl: "https://github.com/VNN-COMP/vnncomp2022_results",
      verdicts: { 0.03: decode(codes003), 0.05: decode(codes005) },
    },
  };
}

const CORA_IMAGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20];

function cora(kind, description, codes) {
  return {
    id: `cora-${kind}`,
    label: `VNN-COMP 2025 CORA: MNIST 7×250 ReLU, ${description}`,
    modelName: `mnist-${kind}.onnx`,
    modelUrl: `${VNN2025}/onnx/mnist-${kind}.onnx.gz`,
    propertyUrls: CORA_IMAGES.map((i) => `${VNN2025}/vnnlib/mnist-img${i}.vnnlib.gz`),
    propertyEpsilon: 0.1,
    snapPixels: false,
    imageNames: CORA_IMAGES.map((i) => `img${i}`),
    settings: { epsilon: 0.1, domainLoText: "0", domainHiText: "1" },
    reference: {
      source: "VNN-COMP 2025 cora_2024: published verdicts of the complete verifiers",
      sourceUrl: "https://github.com/VNN-COMP/vnncomp2025_results",
      verdicts: { 0.1: decode(codes) },
    },
  };
}

export const BENCHMARKS = [
  mnistFc("6×256", "256x6", "uuuuuusuuuuuuuu", "usuuuus?uuuuuuu"),
  mnistFc("4×256", "256x4", "usuuuuuuuuuuuuu", "usuuuususuuuuuu"),
  mnistFc("2×256", "256x2", "ussuuuuuuuuusuu", "sssusssusuuusuu"),
  cora("set", "set-based training", "uuuuuuuuuuuuuuusuuuu"),
  cora("point", "standard training", "sss?ssssssssss?sssss"),
  cora("trades", "“trades” model", "s???????????????s???"),
];

/**
 * Recover the centre point and label of an ε-ball property whose box is
 * clip(x ± ε, 0, 1) and whose unsafe condition is "some Y_j ≥ Y_label".
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
