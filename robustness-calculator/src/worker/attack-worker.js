// Web Worker: owns tf.js, onnxruntime-web, the translated model and the
// attack loop, so the page stays responsive. Cancelling a run terminates
// this worker; the page then starts a fresh one.

import { TFJS_URL, ORT_URL, ORT_WASM_BASE } from "../lib/cdn.js";
import { parseOnnxModel } from "../onnx/onnx-model.js";
import { translateModel } from "../onnx/translate.js";
import { createOrtChecker } from "../check/ort-check.js";
import { parseVnnlib } from "../spec/vnnlib.js";
import { parsePointsCsv, parseBoundList } from "../spec/points.js";
import { runVnnlibCheck } from "../attack/run-vnnlib.js";
import { runPointsCheck } from "../attack/run-points.js";

let tf = null;
let ort = null;
let parsed = null;
let model = null;
let checker = null;

async function loadLibraries() {
  if (tf) return;
  [tf, ort] = await Promise.all([import(TFJS_URL), import(ORT_URL)]);
  ort.env.wasm.wasmPaths = ORT_WASM_BASE;
  ort.env.wasm.numThreads = 1; // GitHub Pages is not cross-origin isolated
  await tf.setBackend("cpu");
  await tf.ready();
}

async function useBackend(name) {
  if (tf.getBackend() === name) return name;
  let ok = false;
  try {
    ok = await tf.setBackend(name);
  } catch {
    ok = false;
  }
  if (!ok) {
    await tf.setBackend("cpu");
  }
  await tf.ready();
  // Rebuild the weight tensors on the new backend.
  model?.dispose();
  model = translateModel(tf, parsed);
  return tf.getBackend();
}

function summary(m, p) {
  return {
    inputName: m.inputName,
    declaredInputShape: m.declaredInputShape,
    featureShape: m.featureShape,
    inputSize: m.inputSize,
    outputName: m.outputName,
    extraOutputs: m.extraOutputs,
    outputSize: m.outputSize,
    opCounts: m.opCounts,
    paramCount: m.paramCount,
    opset: m.opset,
    producer: p.producer,
  };
}

async function handle(msg, reply) {
  await loadLibraries();

  if (msg.type === "load-model") {
    model?.dispose();
    await checker?.dispose();
    model = null;
    checker = null;
    const bytes = msg.bytes;
    parsed = parseOnnxModel(bytes);
    model = translateModel(tf, parsed);
    checker = await createOrtChecker(ort, bytes, model);
    return summary(model, parsed);
  }

  if (!model) throw new Error("Load a model first.");

  const settings = msg.settings;
  const backend = await useBackend(settings.backend ?? "cpu");
  const runSettings = { ...settings, backend };

  let last = 0;
  const onProgress = (p) => {
    const now = performance.now();
    if (p.phase === "attack" && now - last < 60 && p.step !== p.steps) return;
    last = now;
    reply({ type: "progress", progress: p });
  };

  if (msg.type === "run-vnnlib") {
    const spec = parseVnnlib(msg.text);
    return runVnnlibCheck({ tf, model, checker, spec, settings: runSettings, onProgress });
  }

  if (msg.type === "run-points") {
    const points = parsePointsCsv(msg.text, model.inputSize, settings.task);
    const domainLo = parseBoundList(settings.domainLoText, model.inputSize, "Domain lower bounds");
    const domainHi = parseBoundList(settings.domainHiText, model.inputSize, "Domain upper bounds");
    const result = await runPointsCheck({
      tf,
      model,
      checker,
      points,
      settings: { ...runSettings, domainLo, domainHi },
      onProgress,
    });
    result.extraColumns = points.extraColumns;
    return result;
  }

  throw new Error(`Unknown request ${msg.type}.`);
}

self.onmessage = async (event) => {
  const msg = event.data;
  const reply = (body) => self.postMessage({ id: msg.id, ...body });
  try {
    const result = await handle(msg, reply);
    reply({ type: "done", result });
  } catch (err) {
    reply({ type: "error", error: err?.message ?? String(err) });
  }
};
