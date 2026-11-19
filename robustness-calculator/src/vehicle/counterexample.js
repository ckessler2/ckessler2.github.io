// Counterexamples as pictures, checked in the browser. Vehicle prints a counterexample for a
// dataset element (e.g. robust!3) as a matrix, often the perturbation of image 3. Here it is drawn,
// the dataset image and the perturbed image are drawn beside it, and the network is run on the
// perturbed image with onnxruntime-web to confirm that its answer changes.

import { ORT_URL, ORT_WASM_BASE } from "../lib/cdn.js";
import { parseOnnxModel } from "../onnx/onnx-model.js";

const IDX_TYPES = {
  0x08: [1, (v, o) => v.getUint8(o)],
  0x09: [1, (v, o) => v.getInt8(o)],
  0x0b: [2, (v, o) => v.getInt16(o)],
  0x0c: [4, (v, o) => v.getInt32(o)],
  0x0d: [4, (v, o) => v.getFloat32(o)],
  0x0e: [8, (v, o) => v.getFloat64(o)],
};

/** An IDX file as { dims, values } (values as a Float64Array), or null if it is not one. */
export function parseIdx(bytes) {
  if (!bytes || bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0) return null;
  const type = IDX_TYPES[bytes[2]];
  const rank = bytes[3];
  if (!type || rank < 1) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dims = Array.from({ length: rank }, (_, i) => view.getUint32(4 + 4 * i));
  const count = dims.reduce((a, b) => a * b, 1);
  const start = 4 + 4 * rank;
  const [size, read] = type;
  if (bytes.length < start + count * size) return null;
  const values = new Float64Array(count);
  for (let i = 0; i < count; i++) values[i] = read(view, start + i * size);
  return { dims, values };
}

/** Vehicle's printed value as a rectangular numeric matrix (at least 4×4), or null. */
export function asMatrix(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length < 4 || !Array.isArray(value[0])) return null;
  const width = value[0].length;
  if (width < 4) return null;
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== width || !row.every((x) => typeof x === "number")) return null;
  }
  return value;
}

/** Element i of a dataset of matrices with the given shape, or null. */
export function datasetMatrix(idx, index, height, width) {
  if (!idx || idx.dims.length !== 3 || idx.dims[1] !== height || idx.dims[2] !== width) return null;
  if (index >= idx.dims[0]) return null;
  const size = height * width;
  const flat = idx.values.subarray(index * size, (index + 1) * size);
  return Array.from({ length: height }, (_, r) => Array.from(flat.subarray(r * width, (r + 1) * width)));
}

/** Draw a matrix: greyscale in [0, 1] for images, blue-white-red around 0 for differences. */
export function drawMatrix(matrix, { diverging = false, label = "" } = {}) {
  const height = matrix.length;
  const width = matrix[0].length;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.className = "vw-cex-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  const ctx = canvas.getContext("2d");
  const pixels = ctx.createImageData(width, height);
  const flat = matrix.flat();
  const scale = diverging ? Math.max(1e-12, ...flat.map(Math.abs)) : Math.max(1, ...flat);
  flat.forEach((x, i) => {
    let r;
    let g;
    let b;
    if (diverging) {
      const t = Math.max(-1, Math.min(1, x / scale));
      const fade = Math.round(255 * (1 - Math.abs(t)));
      [r, g, b] = t >= 0 ? [255, fade, fade] : [fade, fade, 255];
    } else {
      r = g = b = Math.round(255 * Math.max(0, Math.min(1, x / scale)));
    }
    pixels.data.set([r, g, b, 255], i * 4);
  });
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

// ---- checking with the network ------------------------------------------------------------------

let ortPromise = null;
const sessions = new WeakMap(); // network bytes -> Promise<{ session, inputName, shape }>

async function loadOrt() {
  ortPromise ??= import(ORT_URL).then((ort) => {
    ort.env.wasm.wasmPaths = ORT_WASM_BASE;
    ort.env.wasm.numThreads = 1;
    return ort;
  });
  return ortPromise;
}

function sessionFor(ort, bytes) {
  if (!sessions.has(bytes)) {
    sessions.set(
      bytes,
      (async () => {
        const input = parseOnnxModel(bytes).graph.inputs[0];
        const dims = (input?.shape ?? []).map((d) => (typeof d === "number" && d > 0 ? d : 1));
        const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
        return { session, inputName: session.inputNames[0], dims };
      })(),
    );
  }
  return sessions.get(bytes);
}

const argmax = (xs) => xs.reduce((best, x, i) => (x > xs[best] ? i : best), 0);

/**
 * Run the network on image − perturbation and image + perturbation (specifications differ in the
 * sign). Returns { sign, predicted, label, valid } for the first that changes the answer, or
 * { sign: null, predicted } if neither does. `valid`: the perturbed image stays in [0, 1].
 */
export async function confirmCounterexample(networkBytes, image, perturbation, label) {
  const ort = await loadOrt();
  const { session, inputName, dims } = await sessionFor(ort, networkBytes);
  const size = image.length * image[0].length;
  const shape = dims.reduce((a, b) => a * b, 1) === size ? dims : [1, size];
  let firstPrediction = null;
  for (const sign of [-1, 1]) {
    const data = new Float32Array(size);
    image.flat().forEach((x, i) => (data[i] = x + sign * perturbation.flat()[i]));
    const output = await session.run({ [inputName]: new ort.Tensor("float32", data, shape) });
    const scores = Array.from(output[session.outputNames[0]].data);
    const predicted = argmax(scores);
    firstPrediction ??= predicted;
    if (predicted !== label) {
      const valid = data.every((x) => x >= -1e-6 && x <= 1 + 1e-6);
      return { sign, predicted, label, valid };
    }
  }
  return { sign: null, predicted: firstPrediction, label };
}
