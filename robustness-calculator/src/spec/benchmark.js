// Built-in benchmarks: published VNN-COMP ε-ball classification instances
// with known verdicts (2022 mnist_fc; 2025 cora_2024 and malbeware).
//
// Nothing is hosted here: each network and its property files are fetched on
// demand from the benchmark repositories, pinned to one commit. The images and
// labels are recovered from the property files (each box is the image ± ε,
// clipped to [0, 1]; the label is the class every unsafe case compares with).
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
    task: "classification",
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

const VNN2025_MAL = VNN2025.replace("/cora_2024", "/malbeware");

const CORA = {
  mnist: { name: "MNIST", eps: 0.1, images: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20] },
  svhn: { name: "SVHN", eps: 0.1, images: [14, 130, 137, 153, 164, 182, 225, 263, 279, 289, 337, 349, 530, 601, 637, 692, 718, 735, 745, 760] },
  cifar10: { name: "CIFAR-10", eps: 2 / 255, images: [66, 77, 96, 100, 126, 135, 160, 166, 206, 207, 244, 292, 328, 332, 339, 340, 386, 398, 440, 479] },
};
const CORA_MODELS = { point: "standard training", set: "set-based training", trades: "“trades” model" };

function cora(dataset, kind, codes) {
  const d = CORA[dataset];
  return {
    id: `cora-${dataset}-${kind}`,
    task: "classification",
    label: `VNN-COMP 2025 CORA: ${d.name} 7×250 ReLU, ${CORA_MODELS[kind]}`,
    modelName: `${dataset}-${kind}.onnx`,
    modelUrl: `${VNN2025}/onnx/${dataset}-${kind}.onnx.gz`,
    propertyUrls: d.images.map((i) => `${VNN2025}/vnnlib/${dataset}-img${i}.vnnlib.gz`),
    propertyEpsilon: d.eps,
    snapPixels: false,
    imageNames: d.images.map((i) => `img${i}`),
    settings: { epsilon: d.eps, domainLoText: "0", domainHiText: "1" },
    reference: {
      source: "VNN-COMP 2025 cora_2024: published verdicts of the complete verifiers",
      sourceUrl: "https://github.com/VNN-COMP/vnncomp2025_results",
      verdicts: { [d.eps]: decode(codes) },
    },
  };
}

// MalBeWare: a linear classifier of 64×64 malware images into 25 families.
// Each ε uses its own set of images, so each ε is a separate entry.
function malbeware(k, files, codes) {
  const eps = k / 255;
  return {
    id: `malbeware-linear-eps${k}`,
    task: "classification",
    label: `VNN-COMP 2025 MalBeWare: linear 64×64 → 25 classes, ε = ${k}/255`,
    modelName: "malware_malimg_family_scaled_linear-25.onnx",
    modelUrl: `${VNN2025_MAL}/onnx/malware_malimg_family_scaled_linear-25.onnx.gz`,
    propertyUrls: files.map((f) => `${VNN2025_MAL}/vnnlib/malbeware_family-${encodeURIComponent(f)}.vnnlib.gz`),
    propertyEpsilon: eps,
    snapPixels: false,
    imageNames: files.map((f) => `${/idx-(\d+)/.exec(f)[0]} ${f.split("_label")[0]}`),
    settings: { epsilon: eps, domainLoText: "0", domainHiText: "1" },
    reference: {
      source: "VNN-COMP 2025 malbeware: published verdicts of the complete verifiers",
      sourceUrl: "https://github.com/VNN-COMP/vnncomp2025_results",
      verdicts: { [eps]: decode(codes) },
    },
  };
}

