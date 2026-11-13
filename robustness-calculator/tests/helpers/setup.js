// Shared Node test setup: npm builds of tf.js (CPU backend) and onnxruntime-web.

import * as tf from "@tensorflow/tfjs";
import * as ort from "onnxruntime-web";
import { parseOnnxModel } from "../../src/onnx/onnx-model.js";
import { translateModel } from "../../src/onnx/translate.js";
import { createOrtChecker } from "../../src/check/ort-check.js";

// Silence the "install tfjs-node" banner.
const warn = console.warn;
console.warn = (...args) => (String(args[0]).includes("tfjs-node") ? undefined : warn(...args));
const log = console.log;
console.log = (...args) => (String(args[0]).includes("============") || String(args[0]).includes("tfjs-node") ? undefined : log(...args));

await tf.setBackend("cpu");
ort.env.wasm.numThreads = 1;

export { tf, ort };

export async function load(bytes) {
  const model = translateModel(tf, parseOnnxModel(bytes));
  const checker = await createOrtChecker(ort, bytes, model);
  return { model, checker };
}
