// A small seeded classifier for exact tests (2 inputs → 16 → 16 → 3 ReLU)
// and 40 points labelled with its own predictions. Built in memory, so no
// data files are needed. Same weights and points as the former shipped toy
// example (seed 2025; a 2→8→8→2 network is drawn first and discarded).

import { model, node, tensor } from "./onnx-writer.js";
import { createRng } from "../../src/attack/rng.js";

function forward(layers, x) {
  let h = x;
  layers.forEach(({ W, b, nin, nout }, li) => {
    const o = new Array(nout).fill(0);
    for (let j = 0; j < nout; j++) {
      let s = b[j];
      for (let i = 0; i < nin; i++) s += h[i] * W[i * nout + j];
      o[j] = s;
    }
    h = li < layers.length - 1 ? o.map((v) => Math.max(0, v)) : o;
  });
  return h;
}

export function buildToyClassifier() {
  const rng = createRng(2025);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const randn = (n, scale) => Array.from({ length: n }, () => Math.fround(gauss() * scale));
  const layersFor = (sizes, scale) => {
    const layers = [];
    for (let l = 0; l + 1 < sizes.length; l++) {
      const nin = sizes[l];
      const nout = sizes[l + 1];
      layers.push({ nin, nout, W: randn(nin * nout, scale / Math.sqrt(nin)), b: randn(nout, 0.1) });
    }
    return layers;
  };

  layersFor([2, 8, 8, 2], 1.5); // discarded, keeps the original random sequence
  const layers = layersFor([2, 16, 16, 3], 2.0);

  const nodes = [];
  const inits = [];
  let cur = "input";
  layers.forEach((L, i) => {
    inits.push(tensor(`W${i}`, [L.nin, L.nout], L.W), tensor(`b${i}`, [L.nout], L.b));
    nodes.push(node("Gemm", [cur, `W${i}`, `b${i}`], [`z${i}`]));
    cur = `z${i}`;
    if (i < layers.length - 1) {
      nodes.push(node("Relu", [cur], [`h${i}`]));
      cur = `h${i}`;
    }
  });
  nodes.push(node("Identity", [cur], ["output"]));
  const bytes = model({
    nodes,
    initializers: inits,
    input: ["input", ["batch", 2]],
    output: ["output", ["batch", 3]],
  });

  const inputs = [];
  const labels = [];
  for (let i = 0; i < 40; i++) {
    const x = [Number((rng() * 2 - 1).toFixed(3)), Number((rng() * 2 - 1).toFixed(3))];
    const y = forward(layers, x.map(Math.fround));
    inputs.push(x);
    labels.push(y.indexOf(Math.max(...y)));
  }
  return { bytes, points: { inputs, labels } };
}
