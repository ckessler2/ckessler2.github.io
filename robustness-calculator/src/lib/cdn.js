// Pinned library versions, loaded from jsDelivr by the worker. The Node tests
// use the same versions from npm (see package.json).

export const TFJS_VERSION = "4.22.0";
export const ORT_VERSION = "1.20.1";

export const TFJS_URL = `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@${TFJS_VERSION}/dist/tf.fesm.min.js`;
export const ORT_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.wasm.min.mjs`;
export const ORT_WASM_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