export const BENCHMARKS = [
  mnistFc("6×256", "256x6", "uuuuuusuuuuuuuu", "usuuuus?uuuuuuu"),
  mnistFc("4×256", "256x4", "usuuuuuuuuuuuuu", "usuuuususuuuuuu"),
  mnistFc("2×256", "256x2", "ussuuuuuuuuusuu", "sssusssusuuusuu"),
  cora("mnist", "set", "uuuuuuuuuuuuuuusuuuu"),
  cora("mnist", "point", "sss?ssssssssss?sssss"),
  cora("mnist", "trades", "s???????????????s???"),
  cora("svhn", "set", "ssssssssssssssssssss"),
  cora("svhn", "point", "ssssssssssssssssssss"),
  cora("svhn", "trades", "ssssssssssssssssssss"),
  cora("cifar10", "set", "ssuusssss?sssssssu?s"),
  cora("cifar10", "point", "ssssss?sssssssssssss"),
  cora("cifar10", "trades", "ss?sss?s?ssssssss?ss"),
  malbeware(1, [
    "Obfuscator.AD_label-17_eps-1_idx-89", "Skintrim.N_label-19_eps-1_idx-96", "Adialer.C_label-0_eps-1_idx-4", "Lolyda.AA3_label-14_eps-1_idx-71",
    "Malex.gen!J_label-16_eps-1_idx-84", "Dontovo.A_label-9_eps-1_idx-48", "Autorun.K_label-5_eps-1_idx-25", "Lolyda.AA2_label-13_eps-1_idx-66",
    "Lolyda.AT_label-15_eps-1_idx-79", "Dialplatform.B_label-8_eps-1_idx-40", "Autorun.K_label-5_eps-1_idx-27", "Allaple.L_label-3_eps-1_idx-18",
    "Autorun.K_label-5_eps-1_idx-28", "Alueron.gen!J_label-4_eps-1_idx-23",
  ], "uuuuuuuuuuuuuu"),
  malbeware(2, [
    "Agent.FYI_label-1_eps-2_idx-8", "Rbotigen_label-18_eps-2_idx-92", "Allaple.L_label-3_eps-2_idx-16", "Rbotigen_label-18_eps-2_idx-94",
    "Obfuscator.AD_label-17_eps-2_idx-87", "Wintrim.BX_label-23_eps-2_idx-117", "Lolyda.AA2_label-13_eps-2_idx-68", "Autorun.K_label-5_eps-2_idx-29",
    "VB.AT_label-22_eps-2_idx-112", "C2LOP.P_label-6_eps-2_idx-30", "Instantaccess_label-11_eps-2_idx-57", "Swizzor.gen!E_label-20_eps-2_idx-104",
    "Rbotigen_label-18_eps-2_idx-93", "Lolyda.AT_label-15_eps-2_idx-76", "C2LOP.P_label-6_eps-2_idx-31", "Allaple.L_label-3_eps-2_idx-18",
    "Allaple.A_label-2_eps-2_idx-13", "Dialplatform.B_label-8_eps-2_idx-43", "Instantaccess_label-11_eps-2_idx-55",
  ], "uuuuuuuuuuuuuuuuuuu"),
  malbeware(3, [
    "VB.AT_label-22_eps-3_idx-112", "Allaple.A_label-2_eps-3_idx-11", "Skintrim.N_label-19_eps-3_idx-96", "Lolyda.AA1_label-12_eps-3_idx-64",
    "Alueron.gen!J_label-4_eps-3_idx-21", "Yuner.A_label-24_eps-3_idx-120", "Swizzor.gen!E_label-20_eps-3_idx-102", "Lolyda.AA1_label-12_eps-3_idx-60",
    "Fakerean_label-10_eps-3_idx-54", "Wintrim.BX_label-23_eps-3_idx-119", "Swizzor.gen!E_label-20_eps-3_idx-100", "Lolyda.AA3_label-14_eps-3_idx-71",
    "Agent.FYI_label-1_eps-3_idx-8", "Allaple.A_label-2_eps-3_idx-12", "Malex.gen!J_label-16_eps-3_idx-82", "Allaple.L_label-3_eps-3_idx-16",
    "VB.AT_label-22_eps-3_idx-111",
  ], "uuuuuuuuuusuuuuuu"),
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
